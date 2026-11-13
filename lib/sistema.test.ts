import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postActivo } from "@/app/api/asistente/activo/route";
import { POST as postModelo } from "@/app/api/asistente/modelo/route";
import { POST as postAviso } from "@/app/api/avisos/prueba/route";
import { POST as postArreglar } from "@/app/api/sistema/arreglar/route";
import { GET as getSistema } from "@/app/api/sistema/route";
import { POST as postWhatsApp } from "@/app/api/whatsapp/prueba/route";
import type { EstadoConexiones, FilaConexion } from "./api-tipos";
import * as aviso from "./aviso";
import * as bd from "./bd";
import * as claves from "./claves";
import type { ConfiguracionResuelta } from "./configuracion";
import * as cs from "./configuracion-servidor";
import { explicar, type CodigoError } from "./errores";
import * as eventos from "./eventos";
import * as meta from "./meta";
import { configuracionPorDefecto } from "./presets";
import { censurar, estadoConexiones, estadoPuesta } from "./sistema";
import * as tunel from "./tunel";
import * as whatsapp from "./whatsapp";

vi.mock("./claves", async (importOriginal) => ({ ...(await importOriginal<typeof import("./claves")>()), comprobarClaveClaude: vi.fn() }));
vi.mock("./meta", () => ({
  appDelToken: vi.fn(),
  caducidad: vi.fn(),
  comprobarFirma: vi.fn(),
  comprobarSecreto: vi.fn(),
  estadoConexionMeta: vi.fn(),
  estadoPlantilla: vi.fn(),
  numeroDelNegocio: vi.fn(),
  numeros: vi.fn(),
  apuntarWebhook: vi.fn(),
  suscribirApp: vi.fn(),
}));
vi.mock("./tunel", () => ({
  abrirTunel: vi.fn(),
  estadoAcceso: vi.fn(),
  estadoTunel: vi.fn(),
  modoServidor: vi.fn(),
  tokenNgrok: vi.fn(),
  urlPublica: vi.fn(),
}));
vi.mock("./bd", () => ({ contarEjemplos: vi.fn(), contarLeads: vi.fn(), hayMensajeRealDeCliente: vi.fn(), guardarMutaciones: vi.fn() }));
vi.mock("./eventos", () => ({ ultimosWebhooks: vi.fn(), avisarCambio: vi.fn(), leadsEscribiendo: vi.fn(() => []) }));
vi.mock("./configuracion-servidor", () => ({ configuracionActiva: vi.fn(), configuracionParaPintar: vi.fn(), cambiarAsistente: vi.fn() }));
vi.mock("./whatsapp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./whatsapp")>()),
  enviarPlantillaConVariables: vi.fn(),
  enviarTexto: vi.fn(),
}));
vi.mock("./aviso", async (importOriginal) => ({ ...(await importOriginal<typeof import("./aviso")>()), enviarAviso: vi.fn() }));

// Valores de clave falsos: ninguno puede salir en un JSON ni en un texto.
const SECRETOS: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-clave-secreta-123456",
  WHATSAPP_TOKEN: "EAAG-token-secreto-987654",
  META_APP_SECRET: "secreto-de-la-app-abcdef",
  NGROK_AUTHTOKEN: "ngrok-token-secreto-555",
  WEBHOOK_VERIFY_TOKEN: "verifica-secreta-777",
  GEMINI_API_KEY: "AIza-clave-de-voz-secreta",
};
const OTRAS = ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "GRAPH_BASE_URL", "TRANSCRIPCION_BASE_URL", "TRANSCRIPCION_MODELO", "BD_LOCAL", "SUPABASE_DB_URL", "NOMBRE_NEGOCIO", "MODELO", "TELEFONO_COMERCIAL", "GROQ_API_KEY", "OPENAI_API_KEY"];
const GUARDADAS = Object.fromEntries([...Object.keys(SECRETOS), ...OTRAS].map((n) => [n, process.env[n]]));

const APP = "1234567890";
const WABA = "987654321";
const GRAPH = "http://graph.prueba";
const URL_TUNEL = "https://abc.ngrok.app";
const NUMERO = { id: "123456789", texto: "+34 600 000 000", nombre: "Estudio de prueba", prueba: false };

let suscrita = true;
let config: ConfiguracionResuelta;

function fetchFalso(): typeof fetch {
  return vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url === `${GRAPH}/${WABA}/subscribed_apps`) {
      return Response.json({ data: suscrita ? [{ whatsapp_business_api_data: { id: APP, name: "CRM" } }] : [] });
    }
    if (url.includes("/models")) return Response.json({ name: "modelo" });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
}

function olvidar(): void {
  const g = globalThis as Record<string, unknown>;
  for (const k of ["__sistemaComprobaciones", "__sistemaConexiones", "__sistemaPuesta", "__whatsappPrueba", "__avisoPrueba"]) delete g[k];
}

/** Deja correr lo que se ha lanzado en segundo plano. */
const vaciarCola = () => new Promise((r) => setTimeout(r, 0));

const falloClaude = (codigo: CodigoError) => ({ ok: false as const, error: explicar(codigo), guardable: false });
const filaDe = (e: EstadoConexiones, id: FilaConexion["id"]) => e.filas.find((f) => f.id === id);

