"use client";

import { useEffect, useState, type JSX } from "react";
import type { EstadoConexiones, FilaConexion, PasoPuesta } from "@/lib/api-tipos";
import { esperanRespuesta } from "@/lib/asistente";
import type { IdSeccionConfiguracion } from "@/lib/configuracion";
import type { Bd } from "@/lib/tipos";
import { arreglar } from "./api-sistema";
import { confirmar } from "./confirmaciones";
import { pasarAOficial } from "./modo-prueba";
import { irA } from "./navegacion";
import { usePuesta } from "./puesta-en-marcha";
import { useConexiones, useEstado } from "./sistema";

// La línea de estado del pie de la barra lateral: una línea, un botón. Lo que hay que mirar primero.
// Las filas en «atención» (un token que caduca, «Aún no ha llegado nada de Meta…») solo salen en Conexiones.
// En el modo prueba, además, una línea ámbar fija: «Modo prueba (no oficial) · Pasar a oficial».

export type TonoLinea = "ok" | "atencion" | "error";

/** Qué hace el botón de la línea. */
export type AccionLinea =
  | { tipo: "puesta" }
  | { tipo: "paso"; paso: PasoPuesta }
  | { tipo: "arreglar"; que: "webhook" | "suscripcion" | "tunel" }
  | { tipo: "ir"; bloque: IdSeccionConfiguracion }
  | { tipo: "oficial" };

export interface EstadoLinea {
  texto: string;
  tono: TonoLinea;
  accion: AccionLinea;
}

const PRIORIDAD: FilaConexion["id"][] = ["acceso", "datos", "whatsapp", "mensajes", "claude"];

const TEXTO_ERROR: Record<FilaConexion["id"], string> = {
  acceso: "El panel se puede abrir desde internet · Ver",
  datos: "No llego a tus datos · Arreglar",
  whatsapp: "WhatsApp no está conectado · Arreglar",
  mensajes: "WhatsApp no recibe mensajes · Arreglar",
  claude: "Tu asistente no puede contestar · Arreglar",
};

/** La línea ámbar del modo prueba: siempre a la vista mientras WhatsApp va por QR. */
export const LINEA_MODO_PRUEBA: EstadoLinea = { texto: "Modo prueba (no oficial) · Pasar a oficial", tono: "atencion", accion: { tipo: "oficial" } };

/** La primera situación que aplica, de arriba abajo. W22 la usa también en el menú del móvil. */
export function calcularLinea(p: { puesta: { pendientes: PasoPuesta[]; aplazada: boolean }; conexiones: EstadoConexiones | null; bd: Bd; modoPrueba?: boolean }): EstadoLinea {
  const { pendientes, aplazada } = p.puesta;
  if (aplazada && pendientes.length > 0) {
    const n = pendientes.length;
    return {
      texto: n === 1 ? "Falta 1 paso para recibir WhatsApp · Seguir" : `Faltan ${n} pasos para recibir WhatsApp · Seguir`,
      tono: "atencion",
      accion: { tipo: "puesta" },
    };
  }

  const filas = p.conexiones?.filas ?? [];
  for (const id of PRIORIDAD) {
    const fila = filas.find((f) => f.id === id && f.estado === "error");
    if (!fila) continue;
    const accion: AccionLinea = fila.accion?.arreglar
      ? { tipo: "arreglar", que: fila.accion.arreglar }
      : fila.accion?.paso
        ? { tipo: "paso", paso: fila.accion.paso }
        : { tipo: "ir", bloque: "whatsapp" };
    return { texto: TEXTO_ERROR[id], tono: "error", accion };
  }

  if (p.modoPrueba) return LINEA_MODO_PRUEBA;

  const sistema = p.bd.configuracion?.sistema;
  if (sistema?.asistente.activo === false) {
    const n = esperanRespuesta(Object.values(p.bd.leads), sistema.asistente.pausadoEn);
    return {
      texto: n === 0 ? "Tu asistente está apagado" : `Tu asistente está apagado · ${n} ${n === 1 ? "espera" : "esperan"}`,
      tono: "atencion",
      accion: { tipo: "ir", bloque: "asistente" },
    };
  }

  return { texto: "Todo funciona", tono: "ok", accion: { tipo: "ir", bloque: "whatsapp" } };
}

