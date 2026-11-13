"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fechaEn } from "@/lib/agenda";
import { etiquetaDia, textoCitaParaCliente } from "@/lib/cita";
import { ventana24h } from "@/lib/hilo";
import { esEjemplo } from "@/lib/negocio";
import type { Hueco, Lead } from "@/lib/tipos";
import { cap, concordar } from "@/lib/vocabulario";
import { confirmar } from "./confirmaciones";
import { desfaseServidor } from "./datos";
import { useNegocio } from "./negocio";

// Dar o cambiar una cita a mano desde la ficha: los huecos libres de verdad (los mismos que puede
// ofrecer el asistente), agrupados por día, y si se puede, la cita al cliente por WhatsApp. Lo abre la
// pastilla de la etapa; Escape lo cierra y el foco vuelve a la pastilla.

// ─── Peticiones (las rutas de la cita y de retomar no tienen envoltorio en datos.ts) ──────────────

const SIN_CONEXION = "Sin conexión con el servidor. Vuelve a intentarlo en un momento.";

type Datos = Record<string, unknown>;
export type RespuestaApi = { ok: true; datos: Datos } | { ok: false; status: number; error: string; datos: Datos | null };

/** GET sin cuerpo y POST con JSON. Sin sesión (modo servidor), a la pantalla de entrar y de vuelta aquí. */
export async function pedirApi(url: string, cuerpo?: unknown): Promise<RespuestaApi> {
  let respuesta: Response;
  try {
    respuesta =
      cuerpo === undefined
        ? await fetch(url, { cache: "no-store" })
        : await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store" });
  } catch {
    return { ok: false, status: 0, error: SIN_CONEXION, datos: null };
  }
  const leidos = (await respuesta.json().catch(() => null)) as unknown;
  const datos = typeof leidos === "object" && leidos !== null && !Array.isArray(leidos) ? (leidos as Datos) : null;
  if (respuesta.status === 401 && datos?.codigo === "sesion") {
    location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
  }
  if (!respuesta.ok || !datos) {
    return { ok: false, status: respuesta.status, error: typeof datos?.error === "string" ? datos.error : `El servidor respondió ${respuesta.status}`, datos };
  }
  return { ok: true, datos };
}

/** Anula la cita futura del cliente. Devuelve el error o null. */
export async function anularCita(leadId: string): Promise<string | null> {
  const r = await pedirApi("/api/cita", { leadId, accion: "anular" });
  return r.ok ? null : r.error;
}

// ─── Estilos compartidos por los diálogos de la ficha ────────────────────────────────────────────

/** El fondo y la caja de un diálogo de la ficha: cabe en el móvil (margen de 1 rem y desplazamiento dentro). */
export const FONDO_DIALOGO = "fixed inset-0 z-[65] flex items-start justify-center p-4 pt-[10vh] max-sm:items-center max-sm:pt-4";
// La altura cuenta el hueco de arriba del fondo (10vh): con 100dvh entera, en una pantalla de 900 px los
// botones del pie quedaban debajo del borde y no se podía llegar a ellos.
export const CAJA_DIALOGO =
  "relative flex max-h-[calc(90dvh-1rem)] max-sm:max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-[14px] bg-white p-6 shadow-[0_16px_48px_rgba(0,0,0,0.18)] max-sm:p-5";
export const BOTON_PRIMARIO =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-tinta px-4 text-[14px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:bg-tinta/30 max-sm:h-11";
export const BOTON_SECUNDARIO_DIALOGO =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-[8px] border border-linea bg-white px-4 text-[14px] transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-sm:h-11";

/** Escape cierra solo este diálogo (no la ficha de detrás) y el tabulador da la vuelta dentro. */
export function teclasDeDialogo(ref: { readonly current: HTMLElement | null }, cerrar: () => void) {
  return (evento: KeyboardEvent<HTMLElement>) => {
    const caja = ref.current;
    if (evento.key === "Escape") {
      evento.stopPropagation();
      evento.preventDefault();
      cerrar();
      return;
    }
    if (evento.key !== "Tab" || !caja) return;
    const enfocables = [...caja.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href], textarea:not([disabled])")].filter((n) => {
      if (n.getClientRects().length === 0) return false;
      // Los radios de un grupo cuentan como uno: el marcado (o el primero).
      if (!(n instanceof HTMLInputElement) || n.type !== "radio") return true;
      const grupo = [...caja.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(n.name)}"]`)];
      const marcado = grupo.find((g) => g.checked);
      return marcado ? n === marcado : n === grupo[0];
    });
    if (enfocables.length === 0) return;
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;
    if (evento.shiftKey && (activo === primero || !caja.contains(activo) || activo === caja.querySelector("h2"))) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  };
}

