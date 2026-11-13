"use client";

import { Check, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as EventoTeclado,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ESTILOS } from "../campo-clave";

// Las piezas comunes de Ajustes: bloques, filas, el «Guardado» de al lado, campos que se guardan al
// salir, interruptores, opciones segmentadas, muestras de color, chips y el diálogo.

export type Resultado = { ok: true } | { ok: false; error: string; campo?: string };

// ─── Estilos compartidos ──────────────────────────────────────────────────────────────────────────

export const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta";
/** Lo que se lleva a la vista (un ancla, «Avanzado» al abrirlo) se para debajo de la barra de arriba, nunca tapado. */
export const MARGEN_ANCLA = "scroll-mt-32 lg:scroll-mt-24";
const ENTRADA_BASE =
  "rounded-[8px] border border-linea bg-white px-3 text-[14px] text-tinta outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-secundario/80 focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10 disabled:bg-lienzo disabled:text-secundario aria-invalid:border-error-texto/60";
export const ENTRADA = `h-10 max-lg:h-11 ${ENTRADA_BASE}`;
export const ENTRADA_PEQ = `h-9 max-lg:h-11 ${ENTRADA_BASE}`;
export const AREA =
  "w-full rounded-[8px] border border-linea bg-white px-3 py-2.5 text-[14px] leading-[21px] text-tinta outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-secundario/80 focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10 aria-invalid:border-error-texto/60";
export const BOTON = `inline-flex h-9 shrink-0 max-lg:min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-linea bg-white px-3.5 text-[13px] font-medium text-tinta transition-colors duration-150 ease-out hover:bg-lienzo disabled:cursor-default disabled:text-secundario/70 disabled:hover:bg-white ${FOCO}`;
export const BOTON_PRINCIPAL = `inline-flex h-9 shrink-0 max-lg:min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] bg-tinta px-3.5 text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black disabled:cursor-default disabled:bg-tinta/25 disabled:hover:bg-tinta/25 ${FOCO}`;
/** En el móvil, el enlace crece hacia arriba y abajo hasta el alto de un dedo sin mover nada. */
export const ENLACE = `cursor-pointer rounded-[4px] max-lg:-my-3 max-lg:py-3 text-[13px] font-medium text-tinta underline decoration-tinta/30 underline-offset-[3px] transition-colors duration-150 hover:decoration-tinta ${FOCO}`;
export const SELECT = `${ENTRADA} cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2716%27%20height%3D%2716%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27%236b6b6b%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpath%20d%3D%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-[length:16px_16px] bg-[position:right_10px_center] bg-no-repeat pr-9`;

/** Los estilos comunes de la puesta, Conexiones y el chat de prueba, con el alto de un dedo por debajo de 1024 px. */
export const ESTILOS_TOQUE = {
  ...ESTILOS,
  boton: `${ESTILOS.boton} max-lg:min-h-11`,
  botonSecundario: `${ESTILOS.botonSecundario} max-lg:min-h-11`,
  botonTexto: `${ESTILOS.botonTexto} max-lg:-my-3 max-lg:py-3`,
  campo: `${ESTILOS.campo} max-lg:min-h-11`,
} as const;

const NUMERO = new Intl.NumberFormat("es-ES", { useGrouping: "always" });

/** Cifras con el punto de los miles también en las de cuatro cifras: «4.000», «1.024». */
export function cifra(n: number): string {
  return NUMERO.format(n);
}