beforeEach(() => {
  olvidar();
  vi.clearAllMocks();
  vi.useRealTimers();
  for (const [n, v] of Object.entries(SECRETOS)) process.env[n] = v;
  for (const n of OTRAS) delete process.env[n];
  process.env.WHATSAPP_PHONE_NUMBER_ID = NUMERO.id;
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = WABA;
  process.env.GRAPH_BASE_URL = GRAPH;
  process.env.TRANSCRIPCION_BASE_URL = "http://voz.prueba/v1beta";
  suscrita = true;
  vi.stubGlobal("fetch", fetchFalso());
  vi.spyOn(console, "log").mockImplementation(() => {});

  config = configuracionPorDefecto();
  vi.mocked(cs.configuracionActiva).mockImplementation(async () => ({
    perfil: { id: config.perfil.id, nombre: config.perfil.nombre, instrucciones: "# Instrucciones", hash: "h" },
    config,
  }));
  vi.mocked(cs.configuracionParaPintar).mockImplementation(async () => config);
  vi.mocked(claves.comprobarClaveClaude).mockResolvedValue({ ok: true });
  vi.mocked(meta.appDelToken).mockResolvedValue({ id: APP });
  vi.mocked(meta.caducidad).mockResolvedValue(0);
  vi.mocked(meta.numeroDelNegocio).mockReturnValue(NUMERO);
  vi.mocked(meta.estadoConexionMeta).mockReturnValue({ webhookApuntaAqui: true, comprobadoEn: 1 });
  vi.mocked(meta.comprobarSecreto).mockResolvedValue(true);
  vi.mocked(meta.comprobarFirma).mockResolvedValue(true);
  vi.mocked(meta.numeros).mockResolvedValue([NUMERO]);
  vi.mocked(meta.estadoPlantilla).mockImplementation(async (nombre, idioma) => ({ nombre, idioma, estado: "APROBADA" }));
  vi.mocked(meta.apuntarWebhook).mockResolvedValue({ ok: true, cambiado: true });
  vi.mocked(meta.suscribirApp).mockResolvedValue(true);
  vi.mocked(tunel.urlPublica).mockReturnValue(URL_TUNEL);
  vi.mocked(tunel.estadoTunel).mockReturnValue({ abierto: true, url: URL_TUNEL, error: null, desde: 1 });
  vi.mocked(tunel.modoServidor).mockReturnValue(false);
  vi.mocked(tunel.tokenNgrok).mockReturnValue(SECRETOS.NGROK_AUTHTOKEN);
  vi.mocked(tunel.estadoAcceso).mockReturnValue("ok");
  vi.mocked(tunel.abrirTunel).mockResolvedValue({ abierto: true, url: URL_TUNEL, error: null, desde: 1 });
  vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: Date.now() - 2 * 60_000, rechazado: null });
  vi.mocked(bd.contarLeads).mockResolvedValue(3);
  vi.mocked(bd.contarEjemplos).mockResolvedValue({ ejemplo: 0, reales: 0 });
  vi.mocked(bd.hayMensajeRealDeCliente).mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [n, v] of Object.entries(GUARDADAS)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
});

describe("estadoPuesta", () => {
  it("sin claves ni negocio guardado: todo pendiente", async () => {
    for (const n of [...Object.keys(SECRETOS), "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"]) delete process.env[n];
    vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: null, rechazado: null });
    vi.mocked(meta.estadoConexionMeta).mockReturnValue({ webhookApuntaAqui: null, comprobadoEn: null });
    expect(await estadoPuesta()).toEqual({ negocio: false, claude: false, whatsapp: false, mensajes: false, primerMensaje: false });
    expect(claves.comprobarClaveClaude).not.toHaveBeenCalled();
    expect(meta.appDelToken).not.toHaveBeenCalled();
  });

  it("con NOMBRE_NEGOCIO o un cliente real, negocio hecho", async () => {
    expect((await estadoPuesta()).negocio).toBe(false);
    olvidar();
    process.env.NOMBRE_NEGOCIO = "Reformas Ana";
    expect((await estadoPuesta()).negocio).toBe(true);
    olvidar();
    delete process.env.NOMBRE_NEGOCIO;
    vi.mocked(bd.contarEjemplos).mockResolvedValue({ ejemplo: 10, reales: 1 });
    expect((await estadoPuesta()).negocio).toBe(true);
    olvidar();
    vi.mocked(bd.contarEjemplos).mockResolvedValue({ ejemplo: 10, reales: 0 });
    config = { ...configuracionPorDefecto(), guardada: true };
    expect((await estadoPuesta()).negocio).toBe(true);
  });

  it("claude solo es false si la clave no vale", async () => {
    vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude("claude.clave"));
    // Sin resultado todavía: optimista, y se pregunta detrás.
    expect((await estadoPuesta()).claude).toBe(true);
    await vaciarCola();
    expect((await estadoPuesta()).claude).toBe(false);
    expect(claves.comprobarClaveClaude).toHaveBeenCalledTimes(1);

    // Una clave nueva se vuelve a comprobar al momento; sin saldo no saca la puesta.
    process.env.ANTHROPIC_API_KEY = "sk-ant-otra-clave-nueva-9999";
    vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude("claude.saldo"));
    expect((await estadoPuesta()).claude).toBe(true);
    await vaciarCola();
    expect((await estadoPuesta()).claude).toBe(true);
    expect(claves.comprobarClaveClaude).toHaveBeenCalledTimes(2);
  });

  it("whatsapp necesita las cuatro claves y un token aceptado", async () => {
    delete process.env.META_APP_SECRET;
    expect((await estadoPuesta()).whatsapp).toBe(false);
    process.env.META_APP_SECRET = SECRETOS.META_APP_SECRET;
    expect((await estadoPuesta()).whatsapp).toBe(true);
    await vaciarCola();
    expect((await estadoPuesta()).whatsapp).toBe(true);

    // Token rechazado.
    olvidar();
    vi.mocked(meta.appDelToken).mockResolvedValue(null);
    await estadoPuesta();
    await vaciarCola();
    expect((await estadoPuesta()).whatsapp).toBe(false);

    // Sin red no cuenta como rechazado.
    olvidar();
    vi.mocked(meta.appDelToken).mockRejectedValue(new Error("red"));
    await estadoPuesta();
    await vaciarCola();
    expect((await estadoPuesta()).whatsapp).toBe(true);
  });

  it("mensajes con un aviso válido o con el webhook apuntando aquí", async () => {
    vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: null, rechazado: 5 });
    vi.mocked(meta.estadoConexionMeta).mockReturnValue({ webhookApuntaAqui: false, comprobadoEn: 1 });
    expect((await estadoPuesta()).mensajes).toBe(false);
    vi.mocked(meta.estadoConexionMeta).mockReturnValue({ webhookApuntaAqui: true, comprobadoEn: 1 });
    expect((await estadoPuesta()).mensajes).toBe(true);
    vi.mocked(meta.estadoConexionMeta).mockReturnValue({ webhookApuntaAqui: null, comprobadoEn: null });
    vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: 10, rechazado: null });
    expect((await estadoPuesta()).mensajes).toBe(true);
  });

  it("negocio y primerMensaje no vuelven atrás", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    config = { ...configuracionPorDefecto(), guardada: true };
    vi.mocked(bd.hayMensajeRealDeCliente).mockResolvedValue(true);
    expect(await estadoPuesta()).toMatchObject({ negocio: true, primerMensaje: true });
    // «Borrar todo»: ya no hay nada, pero la puesta no vuelve en esta sesión.
    config = configuracionPorDefecto();
    vi.mocked(bd.hayMensajeRealDeCliente).mockResolvedValue(false);
    vi.setSystemTime(new Date("2026-11-12T10:00:30Z"));
    expect(await estadoPuesta()).toMatchObject({ negocio: true, primerMensaje: true });
    expect(bd.hayMensajeRealDeCliente).toHaveBeenCalledTimes(2);
  });

  it("nunca lanza y ante un fallo no saca la puesta", async () => {
    vi.mocked(cs.configuracionActiva).mockRejectedValue(new Error("sin base de datos"));
    vi.mocked(bd.contarEjemplos).mockRejectedValue(new Error("sin base de datos"));
    vi.mocked(bd.hayMensajeRealDeCliente).mockRejectedValue(new Error("sin base de datos"));
    vi.mocked(eventos.ultimosWebhooks).mockImplementation(() => {
      throw new Error("roto");
    });
    vi.mocked(claves.comprobarClaveClaude).mockRejectedValue(new Error("roto"));
    vi.mocked(meta.appDelToken).mockRejectedValue(new Error("roto"));
    const p = await estadoPuesta();
    await vaciarCola();
    expect(p).toEqual({ negocio: true, claude: true, whatsapp: true, mensajes: true, primerMensaje: true });
    expect(await estadoPuesta()).toEqual({ negocio: true, claude: true, whatsapp: true, mensajes: true, primerMensaje: true });
  });
});

