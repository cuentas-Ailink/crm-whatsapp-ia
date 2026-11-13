"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Cambio, EventoPanel, Llegada, LlegadaFallida, TipoCambio } from "@/lib/api-tipos";
import { CANAL_CONFIGURACION } from "@/lib/configuracion";
import { explicar, type CodigoError } from "@/lib/errores";
import type { Bd, CambiosFicha, MotivoNoSigue } from "@/lib/tipos";

// Los datos están en la base de datos y los lee el servidor. El panel los pide cada 3 s y, además,
// escucha el flujo de eventos del servidor (/api/eventos) para enterarse de cada cambio al momento.
// El sondeo de cada 3 s se queda: cubre los avisos perdidos, otros ordenadores sobre la misma base de
// datos y los cambios hechos a mano en el prompt.

const REFRESCO_MS = 3_000;
const RETRASO_AL_VOLVER_MS = 300;
const RETRASO_CAMBIO_MS = 100;
const CANAL_REINICIO = "demo:reinicio";
const REINTENTO_MIN_MS = 3_000;
const REINTENTO_MAX_MS = 30_000;

const TEXTO_SESION = explicar("sesion").titulo;
const TEXTO_RED = textoDe("red");
const TEXTO_DESCONOCIDO = textoDe("desconocido");

function textoDe(codigo: CodigoError): string {
  const e = explicar(codigo);
  return e.solucion ? `${e.titulo}. ${e.solucion}` : e.titulo;
}