/** Si el sistema pide menos movimiento. */
export function menosMovimiento(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ─── El estado de guardado de un control ──────────────────────────────────────────────────────────

export interface Guardado {
  estado: "reposo" | "guardando" | "guardado";
  error: string | null;
  campo: string | null;
  idError: string;
  /** Ejecuta la escritura: «Guardando…», luego «Guardado» 2 s o el error. Devuelve si ha ido bien. */
  ejecutar(escribir: () => Promise<Resultado>): Promise<boolean>;
  fallar(error: string): void;
  limpiar(): void;
}

export function useGuardado(): Guardado {
  const idError = useId();
  const [estado, setEstado] = useState<Guardado["estado"]>("reposo");
  const [error, setError] = useState<string | null>(null);
  const [campo, setCampo] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turno = useRef(0);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const ejecutar = useCallback(async (escribir: () => Promise<Resultado>) => {
    const mio = ++turno.current;
    if (temporizador.current) clearTimeout(temporizador.current);
    setEstado("guardando");
    setError(null);
    setCampo(null);
    const r = await escribir();
    if (mio !== turno.current) return r.ok;
    if (!r.ok) {
      setEstado("reposo");
      setError(r.error);
      setCampo(r.campo ?? null);
      return false;
    }
    setEstado("guardado");
    temporizador.current = setTimeout(() => setEstado("reposo"), 2_000);
    return true;
  }, []);

  const fallar = useCallback((e: string) => {
    turno.current++;
    setEstado("reposo");
    setError(e);
    setCampo(null);
  }, []);

  const limpiar = useCallback(() => {
    setError(null);
    setCampo(null);
  }, []);

  return { estado, error, campo, idError, ejecutar, fallar, limpiar };
}

/** «Guardando…» en gris y luego «Guardado» con su ✓. Ocupa siempre su sitio: nada se mueve. */
export function EstadoGuardado({ g, className = "" }: { g: Pick<Guardado, "estado">; className?: string }): JSX.Element {
  return (
    <span aria-live="polite" className={`inline-flex h-5 min-w-[78px] shrink-0 items-center justify-end gap-1 text-[12px] leading-4 whitespace-nowrap ${className}`}>
      {g.estado === "guardando" && <span className="text-secundario">Guardando…</span>}
      {g.estado === "guardado" && (
        <span className="inline-flex items-center gap-1 font-medium text-ok-texto">
          <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
          Guardado
        </span>
      )}
    </span>
  );
}

/** El error del servidor, debajo del control. */
export function ErrorCampo({ id, error }: { id?: string; error: string | null }): JSX.Element | null {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="mt-2 text-[13px] leading-[18px] text-error-texto">
      {error}
    </p>
  );
}

export function Ayuda({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <p id={id} className={`text-[13px] leading-[18px] text-secundario ${className}`}>
      {children}
    </p>
  );
}

/** Una línea ámbar: algo que necesita tu atención. Con su punto, para no depender solo del color. */
export function LineaAtencion({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <p className={`flex items-start gap-2 text-[13px] leading-[18px] text-atencion-texto ${className}`}>
      <span aria-hidden className="mt-[6px] size-1.5 shrink-0 rounded-full bg-atencion" />
      <span>{children}</span>
    </p>
  );
}

// ─── Bloques y filas ──────────────────────────────────────────────────────────────────────────────

export function Bloque(p: { id: string; titulo: string; subtitulo?: string; children: ReactNode; tituloRef?: Ref<HTMLHeadingElement> }): JSX.Element {
  const idTitulo = `titulo-${p.id}`;
  return (
    <section id={p.id} aria-labelledby={idTitulo} className={`${MARGEN_ANCLA} rounded-[14px] border border-linea bg-white`}>
      <header className="px-6 pt-5 max-sm:px-4">
        <h2 id={idTitulo} ref={p.tituloRef} tabIndex={-1} className="rounded-[4px] text-[17px] leading-6 font-medium tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-tinta/15">
          {p.titulo}
        </h2>
        {p.subtitulo && <p className="mt-0.5 text-[13px] leading-[18px] text-secundario">{p.subtitulo}</p>}
      </header>
      <div className="divide-y divide-linea px-6 pb-1 max-sm:px-4">{p.children}</div>
    </section>
  );
}

/**
 * Una fila: la etiqueta (con su «Guardado» a la derecha), el control, la ayuda y el error. En «linea»,
 * etiqueta y ayuda a la izquierda y el control a la derecha.
 */
export function Fila(p: {
  etiqueta: ReactNode;
  /** El id del control, para el <label>. Sin él, la etiqueta es un texto con `idEtiqueta`. */
  para?: string;
  idEtiqueta?: string;
  ayuda?: ReactNode;
  idAyuda?: string;
  g?: Pick<Guardado, "estado" | "error" | "idError">;
  /** El error ya se pinta dentro del control (por campo). */
  sinError?: boolean;
  en?: "columna" | "linea";
  children: ReactNode;
  extra?: ReactNode;
}): JSX.Element {
  const etiqueta = p.para ? (
    <label id={p.idEtiqueta} htmlFor={p.para} className="text-[14px] leading-5 font-medium text-tinta">
      {p.etiqueta}
    </label>
  ) : (
    <span id={p.idEtiqueta} className="text-[14px] leading-5 font-medium text-tinta">
      {p.etiqueta}
    </span>
  );
  const ayuda = p.ayuda ? (
    <Ayuda id={p.idAyuda} className="mt-1">
      {p.ayuda}
    </Ayuda>
  ) : null;
  const error = !p.sinError && p.g ? <ErrorCampo id={p.g.idError} error={p.g.error} /> : null;

  if (p.en === "linea") {
    return (
      <div className="py-4">
        {/* Por debajo de 1024 px, la etiqueta encima y el control debajo. */}
        <div className="flex items-center justify-between gap-6 max-lg:flex-col max-lg:items-stretch max-lg:gap-3">
          <div className="min-w-0">
            {etiqueta}
            {ayuda}
          </div>
          <div className="flex shrink-0 items-center gap-3 max-lg:flex-row-reverse max-lg:justify-end">
            {p.g && <EstadoGuardado g={p.g} />}
            {p.children}
          </div>
        </div>
        {error}
        {p.extra}
      </div>
    );
  }
  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-4">
        {etiqueta}
        {p.g && <EstadoGuardado g={p.g} />}
      </div>
      <div className="mt-2 min-w-0">{p.children}</div>
      {ayuda && <div className="mt-2">{ayuda}</div>}
      {error}
      {p.extra}
    </div>
  );
}

