"use client";

import { Check, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type JSX, type ReactNode } from "react";
import { MAXIMO_PERMITIDOS, type EstadoModoPrueba } from "@/lib/modo-prueba-reglas";
import { qrSvg } from "@/lib/qr";
import { pedirRefrescoConexiones } from "@/lib/refresco-conexiones";
import { formatoTelefono } from "@/lib/regional";
import { ESTILOS } from "./campo-clave";
import { ESTILOS_TOQUE } from "./configuracion/controles";
import { confirmar } from "./confirmaciones";
import { avisarCambioDeConfiguracion } from "./datos";

// El «modo prueba» en el navegador: WhatsApp vinculado con un QR, no la vía oficial. La pantalla del
// QR y la lista de números permitidos (paso 3 de la puesta en marcha y Ajustes → Conexiones), y los
// botones de desvincular y de pasar a WhatsApp oficial. Todo habla con /api/modo-prueba.

const SIN_CONEXION = "Sin conexión con el servidor. Vuelve a intentarlo en un momento.";
const RELEER_MS = 2_000;

export const TEXTO_AVISO_PRUEBA =
  "Modo prueba: conectas WhatsApp escaneando un QR, como WhatsApp Web. No es la vía oficial y WhatsApp puede bloquear el número. Usa un número de pruebas, nunca el de un negocio ni tu número personal.";

type Resultado = { ok: true; estado: EstadoModoPrueba } | { ok: false; error: string; campo?: string };

async function pedir(cuerpo?: Record<string, unknown>): Promise<Resultado> {
  let respuesta: Response;
  try {
    respuesta =
      cuerpo === undefined
        ? await fetch("/api/modo-prueba", { cache: "no-store" })
        : await fetch("/api/modo-prueba", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store" });
  } catch {
    return { ok: false, error: SIN_CONEXION };
  }
  const datos = (await respuesta.json().catch(() => null)) as (EstadoModoPrueba & { error?: unknown; campo?: unknown }) | { ok: false; error?: unknown; campo?: unknown } | null;
  if (!respuesta.ok || !datos || datos.ok !== true) {
    const error = datos && typeof datos.error === "string" ? datos.error : `El servidor respondió ${respuesta.status}`;
    return { ok: false, error, ...(datos && typeof datos.campo === "string" ? { campo: datos.campo } : {}) };
  }
  return { ok: true, estado: datos };
}

export function accionModoPrueba(accion: "activar" | "preparar" | "permitidos" | "desvincular" | "oficial", extra: Record<string, unknown> = {}): Promise<Resultado> {
  return pedir({ accion, ...extra }).then((r) => {
    // El resto del panel (la línea de estado, Conexiones, la puesta en marcha) vuelve a mirar.
    if (r.ok) {
      avisarCambioDeConfiguracion();
      pedirRefrescoConexiones("modo-prueba");
    }
    return r;
  });
}

/** Lo que sabe el servidor del modo prueba; con `vigilar`, cada 2 s mientras la pestaña se ve (el QR cambia). */
export function useModoPrueba(vigilar: boolean): { estado: EstadoModoPrueba | null; error: string | null; poner: (e: EstadoModoPrueba) => void; releer: () => Promise<void> } {
  const [estado, setEstado] = useState<EstadoModoPrueba | null>(null);
  const [error, setError] = useState<string | null>(null);
  const montado = useRef(true);
  const vinculado = estado === null ? null : estado.puente.fase === "conectado";
  const vinculadoAntes = useRef<boolean | null>(null);

  // El móvil se acaba de vincular (o se ha soltado): la línea de estado vuelve a mirar al momento.
  useEffect(() => {
    if (vinculado === null) return;
    if (vinculadoAntes.current !== null && vinculadoAntes.current !== vinculado) pedirRefrescoConexiones("modo-prueba");
    vinculadoAntes.current = vinculado;
  }, [vinculado]);

  const releer = useCallback(async () => {
    const r = await pedir();
    if (!montado.current) return;
    if (r.ok) {
      setEstado(r.estado);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    montado.current = true;
    void releer();
    if (!vigilar) return () => void (montado.current = false);
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") void releer();
    }, RELEER_MS);
    return () => {
      montado.current = false;
      clearInterval(intervalo);
    };
  }, [releer, vigilar]);

  return { estado, error, poner: setEstado, releer };
}

/** El QR como imagen: el SVG va en un data: URL, nunca como HTML. */
function ImagenQr(p: { texto: string }): JSX.Element {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(p.texto, { tamaño: 512, margen: 2 }))}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Código QR para vincular el móvil de pruebas" width={232} height={232} className="size-[232px] shrink-0 rounded-[10px] border border-linea bg-white p-2 [image-rendering:pixelated]" />
  );
}

