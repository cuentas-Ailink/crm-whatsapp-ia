import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearConexionFalsa } from "../scripts/modo-prueba/falso.mjs";
import { arrancarNucleo } from "../scripts/modo-prueba/nucleo.mjs";
import {
  NO_DISPONIBLE,
  NO_PERMITIDO,
  accionDeGraph,
  autorizado,
  contenidoDe,
  cuerpoWebhook,
  estaPermitido as permitidoEnElPuente,
  firma,
  hostLocal,
  idDeWamid,
  jidIgnorado,
  mensajeMeta,
  telefonoDeJid,
  unificar,
  wamidDe,
} from "../scripts/modo-prueba/traducir.mjs";
import { VERSION_BAILEYS, activarModoPrueba, borrarModoPrueba, carpetaSesion, destinoModoPrueba, guardarPermitidos, leerModoPrueba, modoWhatsApp, puertoPuente } from "./modo-prueba";
import { argumentosInstalacion, esperarPreparacion, estadoInstalacion, herramientaLista, prepararModoPrueba } from "./modo-prueba-puente";
import { MAXIMO_PERMITIDOS, NO_DISPONIBLE_EN_PRUEBA, enmascararVinculado, estaPermitido, revisarPermitidos } from "./modo-prueba-reglas";
import { enviarPlantilla, enviarTexto, marcarLeido } from "./whatsapp";

const RAIZ = path.resolve(__dirname, "..");
let carpeta: string;

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), "crm-modo-prueba-test-"));
  vi.stubEnv("DIR_MODO_PRUEBA", path.join(carpeta, "datos"));
  vi.stubEnv("DIR_HERRAMIENTA_MODO_PRUEBA", path.join(carpeta, "herramienta"));
  vi.stubEnv("CRM_DOMINIO", "");
  vi.stubEnv("MODO_PRUEBA_FALSO", "");
  const g = globalThis as unknown as { __modoPrueba?: unknown; __puentePrueba?: unknown };
  delete g.__modoPrueba;
  delete g.__puentePrueba;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(carpeta, { recursive: true, force: true });
});

// ─── La traducción: WhatsApp Web (Baileys) → aviso de Meta ───────────────────────────────────────