// ─── El selector ─────────────────────────────────────────────────────────────────────────────────

const CHIP_HORA =
  "flex h-9 min-w-[64px] cursor-pointer items-center justify-center rounded-[8px] border border-linea bg-white px-3 text-[13px] leading-[18px] tabular-nums transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta aria-pressed:border-tinta aria-pressed:bg-tinta aria-pressed:text-white max-sm:h-11";

interface Dia { fecha: string; huecos: Hueco[] }

function porDia(huecos: Hueco[]): Dia[] {
  const dias: Dia[] = [];
  for (const h of huecos) {
    const fecha = h.id.slice(0, 10);
    const ultimo = dias[dias.length - 1];
    if (ultimo?.fecha === fecha) ultimo.huecos.push(h);
    else dias.push({ fecha, huecos: [h] });
  }
  return dias;
}

export function SelectorCita({ lead, accion, cerrar, refrescar }: {
  lead: Lead;
  accion: "dar" | "cambiar";
  cerrar: () => void;
  refrescar?: () => Promise<void>;
}): JSX.Element {
  const { cfg, frases, zona } = useNegocio();
  const id = useId();
  const v = cfg.vocabulario;
  const [huecos, setHuecos] = useState<Hueco[] | null>(null);
  const [mas, setMas] = useState(false);
  const [trato, setTrato] = useState<"tu" | "usted" | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [elegido, setElegido] = useState<Hueco | null>(null);
  const [enviar, setEnviar] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);

  const leer = useCallback(
    async (desde?: string) => {
      const r = await pedirApi(`/api/cita/huecos?leadId=${encodeURIComponent(lead.id)}${desde ? `&desde=${encodeURIComponent(desde)}` : ""}`);
      if (!r.ok) {
        setError(r.error);
        if (r.status === 404) void refrescar?.();
        return;
      }
      const nuevos = Array.isArray(r.datos.huecos) ? (r.datos.huecos as Hueco[]) : [];
      setHuecos((antes) => (desde ? [...(antes ?? []), ...nuevos] : nuevos));
      setMas(r.datos.mas === true);
      if (r.datos.trato === "tu" || r.datos.trato === "usted") setTrato(r.datos.trato);
    },
    [lead.id, refrescar],
  );

  useEffect(() => {
    titulo.current?.focus();
    void leer();
  }, [leer]);

  const ahora = Date.now() + desfaseServidor();
  const hoy = fechaEn(new Date(ahora), zona).fecha;
  const ejemplo = esEjemplo(lead);
  const silenciado = !!lead.silenciadoEn;
  const abierta = ventana24h(lead, ahora).abierta;
  const conCasilla = !ejemplo && !silenciado && abierta;

  const verMas = async () => {
    const ultimo = huecos?.at(-1);
    if (!ultimo || cargandoMas) return;
    setCargandoMas(true);
    await leer(ultimo.id);
    setCargandoMas(false);
  };

  const guardar = async () => {
    if (!elegido || guardando) return;
    setGuardando(true);
    setError(null);
    const r = await pedirApi("/api/cita", { leadId: lead.id, accion, huecoId: elegido.id, ...(conCasilla ? { enviar } : {}) });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      if (r.status === 404) void refrescar?.();
      // Otro (el asistente, otra pestaña) acaba de coger ese hueco: la lista se vuelve a pedir.
      if (r.error === "Ese hueco ya está ocupado") {
        setElegido(null);
        void leer();
      }
      return;
    }
    cerrar();
    const aviso = typeof r.datos.aviso === "string" ? r.datos.aviso : null;
    if (aviso) confirmar(aviso, { ms: 6000 });
    else confirmar(`${cap(v.cita.singular)} ${concordar(v.cita, accion === "dar" ? "reservad" : "cambiad")}${r.datos.enviado === true ? " · WhatsApp enviado" : ""}`);
    void refrescar?.();
  };

  const tituloTexto = accion === "dar" ? "Dar cita" : "Cambiar cita";
  const nota = "text-[13px] leading-[18px] text-secundario";

  return createPortal(
    <div className={FONDO_DIALOGO}>
      <div aria-hidden className="absolute inset-0 bg-black/25" onClick={cerrar} />
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-busy={guardando}
        onKeyDown={teclasDeDialogo(caja, cerrar)}
        className={`${CAJA_DIALOGO} w-[min(480px,calc(100vw-2rem))] gap-4`}
      >
        <div>
          <h2 ref={titulo} id={`${id}-titulo`} tabIndex={-1} className="text-[17px] leading-6 font-medium outline-none">
            {tituloTexto}
          </h2>
          <p className="mt-0.5 text-[13px] leading-[18px] text-secundario break-words">{lead.nombre}</p>
          {accion === "cambiar" && lead.visita && <p className="mt-2 text-[14px] leading-5">Ahora: {lead.visita.texto}</p>}
        </div>

        {huecos === null ? (
          !error && (
            <p className={`${nota} flex items-center gap-2`}>
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
              Buscando huecos libres…
            </p>
          )
        ) : huecos.length === 0 ? (
          <p className="text-[14px] leading-5">No hay huecos libres en tu horario. Cámbialo en Ajustes → Horario de citas.</p>
        ) : (
          <div className="-mx-1 flex min-h-[132px] flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-0.5">
            {porDia(huecos).map((d) => {
              const etiqueta = etiquetaDia(d.fecha, hoy);
              return (
                <div key={d.fecha} role="group" aria-label={etiqueta} className="flex flex-col gap-1.5">
                  <p className="text-[12px] leading-4 font-medium text-secundario">{etiqueta}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {d.huecos.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        aria-pressed={elegido?.id === h.id}
                        aria-label={h.texto}
                        onClick={() => {
                          setElegido(h);
                          setError(null);
                        }}
                        className={CHIP_HORA}
                      >
                        {h.id.slice(11)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {mas && (
              <button type="button" onClick={() => void verMas()} disabled={cargandoMas} className={`${BOTON_SECUNDARIO_DIALOGO} shrink-0 self-start disabled:cursor-wait`}>
                {cargandoMas ? "Buscando…" : "Ver más días"}
              </button>
            )}
          </div>
        )}

        {ejemplo ? (
          <p className={nota}>Contacto de ejemplo: los mensajes no salen por WhatsApp</p>
        ) : silenciado ? (
          <p className={nota}>Ha pedido que no le escribamos por WhatsApp: avísale tú.</p>
        ) : !abierta ? (
          <p className={nota}>La ventana de 24 h está cerrada: avísale tú o retoma con un mensaje aprobado.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px] leading-5 sm:min-h-0">
              <input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} className="size-4 shrink-0 cursor-pointer accent-tinta" />
              Enviarle la cita por WhatsApp
            </label>
            {enviar && elegido && trato && (
              <p className="rounded-[10px] bg-lienzo px-3 py-2 text-[13px] leading-[18px] break-words">
                <span className="text-secundario">Le llegará: </span>«{textoCitaParaCliente(elegido, { vocabulario: v, nombre: lead.nombre, trato })}»
              </p>
            )}
          </div>
        )}

        {lead.estado === "persona" && <p className="text-[13px] leading-[18px] text-atencion-texto">{`Pasa a «${frases.conCita}»: tu asistente le volverá a contestar.`}</p>}

        {error && (
          <p role="alert" className="text-[13px] leading-[18px] text-error-texto">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO_DIALOGO}>
            Cancelar
          </button>
          <button type="button" onClick={() => void guardar()} disabled={!elegido || guardando} className={BOTON_PRIMARIO}>
            {guardando && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />}
            {guardando ? "Guardando…" : tituloTexto}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
