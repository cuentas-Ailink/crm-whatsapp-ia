"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CUERPO_GENERAL, CUERPOS_CONOCIDOS, LIMITES, textoPlantilla } from "@/lib/configuracion";
import { normalizarTelefono } from "@/lib/regional";
import { confirmar } from "./confirmaciones";
import { anadirCliente } from "./datos";
import { abrirCliente } from "./navegacion";
import { useNegocio } from "./negocio";
import { useEstado } from "./sistema";

// «+ Cliente»: dar de alta a mano a alguien que ha llamado o ha pasado por el local. Con su permiso,
// le sale el mismo mensaje de bienvenida que desde la web, y la tarjeta cuenta la llegada en directo.

type Prellenado = { nombre?: string; telefono?: string };

let abierto: { prellenado: Prellenado; vez: number } | null = null;
let veces = 0;
const oyentes = new Set<() => void>();

function avisar(): void {
  for (const oyente of oyentes) oyente();
}

/** Abre el diálogo, con el nombre o el móvil ya puestos si vienen (el ⌘K de Hoy). */
export function abrirAltaCliente(p?: { nombre?: string; telefono?: string }): void {
  abierto = { prellenado: { nombre: p?.nombre, telefono: p?.telefono }, vez: ++veces };
  avisar();
}

function cerrarAlta(): void {
  abierto = null;
  avisar();
}

function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

const leer = () => abierto;
const leerServidor = () => null;

const CAMPO =
  "h-10 w-full min-w-0 rounded-[8px] border border-linea bg-white px-3 text-[14px] max-lg:h-11 outline-none transition-colors duration-150 ease-out placeholder:text-secundario/70 focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10 aria-invalid:border-error";
const ENFOCABLES = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function DialogoAltaCliente(): JSX.Element | null {
  const estado = useSyncExternalStore(suscribir, leer, leerServidor);
  if (!estado) return null;
  return createPortal(<Dialogo key={estado.vez} prellenado={estado.prellenado} />, document.body);
}

