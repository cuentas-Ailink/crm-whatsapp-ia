import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PasoMeta } from "./api-tipos";
import {
  alAbrirTunel,
  apuntarWebhook,
  appDelToken,
  caducidad,
  comprobarSecreto,
  conectarPaso,
  crearPlantilla,
  cuentasDelToken,
  estadoConexionMeta,
  estadoPlantilla,
  listarPlantillas,
  numeroDelNegocio,
  numeros,
  plantillasAprobadas,
  suscribirApp,
} from "./meta";
import { PLANTILLA_AVISO } from "./plantillas";
import { formatoTelefono } from "./regional";

const ngrok = vi.hoisted(() => ({ forward: vi.fn() }));
vi.mock("@ngrok/ngrok", () => ngrok);

vi.mock("./configuracion-servidor", () => ({
  configuracionActiva: vi.fn(async () => ({
    perfil: { id: "reformas", nombre: "Reformas" },
    config: {
      negocio: { nombre: "Estudio de prueba" },
      perfil: { id: "reformas", nombre: "Reformas", hash: "x" },
      plantilla: { nombre: "solicitud_recibida", idioma: "es_ES", texto: "Hola {{1}}, soy el asistente de {{2}}." },
      calendario: { zona: "Europe/Madrid" },
      sistema: { asistente: {} },
    },
  })),
}));

// ---- Un Meta de mentira ----

const GRAPH = "http://graph.prueba/v26.0";
const CRM = "http://crm.prueba";
const TOKEN = "token-del-sistema-123";
const SECRETO = "secreto-de-la-app-456";
const APP = "1234567890";
const TOKEN_APP = `${APP}|${SECRETO}`;

interface Llamada { metodo: string; ruta: string; consulta: URLSearchParams; auth: string | null; cuerpo: Record<string, unknown> }
type Resp = { status?: number; cuerpo: unknown };
type Manejador = (l: Llamada) => Resp | Promise<Resp>;

let llamadas: Llamada[];
let rutas: Map<string, Manejador>;
let red: boolean;

const bien = (cuerpo: unknown): Resp => ({ cuerpo });
const errorMeta = (code: number, message: string, status = 400): Resp => ({ status, cuerpo: { error: { code, message } } });

function en(metodo: string, ruta: string, r: Manejador | Resp) {
  rutas.set(`${metodo} ${ruta}`, typeof r === "function" ? r : () => r);
}

function contar(metodo: string, ruta: string): number {
  return llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta).length;
}

/** Una cuenta normal: un token permanente de la app 1234567890 que llega a la cuenta 987654321. */
function metaNormal(o: { cuentas?: string[]; numeros?: object[]; caduca?: number } = {}) {
  let suscrita = false;
  let callback: string | null = null;
  const plantillas: Record<string, unknown>[] = [
    { name: "solicitud_recibida", language: "es_ES", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, soy de {{2}}." }], rejected_reason: "NONE" },
  ];
  en("GET", "/app", (l) => (l.auth === TOKEN ? bien({ id: APP }) : errorMeta(190, "Invalid OAuth access token.", 401)));
  en("GET", "/me", (l) => {
    const esperada = createHmac("sha256", SECRETO).update(l.auth ?? "").digest("hex");
    return l.consulta.get("appsecret_proof") === esperada ? bien({ id: "1" }) : errorMeta(100, "Invalid appsecret_proof provided in the API argument");
  });
  en("GET", "/debug_token", (l) => {
    if (l.auth !== TOKEN_APP) return errorMeta(190, "Invalid OAuth access token.", 401);
    const ids = o.cuentas ?? ["987654321"];
    return bien({ data: { expires_at: o.caduca ?? 0, granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ids }, { scope: "whatsapp_business_messaging", target_ids: ids }] } });
  });
  en("GET", "/987654321", bien({ id: "987654321", name: "Estudio de prueba" }));
  en("GET", "/987654322", bien({ id: "987654322", name: "Otra cuenta" }));
  en("GET", "/987654321/phone_numbers", bien({ data: o.numeros ?? [{ id: "123456789", display_phone_number: "+34 600 000 000", verified_name: "Estudio de prueba", account_mode: "LIVE" }] }));
  en("GET", "/123456789", bien({ id: "123456789", display_phone_number: "+34 600 000 000", verified_name: "Estudio de prueba", account_mode: "LIVE" }));
  en("GET", "/987654321/subscribed_apps", () => bien({ data: suscrita ? [{ whatsapp_business_api_data: { id: APP } }] : [] }));
  en("POST", "/987654321/subscribed_apps", () => {
    suscrita = true;
    return bien({ success: true });
  });
  en("GET", `/${APP}/subscriptions`, (l) =>
    l.auth !== TOKEN_APP ? errorMeta(190, "bad") : bien({ data: callback ? [{ object: "whatsapp_business_account", callback_url: callback, fields: [{ name: "messages" }] }] : [] }),
  );
  en("POST", `/${APP}/subscriptions`, async (l) => {
    if (l.auth !== TOKEN_APP) return errorMeta(190, "bad");
    const url = new URL(String(l.cuerpo.callback_url));
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", String(l.cuerpo.verify_token));
    url.searchParams.set("hub.challenge", "reto-42");
    const r = await fetch(url);
    if ((await r.text()) !== "reto-42") return errorMeta(2200, "(#2200) Callback verification failed");
    callback = String(l.cuerpo.callback_url);
    return bien({ success: true });
  });
  en("GET", "/987654321/message_templates", () => bien({ data: plantillas, paging: {} }));
  en("POST", "/987654321/message_templates", (l) => {
    plantillas.push({ name: l.cuerpo.name, language: l.cuerpo.language, status: "PENDING", category: "UTILITY", components: l.cuerpo.components, rejected_reason: "NONE" });
    return bien({ id: "77", status: "PENDING", category: "UTILITY" });
  });
  return { plantillas, fijarCallback: (url: string | null) => (callback = url), fijarSuscrita: (s: boolean) => (suscrita = s) };
}

