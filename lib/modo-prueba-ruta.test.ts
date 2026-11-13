import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/modo-prueba/route";
import { POST as postWebhook } from "@/app/webhook/route";
import { buzon } from "./buzon";
import { configuracionParaPintar } from "./configuracion-servidor";
import { activarModoPrueba, archivoModoPrueba, guardarPermitidos, leerModoPrueba, modoWhatsApp } from "./modo-prueba";
import { desvincularPuente, prepararModoPrueba } from "./modo-prueba-puente";

// Las rutas del modo prueba (solo en local, nunca en modo servidor, nunca sin la casilla) y el
// webhook en modo prueba: solo firma el puente y quien no está en la lista no existe.

vi.mock("./modo-prueba-puente", () => ({
  consultarPuente: vi.fn(async () => ({ fase: "conectado", qr: null, numero: "34600000001", error: null })),
  desvincularPuente: vi.fn(async () => {}),
  estadoInstalacion: vi.fn(() => ({ fase: "preparada", segundos: null, error: null })),
  prepararModoPrueba: vi.fn(),
}));
vi.mock("./buzon", () => ({ buzon: { recibir: vi.fn(async () => true) } }));

let carpeta: string;

// La base de datos en memoria se abre una vez aquí, con tiempo: con el ordenador cargado, abrirla
// dentro del primer test podía pasar de los 5 s.
beforeAll(async () => {
  await configuracionParaPintar();
}, 60_000);

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), "crm-modo-prueba-ruta-"));
  vi.stubEnv("DIR_MODO_PRUEBA", carpeta);
  vi.stubEnv("CRM_DOMINIO", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  delete (globalThis as unknown as { __modoPrueba?: unknown }).__modoPrueba;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(carpeta, { recursive: true, force: true });
});

const peticion = (cuerpo?: unknown, host = "localhost:8128") =>
  new Request(`http://${host}/api/modo-prueba`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: { host, "Content-Type": "application/json" },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });

