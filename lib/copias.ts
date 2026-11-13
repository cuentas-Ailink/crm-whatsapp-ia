import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { copiaDeDatos, queBaseDeDatos } from "./conexion";
import { log, logError } from "./log";

// Las copias diarias del modo servidor: un .tar.gz de la carpeta de PGlite al día, las 14 últimas, en
// `copias/`. Llevan teléfonos y conversaciones: la carpeta es solo del usuario del CRM (0700) y cada
// archivo también (0600). Con Supabase no hay copias aquí: Supabase guarda las suyas.

const UN_DIA_MS = 24 * 60 * 60 * 1000;
/** Si la base de datos aún no se ha abierto al arrancar, se vuelve a mirar cada minuto, una hora como mucho. */
const REINTENTO_MS = 60 * 1000;
const REINTENTOS = 60;
const PATRON = /^datos-\d{4}-\d{2}-\d{2}\.tar\.gz$/;

interface EstadoCopias {
  carpeta: string;
  guardar: number;
}

const global_ = globalThis as unknown as { __crmCopias?: EstadoCopias };

function opciones(): EstadoCopias {
  return global_.__crmCopias ?? { carpeta: "copias", guardar: 14 };
}

/** Las copias de esta carpeta, de la más vieja a la más nueva (el nombre lleva la fecha). */
function copiasGuardadas(carpeta: string): string[] {
  try {
    return readdirSync(carpeta)
      .filter((nombre) => PATRON.test(nombre))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Guarda la copia de hoy (fecha UTC) y borra las que sobran. Devuelve la ruta del archivo, o null si no
 * hay nada que copiar (Supabase, memoria, base de datos aún sin abrir) o si algo falla. Nunca lanza.
 */
export async function hacerCopia(ahora: Date): Promise<string | null> {
  const { carpeta, guardar } = opciones();
  let temporal: string | null = null;
  try {
    const datos = await copiaDeDatos();
    if (!datos) return null;
    mkdirSync(carpeta, { recursive: true, mode: 0o700 });
    chmodSync(carpeta, 0o700);
    const nombre = `datos-${ahora.toISOString().slice(0, 10)}.tar.gz`;
    const destino = path.join(/*turbopackIgnore: true*/ carpeta, nombre);
    // Primero un archivo temporal y luego se cambia de nombre: nunca queda una copia a medias.
    temporal = path.join(/*turbopackIgnore: true*/ carpeta, `.${nombre}.${process.pid}.tmp`);
    writeFileSync(temporal, datos, { mode: 0o600 });
    chmodSync(temporal, 0o600);
    renameSync(temporal, destino);
    temporal = null;
    const todas = copiasGuardadas(carpeta);
    for (const vieja of todas.slice(0, Math.max(0, todas.length - guardar))) {
      rmSync(path.join(/*turbopackIgnore: true*/ carpeta, vieja), { force: true });
    }
    log(`Copia de tus datos guardada en ${path.join(/*turbopackIgnore: true*/ carpeta, nombre)}`);
    return destino;
  } catch (error) {
    if (temporal) {
      try {
        unlinkSync(temporal);
      } catch {
        // Ya no estaba.
      }
    }
    logError("al guardar la copia de tus datos", error);
    return null;
  }
}

/** Si la copia más nueva tiene menos de 24 h, hoy ya hay copia. */
function hayCopiaReciente(carpeta: string, ahora: number): boolean {
  const ultima = copiasGuardadas(carpeta).at(-1);
  if (!ultima) return false;
  try {
    return ahora - statSync(path.join(/*turbopackIgnore: true*/ carpeta, ultima)).mtimeMs < UN_DIA_MS;
  } catch {
    return false;
  }
}

/** PGlite en una carpeta: la copia solo puede salir vacía porque nadie ha abierto aún la base de datos. */
function datosEnCarpeta(): boolean {
  try {
    const motor = queBaseDeDatos();
    return motor.motor === "pglite" && motor.carpeta !== "memoria";
  } catch {
    return false;
  }
}

/** La copia del arranque. La base de datos se abre con la primera petición: hasta entonces, se espera. */
async function copiaAlArrancar(intento: number): Promise<void> {
  if ((await hacerCopia(new Date())) !== null) return;
  if (intento >= REINTENTOS || !datosEnCarpeta()) return;
  setTimeout(() => void copiaAlArrancar(intento + 1), REINTENTO_MS).unref();
}

/**
 * Programa las copias una sola vez por proceso: al arrancar, si no hay ninguna o la última tiene más
 * de 24 h; después, cada 24 h. Si el CRM estaba parado a esa hora, la copia la hace el siguiente arranque.
 */
export function programarCopias(o: { carpeta?: string; guardar?: number } = {}): void {
  if (global_.__crmCopias) return;
  const estado: EstadoCopias = { carpeta: o.carpeta ?? "copias", guardar: o.guardar ?? 14 };
  global_.__crmCopias = estado;
  if (!hayCopiaReciente(estado.carpeta, Date.now())) void copiaAlArrancar(1);
  setInterval(() => void hacerCopia(new Date()), UN_DIA_MS).unref();
}
