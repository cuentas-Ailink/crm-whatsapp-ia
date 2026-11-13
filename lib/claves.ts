// Las claves que se pegan en la app: se comprueban, se guardan en el archivo de claves y valen al
// momento, sin reiniciar. Solo en el servidor. Ningún valor sale del proceso: lo único que se enseña
// son sus cuatro últimos caracteres («…abcd»).

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as envNext from "@next/env";
import type { EstadoClave, NombreClave } from "./api-tipos";
import { cambioDeSistema } from "./cambio-sistema";
import { explicar, explicarClaude, type ErrorExplicado } from "./errores";
import { log } from "./log";

/** Lo que un navegador puede guardar. El servidor guarda además las que genera o elige él. */
export const CLAVES_DESDE_EL_PANEL: readonly NombreClave[] = [
  "ANTHROPIC_API_KEY",
  "WHATSAPP_TOKEN",
  "META_APP_SECRET",
  "NGROK_AUTHTOKEN",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
] as const;

/** Todos los nombres que se pueden escribir en el archivo de claves. Nada de puertos, URL ni BD_LOCAL (I22). */
const NOMBRES: ReadonlySet<string> = new Set<NombreClave>([
  ...CLAVES_DESDE_EL_PANEL,
  "WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "SESION_SECRETO",
  "CLAVE_PANEL_HASH",
  "CODIGO_ALTA",
]);

const SALTO = "Esa clave lleva un salto de línea: vuelve a copiarla";
const NO_SE_PUEDE = "No se ha podido guardar la clave: tiene caracteres que no se pueden guardar";
const TIEMPO_CLAUDE_MS = 10_000;

const global_ = globalThis as unknown as { __claves?: { cola: Promise<unknown> } };

/** Todas las escrituras del archivo de claves, una detrás de otra: dos guardados nunca se pisan. */
function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const estado = (global_.__claves ??= { cola: Promise.resolve() });
  const resultado = estado.cola.then(tarea, tarea);
  estado.cola = resultado.catch(() => undefined);
  return resultado;
}

/** El archivo donde se guardan las claves. Con BD_LOCAL y sin ARCHIVO_CLAVES no hay ninguno. */
export function archivoDeClaves(): string {
  const fijado = process.env.ARCHIVO_CLAVES?.trim();
  if (fijado) return path.isAbsolute(fijado) ? fijado : path.join(/*turbopackIgnore: true*/ process.cwd(), fijado);
  if (process.env.BD_LOCAL) throw new Error("En el servidor de pruebas las claves van en ARCHIVO_CLAVES");
  const local = path.join(/*turbopackIgnore: true*/ process.cwd(), ".env.local");
  return existsSync(local) ? local : path.join(/*turbopackIgnore: true*/ process.cwd(), ".env");
}

/** NOMBRE="valor", con $ y " escapados. Un salto de línea o un NUL no se pueden guardar. */
export function lineaDeClave(nombre: NombreClave, valor: string): string {
  if (/[\r\n\0]/.test(valor)) throw new Error(SALTO);
  return `${nombre}="${valor.replace(/\$/g, "\\$").replace(/"/g, '\\"')}"`;
}

/** «…abcd»: lo único que se enseña de una clave. */
export function terminaEn(valor: string | undefined): string | null {
  if (!valor) return null;
  return `…${valor.slice(-4)}`;
}

/** Cada clave que se puede pegar desde el panel: si está guardada y cómo termina. Nunca el valor. */
export function clavesGuardadas(): EstadoClave[] {
  return CLAVES_DESDE_EL_PANEL.map((nombre) => ({
    nombre,
    guardada: !!process.env[nombre],
    terminaEn: terminaEn(process.env[nombre]),
  }));
}

/** De quién es una clave de transcripción, por cómo empieza. Una de Anthropic no es ninguna de ellas. */
export function nombreClaveVoz(valor: string): "GEMINI_API_KEY" | "GROQ_API_KEY" | "OPENAI_API_KEY" | null {
  const limpio = valor.trim();
  if (limpio.startsWith("AIza")) return "GEMINI_API_KEY";
  if (limpio.startsWith("gsk_")) return "GROQ_API_KEY";
  if (limpio.startsWith("sk-ant-")) return null;
  if (limpio.startsWith("sk-")) return "OPENAI_API_KEY";
  return null;
}

// ---- El archivo ----

type ProcesarEnv = typeof envNext.processEnv;
const SILENCIOSO = { info: () => {}, error: () => {} };