// ─── Un texto que se guarda al salir ──────────────────────────────────────────────────────────────

/**
 * Un campo de texto que se guarda al salir de él (y con Enter si es de una línea). Si no ha cambiado,
 * no guarda. Mientras tiene el foco o texto sin guardar, una recarga no lo pisa. Con error, se queda
 * lo escrito.
 */
export function CampoTexto(p: {
  id: string;
  valor: string;
  guardar: (texto: string) => Promise<boolean>;
  g: Guardado;
  idAyuda?: string;
  multilinea?: boolean;
  filas?: number;
  tipo?: "text" | "url" | "tel";
  max?: number;
  placeholder?: string;
  inputMode?: "text" | "tel" | "url" | "numeric";
  className?: string;
  mono?: boolean;
  alCambiar?: (texto: string) => void;
  /** No guarda si el texto queda así (por ejemplo, vacío cuando no había nada). */
  ignorar?: (texto: string) => boolean;
}): JSX.Element {
  const [texto, setTexto] = useState(p.valor);
  const base = useRef(p.valor);
  const enfocado = useRef(false);

  // Una recarga trae otro valor: solo se pinta si no se está escribiendo ni hay algo sin guardar.
  useEffect(() => {
    if (p.valor === base.current) return;
    const sinGuardar = texto !== base.current;
    base.current = p.valor;
    if (!enfocado.current && !sinGuardar) setTexto(p.valor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.valor]);

  const confirmar = async () => {
    if (texto === base.current || p.ignorar?.(texto)) {
      if (texto === base.current) p.g.limpiar();
      return;
    }
    const enviado = texto;
    const bien = await p.guardar(enviado);
    if (bien) base.current = enviado;
  };

  const describe = [p.idAyuda, p.g.error ? p.g.idError : null].filter(Boolean).join(" ") || undefined;
  const comun = {
    id: p.id,
    value: texto,
    maxLength: p.max,
    placeholder: p.placeholder,
    spellCheck: p.mono ? false : undefined,
    "aria-describedby": describe,
    "aria-invalid": p.g.error ? true : undefined,
    onFocus: () => {
      enfocado.current = true;
    },
    onBlur: () => {
      enfocado.current = false;
      void confirmar();
    },
  } as const;

  if (p.multilinea) {
    return (
      <textarea
        {...comun}
        rows={p.filas ?? 3}
        onChange={(e) => {
          setTexto(e.target.value);
          p.alCambiar?.(e.target.value);
        }}
        className={`${AREA} resize-y ${p.mono ? "font-mono text-[13px]" : ""} ${p.className ?? ""}`}
      />
    );
  }
  return (
    <input
      {...comun}
      type={p.tipo ?? "text"}
      inputMode={p.inputMode}
      autoComplete="off"
      onChange={(e) => {
        setTexto(e.target.value);
        p.alCambiar?.(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void confirmar();
        }
      }}
      className={`${ENTRADA} w-full ${p.mono ? "font-mono text-[13px]" : ""} ${p.className ?? ""}`}
    />
  );
}

// ─── Interruptor ──────────────────────────────────────────────────────────────────────────────────

export function Interruptor(p: { id?: string; marcado: boolean; cambiar: (v: boolean) => void; idEtiqueta?: string; describe?: string; desactivado?: boolean }): JSX.Element {
  return (
    <button
      id={p.id}
      type="button"
      role="switch"
      aria-checked={p.marcado}
      aria-labelledby={p.idEtiqueta}
      aria-describedby={p.describe}
      disabled={p.desactivado}
      onClick={() => p.cambiar(!p.marcado)}
      className={`relative inline-flex h-6 w-[42px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-out disabled:cursor-default max-lg:after:absolute max-lg:after:-inset-2.5 max-lg:after:content-[''] ${
        p.marcado ? "bg-ok" : "bg-[#d5d4d0]"
      } ${FOCO}`}
    >
      <span
        aria-hidden
        className={`inline-block size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-out motion-reduce:transition-none ${
          p.marcado ? "translate-x-[20px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ─── Grupo de radio con flechas ───────────────────────────────────────────────────────────────────

/** Mueve el foco con las flechas entre los botones de un grupo (sin elegir: elegir es Enter o Espacio). */
export function moverConFlechas(e: EventoTeclado<HTMLElement>, elegirAlMover = false): void {
  const claves = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!claves.includes(e.key)) return;
  const grupo = e.currentTarget;
  const botones = [...grupo.querySelectorAll<HTMLButtonElement>("[role=radio]:not([disabled])")];
  if (botones.length === 0) return;
  e.preventDefault();
  const actual = botones.indexOf(document.activeElement as HTMLButtonElement);
  let siguiente = actual;
  if (e.key === "Home") siguiente = 0;
  else if (e.key === "End") siguiente = botones.length - 1;
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") siguiente = (actual + 1) % botones.length;
  else siguiente = (actual - 1 + botones.length) % botones.length;
  botones[siguiente].focus();
  if (elegirAlMover) botones[siguiente].click();
}

export function Segmentado<T extends string>(p: {
  opciones: { valor: T; texto: string; detalle?: string }[];
  valor: T;
  cambiar: (v: T) => void;
  idEtiqueta?: string;
  describe?: string;
  desactivado?: boolean;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-labelledby={p.idEtiqueta}
      aria-describedby={p.describe}
      onKeyDown={(e) => moverConFlechas(e, true)}
      className="inline-flex rounded-[9px] bg-fondo p-[3px] max-lg:flex max-lg:w-full max-lg:flex-wrap"
    >
      {p.opciones.map((o) => {
        const activo = o.valor === p.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            tabIndex={activo ? 0 : -1}
            disabled={p.desactivado}
            onClick={() => {
              if (!activo) p.cambiar(o.valor);
            }}
            className={`flex min-h-8 flex-col items-center justify-center rounded-[7px] px-3.5 py-1 text-[13px] leading-[18px] max-lg:min-h-11 max-lg:flex-1 transition-colors duration-150 ease-out ${FOCO} ${
              activo ? "cursor-default bg-white font-medium text-tinta shadow-[0_1px_2px_rgba(20,20,20,0.1)]" : "cursor-pointer text-secundario hover:text-tinta"
            }`}
          >
            <span>{o.texto}</span>
            {o.detalle && <span className="font-mono text-[11px] leading-[14px] font-normal text-secundario">{o.detalle}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Muestras de color ────────────────────────────────────────────────────────────────────────────

export function Muestras(p: {
  opciones: { valor: string | null; nombre: string; color: string }[];
  valor: string | null;
  cambiar: (v: string | null) => void;
  idEtiqueta?: string;
  describe?: string;
}): JSX.Element {
  const activa = p.opciones.find((o) => o.valor === p.valor) ?? p.opciones[0];
  return (
    <div className="flex items-center gap-4 max-lg:flex-wrap max-lg:gap-y-2">
      <div role="radiogroup" aria-labelledby={p.idEtiqueta} aria-describedby={p.describe} onKeyDown={(e) => moverConFlechas(e, true)} className="flex items-center gap-2.5 max-lg:flex-wrap">
        {p.opciones.map((o) => {
          const elegida = o === activa;
          return (
            <button
              key={o.nombre}
              type="button"
              role="radio"
              aria-checked={elegida}
              aria-label={o.nombre}
              title={o.nombre}
              tabIndex={elegida ? 0 : -1}
              onClick={() => {
                if (!elegida) p.cambiar(o.valor);
              }}
              className={`relative flex size-8 items-center justify-center rounded-full max-lg:size-11 ring-offset-2 transition-shadow duration-150 ease-out ${FOCO} ${
                elegida ? "cursor-default ring-2 ring-tinta" : "cursor-pointer ring-1 ring-black/10 hover:ring-2 hover:ring-black/25"
              }`}
              style={{ backgroundColor: o.color }}
            >
              {elegida && <Check aria-hidden className="size-4 text-white" strokeWidth={2.75} />}
            </button>
          );
        })}
      </div>
      <span aria-hidden className="text-[13px] leading-[18px] text-secundario">
        {activa.nombre}
      </span>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────────────────────────

export function Chips(p: { items: { clave: string; texto: string }[]; quitar: (clave: string) => void; mono?: boolean; vacio?: string; desactivado?: boolean }): JSX.Element {
  if (p.items.length === 0 && p.vacio) return <p className="text-[13px] leading-8 text-secundario">{p.vacio}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {p.items.map((i) => (
        <li key={i.clave} className="inline-flex h-8 items-center gap-0.5 rounded-full border border-linea bg-lienzo pr-1 pl-3 text-[13px] leading-[18px] text-tinta max-lg:h-11 max-lg:pr-0">
          <span className={p.mono ? "font-mono tabular-nums" : "tabular-nums"}>{i.texto}</span>
          <button
            type="button"
            aria-label={`Quitar «${i.texto}»`}
            disabled={p.desactivado}
            onClick={() => p.quitar(i.clave)}
            className={`flex size-6 cursor-pointer items-center justify-center rounded-full text-secundario max-lg:size-11 transition-colors duration-150 hover:bg-black/[0.06] hover:text-tinta disabled:cursor-default ${FOCO}`}
          >
            <X aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Diálogo ──────────────────────────────────────────────────────────────────────────────────────

const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Un diálogo modal en el body: fondo, foco dentro al abrir, Tab atrapado, Escape cierra y el foco
 * vuelve a quien lo abrió.
 */
export function Dialogo(p: {
  abierto: boolean;
  cerrar: () => void;
  titulo: string;
  rol?: "dialog" | "alertdialog";
  descripcion?: ReactNode;
  children?: ReactNode;
  acciones: ReactNode;
  /** El elemento que recibe el foco al abrir (si no, el primero que se pueda). */
  focoInicial?: RefObject<HTMLElement | null>;
}): JSX.Element | null {
  const caja = useRef<HTMLDivElement>(null);
  const abridor = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  const idDescripcion = useId();
  const cerrar = useRef(p.cerrar);
  cerrar.current = p.cerrar;

  useEffect(() => {
    if (!p.abierto) return;
    abridor.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Sin uno pedido, el primero que no sea la ✕ de cerrar (la casilla, el campo o «Cancelar»).
    const candidatos = [...(caja.current?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [])].filter((e) => !e.hasAttribute("data-cerrar"));
    const primero = p.focoInicial?.current ?? candidatos[0] ?? caja.current;
    primero?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar.current();
        return;
      }
      if (e.key !== "Tab" || !caja.current) return;
      const enfocables = [...caja.current.querySelectorAll<HTMLElement>(ENFOCABLES)];
      if (enfocables.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (e.shiftKey && (document.activeElement === primero || !caja.current.contains(document.activeElement))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (document.activeElement === ultimo || !caja.current.contains(document.activeElement))) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      const volver = abridor.current;
      if (volver && document.contains(volver)) volver.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.abierto]);

  if (!p.abierto || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30 px-4 max-lg:py-4" onMouseDown={(e) => e.target === e.currentTarget && p.cerrar()}>
      <div
        ref={caja}
        role={p.rol ?? "dialog"}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={p.descripcion ? idDescripcion : undefined}
        tabIndex={-1}
        className="w-full max-w-[440px] rounded-[16px] bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.18)] outline-none max-lg:max-h-[calc(100dvh-2rem)] max-lg:overflow-y-auto max-sm:p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={idTitulo} className="text-[18px] leading-6 font-medium tracking-[-0.01em]">
            {p.titulo}
          </h2>
          <button type="button" data-cerrar onClick={p.cerrar} aria-label="Cerrar" className={`-mt-1 -mr-2 flex size-8 cursor-pointer max-lg:-mt-2.5 max-lg:-mr-3 max-lg:size-11 items-center justify-center rounded-full text-secundario hover:bg-lienzo hover:text-tinta ${FOCO}`}>
            <X aria-hidden className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>
        {p.descripcion && (
          <p id={idDescripcion} className="mt-2 text-[14px] leading-5 text-secundario">
            {p.descripcion}
          </p>
        )}
        {p.children}
        {/* En el móvil, la acción principal arriba y a todo el ancho. */}
        <div className="mt-6 flex flex-wrap justify-end gap-2 max-lg:[&>*]:min-h-11 max-sm:flex-col-reverse max-sm:[&>*]:w-full max-sm:[&>*]:justify-center">{p.acciones}</div>
      </div>
    </div>,
    document.body,
  );
}
