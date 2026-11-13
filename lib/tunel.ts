// El túnel que deja que Meta llegue a este ordenador, y la URL pública del CRM. Solo en el servidor.
// El túnel se abre con la librería de ngrok dentro del propio servidor (nada de procesos aparte) y
// nunca en las pruebas: con BD_LOCAL, CRM_DOMINIO o CRM_URL_PUBLICA no se abre nada.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { explicarNgrok, type ErrorExplicado } from "./errores";
import { log, logAviso } from "./log";

export interface EstadoTunel { abierto: boolean; url: string | null; error: ErrorExplicado | null; desde: number | null }

const CERRADO: EstadoTunel = { abierto: false, url: null, error: null, desde: null };
const REINTENTOS_MS = [5_000, 10_000, 30_000];
const REINTENTO_DESPUES_MS = 60_000;
const TIEMPO_ACCESO_MS = 10_000;
const LOCALES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

interface Escucha { url(): string | null; close(): Promise<void> }

interface EstadoInterno {
  estado: EstadoTunel;
  escucha: Escucha | null;
  token: string | null;
  abriendo: { token: string; promesa: Promise<EstadoTunel> } | null;
  reintento: ReturnType<typeof setTimeout> | null;
  intentos: number;
  ultimaCausa: string | null;
  acceso: "ok" | "error" | "desconocido";
  accesoLanzado: boolean;
}

function interno(): EstadoInterno {
  const g = globalThis as unknown as { __tunel?: EstadoInterno };
  g.__tunel ??= {
    estado: { ...CERRADO },
    escucha: null,
    token: null,
    abriendo: null,
    reintento: null,
    intentos: 0,
    ultimaCausa: null,
    acceso: "desconocido",
    accesoLanzado: false,
  };
  return g.__tunel;
}

/** Un valor de entorno sin espacios; vacío cuenta como no puesto. */
function variable(nombre: "CRM_DOMINIO" | "CRM_URL_PUBLICA"): string | null {
  return process.env[nombre]?.trim() || null;
}

/** Con BD_LOCAL, dominio propio o una URL pública fijada no hay túnel (I14). */
function sinTunel(): boolean {
  return !!process.env.BD_LOCAL || !!variable("CRM_DOMINIO") || !!variable("CRM_URL_PUBLICA");
}

/** Cómo está el túnel ahora. */
export function estadoTunel(): EstadoTunel {
  const e = interno().estado;
  return { ...e, error: e.error ? { ...e.error } : null };
}

function cancelarReintento(g: EstadoInterno): void {
  if (g.reintento) clearTimeout(g.reintento);
  g.reintento = null;
}

function programarReintento(g: EstadoInterno, token: string): void {
  cancelarReintento(g);
  const espera = REINTENTOS_MS[g.intentos] ?? REINTENTO_DESPUES_MS;
  g.intentos++;
  g.reintento = setTimeout(() => {
    g.reintento = null;
    void abrirTunel({ token });
  }, espera);
  g.reintento.unref?.();
}

