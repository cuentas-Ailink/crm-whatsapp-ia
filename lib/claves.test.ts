import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as envNext from "@next/env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NombreClave } from "./api-tipos";
import {
  archivoDeClaves,
  borrarClave,
  CLAVES_DESDE_EL_PANEL,
  clavesGuardadas,
  comprobarClaveClaude,
  guardarClave,
  lineaDeClave,
  nombreClaveVoz,
  terminaEn,
} from "./claves";
import { escucharCambios } from "./eventos";

vi.mock("./configuracion-servidor", () => ({
  configuracionActiva: vi.fn(async () => ({
    perfil: { id: "reformas", nombre: "Reformas" },
    config: { sistema: { asistente: {} }, calendario: { zona: "Europe/Madrid" } },
  })),
}));

const NOMBRES: NombreClave[] = [
  "ANTHROPIC_API_KEY",
  "WHATSAPP_TOKEN",
  "META_APP_SECRET",
  "NGROK_AUTHTOKEN",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "SESION_SECRETO",
  "CLAVE_PANEL_HASH",
  "CODIGO_ALTA",
];

let carpeta: string;
let archivo: string;
let salida: string[];

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), "crm-claves-"));
  archivo = path.join(carpeta, "claves.env");
  for (const nombre of [...NOMBRES, "MODELO", "ANTHROPIC_BASE_URL", "GRAPH_BASE_URL", "TRANSCRIPCION_BASE_URL", "TRANSCRIPCION_MODELO", "CRM_DOMINIO", "CRM_URL_PUBLICA"]) {
    vi.stubEnv(nombre, undefined);
  }
  vi.stubEnv("ARCHIVO_CLAVES", archivo);
  salida = [];
  vi.spyOn(console, "log").mockImplementation((...partes: unknown[]) => {
    salida.push(partes.map(String).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(carpeta, { recursive: true, force: true });
});

/** Lo que leería Next de un archivo, con su mismo lector y sin tocar process.env. */
function leerComoNext(texto: string): Record<string, string> {
  const antes = { ...process.env };
  for (const nombre of NOMBRES) delete process.env[nombre];
  try {
    const modulo = envNext as unknown as { processEnv?: typeof envNext.processEnv; default?: { processEnv: typeof envNext.processEnv } };
    const procesar = modulo.processEnv ?? modulo.default!.processEnv;
    const archivos = [{ path: ".env", contents: texto, env: {} as Record<string, string> }];
    procesar(archivos, undefined, { info: () => {}, error: () => {} }, true);
    return archivos[0].env;
  } finally {
    for (const clave of Object.keys(process.env)) if (!(clave in antes)) delete process.env[clave];
    Object.assign(process.env, antes);
  }
}

const leer = () => readFileSync(archivo, "utf8");

describe("lineaDeClave", () => {
  it("escapa $ y comillas y rechaza saltos de línea", () => {
    expect(lineaDeClave("WHATSAPP_TOKEN", 'a$b"c\\d')).toBe('WHATSAPP_TOKEN="a\\$b\\"c\\d"');
    expect(() => lineaDeClave("WHATSAPP_TOKEN", "a\nb")).toThrow();
    expect(() => lineaDeClave("WHATSAPP_TOKEN", "a\rb")).toThrow();
    expect(() => lineaDeClave("WHATSAPP_TOKEN", "a\0b")).toThrow();
  });
});

describe("guardarClave", () => {
  it("guarda un valor con $, #, comillas curvas y espacios y lo vuelve a leer igual", async () => {
    const valor = "pa$$word #uno “dos” tres = 'cuatro' `cinco`";
    const r = await guardarClave("ANTHROPIC_API_KEY", valor);
    expect(r).toEqual({ ok: true, terminaEn: "…nco`" });
    expect(leerComoNext(leer()).ANTHROPIC_API_KEY).toBe(valor);
    expect(process.env.ANTHROPIC_API_KEY).toBe(valor);
  });

  it("guardar o borrar una clave olvida lo guardado de /api/sistema y avisa al panel", async () => {
    const g = globalThis as Record<string, unknown>;
    const tipos: string[] = [];
    const dejar = escucharCambios((c) => tipos.push(c.tipo));
    try {
      g.__sistemaConexiones = { ultimo: "viejo" };
      g.__sistemaComprobaciones = { cache: "viejo" };
      expect((await guardarClave("WHATSAPP_TOKEN", "token-nuevo-123")).ok).toBe(true);
      expect(g.__sistemaConexiones).toBeUndefined();
      expect(g.__sistemaComprobaciones).toBeUndefined();
      await new Promise((r) => setTimeout(r, 80));
      expect(tipos).toContain("sistema");

      tipos.length = 0;
      g.__sistemaConexiones = { ultimo: "viejo" };
      await borrarClave("WHATSAPP_TOKEN");
      expect(g.__sistemaConexiones).toBeUndefined();
      await new Promise((r) => setTimeout(r, 80));
      expect(tipos).toContain("sistema");
    } finally {
      dejar();
    }
  });

  it("rechaza un valor con comillas rectas y deja el archivo como estaba", async () => {
    writeFileSync(archivo, "OTRA=1\n");
    const r = await guardarClave("WHATSAPP_TOKEN", 'abc"def');
    expect(r).toEqual({ ok: false, error: "No se ha podido guardar la clave: tiene caracteres que no se pueden guardar" });
    expect(leer()).toBe("OTRA=1\n");
    expect(process.env.WHATSAPP_TOKEN).toBeUndefined();
  });

  it("rechaza un salto de línea sin tocar el archivo", async () => {
    const r = await guardarClave("WHATSAPP_TOKEN", "abc\ndef");
    expect(r).toEqual({ ok: false, error: "Esa clave lleva un salto de línea: vuelve a copiarla" });
    expect(existsSync(archivo)).toBe(false);
    // Una barra seguida de n se leería como salto de línea: tampoco se guarda.
    expect((await guardarClave("WHATSAPP_TOKEN", "abc\\ndef")).ok).toBe(false);
    expect(existsSync(archivo)).toBe(false);
  });

  it("sustituye la línea que ya existe y conserva comentarios y el resto byte a byte", async () => {
    writeFileSync(archivo, '# Claves\r\nOTRA=1\nexport WHATSAPP_TOKEN=viejo   # el de siempre\n# WHATSAPP_TOKEN=comentado\nULTIMA="x"');
    expect((await guardarClave("WHATSAPP_TOKEN", "nuevo-valor")).ok).toBe(true);
    expect(leer()).toBe('# Claves\r\nOTRA=1\nWHATSAPP_TOKEN="nuevo-valor"   # el de siempre\n# WHATSAPP_TOKEN=comentado\nULTIMA="x"');
  });

  it("añade la clave al final si no estaba", async () => {
    writeFileSync(archivo, "OTRA=1");
    expect((await guardarClave("GROQ_API_KEY", "gsk_123456789")).ok).toBe(true);
    expect(leer()).toBe('OTRA=1\nGROQ_API_KEY="gsk_123456789"\n');
  });

  it("quita las líneas repetidas de la misma clave", async () => {
    writeFileSync(archivo, 'META_APP_SECRET="uno"\nOTRA=1\nMETA_APP_SECRET=dos\n');
    expect((await guardarClave("META_APP_SECRET", "tres-tres")).ok).toBe(true);
    expect(leer()).toBe('META_APP_SECRET="tres-tres"\nOTRA=1\n');
    expect(leerComoNext(leer()).META_APP_SECRET).toBe("tres-tres");
  });

  it("deja el archivo con permisos 600", async () => {
    writeFileSync(archivo, "OTRA=1\n", { mode: 0o644 });
    expect((await guardarClave("NGROK_AUTHTOKEN", "ngrok-123456")).ok).toBe(true);
    expect(statSync(archivo).mode & 0o777).toBe(0o600);
  });

  it("actualiza process.env al momento y no toca otras variables", async () => {
    const antes = { ...process.env };
    expect((await guardarClave("OPENAI_API_KEY", "sk-abcdefgh")).ok).toBe(true);
    expect(process.env.OPENAI_API_KEY).toBe("sk-abcdefgh");
    const despues = { ...process.env };
    delete despues.OPENAI_API_KEY;
    expect(despues).toEqual(antes);
  });

  it("prefiere .env.local cuando existe", async () => {
    vi.stubEnv("ARCHIVO_CLAVES", undefined);
    vi.stubEnv("BD_LOCAL", "");
    vi.spyOn(process, "cwd").mockReturnValue(carpeta);
    expect(archivoDeClaves()).toBe(path.join(carpeta, ".env"));
    writeFileSync(path.join(carpeta, ".env"), "OTRA=1\n");
    writeFileSync(path.join(carpeta, ".env.local"), "");
    expect(archivoDeClaves()).toBe(path.join(carpeta, ".env.local"));
    expect((await guardarClave("WHATSAPP_TOKEN", "token-largo")).ok).toBe(true);
    expect(readFileSync(path.join(carpeta, ".env.local"), "utf8")).toBe('WHATSAPP_TOKEN="token-largo"\n');
    expect(readFileSync(path.join(carpeta, ".env"), "utf8")).toBe("OTRA=1\n");
  });

  it("con BD_LOCAL y sin ARCHIVO_CLAVES se niega", async () => {
    vi.stubEnv("ARCHIVO_CLAVES", undefined);
    vi.stubEnv("BD_LOCAL", "memoria");
    vi.spyOn(process, "cwd").mockReturnValue(carpeta);
    expect(() => archivoDeClaves()).toThrow();
    expect(await guardarClave("WHATSAPP_TOKEN", "token-largo")).toEqual({ ok: false, error: "No se pueden guardar claves en este servidor de pruebas" });
    expect(existsSync(path.join(carpeta, ".env"))).toBe(false);
    expect(process.env.WHATSAPP_TOKEN).toBeUndefined();
  });

  it("solo acepta nombres de la lista", async () => {
    for (const nombre of ["PUERTO", "BD_LOCAL", "SUPABASE_DB_URL", "GRAPH_BASE_URL", "CRM_DOMINIO", "ARCHIVO_CLAVES"]) {
      const r = await guardarClave(nombre as NombreClave, "valor-largo");
      expect(r.ok).toBe(false);
    }
    expect(existsSync(archivo)).toBe(false);
    expect((await guardarClave("WHATSAPP_BUSINESS_ACCOUNT_ID", "987654321")).ok).toBe(true);
  });

  it("dos guardados a la vez no se pisan", async () => {
    const [a, b] = await Promise.all([guardarClave("WHATSAPP_TOKEN", "token-uno"), guardarClave("META_APP_SECRET", "secreto-dos")]);
    expect(a.ok && b.ok).toBe(true);
    const leido = leerComoNext(leer());
    expect(leido.WHATSAPP_TOKEN).toBe("token-uno");
    expect(leido.META_APP_SECRET).toBe("secreto-dos");
  });
});

describe("borrarClave", () => {
  it("quita la línea y la variable", async () => {
    writeFileSync(archivo, '# nota\nNGROK_AUTHTOKEN="uno"\nOTRA=1\nNGROK_AUTHTOKEN=dos\n');
    vi.stubEnv("NGROK_AUTHTOKEN", "dos");
    await borrarClave("NGROK_AUTHTOKEN");
    expect(leer()).toBe("# nota\nOTRA=1\n");
    expect(process.env.NGROK_AUTHTOKEN).toBeUndefined();
    expect(statSync(archivo).mode & 0o777).toBe(0o600);
  });
});

describe("lo que se enseña", () => {
  it("terminaEn solo enseña los cuatro últimos", () => {
    expect(terminaEn("clave-de-prueba")).toBe("…ueba");
    expect(terminaEn("")).toBeNull();
    expect(terminaEn(undefined)).toBeNull();
  });

  it("clavesGuardadas nunca lleva el valor", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-muy-secreta-1234");
    vi.stubEnv("WEBHOOK_VERIFY_TOKEN", "verificacion-secreta");
    const estado = clavesGuardadas();
    expect(estado.map((e) => e.nombre)).toEqual([...CLAVES_DESDE_EL_PANEL]);
    expect(estado[0]).toEqual({ nombre: "ANTHROPIC_API_KEY", guardada: true, terminaEn: "…1234" });
    expect(estado[1]).toEqual({ nombre: "WHATSAPP_TOKEN", guardada: false, terminaEn: null });
    const texto = JSON.stringify(estado);
    expect(texto).not.toContain("muy-secreta");
    expect(texto).not.toContain("WEBHOOK_VERIFY_TOKEN");
  });
});