describe("traducción de un mensaje de Baileys al aviso de Meta", () => {
  const base = { key: { remoteJid: "34600111222@s.whatsapp.net", fromMe: false, id: "ABC123" }, messageTimestamp: 1_800_000_000, pushName: "Laura" };

  it("un texto", () => {
    expect(mensajeMeta({ ...base, message: { conversation: "Hola" } }, "34600111222")).toEqual({
      from: "34600111222",
      id: "wamid.prueba.ABC123",
      timestamp: "1800000000",
      type: "text",
      text: { body: "Hola" },
    });
  });

  it("un texto con formato, dentro de un mensaje temporal y con la hora como Long", () => {
    const largo = { toNumber: () => 1_800_000_001 };
    const m = { ...base, messageTimestamp: largo, message: { ephemeralMessage: { message: { extendedTextMessage: { text: "¿Tenéis cita?" } } } } };
    expect(mensajeMeta(m, "34600111222")).toMatchObject({ type: "text", text: { body: "¿Tenéis cita?" }, timestamp: "1800000001" });
  });

  it("una nota de voz lleva su id para descargarla, como Meta", () => {
    const m = { ...base, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } } };
    expect(mensajeMeta(m, "34600111222")).toMatchObject({ type: "audio", audio: { id: "ABC123", mime_type: "audio/ogg; codecs=opus", voice: true } });
  });

  it("foto, ubicación y lo desconocido: el webhook los convierte en «(foto)», «(ubicación)» y «(mensaje)»", () => {
    expect(mensajeMeta({ ...base, message: { imageMessage: {} } }, "34600111222")).toMatchObject({ type: "image", image: { id: "ABC123" } });
    expect(mensajeMeta({ ...base, message: { locationMessage: {} } }, "34600111222")).toMatchObject({ type: "location", location: {} });
    expect(mensajeMeta({ ...base, message: { pollCreationMessage: {} } }, "34600111222")).toMatchObject({ type: "unsupported" });
  });

  it("reacciones, avisos de protocolo, ediciones, textos vacíos y mensajes sin teléfono no pasan", () => {
    expect(mensajeMeta({ ...base, message: { reactionMessage: { text: "👍" } } }, "34600111222")).toBeNull();
    expect(mensajeMeta({ ...base, message: { protocolMessage: {} } }, "34600111222")).toBeNull();
    expect(mensajeMeta({ ...base, message: { editedMessage: {} } }, "34600111222")).toBeNull();
    expect(mensajeMeta({ ...base, message: { conversation: "   " } }, "34600111222")).toBeNull();
    expect(mensajeMeta({ ...base, message: { conversation: "Hola" } }, null)).toBeNull();
    expect(mensajeMeta({ ...base, message: undefined }, "34600111222")).toBeNull();
  });

  it("quita los envoltorios (una sola vez, documento con texto)", () => {
    expect(contenidoDe({ viewOnceMessageV2: { message: { imageMessage: { caption: "x" } } } })).toEqual({ imageMessage: { caption: "x" } });
    expect(contenidoDe({ documentWithCaptionMessage: { message: { documentMessage: {} } } })).toEqual({ documentMessage: {} });
  });

  it("el aviso tiene la forma que lee app/webhook y la firma es la de Meta", () => {
    const mensaje = mensajeMeta({ ...base, message: { conversation: "Hola" } }, "5215512345678");
    const cuerpo = cuerpoWebhook("5215512345678", "Laura", mensaje);
    const valor = cuerpo.entry[0].changes[0].value;
    expect(valor.messages[0]).toMatchObject({ from: "525512345678", type: "text" });
    expect(valor.contacts[0]).toEqual({ wa_id: "525512345678", profile: { name: "Laura" } });
    const texto = JSON.stringify(cuerpo);
    expect(firma(texto, "secreto")).toBe(`sha256=${createHmac("sha256", "secreto").update(texto).digest("hex")}`);
  });

  it("jids: grupos, difusiones y canales se ignoran; los @lid no son teléfonos", () => {
    expect(jidIgnorado("123-456@g.us")).toBe(true);
    expect(jidIgnorado("status@broadcast")).toBe(true);
    expect(jidIgnorado("1203630@newsletter")).toBe(true);
    expect(jidIgnorado("34600111222@s.whatsapp.net")).toBe(false);
    expect(telefonoDeJid("34600111222:12@s.whatsapp.net")).toBe("34600111222");
    expect(telefonoDeJid("1234567890123@lid")).toBeNull();
    expect(unificar("5215512345678")).toBe("525512345678");
    expect(idDeWamid(wamidDe("XYZ"))).toBe("XYZ");
    expect(idDeWamid("wamid.HBgM")).toBeNull();
  });
});

// ─── La traducción: llamada a «Graph» → envío por WhatsApp ───────────────────────────────────────

describe("traducción de una llamada a Graph al envío por WhatsApp", () => {
  it("un texto, el «leído» con y sin «escribiendo…», una plantilla y lo que no se entiende", () => {
    expect(accionDeGraph({ messaging_product: "whatsapp", to: "34600111222", type: "text", text: { preview_url: false, body: "Hola, soy el asistente" } })).toEqual({
      tipo: "texto",
      to: "34600111222",
      texto: "Hola, soy el asistente",
    });
    expect(accionDeGraph({ messaging_product: "whatsapp", status: "read", message_id: "wamid.prueba.A", typing_indicator: { type: "text" } })).toEqual({
      tipo: "leido",
      wamid: "wamid.prueba.A",
      escribiendo: true,
    });
    expect(accionDeGraph({ status: "read", message_id: "wamid.prueba.A" })).toMatchObject({ escribiendo: false });
    expect(accionDeGraph({ type: "template", to: "34600111222", template: { name: "solicitud_general" } })).toEqual({ tipo: "plantilla" });
    expect(accionDeGraph({ type: "text", to: "", text: { body: "x" } })).toEqual({ tipo: "no-valida" });
    expect(accionDeGraph({ type: "image" })).toEqual({ tipo: "no-valida" });
    expect(accionDeGraph(null)).toEqual({ tipo: "no-valida" });
  });

  it("autorización en tiempo constante y solo desde 127.0.0.1 o localhost", () => {
    expect(autorizado("Bearer abc", "abc")).toBe(true);
    expect(autorizado("Bearer abd", "abc")).toBe(false);
    expect(autorizado(undefined, "abc")).toBe(false);
    expect(autorizado("Bearer ", "")).toBe(false);
    expect(hostLocal("127.0.0.1:10128")).toBe(true);
    expect(hostLocal("localhost")).toBe(true);
    expect(hostLocal("crm.prueba.test")).toBe(false);
    expect(hostLocal(undefined)).toBe(false);
  });
});

