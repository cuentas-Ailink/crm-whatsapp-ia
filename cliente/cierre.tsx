"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { momentoDeHueco } from "@/lib/agenda";
import { LIMITES } from "@/lib/configuracion";
import { importeMaximo, MONEDAS } from "@/lib/regional";
import { MOTIVOS_NO_SIGUE, type Lead, type MotivoNoSigue } from "@/lib/tipos";
import { formas } from "@/lib/vocabulario";
import { confirmar } from "./confirmaciones";
import { cerrarVisita, desfaseServidor } from "./datos";
import { useNegocio } from "./negocio";

// El cierre de una cita: «¿Cómo fue la visita?» → «Ha dicho que sí» (con el importe) o «No sigue»
// (con un motivo). Un solo diálogo para todo el panel: lo abren la pastilla de la ficha, el bloque de
// la ficha, Hoy y las tarjetas con abrirCierre(); el panel lo monta una vez con <DialogoCierre/>.

type Accion = "si" | "no";

interface Abierto {
  lead: Lead;
  accion: Accion | null;
  /** Lo que tenía el foco al abrir: vuelve ahí al cerrar. */
  previo: HTMLElement | null;
  /** Cambia en cada apertura, para empezar con el formulario limpio. */
  vez: number;
}

let abierto: Abierto | null = null;
let veces = 0;
const oyentes = new Set<() => void>();

function avisar(): void {
  for (const o of [...oyentes]) o();
}

function suscribir(o: () => void): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}

const leer = () => abierto;
const leerEnServidor = () => null;

export function abrirCierre(lead: Lead, o?: { accion?: "si" | "no" }): void {
  const activo = typeof document !== "undefined" ? document.activeElement : null;
  abierto = { lead, accion: o?.accion ?? null, previo: activo instanceof HTMLElement ? activo : null, vez: ++veces };
  avisar();
}

function cerrarDialogo(): void {
  const previo = abierto?.previo;
  abierto = null;
  avisar();
  // Después de pintar: el elemento puede volver a estar disponible (el panel quita `inert`).
  if (previo) requestAnimationFrame(() => previo.isConnected && previo.focus());
}

const ENTRADA =
  "h-10 w-full min-w-0 rounded-[8px] border border-linea bg-white px-3 text-[14px] leading-5 tabular-nums outline-none transition-colors duration-150 ease-out placeholder:text-secundario/70 focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10 aria-[invalid=true]:border-error";

const CHIP =
  "flex h-9 cursor-pointer items-center justify-center rounded-[8px] border border-linea bg-white px-3 text-[13px] leading-[18px] transition-colors duration-150 ease-out hover:bg-lienzo has-[:checked]:border-tinta has-[:checked]:bg-tinta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tinta";

/** «5200», «5.200» o «5 200» → 5200. Lo demás (decimales, letras), null. */
function leerCantidad(texto: string): number | null {
  const t = texto.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d{1,3}([.\s]\d{3})+$/.test(t)) return Number(t.replace(/[.\s]/g, ""));
  return null;
}

type Errores = Partial<Record<"importe" | "cobrado" | "motivo" | "nota" | "general", string>>;

