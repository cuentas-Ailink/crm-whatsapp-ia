import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { ErrorCrm } from "./errores";
import { logAviso } from "./log";

// La conexión con Postgres. Por defecto es un Postgres embebido, PGlite, en la carpeta `datos` del
// proyecto: no hace falta crear ninguna cuenta. Con SUPABASE_DB_URL en .env, la base de datos de
// Supabase. Las pruebas y el servidor de pruebas usan su propia carpeta o la memoria (BD_LOCAL):
// así nunca tocan los datos reales, aunque SUPABASE_DB_URL esté en .env.

/** Lo que necesita bd.ts para leer y escribir, dentro o fuera de una transacción. */
export interface Consultas {
  filas<T>(sql: string, parametros?: unknown[]): Promise<T[]>;
  /** Devuelve cuántas filas ha cambiado. */
  ejecutar(sql: string, parametros?: unknown[]): Promise<number>;
}

export interface Conexion extends Consultas {
  /** Todo junto o nada: si algo falla, se deshace lo anterior. */
  transaccion<T>(trabajo: (c: Consultas) => Promise<T>): Promise<T>;
  cerrar(): Promise<void>;
}

export type MotorBd = { motor: "pglite"; carpeta: string } | { motor: "supabase"; url: string };

/** Los dos motores devuelven lo mismo: los BIGINT como número (son milisegundos), no como texto. */
const BIGINT = 20;

/** El archivo que dice qué proceso tiene abierta una carpeta de datos. */
export const ARCHIVO_CERROJO = ".crm-abierto";

/**
 * Qué base de datos se usa, en este orden: BD_LOCAL (pruebas y servidor de pruebas), SUPABASE_DB_URL
 * y, si no hay ninguna, PGlite en `./datos`. Una variable vacía cuenta como si no estuviera.
 */
export function queBaseDeDatos(env: Record<string, string | undefined> = process.env): MotorBd {
  const local = env.BD_LOCAL;
  if (local) return { motor: "pglite", carpeta: local };
  const url = env.SUPABASE_DB_URL;
  if (url) return { motor: "supabase", url };
  return { motor: "pglite", carpeta: path.join(/*turbopackIgnore: true*/ process.cwd(), "datos") };
}

export async function conectar(): Promise<Conexion> {
  const motor = queBaseDeDatos();
  return motor.motor === "supabase" ? conectarSupabase(motor.url) : conectarLocal(motor.carpeta);
}

