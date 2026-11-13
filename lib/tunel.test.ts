import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrirTunel, cerrarTunel, estadoAcceso, estadoTunel, modoServidor, tokenNgrok, urlPublica } from "./tunel";

const ngrok = vi.hoisted(() => ({ forward: vi.fn() }));
vi.mock("@ngrok/ngrok", () => ngrok);

const fs = vi.hoisted(() => ({ readFileSync: vi.fn() }));
vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()), readFileSync: fs.readFileSync }));

const meta = vi.hoisted(() => ({ alAbrirTunel: vi.fn(async () => {}) }));
vi.mock("./meta", () => meta);

const CASA = "/casa/de/prueba";
const plataforma = Object.getOwnPropertyDescriptor(process, "platform")!;
let salida: string[];
let accesos: string[];
let respuestaAcceso: () => Promise<Response>;

function escucha(url: string) {
  return { url: vi.fn(() => url), close: vi.fn(async () => {}) };
}

function fingirPlataforma(valor: string) {
  Object.defineProperty(process, "platform", { ...plataforma, value: valor });
}

beforeEach(() => {
  delete (globalThis as { __tunel?: unknown }).__tunel;
  for (const nombre of ["NGROK_AUTHTOKEN", "NGROK_DOMAIN", "CRM_DOMINIO", "CRM_URL_PUBLICA", "PUERTO"]) vi.stubEnv(nombre, undefined);
  vi.stubEnv("BD_LOCAL", "");
  vi.spyOn(os, "homedir").mockReturnValue(CASA);
  ngrok.forward.mockReset();
  meta.alAbrirTunel.mockClear();
  fs.readFileSync.mockReset();
  fs.readFileSync.mockImplementation(() => {
    throw Object.assign(new Error("no existe"), { code: "ENOENT" });
  });
  salida = [];
  vi.spyOn(console, "log").mockImplementation((...partes: unknown[]) => {
    salida.push(partes.map(String).join(" "));
  });
  accesos = [];
  respuestaAcceso = async () => new Response("No encontrado", { status: 404 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      accesos.push(String(url));
      return respuestaAcceso();
    }),
  );
});