/** El propio CRM: la verificación de Meta y la prueba de firma. */
function crm(url: URL, init: RequestInit): Response {
  if (url.pathname !== "/webhook") return new Response("No encontrado", { status: 404 });
  if ((init.method ?? "GET") === "GET") {
    const vale = url.searchParams.get("hub.verify_token") === process.env.WEBHOOK_VERIFY_TOKEN && !!process.env.WEBHOOK_VERIFY_TOKEN;
    return new Response(vale ? (url.searchParams.get("hub.challenge") ?? "") : "Token incorrecto", { status: vale ? 200 : 403 });
  }
  const cuerpo = String(init.body);
  const firma = `sha256=${createHmac("sha256", process.env.META_APP_SECRET ?? "").update(cuerpo).digest("hex")}`;
  return new Response("", { status: (init.headers as Record<string, string>)["X-Hub-Signature-256"] === firma ? 200 : 401 });
}

let carpeta: string;
let salida: string[];

beforeEach(() => {
  delete (globalThis as { __meta?: unknown }).__meta;
  delete (globalThis as { __tunel?: unknown }).__tunel;
  delete (globalThis as { __claves?: unknown }).__claves;
  carpeta = mkdtempSync(path.join(os.tmpdir(), "crm-meta-"));
  for (const nombre of ["WHATSAPP_TOKEN", "META_APP_SECRET", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_PHONE_NUMBER_ID", "WEBHOOK_VERIFY_TOKEN", "NGROK_AUTHTOKEN", "CRM_DOMINIO", "NGROK_DOMAIN"]) {
    vi.stubEnv(nombre, undefined);
  }
  vi.stubEnv("GRAPH_BASE_URL", GRAPH);
  vi.stubEnv("CRM_URL_PUBLICA", CRM);
  vi.stubEnv("ARCHIVO_CLAVES", path.join(carpeta, "claves.env"));
  llamadas = [];
  rutas = new Map();
  red = true;
  salida = [];
  vi.spyOn(console, "log").mockImplementation((...partes: unknown[]) => {
    salida.push(partes.map(String).join(" "));
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL, init: RequestInit = {}) => {
      if (!red) throw new TypeError("fetch failed");
      const url = new URL(String(entrada));
      if (url.origin === CRM) return crm(url, init);
      if (!url.href.startsWith(GRAPH)) return new Response("{}", { status: 404 });
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization?.replace(/^Bearer /, "") ?? null;
      const llamada: Llamada = { metodo: init.method ?? "GET", ruta: url.pathname.replace("/v26.0", ""), consulta: url.searchParams, auth, cuerpo: init.body ? JSON.parse(String(init.body)) : {} };
      llamadas.push(llamada);
      const manejador = rutas.get(`${llamada.metodo} ${llamada.ruta}`);
      const r = manejador ? await manejador(llamada) : errorMeta(100, "Unsupported get request.");
      return new Response(JSON.stringify(r.cuerpo), { status: r.status ?? 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(carpeta, { recursive: true, force: true });
});

function conClaves() {
  vi.stubEnv("WHATSAPP_TOKEN", TOKEN);
  vi.stubEnv("META_APP_SECRET", SECRETO);
  vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "987654321");
}

const archivoClaves = () => path.join(carpeta, "claves.env");

describe("la app, el token y el secreto", () => {
  it("appDelToken lee la app y devuelve null si Meta rechaza el token", async () => {
    metaNormal();
    expect(await appDelToken(TOKEN)).toEqual({ id: APP });
    expect(await appDelToken("otro-token-malo")).toBeNull();
    expect(llamadas[0]).toMatchObject({ metodo: "GET", ruta: "/app", auth: TOKEN });
    expect(llamadas[0].consulta.get("fields")).toBe("id");
    red = false;
    await expect(appDelToken(TOKEN)).rejects.toMatchObject({ codigo: "red" });
  });

  it("comprobarSecreto: true, false con appsecret_proof y null sin claves", async () => {
    metaNormal();
    expect(await comprobarSecreto(TOKEN, SECRETO)).toBe(true);
    expect(await comprobarSecreto(TOKEN, "otro-secreto-999")).toBe(false);
    expect(await comprobarSecreto(undefined, SECRETO)).toBeNull();
    expect(await comprobarSecreto(TOKEN)).toBeNull();
  });

  it("caducidad lee expires_at con el token de la app", async () => {
    metaNormal({ caduca: 1_900_000_000 });
    expect(await caducidad(TOKEN)).toBeNull(); // sin secreto no se puede leer
    vi.stubEnv("META_APP_SECRET", SECRETO);
    expect(await caducidad(TOKEN)).toBe(1_900_000_000);
    const debug = llamadas.find((l) => l.ruta === "/debug_token")!;
    expect(debug.auth).toBe(TOKEN_APP);
    expect(debug.consulta.get("input_token")).toBe(TOKEN);
  });

  it("cuentasDelToken saca las cuentas de granular_scopes con su nombre", async () => {
    metaNormal({ cuentas: ["987654321", "987654322", "987654321"] });
    expect(await cuentasDelToken(TOKEN, SECRETO)).toEqual([
      { id: "987654321", nombre: "Estudio de prueba" },
      { id: "987654322", nombre: "Otra cuenta" },
    ]);
    expect(await cuentasDelToken(TOKEN)).toEqual([]); // sin secreto
  });

  it("sin permisos de WhatsApp no hay cuentas", async () => {
    metaNormal();
    en("GET", "/debug_token", bien({ data: { expires_at: 0, granular_scopes: [{ scope: "business_management" }] } }));
    expect(await cuentasDelToken(TOKEN, SECRETO)).toEqual([]);
  });
});

describe("números", () => {
  it("numeros formatea y marca el de prueba (account_mode, Test Number, +1 555)", async () => {
    metaNormal({
      numeros: [
        { id: "1", display_phone_number: "+34 600 000 000", verified_name: "Estudio", account_mode: "LIVE" },
        { id: "2", display_phone_number: "+34 600 000 001", verified_name: "Estudio", account_mode: "SANDBOX" },
        { id: "3", display_phone_number: "+52 55 1234 5678", verified_name: "Test Number", account_mode: "LIVE" },
        { id: "4", display_phone_number: "+1 555-0100", verified_name: "Otra" },
      ],
    });
    const lista = await numeros("987654321", TOKEN);
    expect(lista).toEqual([
      { id: "1", texto: formatoTelefono("34600000000"), nombre: "Estudio", prueba: false },
      { id: "2", texto: formatoTelefono("34600000001"), nombre: "Estudio", prueba: true },
      { id: "3", texto: formatoTelefono("525512345678"), nombre: "Test Number", prueba: true },
      { id: "4", texto: formatoTelefono("15550100"), nombre: "Otra", prueba: true },
    ]);
    expect(llamadas[0].consulta.get("fields")).toBe("display_phone_number,verified_name,quality_rating,account_mode");
  });

  it("si Meta no conoce account_mode repite sin él", async () => {
    metaNormal();
    en("GET", "/987654321/phone_numbers", (l) =>
      l.consulta.get("fields")!.includes("account_mode")
        ? errorMeta(100, "(#100) Tried accessing nonexisting field (account_mode)")
        : bien({ data: [{ id: "9", display_phone_number: "34600000000", verified_name: "Estudio" }] }),
    );
    expect(await numeros("987654321", TOKEN)).toEqual([{ id: "9", texto: formatoTelefono("34600000000"), nombre: "Estudio", prueba: false }]);
    expect(contar("GET", "/987654321/phone_numbers")).toBe(2);
  });
});

describe("suscripción y webhook", () => {
  it("suscribirApp no escribe si ya está suscrita y suscribe si no", async () => {
    conClaves();
    const meta = metaNormal();
    expect(await suscribirApp()).toBe(true);
    expect(contar("POST", "/987654321/subscribed_apps")).toBe(1);
    expect(salida.join("\n")).toContain("Tu app de Meta escucha la cuenta de WhatsApp");
    expect(await suscribirApp()).toBe(true);
    expect(contar("POST", "/987654321/subscribed_apps")).toBe(1);
    meta.fijarSuscrita(false);
    en("POST", "/987654321/subscribed_apps", errorMeta(200, "Permissions error"));
    expect(await suscribirApp()).toBe(false);
  });

  it("apuntarWebhook no escribe si el destino ya es este", async () => {
    conClaves();
    vi.stubEnv("WEBHOOK_VERIFY_TOKEN", "verificacion-123");
    const meta = metaNormal();
    meta.fijarCallback(`${CRM}/webhook`);
    expect(await apuntarWebhook(`${CRM}/webhook`)).toEqual({ ok: true, cambiado: false });
    meta.fijarCallback(`${CRM}/api/whatsapp/webhook`);
    expect(await apuntarWebhook(`${CRM}/webhook`)).toEqual({ ok: true, cambiado: false });
    expect(contar("POST", `/${APP}/subscriptions`)).toBe(0);
  });

  it("sin override apunta la suscripción de la app con el token de la app", async () => {
    conClaves();
    vi.stubEnv("WEBHOOK_VERIFY_TOKEN", "verificacion-123");
    const meta = metaNormal();
    meta.fijarCallback("https://otro.ngrok.app/webhook");
    expect(await apuntarWebhook(`${CRM}/webhook`)).toEqual({ ok: true, cambiado: true });
    const alta = llamadas.find((l) => l.metodo === "POST")!;
    expect(alta.ruta).toBe(`/${APP}/subscriptions`);
    expect(alta.auth).toBe(TOKEN_APP);
    expect(alta.cuerpo).toEqual({ object: "whatsapp_business_account", callback_url: `${CRM}/webhook`, verify_token: "verificacion-123", fields: "messages" });
    expect(salida.join("\n")).toContain(`Webhook de Meta apuntado a ${CRM}/webhook`);
    expect(estadoConexionMeta().webhookApuntaAqui).toBe(true);
  });

  it("con override cambia el override_callback_uri de la cuenta", async () => {
    conClaves();
    vi.stubEnv("WEBHOOK_VERIFY_TOKEN", "verificacion-123");
    metaNormal();
    let override = "https://viejo.ngrok.app/webhook";
    en("GET", "/987654321/subscribed_apps", () => bien({ data: [{ whatsapp_business_api_data: { id: APP }, override_callback_uri: override }] }));
    en("GET", `/${APP}/subscriptions`, bien({ data: [{ object: "whatsapp_business_account", callback_url: "https://app.ejemplo/webhook", fields: [{ name: "messages" }] }] }));
    en("POST", "/987654321/subscribed_apps", (l) => {
      override = String(l.cuerpo.override_callback_uri);
      return bien({ success: true });
    });
    expect(await apuntarWebhook(`${CRM}/webhook`)).toEqual({ ok: true, cambiado: true });
    expect(override).toBe(`${CRM}/webhook`);
    expect(llamadas.find((l) => l.metodo === "POST")!.cuerpo).toEqual({ override_callback_uri: `${CRM}/webhook`, verify_token: "verificacion-123" });
    expect(contar("POST", `/${APP}/subscriptions`)).toBe(0);
    // Ya apunta aquí: no vuelve a escribir.
    expect(await apuntarWebhook(`${CRM}/webhook`)).toEqual({ ok: true, cambiado: false });
  });

  it("genera WEBHOOK_VERIFY_TOKEN si falta", async () => {
    conClaves();
    metaNormal();
    expect(await apuntarWebhook(`${CRM}/webhook`)).toEqual({ ok: true, cambiado: true });
    expect(process.env.WEBHOOK_VERIFY_TOKEN).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(archivoClaves(), "utf8")).toMatch(/^WEBHOOK_VERIFY_TOKEN="[0-9a-f]{32}"\n$/);
    expect(salida.join("\n")).not.toContain(process.env.WEBHOOK_VERIFY_TOKEN!);
  });
});

describe("plantillas", () => {
  it("mapea los estados de Meta, con el motivo del rechazo y la que no existe", async () => {
    conClaves();
    metaNormal();
    const fila = (name: string, status: string, extra: object = {}) => ({ name, language: "es_ES", status, category: "UTILITY", components: [{ type: "BODY", text: `Cuerpo de ${name}` }], ...extra });
    en("GET", "/987654321/message_templates", bien({
      data: [
        fila("aprobada", "APPROVED", { rejected_reason: "NONE" }),
        fila("pendiente", "PENDING"),
        fila("apelada", "IN_APPEAL"),
        fila("rechazada", "REJECTED", { rejected_reason: "INVALID_FORMAT" }),
        fila("pausada", "PAUSED"),
        fila("desactivada", "DISABLED"),
        fila("borrada", "DELETED"),
        { ...fila("ingles", "APPROVED"), language: "en_US" },
      ],
    }));
    const lista = await listarPlantillas();
    expect(lista!.map((p) => [p.nombre, p.estado])).toEqual([
      ["aprobada", "APPROVED"], ["pendiente", "PENDING"], ["apelada", "PENDING"], ["rechazada", "REJECTED"], ["pausada", "PAUSED"], ["desactivada", "DISABLED"], ["ingles", "APPROVED"],
    ]);
    expect(lista![0].motivo).toBeUndefined();
    expect(await estadoPlantilla("aprobada", "es_ES")).toEqual({ nombre: "aprobada", idioma: "es_ES", estado: "APROBADA", categoria: "UTILITY", texto: "Cuerpo de aprobada" });
    expect((await estadoPlantilla("pendiente", "es_ES")).estado).toBe("EN_REVISION");
    expect(await estadoPlantilla("rechazada", "es_ES")).toMatchObject({ estado: "RECHAZADA", motivo: "INVALID_FORMAT" });
    expect((await estadoPlantilla("pausada", "es_ES")).estado).toBe("PAUSADA");
    expect((await estadoPlantilla("desactivada", "es_ES")).estado).toBe("PAUSADA");
    expect((await estadoPlantilla("borrada", "es_ES")).estado).toBe("NO_EXISTE");
    expect((await estadoPlantilla("ingles", "es_ES")).estado).toBe("NO_EXISTE");
    const q = llamadas[0].consulta;
    expect(q.get("fields")).toBe("name,status,category,language,components,rejected_reason");
    expect(q.get("limit")).toBe("200");
  });

  it("listarPlantillas guarda 60 s y fuerza tras 5 s", async () => {
    conClaves();
    metaNormal();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    const pedidas = () => contar("GET", "/987654321/message_templates");
    await listarPlantillas();
    await listarPlantillas();
    await listarPlantillas({ forzar: true });
    expect(pedidas()).toBe(1);
    vi.setSystemTime(new Date("2026-11-12T10:00:06Z"));
    await listarPlantillas({ forzar: true });
    expect(pedidas()).toBe(2);
    vi.setSystemTime(new Date("2026-11-12T10:00:50Z"));
    await listarPlantillas();
    expect(pedidas()).toBe(2);
    vi.setSystemTime(new Date("2026-11-12T10:01:07Z"));
    await listarPlantillas();
    expect(pedidas()).toBe(3);
  });

  it("sigue las páginas de Meta y nunca manda el token a otro sitio", async () => {
    conClaves();
    metaNormal();
    en("GET", "/987654321/message_templates", (l) =>
      l.consulta.get("after") === "2"
        ? bien({ data: [{ name: "dos", language: "es_ES", status: "APPROVED", category: "UTILITY", components: [] }], paging: { next: "https://malo.ejemplo/robar" } })
        : bien({ data: [{ name: "uno", language: "es_ES", status: "APPROVED", category: "UTILITY", components: [] }], paging: { next: `${GRAPH}/987654321/message_templates?after=2` } }),
    );
    expect((await listarPlantillas())!.map((p) => p.nombre)).toEqual(["uno", "dos"]);
    expect(contar("GET", "/987654321/message_templates")).toBe(2);
  });

  it("crearPlantilla manda UTILITY, es_ES y los ejemplos y vacía la caché", async () => {
    conClaves();
    metaNormal();
    await listarPlantillas();
    const r = await crearPlantilla(PLANTILLA_AVISO);
    expect(r).toEqual({ id: "aviso", nombre: "aviso_comercial", idioma: "es_ES", estado: "EN_REVISION", categoria: "UTILITY", texto: PLANTILLA_AVISO.texto });
    const alta = llamadas.find((l) => l.metodo === "POST")!;
    expect(alta.cuerpo).toEqual({
      name: "aviso_comercial",
      language: "es_ES",
      category: "UTILITY",
      components: [{ type: "BODY", text: PLANTILLA_AVISO.texto, example: { body_text: [PLANTILLA_AVISO.ejemplos] } }],
    });
    expect(salida.join("\n")).toContain("Mensaje para Meta enviado a revisión: aviso_comercial");
    expect((await estadoPlantilla("aviso_comercial", "es_ES")).estado).toBe("EN_REVISION");
    expect(contar("GET", "/987654321/message_templates")).toBe(2);
    // Meta la pasa a MARKETING o la rechaza: se cuenta lo que dice.
    en("POST", "/987654321/message_templates", errorMeta(100, "Message template already exists in this language"));
    expect(await crearPlantilla(PLANTILLA_AVISO)).toMatchObject({ estado: "ERROR", motivo: "Meta ha rechazado el envío. Message template already exists in this language" });
  });

  it("plantillasAprobadas devuelve el texto y sus variables", async () => {
    conClaves();
    metaNormal();
    expect(await plantillasAprobadas()).toEqual([{ nombre: "solicitud_recibida", idioma: "es_ES", categoria: "UTILITY", texto: "Hola {{1}}, soy de {{2}}.", variables: [1, 2] }]);
    en("GET", "/987654321/message_templates", errorMeta(190, "token caducado", 401));
    delete (globalThis as { __meta?: unknown }).__meta;
    expect(await plantillasAprobadas()).toEqual([]);
  });

  it("sin claves: SIN_CLAVES, null y []", async () => {
    metaNormal();
    expect(await listarPlantillas()).toBeNull();
    expect(await estadoPlantilla("aviso_comercial", "es_ES")).toEqual({ nombre: "aviso_comercial", idioma: "es_ES", estado: "SIN_CLAVES" });
    expect(await crearPlantilla(PLANTILLA_AVISO)).toEqual({ id: "aviso", nombre: "aviso_comercial", idioma: "es_ES", estado: "SIN_CLAVES" });
    expect(await plantillasAprobadas()).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });
});

// ---- «Conecta tu WhatsApp» ----

async function paso(paso: PasoMeta, extra: Record<string, string> = {}) {
  return conectarPaso({ paso, ...extra });
}

describe("conectarPaso", () => {
  it("conectarPaso recorre los siete pasos con los textos en verde", async () => {
    metaNormal();
    const pasos = [
      await paso("claves", { token: TOKEN, secreto: SECRETO }),
      await paso("cuenta"),
      await paso("numero"),
      await paso("tunel"),
      await paso("suscripcion"),
      await paso("webhook"),
      await paso("firma"),
    ];
    expect(pasos.map((p) => [p.paso, p.ok, p.texto, p.siguiente])).toEqual([
      ["claves", true, "Claves guardadas", "cuenta"],
      ["cuenta", true, "Cuenta de WhatsApp de Estudio de prueba", "numero"],
      ["numero", true, `${formatoTelefono("34600000000")} · Estudio de prueba`, "tunel"],
      ["tunel", true, `Los mensajes llegan a ${CRM}`, "suscripcion"],
      ["suscripcion", true, "Tu app escucha esta cuenta", "webhook"],
      ["webhook", true, "Meta avisa a este ordenador", "firma"],
      ["firma", true, "Firma comprobada", null],
    ]);
    expect(pasos.every((p) => p.error === undefined)).toBe(true);
    expect(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID).toBe("987654321");
    expect(process.env.WHATSAPP_PHONE_NUMBER_ID).toBe("123456789");
    expect(numeroDelNegocio()).toEqual({ id: "123456789", texto: formatoTelefono("34600000000"), nombre: "Estudio de prueba", prueba: false });
    const guardado = readFileSync(archivoClaves(), "utf8");
    for (const nombre of ["WHATSAPP_TOKEN", "META_APP_SECRET", "WEBHOOK_VERIFY_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_PHONE_NUMBER_ID"]) {
      expect(guardado).toContain(`${nombre}="`);
    }
    const todo = JSON.stringify(pasos) + salida.join("\n");
    expect(todo).not.toContain(TOKEN);
    expect(todo).not.toContain(SECRETO);
  });

  it("varias cuentas o números: opciones y se repite el paso", async () => {
    conClaves();
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", undefined);
    metaNormal({
      cuentas: ["987654321", "987654322"],
      numeros: [
        { id: "1", display_phone_number: "+34 600 000 000", verified_name: "Estudio" },
        { id: "2", display_phone_number: "+34 600 000 001", verified_name: "Tienda" },
      ],
    });
    expect(await paso("cuenta")).toEqual({
      paso: "cuenta",
      ok: false,
      texto: "Elige tu cuenta de WhatsApp",
      opciones: [{ id: "987654321", texto: "Estudio de prueba" }, { id: "987654322", texto: "Otra cuenta" }],
      siguiente: "cuenta",
    });
    expect(await paso("cuenta", { waba: "987654322" })).toMatchObject({ ok: true, texto: "Cuenta de WhatsApp de Otra cuenta", siguiente: "numero" });
    expect(await paso("cuenta", { waba: "987654321" })).toMatchObject({ ok: true, siguiente: "numero" });
    expect(await paso("numero")).toEqual({
      paso: "numero",
      ok: false,
      texto: "Elige el número",
      opciones: [{ id: "1", texto: `${formatoTelefono("34600000000")} · Estudio` }, { id: "2", texto: `${formatoTelefono("34600000001")} · Tienda` }],
      siguiente: "numero",
    });
    expect(await paso("numero", { numero: "2" })).toMatchObject({ ok: true, texto: `${formatoTelefono("34600000001")} · Tienda`, siguiente: "tunel" });
    expect(await paso("numero", { numero: "3" })).toMatchObject({ ok: false, error: { titulo: "Ese número no está en tu cuenta de WhatsApp", codigo: "meta.otro" }, siguiente: "numero" });
  });

  it("sin cuenta: meta.permisos con opciones vacías", async () => {
    conClaves();
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", undefined);
    metaNormal({ cuentas: [] });
    expect(await paso("cuenta")).toEqual({
      paso: "cuenta",
      ok: false,
      texto: "No encuentro tu cuenta de WhatsApp",
      error: { titulo: "Tu token no tiene permiso para esto", solucion: "Dale al usuario del sistema los permisos de WhatsApp de tu app y vuelve a pegar el token.", codigo: "meta.permisos" },
      opciones: [],
      siguiente: "cuenta",
    });
    expect(await paso("cuenta", { waba: "555" })).toMatchObject({ ok: false, error: { titulo: "Esa cuenta de WhatsApp no es de tu token", codigo: "meta.permisos" } });
    // Los pasos siguientes sin cuenta mandan a elegirla; sin claves, a pegarlas.
    expect((await paso("numero")).siguiente).toBe("cuenta");
    vi.stubEnv("WHATSAPP_TOKEN", undefined);
    expect(await paso("suscripcion")).toMatchObject({ ok: false, siguiente: "claves", error: { titulo: "Faltan las claves de Meta" } });
  });

  it("el paso de claves no guarda nada si algo falla", async () => {
    metaNormal();
    expect(await paso("claves", { token: TOKEN })).toMatchObject({ ok: false, siguiente: "claves", error: { titulo: "Faltan las claves de Meta", codigo: "meta.token" } });
    expect(await paso("claves", { token: "token-que-no-vale-1", secreto: SECRETO })).toMatchObject({ ok: false, error: { codigo: "meta.token", titulo: "El token de Meta no vale o ha caducado" } });
    expect(await paso("claves", { token: TOKEN, secreto: "secreto-de-otra-app" })).toMatchObject({
      ok: false,
      error: { titulo: "Esa clave secreta no es de la app de tu token", solucion: "Cópiala otra vez de la configuración básica de tu app en Meta.", codigo: "meta.firma" },
    });
    metaNormal({ caduca: Math.floor(Date.now() / 1000) + 23 * 3600 });
    const caduca = await paso("claves", { token: TOKEN, secreto: SECRETO, ngrok: "ngrok-de-prueba-1" });
    expect(caduca).toMatchObject({ ok: false, siguiente: "claves", error: { solucion: "Usa el token permanente del usuario del sistema: el de la pantalla de inicio de Meta caduca en 24 h.", codigo: "meta.token" } });
    expect(caduca.error!.titulo).toMatch(/^Ese token caduca el \d{1,2} de [a-z]+ a las \d\d:\d\d$/);
    expect(existsSync(archivoClaves())).toBe(false);
    expect(process.env.WHATSAPP_TOKEN).toBeUndefined();
    expect(process.env.NGROK_AUTHTOKEN).toBeUndefined();
    red = false;
    expect(await paso("claves", { token: TOKEN, secreto: SECRETO })).toMatchObject({ ok: false, siguiente: "claves", error: { codigo: "red" } });
  });

  it("con BD_LOCAL y sin URL pública el túnel no se abre", async () => {
    vi.stubEnv("CRM_URL_PUBLICA", "");
    vi.stubEnv("BD_LOCAL", "memoria");
    vi.stubEnv("NGROK_AUTHTOKEN", "ngrok-de-prueba-1");
    expect(await paso("tunel")).toEqual({
      paso: "tunel",
      ok: false,
      texto: "En el servidor de pruebas no se abre el túnel",
      error: { titulo: "En el servidor de pruebas no se abre el túnel", solucion: "Los mensajes de prueba los manda el simulador.", codigo: "desconocido" },
      siguiente: "tunel",
    });
    expect(ngrok.forward).not.toHaveBeenCalled();
    conClaves();
    expect(await paso("webhook")).toMatchObject({ ok: false, siguiente: "tunel", error: { titulo: "Primero abre el túnel" } });
  });

  it("con CRM_URL_PUBLICA y en modo servidor dice dónde llegan los mensajes", async () => {
    vi.stubEnv("CRM_URL_PUBLICA", "http://127.0.0.1:8124/");
    expect(await paso("tunel")).toEqual({ paso: "tunel", ok: true, texto: "Los mensajes llegan a http://127.0.0.1:8124", siguiente: "suscripcion" });
    vi.stubEnv("CRM_DOMINIO", "crm.ejemplo.es");
    expect(await paso("tunel")).toEqual({ paso: "tunel", ok: true, texto: "Tu servidor recibe los mensajes en https://crm.ejemplo.es", siguiente: "suscripcion" });
    expect(ngrok.forward).not.toHaveBeenCalled();
  });

  it("un error de Meta que repite el token nunca lo enseña", async () => {
    conClaves();
    metaNormal();
    en("GET", "/987654321/phone_numbers", errorMeta(5, `El token ${TOKEN} no puede leer esto (secreto ${SECRETO})`));
    const r = await paso("numero");
    expect(r).toMatchObject({ ok: false, siguiente: "numero", error: { codigo: "meta.otro", titulo: "Meta ha rechazado el envío" } });
    expect(r.error!.solucion).toContain("•••");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(SECRETO);
    // Un token que aún no está guardado (viene en la petición) también se tapa.
    vi.stubEnv("WHATSAPP_TOKEN", undefined);
    en("GET", "/app", (l) => errorMeta(1, `Rechazado ${l.auth}`));
    const claves = await paso("claves", { token: "token-nuevo-sin-guardar", secreto: SECRETO });
    expect(JSON.stringify(claves)).not.toContain("token-nuevo-sin-guardar");
    en("POST", "/987654321/message_templates", errorMeta(100, `No con ${TOKEN}`));
    vi.stubEnv("WHATSAPP_TOKEN", TOKEN);
    expect(JSON.stringify(await crearPlantilla(PLANTILLA_AVISO))).not.toContain(TOKEN);
    expect(salida.join("\n")).not.toContain(TOKEN);
  });
});

// ---- Estado guardado ----

describe("estado guardado", () => {
  it("numeroDelNegocio y estadoConexionMeta empiezan vacíos y se rellenan en segundo plano una sola vez", async () => {
    conClaves();
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123456789");
    const meta = metaNormal();
    meta.fijarCallback(`${CRM}/webhook`);
    expect(numeroDelNegocio()).toBeNull();
    expect(numeroDelNegocio()).toBeNull();
    expect(estadoConexionMeta()).toEqual({ webhookApuntaAqui: null, comprobadoEn: null });
    expect(estadoConexionMeta()).toEqual({ webhookApuntaAqui: null, comprobadoEn: null });
    await vi.waitFor(() => expect(numeroDelNegocio()).not.toBeNull());
    expect(numeroDelNegocio()).toEqual({ id: "123456789", texto: formatoTelefono("34600000000"), nombre: "Estudio de prueba", prueba: false });
    await vi.waitFor(() => expect(estadoConexionMeta().webhookApuntaAqui).toBe(true));
    expect(estadoConexionMeta().comprobadoEn).toEqual(expect.any(Number));
    expect(contar("GET", "/123456789")).toBe(1);
    expect(contar("GET", `/${APP}/subscriptions`)).toBe(1);
    expect(llamadas.some((l) => l.metodo === "POST")).toBe(false);
    // Otro número invalida el que había.
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "999");
    expect(numeroDelNegocio()).toBeNull();
  });

  it("alAbrirTunel solo escribe si el destino ha cambiado y nunca lanza", async () => {
    conClaves();
    vi.stubEnv("WEBHOOK_VERIFY_TOKEN", "verificacion-123");
    const meta = metaNormal();
    meta.fijarSuscrita(true);
    meta.fijarCallback(`${CRM}/webhook`);
    await alAbrirTunel(CRM);
    expect(llamadas.some((l) => l.metodo === "POST")).toBe(false);
    meta.fijarCallback("https://viejo.ngrok.app/webhook");
    await alAbrirTunel(CRM);
    expect(contar("POST", `/${APP}/subscriptions`)).toBe(1);
    expect(contar("POST", "/987654321/subscribed_apps")).toBe(0);
    red = false;
    await expect(alAbrirTunel(CRM)).resolves.toBeUndefined();
    expect(salida.join("\n")).toContain("No se ha podido avisar a Meta");
    // Sin claves no hace nada.
    vi.stubEnv("WHATSAPP_TOKEN", undefined);
    const antes = llamadas.length;
    await alAbrirTunel(CRM);
    expect(llamadas.length).toBe(antes);
  });
});

// ---- Rutas ----

function post(url: string, cuerpo: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
}

describe("rutas de Meta", () => {
  it("/api/meta/plantillas crea solo las que no existen y rechaza un id que no es de la app", async () => {
    conClaves();
    const meta = metaNormal();
    const { GET, POST } = await import("@/app/api/meta/plantillas/route");
    const rechazo = await POST(post("http://localhost/api/meta/plantillas", { crear: ["inventada"] }));
    expect(rechazo.status).toBe(400);
    expect(await rechazo.json()).toEqual({ ok: false, error: "Ese mensaje no se puede crear desde aquí" });

    const r = await POST(post("http://localhost/api/meta/plantillas", { crear: ["bienvenida", "aviso"] }));
    expect(r.status).toBe(200);
    const { plantillas } = (await r.json()) as { plantillas: { id: string; estado: string; texto: string }[] };
    // W21 añade retomar_conversacion a las de la app: sale su estado, pero no se crea si no se pide.
    expect(plantillas.map((p) => [p.id, p.estado])).toEqual([["bienvenida", "APROBADA"], ["aviso", "EN_REVISION"], ["retomar", "NO_EXISTE"]]);
    expect(plantillas[0].texto).toBe("Hola {{1}}, soy de {{2}}.");
    const altas = llamadas.filter((l) => l.metodo === "POST");
    expect(altas.map((l) => l.cuerpo.name)).toEqual(["aviso_comercial"]);

    const aprobadas = await GET(new Request("http://localhost/api/meta/plantillas?aprobadas=1"));
    expect(((await aprobadas.json()) as { aprobadas: { nombre: string }[] }).aprobadas.map((a) => a.nombre)).toEqual(["solicitud_recibida"]);

    // Borrada en Meta mientras la caché aún la tenía: antes de crear se vuelve a mirar.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6_000);
    meta.plantillas.splice(meta.plantillas.findIndex((p) => p.name === "aviso_comercial"), 1);
    await POST(post("http://localhost/api/meta/plantillas", { crear: ["aviso"] }));
    expect(llamadas.filter((l) => l.metodo === "POST").map((l) => l.cuerpo.name)).toEqual(["aviso_comercial", "aviso_comercial"]);
    vi.useRealTimers();

    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", undefined);
    const sinMeta = await POST(post("http://localhost/api/meta/plantillas", { crear: ["aviso"] }));
    expect(sinMeta.status).toBe(409);
    expect(await sinMeta.json()).toEqual({ ok: false, error: "Primero conecta tu WhatsApp" });
  });

  it("/api/meta/conectar rechaza un paso que no existe", async () => {
    const { POST } = await import("@/app/api/meta/conectar/route");
    const r = await POST(post("http://localhost/api/meta/conectar", { paso: "magia" }));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false, error: "Ese paso no existe" });
    const salto = await POST(post("http://localhost/api/meta/conectar", { paso: "claves", token: "uno\ndos" }));
    expect(salto.status).toBe(400);
    expect(await salto.json()).toMatchObject({ ok: false, error: "Revisa lo que has pegado: tiene un salto de línea" });
    vi.stubEnv("CRM_URL_PUBLICA", "http://127.0.0.1:8124");
    const bienR = await POST(post("http://localhost/api/meta/conectar", { paso: "tunel" }));
    expect(await bienR.json()).toEqual({ paso: "tunel", ok: true, texto: "Los mensajes llegan a http://127.0.0.1:8124", siguiente: "suscripcion" });
  });
});