function enviar(url: string, cuerpo: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

// ─── Sesión (modo servidor) ───────────────────────────────────────────────────────────────────────

let yendoAEntrar = false;

/** Sin sesión en modo servidor: a la pantalla de entrar, volviendo luego a donde estaba. Una vez por página. */
function irAEntrar(): void {
  if (yendoAEntrar) return;
  yendoAEntrar = true;
  location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
}

function esFaltaDeSesion(status: number, datos: unknown): boolean {
  return status === 401 && typeof datos === "object" && datos !== null && (datos as { codigo?: unknown }).codigo === "sesion";
}

// ─── El flujo de eventos: uno por pestaña ─────────────────────────────────────────────────────────

type Oyente = (e: EventoPanel) => void;

const oyentes = new Set<Oyente>();
const oyentesDeEstado = new Set<() => void>();
let fuente: EventSource | null = null;
let abierto = false;
let desfase = 0;
let reintento: ReturnType<typeof setTimeout> | null = null;
let retraso = REINTENTO_MIN_MS;

function ponerAbierto(valor: boolean): void {
  if (abierto === valor) return;
  abierto = valor;
  for (const avisar of [...oyentesDeEstado]) avisar();
}

function repartir(e: EventoPanel): void {
  for (const oyente of [...oyentes]) {
    try {
      oyente(e);
    } catch {
      // Un oyente que falla no impide que les llegue a los demás.
    }
  }
}

const TIPOS_CAMBIO: readonly TipoCambio[] = ["leads", "configuracion", "escribiendo", "sistema"];
const CANALES: readonly Llegada["canal"][] = ["formulario", "whatsapp", "manual"];

function leer(datos: string): Record<string, unknown> | null {
  try {
    const valor = JSON.parse(datos) as unknown;
    return typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const esTexto = (v: unknown): v is string => typeof v === "string";
const esNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Pasa un evento del servidor a la forma del panel. Lo que venga mal formado se ignora (null). */
function traducir(nombre: string, datos: string): EventoPanel | null {
  const d = leer(datos);
  if (!d) return null;
  switch (nombre) {
    case "cambio": {
      if (!TIPOS_CAMBIO.includes(d.tipo as TipoCambio) || !esNumero(d.rev)) return null;
      const cambio: Cambio = { tipo: d.tipo as TipoCambio, rev: d.rev };
      return { tipo: "cambio", cambio };
    }
    case "llegada": {
      if (!esTexto(d.leadId) || !esTexto(d.nombre) || !CANALES.includes(d.canal as Llegada["canal"]) || !esNumero(d.inicio)) return null;
      const llegada: Llegada = { leadId: d.leadId, nombre: d.nombre, canal: d.canal as Llegada["canal"], inicio: d.inicio };
      return { tipo: "llegada", llegada };
    }
    case "llegada-fallida": {
      if (!esTexto(d.leadId) || !esTexto(d.nombre) || !esTexto(d.codigo) || !esTexto(d.texto)) return null;
      const fallo: LlegadaFallida = { leadId: d.leadId, nombre: d.nombre, codigo: d.codigo as CodigoError, texto: d.texto };
      return { tipo: "llegada-fallida", fallo };
    }
    case "hora": {
      if (!esNumero(d.ahora)) return null;
      return { tipo: "hora", desfaseMs: d.ahora - Date.now() };
    }
    default:
      return null;
  }
}

function programarReintento(): void {
  if (reintento !== null || oyentes.size === 0) return;
  const espera = retraso;
  retraso = Math.min(retraso * 2, REINTENTO_MAX_MS);
  reintento = setTimeout(() => {
    reintento = null;
    if (oyentes.size > 0 && fuente === null) abrir();
  }, espera);
}

function abrir(): void {
  // La pestaña del panel mantiene su conexión aunque no se vea: así suenan los avisos y el título
  // cuenta quién espera. Cada pestaña del panel abierta gasta una de las 6 conexiones que el navegador
  // permite por servidor; con más de cinco, las peticiones esperan (README, «Límites»).
  const esta = new EventSource("/api/eventos");
  fuente = esta;
  esta.onopen = () => {
    if (fuente !== esta) return;
    retraso = REINTENTO_MIN_MS;
    ponerAbierto(true);
  };
  esta.onerror = () => {
    if (fuente !== esta) return;
    ponerAbierto(false);
    // Tras un fallo de red el navegador vuelve a conectar solo (retry: 3000). Si la conexión acaba
    // cerrada (un 401, un 404…), el navegador ya no lo intenta: se vuelve a abrir a mano, cada vez más espaciado.
    if (esta.readyState === EventSource.CLOSED) {
      esta.close();
      fuente = null;
      programarReintento();
    }
  };
  for (const nombre of ["cambio", "llegada", "llegada-fallida", "hora"]) {
    esta.addEventListener(nombre, (mensaje) => {
      if (fuente !== esta) return;
      const evento = traducir(nombre, (mensaje as MessageEvent).data as string);
      if (!evento) return;
      if (evento.tipo === "hora") desfase = evento.desfaseMs;
      repartir(evento);
    });
  }
}

function cerrar(): void {
  if (reintento !== null) clearTimeout(reintento);
  reintento = null;
  retraso = REINTENTO_MIN_MS;
  fuente?.close();
  fuente = null;
  ponerAbierto(false);
}

/**
 * Escucha los eventos del servidor. Todas las suscripciones de la pestaña comparten un solo
 * EventSource, que se abre con la primera y se cierra con la última. Devuelve la función que deja de escuchar.
 */
export function escucharEventos(f: (e: EventoPanel) => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const propio: Oyente = (e) => f(e);
  oyentes.add(propio);
  if (fuente === null && reintento === null) abrir();
  return () => {
    if (!oyentes.delete(propio)) return;
    if (oyentes.size === 0) cerrar();
  };
}

/** Los milisegundos que hay que sumar a Date.now() para leer el reloj del servidor (0 hasta la primera hora). */
export function desfaseServidor(): number {
  return desfase;
}

function suscribirEstado(avisar: () => void): () => void {
  oyentesDeEstado.add(avisar);
  return () => {
    oyentesDeEstado.delete(avisar);
  };
}

const leerAbierto = () => abierto;
const leerAbiertoServidor = () => false;

// ─── Los datos del panel ──────────────────────────────────────────────────────────────────────────

/**
 * Cada 3 s, solo con la pestaña visible; al volver a ella se pide lo pendiente. Además, cada cambio
 * que avisa el servidor pide los datos al momento, también con la pestaña oculta (así el título y los
 * sonidos funcionan). `conectado` solo pasa a false tras dos peticiones fallidas seguidas.
 */
export function useBd(inicial: Bd): { bd: Bd; conectado: boolean; enDirecto: boolean; refrescar: () => Promise<void> } {
  const [bd, setBd] = useState(inicial);
  const [conectado, setConectado] = useState(true);
  const enDirecto = useSyncExternalStore(suscribirEstado, leerAbierto, leerAbiertoServidor);
  const ultimaPeticion = useRef(0);
  const fallosSeguidos = useRef(0);
  const temporizadorCambio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enDirectoAntes = useRef(false);
  const yaEstuvoEnDirecto = useRef(false);

  const refrescar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current;
    try {
      const respuesta = await fetch("/api/leads", { cache: "no-store" });
      if (respuesta.status === 401) {
        const datos = (await respuesta.json().catch(() => null)) as unknown;
        if (esFaltaDeSesion(respuesta.status, datos)) irAEntrar();
      }
      if (!respuesta.ok) throw new Error(`/api/leads respondió ${respuesta.status}`);
      const datos = (await respuesta.json()) as Bd;
      // Si mientras tanto se ha pedido otra vez, esta respuesta ya está vieja: no cuenta.
      if (peticion !== ultimaPeticion.current) return;
      setBd(datos);
      fallosSeguidos.current = 0;
      setConectado(true);
    } catch {
      if (peticion !== ultimaPeticion.current) return;
      fallosSeguidos.current += 1;
      if (fallosSeguidos.current >= 2) setConectado(false);
    }
  }, []);

  const refrescarEnUnMomento = useCallback(() => {
    if (temporizadorCambio.current !== null) clearTimeout(temporizadorCambio.current);
    temporizadorCambio.current = setTimeout(() => {
      temporizadorCambio.current = null;
      void refrescar();
    }, RETRASO_CAMBIO_MS);
  }, [refrescar]);

  // El sondeo de siempre: solo con la pestaña visible.
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout>;
    const alCambiar = () => {
      clearTimeout(temporizador);
      if (document.visibilityState === "visible") temporizador = setTimeout(refrescar, RETRASO_AL_VOLVER_MS);
    };
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") void refrescar();
    }, REFRESCO_MS);
    document.addEventListener("visibilitychange", alCambiar);
    return () => {
      clearTimeout(temporizador);
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alCambiar);
    };
  }, [refrescar]);

  // Los avisos del servidor: cada cambio, también con la pestaña oculta. Una ráfaga sale en una sola petición.
  useEffect(() => {
    const dejar = escucharEventos((e) => {
      if (e.tipo === "cambio") refrescarEnUnMomento();
    });
    return () => {
      dejar();
      if (temporizadorCambio.current !== null) clearTimeout(temporizadorCambio.current);
      temporizadorCambio.current = null;
    };
  }, [refrescarEnUnMomento]);

  // Si el flujo vuelve tras un corte, se pide lo que haya podido pasar mientras tanto.
  useEffect(() => {
    if (enDirecto && !enDirectoAntes.current && yaEstuvoEnDirecto.current) refrescarEnUnMomento();
    if (enDirecto) yaEstuvoEnDirecto.current = true;
    enDirectoAntes.current = enDirecto;
  }, [enDirecto, refrescarEnUnMomento]);

  return { bd, conectado, enDirecto, refrescar };
}

