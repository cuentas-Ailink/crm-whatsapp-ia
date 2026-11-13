"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX } from "react";
import type { EstadoClave, NombreClave } from "@/lib/api-tipos";
import { explicar, type CodigoError } from "@/lib/errores";
import { guardarClave, leerClaves } from "./api-sistema";

// Un campo para pegar una clave. Se comprueba en el servidor antes de guardarla y nunca se enseña de
// vuelta: solo cómo termina. El valor vive en el estado del campo hasta que se guarda, y nada más.

/** Las piezas comunes de la puesta en marcha, de Conexiones y de este campo. */
export const ESTILOS = {
  boton:
    "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-tinta px-4 text-[14px] leading-5 font-medium text-white transition-colors duration-200 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:bg-tinta/35",
  botonSecundario:
    "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-linea bg-white px-4 text-[14px] leading-5 font-medium text-tinta transition-colors duration-200 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:text-secundario disabled:hover:bg-white",
  botonTexto:
    "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] text-[14px] leading-5 font-medium text-tinta underline decoration-tinta/25 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:text-secundario disabled:no-underline",
  campo:
    "h-10 w-full min-w-0 rounded-[8px] border border-linea bg-white px-3 text-[14px] leading-5 text-tinta outline-none transition-colors duration-200 ease-out placeholder:text-secundario focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10 disabled:bg-lienzo disabled:text-secundario aria-[invalid=true]:border-error",
  etiqueta: "text-[14px] leading-5 font-medium text-tinta",
  ayuda: "text-[13px] leading-[18px] text-secundario",
  error: "text-[13px] leading-[18px] text-error-texto",
} as const;

/** Lo que se pone en un campo de clave para que nadie lo guarde, corrija ni recuerde. */
export const ATRIBUTOS_CLAVE = {
  type: "password",
  autoComplete: "off",
  spellCheck: false,
  autoCapitalize: "off",
  autoCorrect: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
} as const;

const VOZ: readonly NombreClave[] = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"];

/** «…abcd»: el servidor ya pone los puntos; si no vinieran, se añaden. */
export function terminacion(terminaEn: string): string {
  return terminaEn.startsWith("…") ? terminaEn : `…${terminaEn}`;
}

/** «{titulo}. {solucion}»: sin punto doble y, sin solución, el título solo. */
export function fraseDeError(e: { titulo: string; solucion: string }): string {
  const titulo = e.titulo.endsWith(".") ? e.titulo : `${e.titulo}.`;
  return e.solucion ? `${titulo} ${e.solucion}` : titulo;
}

/** La clave guardada que cuenta para este campo. Una clave de voz vale por cualquiera de las tres. */
function guardadaDe(claves: EstadoClave[], nombre: NombreClave): EstadoClave | null {
  const nombres = VOZ.includes(nombre) ? [nombre, ...VOZ.filter((n) => n !== nombre)] : [nombre];
  for (const n of nombres) {
    const c = claves.find((x) => x.nombre === n && x.guardada);
    if (c) return c;
  }
  return null;
}

/** «Guardada · termina en …abcd» con su botón «Cambiar». */
export function ClaveGuardada(p: { terminaEn: string; cambiar: () => void; etiqueta: string }): JSX.Element {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-2 text-[14px] leading-5 text-tinta">
        <Check aria-hidden className="size-4 text-ok-texto" strokeWidth={2.25} />
        Guardada · termina en <span className="font-mono text-[13px]">{terminacion(p.terminaEn)}</span>
      </span>
      <button type="button" onClick={p.cambiar} aria-label={`Cambiar ${p.etiqueta.toLowerCase()}`} className={ESTILOS.botonTexto}>
        Cambiar
      </button>
    </div>
  );
}

export function CampoClave(p: { nombre: NombreClave; etiqueta: string; ayuda?: string; alGuardar?: (terminaEn: string) => void }): JSX.Element {
  const { nombre, alGuardar } = p;
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const [leida, setLeida] = useState(false);
  const [guardada, setGuardada] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guardada pero sin poder usarse (Claude sin saldo): el mismo valor se vuelve a mandar con «Reintentar».
  const [reintentar, setReintentar] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    void leerClaves().then((claves) => {
      if (!montado.current) return;
      setGuardada(guardadaDe(claves, nombre)?.terminaEn ?? null);
      setLeida(true);
    });
    return () => {
      montado.current = false;
    };
  }, [nombre]);

  const guardar = async () => {
    const limpio = valor.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    setError(null);
    setNota(null);
    const r = await guardarClave(nombre, limpio);
    if (!montado.current) return;
    setEnviando(false);
    if (r.ok) {
      setValor("");
      setReintentar(false);
      setCambiando(false);
      setGuardada(r.terminaEn);
      setNota(r.nota ?? null);
      alGuardar?.(r.terminaEn);
      return;
    }
    const frase = r.codigo ? fraseDeError(explicar(r.codigo as CodigoError)) : r.error;
    setError(frase);
    setReintentar(r.guardada === true);
    entrada.current?.focus();
  };

  const mostrarGuardada = leida && guardada !== null && !cambiando;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={ESTILOS.etiqueta}>
        {p.etiqueta}
      </label>
      {p.ayuda && (
        <p id={idAyuda} className={ESTILOS.ayuda}>
          {p.ayuda}
        </p>
      )}
      {mostrarGuardada ? (
        <ClaveGuardada
          terminaEn={guardada}
          etiqueta={p.etiqueta}
          cambiar={() => {
            setCambiando(true);
            setNota(null);
            requestAnimationFrame(() => entrada.current?.focus());
          }}
        />
      ) : (
        <form
          className="mt-0.5 flex w-full gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            void guardar();
          }}
        >
          <input
            ref={entrada}
            id={id}
            {...ATRIBUTOS_CLAVE}
            value={valor}
            disabled={!leida}
            onChange={(evento) => {
              setValor(evento.target.value);
              // Otro valor: ya no es «Reintentar» con el de antes.
              if (reintentar) setReintentar(false);
            }}
            placeholder="Pega aquí tu clave"
            aria-invalid={error !== null}
            aria-describedby={[p.ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(" ") || undefined}
            className={`${ESTILOS.campo} min-w-0 flex-1 font-mono placeholder:font-sans`}
          />
          <button type="submit" disabled={!valor.trim() || enviando || !leida} className={ESTILOS.boton}>
            {enviando ? "Comprobando…" : reintentar ? "Reintentar" : "Guardar"}
          </button>
        </form>
      )}
      {error && !mostrarGuardada && (
        <p id={idError} role="alert" className={ESTILOS.error}>
          {error}
        </p>
      )}
      {nota && mostrarGuardada && <p className={ESTILOS.ayuda}>{nota}</p>}
    </div>
  );
}