/** «Pasar a WhatsApp oficial»: se confirma (desvincula el móvil de pruebas) y luego `despues`. */
export function pasarAOficial(despues: () => void): void {
  confirmar("¿Pasar a WhatsApp oficial? Se desvincula el móvil de pruebas y se apaga el modo prueba.", {
    accion: {
      texto: "Pasar",
      hacer: () => {
        void accionModoPrueba("oficial").then((r) => {
          if (!r.ok) confirmar(r.error, { tono: "error" });
          else despues();
        });
      },
    },
  });
}

/** «Desvincular»: se confirma, cierra la sesión en el móvil y la borra de este ordenador. */
export function desvincular(despues?: () => void): void {
  confirmar("¿Desvincular el móvil de pruebas? Para volver a usarlo tendrás que escanear otra vez el QR.", {
    accion: {
      texto: "Desvincular",
      hacer: () => {
        void accionModoPrueba("desvincular").then((r) => {
          if (!r.ok) confirmar(r.error, { tono: "error" });
          else despues?.();
        });
      },
    },
  });
}

function Espera(p: { children: ReactNode }): JSX.Element {
  return (
    <p className="flex items-center gap-2.5 text-[14px] leading-5 text-secundario">
      <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-linea border-t-tinta motion-reduce:animate-none" />
      {p.children}
    </p>
  );
}

/** El móvil vinculado: prepararlo la primera vez, el QR, «Conectado» y desvincular. */
function Vinculo(p: { estado: EstadoModoPrueba; preparar: () => void; releer: () => Promise<void> }): JSX.Element {
  const { instalacion, puente } = p.estado;
  if (instalacion.fase === "instalando" || (instalacion.fase === "sin-instalar" && puente.fase === "parado")) {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <Espera>Preparando el modo prueba… solo la primera vez</Espera>
        <div className="h-1.5 w-full max-w-[360px] overflow-hidden rounded-full bg-linea" role="progressbar" aria-label="Preparando el modo prueba" aria-valuetext={instalacion.segundos !== null ? `${instalacion.segundos} s` : undefined}>
          <span className="block h-full w-1/3 animate-progreso rounded-full bg-tinta motion-reduce:animate-none" />
        </div>
        <p className={ESTILOS.ayuda}>{instalacion.segundos !== null ? `Lleva ${instalacion.segundos} s. Suele tardar menos de un minuto.` : "Suele tardar menos de un minuto."}</p>
      </div>
    );
  }
  if (instalacion.fase === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className={ESTILOS.error}>
          {instalacion.error ?? "No se ha podido preparar el modo prueba."}
        </p>
        <button type="button" onClick={p.preparar} className={`${ESTILOS_TOQUE.botonSecundario} h-9 px-3 text-[13px]`}>
          Reintentar
        </button>
      </div>
    );
  }
  if (puente.fase === "conectado") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[15px] leading-6 font-medium text-ok-texto">
          <Check aria-hidden className="size-4" strokeWidth={2.5} />
          <span className="tabular-nums">{`Conectado: ${puente.numero ?? "móvil de pruebas"}`}</span>
        </p>
        <button type="button" onClick={() => desvincular(() => void p.releer())} className={`${ESTILOS_TOQUE.botonTexto} text-[13px] font-normal text-secundario hover:text-tinta`}>
          Desvincular
        </button>
      </div>
    );
  }
  if (puente.fase === "qr" && puente.qr) {
    return (
      <div className="flex items-start gap-6 max-sm:flex-col max-sm:items-center">
        <ImagenQr texto={puente.qr} />
        <ol className="flex min-w-0 flex-col gap-3 text-[14px] leading-[21px] text-secundario max-sm:self-stretch">
          <li className="flex gap-3">
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-lienzo text-[12px] font-medium text-tinta">1</span>
            <span>
              En el móvil de pruebas: <span className="font-medium text-tinta">WhatsApp → Dispositivos vinculados → Vincular un dispositivo</span>
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-lienzo text-[12px] font-medium text-tinta">2</span>
            <span>Apunta la cámara a este código. Cambia cada poco: si caduca, sale otro solo.</span>
          </li>
        </ol>
      </div>
    );
  }
  if (puente.fase === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className={ESTILOS.error}>
          {puente.error ? `No se ha podido conectar con WhatsApp: ${puente.error}` : "No se ha podido conectar con WhatsApp."}
        </p>
        <button type="button" onClick={p.preparar} className={`${ESTILOS_TOQUE.botonSecundario} h-9 px-3 text-[13px]`}>
          Reintentar
        </button>
      </div>
    );
  }
  return <Espera>Conectando con WhatsApp…</Espera>;
}