function conectarSupabase(url: string): Conexion {
  // Una consulta preparada hace un viaje de ida y vuelta en vez de dos, y con Supabase cada viaje
  // son decenas de milisegundos. El pooler en modo sesión las admite; en modo transacción (puerto
  // 6543), no. Las que no llevan parámetros, como el esquema, van sin preparar.
  const preparadas = !/:6543\//.test(url);
  const opciones = (parametros: unknown[]) => ({ prepare: preparadas && parametros.length > 0 });
  const sql = postgres(url, {
    prepare: preparadas,
    max: 5,
    // Las conexiones no se cierran al quedarse paradas: abrir una nueva cuesta casi un segundo.
    idle_timeout: 0,
    connect_timeout: 10,
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require",
    types: { milisegundos: { to: BIGINT, from: [BIGINT], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
    // «CREATE TABLE IF NOT EXISTS» avisa de que ya existía: no hace falta verlo en el registro.
    onnotice: () => {},
  });
  const consultas = (s: postgres.Sql | postgres.TransactionSql): Consultas => ({
    filas: async <T>(texto: string, parametros: unknown[] = []) =>
      (await s.unsafe(texto, parametros as postgres.ParameterOrJSON<never>[], opciones(parametros))) as unknown as T[],
    ejecutar: async (texto, parametros = []) =>
      (await s.unsafe(texto, parametros as postgres.ParameterOrJSON<never>[], opciones(parametros))).count,
  });
  return {
    ...consultas(sql),
    transaccion: async (trabajo) => (await sql.begin((tx) => trabajo(consultas(tx)))) as Awaited<ReturnType<typeof trabajo>>,
    cerrar: () => sql.end({ timeout: 5 }),
  };
}

// ---- El cerrojo de la carpeta: dos CRM con los mismos datos se pisarían ----

interface EstadoGlobal {
  /** La base de datos de una carpeta que ha abierto este proceso: la usa `copiaDeDatos`. */
  __pgliteCarpeta?: PGlite;
  /** Los cerrojos que tiene este proceso, para soltarlos al salir. */
  __cerrojosCrm?: Set<string>;
}

const global_ = globalThis as unknown as EstadoGlobal;

function cerrojos(): Set<string> {
  if (!global_.__cerrojosCrm) {
    const lista = new Set<string>();
    global_.__cerrojosCrm = lista;
    // Uno solo por proceso, aunque Next cargue este módulo varias veces.
    process.once("exit", () => {
      for (const archivo of lista) soltarCerrojo(archivo);
    });
  }
  return global_.__cerrojosCrm;
}

/** Un proceso sigue vivo si se le puede mandar la señal 0, o si existe pero no es nuestro (EPERM). */
function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** El pid que guarda el cerrojo, o null si no se puede leer. */
function pidDelCerrojo(archivo: string): number | null {
  try {
    const datos = JSON.parse(readFileSync(archivo, "utf8")) as { pid?: unknown };
    return typeof datos.pid === "number" && Number.isInteger(datos.pid) && datos.pid > 0 ? datos.pid : null;
  } catch {
    return null;
  }
}

function tomarCerrojo(carpeta: string): string {
  const archivo = path.join(carpeta, ARCHIVO_CERROJO);
  // Si otro proceso lo coge justo a la vez, se vuelve a mirar quién lo tiene.
  for (let intento = 0; intento < 5; intento++) {
    try {
      writeFileSync(archivo, JSON.stringify({ pid: process.pid, desde: Date.now() }), { flag: "wx" });
      cerrojos().add(archivo);
      return archivo;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const pid = pidDelCerrojo(archivo);
    if (pid !== null && pid !== process.pid && procesoVivo(pid)) {
      logAviso(`Ya hay un CRM abierto con estos datos en este ordenador (carpeta ${carpeta}, proceso ${pid}). Ciérralo antes de abrir otro.`);
      throw new ErrorCrm("bd.ocupada");
    }
    // Un proceso que ya no existe, este mismo proceso (Next recarga el módulo) o un archivo roto: se coge.
    try {
      unlinkSync(archivo);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new ErrorCrm("bd.ocupada");
}

/** Solo se borra si sigue siendo nuestro. */
function soltarCerrojo(archivo: string): void {
  global_.__cerrojosCrm?.delete(archivo);
  if (pidDelCerrojo(archivo) !== process.pid) return;
  try {
    unlinkSync(archivo);
  } catch {
    // Ya no estaba.
  }
}

async function conectarLocal(carpeta: string): Promise<Conexion> {
  // Solo se carga si hace falta: con Supabase no se usa.
  const { PGlite, types } = await import("@electric-sql/pglite");
  const enMemoria = carpeta === "memoria";
  let cerrojo: string | null = null;
  if (!enMemoria) {
    // PGlite crea la última carpeta, pero no las de encima.
    mkdirSync(carpeta, { recursive: true });
    cerrojo = tomarCerrojo(carpeta);
  }
  let db: PGlite;
  try {
    db = await PGlite.create(enMemoria ? undefined : carpeta, {
      parsers: { [types.INT8]: (x: string) => Number(x) },
    });
  } catch (error) {
    if (cerrojo) soltarCerrojo(cerrojo);
    throw error;
  }
  if (!enMemoria) global_.__pgliteCarpeta = db;
  const consultas = (q: Pick<typeof db, "query">): Consultas => ({
    filas: async <T>(texto: string, parametros: unknown[] = []) => (await q.query<T>(texto, parametros)).rows,
    ejecutar: async (texto, parametros = []) => (await q.query(texto, parametros)).affectedRows ?? 0,
  });
  return {
    ...consultas(db),
    transaccion: (trabajo) => db.transaction((tx) => trabajo(consultas(tx))),
    cerrar: async () => {
      if (global_.__pgliteCarpeta === db) global_.__pgliteCarpeta = undefined;
      try {
        await db.close();
      } finally {
        if (cerrojo) soltarCerrojo(cerrojo);
      }
    },
  };
}

/**
 * Una copia comprimida (gzip) de la carpeta de datos abierta, para las copias diarias. `null` con
 * Supabase, en memoria o si este proceso aún no ha abierto ninguna carpeta.
 */
export async function copiaDeDatos(): Promise<Uint8Array | null> {
  const db = global_.__pgliteCarpeta;
  if (!db) return null;
  return new Uint8Array(await (await db.dumpDataDir("gzip")).arrayBuffer());
}