describe("nombreClaveVoz", () => {
  it("reconoce Google, Groq y OpenAI y no confunde una clave de Anthropic", () => {
    expect(nombreClaveVoz("  AIzaSyAbc123")).toBe("GEMINI_API_KEY");
    expect(nombreClaveVoz("gsk_abc123")).toBe("GROQ_API_KEY");
    expect(nombreClaveVoz("sk-proj-abc123")).toBe("OPENAI_API_KEY");
    expect(nombreClaveVoz("sk-ant-api03-abc")).toBeNull();
    expect(nombreClaveVoz("otra-cosa")).toBeNull();
  });
});

// ---- Claude ----

interface Pedida { url: string; cabeceras: Record<string, string>; cuerpo: Record<string, unknown> }

function simularClaude(status: number, cuerpo: unknown = {}): Pedida[] {
  const pedidas: Pedida[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      pedidas.push({ url: String(url), cabeceras: init.headers as Record<string, string>, cuerpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(cuerpo), { status });
    }),
  );
  return pedidas;
}

const SIN_SALDO = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } };

describe("comprobarClaveClaude", () => {
  it("llama a /messages con max_tokens 1 y el modelo pedido", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://claude.prueba/v1/");
    const pedidas = simularClaude(200, { id: "msg_1" });
    expect(await comprobarClaveClaude("sk-ant-prueba-1", "claude-sonnet-5-5")).toEqual({ ok: true });
    expect(pedidas).toHaveLength(1);
    expect(pedidas[0].url).toBe("http://claude.prueba/v1/messages");
    expect(pedidas[0].cabeceras["x-api-key"]).toBe("sk-ant-prueba-1");
    expect(pedidas[0].cabeceras["anthropic-version"]).toBe("2023-06-01");
    expect(pedidas[0].cuerpo).toEqual({ model: "claude-sonnet-5-5", max_tokens: 1, messages: [{ role: "user", content: "Hola" }] });
  });

  it("sin modelo usa MODELO y, sin él, claude-haiku-5-5", async () => {
    const pedidas = simularClaude(200);
    vi.stubEnv("MODELO", "claude-opus-5-5");
    await comprobarClaveClaude("sk-ant-prueba-1");
    vi.stubEnv("MODELO", "");
    await comprobarClaveClaude("sk-ant-prueba-1");
    expect(pedidas.map((p) => p.cuerpo.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    expect(pedidas[0].url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("401: la clave no vale y no se guarda", async () => {
    simularClaude(401, { error: { type: "authentication_error", message: "invalid x-api-key" } });
    const r = await comprobarClaveClaude("sk-ant-prueba-1");
    expect(r).toMatchObject({ ok: false, guardable: false, error: { codigo: "claude.clave" } });
  });

  it("400 sin saldo: guardable", async () => {
    simularClaude(400, SIN_SALDO);
    expect(await comprobarClaveClaude("sk-ant-prueba-1")).toMatchObject({ ok: false, guardable: true, error: { codigo: "claude.saldo" } });
  });

  it("otro 400: la clave ha entrado", async () => {
    simularClaude(400, { error: { message: "max_tokens: muy pequeño para sk-ant-prueba-1" } });
    expect(await comprobarClaveClaude("sk-ant-prueba-1")).toEqual({ ok: true });
    expect(salida.join("\n")).not.toContain("sk-ant-prueba-1");
  });

  it("404: sin acceso al modelo, guardable", async () => {
    simularClaude(404, { error: { message: "model not found" } });
    expect(await comprobarClaveClaude("sk-ant-prueba-1")).toMatchObject({ ok: false, guardable: true, error: { codigo: "claude.modelo" } });
  });

  it("429 y 529: saturado, guardable", async () => {
    for (const status of [429, 529]) {
      simularClaude(status, { error: { message: "overloaded" } });
      expect(await comprobarClaveClaude("sk-ant-prueba-1")).toMatchObject({ ok: false, guardable: true, error: { codigo: "claude.ocupado" } });
    }
  });

  it("sin red: no guardable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await comprobarClaveClaude("sk-ant-prueba-1")).toMatchObject({ ok: false, guardable: false, error: { codigo: "red" } });
  });

  it("cualquier otro estado: no guardable", async () => {
    simularClaude(500, { error: { message: "api_error" } });
    expect(await comprobarClaveClaude("sk-ant-prueba-1")).toMatchObject({ ok: false, guardable: false, error: { codigo: "desconocido" } });
  });

  it("sin ninguna clave no llama", async () => {
    const pedidas = simularClaude(200);
    expect(await comprobarClaveClaude()).toMatchObject({ ok: false, guardable: false, error: { codigo: "claude.clave" } });
    expect(pedidas).toHaveLength(0);
  });
});

// ---- La ruta ----

async function pedir(metodo: "GET" | "POST", cuerpo?: unknown) {
  const { GET, POST } = await import("@/app/api/claves/route");
  const respuesta =
    metodo === "GET"
      ? await GET()
      : await POST(new Request("http://localhost/api/claves", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
  return { status: respuesta.status, datos: (await respuesta.json()) as Record<string, unknown> };
}

/** Un Meta de mentira para el token: la app y debug_token. */
function simularMeta(expiraEn: number) {
  vi.stubEnv("GRAPH_BASE_URL", "http://graph.prueba/v26.0");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const ruta = new URL(url).pathname.replace("/v26.0", "");
      if (ruta === "/app") return Response.json({ id: "1234567890" });
      if (ruta === "/debug_token") return Response.json({ data: { expires_at: expiraEn } });
      return Response.json({ error: { message: "no simulado", code: 1 } }, { status: 400 });
    }),
  );
}

describe("/api/claves", () => {
  it("GET no devuelve ningún valor", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-secreto-1234");
    vi.stubEnv("WHATSAPP_TOKEN", "token-secreto-5678");
    const { status, datos } = await pedir("GET");
    expect(status).toBe(200);
    const texto = JSON.stringify(datos);
    expect(texto).not.toContain("secreto");
    expect(texto).toContain("…1234");
    expect((datos.claves as unknown[]).length).toBe(7);
  });

  it("POST rechaza un nombre fuera de la lista y una clave corta", async () => {
    expect(await pedir("POST", { nombre: "WEBHOOK_VERIFY_TOKEN", valor: "valor-largo" })).toEqual({
      status: 400,
      datos: { ok: false, error: "Esa clave no se puede guardar desde aquí", campo: "nombre" },
    });
    expect(await pedir("POST", { nombre: "PUERTO", valor: "8000-8000" })).toMatchObject({ status: 400, datos: { campo: "nombre" } });
    expect(await pedir("POST", { nombre: "ANTHROPIC_API_KEY", valor: " corta " })).toEqual({
      status: 400,
      datos: { ok: false, error: "Esa clave parece incompleta", campo: "valor" },
    });
    expect(await pedir("POST", { nombre: "ANTHROPIC_API_KEY", valor: "sk-ant-uno\ndos" })).toMatchObject({ status: 400, datos: { error: "Esa clave lleva un salto de línea: vuelve a copiarla" } });
    expect(existsSync(archivo)).toBe(false);
  });

  it("Claude sin saldo: se guarda y avisa", async () => {
    simularClaude(400, SIN_SALDO);
    const { status, datos } = await pedir("POST", { nombre: "ANTHROPIC_API_KEY", valor: "sk-ant-sin-saldo-1" });
    expect(status).toBe(200);
    expect(datos).toEqual({ ok: false, guardada: true, error: "Tu cuenta de Anthropic no tiene saldo. Añádelo en Billing y pulsa Reintentar.", codigo: "claude.saldo" });
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-sin-saldo-1");
    expect(leerComoNext(leer()).ANTHROPIC_API_KEY).toBe("sk-ant-sin-saldo-1");
  });

  it("Claude con clave mala: no se guarda", async () => {
    simularClaude(401, { error: { message: "invalid x-api-key" } });
    const { status, datos } = await pedir("POST", { nombre: "ANTHROPIC_API_KEY", valor: "sk-ant-mala-0001" });
    expect(status).toBe(400);
    expect(datos).toMatchObject({ ok: false, codigo: "claude.clave", error: "Esa clave no es válida. Cópiala otra vez de platform.claude.com → API Keys." });
    expect(existsSync(archivo)).toBe(false);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("un token de Meta que caduca mañana no se guarda", async () => {
    vi.stubEnv("META_APP_SECRET", "secreto-de-la-app");
    simularMeta(Math.floor(Date.now() / 1000) + 23 * 3600);
    const { status, datos } = await pedir("POST", { nombre: "WHATSAPP_TOKEN", valor: "token-de-un-dia" });
    expect(status).toBe(400);
    expect(datos.codigo).toBe("meta.token");
    expect(datos.error).toMatch(/^Ese token caduca el \d{1,2} de [a-z]+ a las \d\d:\d\d\. Usa el token permanente del usuario del sistema: el de la pantalla de inicio de Meta caduca en 24 h\.$/);
    expect(existsSync(archivo)).toBe(false);
    // Uno que no caduca sí.
    simularMeta(0);
    expect(await pedir("POST", { nombre: "WHATSAPP_TOKEN", valor: "token-permanente" })).toEqual({ status: 200, datos: { ok: true, terminaEn: "…ente" } });
  });

  it("ngrok con BD_LOCAL: se guarda y no abre el túnel", async () => {
    vi.stubEnv("BD_LOCAL", "memoria");
    const red = vi.fn();
    vi.stubGlobal("fetch", red);
    const { status, datos } = await pedir("POST", { nombre: "NGROK_AUTHTOKEN", valor: "ngrok-de-prueba-123" });
    expect(status).toBe(200);
    expect(datos).toEqual({ ok: true, terminaEn: "…-123", nota: "En el servidor de pruebas no se abre el túnel" });
    expect(red).not.toHaveBeenCalled();
    expect(process.env.NGROK_AUTHTOKEN).toBe("ngrok-de-prueba-123");
  });

  it("una clave de Groq pegada en Notas de voz se guarda como GROQ_API_KEY", async () => {
    vi.stubEnv("TRANSCRIPCION_BASE_URL", "http://voz.prueba/v1");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        urls.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
        return Response.json({ data: [] });
      }),
    );
    const { status, datos } = await pedir("POST", { nombre: "GEMINI_API_KEY", valor: "gsk_groqgroq1234" });
    expect(status).toBe(200);
    expect(datos).toEqual({ ok: true, terminaEn: "…1234", nota: "Guardada como clave de Groq" });
    expect(urls).toEqual(["http://voz.prueba/v1/models Bearer gsk_groqgroq1234"]);
    expect(process.env.GROQ_API_KEY).toBe("gsk_groqgroq1234");
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(leerComoNext(leer()).GROQ_API_KEY).toBe("gsk_groqgroq1234");
  });

  it("nunca escribe un valor en el registro", async () => {
    simularClaude(200);
    await pedir("POST", { nombre: "ANTHROPIC_API_KEY", valor: "sk-ant-nunca-en-el-log" });
    expect(salida.join("\n")).toContain("ANTHROPIC_API_KEY");
    expect(salida.join("\n")).not.toContain("nunca-en-el-log");
  });
});
