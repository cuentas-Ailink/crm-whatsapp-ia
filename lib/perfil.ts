import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SectorPreset } from "./configuracion";
import { leerTitulo } from "./negocio";
import { logAviso, logError } from "./log";
import { PRESETS } from "./presets";

// agente.md se lee del disco en cada mensaje: si se cambia y se guarda, el siguiente
// mensaje ya usa el nuevo, sin reiniciar. Si el archivo está a medio guardar (vacío o casi),
// se usa la última versión válida para que el agente no se quede sin instrucciones.
// Para no leerlo entero cada vez, se mira antes su fecha y su tamaño: un `cp` cambia los dos.

const MINIMO_CARACTERES = 50;
const UN_MINUTO = 60_000;

export interface Perfil {
  id: string;
  nombre: string;
  instrucciones: string;
  /** Huella del texto: dice si alguien lo ha cambiado mientras se editaba. */
  hash: string;
}

interface Leido {
  mtimeMs: number;
  size: number;
  perfil: Perfil | null; // null: el archivo estaba casi vacío
}

const global_ = globalThis as unknown as {
  __ultimosPerfiles?: Map<string, Perfil>;
  __perfilesLeidos?: Map<string, Leido>;
  __avisosPerfil?: Map<string, number>;
};

/** Un aviso rojo de este módulo sale como mucho una vez por minuto. */
function avisarCadaMinuto(clave: string, avisar: () => void): void {
  global_.__avisosPerfil ??= new Map();
  const ahora = Date.now();
  const ultimo = global_.__avisosPerfil.get(clave);
  if (ultimo !== undefined && ahora - ultimo < UN_MINUTO) return;
  global_.__avisosPerfil.set(clave, ahora);
  avisar();
}

/** El archivo de instrucciones del asistente, en la carpeta del CRM. */
export function rutaAgente(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "agente.md");
}

/** SHA-1 en hexadecimal, los 12 primeros caracteres. */
export function hashTexto(texto: string): string {
  return createHash("sha1").update(texto).digest("hex").slice(0, 12);
}

function perfilDe(instrucciones: string): Perfil {
  return { ...leerTitulo(instrucciones), instrucciones, hash: hashTexto(instrucciones) };
}

function codigo(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

/**
 * Lee un archivo de instrucciones con la caché por fecha y tamaño. Devuelve null si está casi vacío.
 * Lanza el error del sistema de archivos (ENOENT si no existe).
 */
async function leerConCache(ruta: string): Promise<Perfil | null> {
  global_.__perfilesLeidos ??= new Map();
  const datos = await stat(ruta);
  const previo = global_.__perfilesLeidos.get(ruta);
  if (previo && previo.mtimeMs === datos.mtimeMs && previo.size === datos.size) return previo.perfil;
  const instrucciones = await readFile(ruta, "utf8");
  const perfil = instrucciones.trim().length >= MINIMO_CARACTERES ? perfilDe(instrucciones) : null;
  global_.__perfilesLeidos.set(ruta, { mtimeMs: datos.mtimeMs, size: datos.size, perfil });
  return perfil;
}

export async function leerPerfil(ruta: string = rutaAgente()): Promise<Perfil> {
  global_.__ultimosPerfiles ??= new Map();
  try {
    const perfil = await leerConCache(ruta);
    if (perfil) {
      global_.__ultimosPerfiles.set(ruta, perfil);
      return perfil;
    }
    avisarCadaMinuto(`casi-vacio:${ruta}`, () => logAviso("agente.md está casi vacío: se usa la última versión válida"));
  } catch (error) {
    if (codigo(error) === "ENOENT") {
      // Sin agente.md (F23): las instrucciones de reformas, solo en memoria, hasta que se guarde uno.
      try {
        const respaldo = await leerConCache(path.join(/*turbopackIgnore: true*/ process.cwd(), PRESETS.reformas.archivo));
        if (respaldo) {
          avisarCadaMinuto("falta-agente", () => logAviso("Falta agente.md: se usan las instrucciones de perfiles/reformas.md"));
          return respaldo;
        }
      } catch {
        // Sin respaldo: queda la última versión válida, si la hay.
      }
    }
    avisarCadaMinuto(`error:${ruta}`, () => logError("al leer agente.md", error));
  }
  const ultimo = global_.__ultimosPerfiles.get(ruta);
  if (ultimo) return ultimo;
  throw new Error("No hay instrucciones válidas en agente.md");
}

/**
 * Guarda las instrucciones del asistente de una vez: se escriben en un archivo temporal al lado y se
 * cambia de nombre, así nadie lee nunca un archivo a medias. Si el sistema no deja cambiar el nombre
 * (EPERM o EBUSY, típico de Windows con el archivo abierto), se escribe encima. Lanza el error del
 * sistema de archivos tal cual: quien llama lo explica en español.
 */
export async function escribirAgente(texto: string, ruta: string = rutaAgente()): Promise<Perfil> {
  const temporal = `${ruta}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temporal, texto, "utf8");
    try {
      await rename(temporal, ruta);
    } catch (error) {
      const c = codigo(error);
      if (c !== "EPERM" && c !== "EBUSY") throw error;
      await writeFile(ruta, texto, "utf8");
      await unlink(temporal).catch(() => {});
    }
  } catch (error) {
    await unlink(temporal).catch(() => {});
    throw error;
  }
  const perfil = perfilDe(texto);
  global_.__ultimosPerfiles ??= new Map();
  global_.__perfilesLeidos ??= new Map();
  global_.__ultimosPerfiles.set(ruta, perfil);
  try {
    const datos = await stat(ruta);
    global_.__perfilesLeidos.set(ruta, { mtimeMs: datos.mtimeMs, size: datos.size, perfil });
  } catch {
    global_.__perfilesLeidos.delete(ruta);
  }
  return perfil;
}

/** Las instrucciones de partida de un sector, tal como vienen en perfiles/. */
export async function leerPreset(id: SectorPreset): Promise<string> {
  return readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), PRESETS[id].archivo), "utf8");
}
