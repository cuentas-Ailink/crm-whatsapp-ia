// El «modo prueba»: WhatsApp vinculado con un QR (Baileys) en vez de la API oficial de Meta, solo
// para probar y solo en local. Aquí vive el interruptor (oficial o prueba), el secreto con el que
// firma el puente y la lista de números permitidos, en un archivo de la carpeta de datos que nunca
// se sube. Solo en el servidor.
//
// El desvío de los envíos al puente lo decide este módulo: ningún navegador cambia GRAPH_BASE_URL
// ni ninguna otra *_BASE_URL, que siguen siendo solo de .env. En modo servidor (CRM_DOMINIO) no
// existe: modoWhatsApp() es siempre «oficial».

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modoServidor } from "./tunel";

/** La versión exacta de Baileys que se instala la primera vez (MIT; trae libsignal, GPL-3.0). */
export const VERSION_BAILEYS = "7.0.0-rc14";
/** Las piezas que trae Baileys se eligen entre las publicadas antes de esta fecha: no entra nada nuevo sin revisar. */
export const FECHA_PIEZAS = "2026-11-01";

export interface ConfigModoPrueba {
  version: 1;
  modo: "prueba";
  /** Con este secreto firma el puente lo que pasa al webhook, y con él le habla el CRM. */
  secreto: string;
  permitidos: string[];
  aceptadoEn: number;
}

const DISTANCIA_PUERTO = 2000;

/** La carpeta del modo prueba: en la de datos (o en la de la base de datos de pruebas). */
export function carpetaModoPrueba(): string {
  const fijada = process.env.DIR_MODO_PRUEBA?.trim();
  if (fijada) return path.resolve(/*turbopackIgnore: true*/ fijada);
  const local = process.env.BD_LOCAL?.trim();
  // Las pruebas en memoria nunca escriben en la carpeta del proyecto.
  if (local === "memoria") return path.join(os.tmpdir(), `crm-modo-prueba-${process.pid}`);
  if (local) return path.resolve(/*turbopackIgnore: true*/ local, "modo-prueba");
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "datos", "modo-prueba");
}

/** La sesión de WhatsApp del móvil vinculado. Se borra entera al desvincular. */
export function carpetaSesion(): string {
  return path.join(carpetaModoPrueba(), "sesion");
}

export function archivoModoPrueba(): string {
  return path.join(carpetaModoPrueba(), "estado.json");
}

/** Donde se instala Baileys, fuera de las dependencias del CRM (en .gitignore). */
export function carpetaHerramienta(): string {
  const fijada = process.env.DIR_HERRAMIENTA_MODO_PRUEBA?.trim();
  if (fijada) return path.resolve(/*turbopackIgnore: true*/ fijada);
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ".herramientas", "modo-prueba");
}

/** El puerto del puente: PUERTO_MODO_PRUEBA o, si no, el del CRM más 2000 (8000 → 10000). */
export function puertoPuente(): number {
  const fijado = Number(process.env.PUERTO_MODO_PRUEBA);
  if (Number.isInteger(fijado) && fijado > 0 && fijado < 65536) return fijado;
  const crm = Number(process.env.PUERTO || "8000");
  return (Number.isInteger(crm) && crm > 0 ? crm : 8000) + DISTANCIA_PUERTO;
}

// ---- El archivo, con una caché por fecha de cambio ----

interface Cache { archivo: string; cambio: number; valor: ConfigModoPrueba | null }
const g = globalThis as unknown as { __modoPrueba?: Cache };

function valida(datos: unknown): ConfigModoPrueba | null {
  if (typeof datos !== "object" || datos === null) return null;
  const d = datos as Record<string, unknown>;
  if (d.modo !== "prueba" || typeof d.secreto !== "string" || d.secreto.length < 32) return null;
  const permitidos = Array.isArray(d.permitidos) ? d.permitidos.filter((p): p is string => typeof p === "string" && /^\d{6,15}$/.test(p)) : [];
  return { version: 1, modo: "prueba", secreto: d.secreto, permitidos, aceptadoEn: typeof d.aceptadoEn === "number" ? d.aceptadoEn : 0 };
}

/** La configuración del modo prueba, o null si no está elegido. Nunca lanza. */
export function leerModoPrueba(): ConfigModoPrueba | null {
  const archivo = archivoModoPrueba();
  let cambio: number;
  try {
    cambio = statSync(archivo).mtimeMs;
  } catch {
    g.__modoPrueba = { archivo, cambio: -1, valor: null };
    return null;
  }
  const cache = g.__modoPrueba;
  if (cache && cache.archivo === archivo && cache.cambio === cambio) return cache.valor;
  let valor: ConfigModoPrueba | null = null;
  try {
    valor = valida(JSON.parse(readFileSync(archivo, "utf8")));
  } catch {
    valor = null;
  }
  g.__modoPrueba = { archivo, cambio, valor };
  return valor;
}

/** Por dónde sale WhatsApp. En modo servidor, siempre por Meta. */
export function modoWhatsApp(): "oficial" | "prueba" {
  if (modoServidor()) return "oficial";
  return leerModoPrueba() ? "prueba" : "oficial";
}

function escribir(c: ConfigModoPrueba): ConfigModoPrueba {
  const carpeta = carpetaModoPrueba();
  mkdirSync(carpeta, { recursive: true, mode: 0o700 });
  const archivo = archivoModoPrueba();
  const temporal = `${archivo}.${process.pid}.tmp`;
  writeFileSync(temporal, JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(temporal, archivo);
  delete g.__modoPrueba;
  return c;
}

/** Elige el modo prueba (el dueño ha marcado «Entiendo que es solo para probar»). Conserva la lista que hubiera. */
export function activarModoPrueba(ahora = Date.now()): ConfigModoPrueba {
  if (modoServidor()) throw new Error("El modo prueba solo funciona en este ordenador");
  const antes = leerModoPrueba();
  return escribir({ version: 1, modo: "prueba", secreto: antes?.secreto ?? randomBytes(32).toString("base64url"), permitidos: antes?.permitidos ?? [], aceptadoEn: ahora });
}

export function guardarPermitidos(numeros: string[]): ConfigModoPrueba {
  const actual = leerModoPrueba();
  if (!actual) throw new Error("El modo prueba no está elegido");
  return escribir({ ...actual, permitidos: [...numeros] });
}

/** Vuelve a la vía oficial: borra el interruptor, el secreto, la lista y la sesión. */
export function borrarModoPrueba(): void {
  rmSync(carpetaModoPrueba(), { recursive: true, force: true });
  delete g.__modoPrueba;
}

/**
 * Adónde van los envíos de lib/whatsapp.ts en modo prueba: el «Graph» del puente, con el secreto
 * del modo prueba como token. null = vía oficial (GRAPH_BASE_URL y las claves de .env, como siempre).
 */
export function destinoModoPrueba(): { base: string; numero: string; token: string } | null {
  if (modoWhatsApp() !== "prueba") return null;
  const c = leerModoPrueba();
  if (!c) return null;
  return { base: `http://127.0.0.1:${puertoPuente()}/graph`, numero: "modo-prueba", token: c.secreto };
}