// ─── Avisos entre pestañas ────────────────────────────────────────────────────────────────────────

function avisarReinicio(): void {
  try {
    const canal = new BroadcastChannel(CANAL_REINICIO);
    canal.postMessage("reiniciada");
    canal.close();
  } catch {
    // Sin BroadcastChannel no hay a quién avisar.
  }
}

/** Devuelve la función que deja de escuchar. */
export function alReiniciar(hacer: () => void): () => void {
  const canal = new BroadcastChannel(CANAL_REINICIO);
  canal.onmessage = hacer;
  return () => canal.close();
}

/** Avisa a las demás pestañas de que la configuración ha cambiado. Sin BroadcastChannel, no hace nada. */
export function avisarCambioDeConfiguracion(): void {
  try {
    const canal = new BroadcastChannel(CANAL_CONFIGURACION);
    canal.postMessage("cambiada");
    canal.close();
  } catch {
    // Sin BroadcastChannel no hay a quién avisar.
  }
}

/** Devuelve la función que deja de escuchar. */
export function alCambiarConfiguracion(hacer: () => void): () => void {
  try {
    const canal = new BroadcastChannel(CANAL_CONFIGURACION);
    canal.onmessage = () => hacer();
    return () => canal.close();
  } catch {
    return () => {};
  }
}

// ─── Las acciones ─────────────────────────────────────────────────────────────────────────────────

type Respuesta = { ok: true; datos: unknown } | { ok: false; error: string; datos: unknown };

/** Manda la acción y traduce la respuesta: el error del servidor, el de la sesión o el de la red. */
async function llamar(url: string, cuerpo: unknown): Promise<Respuesta> {
  let respuesta: Response;
  try {
    respuesta = await enviar(url, cuerpo);
  } catch {
    return { ok: false, error: TEXTO_RED, datos: null };
  }
  const datos = (await respuesta.json().catch(() => null)) as unknown;
  if (respuesta.ok) return { ok: true, datos };
  if (esFaltaDeSesion(respuesta.status, datos)) {
    irAEntrar();
    return { ok: false, error: TEXTO_SESION, datos };
  }
  const error = typeof datos === "object" && datos !== null ? (datos as { error?: unknown }).error : undefined;
  return { ok: false, error: typeof error === "string" && error ? error : TEXTO_DESCONOCIDO, datos };
}

