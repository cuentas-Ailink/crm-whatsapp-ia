import { createHash, createHmac, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as envNext from "@next/env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  asegurarSecreto,
  cabeceraCookie,
  codigoAltaValido,
  comprobarClave,
  cookieCaducada,
  errorDeClavePanel,
  firmarSesion,
  hashClave,
  intentoLogin,
  olvidarIntentos,
  REGLA_CLAVE_PANEL,
  verificarCookie,
} from "./sesion";

// guardarClave es la de verdad salvo cuando una prueba le pide otra cosa.
vi.mock("./claves", async (original) => {
  const real = await original<typeof import("./claves")>();
  return { ...real, guardarClave: vi.fn(real.guardarClave) };
});
const claves = await import("./claves");
const guardarClave = vi.mocked(claves.guardarClave);

const AHORA = Date.UTC(2026, 10, 13, 10, 0, 0);
const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

let carpeta: string;
let archivo: string;

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), "crm-sesion-"));
  archivo = path.join(carpeta, "claves.env");
  for (const nombre of ["SESION_SECRETO", "CLAVE_PANEL_HASH", "CODIGO_ALTA"]) vi.stubEnv(nombre, undefined);
  vi.stubEnv("ARCHIVO_CLAVES", archivo);
  vi.spyOn(console, "log").mockImplementation(() => {});
  delete (globalThis as { __crmIntentosEntrada?: unknown }).__crmIntentosEntrada;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // Vuelve a la de verdad y olvida las respuestas de una vez que hayan quedado.
  guardarClave.mockReset();
  rmSync(carpeta, { recursive: true, force: true });
});

describe("hashClave da el formato scrypt$15$8$1$…", () => {
  it("con sal y hash en base64url, y dos hashes de la misma contraseña son distintos", async () => {
    const a = await hashClave("una contraseña larga");
    const b = await hashClave("una contraseña larga");
    expect(a).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(a).not.toBe(b);
  });
});

describe("comprobarClave", () => {
  it("la buena sí, la mala no", async () => {
    const hash = await hashClave("contraseña-correcta");
    expect(await comprobarClave("contraseña-correcta", hash)).toBe(true);
    expect(await comprobarClave("contraseña-incorrecta", hash)).toBe(false);
    expect(await comprobarClave("", hash)).toBe(false);
  });

  it("un hash malformado da false sin lanzar", async () => {
    for (const malo of ["", "scrypt", "scrypt$15$8$1$$", "bcrypt$15$8$1$abc$def", "scrypt$99$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA", "scrypt$x$8$1$a$b", "scrypt$15$8$1$a$b$c"]) {
      await expect(comprobarClave("lo que sea", malo)).resolves.toBe(false);
    }
  });

  it("un hash hecho con N = 2^14 sigue valiendo", async () => {
    const sal = Buffer.from("sal-de-dieciseis");
    const hash = scryptSync("otra contraseña", sal, 64, { N: 2 ** 14, r: 8, p: 1 });
    const guardado = `scrypt$14$8$1$${sal.toString("base64url")}$${hash.toString("base64url")}`;
    expect(await comprobarClave("otra contraseña", guardado)).toBe(true);
    expect(await comprobarClave("otra contraseña.", guardado)).toBe(false);
  });
});

describe("la regla de la contraseña", () => {
  it("de 10 a 200 caracteres", () => {
    expect(errorDeClavePanel("123456789")).toBe(REGLA_CLAVE_PANEL.corta);
    expect(errorDeClavePanel("1234567890")).toBeNull();
    expect(errorDeClavePanel("a".repeat(200))).toBeNull();
    expect(errorDeClavePanel("a".repeat(201))).toBe(REGLA_CLAVE_PANEL.larga);
    expect(errorDeClavePanel(undefined)).toBe(REGLA_CLAVE_PANEL.corta);
    expect(REGLA_CLAVE_PANEL.corta).toBe("La contraseña necesita al menos 10 caracteres");
    expect(REGLA_CLAVE_PANEL.larga).toBe("La contraseña puede tener como mucho 200 caracteres");
  });
});

