"use client";

import { LoaderCircle, Phone } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import type { EstadoPlantilla, PlantillaAprobada } from "@/lib/api-tipos";
import { NO_DISPONIBLE_EN_PRUEBA } from "@/lib/modo-prueba-reglas";
import { PLANTILLA_RETOMAR, variablesDe } from "@/lib/plantillas";
import { etiquetaVariable, nombreCategoria, textoRenderizado, variablesDePlantilla } from "@/lib/retomar";
import type { Lead } from "@/lib/tipos";
import { crearPlantillas, leerPlantillas } from "./api-sistema";
import { EstadoDeMensaje } from "./configuracion/conexiones";
import { confirmar } from "./confirmaciones";
import { useNegocio } from "./negocio";
import { useEstado } from "./sistema";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO_DIALOGO, CAJA_DIALOGO, FONDO_DIALOGO, pedirApi, teclasDeDialogo } from "./selector-cita";

// Pasadas 24 h desde el último mensaje del cliente, WhatsApp solo deja escribirle con un mensaje
// aprobado. Esta caja sustituye a la de escribir: lo explica, da el teléfono y abre «Retomar la
// conversación», que elige uno de los mensajes aprobados en Meta, rellena sus datos y lo envía.

const BOTON_CAJA =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-sm:h-11";

/** El último mensaje nuestro, si es un mensaje aprobado que el dueño mandó desde aquí después de lo último del cliente. */
function aprobadoSinRespuesta(lead: Lead): string | null {
  for (let i = lead.mensajes.length - 1; i >= 0; i--) {
    const m = lead.mensajes[i];
    if (m.de === "cliente") return null;
    if (m.plantilla && m.manual) return m.nombrePlantilla ?? null;
  }
  return null;
}

/** La caja de abajo con la ventana cerrada: por qué no se puede escribir, el teléfono y, si se puede, retomar. */
export function CajaRetomar({ lead, refrescar }: { lead: Lead; refrescar: () => Promise<void> }): JSX.Element {
  const { formato } = useNegocio();
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const escribio = lead.mensajes.some((m) => m.de === "cliente");
  const hayMensajes = lead.mensajes.length > 0;
  const enviado = aprobadoSinRespuesta(lead);
  // Los mensajes aprobados son de Meta: en el modo prueba no se puede retomar.
  const prueba = useEstado()?.modoWhatsApp === "prueba";

  const texto = escribio
    ? "Han pasado más de 24 h desde su último mensaje. WhatsApp solo deja escribirle con un mensaje aprobado."
    : hayMensajes
      ? "Aún no te ha escrito: WhatsApp solo deja escribirle con un mensaje aprobado."
      : "Aún no te ha escrito: cuando lo haga, podrás contestarle desde aquí.";

  return (
    <div className="border-t border-linea bg-white px-5 py-3 text-[13px] leading-[18px] max-sm:sticky max-sm:bottom-0 max-sm:z-[1] max-sm:px-4">
      {enviado && <p className="mb-1.5 font-medium">{`Le has escrito con «${enviado}». Cuando conteste, podrás escribirle.`}</p>}
      <p className="text-secundario">{texto}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {hayMensajes && !prueba && (
          <button ref={boton} type="button" onClick={() => setAbierto(true)} className={`${BOTON_CAJA} bg-tinta text-white hover:bg-black`}>
            Retomar la conversación
          </button>
        )}
        {hayMensajes && prueba && (
          <span className="inline-flex h-9 items-center text-[13px] text-secundario max-sm:h-11">{`Retomar la conversación: ${NO_DISPONIBLE_EN_PRUEBA.toLowerCase()}`}</span>
        )}
        <a href={`tel:+${lead.telefono}`} className={`${BOTON_CAJA} border border-linea bg-white tabular-nums hover:bg-lienzo`}>
          <Phone aria-hidden className="size-3.5" strokeWidth={1.75} />
          Llámale: {formato.telefono(lead.telefono)}
        </a>
      </div>
      {abierto && (
        <SelectorRetomar
          lead={lead}
          refrescar={refrescar}
          cerrar={() => {
            setAbierto(false);
            requestAnimationFrame(() => boton.current?.focus());
          }}
        />
      )}
    </div>
  );
}

// ─── El selector de mensajes aprobados ───────────────────────────────────────────────────────────

const clave = (p: Pick<PlantillaAprobada, "nombre" | "idioma">) => `${p.nombre}|${p.idioma}`;

/** La que sugiere la app, para enseñarla mientras no esté aprobada. */
const SUGERIDA: PlantillaAprobada = {
  nombre: PLANTILLA_RETOMAR.nombre,
  idioma: PLANTILLA_RETOMAR.idioma,
  categoria: PLANTILLA_RETOMAR.categoria,
  texto: PLANTILLA_RETOMAR.texto,
  variables: variablesDe(PLANTILLA_RETOMAR.texto),
};

