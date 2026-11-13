"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type JSX } from "react";
import type { PeticionPrueba, ResultadoPrueba } from "@/lib/api-tipos";
import { CUERPO_GENERAL, textoPlantilla } from "@/lib/configuracion";
import { accionesDe, aplicarPrueba } from "@/lib/prueba";
import { probarAsistente } from "./api-sistema";
import { ESTILOS } from "./campo-clave";
import { ESTILOS_TOQUE } from "./configuracion/controles";
import { useNegocio } from "./negocio";
import { useEstado } from "./sistema";

// «Probar tu asistente»: una conversación inventada que pasa por las mismas puertas que un mensaje de
// verdad, pero no envía, no guarda y no avisa. La misma pieza en Ajustes y en el paso 2 de la puesta.

type Prueba = PeticionPrueba["prueba"];
type Origen = Prueba["origen"];
type Accion = { texto: string; tono: "normal" | "aviso" | "error" };

const MAXIMO_CLIENTE = 30;
const NOMBRE_PRUEBA = "Laura";

const NOMBRES_MODELO: Record<string, string> = {
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
};

const COSTE = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const TONO_ACCION: Record<Accion["tono"], string> = {
  normal: "border-linea text-secundario",
  aviso: "border-atencion/35 text-atencion-texto",
  error: "border-error/35 text-error-texto",
};

function inicial(origen: Origen, negocio: string, cuerpo: string): Prueba {
  return {
    origen,
    nombre: NOMBRE_PRUEBA,
    estado: "nuevo",
    mensajes: origen === "formulario" ? [{ de: "agente", texto: textoPlantilla(NOMBRE_PRUEBA, negocio, cuerpo), ts: Date.now(), plantilla: true }] : [],
    datos: {},
    huecosOfrecidos: [],
  };
}

/** Lo que se ve debajo de cada turno: qué haría el asistente y las notas de la prueba. */
interface Turno {
  /** Índice del último mensaje del turno: la respuesta o, si no contesta, el mensaje del cliente. */
  tras: number;
  acciones: Accion[];
}