/** processEnv de @next/env, venga como export con nombre o dentro del default (CommonJS). */
function procesarEnv(): ProcesarEnv {
  const modulo = envNext as unknown as { processEnv?: ProcesarEnv; default?: { processEnv?: ProcesarEnv } };
  const funcion = modulo.processEnv ?? modulo.default?.processEnv;
  if (!funcion) throw new Error("No se encuentra processEnv de @next/env");
  return funcion;
}

/**
 * Lo que leería Next de ese texto para esa clave, con el mismo lector que usa al arrancar.
 * processEnv escribe en process.env y prefiere el valor que ya está ahí: se quita antes y se deja
 * process.env exactamente como estaba.
 */
function leerComoNext(texto: string, nombre: string): string | undefined {
  const antes = { ...process.env };
  delete process.env[nombre];
  try {
    const archivos = [{ path: ".env", contents: texto, env: {} as Record<string, string> }];
    procesarEnv()(archivos, undefined, SILENCIOSO, true);
    return archivos[0].env[nombre];
  } finally {
    for (const clave of Object.keys(process.env)) if (!(clave in antes)) delete process.env[clave];
    Object.assign(process.env, antes);
  }
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** El comentario del final de una línea sin comillas («VALOR  # nota»), con sus espacios. */
function comentarioFinal(linea: string): string {
  const valor = linea.slice(linea.indexOf("=") + 1).trimStart();
  if (/^["'`]/.test(valor)) return "";
  return valor.match(/\s+#.*$/)?.[0] ?? "";
}

/**
 * El texto nuevo del archivo: la primera línea de esa clave cambia en su sitio, las repetidas se
 * quitan (ganaría la última) y todo lo demás se queda igual, byte a byte. Sin línea, se borra.
 */
function textoNuevo(texto: string, nombre: string, linea: string | null): string {
  const asigna = new RegExp(`^\\s*(export\\s+)?${escaparRegex(nombre)}\\s*=`);
  const lineas = texto.split("\n");
  const salida: string[] = [];
  let puesta = false;
  for (const actual of lineas) {
    const retorno = actual.endsWith("\r") ? "\r" : "";
    const sinRetorno = retorno ? actual.slice(0, -1) : actual;
    if (!asigna.test(sinRetorno)) {
      salida.push(actual);
      continue;
    }
    if (linea !== null && !puesta) {
      salida.push(`${linea}${comentarioFinal(sinRetorno)}${retorno}`);
      puesta = true;
    }
  }
  let nuevo = salida.join("\n");
  if (linea !== null && !puesta) {
    if (nuevo !== "" && !nuevo.endsWith("\n")) nuevo += "\n";
    nuevo += `${linea}\n`;
  }
  return nuevo;
}

function codigoDe(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

/** Por qué no se ha podido escribir, sin la ruta. */
function motivoDe(error: unknown): string {
  const codigo = codigoDe(error);
  if (codigo === "EACCES" || codigo === "EPERM") return "sin permiso de escritura en la carpeta del CRM";
  if (codigo === "ENOSPC") return "el disco está lleno";
  if (codigo === "EROFS") return "la carpeta es de solo lectura";
  return `error del sistema (${codigo ?? "desconocido"})`;
}

async function leerArchivo(archivo: string): Promise<string | null> {
  try {
    return await readFile(archivo, "utf8");
  } catch (error) {
    if (codigoDe(error) === "ENOENT") return null;
    throw error;
  }
}

/** Escribe todo el archivo de una vez (temporal + rename) y lo deja con permisos 600. */
async function escribirArchivo(archivo: string, texto: string): Promise<void> {
  await mkdir(path.dirname(archivo), { recursive: true });
  const temporal = `${archivo}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  await writeFile(temporal, texto, { mode: 0o600 });
  try {
    await rename(temporal, archivo);
  } catch (error) {
    await rm(temporal, { force: true });
    const codigo = codigoDe(error);
    if (codigo !== "EPERM" && codigo !== "EBUSY") throw error;
    await writeFile(archivo, texto, { mode: 0o600 });
  }
  await chmod(archivo, 0o600);
}

/** Guarda una clave en el archivo de claves y en process.env. Comprueba que Next la leerá igual. */
export async function guardarClave(
  nombre: NombreClave,
  valor: string,
): Promise<{ ok: true; terminaEn: string } | { ok: false; error: string }> {
  return enCola(async () => {
    if (!NOMBRES.has(nombre)) return { ok: false, error: "Esa clave no se puede guardar desde aquí" };
    let linea: string;
    try {
      linea = lineaDeClave(nombre, valor);
    } catch {
      return { ok: false, error: SALTO };
    }
    let archivo: string;
    try {
      archivo = archivoDeClaves();
    } catch {
      return { ok: false, error: "No se pueden guardar claves en este servidor de pruebas" };
    }
    try {
      const anterior = await leerArchivo(archivo);
      const nuevo = textoNuevo(anterior ?? "", nombre, linea);
      if (leerComoNext(nuevo, nombre) !== valor) return { ok: false, error: NO_SE_PUEDE };

      await escribirArchivo(archivo, nuevo);

      // Otro proceso puede haber escrito a la vez: lo que hay en el disco tiene que decir lo mismo.
      const escrito = (await leerArchivo(archivo)) ?? "";
      if (leerComoNext(escrito, nombre) !== valor) {
        if (anterior === null) await rm(archivo, { force: true });
        else await escribirArchivo(archivo, anterior);
        return { ok: false, error: NO_SE_PUEDE };
      }
    } catch (error) {
      return { ok: false, error: `No se ha podido guardar la clave: ${motivoDe(error)}` };
    }
    process.env[nombre] = valor;
    // Con la clave nueva, /api/sistema vuelve a mirar y el panel lo pide al momento.
    cambioDeSistema();
    const final = terminaEn(valor) ?? "";
    log(`Clave guardada: ${nombre} (termina en ${final})`);
    return { ok: true, terminaEn: final };
  });
}

/** Quita la clave del archivo y de process.env. Sin archivo o sin la clave, no hace nada. */
export async function borrarClave(nombre: NombreClave): Promise<void> {
  return enCola(async () => {
    const archivo = archivoDeClaves();
    const anterior = await leerArchivo(archivo);
    if (anterior === null) return;
    const nuevo = textoNuevo(anterior, nombre, null);
    if (nuevo === anterior) return;
    await escribirArchivo(archivo, nuevo);
    delete process.env[nombre];
    cambioDeSistema();
    log(`Clave borrada: ${nombre}`);
  });
}

// ---- Claude ----

const SECRETOS_TEXTO = ["ANTHROPIC_API_KEY", "WHATSAPP_TOKEN", "META_APP_SECRET", "NGROK_AUTHTOKEN", "WEBHOOK_VERIFY_TOKEN", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"] as const;

/** Tapa con «•••» toda clave (de process.env o de la petición) que aparezca en un texto y lo deja en 160. */
function limpiar(texto: string, extra: (string | undefined)[] = []): string {
  const valores = new Set<string>();
  for (const nombre of SECRETOS_TEXTO) {
    const valor = process.env[nombre];
    if (valor) valores.add(valor);
  }
  for (const valor of extra) if (valor) valores.add(valor);
  const ordenados = [...valores].filter((v) => v.length >= 6).sort((a, b) => b.length - a.length);
  let salida = texto;
  for (const valor of ordenados) salida = salida.split(valor).join("•••");
  return Array.from(salida).slice(0, 160).join("");
}

/**
 * Comprueba una clave de Claude con una petición de verdad de un token (GET /models diría que sí
 * aunque no haya saldo). `guardable`: la clave ha entrado, aunque ahora no se pueda usar.
 */
export async function comprobarClaveClaude(
  clave?: string,
  modelo?: string,
): Promise<{ ok: true } | { ok: false; error: ErrorExplicado; guardable: boolean }> {
  const usada = clave ?? process.env.ANTHROPIC_API_KEY;
  if (!usada) return { ok: false, error: explicar("claude.clave"), guardable: false };
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { "x-api-key": usada, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: modelo || process.env.MODELO || "claude-haiku-5-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hola" }],
      }),
      signal: AbortSignal.timeout(TIEMPO_CLAUDE_MS),
    });
  } catch {
    return { ok: false, error: explicar("red"), guardable: false };
  }
  const status = respuesta.status;
  if (status === 200) return { ok: true };
  let mensaje = "";
  try {
    const datos = (await respuesta.json()) as { error?: { message?: unknown } };
    if (typeof datos?.error?.message === "string") mensaje = limpiar(datos.error.message, [usada]);
  } catch {
    // Sin cuerpo JSON: solo cuenta el estado.
  }
  if (status === 401) return { ok: false, error: explicarClaude(401), guardable: false };
  if (status === 400 && /credit balance/i.test(mensaje)) return { ok: false, error: explicarClaude(400, mensaje), guardable: true };
  if (status === 400) {
    // Anthropic mira la clave antes que el cuerpo: cualquier otro 400 dice que la clave ha entrado.
    log(`Clave de Claude comprobada; Anthropic avisa: ${mensaje || "petición rechazada (400)"}`);
    return { ok: true };
  }
  if (status === 404) return { ok: false, error: explicarClaude(404), guardable: true };
  if (status === 429 || status === 529) return { ok: false, error: explicarClaude(status), guardable: true };
  return { ok: false, error: explicarClaude(status, mensaje), guardable: false };
}