// ─── La lista de números permitidos ──────────────────────────────────────────────────────────────

describe("lista de números permitidos", () => {
  it("se escribe con el formato del país del negocio, sin repetidos, al menos uno y como mucho diez", () => {
    expect(revisarPermitidos(["612 345 678", "+34 612345678", ""], "34")).toEqual({ numeros: ["34612345678"] });
    expect(revisarPermitidos(["55 1234 5678"], "52")).toEqual({ numeros: ["525512345678"] });
    expect(revisarPermitidos(["", " "], "34")).toEqual({ error: "Escribe al menos un número" });
    expect(revisarPermitidos("612345678", "34")).toEqual({ error: "Escribe al menos un número" });
    expect(revisarPermitidos(["612345678", "123"], "34")).toEqual({ error: "Revisa el número 2", indice: 1 });
    const muchos = Array.from({ length: MAXIMO_PERMITIDOS + 1 }, (_, i) => `6123456${String(i).padStart(2, "0")}`);
    expect(revisarPermitidos(muchos, "34")).toEqual({ error: `Como mucho ${MAXIMO_PERMITIDOS} números` });
  });

  it("el CRM y el puente deciden igual (también el 521 de México)", () => {
    const lista = ["34612345678", "525512345678"];
    for (const [telefono, esperado] of [
      ["34612345678", true],
      ["5215512345678", true],
      ["34699999999", false],
      ["", false],
    ] as const) {
      expect(estaPermitido(telefono, lista)).toBe(esperado);
      expect(permitidoEnElPuente(telefono, lista)).toBe(esperado);
    }
    expect(estaPermitido("34612345678", [])).toBe(false);
    expect(permitidoEnElPuente("34612345678", [])).toBe(false);
  });

  it("el móvil vinculado se enseña con la primera y la última cifra", () => {
    expect(enmascararVinculado("34612345678", "34")).toBe("+34 6•• ••• ••8");
  });
});

// ─── El interruptor y el desvío de lib/whatsapp.ts ───────────────────────────────────────────────