function SelectorRetomar({ lead, cerrar, refrescar }: { lead: Lead; cerrar: () => void; refrescar: () => Promise<void> }): JSX.Element {
  const { cfg } = useNegocio();
  const id = useId();
  const [plantillas, setPlantillas] = useState<PlantillaAprobada[] | null>(null);
  const [sugerida, setSugerida] = useState<EstadoPlantilla | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, Record<number, string>>>({});
  const [errorCampo, setErrorCampo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const montado = useRef(true);
  const negocio = cfg.negocio.nombre;

  const leer = useCallback(async () => {
    const r = await pedirApi(`/api/retomar?leadId=${encodeURIComponent(lead.id)}`);
    if (!montado.current) return;
    if (!r.ok) {
      setError(r.error);
      setPlantillas((antes) => antes ?? []);
      if (r.status === 404) void refrescar();
      return;
    }
    const lista = Array.isArray(r.datos.plantillas) ? (r.datos.plantillas as PlantillaAprobada[]) : [];
    setPlantillas(lista);
    setElegida((antes) => (antes && lista.some((p) => clave(p) === antes) ? antes : lista[0] ? clave(lista[0]) : null));
    if (!lista.some((p) => p.nombre === PLANTILLA_RETOMAR.nombre)) {
      const estados = await leerPlantillas();
      if (montado.current) setSugerida(estados.find((p) => p.id === "retomar") ?? null);
    } else {
      setSugerida(null);
    }
  }, [lead.id, refrescar]);

  useEffect(() => {
    montado.current = true;
    titulo.current?.focus();
    void leer();
    return () => {
      montado.current = false;
    };
  }, [leer]);

  const crearSugerida = async () => {
    const r = await crearPlantillas(["retomar"]);
    if (!montado.current) return;
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setSugerida(r.find((p) => p.id === "retomar") ?? null);
    // Meta tarda un poco en aprobarla: se vuelve a mirar en unos segundos.
    setTimeout(() => void leer(), 6_000);
  };

  const plantilla = plantillas?.find((p) => clave(p) === elegida) ?? null;
  const calculadas = plantilla ? variablesDePlantilla(plantilla, lead, negocio) : null;
  const escritas = (elegida && valores[elegida]) || {};

  /** El texto que verá: lo que se sabe, lo escrito y, lo que falta, entre corchetes. */
  const vistaPrevia = (p: PlantillaAprobada) => {
    const { fijas } = variablesDePlantilla(p, lead, negocio);
    const propias = valores[clave(p)] ?? {};
    const hasta = p.variables.length ? Math.max(...p.variables) : 0;
    const lista = Array.from({ length: hasta }, (_, i) => {
      const n = i + 1;
      return fijas[n] ?? (propias[n]?.trim() || `[${etiquetaVariable(n)}]`);
    });
    return textoRenderizado(p, lista);
  };

  const enviar = async () => {
    if (!plantilla || !calculadas || enviando) return;
    const falta = calculadas.pedir.find((n) => !escritas[n]?.trim());
    if (falta !== undefined) {
      setErrorCampo(falta);
      setError(`Rellena ${falta === 1 ? "el nombre del cliente" : falta === 2 ? "el nombre del negocio" : `el dato ${falta}`}`);
      caja.current?.querySelector<HTMLInputElement>(`#${CSS.escape(`${id}-v${falta}`)}`)?.focus();
      return;
    }
    setEnviando(true);
    setError(null);
    setErrorCampo(null);
    const variables = Object.fromEntries(calculadas.pedir.map((n) => [String(n), escritas[n] ?? ""]));
    const r = await pedirApi("/api/retomar", { leadId: lead.id, plantilla: { nombre: plantilla.nombre, idioma: plantilla.idioma }, variables });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      const campo = Number(r.datos?.campo);
      if (Number.isInteger(campo) && campo > 0) setErrorCampo(campo);
      if (r.status === 404) void refrescar();
      // Ya no está aprobado: se vuelve a pedir la lista.
      if (r.error === "Ese mensaje ya no está aprobado en Meta") void leer();
      return;
    }
    cerrar();
    confirmar("Mensaje enviado");
    void refrescar();
  };

  const fijasSugerida = variablesDePlantilla(SUGERIDA, lead, negocio).fijas;
  const textoSugerido = textoRenderizado(SUGERIDA, [fijasSugerida[1] ?? `[${etiquetaVariable(1)}]`, fijasSugerida[2] ?? `[${etiquetaVariable(2)}]`]);

  return createPortal(
    <div className={FONDO_DIALOGO}>
      <div aria-hidden className="absolute inset-0 bg-black/25" onClick={cerrar} />
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-busy={enviando}
        onKeyDown={teclasDeDialogo(caja, cerrar)}
        className={`${CAJA_DIALOGO} w-[min(520px,calc(100vw-2rem))] gap-4`}
      >
        <div>
          <h2 ref={titulo} id={`${id}-titulo`} tabIndex={-1} className="text-[17px] leading-6 font-medium outline-none">
            Retomar la conversación
          </h2>
          <p className="mt-0.5 text-[13px] leading-[18px] text-secundario break-words">{lead.nombre}</p>
        </div>

        {plantillas === null ? (
          <p className="flex items-center gap-2 text-[13px] leading-[18px] text-secundario">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
            Mirando tus mensajes aprobados…
          </p>
        ) : plantillas.length === 0 ? (
          !error && <p className="text-[14px] leading-5">No tienes mensajes aprobados en Meta.</p>
        ) : (
          <fieldset className="-mx-1 flex min-h-[140px] min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-0.5">
            <legend className="sr-only">Mensaje aprobado</legend>
            {plantillas.map((p) => {
              const k = clave(p);
              const marcada = k === elegida;
              return (
                <label
                  key={k}
                  className={`flex min-w-0 cursor-pointer flex-col gap-2 rounded-[12px] border p-3 transition-colors duration-150 ease-out has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tinta ${
                    marcada ? "border-tinta" : "border-linea hover:bg-lienzo"
                  }`}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <input
                      type="radio"
                      name={`${id}-plantilla`}
                      value={k}
                      checked={marcada}
                      onChange={() => {
                        setElegida(k);
                        setError(null);
                        setErrorCampo(null);
                      }}
                      className="size-4 shrink-0 cursor-pointer accent-tinta"
                    />
                    <span className="min-w-0 text-[14px] leading-5 font-medium break-all">{p.nombre}</span>
                    <span className="inline-flex h-[18px] shrink-0 items-center rounded-[5px] bg-fondo px-1.5 text-[11px] leading-4 font-medium text-tinta/75">
                      {nombreCategoria(p.categoria)}
                    </span>
                  </span>
                  <span className="ml-6 rounded-[12px] rounded-tr-[4px] bg-[#d9fdd3] px-3 py-2 text-[13px] leading-[18px] break-words whitespace-pre-wrap max-sm:ml-0">
                    {vistaPrevia(p)}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        {plantilla && calculadas && calculadas.pedir.length > 0 && (
          <div className="flex flex-col gap-3">
            {calculadas.pedir.map((n) => (
              <div key={n} className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-v${n}`} className="text-[13px] leading-[18px] text-secundario">
                  {etiquetaVariable(n)}
                </label>
                <input
                  id={`${id}-v${n}`}
                  maxLength={60}
                  autoComplete="off"
                  value={escritas[n] ?? ""}
                  aria-invalid={errorCampo === n}
                  onChange={(e) => {
                    const valor = e.target.value;
                    setValores((antes) => ({ ...antes, [clave(plantilla)]: { ...(antes[clave(plantilla)] ?? {}), [n]: valor } }));
                    if (errorCampo === n) {
                      setErrorCampo(null);
                      setError(null);
                    }
                  }}
                  className="h-10 w-full min-w-0 rounded-[8px] border border-linea bg-white px-3 text-[14px] leading-5 outline-none transition-colors duration-150 ease-out focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10 aria-[invalid=true]:border-error max-sm:h-11"
                />
              </div>
            ))}
          </div>
        )}

        {plantillas !== null && !plantillas.some((p) => p.nombre === PLANTILLA_RETOMAR.nombre) && (
          <section aria-labelledby={`${id}-sugerido`} className="flex flex-col gap-2 rounded-[12px] bg-lienzo p-3">
            <h3 id={`${id}-sugerido`} className="text-[13px] leading-[18px] font-medium">
              Mensaje sugerido
            </h3>
            <p className="text-[13px] leading-[18px] break-words">{textoSugerido}</p>
            {sugerida && <EstadoDeMensaje plantilla={sugerida} crear={crearSugerida} />}
          </section>
        )}

        <p className="text-[12px] leading-4 text-secundario">Meta cobra cada mensaje con plantilla</p>

        {error && (
          <p role="alert" className="text-[13px] leading-[18px] text-error-texto">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO_DIALOGO}>
            Cancelar
          </button>
          <button type="button" onClick={() => void enviar()} disabled={!plantilla || enviando} className={BOTON_PRIMARIO}>
            {enviando && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />}
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
