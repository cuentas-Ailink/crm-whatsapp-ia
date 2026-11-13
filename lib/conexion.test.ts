import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ARCHIVO_CERROJO, conectar, copiaDeDatos, queBaseDeDatos } from "./conexion";
import { ErrorCrm, explicarBd } from "./errores";

// Las carpetas de prueba van en la carpeta temporal del sistema: nunca la carpeta `datos` del proyecto.
const carpetas: string[] = [];
function carpetaNueva(): string {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), "crm-conexion-"));
  carpetas.push(carpeta);
  return carpeta;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const carpeta of carpetas) rmSync(carpeta, { recursive: true, force: true });
});

describe("qué base de datos", () => {
  const datos = path.join(process.cwd(), "datos");
  it.each([
    [{ BD_LOCAL: "memoria", SUPABASE_DB_URL: "postgres://x" }, { motor: "pglite", carpeta: "memoria" }],
    [{ BD_LOCAL: "bd-pruebas/servidor" }, { motor: "pglite", carpeta: "bd-pruebas/servidor" }],
    [{ SUPABASE_DB_URL: "postgres://usuario@host:5432/postgres" }, { motor: "supabase", url: "postgres://usuario@host:5432/postgres" }],
    [{ BD_LOCAL: "", SUPABASE_DB_URL: "postgres://x" }, { motor: "supabase", url: "postgres://x" }],
    [{}, { motor: "pglite", carpeta: datos }],
    [{ BD_LOCAL: "", SUPABASE_DB_URL: "" }, { motor: "pglite", carpeta: datos }],
  ])("%o → %o", (env, esperado) => {
    expect(queBaseDeDatos(env)).toEqual(esperado);
  });
});

describe("el cerrojo de la carpeta", () => {
  it("con otro proceso vivo dentro, no se abre", async () => {
    const carpeta = carpetaNueva();
    writeFileSync(path.join(carpeta, ARCHIVO_CERROJO), JSON.stringify({ pid: process.ppid, desde: Date.now() }));
    vi.stubEnv("BD_LOCAL", carpeta);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = await conectar().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorCrm);
    expect((error as ErrorCrm).codigo).toBe("bd.ocupada");
    expect(explicarBd(error).titulo).toBe("Ya hay un CRM abierto con estos datos en este ordenador.");
    // El cerrojo sigue siendo del otro.
    expect(JSON.parse(readFileSync(path.join(carpeta, ARCHIVO_CERROJO), "utf8")).pid).toBe(process.ppid);
  });

  it("si el proceso que lo tenía ya no existe, se coge; al cerrar se suelta", async () => {
    const carpeta = carpetaNueva();
    const muerto = spawnSync(process.execPath, ["-e", ""]).pid;
    const archivo = path.join(carpeta, ARCHIVO_CERROJO);
    writeFileSync(archivo, JSON.stringify({ pid: muerto, desde: 1 }));
    vi.stubEnv("BD_LOCAL", carpeta);
    const bd = await conectar();
    try {
      expect(JSON.parse(readFileSync(archivo, "utf8")).pid).toBe(process.pid);
      expect(await bd.filas("SELECT 1 AS uno")).toEqual([{ uno: 1 }]);
    } finally {
      await bd.cerrar();
    }
    expect(existsSync(archivo)).toBe(false);
  }, 60_000);

  it("volver a abrir la misma carpeta en el mismo proceso reutiliza el cerrojo", async () => {
    const carpeta = carpetaNueva();
    vi.stubEnv("BD_LOCAL", carpeta);
    const primera = await conectar();
    await primera.cerrar();
    writeFileSync(path.join(carpeta, ARCHIVO_CERROJO), JSON.stringify({ pid: process.pid, desde: 1 }));
    const segunda = await conectar();
    try {
      expect(JSON.parse(readFileSync(path.join(carpeta, ARCHIVO_CERROJO), "utf8")).pid).toBe(process.pid);
    } finally {
      await segunda.cerrar();
    }
  }, 60_000);

  it("en memoria no hay cerrojo ni copia", async () => {
    vi.stubEnv("BD_LOCAL", "memoria");
    const bd = await conectar();
    try {
      expect(existsSync(path.join("memoria", ARCHIVO_CERROJO))).toBe(false);
      expect(await copiaDeDatos()).toBeNull();
    } finally {
      await bd.cerrar();
    }
  });
});

describe("la copia de los datos", () => {
  it("es un gzip de la carpeta abierta, y null cuando ya está cerrada", async () => {
    const carpeta = carpetaNueva();
    vi.stubEnv("BD_LOCAL", carpeta);
    const bd = await conectar();
    let copia: Uint8Array | null;
    try {
      await bd.ejecutar("CREATE TABLE prueba (n integer)");
      copia = await copiaDeDatos();
    } finally {
      await bd.cerrar();
    }
    expect(copia).toBeInstanceOf(Uint8Array);
    expect(copia?.length).toBeGreaterThan(100);
    expect([copia?.[0], copia?.[1]]).toEqual([0x1f, 0x8b]);
    expect(await copiaDeDatos()).toBeNull();
  }, 60_000);
});