describe("el interruptor oficial / prueba", () => {
  it("sin elegir, oficial; elegido, prueba con un secreto propio; en modo servidor, siempre oficial", () => {
    expect(modoWhatsApp()).toBe("oficial");
    expect(destinoModoPrueba()).toBeNull();
    const c = activarModoPrueba();
    expect(c.secreto.length).toBeGreaterThanOrEqual(32);
    expect(modoWhatsApp()).toBe("prueba");
    expect(destinoModoPrueba()).toEqual({ base: `http://127.0.0.1:${puertoPuente()}/graph`, numero: "modo-prueba", token: c.secreto });
    vi.stubEnv("CRM_DOMINIO", "crm.prueba.test");
    expect(modoWhatsApp()).toBe("oficial");
    expect(destinoModoPrueba()).toBeNull();
    expect(() => activarModoPrueba()).toThrow();
  });

  it("el puerto del puente sale de PUERTO (o PUERTO_MODO_PRUEBA)", () => {
    vi.stubEnv("PUERTO", "8128");
    expect(puertoPuente()).toBe(10128);
    vi.stubEnv("PUERTO_MODO_PRUEBA", "10999");
    expect(puertoPuente()).toBe(10999);
  });

  it("la lista se guarda y se conserva al volver a elegirlo; volver a oficial lo borra todo", () => {
    const primero = activarModoPrueba();
    guardarPermitidos(["34612345678"]);
    const segundo = activarModoPrueba();
    expect(segundo.secreto).toBe(primero.secreto);
    expect(leerModoPrueba()?.permitidos).toEqual(["34612345678"]);
    mkdirSync(carpetaSesion(), { recursive: true });
    writeFileSync(path.join(carpetaSesion(), "creds.json"), "{}");
    borrarModoPrueba();
    expect(modoWhatsApp()).toBe("oficial");
    expect(existsSync(carpetaSesion())).toBe(false);
  });

  it("en modo prueba los envíos van al puente con su secreto; las plantillas no salen", async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        llamadas.push({ url, init });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.prueba.X" }] }), { status: 200 });
      }),
    );
    const { secreto } = activarModoPrueba();
    expect(await enviarTexto("34612345678", "Hola")).toBe("wamid.prueba.X");
    expect(llamadas[0].url).toBe(`http://127.0.0.1:${puertoPuente()}/graph/modo-prueba/messages`);
    expect((llamadas[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${secreto}`);
    expect(JSON.parse(String(llamadas[0].init.body))).toMatchObject({ to: "34612345678", type: "text", text: { body: "Hola" } });
    await marcarLeido("wamid.prueba.X", true);
    expect(JSON.parse(String(llamadas[1].init.body))).toMatchObject({ status: "read", message_id: "wamid.prueba.X", typing_indicator: { type: "text" } });
    await expect(enviarPlantilla("34612345678", "Laura", "Estudio")).rejects.toThrow(NO_DISPONIBLE_EN_PRUEBA);
    expect(llamadas).toHaveLength(2);
  });

  it("en la vía oficial nada cambia: GRAPH_BASE_URL, el número y el token de siempre", async () => {
    vi.stubEnv("GRAPH_BASE_URL", "http://127.0.0.1:9/graph");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123456789");
    vi.stubEnv("WHATSAPP_TOKEN", "token-de-prueba");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.meta" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await enviarTexto("34612345678", "Hola");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9/graph/123456789/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-de-prueba");
  });
});

// ─── La instalación bajo demanda (con el instalador simulado) ────────────────────────────────────

describe("instalación bajo demanda", () => {
  const instalarDeMentira = async (dir: string) => {
    for (const [nombre, version] of [
      ["baileys", VERSION_BAILEYS],
      ["libsignal", "6.0.0"],
    ]) {
      mkdirSync(path.join(dir, "node_modules", nombre), { recursive: true });
      writeFileSync(path.join(dir, "node_modules", nombre, "package.json"), JSON.stringify({ name: nombre, version }));
    }
  };

  it("instala la primera vez, en su carpeta, y luego arranca el puente", async () => {
    activarModoPrueba();
    const instalador = vi.fn(instalarDeMentira);
    const arrancar = vi.fn(async () => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(herramientaLista()).toBe(false);
    expect(estadoInstalacion().fase).toBe("sin-instalar");
    prepararModoPrueba({ instalador, arrancar });
    expect(estadoInstalacion().fase).toBe("instalando");
    prepararModoPrueba({ instalador, arrancar }); // mientras instala, no hace nada
    await esperarPreparacion();
    expect(instalador).toHaveBeenCalledTimes(1);
    expect(instalador).toHaveBeenCalledWith(path.join(carpeta, "herramienta"));
    expect(estadoInstalacion().fase).toBe("preparada");
    expect(arrancar).toHaveBeenCalledTimes(1);
    // La segunda vez ya no instala.
    prepararModoPrueba({ instalador, arrancar });
    expect(instalador).toHaveBeenCalledTimes(1);
  });

  it("si falla, lo dice en español y se puede reintentar", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    prepararModoPrueba({ instalador: async () => Promise.reject(new Error("npm ERR! code ENOTFOUND")), arrancar: async () => {} });
    await esperarPreparacion();
    expect(estadoInstalacion()).toMatchObject({ fase: "error", error: "No se ha podido preparar el modo prueba. Vuelve a intentarlo en un momento." });
    // Una instalación a medias (otra versión) no cuenta como lista.
    mkdirSync(path.join(carpeta, "herramienta", "node_modules", "baileys"), { recursive: true });
    writeFileSync(path.join(carpeta, "herramienta", "node_modules", "baileys", "package.json"), JSON.stringify({ version: "6.7.24" }));
    expect(herramientaLista()).toBe(false);
  });

  it("solo Baileys con su versión exacta y sin ejecutar scripts de instalación", () => {
    const argumentos = argumentosInstalacion();
    expect(VERSION_BAILEYS).toBe("7.0.0-rc14");
    expect(argumentos).toContain(`baileys@${VERSION_BAILEYS}`);
    for (const opcion of ["--ignore-scripts", "--save-exact", "--legacy-peer-deps", "--omit=dev"]) expect(argumentos).toContain(opcion);
    expect(argumentos.filter((a) => !a.startsWith("-"))).toEqual(["install", `baileys@${VERSION_BAILEYS}`]);
  });

  it("Baileys y libsignal nunca están en las dependencias del CRM, y su carpeta no se sube", () => {
    const paquete = readFileSync(path.join(RAIZ, "package.json"), "utf8");
    const candado = readFileSync(path.join(RAIZ, "pnpm-lock.yaml"), "utf8");
    for (const nombre of ["baileys", "libsignal", "whatsapp-rust-bridge"]) {
      expect(paquete).not.toContain(nombre);
      expect(candado).not.toContain(nombre);
    }
    expect(readFileSync(path.join(RAIZ, ".gitignore"), "utf8")).toMatch(/^\/\.herramientas\/$/m);
    expect(readFileSync(path.join(RAIZ, ".gitignore"), "utf8")).toMatch(/^\/datos\/$/m);
  });
});

// ─── El puente con el WhatsApp de mentira (sin WhatsApp de verdad) ───────────────────────────────

describe("el puente con un WhatsApp de mentira", () => {
  const SECRETO = "s".repeat(40);
  let webhook: Server;
  let recibidos: { cuerpo: string; firma: string | undefined }[];
  let permitidos: string[];
  let puente: Awaited<ReturnType<typeof arrancarNucleo>>;

  beforeEach(async () => {
    recibidos = [];
    permitidos = ["34612345678"];
    webhook = createServer((req, res) => {
      let cuerpo = "";
      req.on("data", (t) => (cuerpo += t));
      req.on("end", () => {
        recibidos.push({ cuerpo, firma: req.headers["x-hub-signature-256"] as string | undefined });
        res.end("OK");
      });
    });
    await new Promise<void>((r) => webhook.listen(0, "127.0.0.1", () => r()));
    const puertoWebhook = (webhook.address() as { port: number }).port;
    puente = await arrancarNucleo({
      puerto: 0,
      urlWebhook: `http://127.0.0.1:${puertoWebhook}/webhook`,
      leerConfig: () => ({ secreto: SECRETO, permitidos }),
      crearConexion: crearConexionFalsa,
      log: () => {},
    });
  });

  afterEach(async () => {
    await puente.cerrar();
    await new Promise((r) => webhook.close(r));
  });

  const pedir = (ruta: string, o: { metodo?: string; cuerpo?: unknown; secreto?: string; host?: string } = {}) =>
    fetch(`http://127.0.0.1:${puente.puerto}${ruta}`, {
      method: o.metodo ?? (o.cuerpo === undefined ? "GET" : "POST"),
      headers: { Authorization: `Bearer ${o.secreto ?? SECRETO}`, ...(o.host ? { Host: o.host } : {}) },
      ...(o.cuerpo === undefined ? {} : { body: JSON.stringify(o.cuerpo) }),
    });

  it("sin el secreto, nada; el QR cambia y luego «se vincula»", async () => {
    expect((await pedir("/estado", { secreto: "otro" })).status).toBe(401);
    const antes = await (await pedir("/estado")).json();
    expect(antes).toMatchObject({ fase: "qr" });
    expect(antes.qr).toMatch(/^modo-prueba-falso,/);
    await pedir("/falso/vincular", { cuerpo: { numero: "34600000001" } });
    expect(await (await pedir("/estado")).json()).toEqual({ fase: "conectado", qr: null, numero: "34600000001", error: null });
  });

  it("entrante de un número permitido → al webhook firmado; de uno que no está → nada", async () => {
    await pedir("/falso/vincular", { cuerpo: { numero: "34600000001" } });
    await pedir("/falso/entrante", { cuerpo: { de: "34699999999", texto: "Soy otro chat del móvil" } });
    expect(recibidos).toHaveLength(0);
    await pedir("/falso/entrante", { cuerpo: { de: "34612345678", texto: "Hola", nombre: "Laura" } });
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0].firma).toBe(firma(recibidos[0].cuerpo, SECRETO));
    const valor = JSON.parse(recibidos[0].cuerpo).entry[0].changes[0].value;
    expect(valor.messages[0]).toMatchObject({ from: "34612345678", type: "text", text: { body: "Hola" } });
    expect(valor.contacts[0].profile.name).toBe("Laura");
    // La lista se lee cada vez: quitarlo de la lista lo deja fuera al momento.
    permitidos = [];
    await pedir("/falso/entrante", { cuerpo: { de: "34612345678", texto: "Hola otra vez" } });
    expect(recibidos).toHaveLength(1);
  });

  it("salida: texto a un permitido sale; a otro, 403; una plantilla, «No disponible en modo prueba»", async () => {
    const sinVincular = await pedir("/graph/modo-prueba/messages", { cuerpo: { type: "text", to: "34612345678", text: { body: "Hola" } } });
    expect(sinVincular.status).toBe(503);
    await pedir("/falso/vincular", { cuerpo: { numero: "34600000001" } });
    const bien = await pedir("/graph/modo-prueba/messages", { cuerpo: { messaging_product: "whatsapp", type: "text", to: "34612345678", text: { body: "Hola, soy el asistente" } } });
    expect(bien.status).toBe(200);
    expect((await bien.json()).messages[0].id).toMatch(/^wamid\.prueba\.FALSO\d+$/);
    const fuera = await pedir("/graph/modo-prueba/messages", { cuerpo: { type: "text", to: "34699999999", text: { body: "Hola" } } });
    expect(fuera.status).toBe(403);
    expect((await fuera.json()).error.message).toBe(NO_PERMITIDO);
    const plantilla = await pedir("/graph/modo-prueba/messages", { cuerpo: { type: "template", to: "34612345678", template: { name: "x" } } });
    expect(plantilla.status).toBe(400);
    expect((await plantilla.json()).error.message).toBe(NO_DISPONIBLE);
    const enviados = (await (await pedir("/falso/enviados")).json()).enviados.filter((e: { tipo: string }) => e.tipo === "texto");
    expect(enviados).toEqual([expect.objectContaining({ a: "34612345678", texto: "Hola, soy el asistente" })]);
  });

  it("solo contesta a 127.0.0.1 o localhost", async () => {
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolver, rechazar) => {
      const r = request({ host: "127.0.0.1", port: puente.puerto, path: "/estado", headers: { Host: "evil.example", Authorization: `Bearer ${SECRETO}` } }, (res) => {
        res.resume();
        resolver(res.statusCode ?? 0);
      });
      r.on("error", rechazar);
      r.end();
    });
    expect(status).toBe(404);
  });

  it("desvincular deja el puente sin móvil", async () => {
    await pedir("/falso/vincular", { cuerpo: { numero: "34600000001" } });
    expect((await pedir("/desvincular", { cuerpo: {} })).status).toBe(200);
    expect(await (await pedir("/estado")).json()).toMatchObject({ fase: "parado", numero: null });
  });
});