describe("firmarSesion y verificarCookie", () => {
  beforeEach(() => {
    vi.stubEnv("SESION_SECRETO", "secreto-de-la-sesion");
    vi.stubEnv("CLAVE_PANEL_HASH", "scrypt$15$8$1$sal$hash");
  });

  it("una cookie recién firmada vale hasta los 30 días", () => {
    const cookie = firmarSesion(AHORA);
    expect(verificarCookie(cookie, AHORA)).toBe(true);
    expect(verificarCookie(cookie, AHORA + TREINTA_DIAS_MS - 1)).toBe(true);
    expect(verificarCookie(cookie, AHORA + TREINTA_DIAS_MS)).toBe(false);
    expect(verificarCookie(cookie, AHORA + TREINTA_DIAS_MS + 1)).toBe(false);
  });

  it("lleva la huella del hash y la caducidad, nada más", () => {
    const [payload] = firmarSesion(AHORA).split(".");
    const datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(datos).toEqual({ v: createHash("sha256").update("scrypt$15$8$1$sal$hash").digest("hex").slice(0, 16), exp: AHORA + TREINTA_DIAS_MS });
  });

  it("vacía, malformada, con el contenido o la firma cambiados: no vale", () => {
    const cookie = firmarSesion(AHORA);
    const [payload, firma] = cookie.split(".");
    const otroPayload = Buffer.from(JSON.stringify({ v: JSON.parse(Buffer.from(payload, "base64url").toString()).v, exp: AHORA + 10 * TREINTA_DIAS_MS })).toString("base64url");
    const firmaCambiada = `${firma.slice(0, -2)}${firma.endsWith("AA") ? "BB" : "AA"}`;
    for (const mala of [null, "", "sin-punto", ".", `${payload}.`, `.${firma}`, `${otroPayload}.${firma}`, `${payload}.${firmaCambiada}`, `${cookie}.x`]) {
      expect(verificarCookie(mala, AHORA)).toBe(false);
    }
  });

  it("firmada con otro SESION_SECRETO: no vale", () => {
    const [payload] = firmarSesion(AHORA).split(".");
    const ajena = `${payload}.${createHmac("sha256", "otro-secreto").update(payload).digest("base64url")}`;
    expect(verificarCookie(ajena, AHORA)).toBe(false);
    const cookie = firmarSesion(AHORA);
    vi.stubEnv("SESION_SECRETO", "otro-secreto");
    expect(verificarCookie(cookie, AHORA)).toBe(false);
  });

  it("sin SESION_SECRETO o sin CLAVE_PANEL_HASH: no vale ninguna y no se puede firmar", () => {
    const cookie = firmarSesion(AHORA);
    vi.stubEnv("SESION_SECRETO", undefined);
    expect(verificarCookie(cookie, AHORA)).toBe(false);
    expect(() => firmarSesion(AHORA)).toThrow();
    vi.stubEnv("SESION_SECRETO", "secreto-de-la-sesion");
    vi.stubEnv("CLAVE_PANEL_HASH", "");
    expect(verificarCookie(cookie, AHORA)).toBe(false);
    expect(() => firmarSesion(AHORA)).toThrow();
  });
});

describe("cambiar la contraseña revoca las cookies", () => {
  it("una cookie de otro hash no vale", () => {
    vi.stubEnv("SESION_SECRETO", "secreto-de-la-sesion");
    vi.stubEnv("CLAVE_PANEL_HASH", "scrypt$15$8$1$sal$hash-viejo");
    const vieja = firmarSesion(AHORA);
    vi.stubEnv("CLAVE_PANEL_HASH", "scrypt$15$8$1$sal$hash-nuevo");
    expect(verificarCookie(vieja, AHORA)).toBe(false);
    expect(verificarCookie(firmarSesion(AHORA), AHORA)).toBe(true);
  });
});

