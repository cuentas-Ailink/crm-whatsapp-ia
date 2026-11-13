import { useSyncExternalStore } from "react";
import { SECCIONES_CONFIGURACION, type IdSeccionConfiguracion } from "@/lib/configuracion";

// La sección del panel vive en la URL: /panel, #clientes, #agenda, #ajustes[-negocio|-web|-asistente|-horario|-conexiones]
// y ?cliente={id}. Al recargar se queda donde estaba. W11 la hace suya en la fase 3; las firmas no cambian.

export type Vista = "hoy" | "clientes" | "agenda" | "configuracion";
export interface Ubicacion {
  vista: Vista;
  cliente: string | null;
  bloque: IdSeccionConfiguracion | null;
}

const INICIO: Ubicacion = Object.freeze({ vista: "hoy", cliente: null, bloque: null });

export function leerUbicacion(url?: string): Ubicacion {
  if (url === undefined) {
    if (typeof window === "undefined") return { ...INICIO };
    url = window.location.href;
  }
  let u: URL;
  try {
    u = new URL(url, "http://localhost");
  } catch {
    return { ...INICIO };
  }
  let ancla = u.hash.replace(/^#/, "");
  let cliente = u.searchParams.get("cliente");
  // «/panel#agenda?cliente=…», escrito a mano: el parámetro va detrás del #.
  const interrogacion = ancla.indexOf("?");
  if (interrogacion >= 0) {
    cliente ||= new URLSearchParams(ancla.slice(interrogacion + 1)).get("cliente");
    ancla = ancla.slice(0, interrogacion);
  }
  const conCliente = cliente ? cliente : null;
  if (ancla === "clientes" || ancla === "agenda") return { vista: ancla, cliente: conCliente, bloque: null };
  if (ancla === "ajustes") return { vista: "configuracion", cliente: conCliente, bloque: null };
  if (ancla.startsWith("ajustes-")) {
    const seccion = SECCIONES_CONFIGURACION.find((s) => s.ancla === ancla.slice("ajustes-".length));
    if (seccion) return { vista: "configuracion", cliente: conCliente, bloque: seccion.id };
  }
  return { vista: "hoy", cliente: conCliente, bloque: null };
}

/** La URL de una ubicación. Lo que falta sale de la actual; el bloque se olvida al cambiar de vista. */
export function hrefDe(u: Partial<Ubicacion>): string {
  const actual = leerUbicacion();
  const vista = u.vista ?? actual.vista;
  const cliente = u.cliente !== undefined ? u.cliente : actual.cliente;
  let bloque: IdSeccionConfiguracion | null = null;
  if (vista === "configuracion") {
    if (u.bloque !== undefined) bloque = u.bloque;
    else if (u.vista === undefined || u.vista === actual.vista) bloque = actual.bloque;
  }
  let ancla = "";
  if (vista === "clientes") ancla = "#clientes";
  else if (vista === "agenda") ancla = "#agenda";
  else if (vista === "configuracion") {
    const seccion = bloque ? SECCIONES_CONFIGURACION.find((s) => s.id === bloque) : undefined;
    ancla = seccion ? `#ajustes-${seccion.ancla}` : "#ajustes";
  }
  return `/panel${cliente ? `?cliente=${encodeURIComponent(cliente)}` : ""}${ancla}`;
}

const oyentes = new Set<() => void>();

function notificar(): void {
  for (const oyente of oyentes) oyente();
}

function cambiarUrl(u: Partial<Ubicacion>): void {
  if (typeof window === "undefined") return;
  history.replaceState(history.state, "", hrefDe(u));
  notificar();
}

export function irA(vista: Vista, o?: { bloque?: IdSeccionConfiguracion }): void {
  cambiarUrl(o?.bloque !== undefined ? { vista, bloque: o.bloque } : { vista });
}

export function abrirCliente(id: string): void {
  cambiarUrl({ cliente: id });
}

export function cerrarCliente(): void {
  cambiarUrl({ cliente: null });
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  window.addEventListener("popstate", avisar);
  window.addEventListener("hashchange", avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener("popstate", avisar);
    window.removeEventListener("hashchange", avisar);
  };
}

// El mismo objeto mientras la URL no cambia: useSyncExternalStore compara por identidad.
let guardada: { href: string; ubicacion: Ubicacion } | null = null;

function instantanea(): Ubicacion {
  const href = window.location.href;
  if (guardada?.href !== href) guardada = { href, ubicacion: leerUbicacion(href) };
  return guardada.ubicacion;
}

// El servidor pinta siempre «hoy»: así no hay diferencias al hidratar.
function instantaneaServidor(): Ubicacion {
  return INICIO;
}

export function useUbicacion(): Ubicacion {
  return useSyncExternalStore(suscribir, instantanea, instantaneaServidor);
}