/** «¿A qué números puede contestar tu asistente?»: al menos uno, con el formato del país del negocio. */
export function ListaPermitidos(p: { estado: EstadoModoPrueba; prefijo: string; poner: (e: EstadoModoPrueba) => void; alGuardar?: () => void; titulo?: boolean }): JSX.Element {
  const id = useId();
  const inicial = p.estado.permitidos.map((n) => formatoTelefono(n, p.prefijo));
  const [numeros, setNumeros] = useState<string[]>(inicial.length > 0 ? inicial : [""]);
  const [error, setError] = useState<{ texto: string; indice?: number } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const ejemplo = p.prefijo === "34" ? "612 345 678" : `+${p.prefijo} …`;

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    const r = await accionModoPrueba("permitidos", { numeros });
    setGuardando(false);
    if (!r.ok) {
      const indice = r.campo?.startsWith("numeros.") ? Number(r.campo.slice("numeros.".length)) : undefined;
      setError({ texto: r.error, ...(indice !== undefined && Number.isInteger(indice) ? { indice } : {}) });
      return;
    }
    p.poner(r.estado);
    setNumeros(r.estado.permitidos.map((n) => formatoTelefono(n, p.prefijo)));
    setGuardado(true);
    p.alGuardar?.();
  };

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      aria-labelledby={`${id}-titulo`}
      onSubmit={(evento) => {
        evento.preventDefault();
        if (!guardando) void guardar();
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-titulo`} className={p.titulo === false ? ESTILOS.etiqueta : "text-[16px] leading-6 font-medium text-tinta"}>
          ¿A qué números puede contestar tu asistente?
        </h3>
        <p className={ESTILOS.ayuda}>Solo a estos. Los demás chats del móvil vinculado no se leen, no se guardan y no se contestan.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {numeros.map((valor, i) => (
          <li key={i} className="flex items-center gap-2">
            <label htmlFor={`${id}-${i}`} className="sr-only">{`Número permitido ${i + 1}`}</label>
            <input
              id={`${id}-${i}`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={valor}
              placeholder={ejemplo}
              aria-invalid={error?.indice === i}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(evento) => {
                const otro = [...numeros];
                otro[i] = evento.target.value;
                setNumeros(otro);
                setGuardado(false);
                if (error?.indice === i) setError(null);
              }}
              className={`${ESTILOS_TOQUE.campo} max-w-[260px] tabular-nums max-sm:max-w-none`}
            />
            {numeros.length > 1 && (
              <button
                type="button"
                aria-label={`Quitar el número ${i + 1}`}
                onClick={() => {
                  setNumeros(numeros.filter((_, j) => j !== i));
                  setGuardado(false);
                  setError(null);
                }}
                className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-secundario transition-colors duration-200 ease-out hover:bg-lienzo hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-lg:size-11"
              >
                <X aria-hidden className="size-4" strokeWidth={1.75} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {numeros.length < MAXIMO_PERMITIDOS && (
        <div>
          <button type="button" onClick={() => setNumeros([...numeros, ""])} className={`${ESTILOS_TOQUE.botonTexto} text-[13px]`}>
            <Plus aria-hidden className="size-3.5" strokeWidth={2} />
            Añadir otro número
          </button>
        </div>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className={ESTILOS.error}>
          {error.texto}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={guardando} className={ESTILOS_TOQUE.boton}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {guardado && (
          <span aria-live="polite" className="flex items-center gap-1.5 text-[13px] leading-[18px] text-ok-texto">
            <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
            Guardado
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * El paso 3 en modo prueba: preparar (la primera vez), el QR, «Conectado» y la lista. `alListo` se
 * llama cuando hay móvil vinculado y al menos un número en la lista.
 */
export function VincularMovil(p: { prefijo: string; alListo: (listo: boolean) => void }): JSX.Element {
  const { estado, error, poner, releer } = useModoPrueba(true);
  const pedido = useRef(false);
  const { alListo } = p;

  const preparar = useCallback(() => {
    void accionModoPrueba("preparar").then((r) => {
      if (r.ok) poner(r.estado);
    });
  }, [poner]);

  // La primera vez que se ve: instala si hace falta y arranca el puente.
  useEffect(() => {
    if (!estado || pedido.current) return;
    if (estado.instalacion.fase !== "preparada" || estado.puente.fase === "parado") {
      pedido.current = true;
      preparar();
    }
  }, [estado, preparar]);

  const listo = !!estado && estado.puente.fase === "conectado" && estado.permitidos.length > 0;
  useEffect(() => {
    alListo(listo);
  }, [listo, alListo]);

  if (!estado) {
    return (
      <section className="min-w-0 rounded-[14px] border border-linea bg-white px-6 py-5 max-sm:px-4">
        {error ? (
          <p role="alert" className={ESTILOS.error}>
            {error}
          </p>
        ) : (
          <Espera>Comprobando…</Espera>
        )}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Móvil de pruebas" className="min-w-0 rounded-[14px] border border-linea bg-white px-6 py-5 max-sm:px-4">
        <Vinculo estado={estado} preparar={preparar} releer={releer} />
      </section>
      {estado.puente.fase === "conectado" && (
        <section className="min-w-0 rounded-[14px] border border-linea bg-white px-6 py-5 max-sm:px-4">
          <ListaPermitidos estado={estado} prefijo={p.prefijo} poner={poner} />
        </section>
      )}
    </div>
  );
}