describe("cabeceraCookie y cookieCaducada", () => {
  it("las cadenas exactas", () => {
    expect(cabeceraCookie("abc.def")).toBe("crm_sesion=abc.def; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000");
    expect(cookieCaducada()).toBe("crm_sesion=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  });
});

describe("intentoLogin", () => {
  it("5 permitidos y el 6.º no; a los 10 minutos otra vez", () => {
    for (let i = 0; i < 5; i++) expect(intentoLogin("198.51.100.1", AHORA + i * 1000)).toEqual({ permitido: true });
    expect(intentoLogin("198.51.100.1", AHORA + 6000)).toEqual({ permitido: false });
    expect(intentoLogin("198.51.100.1", AHORA + 10 * 60 * 1000 - 1)).toEqual({ permitido: false });
    expect(intentoLogin("198.51.100.1", AHORA + 10 * 60 * 1000)).toEqual({ permitido: true });
  });

  it("cada IP va por su lado", () => {
    for (let i = 0; i < 5; i++) intentoLogin("198.51.100.2", AHORA);
    expect(intentoLogin("198.51.100.2", AHORA).permitido).toBe(false);
    expect(intentoLogin("198.51.100.3", AHORA).permitido).toBe(true);
    expect(intentoLogin("sin-ip", AHORA).permitido).toBe(true);
  });

  it("olvidarIntentos deja entrar otra vez al momento", () => {
    for (let i = 0; i < 5; i++) intentoLogin("198.51.100.4", AHORA);
    expect(intentoLogin("198.51.100.4", AHORA).permitido).toBe(false);
    olvidarIntentos("198.51.100.4");
    expect(intentoLogin("198.51.100.4", AHORA).permitido).toBe(true);
  });
});

describe("codigoAltaValido", () => {
  it("el bueno, con espacios, guiones y en minúsculas", () => {
    vi.stubEnv("CODIGO_ALTA", "ABCD-EFGH-1234");
    for (const bueno of ["ABCD-EFGH-1234", " abcd efgh 1234 ", "abcdefgh1234", "AbCd-efgh-1234\n"]) expect(codigoAltaValido(bueno)).toBe(true);
  });
  it("uno malo o vacío", () => {
    vi.stubEnv("CODIGO_ALTA", "ABCD-EFGH-1234");
    for (const malo of ["ABCD-EFGH-1235", "", "   ", "-", "ABCD"]) expect(codigoAltaValido(malo)).toBe(false);
  });
  it("sin CODIGO_ALTA no vale ninguno", () => {
    expect(codigoAltaValido("ABCD-EFGH-1234")).toBe(false);
    vi.stubEnv("CODIGO_ALTA", "");
    expect(codigoAltaValido("")).toBe(false);
  });
});

describe("asegurarSecreto", () => {
  it("sin secreto lo genera y lo guarda", async () => {
    guardarClave.mockResolvedValueOnce({ ok: true, terminaEn: "…abcd" });
    await asegurarSecreto();
    expect(guardarClave).toHaveBeenCalledTimes(1);
    const [nombre, valor] = guardarClave.mock.calls[0];
    expect(nombre).toBe("SESION_SECRETO");
    expect(Buffer.from(valor, "base64url")).toHaveLength(32);
  });
  it("con secreto no hace nada", async () => {
    vi.stubEnv("SESION_SECRETO", "ya-hay-uno");
    await asegurarSecreto();
    expect(guardarClave).not.toHaveBeenCalled();
  });
  it("si no se puede guardar, lanza", async () => {
    guardarClave.mockResolvedValueOnce({ ok: false, error: "sin permiso" });
    await expect(asegurarSecreto()).rejects.toThrow();
  });
  it("con el guardarClave de verdad queda en el archivo y en process.env", async () => {
    await asegurarSecreto();
    expect(process.env.SESION_SECRETO).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(archivo, "utf8")).toContain("SESION_SECRETO=");
  });
});

describe("el hash sobrevive a guardarClave", () => {
  it("lo que se lee del archivo, como lo lee Next, es idéntico", async () => {
    expect(process.env.BD_LOCAL).toBeTruthy();
    const hash = await hashClave("contraseña con $dólares$ y \"comillas\"");
    expect(hash).toContain("$");
    const r = await claves.guardarClave("CLAVE_PANEL_HASH", hash);
    expect(r.ok).toBe(true);
    const texto = readFileSync(archivo, "utf8");
    const antes = { ...process.env };
    delete process.env.CLAVE_PANEL_HASH;
    let leido: string | undefined;
    try {
      const modulo = envNext as unknown as { processEnv?: typeof envNext.processEnv; default?: { processEnv: typeof envNext.processEnv } };
      const procesar = modulo.processEnv ?? modulo.default!.processEnv;
      const archivos = [{ path: ".env", contents: texto, env: {} as Record<string, string> }];
      procesar(archivos, undefined, { info: () => {}, error: () => {} }, true);
      leido = archivos[0].env.CLAVE_PANEL_HASH;
    } finally {
      for (const clave of Object.keys(process.env)) if (!(clave in antes)) delete process.env[clave];
      Object.assign(process.env, antes);
    }
    expect(leido).toBe(hash);
    expect(await comprobarClave("contraseña con $dólares$ y \"comillas\"", leido!)).toBe(true);
  });
});
