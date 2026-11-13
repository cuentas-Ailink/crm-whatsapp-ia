"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RespuestaConfiguracion } from "@/lib/api-tipos";
import type { CambiosPerfil, RevisionPrompt } from "@/lib/configuracion";
import { alCambiarConfiguracion, avisarCambioDeConfiguracion } from "../datos";

// Lo que Ajustes pide al servidor: la configuración entera y las escrituras que no son un solo campo
// (el cambio de negocio, el logo, las instrucciones y los cambios de varios campos a la vez).

const SIN_CONEXION = "Sin conexión con el servidor. Vuelve a intentarlo en un momento.";
const LOGO_PESADO = "El logo pesa demasiado: prueba con uno más pequeño";

type Datos = Record<string, unknown>;
type Respuesta = { ok: true; datos: Datos | null } | { ok: false; error: string; datos: Datos | null; status: number | null };

export type DestinoAjustes = { sector: "reformas" | "inmobiliaria" | "clinica" } | { nuevo: { nombre: string; base: "generico"; sustituir: true } };
export type ResultadoTexto = { ok: true; hash: string; revision: RevisionPrompt } | { ok: false; error: string; conflicto?: boolean };

// El perfil de la última lectura de GET /api/configuracion: lo usan los cambios de varios campos.
let perfilId: string | null = null;

/** Sin sesión en modo servidor: a la pantalla de entrar, volviendo luego a donde estaba. */
function irAEntrar(): void {
  location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
}

async function pedir(url: string, cuerpo?: unknown): Promise<Respuesta> {
  let respuesta: Response;
  try {
    respuesta =
      cuerpo === undefined
        ? await fetch(url, { cache: "no-store" })
        : await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store" });
  } catch {
    return { ok: false, error: SIN_CONEXION, datos: null, status: null };
  }
  const leidos = (await respuesta.json().catch(() => null)) as unknown;
  const datos = typeof leidos === "object" && leidos !== null && !Array.isArray(leidos) ? (leidos as Datos) : null;
  if (respuesta.status === 401 && datos?.codigo === "sesion") irAEntrar();
  if (!respuesta.ok || datos?.ok === false) {
    const error = typeof datos?.error === "string" && datos.error ? datos.error : `El servidor respondió ${respuesta.status}`;
    return { ok: false, error, datos, status: respuesta.status };
  }
  return { ok: true, datos };
}

function perfilDe(datos: Datos | null): string | null {
  const activa = datos?.activa as { perfil?: { id?: unknown } } | undefined;
  return typeof activa?.perfil?.id === "string" ? activa.perfil.id : null;
}

async function leerConfiguracion(): Promise<{ ok: true; datos: RespuestaConfiguracion } | { ok: false; error: string }> {
  const r = await pedir("/api/configuracion");
  if (!r.ok) return { ok: false, error: r.error };
  const id = perfilDe(r.datos);
  if (!r.datos || id === null) return { ok: false, error: "No se han podido cargar los ajustes." };
  perfilId = id;
  return { ok: true, datos: r.datos as unknown as RespuestaConfiguracion };
}

/**
 * La configuración entera: al montar, cuando cambia la firma (otra pestaña, Claude Code…) y cuando otra
 * pestaña avisa. Mientras recarga se queda con lo último bueno; una respuesta vieja nunca pisa a una nueva.
 */
export function useConfiguracion(firma: string | undefined): { datos: RespuestaConfiguracion | null; error: string | null; recargar(): Promise<void> } {
  const [datos, setDatos] = useState<RespuestaConfiguracion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultima = useRef(0);
  const montado = useRef(true);

  const recargar = useCallback(async () => {
    const numero = ++ultima.current;
    const r = await leerConfiguracion();
    if (!montado.current || numero !== ultima.current) return;
    if (r.ok) {
      setDatos(r.datos);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    montado.current = true;
    void recargar();
    const dejar = alCambiarConfiguracion(() => void recargar());
    return () => {
      montado.current = false;
      dejar();
    };
  }, [recargar]);

  // Solo cuando la firma cambia después de la primera: la primera lectura ya la hace el montaje.
  const primeraFirma = useRef(firma);
  useEffect(() => {
    if (firma === primeraFirma.current) return;
    primeraFirma.current = firma;
    void recargar();
  }, [firma, recargar]);

  return { datos, error, recargar };
}

function avisarSiBien<T extends { ok: boolean }>(r: T): T {
  if (r.ok) avisarCambioDeConfiguracion();
  return r;
}

export async function cambiarDeNegocio(destino: DestinoAjustes, ejemplos: "sustituir" | "borrar"): Promise<{ ok: true; avisos: string[] } | { ok: false; error: string }> {
  const r = await pedir("/api/configuracion/sector", { destino, ejemplos });
  if (!r.ok) return { ok: false, error: r.error };
  perfilId = perfilDe(r.datos) ?? perfilId;
  const avisos = Array.isArray(r.datos?.avisos) ? (r.datos.avisos as unknown[]).filter((a): a is string => typeof a === "string") : [];
  return avisarSiBien({ ok: true, avisos });
}

export async function subirLogo(dataUrl: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await pedir("/api/logo", { dataUrl });
  if (!r.ok) return { ok: false, error: r.status === 413 ? LOGO_PESADO : r.error };
  return avisarSiBien({ ok: true });
}

async function escribirInstrucciones(cuerpo: unknown): Promise<ResultadoTexto> {
  const r = await pedir("/api/configuracion/agente", cuerpo);
  if (!r.ok) return r.status === 409 ? { ok: false, error: r.error, conflicto: true } : { ok: false, error: r.error };
  const hash = typeof r.datos?.hash === "string" ? r.datos.hash : "";
  return avisarSiBien({ ok: true, hash, revision: r.datos?.revision as RevisionPrompt });
}

export function guardarInformacion(informacion: string, hash: string): Promise<ResultadoTexto> {
  return escribirInstrucciones({ informacion, hash });
}

export function guardarInstrucciones(texto: string, hash: string): Promise<ResultadoTexto> {
  return escribirInstrucciones({ texto, hash });
}

export function restaurarInstrucciones(): Promise<ResultadoTexto> {
  return escribirInstrucciones({ restaurar: true });
}

/** Varios campos en una sola escritura. Con un 409 (el perfil ha cambiado) se relee y se intenta una vez más. */
export async function guardarCambiosPerfil(cambios: CambiosPerfil): Promise<{ ok: true } | { ok: false; error: string; campo?: string }> {
  if (perfilId === null) {
    const leido = await leerConfiguracion();
    if (!leido.ok) return leido;
  }
  let r = await pedir("/api/configuracion", { perfilId, cambios });
  if (!r.ok && r.status === 409) {
    const leido = await leerConfiguracion();
    if (!leido.ok) return leido;
    r = await pedir("/api/configuracion", { perfilId, cambios });
  }
  if (!r.ok) {
    const fallo: { ok: false; error: string; campo?: string } = { ok: false, error: r.error };
    if (typeof r.datos?.campo === "string") fallo.campo = r.datos.campo;
    return fallo;
  }
  perfilId = perfilDe(r.datos) ?? perfilId;
  return avisarSiBien({ ok: true });
}