/** Las acciones sobre un cliente. Devuelven el error para enseñarlo, o null si ha salido bien. */
async function accion(url: string, cuerpo: unknown): Promise<string | null> {
  const r = await llamar(url, cuerpo);
  return r.ok ? null : r.error;
}

/** Envía por WhatsApp lo que escribe el comercial (firmado «Tú»). */
export function responderAMano(leadId: string, texto: string): Promise<string | null> {
  return accion("/api/responder", { leadId, texto });
}

/** El comercial coge la conversación: el asistente deja de contestar. */
export function pasarAPersona(leadId: string): Promise<string | null> {
  return accion("/api/pasar-a-persona", { leadId });
}

export function cambiarEtapa(leadId: string, a: "asistente" | "persona" | "spam" | "no-spam"): Promise<string | null> {
  return accion("/api/etapa", { leadId, a });
}

export function cerrarVisita(
  leadId: string,
  p:
    | { accion: "si"; importe: number; cobrado?: number | null; nota?: string }
    | { accion: "no"; motivo: MotivoNoSigue; nota?: string }
    | { accion: "reabrir" | "visto" },
): Promise<string | null> {
  return accion("/api/cerrar", { leadId, ...p });
}

export function borrarCliente(leadId: string): Promise<string | null> {
  return accion("/api/borrar-cliente", { leadId });
}

/** El enlace de descarga de los datos de un cliente (no se pide nada: lo baja el navegador). */
export function urlDatosCliente(leadId: string): string {
  return "/api/cliente/datos?id=" + encodeURIComponent(leadId);
}

export async function anadirCliente(p: {
  nombre: string;
  telefono: string;
  quiere?: string;
  permiso: boolean;
}): Promise<{ ok: true; leadId: string; enviado: boolean } | { ok: false; error: string; campo?: string; leadId?: string }> {
  const cuerpo: { nombre: string; telefono: string; quiere?: string; permiso: boolean } = { nombre: p.nombre, telefono: p.telefono, permiso: p.permiso };
  if (p.quiere !== undefined) cuerpo.quiere = p.quiere;
  const r = await llamar("/api/cliente", cuerpo);
  const d = (typeof r.datos === "object" && r.datos !== null ? r.datos : {}) as { leadId?: unknown; enviado?: unknown; campo?: unknown };
  if (r.ok) {
    if (typeof d.leadId !== "string") return { ok: false, error: TEXTO_DESCONOCIDO };
    return { ok: true, leadId: d.leadId, enviado: d.enviado === true };
  }
  return {
    ok: false,
    error: r.error,
    ...(typeof d.campo === "string" ? { campo: d.campo } : {}),
    ...(typeof d.leadId === "string" ? { leadId: d.leadId } : {}),
  };
}

export function permitirMensajes(leadId: string): Promise<string | null> {
  return accion("/api/permitir-mensajes", { leadId });
}

/** Guarda lo que el equipo ha cambiado en la ficha. */
export function editarFicha(leadId: string, cambios: CambiosFicha): Promise<string | null> {
  return accion("/api/editar-lead", { leadId, cambios });
}

export function anadirNota(leadId: string, texto: string): Promise<string | null> {
  return accion("/api/notas", { leadId, texto });
}

export function anadirTarea(leadId: string, texto: string, vence: string): Promise<string | null> {
  return accion("/api/tareas", { leadId, accion: "crear", texto, vence });
}

export function cambiarTarea(leadId: string, tareaId: string, hecha: boolean): Promise<string | null> {
  return accion("/api/tareas", { leadId, accion: "cambiar", tareaId, hecha });
}

export function borrarTarea(leadId: string, tareaId: string): Promise<string | null> {
  return accion("/api/tareas", { leadId, accion: "borrar", tareaId });
}

/** Al salir bien, avisa a las demás pestañas (la del formulario se reinicia). */
async function accionQueReinicia(url: string, cuerpo: unknown): Promise<string | null> {
  const fallo = await accion(url, cuerpo);
  if (fallo === null) avisarReinicio();
  return fallo;
}

export function cargarEjemplos(): Promise<string | null> {
  return accionQueReinicia("/api/configuracion/ejemplos", { accion: "cargar" });
}

export function borrarEjemplos(): Promise<string | null> {
  return accionQueReinicia("/api/configuracion/ejemplos", { accion: "borrar" });
}

export function borrarTodo(): Promise<string | null> {
  return accionQueReinicia("/api/reset", { ejemplos: false });
}