describe("/api/modo-prueba", () => {
  it("sin la casilla «Entiendo que es solo para probar» no se activa nada", async () => {
    for (const cuerpo of [{ accion: "activar" }, { accion: "activar", acepto: "true" }, { accion: "activar", acepto: false }]) {
      const r = await POST(peticion(cuerpo));
      expect(r.status).toBe(400);
      expect((await r.json()).campo).toBe("acepto");
    }
    expect(existsSync(archivoModoPrueba())).toBe(false);
    expect(modoWhatsApp()).toBe("oficial");
  });

  it("con la casilla se activa, y el estado nunca lleva el secreto ni el móvil entero", async () => {
    const r = await POST(peticion({ accion: "activar", acepto: true }));
    expect(r.status).toBe(200);
    const texto = await r.text();
    const datos = JSON.parse(texto);
    expect(datos).toMatchObject({ ok: true, activo: true, puente: { fase: "conectado", numero: "+34 6•• ••• ••1" }, permitidos: [] });
    expect(modoWhatsApp()).toBe("prueba");
    expect(texto).not.toContain(leerModoPrueba()!.secreto);
    expect(texto).not.toContain("34600000001");
  });

  it("las demás acciones piden antes elegir el modo prueba", async () => {
    for (const accion of ["preparar", "permitidos", "desvincular", "oficial"]) {
      expect((await POST(peticion({ accion, numeros: ["612345678"] }))).status).toBe(409);
    }
    expect(prepararModoPrueba).not.toHaveBeenCalled();
    expect(desvincularPuente).not.toHaveBeenCalled();
  });

  it("la lista: al menos un número y con el formato del país", async () => {
    activarModoPrueba();
    const vacia = await POST(peticion({ accion: "permitidos", numeros: [""] }));
    expect(vacia.status).toBe(400);
    const mala = await POST(peticion({ accion: "permitidos", numeros: ["612345678", "12"] }));
    expect(await mala.json()).toMatchObject({ ok: false, error: "Revisa el número 2", campo: "numeros.1" });
    const buena = await POST(peticion({ accion: "permitidos", numeros: ["612 345 678"] }));
    expect(await buena.json()).toMatchObject({ ok: true, permitidos: ["34612345678"] });
  });

  it("preparar instala y arranca; pasar a oficial desvincula y borra el interruptor", async () => {
    activarModoPrueba();
    expect((await POST(peticion({ accion: "preparar" }))).status).toBe(200);
    expect(prepararModoPrueba).toHaveBeenCalledTimes(1);
    const oficial = await POST(peticion({ accion: "oficial" }));
    expect(await oficial.json()).toMatchObject({ ok: true, activo: false });
    expect(desvincularPuente).toHaveBeenCalled();
    expect(modoWhatsApp()).toBe("oficial");
  });

  it("solo en local: en modo servidor (CRM_DOMINIO) y desde otro nombre, 404 y no se toca nada", async () => {
    vi.stubEnv("CRM_DOMINIO", "crm.prueba.test");
    for (const r of [await GET(peticion()), await POST(peticion({ accion: "activar", acepto: true })), await POST(peticion({ accion: "activar", acepto: true }, "crm.prueba.test"))]) {
      expect(r.status).toBe(404);
    }
    expect(existsSync(archivoModoPrueba())).toBe(false);
    vi.stubEnv("CRM_DOMINIO", "");
    expect((await POST(peticion({ accion: "activar", acepto: true }, "abc.ngrok-free.app"))).status).toBe(404);
    const reenviado = new Request("http://localhost:8128/api/modo-prueba", {
      method: "POST",
      headers: { host: "localhost:8128", "x-forwarded-host": "abc.ngrok-free.app", "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "activar", acepto: true }),
    });
    expect((await POST(reenviado)).status).toBe(404);
    expect(existsSync(archivoModoPrueba())).toBe(false);
  });
});

describe("el webhook en modo prueba", () => {
  const aviso = (de: string, texto: string) =>
    JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: de, profile: { name: "Laura" } }], messages: [{ from: de, id: `wamid.prueba.${de}`, timestamp: "1800000000", type: "text", text: { body: texto } }] } }] }] });
  const firmado = (cuerpo: string, secreto: string) =>
    new Request("http://127.0.0.1:8128/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}` },
      body: cuerpo,
    });

  it("de un número de la lista pasa al buzón; de uno que no está, ni se guarda ni se contesta", async () => {
    const { secreto } = activarModoPrueba();
    guardarPermitidos(["34612345678"]);
    expect((await postWebhook(firmado(aviso("34699999999", "Soy otro chat"), secreto))).status).toBe(200);
    expect(buzon.recibir).not.toHaveBeenCalled();
    expect((await postWebhook(firmado(aviso("34612345678", "Hola"), secreto))).status).toBe(200);
    expect(buzon.recibir).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buzon.recibir).mock.calls[0][0]).toMatchObject({ telefono: "34612345678", texto: "Hola" });
  });

  it("en modo prueba solo vale la firma del puente; en la vía oficial, solo la de Meta", async () => {
    vi.stubEnv("META_APP_SECRET", "secreto-de-meta-de-prueba");
    const { secreto } = activarModoPrueba();
    guardarPermitidos(["34612345678"]);
    expect((await postWebhook(firmado(aviso("34612345678", "Hola"), "secreto-de-meta-de-prueba"))).status).toBe(401);
    rmSync(carpeta, { recursive: true, force: true });
    delete (globalThis as unknown as { __modoPrueba?: unknown }).__modoPrueba;
    expect(modoWhatsApp()).toBe("oficial");
    expect((await postWebhook(firmado(aviso("34612345678", "Hola"), secreto))).status).toBe(401);
    // En la vía oficial no hay lista: Meta ya decide quién escribe.
    expect((await postWebhook(firmado(aviso("34699999999", "Hola"), "secreto-de-meta-de-prueba"))).status).toBe(200);
    expect(buzon.recibir).toHaveBeenCalledTimes(1);
  });
});