afterEach(async () => {
  await cerrarTunel();
  Object.defineProperty(process, "platform", plataforma);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("tunel", () => {
  it("nunca abre el túnel con BD_LOCAL, CRM_DOMINIO o CRM_URL_PUBLICA", async () => {
    for (const [nombre, valor] of [["BD_LOCAL", "memoria"], ["CRM_DOMINIO", "crm.ejemplo.es"], ["CRM_URL_PUBLICA", "http://127.0.0.1:8124"]]) {
      vi.stubEnv("BD_LOCAL", "");
      vi.stubEnv("CRM_DOMINIO", "");
      vi.stubEnv("CRM_URL_PUBLICA", "");
      vi.stubEnv(nombre, valor);
      expect(await abrirTunel({ token: "ngrok-de-prueba-1" })).toEqual({ abierto: false, url: null, error: null, desde: null });
    }
    expect(ngrok.forward).not.toHaveBeenCalled();
  });

  it("lee el authtoken de ngrok.yml en formato v2 y v3", () => {
    fingirPlataforma("darwin");
    const mac = path.join(CASA, "Library", "Application Support", "ngrok", "ngrok.yml");
    fs.readFileSync.mockImplementation((ruta: string) => {
      if (ruta !== mac) throw Object.assign(new Error("no existe"), { code: "ENOENT" });
      return 'version: "2"\nauthtoken: "2abcDEF_v2"   # el mío\nregion: eu\n';
    });
    expect(tokenNgrok()).toBe("2abcDEF_v2");

    fingirPlataforma("linux");
    const linux = path.join(CASA, ".config", "ngrok", "ngrok.yml");
    fs.readFileSync.mockImplementation((ruta: string) => {
      if (ruta !== linux) throw Object.assign(new Error("no existe"), { code: "ENOENT" });
      return "version: 3\n# authtoken: comentado\nendpoints:\n  - name: web\n    authtoken: no-es-este\nagent:\n  region: eu\n  authtoken: '3xyz_v3'\n";
    });
    expect(tokenNgrok()).toBe("3xyz_v3");

    fs.readFileSync.mockImplementation(() => "version: 3\nagent:\n  region: eu\n");
    expect(tokenNgrok()).toBeNull();
    fs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("sin permiso"), { code: "EACCES" });
    });
    expect(tokenNgrok()).toBeNull();
  });

  it("NGROK_AUTHTOKEN gana y ngrok.yml no se lee con BD_LOCAL, CRM_DOMINIO o CRM_URL_PUBLICA", () => {
    fs.readFileSync.mockImplementation(() => "authtoken: del-archivo\n");
    expect(tokenNgrok()).toBe("del-archivo");
    vi.stubEnv("NGROK_AUTHTOKEN", "del-entorno");
    expect(tokenNgrok()).toBe("del-entorno");
    vi.stubEnv("NGROK_AUTHTOKEN", "");
    fs.readFileSync.mockClear();
    for (const [nombre, valor] of [["BD_LOCAL", "memoria"], ["CRM_DOMINIO", "crm.ejemplo.es"], ["CRM_URL_PUBLICA", "http://127.0.0.1:8124"]]) {
      vi.stubEnv("BD_LOCAL", "");
      vi.stubEnv("CRM_DOMINIO", "");
      vi.stubEnv("CRM_URL_PUBLICA", "");
      vi.stubEnv(nombre, valor);
      expect(tokenNgrok()).toBeNull();
    }
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("abre 127.0.0.1:PUERTO con NGROK_DOMAIN y avisa a Meta con la URL", async () => {
    vi.stubEnv("PUERTO", "8124");
    vi.stubEnv("NGROK_DOMAIN", "https://mi-crm.ngrok.app/");
    vi.stubEnv("NGROK_AUTHTOKEN", "ngrok-de-prueba-1");
    ngrok.forward.mockResolvedValue(escucha("https://mi-crm.ngrok.app"));
    const estado = await abrirTunel();
    expect(estado).toMatchObject({ abierto: true, url: "https://mi-crm.ngrok.app", error: null, desde: expect.any(Number) });
    expect(ngrok.forward).toHaveBeenCalledWith({ addr: "127.0.0.1:8124", authtoken: "ngrok-de-prueba-1", domain: "mi-crm.ngrok.app" });
    expect(urlPublica()).toBe("https://mi-crm.ngrok.app");
    await vi.waitFor(() => expect(meta.alAbrirTunel).toHaveBeenCalledWith("https://mi-crm.ngrok.app"));
    expect(salida.join("\n")).toContain("Túnel activo: https://mi-crm.ngrok.app/webhook");
    expect(salida.join("\n")).not.toContain("ngrok-de-prueba-1");
    await vi.waitFor(() => expect(estadoAcceso()).toBe("ok"));
    expect(accesos).toEqual(["https://mi-crm.ngrok.app/panel"]);
    // Sin dominio y sin puerto: 8000 y ningún dominio.
    await cerrarTunel();
    vi.stubEnv("PUERTO", undefined);
    vi.stubEnv("NGROK_DOMAIN", "");
    ngrok.forward.mockResolvedValue(escucha("https://aleatorio.ngrok-free.app"));
    await abrirTunel();
    expect(ngrok.forward).toHaveBeenLastCalledWith({ addr: "127.0.0.1:8000", authtoken: "ngrok-de-prueba-1", domain: undefined });
  });

  it("sin token explica qué falta", async () => {
    expect(await abrirTunel()).toEqual({
      abierto: false,
      url: null,
      error: { codigo: "ngrok.token", titulo: "Falta tu clave de ngrok", solucion: "Cópiala de dashboard.ngrok.com → Your Authtoken y pégala en Ajustes → Conexiones.", paso: "whatsapp" },
      desde: null,
    });
    expect(ngrok.forward).not.toHaveBeenCalled();
  });

  it("traduce ERR_NGROK_105/107/4018, 334 y 313/320/15013", async () => {
    const casos: [number, string][] = [[105, "ngrok.token"], [107, "ngrok.token"], [4018, "ngrok.token"], [334, "ngrok.ocupado"], [313, "ngrok.dominio"], [320, "ngrok.dominio"], [15013, "ngrok.dominio"]];
    for (const [numero, codigo] of casos) {
      ngrok.forward.mockRejectedValueOnce(Object.assign(new Error(`fallo ERR_NGROK_${numero} con ngrok-de-prueba-1`), { errorCode: `ERR_NGROK_${numero}` }));
      const estado = await abrirTunel({ token: "ngrok-de-prueba-1" });
      expect(estado.abierto).toBe(false);
      expect(estado.error?.codigo).toBe(codigo);
      expect(estadoTunel().error?.codigo).toBe(codigo);
      await cerrarTunel();
    }
    expect(salida.join("\n")).toContain("No se ha podido abrir el túnel: Esa clave de ngrok no vale. Cópiala de dashboard.ngrok.com → Your Authtoken.");
    expect(salida.join("\n")).not.toContain("ngrok-de-prueba-1");
  });

  it("dos llamadas a la vez abren un solo túnel", async () => {
    ngrok.forward.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return escucha("https://uno.ngrok.app");
    });
    const [a, b] = await Promise.all([abrirTunel({ token: "tok-a-123" }), abrirTunel({ token: "tok-a-123" })]);
    expect(a).toEqual(b);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
    // Ya abierto con el mismo token: no vuelve a abrir.
    await abrirTunel({ token: "tok-a-123" });
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
  });

  it("con otro token cierra el túnel y lo vuelve a abrir", async () => {
    const primera = escucha("https://uno.ngrok.app");
    const segunda = escucha("https://dos.ngrok.app");
    ngrok.forward.mockResolvedValueOnce(primera).mockResolvedValueOnce(segunda);
    await abrirTunel({ token: "tok-a-123" });
    const estado = await abrirTunel({ token: "tok-b-456" });
    expect(primera.close).toHaveBeenCalledTimes(1);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    expect(estado.url).toBe("https://dos.ngrok.app");
    await cerrarTunel();
    expect(segunda.close).toHaveBeenCalledTimes(1);
    expect(estadoTunel()).toEqual({ abierto: false, url: null, error: null, desde: null });
  });

  it("reintenta un fallo de red pero no uno de token", async () => {
    vi.useFakeTimers();
    ngrok.forward.mockRejectedValueOnce(new Error("failed to connect: network unreachable")).mockResolvedValueOnce(escucha("https://uno.ngrok.app"));
    const fallo = await abrirTunel({ token: "tok-a-123" });
    expect(fallo.abierto).toBe(false);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    expect(estadoTunel().abierto).toBe(true);
    await cerrarTunel();

    ngrok.forward.mockReset();
    ngrok.forward.mockRejectedValue(new Error("authentication failed ERR_NGROK_105"));
    await abrirTunel({ token: "tok-malo-1" });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);

    // cerrarTunel cancela un reintento pendiente.
    ngrok.forward.mockReset();
    ngrok.forward.mockRejectedValue(new Error("network down"));
    await abrirTunel({ token: "tok-a-123" });
    await cerrarTunel();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
  });

  it("comprueba el acceso: 404 ok, otro estado error, sin red desconocido, URL local no comprueba", async () => {
    vi.stubEnv("CRM_URL_PUBLICA", "https://crm.ejemplo.es");
    expect(estadoAcceso()).toBe("desconocido");
    await vi.waitFor(() => expect(estadoAcceso()).toBe("ok"));
    expect(accesos).toEqual(["https://crm.ejemplo.es/panel"]);

    delete (globalThis as { __tunel?: unknown }).__tunel;
    respuestaAcceso = async () => new Response("<html>panel</html>", { status: 200 });
    estadoAcceso();
    await vi.waitFor(() => expect(estadoAcceso()).toBe("error"));
    expect(salida.join("\n")).toContain("El panel se puede abrir desde internet: cierra el CRM");

    delete (globalThis as { __tunel?: unknown }).__tunel;
    respuestaAcceso = async () => Promise.reject(new TypeError("fetch failed"));
    const antes = accesos.length;
    estadoAcceso();
    await vi.waitFor(() => expect(accesos.length).toBe(antes + 1));
    expect(estadoAcceso()).toBe("desconocido");

    delete (globalThis as { __tunel?: unknown }).__tunel;
    vi.stubEnv("CRM_URL_PUBLICA", "http://127.0.0.1:8124");
    const locales = accesos.length;
    expect(estadoAcceso()).toBe("desconocido");
    await new Promise((r) => setTimeout(r, 20));
    expect(accesos.length).toBe(locales);
  });

  it("modoServidor y urlPublica siguen como en W0", () => {
    expect(modoServidor()).toBe(false);
    expect(urlPublica()).toBeNull();
    vi.stubEnv("CRM_URL_PUBLICA", " http://127.0.0.1:8124/ ");
    expect(urlPublica()).toBe("http://127.0.0.1:8124");
    vi.stubEnv("CRM_DOMINIO", "crm.ejemplo.es");
    expect(modoServidor()).toBe(true);
    expect(urlPublica()).toBe("https://crm.ejemplo.es");
    vi.stubEnv("CRM_DOMINIO", "  ");
    expect(modoServidor()).toBe(false);
  });
});