export function ChatDePrueba(p: { origen?: "formulario" | "whatsapp"; alContestar?: (r: ResultadoPrueba) => void }): JSX.Element {
  const { alContestar } = p;
  const estado = useEstado();
  const { cfg } = useNegocio();
  const negocio = estado?.configuracion.negocio.nombre ?? cfg.negocio.nombre;
  const cuerpo = estado?.configuracion.plantilla.texto ?? CUERPO_GENERAL;
  const id = useId();

  // Con el botón de WhatsApp en la web, lo normal es que te escriban por WhatsApp: se prueba así de entrada.
  const deEntrada: Origen = p.origen ?? (cfg.web.entrada === "whatsapp" ? "whatsapp" : "formulario");
  const [origen, setOrigen] = useState<Origen>(deEntrada);
  const [prueba, setPrueba] = useState<Prueba>(() => inicial(deEntrada, negocio, cuerpo));
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [resultados, setResultados] = useState<ResultadoPrueba[]>([]);
  const [texto, setTexto] = useState("");
  const [esperando, setEsperando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  // Cada vez que se empieza de nuevo cambia: una respuesta de una conversación anterior no cuenta.
  const generacion = useRef(0);
  const lista = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);

  const deCliente = prueba.mensajes.filter((m) => m.de === "cliente").length;
  const lleno = deCliente >= MAXIMO_CLIENTE;

  const empezar = useCallback(
    (o: Origen) => {
      generacion.current++;
      setOrigen(o);
      setPrueba(inicial(o, negocio, cuerpo));
      setTurnos([]);
      setResultados([]);
      setError(null);
      setEsperando(false);
      setAnuncio("");
    },
    [negocio, cuerpo],
  );

  // El mensaje de bienvenida sigue al negocio mientras la clienta aún no ha escrito nada.
  useEffect(() => {
    setPrueba((actual) => {
      if (actual.mensajes.some((m) => m.de === "cliente")) return actual;
      const nueva = inicial(actual.origen, negocio, cuerpo);
      return nueva.mensajes[0]?.texto === actual.mensajes[0]?.texto ? actual : nueva;
    });
  }, [negocio, cuerpo]);

  useEffect(() => () => void generacion.current++, []);

  // Lo último, siempre a la vista, dentro de la caja de la conversación (la página no se mueve).
  useEffect(() => {
    const caja = lista.current;
    if (caja) caja.scrollTop = caja.scrollHeight;
  }, [prueba.mensajes.length, esperando, turnos.length]);

  const enviar = async () => {
    const limpio = texto.trim();
    if (!limpio || esperando || lleno) return;
    const propia = generacion.current;
    const conCliente: Prueba = { ...prueba, mensajes: [...prueba.mensajes, { de: "cliente", texto: limpio, ts: Date.now() }] };
    setPrueba(conCliente);
    setTexto("");
    setError(null);
    setEsperando(true);
    const r = await probarAsistente({ prueba: conCliente });
    if (propia !== generacion.current) return;
    setEsperando(false);
    if ("error" in r) {
      // El mensaje se queda: sale otra vez con el siguiente.
      setError(r.error);
      requestAnimationFrame(() => entrada.current?.focus());
      return;
    }
    const siguiente = aplicarPrueba(conCliente, r.mutaciones);
    const anadidos = siguiente.mensajes.slice(conCliente.mensajes.length);
    if (r.texto !== null && !anadidos.some((m) => m.de === "agente" && m.texto === r.texto)) {
      siguiente.mensajes.push({ de: "agente", texto: r.texto, ts: Date.now() });
    }
    const acciones: Accion[] = accionesDe(r, cfg.vocabulario);
    for (const nota of r.notas) if (!acciones.some((a) => a.texto === nota)) acciones.push({ texto: nota, tono: "normal" });
    setPrueba(siguiente);
    setTurnos((t) => [...t, { tras: siguiente.mensajes.length - 1, acciones }]);
    setResultados((lista) => [...lista, r]);
    setAnuncio(r.texto !== null ? `Tu asistente: ${r.texto}` : (acciones[0]?.texto ?? "Tu asistente no contestaría"));
    alContestar?.(r);
    requestAnimationFrame(() => entrada.current?.focus());
  };

  const respuestas = resultados.filter((r) => r.texto !== null).length;
  const coste = resultados.reduce((total, r) => total + r.costeUsd, 0);
  const ultimoModelo = resultados.at(-1)?.modelo ?? "";

  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] border border-linea bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-linea px-4 py-3">
        <p className="text-[13px] leading-[18px] text-secundario">Escríbele como si fueras un cliente. No se envía nada por WhatsApp.</p>
        <div className="flex items-center gap-2 max-lg:flex-wrap">
          <span id={`${id}-empieza`} className="text-[13px] leading-[18px] text-secundario">
            Empieza por:
          </span>
          <div role="group" aria-labelledby={`${id}-empieza`} className="flex rounded-[8px] bg-fondo p-0.5">
            {(["formulario", "whatsapp"] as const).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={origen === o}
                onClick={() => {
                  if (origen !== o) empezar(o);
                }}
                className={`h-7 rounded-[6px] px-3 text-[13px] max-lg:min-h-11 max-lg:px-4 leading-[18px] transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tinta ${
                  origen === o ? "cursor-default bg-white font-medium shadow-[0_1px_2px_rgba(20,20,20,0.08)]" : "cursor-pointer text-secundario hover:text-tinta"
                }`}
              >
                {o === "formulario" ? "Formulario" : "WhatsApp"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Crece con la conversación: vacía, solo la invitación; larga, se desplaza por dentro. */}
      {/* Con el teclado del móvil abierto, la conversación encoge y el campo sigue a la vista. */}
      <div ref={lista} className="flex max-h-[420px] min-h-[96px] flex-col max-lg:max-h-[min(420px,50dvh)] gap-3 overflow-y-auto bg-lienzo/60 px-4 py-4">
        {prueba.mensajes.length === 0 && !esperando && (
          <p className="m-auto max-w-[320px] text-center text-[13px] leading-[18px] text-secundario">
            Escribe lo primero que te mandaría un cliente por WhatsApp, por ejemplo «Hola, ¿tenéis cita esta semana?».
          </p>
        )}
        {prueba.mensajes.map((m, i) => {
          const turno = turnos.find((t) => t.tras === i);
          return (
            <div key={i} className="flex flex-col gap-1.5">
              <Burbuja de={m.de} texto={m.texto} plantilla={m.plantilla === true} />
              {turno && turno.acciones.length > 0 && (
                <ul className={`flex flex-wrap gap-1.5 ${m.de === "cliente" ? "justify-end" : ""}`}>
                  {turno.acciones.map((a) => (
                    <li key={a.texto} className={`rounded-full border bg-white px-2.5 py-0.5 text-[12px] leading-[18px] ${TONO_ACCION[a.tono]}`}>
                      {a.texto}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {prueba.mensajes.length > 0 && deCliente === 0 && !esperando && (
          <p className="text-center text-[13px] leading-[18px] text-secundario">Contéstale como lo haría un cliente.</p>
        )}
        {esperando && (
          <div className="flex flex-col items-start gap-1">
            <span className="px-1 text-[12px] leading-4 text-secundario">Tu asistente</span>
            <span className="inline-flex items-center gap-2 rounded-[14px] rounded-tl-[4px] border border-linea bg-white px-3.5 py-2.5 text-[13px] leading-[18px] text-secundario">
              <span aria-hidden className="flex gap-1">
                {[0, 1, 2].map((n) => (
                  <span
                    key={n}
                    className="size-1.5 animate-escribiendo rounded-full bg-secundario motion-reduce:animate-none motion-reduce:opacity-60"
                    style={{ animationDelay: `${n * 160}ms` }}
                  />
                ))}
              </span>
              escribiendo…
            </span>
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {anuncio}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-linea px-4 py-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
      >
        {error && (
          <p role="alert" className={ESTILOS.error}>
            {error}
          </p>
        )}
        {lleno && <p className="text-[13px] leading-[18px] text-secundario">Has llegado al máximo: empieza de nuevo</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={entrada}
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
                evento.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            maxLength={1000}
            disabled={esperando || lleno}
            aria-label="Tu mensaje"
            placeholder="Escribe como lo haría un cliente"
            className={`${ESTILOS_TOQUE.campo} h-auto min-h-10 resize-none py-2.5 [field-sizing:content] max-h-[120px]`}
          />
          <button type="submit" disabled={!texto.trim() || esperando || lleno} className={`${ESTILOS_TOQUE.boton} max-lg:px-3`}>
            Enviar
          </button>
        </div>
      </form>

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-linea px-4 py-2.5">
        <p className="text-[12px] leading-4 text-secundario tabular-nums">
          {resultados.length > 0
            ? `Esta prueba: ${respuestas} ${respuestas === 1 ? "respuesta" : "respuestas"} · ${COSTE.format(coste)} $ · ${NOMBRES_MODELO[ultimoModelo] ?? ultimoModelo}`
            : ""}
        </p>
        <button type="button" onClick={() => empezar(origen)} className={`${ESTILOS_TOQUE.botonTexto} text-[13px] leading-[18px]`}>
          <RotateCcw aria-hidden className="size-3.5" strokeWidth={2} />
          Empezar de nuevo
        </button>
      </div>
    </div>
  );
}

function Burbuja(p: { de: "cliente" | "agente"; texto: string; plantilla: boolean }): JSX.Element {
  if (p.de === "cliente") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="px-1 text-[12px] leading-4 text-secundario">{NOMBRE_PRUEBA}</span>
        <p className="max-w-[80%] rounded-[14px] rounded-tr-[4px] bg-tinta px-3.5 py-2.5 text-[14px] leading-5 whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
          {p.texto}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="px-1 text-[12px] leading-4 text-secundario">{p.plantilla ? "Mensaje de bienvenida" : "Tu asistente"}</span>
      <p className="max-w-[80%] rounded-[14px] rounded-tl-[4px] border border-marca/25 bg-marca/10 px-3.5 py-2.5 text-[14px] leading-5 whitespace-pre-wrap text-tinta [overflow-wrap:anywhere]">
        {p.texto}
      </p>
    </div>
  );
}