/**
 * El tono y las palabras de la línea, para el botón del menú del móvil (el punto rojo cuando algo
 * falla). `null` mientras carga, igual que la línea, que entonces no se pinta.
 */
export function useTonoLinea(bd: Bd): { tono: TonoLinea | null; texto: string | null } {
  const estado = useEstado();
  const puesta = usePuesta();
  const { estado: conexiones } = useConexiones();
  if (estado === null) return { tono: null, texto: null };
  const linea = calcularLinea({ puesta, conexiones, bd, modoPrueba: estado.modoWhatsApp === "prueba" });
  return { tono: linea.tono, texto: linea.texto };
}

const PUNTO: Record<TonoLinea, string> = { ok: "bg-ok", atencion: "bg-atencion", error: "bg-error" };
const VERBOS = new Set(["Seguir", "Arreglar", "Ver", "Pasar a oficial"]);

export function LineaEstado(p: { bd: Bd }): JSX.Element | null {
  const estado = useEstado();
  const puesta = usePuesta();
  const { estado: conexiones, comprobar } = useConexiones();
  const [arreglando, setArreglando] = useState(false);

  useEffect(() => {
    if (conexiones === null) void comprobar();
    // Solo al montar: luego lo mantiene al día ProveedorSistema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (estado === null) return null;
  const prueba = estado.modoWhatsApp === "prueba";
  const linea = calcularLinea({ puesta, conexiones, bd: p.bd, modoPrueba: prueba });

  const hacer = async (l: EstadoLinea) => {
    const a = l.accion;
    if (a.tipo === "puesta") puesta.abrir();
    else if (a.tipo === "paso") puesta.abrir(a.paso);
    else if (a.tipo === "ir") irA("configuracion", { bloque: a.bloque });
    else if (a.tipo === "oficial") pasarAOficial(() => puesta.abrir("whatsapp"));
    else {
      setArreglando(true);
      const r = await arreglar(a.que);
      if ("error" in r) confirmar(r.error, { tono: "error" });
      await comprobar(true);
      setArreglando(false);
    }
  };

  // En el modo prueba la línea ámbar está siempre; si hay algo más urgente, va debajo.
  const lineas = prueba && linea.accion.tipo !== "oficial" ? [LINEA_MODO_PRUEBA, linea] : [linea];
  return (
    <>
      {lineas.map((l) => (
        <BotonLinea key={l.texto} linea={l} hacer={() => void hacer(l)} deshabilitado={arreglando} />
      ))}
    </>
  );
}

function BotonLinea(p: { linea: EstadoLinea; hacer: () => void; deshabilitado: boolean }): JSX.Element {
  const { linea } = p;
  // La palabra del botón («Seguir», «Arreglar», «Ver») se lee un poco más fuerte.
  const partes = linea.texto.split(" · ");
  const ultima = partes.at(-1) ?? "";
  const verbo = partes.length > 1 && VERBOS.has(ultima) ? ultima : null;
  const resto = verbo ? partes.slice(0, -1).join(" · ") : linea.texto;
  const prueba = linea.accion.tipo === "oficial";

  return (
    <button
      type="button"
      onClick={p.hacer}
      disabled={p.deshabilitado}
      aria-label={linea.texto}
      className={`flex w-full cursor-pointer items-start gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] leading-4 max-lg:min-h-11 max-lg:py-3 max-lg:text-[13px] max-lg:leading-[18px] transition-colors duration-200 ease-out hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-white/70 disabled:cursor-default ${prueba ? "text-atencion" : "text-white/70"}`}
    >
      <span aria-hidden className={`mt-1 size-2 shrink-0 rounded-full ${PUNTO[linea.tono]}`} />
      <span aria-hidden>
        {resto}
        {verbo && (
          <>
            {" · "}
            <span className={`font-medium underline underline-offset-2 ${prueba ? "text-atencion decoration-atencion/40" : "text-white decoration-white/30"}`}>{verbo}</span>
          </>
        )}
      </span>
    </button>
  );
}