function Dialogo({ prellenado }: { prellenado: Prellenado }) {
  const { cfg, frases, prefijo, formato } = useNegocio();
  const estadoApp = useEstado();
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  const campoNombre = useRef<HTMLInputElement>(null);
  const campoMovil = useRef<HTMLInputElement>(null);
  const anterior = useRef<Element | null>(null);

  const [nombre, setNombre] = useState(prellenado.nombre ?? "");
  const [telefono, setTelefono] = useState(prellenado.telefono ? formato.telefono(prellenado.telefono) : "");
  const [quiere, setQuiere] = useState("");
  const [permiso, setPermiso] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{ texto: string; campo?: string; leadId?: string } | null>(null);

  // Al abrir, el foco va al primer campo vacío; al cerrar, vuelve a donde estaba.
  useEffect(() => {
    anterior.current = document.activeElement;
    const primero = !prellenado.nombre ? campoNombre.current : !prellenado.telefono ? campoMovil.current : campoNombre.current;
    primero?.focus();
    return () => {
      const volver = anterior.current;
      if (volver instanceof HTMLElement && document.contains(volver)) volver.focus();
    };
  }, [prellenado]);

  const cuerpo = estadoApp?.configuracion.plantilla.texto ?? CUERPOS_CONOCIDOS[cfg.plantilla.nombre] ?? CUERPO_GENERAL;
  const bienvenida = textoPlantilla(nombre.trim() || "tu cliente", cfg.negocio.nombre, cuerpo);
  const ejemploMovil = prefijo === "34" ? "+34 612 345 678" : `+${prefijo} …`;

  const alPulsar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Solo este diálogo: la ficha de detrás escucha Escape en la ventana.
      e.stopPropagation();
      e.preventDefault();
      if (!enviando) cerrarAlta();
      return;
    }
    if (e.key !== "Tab" || !caja.current) return;
    const lista = Array.from(caja.current.querySelectorAll<HTMLElement>(ENFOCABLES));
    if (lista.length === 0) return;
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  const escribirMovil = (valor: string, alFinal: boolean) => {
    setTelefono(alFinal ? formato.telefono(valor) : valor);
    if (error?.campo === "telefono") setError(null);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const r = await anadirCliente({ nombre: nombre.trim(), telefono: telefono.trim(), ...(quiere.trim() ? { quiere: quiere.trim() } : {}), permiso });
    setEnviando(false);
    if (r.ok) {
      cerrarAlta();
      confirmar(r.enviado ? "Añadido: le hemos enviado tu mensaje de bienvenida" : "Añadido");
      return;
    }
    setError({ texto: r.error, campo: r.campo, leadId: r.leadId });
    if (r.campo === "nombre") campoNombre.current?.focus();
    else if (r.campo === "telefono") campoMovil.current?.focus();
  };

  const errorDe = (campo: string) =>
    error?.campo === campo ? (
      <p id={`${id}-${campo}-error`} role="alert" className="mt-1.5 text-[13px] leading-[18px] text-error-texto">
        {error.texto}
      </p>
    ) : null;
  const general = error && error.campo !== "nombre" && error.campo !== "telefono" ? error : null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-[10vh] max-lg:items-center max-lg:py-4"
      onMouseDown={() => !enviando && cerrarAlta()}
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={alPulsar}
        className="w-full max-w-[460px] rounded-[16px] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.22)] max-lg:max-h-[calc(100dvh-2rem)] max-lg:overflow-y-auto"
      >
        <form onSubmit={enviar} noValidate>
          <h2 id={`${id}-titulo`} className="px-6 pt-5 max-sm:px-5 text-[18px] leading-6 font-medium tracking-[-0.01em]">
            {frases.tituloNuevoCliente}
          </h2>

          <div className="flex flex-col gap-4 px-6 pt-4 pb-5 max-sm:px-5">
            <div>
              <label htmlFor={`${id}-nombre`} className="mb-1.5 block text-[13px] leading-[18px] font-medium">
                Nombre
              </label>
              <input
                ref={campoNombre}
                id={`${id}-nombre`}
                value={nombre}
                onChange={(e) => {
                  setNombre(e.target.value);
                  if (error?.campo === "nombre") setError(null);
                }}
                required
                maxLength={80}
                autoComplete="off"
                aria-invalid={error?.campo === "nombre" || undefined}
                aria-describedby={error?.campo === "nombre" ? `${id}-nombre-error` : undefined}
                className={CAMPO}
              />
              {errorDe("nombre")}
            </div>

            <div>
              <label htmlFor={`${id}-movil`} className="mb-1.5 block text-[13px] leading-[18px] font-medium">
                Móvil
              </label>
              <input
                ref={campoMovil}
                id={`${id}-movil`}
                value={telefono}
                inputMode="tel"
                autoComplete="off"
                placeholder={ejemploMovil}
                onChange={(e) => {
                  const campo = e.target;
                  escribirMovil(campo.value, campo.selectionStart === campo.value.length);
                }}
                onBlur={() => {
                  const n = normalizarTelefono(telefono, prefijo);
                  if (n) setTelefono(formato.telefono(`+${n}`));
                }}
                aria-invalid={error?.campo === "telefono" || undefined}
                aria-describedby={error?.campo === "telefono" ? `${id}-telefono-error` : undefined}
                className={`${CAMPO} tabular-nums`}
              />
              {errorDe("telefono")}
            </div>

            <div>
              <label htmlFor={`${id}-quiere`} className="mb-1.5 block text-[13px] leading-[18px] font-medium">
                Qué quiere <span className="font-normal text-secundario">(opcional)</span>
              </label>
              <input
                id={`${id}-quiere`}
                value={quiere}
                onChange={(e) => setQuiere(e.target.value)}
                maxLength={LIMITES.quiere}
                autoComplete="off"
                className={CAMPO}
              />
            </div>

            <div>
              <label className="flex cursor-pointer items-start gap-2.5 text-[14px] leading-5 max-lg:py-1">
                <input
                  type="checkbox"
                  checked={permiso}
                  onChange={(e) => setPermiso(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-tinta"
                />
                Me ha dado permiso para escribirle por WhatsApp
              </label>
              {permiso && (
                <p className="mt-2 ml-[26px] rounded-[8px] bg-lienzo px-3 py-2 text-[13px] leading-[18px] text-secundario">
                  Le llegará tu mensaje de bienvenida: «{bienvenida}»
                </p>
              )}
            </div>
          </div>

          {general && (
            <div role="alert" className="mx-6 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] text-error-texto max-sm:mx-5">
              <span>{general.texto}</span>
              {general.leadId && (
                <button
                  type="button"
                  onClick={() => {
                    const leadId = general.leadId as string;
                    cerrarAlta();
                    abrirCliente(leadId);
                  }}
                  className="cursor-pointer font-medium text-tinta underline underline-offset-2 hover:no-underline max-lg:-my-3 max-lg:py-3"
                >
                  Abrir su ficha
                </button>
              )}
            </div>
          )}

          {/* En el móvil, «Añadir» arriba y a todo el ancho. */}
          <div className="flex flex-wrap justify-end gap-2 border-t border-linea px-6 py-4 max-sm:flex-col-reverse max-sm:px-5 max-sm:[&>button]:w-full">
            <button
              type="button"
              onClick={cerrarAlta}
              disabled={enviando}
              className="h-9 cursor-pointer rounded-[8px] px-3.5 text-[14px] text-tinta/80 max-lg:min-h-11 transition-colors duration-150 ease-out hover:bg-lienzo hover:text-tinta disabled:cursor-default disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="h-9 min-w-[96px] cursor-pointer rounded-[8px] bg-tinta max-lg:min-h-11 px-4 text-[14px] font-medium text-white transition-opacity duration-150 ease-out hover:opacity-90 disabled:cursor-default disabled:opacity-60"
            >
              {enviando ? "Añadiendo…" : "Añadir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