function Formulario({ datos }: { datos: Abierto }) {
  const { lead } = datos;
  const { frases, moneda, zona, cfg } = useNegocio();
  const id = useId();
  const [accion, setAccion] = useState<Accion | null>(datos.accion);
  const [importe, setImporte] = useState(lead.presupuesto !== undefined ? String(lead.presupuesto) : "");
  const [cobrado, setCobrado] = useState(lead.cobrado !== undefined ? String(lead.cobrado) : "");
  const [motivo, setMotivo] = useState<MotivoNoSigue | null>(null);
  const [nota, setNota] = useState("");
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const campoImporte = useRef<HTMLInputElement>(null);

  const enMoneda = MONEDAS[moneda].nombre;
  const cita = cfg.vocabulario.cita;
  const citaFutura = !!lead.visita && momentoDeHueco(lead.visita.id, zona) > Date.now() + desfaseServidor();

  // El foco, en el primer campo: el importe con «sí», el motivo con «no», la elección si no hay ninguna.
  useEffect(() => {
    const nodo = caja.current;
    if (!nodo) return;
    if (datos.accion === "si") campoImporte.current?.focus();
    else nodo.querySelector<HTMLInputElement>(datos.accion === "no" ? `input[name="${id}-motivo"]` : `input[name="${id}-accion"]`)?.focus();
  }, [datos.accion, id]);

  const elegir = (a: Accion) => {
    setAccion(a);
    setErrores({});
  };

  const guardar = async () => {
    if (guardando || !accion) return;
    const e: Errores = {};
    let p: Parameters<typeof cerrarVisita>[1];
    if (accion === "si") {
      const cantidad = leerCantidad(importe);
      const senal = cobrado.trim() ? leerCantidad(cobrado) : null;
      if (!importe.trim()) e.importe = "Escribe el importe";
      else if (cantidad === null || cantidad > importeMaximo(moneda)) e.importe = `El importe tiene que ser una cantidad en ${enMoneda}, sin decimales`;
      if (cobrado.trim() && senal === null) e.cobrado = `Lo cobrado tiene que ser una cantidad en ${enMoneda}, sin decimales`;
      else if (cantidad !== null && senal !== null && senal > cantidad) e.cobrado = "Lo cobrado no puede pasar del importe";
      p = { accion: "si", importe: cantidad ?? 0, cobrado: senal };
    } else {
      if (!motivo) e.motivo = "Elige un motivo";
      p = { accion: "no", motivo: motivo ?? "Otro", ...(nota.trim() ? { nota: nota.trim() } : {}) };
    }
    if (Object.keys(e).length) {
      setErrores(e);
      const primero = caja.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      primero?.focus();
      return;
    }
    setGuardando(true);
    setErrores({});
    const fallo = await cerrarVisita(lead.id, p);
    setGuardando(false);
    if (fallo) {
      // cerrarVisita solo devuelve el texto: el campo se reconoce por cómo empieza cada error de /api/cerrar.
      const campo = /^Lo cobrado/.test(fallo)
        ? "cobrado"
        : /^(Escribe el importe|El importe)/.test(fallo)
          ? "importe"
          : /^Elige un motivo/.test(fallo)
            ? "motivo"
            : /^La nota/.test(fallo)
              ? "nota"
              : "general";
      setErrores({ [campo]: fallo });
      return;
    }
    cerrarDialogo();
    confirmar(accion === "si" ? "Apuntado: ha dicho que sí" : "Apuntado: no sigue");
  };

  // Escape cierra solo este diálogo (no la ficha de detrás) y el tabulador no sale de él.
  const alPulsar = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      evento.preventDefault();
      cerrarDialogo();
      return;
    }
    if (evento.key !== "Tab" || !caja.current) return;
    const enfocables = [...caja.current.querySelectorAll<HTMLElement>("input:not([disabled]), textarea, button:not([disabled])")];
    // Los radios de un grupo cuentan como uno: el tabulador entra en el marcado (o en el primero).
    const paradas = enfocables.filter((n) => {
      if (!(n instanceof HTMLInputElement) || n.type !== "radio") return true;
      const grupo = enfocables.filter((g) => g instanceof HTMLInputElement && g.name === n.name) as HTMLInputElement[];
      const marcado = grupo.find((g) => g.checked);
      return marcado ? n === marcado : n === grupo[0];
    });
    if (paradas.length === 0) return;
    const primero = paradas[0];
    const ultimo = paradas[paradas.length - 1];
    const activo = document.activeElement;
    if (evento.shiftKey && (activo === primero || (activo instanceof HTMLInputElement && activo.type === "radio" && activo.name === (primero as HTMLInputElement).name))) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  };

  const error = (campo: keyof Errores) =>
    errores[campo] ? (
      <p id={`${id}-error-${campo}`} role="alert" className="text-[12px] leading-4 text-error-texto">
        {errores[campo]}
      </p>
    ) : null;

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center p-4 pt-[14vh] max-sm:items-center max-sm:pt-4">
      <div aria-hidden className="absolute inset-0 bg-black/25" onClick={cerrarDialogo} />
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        onKeyDown={alPulsar}
        className="relative flex max-h-[calc(100dvh-2rem)] w-[min(420px,calc(100vw-2rem))] flex-col gap-5 overflow-y-auto overscroll-contain rounded-[14px] bg-white p-6 shadow-[0_16px_48px_rgba(0,0,0,0.18)] max-sm:p-5"
      >
        <div>
          <h2 id={`${id}-titulo`} className="text-[17px] leading-6 font-medium">
            {frases.comoFue}
          </h2>
          <p className="mt-0.5 text-[13px] leading-[18px] text-secundario">{lead.nombre}</p>
        </div>

        <div role="radiogroup" aria-labelledby={`${id}-titulo`} className="grid grid-cols-2 gap-2">
          {(["si", "no"] as const).map((a) => (
            <label key={a} className={`${CHIP} h-10 text-[14px] max-sm:h-11`}>
              <input type="radio" name={`${id}-accion`} value={a} checked={accion === a} onChange={() => elegir(a)} className="sr-only" />
              {a === "si" ? frases.haDichoQueSi : frases.noSigue}
            </label>
          ))}
        </div>

        {accion === "si" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-importe`} className="text-[13px] leading-[18px] text-secundario">
                {frases.importeConSimbolo}
              </label>
              <input
                ref={campoImporte}
                id={`${id}-importe`}
                inputMode="numeric"
                autoComplete="off"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                aria-invalid={!!errores.importe}
                aria-describedby={errores.importe ? `${id}-error-importe` : undefined}
                className={`${ENTRADA} max-sm:h-11`}
              />
              {error("importe")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-cobrado`} className="text-[13px] leading-[18px] text-secundario">
                Señal cobrada (opcional)
              </label>
              <input
                id={`${id}-cobrado`}
                inputMode="numeric"
                autoComplete="off"
                value={cobrado}
                onChange={(e) => setCobrado(e.target.value)}
                aria-invalid={!!errores.cobrado}
                aria-describedby={errores.cobrado ? `${id}-error-cobrado` : undefined}
                className={`${ENTRADA} max-sm:h-11`}
              />
              {error("cobrado")}
            </div>
          </div>
        )}

        {accion === "no" && (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-1.5" aria-describedby={errores.motivo ? `${id}-error-motivo` : undefined}>
              <legend className="mb-1.5 text-[13px] leading-[18px] text-secundario">Motivo</legend>
              <div role="radiogroup" aria-invalid={!!errores.motivo} className="flex flex-wrap gap-1.5">
                {MOTIVOS_NO_SIGUE.map((m) => (
                  <label key={m} className={`${CHIP} h-8 max-sm:h-11`}>
                    <input
                      type="radio"
                      name={`${id}-motivo`}
                      value={m}
                      checked={motivo === m}
                      onChange={() => {
                        setMotivo(m);
                        setErrores((e) => ({ ...e, motivo: undefined }));
                      }}
                      aria-invalid={!!errores.motivo}
                      className="sr-only"
                    />
                    {m}
                  </label>
                ))}
              </div>
              {error("motivo")}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-nota`} className="text-[13px] leading-[18px] text-secundario">
                Nota (opcional)
              </label>
              <textarea
                id={`${id}-nota`}
                rows={2}
                maxLength={LIMITES.notaCierre}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                aria-invalid={!!errores.nota}
                aria-describedby={errores.nota ? `${id}-error-nota` : undefined}
                className={`${ENTRADA} h-auto resize-none py-2 text-[13px] leading-[18px]`}
              />
              {error("nota")}
            </div>
            {citaFutura && (
              <p className="text-[13px] leading-[18px] text-secundario">
                Si tenía {formas(cita).un} {cita.singular} pendiente, se anula y el hueco queda libre.
              </p>
            )}
          </div>
        )}

        {error("general")}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={cerrarDialogo}
            className="h-10 cursor-pointer rounded-[8px] border border-linea bg-white px-4 text-[14px] max-sm:h-11 transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={!accion || guardando}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-[8px] bg-tinta px-4 text-[14px] font-medium text-white max-sm:h-11 transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:bg-tinta/30"
          >
            {guardando && <LoaderCircle aria-hidden className="size-4 animate-spin" strokeWidth={1.75} />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/** El diálogo del cierre. El panel lo monta una vez, dentro de los proveedores. */
export function DialogoCierre(): JSX.Element | null {
  const datos = useSyncExternalStore(suscribir, leer, leerEnServidor);
  if (!datos || typeof document === "undefined") return null;
  return createPortal(<Formulario key={datos.vez} datos={datos} />, document.body);
}