async function abrir(g: EstadoInterno, token: string): Promise<EstadoTunel> {
  cancelarReintento(g);
  try {
    // Solo aquí: el módulo nativo de ngrok se carga cuando de verdad hace falta un túnel.
    const ngrok = await import("@ngrok/ngrok");
    const dominio = (process.env.NGROK_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    // 127.0.0.1 y no solo el puerto: el servidor escucha en 127.0.0.1 y «localhost» puede ser ::1.
    const escucha: Escucha = await ngrok.forward({
      addr: `127.0.0.1:${process.env.PUERTO || "8000"}`,
      authtoken: token,
      domain: dominio || undefined,
    });
    const url = (escucha.url() ?? "").replace(/\/+$/, "");
    g.escucha = escucha;
    g.token = token;
    g.intentos = 0;
    g.ultimaCausa = null;
    g.estado = { abierto: true, url, error: null, desde: Date.now() };
    log(`Túnel activo: ${url}/webhook`);
    void import("./meta")
      .then((meta) => meta.alAbrirTunel(url))
      .catch(() => logAviso("No se ha podido avisar a Meta de la dirección del túnel"));
    void comprobarAcceso();
  } catch (e) {
    const error = explicarNgrok(e);
    g.escucha = null;
    g.token = null;
    g.estado = { abierto: false, url: null, error, desde: null };
    if (g.ultimaCausa !== error.codigo) {
      g.ultimaCausa = error.codigo;
      logAviso(`No se ha podido abrir el túnel: ${error.titulo}. ${error.solucion}`);
    }
    // Una clave mala no se arregla sola; la red o un dominio, sí.
    if (error.codigo !== "ngrok.token") programarReintento(g, token);
  }
  return estadoTunel();
}

/** Abre el túnel de ngrok hacia este servidor. Nunca con BD_LOCAL, CRM_DOMINIO o CRM_URL_PUBLICA. */
export async function abrirTunel(o?: { token?: string }): Promise<EstadoTunel> {
  if (sinTunel()) return estadoTunel();
  const g = interno();
  const token = o?.token ?? tokenNgrok();
  if (!token) {
    g.estado = {
      abierto: false,
      url: null,
      error: { codigo: "ngrok.token", titulo: "Falta tu clave de ngrok", solucion: "Cópiala de dashboard.ngrok.com → Your Authtoken y pégala en Ajustes → Conexiones.", paso: "whatsapp" },
      desde: null,
    };
    return estadoTunel();
  }
  if (g.abriendo) {
    if (g.abriendo.token === token) return g.abriendo.promesa;
    await g.abriendo.promesa.catch(() => undefined);
  }
  if (g.estado.abierto && g.token === token) return estadoTunel();
  const promesa = (async () => {
    if (g.estado.abierto) await cerrarTunel();
    return abrir(g, token);
  })();
  g.abriendo = { token, promesa };
  try {
    return await promesa;
  } finally {
    if (g.abriendo?.promesa === promesa) g.abriendo = null;
  }
}

/** Cierra el túnel y cancela un reintento pendiente. */
export async function cerrarTunel(): Promise<void> {
  const g = interno();
  cancelarReintento(g);
  const escucha = g.escucha;
  g.escucha = null;
  g.token = null;
  g.intentos = 0;
  g.ultimaCausa = null;
  g.estado = { ...CERRADO };
  if (escucha) {
    try {
      await escucha.close();
    } catch {
      // Ya estaba cerrado.
    }
  }
}

/** El authtoken del archivo de configuración de ngrok (v2: arriba del todo; v3: dentro de «agent:»). */
function tokenDeArchivo(): string | null {
  const ruta =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "ngrok", "ngrok.yml")
      : path.join(os.homedir(), ".config", "ngrok", "ngrok.yml");
  let texto: string;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch {
    return null;
  }
  let enAgente = false;
  for (const crudo of texto.split(/\r?\n/)) {
    if (!crudo.trim() || crudo.trim().startsWith("#")) continue;
    const sangrada = /^\s/.test(crudo);
    if (!sangrada) {
      enAgente = /^agent\s*:\s*(#.*)?$/.test(crudo);
      const arriba = crudo.match(/^authtoken\s*:\s*(.*)$/);
      if (arriba) return valorYaml(arriba[1]);
      continue;
    }
    if (enAgente) {
      const dentro = crudo.match(/^\s+authtoken\s*:\s*(.*)$/);
      if (dentro) return valorYaml(dentro[1]);
    }
  }
  return null;
}

/** Un valor de YAML de una línea: sin comillas ni comentario final. */
function valorYaml(crudo: string): string | null {
  let valor = crudo.trim();
  const comillas = valor.match(/^(["'])(.*)\1\s*(#.*)?$/);
  if (comillas) valor = comillas[2];
  else valor = valor.replace(/\s+#.*$/, "").trim();
  return valor || null;
}

/** NGROK_AUTHTOKEN o, solo sin BD_LOCAL, CRM_DOMINIO ni CRM_URL_PUBLICA, el del archivo de ngrok. */
export function tokenNgrok(): string | null {
  const propio = process.env.NGROK_AUTHTOKEN?.trim();
  if (propio) return propio;
  if (sinTunel()) return null;
  return tokenDeArchivo();
}

/** Desde internet solo se puede llegar a /webhook: /panel tiene que dar 404. */
async function comprobarAcceso(): Promise<void> {
  const g = interno();
  const url = urlPublica();
  if (!url || modoServidor()) return;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return;
  }
  if (LOCALES.has(host)) return;
  try {
    const r = await fetch(`${url}/panel`, { redirect: "manual", signal: AbortSignal.timeout(TIEMPO_ACCESO_MS) });
    if (r.status === 404) {
      g.acceso = "ok";
    } else {
      g.acceso = "error";
      logAviso("El panel se puede abrir desde internet: cierra el CRM");
    }
  } catch {
    // Sin red no se sabe: se queda como estaba.
  }
}

/** El resultado de la comprobación de acceso. Con una CRM_URL_PUBLICA de fuera, la primera llamada la lanza. */
export function estadoAcceso(): "ok" | "error" | "desconocido" {
  const g = interno();
  if (!g.accesoLanzado && variable("CRM_URL_PUBLICA") && !modoServidor()) {
    g.accesoLanzado = true;
    void comprobarAcceso();
  }
  return g.acceso;
}

/** Con dominio propio, el CRM está en un servidor. */
export function modoServidor(): boolean {
  return !!variable("CRM_DOMINIO");
}

/** Por dónde llega Meta: el dominio propio, la URL fijada o la del túnel. Sin barra final. */
export function urlPublica(): string | null {
  const dominio = variable("CRM_DOMINIO");
  const url = dominio ? `https://${dominio}` : (variable("CRM_URL_PUBLICA") ?? estadoTunel().url);
  return url ? url.replace(/\/+$/, "") : null;
}
