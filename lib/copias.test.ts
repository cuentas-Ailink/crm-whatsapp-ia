import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hacerCopia, programarCopias } from "./copias";

const conexion = vi.hoisted(() => ({
  copiaDeDatos: vi.fn<() => Promise<Uint8Array | null>>(),
  queBaseDeDatos: vi.fn(() => ({ motor: "pglite", carpeta: "memoria" }) as { motor: "pglite"; carpeta: string }),
}));
vi.mock("./conexion", () => conexion);

const UN_DIA = 24 * 60 * 60 * 1000;
const DATOS = new Uint8Array([0x1f, 0x8b, 1, 2, 3]);

// Cada prueba en su carpeta de la carpeta temporal del sistema: nunca la carpeta `copias` del proyecto.
const carpetas: string[] = [];
let carpeta: string;
let salida: string[];

function usarCarpeta(guardar = 14) {
  (globalThis as { __crmCopias?: unknown }).__crmCopias = { carpeta, guardar };
}

beforeEach(() => {
  carpeta = path.join(mkdtempSync(path.join(os.tmpdir(), "crm-copias-")), "copias");
  carpetas.push(path.dirname(carpeta));
  delete (globalThis as { __crmCopias?: unknown }).__crmCopias;
  conexion.copiaDeDatos.mockReset();
  conexion.copiaDeDatos.mockResolvedValue(DATOS);
  conexion.queBaseDeDatos.mockReset();
  conexion.queBaseDeDatos.mockReturnValue({ motor: "pglite", carpeta: "memoria" });
  salida = [];
  vi.spyOn(console, "log").mockImplementation((...partes: unknown[]) => {
    salida.push(partes.join(" "));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { __crmCopias?: unknown }).__crmCopias;
});

afterAll(() => {
  for (const c of carpetas) rmSync(c, { recursive: true, force: true });
});

describe("hacerCopia", () => {
  it("sin datos que copiar no hay archivo", async () => {
    usarCarpeta();
    conexion.copiaDeDatos.mockResolvedValue(null);
    expect(await hacerCopia(new Date("2026-11-13T10:00:00Z"))).toBeNull();
    expect(existsSync(carpeta)).toBe(false);
    expect(salida).toEqual([]);
  });

  it("nombre por fecha UTC y permisos 0600", async () => {
    usarCarpeta();
    // En Madrid ya es día 14; en UTC aún es 13.
    const ruta = await hacerCopia(new Date("2026-11-13T23:30:00Z"));
    expect(ruta).toBe(path.join(carpeta, "datos-2026-11-13.tar.gz"));
    expect(Array.from(readFileSync(ruta!))).toEqual(Array.from(DATOS));
    expect(statSync(ruta!).mode & 0o777).toBe(0o600);
    expect(statSync(carpeta).mode & 0o777).toBe(0o700);
    expect(salida.join("\n")).toContain(`Copia de tus datos guardada en ${path.join(carpeta, "datos-2026-11-13.tar.gz")}`);
  });

  it("dos copias el mismo día dejan una", async () => {
    usarCarpeta();
    await hacerCopia(new Date("2026-11-13T08:00:00Z"));
    conexion.copiaDeDatos.mockResolvedValue(new Uint8Array([9, 9, 9]));
    await hacerCopia(new Date("2026-11-13T20:00:00Z"));
    expect(readdirSync(carpeta)).toEqual(["datos-2026-11-13.tar.gz"]);
    expect(Array.from(readFileSync(path.join(carpeta, "datos-2026-11-13.tar.gz")))).toEqual([9, 9, 9]);
  });

  it("se quedan las 14 más nuevas", async () => {
    usarCarpeta();
    await hacerCopia(new Date("2026-11-13T08:00:00Z")); // crea la carpeta
    for (let dia = 1; dia <= 16; dia++) writeFileSync(path.join(carpeta, `datos-2026-10-${String(dia).padStart(2, "0")}.tar.gz`), "x");
    writeFileSync(path.join(carpeta, "notas.txt"), "mío");
    writeFileSync(path.join(carpeta, "datos-a-mano.tar.gz"), "mío");
    await hacerCopia(new Date("2026-11-14T08:00:00Z"));
    const copias = readdirSync(carpeta)
      .filter((n) => /^datos-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(n))
      .sort();
    expect(copias).toHaveLength(14);
    expect(copias[0]).toBe("datos-2026-10-05.tar.gz");
    expect(copias.slice(-2)).toEqual(["datos-2026-11-13.tar.gz", "datos-2026-11-14.tar.gz"]);
    // Lo que no es una copia no se toca.
    expect(existsSync(path.join(carpeta, "notas.txt"))).toBe(true);
    expect(existsSync(path.join(carpeta, "datos-a-mano.tar.gz"))).toBe(true);
  });

  it("un fallo del volcado no lanza", async () => {
    usarCarpeta();
    conexion.copiaDeDatos.mockRejectedValue(new Error("disco lleno"));
    await expect(hacerCopia(new Date("2026-11-13T08:00:00Z"))).resolves.toBeNull();
    expect(salida.join("\n")).toContain("ERROR al guardar la copia de tus datos: disco lleno");
  });

  it("un fallo al escribir no lanza", async () => {
    usarCarpeta();
    writeFileSync(carpeta, "no soy una carpeta");
    await expect(hacerCopia(new Date("2026-11-13T08:00:00Z"))).resolves.toBeNull();
    expect(salida.join("\n")).toContain("ERROR al guardar la copia de tus datos");
  });
});

describe("programarCopias", () => {
  it("copia al arrancar si la última tiene más de 24 h, no si es reciente, y cada 24 h", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));

    // Una copia de hace dos días: toca copiar al arrancar.
    usarCarpeta();
    await hacerCopia(new Date("2026-11-11T09:00:00Z"));
    const vieja = path.join(carpeta, "datos-2026-11-11.tar.gz");
    utimesSync(vieja, new Date("2026-11-11T09:00:00Z"), new Date("2026-11-11T09:00:00Z"));
    delete (globalThis as { __crmCopias?: unknown }).__crmCopias;
    conexion.copiaDeDatos.mockClear();

    programarCopias({ carpeta });
    await vi.waitFor(() => expect(existsSync(path.join(carpeta, "datos-2026-11-13.tar.gz"))).toBe(true));
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(1);

    // Cada 24 h, otra.
    await vi.advanceTimersByTimeAsync(UN_DIA);
    await vi.waitFor(() => expect(existsSync(path.join(carpeta, "datos-2026-11-14.tar.gz"))).toBe(true));
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(2);

    // Otro proceso que arranca con una copia reciente no copia al arrancar.
    vi.clearAllTimers();
    delete (globalThis as { __crmCopias?: unknown }).__crmCopias;
    conexion.copiaDeDatos.mockClear();
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    utimesSync(path.join(carpeta, "datos-2026-11-14.tar.gz"), new Date("2026-11-14T09:00:00Z"), new Date("2026-11-14T09:00:00Z"));
    programarCopias({ carpeta });
    await vi.advanceTimersByTimeAsync(1000);
    expect(conexion.copiaDeDatos).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UN_DIA);
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(1);
  });

  it("sin ninguna copia, copia al arrancar; si la base de datos aún no está abierta, lo reintenta", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));
    conexion.queBaseDeDatos.mockReturnValue({ motor: "pglite", carpeta: "/opt/crm-whatsapp/datos" });
    conexion.copiaDeDatos.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    programarCopias({ carpeta });
    await vi.advanceTimersByTimeAsync(0);
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(3);
    expect(readdirSync(carpeta)).toEqual(["datos-2026-11-13.tar.gz"]);
  });

  it("con Supabase no reintenta ni escribe nada", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    conexion.queBaseDeDatos.mockReturnValue({ motor: "supabase", url: "postgres://x" } as never);
    conexion.copiaDeDatos.mockResolvedValue(null);
    programarCopias({ carpeta });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(1);
    expect(existsSync(carpeta)).toBe(false);
  });

  it("programarCopias solo se programa una vez", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));
    programarCopias({ carpeta });
    programarCopias({ carpeta });
    programarCopias();
    await vi.advanceTimersByTimeAsync(0);
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UN_DIA);
    expect(conexion.copiaDeDatos).toHaveBeenCalledTimes(2);
  });
});