// ---- W28 · Los tres códigos de Meta, uno a uno, en cuanto se pegan ----

describe("/api/claves: los códigos de Meta se guardan uno a uno", () => {
  const MAL_SECRETO = "otro-secreto-de-otra-app";
  const respuestas: string[] = [];

  async function pegar(nombre: string, valor: string): Promise<{ status: number; json: Record<string, unknown> }> {
    const { POST } = await import("@/app/api/claves/route");
    const r = await POST(post("http://localhost/api/claves", { nombre, valor }));
    const texto = await r.text();
    respuestas.push(texto);
    return { status: r.status, json: JSON.parse(texto) as Record<string, unknown> };
  }

  async function guardadas(): Promise<Record<string, boolean>> {
    const { GET } = await import("@/app/api/claves/route");
    const r = await GET();
    const texto = await r.text();
    respuestas.push(texto);
    const { claves } = JSON.parse(texto) as { claves: { nombre: string; guardada: boolean }[] };
    return Object.fromEntries(claves.map((c) => [c.nombre, c.guardada]));
  }

  beforeEach(() => {
    respuestas.length = 0;
  });

  afterEach(async () => {
    const { cerrarTunel } = await import("./tunel");
    await cerrarTunel();
    // Ninguna respuesta lleva una clave: solo cómo termina.
    for (const texto of respuestas) for (const clave of [TOKEN, SECRETO, MAL_SECRETO, "ngrok-de-prueba-1"]) expect(texto).not.toContain(clave);
  });

  it("el token solo, sin clave secreta: se comprueba que vale y se guarda", async () => {
    metaNormal();
    const r = await pegar("WHATSAPP_TOKEN", TOKEN);
    expect(r).toEqual({ status: 200, json: { ok: true, terminaEn: "…-123" } });
    expect((await guardadas()).WHATSAPP_TOKEN).toBe(true);
    expect(readFileSync(archivoClaves(), "utf8")).toContain("WHATSAPP_TOKEN=");
    expect((await guardadas()).META_APP_SECRET).toBe(false);
  });

  it("un token que no vale no se guarda, con el texto de siempre", async () => {
    metaNormal();
    const r = await pegar("WHATSAPP_TOKEN", "token-que-no-es-de-nadie");
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, codigo: "meta.token", error: "El token de Meta no vale o ha caducado. Pega el token permanente del usuario del sistema, no el de la pantalla de inicio de Meta, que caduca en 24 h." });
    expect((await guardadas()).WHATSAPP_TOKEN).toBe(false);
  });

  it("la clave secreta con el token ya guardado: se comprueban juntos; la de otra app no se guarda", async () => {
    metaNormal();
    await pegar("WHATSAPP_TOKEN", TOKEN);
    const mala = await pegar("META_APP_SECRET", MAL_SECRETO);
    expect(mala.status).toBe(400);
    expect(mala.json).toEqual({ ok: false, codigo: "meta.firma", error: "Esa clave secreta no es de la app de tu token. Cópiala otra vez de la configuración básica de tu app en Meta." });
    expect((await guardadas()).META_APP_SECRET).toBe(false);
    const buena = await pegar("META_APP_SECRET", SECRETO);
    expect(buena).toEqual({ status: 200, json: { ok: true, terminaEn: "…-456" } });
    expect(await guardadas()).toMatchObject({ WHATSAPP_TOKEN: true, META_APP_SECRET: true });
  });

  it("primero la clave secreta y luego un token que caduca pronto: el token no se guarda", async () => {
    metaNormal({ caduca: Math.floor(Date.now() / 1000) + 3600 });
    expect((await pegar("META_APP_SECRET", SECRETO)).json).toEqual({ ok: true, terminaEn: "…-456" });
    const r = await pegar("WHATSAPP_TOKEN", TOKEN);
    expect(r.status).toBe(400);
    expect(r.json.codigo).toBe("meta.token");
    expect(String(r.json.error)).toMatch(/^Ese token caduca el \d+ de \S+ a las \d\d:\d\d\. Usa el token permanente del usuario del sistema: el de la pantalla de inicio de Meta caduca en 24 h\.$/);
    expect((await guardadas()).WHATSAPP_TOKEN).toBe(false);
  });

  it("primero el token y luego la clave secreta: al guardarla se ve que el token caduca pronto y se avisa", async () => {
    metaNormal({ caduca: Math.floor(Date.now() / 1000) + 3600 });
    expect((await pegar("WHATSAPP_TOKEN", TOKEN)).json).toEqual({ ok: true, terminaEn: "…-123" });
    const r = await pegar("META_APP_SECRET", SECRETO);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, guardada: true, codigo: "meta.token" });
    expect(String(r.json.error)).toMatch(/^Ese token caduca el /);
    expect((await guardadas()).META_APP_SECRET).toBe(true);
  });

  it("un token bueno con la clave secreta guardada de otra app: se guarda igual (Meta lo enseña una vez) y avisa de la clave", async () => {
    metaNormal();
    vi.stubEnv("META_APP_SECRET", MAL_SECRETO);
    const r = await pegar("WHATSAPP_TOKEN", TOKEN);
    expect(r).toEqual({
      status: 200,
      json: { ok: false, guardada: true, codigo: "meta.firma", error: "Esa clave secreta no es de la app de tu token. Cópiala otra vez de la configuración básica de tu app en Meta." },
    });
    expect((await guardadas()).WHATSAPP_TOKEN).toBe(true);
  });

  it("sin red, el token se guarda para no perderlo y lo dice", async () => {
    metaNormal();
    red = false;
    const r = await pegar("WHATSAPP_TOKEN", TOKEN);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, guardada: true, codigo: "red" });
    expect((await guardadas()).WHATSAPP_TOKEN).toBe(true);
  });

  it("sin red, la clave secreta pegada después del token también se guarda y lo dice", async () => {
    metaNormal();
    await pegar("WHATSAPP_TOKEN", TOKEN);
    red = false;
    const r = await pegar("META_APP_SECRET", SECRETO);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, guardada: true, codigo: "red" });
    expect(await guardadas()).toMatchObject({ WHATSAPP_TOKEN: true, META_APP_SECRET: true });
  });

  it("el token de ngrok: se guarda si el túnel se abre; una clave mala, no", async () => {
    vi.stubEnv("BD_LOCAL", "");
    vi.stubEnv("CRM_URL_PUBLICA", undefined);
    ngrok.forward.mockReset();
    ngrok.forward.mockRejectedValueOnce(Object.assign(new Error("authentication failed ERR_NGROK_105"), { errorCode: "ERR_NGROK_105" }));
    const mala = await pegar("NGROK_AUTHTOKEN", "ngrok-de-prueba-1");
    expect(mala.status).toBe(400);
    expect(mala.json).toMatchObject({ ok: false, codigo: "ngrok.token", error: "Esa clave de ngrok no vale. Cópiala de dashboard.ngrok.com → Your Authtoken." });
    expect((await guardadas()).NGROK_AUTHTOKEN).toBe(false);
    ngrok.forward.mockResolvedValueOnce({ url: () => "https://mi-crm.ngrok.app", close: vi.fn(async () => {}) });
    const buena = await pegar("NGROK_AUTHTOKEN", "ngrok-de-prueba-1");
    expect(buena).toEqual({ status: 200, json: { ok: true, terminaEn: "…ba-1", nota: "Túnel abierto: los mensajes llegan a este ordenador" } });
    expect((await guardadas()).NGROK_AUTHTOKEN).toBe(true);
  });

  it("pegados uno a uno y releídos, «Conectar» hace el resto con lo guardado y todo sale en verde", async () => {
    metaNormal();
    await pegar("WHATSAPP_TOKEN", TOKEN);
    await pegar("META_APP_SECRET", SECRETO);
    expect(await guardadas()).toMatchObject({ WHATSAPP_TOKEN: true, META_APP_SECRET: true });
    // «Conectar» sin nada escrito: empieza por las claves guardadas y sigue lo que diga cada paso.
    const hechos: [string, boolean, string][] = [];
    let siguiente: PasoMeta | null = "claves";
    while (siguiente) {
      const r = await conectarPaso({ paso: siguiente });
      hechos.push([r.paso, r.ok, r.texto]);
      if (!r.ok) break;
      siguiente = r.siguiente;
    }
    expect(hechos).toEqual([
      ["claves", true, "Claves guardadas"],
      ["cuenta", true, "Cuenta de WhatsApp de Estudio de prueba"],
      ["numero", true, `${formatoTelefono("34600000000")} · Estudio de prueba`],
      ["tunel", true, `Los mensajes llegan a ${CRM}`],
      ["suscripcion", true, "Tu app escucha esta cuenta"],
      ["webhook", true, "Meta avisa a este ordenador"],
      ["firma", true, "Firma comprobada"],
    ]);
    expect(process.env.WEBHOOK_VERIFY_TOKEN).toMatch(/^[0-9a-f]{32}$/);
  });
});