describe("estadoConexiones", () => {
  describe("Claude", () => {
    it("sin clave", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(filaDe(await estadoConexiones(), "claude")).toEqual({
        id: "claude",
        nombre: "Claude (tu asistente)",
        estado: "error",
        detalle: "Falta la clave de Claude",
        accion: { texto: "Arreglar", paso: "claude" },
      });
    });

    it("clave mala", async () => {
      vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude("claude.clave"));
      expect(filaDe(await estadoConexiones(), "claude")).toMatchObject({
        estado: "error",
        detalle: "Esa clave no es válida. Cópiala otra vez de platform.claude.com → API Keys.",
        accion: { texto: "Arreglar", paso: "claude" },
      });
    });

    it("sin saldo", async () => {
      vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude("claude.saldo"));
      expect(filaDe(await estadoConexiones(), "claude")).toMatchObject({
        estado: "error",
        detalle: "Tu cuenta de Anthropic no tiene saldo. Añádelo en Billing y pulsa Reintentar.",
        accion: { texto: "Arreglar", paso: "claude" },
      });
    });

    it("modelo", async () => {
      vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude("claude.modelo"));
      const f = filaDe(await estadoConexiones(), "claude");
      expect(f).toMatchObject({ estado: "error", detalle: "Tu clave no tiene acceso a ese modelo. Elige el otro modelo en Ajustes → Avanzado." });
      expect(f?.accion).toBeUndefined();
    });

    it("saturado", async () => {
      vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude("claude.ocupado"));
      expect(filaDe(await estadoConexiones(), "claude")).toMatchObject({ estado: "atencion", detalle: "Claude está saturado ahora mismo. Vuelve a intentarlo en un momento." });
      olvidar();
      vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude("red"));
      expect(filaDe(await estadoConexiones(), "claude")).toMatchObject({ estado: "atencion", detalle: "No se ha podido comprobar ahora mismo" });
    });

    it("ok", async () => {
      expect(filaDe(await estadoConexiones(), "claude")).toEqual({
        id: "claude",
        nombre: "Claude (tu asistente)",
        estado: "ok",
        detalle: "Contesta con Claude Haiku 5.5 · rápido",
      });
      expect(claves.comprobarClaveClaude).toHaveBeenCalledWith(undefined, "claude-haiku-5-5");
      olvidar();
      process.env.MODELO = "claude-experimental-1";
      expect(filaDe(await estadoConexiones(), "claude")?.detalle).toBe("Contesta con claude-experimental-1");
      olvidar();
      config = configuracionPorDefecto();
      config.sistema.asistente.modelo = "claude-sonnet-5-5";
      expect(filaDe(await estadoConexiones(), "claude")?.detalle).toBe("Contesta con Claude Sonnet 5.5 · más cuidadoso");
    });

    it("una comprobación que se cuelga no para a las demás", async () => {
      vi.useFakeTimers();
      vi.mocked(claves.comprobarClaveClaude).mockReturnValue(new Promise(() => {}));
      const promesa = estadoConexiones();
      await vi.advanceTimersByTimeAsync(5_001);
      const e = await promesa;
      expect(filaDe(e, "claude")).toMatchObject({ estado: "atencion", detalle: "No se ha podido comprobar ahora mismo" });
      expect(filaDe(e, "whatsapp")?.estado).toBe("ok");
      expect(filaDe(e, "datos")?.estado).toBe("ok");
    });
  });

  describe("WhatsApp", () => {
    it("sin conectar", async () => {
      delete process.env.META_APP_SECRET;
      expect(filaDe(await estadoConexiones(), "whatsapp")).toEqual({
        id: "whatsapp",
        nombre: "WhatsApp",
        estado: "error",
        detalle: "Sin conectar",
        accion: { texto: "Arreglar", paso: "whatsapp" },
      });
    });

    it("token rechazado", async () => {
      vi.mocked(meta.appDelToken).mockResolvedValue(null);
      expect(filaDe(await estadoConexiones(), "whatsapp")).toMatchObject({
        estado: "error",
        detalle: "El token de Meta no vale o ha caducado. Pega el token permanente del usuario del sistema, no el de la pantalla de inicio de Meta, que caduca en 24 h.",
        accion: { texto: "Arreglar", paso: "whatsapp" },
      });
      olvidar();
      vi.mocked(meta.appDelToken).mockRejectedValue(new Error("sin red"));
      expect(filaDe(await estadoConexiones(), "whatsapp")).toMatchObject({ estado: "atencion", detalle: "No se ha podido comprobar ahora mismo" });
    });

    it("caduca", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-11T09:00:00Z"));
      // 12 de noviembre, 10:30 en Madrid (UTC+1).
      vi.mocked(meta.caducidad).mockResolvedValue(Date.UTC(2026, 10, 12, 9, 30) / 1000);
      expect(filaDe(await estadoConexiones(), "whatsapp")).toMatchObject({
        estado: "atencion",
        detalle: "El token caduca el 12 de noviembre a las 10:30: usa el permanente del usuario del sistema",
        accion: { texto: "Cambiar", paso: "whatsapp" },
      });
      // Ya caducado: como un token que no vale.
      olvidar();
      vi.mocked(meta.caducidad).mockResolvedValue(Date.UTC(2026, 10, 10, 9, 30) / 1000);
      expect(filaDe(await estadoConexiones(), "whatsapp")).toMatchObject({ estado: "error", accion: { texto: "Arreglar", paso: "whatsapp" } });
    });

    it("ok con el número", async () => {
      expect(filaDe(await estadoConexiones(), "whatsapp")).toEqual({ id: "whatsapp", nombre: "WhatsApp", estado: "ok", detalle: "+34 600 000 000 · Estudio de prueba" });
      olvidar();
      vi.mocked(meta.numeroDelNegocio).mockReturnValue(null);
      expect(filaDe(await estadoConexiones(), "whatsapp")?.detalle).toBe("Conectado");
    });
  });

  describe("Mensajes", () => {
    it("sin claves", async () => {
      delete process.env.WHATSAPP_TOKEN;
      expect(filaDe(await estadoConexiones(), "mensajes")).toEqual({
        id: "mensajes",
        nombre: "Mensajes que llegan a este ordenador",
        estado: "atencion",
        detalle: "Primero conecta tu WhatsApp",
        accion: { texto: "Arreglar", paso: "whatsapp" },
      });
    });

    it("túnel cerrado con token", async () => {
      vi.mocked(tunel.urlPublica).mockReturnValue(null);
      vi.mocked(tunel.estadoTunel).mockReturnValue({ abierto: false, url: null, error: explicar("ngrok.ocupado"), desde: null });
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject({
        estado: "error",
        detalle: "WhatsApp no recibe mensajes. Tu túnel ya está abierto en otro ordenador. Ciérralo allí y vuelve a intentarlo.",
        accion: { texto: "Arreglar", arreglar: "tunel" },
      });
    });

    it("túnel cerrado sin token", async () => {
      vi.mocked(tunel.urlPublica).mockReturnValue(null);
      vi.mocked(tunel.estadoTunel).mockReturnValue({ abierto: false, url: null, error: null, desde: null });
      vi.mocked(tunel.tokenNgrok).mockReturnValue(null);
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject({
        estado: "error",
        detalle: "WhatsApp no recibe mensajes: el túnel está cerrado",
        accion: { texto: "Arreglar", paso: "whatsapp" },
      });
    });

    it("firma rechazada", async () => {
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: 1_000, rechazado: 2_000 });
      const esperado = {
        estado: "error",
        detalle: "Llegan avisos de Meta, pero la firma no coincide. Vuelve a pegar la clave secreta de la app en Ajustes → Conexiones.",
        accion: { texto: "Arreglar", paso: "whatsapp" },
      };
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject(esperado);
      olvidar();
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: null, rechazado: 2_000 });
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject(esperado);
    });

    it("app sin suscribir", async () => {
      suscrita = false;
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject({
        estado: "error",
        detalle: "Tu app de Meta no escucha esta cuenta: no llegarían los mensajes",
        accion: { texto: "Arreglar", arreglar: "suscripcion" },
      });
      // Solo lee, con el token, y nunca suscribe.
      const llamada = vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith("/subscribed_apps"));
      expect(String(llamada?.[0])).toBe(`${GRAPH}/${WABA}/subscribed_apps`);
      expect((llamada?.[1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRETOS.WHATSAPP_TOKEN}`);
      expect(llamada?.[1]?.method ?? "GET").toBe("GET");
      expect(meta.suscribirApp).not.toHaveBeenCalled();
    });

    it("otra dirección", async () => {
      vi.mocked(meta.estadoConexionMeta).mockReturnValue({ webhookApuntaAqui: false, comprobadoEn: 1 });
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject({
        estado: "error",
        detalle: "Meta avisa a otra dirección",
        accion: { texto: "Arreglar", arreglar: "webhook" },
      });
      expect(meta.apuntarWebhook).not.toHaveBeenCalled();
    });

    it("último aviso", async () => {
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: Date.now() - 5 * 60_000 - 1_000, rechazado: null });
      expect(filaDe(await estadoConexiones(), "mensajes")).toEqual({
        id: "mensajes",
        nombre: "Mensajes que llegan a este ordenador",
        estado: "ok",
        detalle: "Meta avisa a este ordenador · último aviso hace 5 min",
      });
      olvidar();
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: Date.now() - 10_000, rechazado: Date.now() - 20_000 });
      expect(filaDe(await estadoConexiones(), "mensajes")?.detalle).toBe("Meta avisa a este ordenador · último aviso hace un momento");
      olvidar();
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: Date.now() - 3 * 3600_000, rechazado: null });
      expect(filaDe(await estadoConexiones(), "mensajes")?.detalle).toBe("Meta avisa a este ordenador · último aviso hace 3 h");
      olvidar();
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: Date.now() - 50 * 3600_000, rechazado: null });
      expect(filaDe(await estadoConexiones(), "mensajes")?.detalle).toBe("Meta avisa a este ordenador · último aviso hace 2 días");
    });

    it("modo servidor", async () => {
      vi.mocked(tunel.modoServidor).mockReturnValue(true);
      vi.mocked(tunel.urlPublica).mockReturnValue("https://crm.ejemplo.es");
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: Date.now() - 1_000, rechazado: null });
      expect(filaDe(await estadoConexiones(), "mensajes")).toEqual({
        id: "mensajes",
        nombre: "Mensajes que llegan a tu servidor",
        estado: "ok",
        detalle: "Meta avisa a https://crm.ejemplo.es/webhook · último aviso hace un momento",
      });
      olvidar();
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: null, rechazado: null });
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject({ estado: "ok", detalle: "Meta avisa a https://crm.ejemplo.es/webhook" });
    });

    it("nada aún", async () => {
      vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: null, rechazado: null });
      expect(filaDe(await estadoConexiones(), "mensajes")).toMatchObject({ estado: "atencion", detalle: "Aún no ha llegado nada de Meta desde que se abrió" });
      expect(filaDe(await estadoConexiones(), "mensajes")?.accion).toBeUndefined();
    });
  });

  describe("Datos", () => {
    it("pruebas", async () => {
      process.env.BD_LOCAL = "bd-pruebas/servidor";
      vi.mocked(bd.contarLeads).mockResolvedValue(1);
      const f = filaDe(await estadoConexiones(), "datos");
      expect(f).toMatchObject({ id: "datos", nombre: "Tus datos", estado: "ok" });
      expect(f?.detalle).toMatch(/^Datos de pruebas en este ordenador · 1 cliente · \d+ ms$/);
    });

    it("Supabase lento", async () => {
      process.env.SUPABASE_DB_URL = "postgresql://postgres:contrasena-muy-secreta@db.ejemplo.supabase.co:5432/postgres";
      const rapida = filaDe(await estadoConexiones(), "datos");
      expect(rapida?.estado).toBe("ok");
      expect(rapida?.detalle).toMatch(/^Tus datos se guardan en Supabase · 3 clientes · \d+ ms$/);

      olvidar();
      vi.useFakeTimers();
      vi.mocked(bd.contarLeads).mockImplementation(() => new Promise((r) => setTimeout(() => r(3), 1_600)));
      const promesa = estadoConexiones();
      await vi.advanceTimersByTimeAsync(1_700);
      expect(filaDe(await promesa, "datos")).toMatchObject({ estado: "atencion", detalle: "Va lento: cada respuesta tarda más" });
    });

    it("PGlite", async () => {
      expect(filaDe(await estadoConexiones(), "datos")).toEqual({
        id: "datos",
        nombre: "Tus datos",
        estado: "ok",
        detalle: "Tus datos se guardan en este ordenador, en la carpeta datos/. Haz copia de esa carpeta.",
      });
      olvidar();
      vi.mocked(tunel.modoServidor).mockReturnValue(true);
      expect(filaDe(await estadoConexiones(), "datos")?.detalle).toBe("Tus datos se guardan en tu servidor y se copian cada día");
    });

    it("fallo", async () => {
      vi.mocked(bd.contarLeads).mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
      const f = filaDe(await estadoConexiones(), "datos");
      expect(f).toEqual({
        id: "datos",
        nombre: "Tus datos",
        estado: "error",
        detalle: "El CRM no llega a tus datos. Revisa la conexión a internet; si usas Supabase, que el proyecto no esté en pausa.",
      });
    });
  });

  it("Acceso solo si falla", async () => {
    expect(filaDe(await estadoConexiones(), "acceso")).toBeUndefined();
    olvidar();
    vi.mocked(tunel.estadoAcceso).mockReturnValue("error");
    const e = await estadoConexiones();
    expect(e.filas.map((f) => f.id)).toEqual(["claude", "whatsapp", "mensajes", "datos", "acceso"]);
    expect(filaDe(e, "acceso")).toEqual({ id: "acceso", nombre: "Acceso", estado: "error", detalle: "El panel se puede abrir desde internet: cierra el CRM" });
  });

  it("el resumen es la peor fila", async () => {
    const bien = await estadoConexiones();
    expect(bien.filas.map((f) => f.estado)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(bien.resumen).toBe("ok");
    olvidar();
    vi.mocked(eventos.ultimosWebhooks).mockReturnValue({ valido: null, rechazado: null });
    expect((await estadoConexiones()).resumen).toBe("atencion");
    olvidar();
    vi.mocked(meta.appDelToken).mockResolvedValue(null);
    expect((await estadoConexiones()).resumen).toBe("error");
  });

  it("número de prueba", async () => {
    expect((await estadoConexiones()).numeroDePrueba).toBe(false);
    olvidar();
    vi.mocked(meta.numeroDelNegocio).mockReturnValue({ ...NUMERO, prueba: true });
    expect((await estadoConexiones()).numeroDePrueba).toBe(true);
  });

  it("60 s de caché y forzar solo tras 10 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    const primera = await estadoConexiones();
    expect(bd.contarLeads).toHaveBeenCalledTimes(1);
    expect(primera.comprobadoEn).toBe(Date.now());

    vi.setSystemTime(new Date("2026-11-12T10:00:05Z"));
    expect((await estadoConexiones({ forzar: true })).comprobadoEn).toBe(primera.comprobadoEn);
    expect(bd.contarLeads).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-12T10:00:11Z"));
    expect((await estadoConexiones()).comprobadoEn).toBe(primera.comprobadoEn);
    const forzada = await estadoConexiones({ forzar: true });
    expect(forzada.comprobadoEn).toBe(Date.now());
    expect(bd.contarLeads).toHaveBeenCalledTimes(2);
    // Forzar vuelve a preguntar a Claude y a Meta; sin forzar se usa lo guardado 10 min.
    expect(claves.comprobarClaveClaude).toHaveBeenCalledTimes(2);
    expect(meta.appDelToken).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-11-12T10:01:12Z"));
    await estadoConexiones();
    expect(bd.contarLeads).toHaveBeenCalledTimes(3);
    expect(claves.comprobarClaveClaude).toHaveBeenCalledTimes(2);
    expect(meta.appDelToken).toHaveBeenCalledTimes(2);

    // Un token nuevo se comprueba al momento.
    process.env.WHATSAPP_TOKEN = "EAAG-token-nuevo-111111";
    vi.setSystemTime(new Date("2026-11-12T10:02:13Z"));
    await estadoConexiones();
    expect(meta.appDelToken).toHaveBeenCalledTimes(3);
  });

  it("completo trae la lista de comprobaciones", async () => {
    // Con el formulario: la bienvenida aprobada sí hace falta y se comprueba.
    config = { ...config, web: { ...config.web, entrada: "formulario" } };
    process.env.TELEFONO_COMERCIAL = "34600999999";
    expect((await estadoConexiones()).comprobaciones).toBeUndefined();
    const e = await estadoConexiones({ completo: true });
    const lista = e.comprobaciones ?? [];
    expect(lista.map((c) => c.id)).toEqual([
      "claves",
      "claude",
      "token",
      "numero",
      "plantilla",
      "aviso",
      "suscripcion",
      "secreto",
      "url",
      "webhook",
      "firma",
      "acceso",
      "datos",
      "voz",
      "instrucciones",
    ]);
    expect(lista.every((c) => c.ok === true)).toBe(true);
    const de = (id: string) => lista.find((c) => c.id === id);
    expect(de("claves")?.texto).toBe("Claves guardadas: Claude, WhatsApp y la clave secreta de la app");
    expect(de("token")?.texto).toBe("El token de Meta no caduca");
    expect(de("url")?.texto).toBe(`Los mensajes llegan a ${URL_TUNEL}/webhook`);
    expect(de("instrucciones")?.texto).toBe(`Instrucciones del asistente: ${config.perfil.nombre}`);
    expect(meta.comprobarFirma).toHaveBeenCalledWith(URL_TUNEL);
    expect(meta.estadoPlantilla).toHaveBeenCalledWith(config.plantilla.nombre, config.plantilla.idioma);
    expect(meta.estadoPlantilla).toHaveBeenCalledWith("aviso_comercial", "es_ES");
    // Lo guardado no lleva la lista.
    expect((await estadoConexiones()).comprobaciones).toBeUndefined();

    // Lo que falta, con su solución, y avisos en null.
    olvidar();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.META_APP_SECRET;
    delete process.env.GEMINI_API_KEY;
    vi.mocked(meta.estadoPlantilla).mockImplementation(async (nombre, idioma) => ({ nombre, idioma, estado: "EN_REVISION" }));
    vi.mocked(meta.caducidad).mockResolvedValue(Date.now() / 1000 + 3600);
    const mal = (await estadoConexiones({ completo: true })).comprobaciones ?? [];
    const m = (id: string) => mal.find((c) => c.id === id);
    expect(m("claves")).toEqual({ id: "claves", ok: false, texto: "Faltan claves: la clave de Claude y la clave secreta de la app", solucion: "Pégalas en Ajustes → Conexiones" });
    expect(m("plantilla")?.ok).toBeNull();
    expect(m("aviso")).toEqual({
      id: "aviso",
      ok: null,
      texto: "Sin el aviso aprobado, los avisos solo te llegan si has escrito al número del negocio en las últimas 24 h",
    });
    expect(m("voz")).toEqual({ id: "voz", ok: null, texto: "Sin clave de notas de voz: se pide que lo escriban" });
    expect(m("claude")?.ok).toBe(false);
    // Ningún texto nombra un archivo ni un comando.
    for (const c of mal) expect(`${c.texto} ${c.solucion ?? ""}`).not.toMatch(/\.env|arrancar|comprobar\.sh|agente\.md|bash /);
  });

  it("con el botón de WhatsApp la bienvenida no se mira ni falta", async () => {
    vi.mocked(meta.estadoPlantilla).mockImplementation(async (nombre, idioma) => ({ nombre, idioma, estado: "NO_EXISTE" }));
    const lista = (await estadoConexiones({ completo: true })).comprobaciones ?? [];
    expect(lista.find((c) => c.id === "plantilla")).toEqual({ id: "plantilla", ok: true, texto: "Tu web usa el botón de WhatsApp: no hace falta mensaje de bienvenida" });
    expect(meta.estadoPlantilla).not.toHaveBeenCalledWith(config.plantilla.nombre, config.plantilla.idioma);
  });

  it("ningún valor de clave aparece en el JSON ni en los textos de Meta", async () => {
    process.env.TELEFONO_COMERCIAL = "34600999999";
    vi.mocked(meta.numeroDelNegocio).mockReturnValue({ ...NUMERO, nombre: `Estudio ${SECRETOS.WHATSAPP_TOKEN}` });
    vi.mocked(meta.estadoPlantilla).mockImplementation(async (nombre, idioma) => ({ nombre, idioma, estado: "ERROR", motivo: `Token ${SECRETOS.WHATSAPP_TOKEN} rechazado` }));
    vi.mocked(meta.numeros).mockResolvedValue([{ ...NUMERO, nombre: `Usa ${SECRETOS.META_APP_SECRET}` }]);
    const json = JSON.stringify(await estadoConexiones({ completo: true }));
    vi.mocked(tunel.urlPublica).mockReturnValue(null);
    vi.mocked(tunel.estadoTunel).mockReturnValue({
      abierto: false,
      url: null,
      error: { codigo: "ngrok.token", titulo: "Esa clave de ngrok no vale", solucion: `La clave ${SECRETOS.NGROK_AUTHTOKEN} no vale` },
      desde: null,
    });
    olvidar();
    const json2 = JSON.stringify(await estadoConexiones({ completo: true }));
    for (const valor of Object.values(SECRETOS)) {
      expect(json).not.toContain(valor);
      expect(json2).not.toContain(valor);
    }
    expect(json).toContain("•••");
    expect(json2).toContain("La clave ••• no vale");
  });

  it("censurar corta a 160", () => {
    expect(Array.from(censurar("á".repeat(300)))).toHaveLength(160);
    expect(censurar(`clave ${SECRETOS.ANTHROPIC_API_KEY} y token ${SECRETOS.WHATSAPP_TOKEN}`)).toBe("clave ••• y token •••");
  });
});

// ---- Las rutas ----

const peticion = (url: string, cuerpo?: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: cuerpo === undefined ? "{no es json" : JSON.stringify(cuerpo),
  });

describe("rutas", () => {
  it("arreglar llama a apuntarWebhook, suscribirApp o abrirTunel y devuelve el estado nuevo", async () => {
    // Primero sin suscribir: queda guardado.
    suscrita = false;
    const antes = (await (await getSistema(new Request("http://localhost/api/sistema"))).json()) as EstadoConexiones;
    expect(filaDe(antes, "mensajes")?.accion).toEqual({ texto: "Arreglar", arreglar: "suscripcion" });

    suscrita = true;
    const r = await postArreglar(peticion("/api/sistema/arreglar", { que: "suscripcion" }));
    expect(r.status).toBe(200);
    expect(meta.suscribirApp).toHaveBeenCalledTimes(1);
    const despues = (await r.json()) as EstadoConexiones;
    expect(filaDe(despues, "mensajes")?.estado).toBe("ok");

    const w = await postArreglar(peticion("/api/sistema/arreglar", { que: "webhook" }));
    expect(w.status).toBe(200);
    expect(meta.apuntarWebhook).toHaveBeenCalledWith(`${URL_TUNEL}/webhook`);
    expect(((await w.json()) as EstadoConexiones).filas).toHaveLength(4);

    const t = await postArreglar(peticion("/api/sistema/arreglar", { que: "tunel" }));
    expect(t.status).toBe(200);
    expect(tunel.abrirTunel).toHaveBeenCalledTimes(1);

    const mal = await postArreglar(peticion("/api/sistema/arreglar", { que: "todo" }));
    expect(mal.status).toBe(400);
    expect(await mal.json()).toEqual({ ok: false, error: "Eso no se puede arreglar desde aquí" });
    expect((await postArreglar(peticion("/api/sistema/arreglar"))).status).toBe(400);
  });

  it("arreglar sin claves: 409", async () => {
    delete process.env.WHATSAPP_TOKEN;
    for (const que of ["webhook", "suscripcion"]) {
      const r = await postArreglar(peticion("/api/sistema/arreglar", { que }));
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ ok: false, error: "Primero conecta tu WhatsApp" });
    }
    process.env.WHATSAPP_TOKEN = SECRETOS.WHATSAPP_TOKEN;
    vi.mocked(tunel.urlPublica).mockReturnValue(null);
    const r = await postArreglar(peticion("/api/sistema/arreglar", { que: "webhook" }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, error: "Primero abre el túnel" });
    expect(meta.apuntarWebhook).not.toHaveBeenCalled();
    expect(meta.suscribirApp).not.toHaveBeenCalled();
  });

  it("whatsapp de prueba con la bienvenida aprobada", async () => {
    config = { ...config, web: { ...config.web, entrada: "formulario" } };
    vi.mocked(whatsapp.enviarPlantillaConVariables).mockResolvedValue("wamid.1");
    const r = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612 345 678", nombre: "Ana" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, plantilla: config.plantilla.nombre });
    expect(whatsapp.enviarPlantillaConVariables).toHaveBeenCalledWith("34612345678", {
      nombre: config.plantilla.nombre,
      idioma: config.plantilla.idioma,
      variables: ["Ana", config.negocio.nombre],
    });
    // Sin nombre: «Prueba».
    await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }));
    expect(vi.mocked(whatsapp.enviarPlantillaConVariables).mock.calls[1][1].variables[0]).toBe("Prueba");
  });

  it("whatsapp de prueba con la bienvenida en revisión: hello_world y la nota", async () => {
    config = { ...config, web: { ...config.web, entrada: "formulario" } };
    vi.mocked(meta.estadoPlantilla).mockImplementation(async (nombre, idioma) => ({ nombre, idioma, estado: "EN_REVISION" }));
    vi.mocked(whatsapp.enviarPlantillaConVariables).mockResolvedValue("wamid.1");
    const r = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }));
    expect(await r.json()).toEqual({
      ok: true,
      plantilla: "hello_world",
      nota: "Te llega «Hello World», el mensaje de prueba de Meta, en inglés. El tuyo saldrá cuando Meta lo apruebe.",
    });
    expect(whatsapp.enviarPlantillaConVariables).toHaveBeenCalledWith("34612345678", { nombre: "hello_world", idioma: "en_US", variables: [] });
  });

  it("whatsapp de prueba con el botón de WhatsApp: un texto normal, sin mirar la bienvenida", async () => {
    vi.mocked(whatsapp.enviarTexto).mockResolvedValue("wamid.1");
    const r = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678", nombre: "Ana" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, plantilla: "" });
    expect(whatsapp.enviarTexto).toHaveBeenCalledWith("34612345678", expect.stringContaining(`Hola Ana, soy el asistente virtual de ${config.negocio.nombre}.`));
    expect(meta.estadoPlantilla).not.toHaveBeenCalled();
    expect(whatsapp.enviarPlantillaConVariables).not.toHaveBeenCalled();

    // Fuera de las 24 h: «Hello World», que Meta trae en todas las cuentas.
    olvidar();
    vi.mocked(whatsapp.enviarTexto).mockRejectedValue(new whatsapp.ErrorWhatsApp("Han pasado más de 24 h", 131047, "(#131047) Re-engagement message"));
    vi.mocked(whatsapp.enviarPlantillaConVariables).mockResolvedValue("wamid.2");
    const fuera = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }));
    expect(fuera.status).toBe(200);
    expect(((await fuera.json()) as { plantilla: string }).plantilla).toBe("hello_world");
    expect(whatsapp.enviarPlantillaConVariables).toHaveBeenCalledWith("34612345678", { nombre: "hello_world", idioma: "en_US", variables: [] });

    // Otro error de Meta: 502 con su explicación, sin probar nada más.
    olvidar();
    vi.mocked(whatsapp.enviarPlantillaConVariables).mockClear();
    vi.mocked(whatsapp.enviarTexto).mockRejectedValue(new whatsapp.ErrorWhatsApp("no está en la lista", 131030));
    const fallo = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }));
    expect(fallo.status).toBe(502);
    expect(whatsapp.enviarPlantillaConVariables).not.toHaveBeenCalled();
    expect(meta.estadoPlantilla).not.toHaveBeenCalled();
    expect(bd.guardarMutaciones).not.toHaveBeenCalled();
  });

  it("whatsapp de prueba no crea ningún cliente", async () => {
    config = { ...config, web: { ...config.web, entrada: "formulario" } };
    vi.mocked(whatsapp.enviarPlantillaConVariables).mockResolvedValue("wamid.1");
    expect((await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "12" }))).status).toBe(400);
    const nombreLargo = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678", nombre: "x".repeat(41) }));
    expect(await nombreLargo.json()).toEqual({ ok: false, error: "El nombre, de 1 a 40 letras" });
    expect((await postWhatsApp(peticion("/api/whatsapp/prueba"))).status).toBe(400);

    for (let i = 0; i < 3; i++) expect((await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }))).status).toBe(200);
    const cuarta = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }));
    expect(cuarta.status).toBe(429);
    expect(await cuarta.json()).toEqual({ ok: false, error: "Espera un minuto antes de enviar otra prueba" });

    olvidar();
    vi.mocked(whatsapp.enviarPlantillaConVariables).mockRejectedValue(new whatsapp.ErrorWhatsApp("no está en la lista", 131030));
    const fallo = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }));
    expect(fallo.status).toBe(502);
    expect(await fallo.json()).toEqual({
      ok: false,
      error: "No se ha enviado: Ese móvil no está en la lista de prueba de Meta. Añádelo en tu app de Meta (WhatsApp → Configuración de la API) y vuelve a enviar.",
      codigo: "meta.lista",
    });

    olvidar();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const sin = await postWhatsApp(peticion("/api/whatsapp/prueba", { telefono: "612345678" }));
    expect(sin.status).toBe(409);
    expect(await sin.json()).toEqual({ ok: false, error: "Primero conecta tu WhatsApp" });

    expect(bd.guardarMutaciones).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it("aviso de prueba: texto; 131047 con plantilla; 131047 sin plantilla → 409; sin móvil → 409", async () => {
    process.env.TELEFONO_COMERCIAL = "34600999999";
    vi.mocked(aviso.enviarAviso).mockResolvedValue({ ok: true });
    const texto = await postAviso(peticion("/api/avisos/prueba", {}));
    expect(await texto.json()).toEqual({ ok: true, como: "texto" });
    const [telefono, cuerpo] = vi.mocked(aviso.enviarAviso).mock.calls[0];
    expect(telefono).toBe("34600999999");
    expect(cuerpo).toContain("Cliente de prueba");
    expect(cuerpo).toContain("Aviso de prueba");

    olvidar();
    vi.mocked(aviso.enviarAviso).mockResolvedValue({ ok: false, fueraDeVentana: true, error: "ventana" });
    vi.mocked(whatsapp.enviarPlantillaConVariables).mockResolvedValue("wamid.2");
    const plantilla = await postAviso(peticion("/api/avisos/prueba", {}));
    expect(await plantilla.json()).toEqual({ ok: true, como: "plantilla" });
    expect(whatsapp.enviarPlantillaConVariables).toHaveBeenCalledWith("34600999999", {
      nombre: "aviso_comercial",
      idioma: "es_ES",
      variables: ["Cliente de prueba", "Aviso de prueba", "+34 600 999 999"],
    });

    olvidar();
    vi.mocked(meta.estadoPlantilla).mockImplementation(async (nombre, idioma) => ({ nombre, idioma, estado: "NO_EXISTE" }));
    const sinPlantilla = await postAviso(peticion("/api/avisos/prueba", {}));
    expect(sinPlantilla.status).toBe(409);
    expect(await sinPlantilla.json()).toEqual({
      ok: false,
      error: "Para que te lleguen los avisos, escribe «hola» al número del negocio una vez al día. Luego vuelve a probar.",
    });

    olvidar();
    vi.mocked(aviso.enviarAviso).mockResolvedValue({ ok: false, fueraDeVentana: false, error: "revisa la clave en .env" });
    const otro = await postAviso(peticion("/api/avisos/prueba", {}));
    expect(otro.status).toBe(502);
    expect(((await otro.json()) as { error: string }).error).toBe("No se ha enviado: Meta ha rechazado el envío. Vuelve a intentarlo en un momento.");

    olvidar();
    delete process.env.TELEFONO_COMERCIAL;
    const sinMovil = await postAviso(peticion("/api/avisos/prueba", {}));
    expect(sinMovil.status).toBe(409);
    expect(await sinMovil.json()).toEqual({ ok: false, error: "Pon antes tu móvil" });

    // Los 3 por minuto.
    olvidar();
    process.env.TELEFONO_COMERCIAL = "34600999999";
    vi.mocked(aviso.enviarAviso).mockResolvedValue({ ok: true });
    for (let i = 0; i < 3; i++) await postAviso(peticion("/api/avisos/prueba", {}));
    expect((await postAviso(peticion("/api/avisos/prueba", {}))).status).toBe(429);
    expect(bd.guardarMutaciones).not.toHaveBeenCalled();
  });

  it("modelo: 400 fuera de la lista, 401, 404 y 502", async () => {
    const fuera = await postModelo(peticion("/api/asistente/modelo", { modelo: "gpt-5" }));
    expect(fuera.status).toBe(400);
    expect(await fuera.json()).toEqual({ ok: false, error: "Elige uno de los dos modelos" });

    expect(await (await postModelo(peticion("/api/asistente/modelo", { modelo: "claude-sonnet-5-5" }))).json()).toEqual({ ok: true });
    expect(claves.comprobarClaveClaude).toHaveBeenCalledWith(undefined, "claude-sonnet-5-5");

    const casos: [CodigoError, number][] = [
      ["claude.clave", 401],
      ["claude.modelo", 404],
      ["claude.saldo", 502],
      ["claude.ocupado", 502],
      ["red", 502],
    ];
    for (const [codigo, status] of casos) {
      vi.mocked(claves.comprobarClaveClaude).mockResolvedValue(falloClaude(codigo));
      const r = await postModelo(peticion("/api/asistente/modelo", { modelo: "claude-haiku-5-5" }));
      expect(r.status).toBe(status);
      const e = explicar(codigo);
      expect(await r.json()).toEqual({ ok: false, error: `${e.titulo}. ${e.solucion}`, codigo });
    }
  });

  it("activo: 400 sin booleano y la respuesta con pausadoEn", async () => {
    const sin = await postActivo(peticion("/api/asistente/activo", { activo: "no" }));
    expect(sin.status).toBe(400);
    expect(await sin.json()).toEqual({ ok: false, error: "Falta indicar si el asistente contesta" });
    expect((await postActivo(peticion("/api/asistente/activo"))).status).toBe(400);

    vi.mocked(cs.cambiarAsistente).mockResolvedValue({ activo: false, pausadoEn: 1_234, modelo: null });
    const r = await postActivo(peticion("/api/asistente/activo", { activo: false }));
    expect(await r.json()).toEqual({ ok: true, activo: false, pausadoEn: 1_234 });
    expect(cs.cambiarAsistente).toHaveBeenCalledWith(false);
  });
});
