import { readFileSync } from "node:fs";
import path from "node:path";
import { MockLanguageModelV4, mockValues } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeticionPrueba } from "./api-tipos";
import * as aviso from "./aviso";
import * as bd from "./bd";
import type { ConfiguracionResuelta } from "./configuracion";
import { configuracionParaProbar } from "./configuracion-servidor";
import type { Perfil } from "./perfil";
import { configuracionPorDefecto } from "./presets";
import { POST as postProbar } from "@/app/api/asistente/probar/route";
import { ErrorPrueba, probarAsistente } from "./probar";
import * as whatsapp from "./whatsapp";

vi.mock("./whatsapp", () => ({
  enviarTexto: vi.fn(async () => "wamid"),
  enviarPlantilla: vi.fn(async () => "wamid"),
  enviarPlantillaConVariables: vi.fn(async () => "wamid"),
  marcarLeido: vi.fn(async () => undefined),
  descargarMedia: vi.fn(),
  textoPlantilla: vi.fn(() => ""),
  ErrorWhatsApp: class ErrorWhatsApp extends Error {},
}));
vi.mock("./aviso", () => ({
  textoAviso: vi.fn(() => ""),
  enviarAviso: vi.fn(async () => ({ ok: true })),
  avisarComercial: vi.fn(async () => undefined),
}));
vi.mock("./configuracion-servidor", () => ({ configuracionParaProbar: vi.fn(), configuracionActiva: vi.fn(), configuracionParaPintar: vi.fn() }));
vi.mock("./bd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bd")>()),
  leerReservas: vi.fn(async () => []),
  guardarMutaciones: vi.fn(async () => undefined),
  actualizarEntregas: vi.fn(async () => 0),
  registrarMensaje: vi.fn(async () => true),
}));

// Lunes 2 nov 2026, 10:00 en Madrid.
const AHORA = new Date("2026-11-02T09:00:00Z");
const NEGOCIO = "Estudio de reformas";
const PERFIL: Perfil = {
  id: "estudio-de-reformas",
  nombre: NEGOCIO,
  // agente.md es de cada instalación y no está en el repositorio: se parte de las instrucciones de reformas.
  instrucciones: readFileSync(path.join(__dirname, "..", "perfiles", "reformas.md"), "utf8"),
  hash: "prueba",
};

const USO = {
  inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

const texto = (t: string) => ({ content: [{ type: "text" as const, text: t }], finishReason: { unified: "stop" as const, raw: undefined }, usage: USO, warnings: [] });
const herramienta = (toolName: string, input: object) => ({
  content: [{ type: "tool-call" as const, toolCallId: `llamada-${toolName}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage: USO,
  warnings: [],
});

function modelo(...respuestas: object[]) {
  const siguiente = mockValues(...respuestas) as () => never;
  return new MockLanguageModelV4({ doGenerate: vi.fn(async () => siguiente()) });
}

/** Un modelo que no se puede llamar: las puertas deciden sin él. */
function sinModelo() {
  return new MockLanguageModelV4({
    doGenerate: vi.fn(async () => {
      throw new Error("no se debía llamar al modelo");
    }),
  });
}

function config(cambios: (c: ConfiguracionResuelta) => void = () => {}): ConfiguracionResuelta {
  const c = configuracionPorDefecto();
  c.negocio.nombre = NEGOCIO;
  cambios(c);
  return c;
}

function usar(c: ConfiguracionResuelta = config()): void {
  vi.mocked(configuracionParaProbar).mockResolvedValue({ perfil: PERFIL, config: c });
}

type Prueba = PeticionPrueba["prueba"];
function peticion(campos: Partial<Prueba> = {}, ...textos: string[]): PeticionPrueba {
  const mensajes = textos.length ? textos.map((t, i) => ({ de: "cliente" as const, texto: t, ts: 1_000 + i })) : [{ de: "cliente" as const, texto: "Quiero reformar un baño", ts: 1_000 }];
  return { prueba: { origen: "whatsapp", nombre: "Ana", estado: "nuevo", mensajes, datos: {}, huecosOfrecidos: [], ...campos } };
}

beforeEach(() => {
  delete (globalThis as { __probarAsistente?: unknown }).__probarAsistente;
  vi.clearAllMocks();
  usar();
  process.env.MODELO = "claude-haiku-5-5";
  process.env.TELEFONO_COMERCIAL = "34600999999";
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.TELEFONO_COMERCIAL;
  delete process.env.MODELO;
  vi.restoreAllMocks();
});

describe("probarAsistente", () => {
  it("suma el uso de un intento descartado y uno bueno", async () => {
    const m = modelo(texto("Perfecto, te espero el martes a las 11:15."), texto("¿Qué te gustaría reformar exactamente?"));
    const r = await probarAsistente(peticion(), { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("contesta");
    expect(r.texto).toContain("¿Qué te gustaría reformar exactamente?");
    expect(r.descartes).toHaveLength(1);
    expect(r.descartes[0]).toContain("11:15");
    expect(r.uso).toEqual({ entrada: 160, cacheLeida: 40, salida: 20 });
    expect(r.costeUsd).toBeCloseTo((160 * 0.1 + 40 * 0.01 + 20 * 0.5) / 1_000_000, 12);
    expect(r.modelo).toBe("claude-haiku-5-5");
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.fallo).toBeUndefined();
  });

  it("publicidad y Te toca contestan sin llamar al modelo", async () => {
    const m = sinModelo();
    const spam = await probarAsistente(peticion({ estado: "spam" }), { modelo: m, ahora: AHORA });
    expect(spam).toMatchObject({ decision: "silencio", texto: null, eventos: ["es publicidad"], costeUsd: 0, uso: { entrada: 0, cacheLeida: 0, salida: 0 } });
    const persona = await probarAsistente(peticion({ estado: "persona" }), { modelo: m, ahora: AHORA });
    expect(persona).toMatchObject({ decision: "silencio", texto: null, eventos: ["lo llevas tú"], modelo: "claude-haiku-5-5" });
    expect(m.doGenerateCalls).toHaveLength(0);
  });

  it("la baja: baja sin llamar al modelo", async () => {
    const m = sinModelo();
    const r = await probarAsistente(peticion({}, "Por favor, no me escribáis más"), { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("baja");
    expect(r.texto).toContain("no te escribiremos más por aquí");
    expect(r.texto).toContain(`asistente virtual de ${NEGOCIO}`);
    expect(r.mutaciones).toEqual([{ t: "silencio", leadId: `34000000000:${PERFIL.id}`, ts: AHORA.getTime() }]);
    expect(r.notas).toContain("En la prueba no se guarda: a un cliente real ya no le escribiría nadie hasta que vuelva a escribir");
    expect(m.doGenerateCalls).toHaveLength(0);
  });

  it("silenciado y «gracias»: silencio", async () => {
    const m = sinModelo();
    const p = peticion({ silenciadoEn: 2_000 });
    p.prueba.mensajes = [
      { de: "cliente", texto: "No me escribáis más", ts: 1_000 },
      { de: "agente", texto: "Entendido: no te escribiremos más por aquí.", ts: 1_500 },
      { de: "cliente", texto: "gracias", ts: 3_000 },
    ];
    const r = await probarAsistente(p, { modelo: m, ahora: AHORA });
    expect(r).toMatchObject({ decision: "silencio", texto: null, eventos: ["pidió que no le escribamos"], mutaciones: [] });
    expect(m.doGenerateCalls).toHaveLength(0);
  });

  it("silenciado y una pregunta de verdad: permitir y contesta", async () => {
    const m = modelo(texto("Claro, ¿qué te gustaría reformar?"));
    const p = peticion({ silenciadoEn: 2_000 });
    p.prueba.mensajes = [
      { de: "cliente", texto: "No me escribáis más", ts: 1_000 },
      { de: "agente", texto: "Entendido: no te escribiremos más por aquí. Soy el asistente virtual del estudio.", ts: 1_500 },
      { de: "cliente", texto: "¿Al final cuándo podéis venir?", ts: 3_000 },
    ];
    const r = await probarAsistente(p, { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("contesta");
    expect(r.mutaciones[0]).toEqual({ t: "permitir", leadId: `34000000000:${PERFIL.id}`, ts: AHORA.getTime(), por: "cliente" });
    expect(r.notas).toContain("Ha vuelto a escribir: a un cliente real se le volvería a contestar");
    expect(r.texto).toBe("Claro, ¿qué te gustaría reformar?");
    expect(m.doGenerateCalls).toHaveLength(1);
  });

  it("borrad mis datos: persona con la frase fija y la nota, sin llamar al modelo", async () => {
    const m = sinModelo();
    const r = await probarAsistente(peticion({}, "Borrad mis datos, por favor"), { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("persona");
    expect(r.persona).toBe("Pide que borres sus datos");
    expect(r.texto).toContain(`Se lo paso a ${NEGOCIO} para que borre tus datos.`);
    expect(r.texto).toContain(`asistente virtual de ${NEGOCIO}`);
    expect(r.mutaciones).toEqual([{ t: "estado", leadId: `34000000000:${PERFIL.id}`, estado: "persona", ts: AHORA.getTime(), motivo: "Pide que borres sus datos" }]);
    expect(r.notas).toContain("A un cliente real te lo pasaría para que borres sus datos");
    expect(r.costeUsd).toBe(0);
    expect(m.doGenerateCalls).toHaveLength(0);

    // Silenciado: se pasa igual, pero no se le escribe.
    const p = peticion({ silenciadoEn: 2_000 });
    p.prueba.mensajes = [{ de: "cliente", texto: "Borrad mis datos", ts: 3_000 }];
    const callado = await probarAsistente(p, { modelo: m, ahora: AHORA });
    expect(callado).toMatchObject({ decision: "persona", texto: null, persona: "Pide que borres sus datos" });
  });

  it("borrar datos y baja: una sola respuesta y silencio", async () => {
    const m = sinModelo();
    const r = await probarAsistente(peticion({}, "No me escribáis más. Y borrad mis datos."), { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("persona");
    expect(r.mutaciones.map((x) => x.t)).toEqual(["estado", "silencio"]);
    expect(r.texto).toContain("para que borre tus datos");
    expect(r.texto).not.toContain("no te escribiremos más");
    expect(m.doGenerateCalls).toHaveLength(0);
  });

  it("en pausa contesta igual y lo dice en una nota", async () => {
    usar(
      config((c) => {
        c.sistema.asistente.activo = false;
        c.sistema.asistente.pausadoEn = 1;
      }),
    );
    const m = modelo(texto("¿Cuántos metros tiene el baño?"));
    const r = await probarAsistente(peticion(), { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("contesta");
    expect(r.notas).toContain("En pausa: a un cliente real no le contestaría");
    expect(m.doGenerateCalls).toHaveLength(1);
  });

  it("se presenta en la primera respuesta como en producción", async () => {
    const primera = await probarAsistente(peticion(), { modelo: modelo(texto("¡Hola! ¿Cuántos metros tiene el baño?")), ahora: AHORA });
    expect(primera.texto).toBe(`¡Hola! Soy el asistente virtual de ${NEGOCIO}. ¿Cuántos metros tiene el baño?`);

    const p = peticion();
    p.prueba.mensajes = [
      { de: "cliente", texto: "Quiero reformar un baño", ts: 1_000 },
      { de: "agente", texto: `Hola, soy el asistente virtual de ${NEGOCIO}. ¿Cuántos metros tiene?`, ts: 1_100 },
      { de: "cliente", texto: "Unos 6", ts: 1_200 },
    ];
    const segunda = await probarAsistente(p, { modelo: modelo(texto("¿Para cuándo te gustaría empezar?")), ahora: AHORA });
    expect(segunda.texto).toBe("¿Para cuándo te gustaría empezar?");
  });

  it("avisaría al móvil del dueño con el número entero", async () => {
    const m = modelo(
      herramienta("pasar_a_persona", { motivo: "Quiere hablar con una persona" }),
      texto("Entendido, te paso con un compañero del equipo, que te escribe en cuanto pueda."),
    );
    const r = await probarAsistente(peticion({}, "Quiero hablar con una persona"), { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("persona");
    expect(r.persona).toBe("Quiere hablar con una persona");
    expect(r.notas).toContain("Te avisaría por WhatsApp al +34 600 999 999");
    expect(r.mutaciones).toContainEqual(expect.objectContaining({ t: "estado", estado: "persona" }));

    // Sin móvil para avisar, no hay nota.
    usar(config((c) => (c.sistema.avisos.comercial.telefono = "")));
    const sin = await probarAsistente(peticion({}, "Quiero hablar con una persona"), {
      modelo: modelo(herramienta("pasar_a_persona", { motivo: "Quiere hablar con una persona" }), texto("Te paso con un compañero del equipo.")),
      ahora: AHORA,
    });
    expect(sin.notas.some((n) => n.startsWith("Te avisaría"))).toBe(false);
  });

  it("nunca llama a enviarTexto ni a guardarMutaciones", async () => {
    await probarAsistente(peticion(), { modelo: modelo(texto("¿Cuántos metros tiene el baño?")), ahora: AHORA });
    await probarAsistente(peticion({}, "Borrad mis datos"), { modelo: sinModelo(), ahora: AHORA });
    await probarAsistente(peticion({}, "No me escribáis más"), { modelo: sinModelo(), ahora: AHORA });
    await probarAsistente(peticion({}, "Quiero hablar con una persona"), {
      modelo: modelo(herramienta("pasar_a_persona", { motivo: "Lo pide" }), texto("Te paso con un compañero del equipo.")),
      ahora: AHORA,
    });
    // Un fallo del modelo: la disculpa, sin enviarla.
    const fallo = await probarAsistente(peticion(), {
      modelo: new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error("Claude no responde");
        },
      }),
      ahora: AHORA,
    });
    expect(fallo.texto).toContain("Perdona, se me ha cortado. ¿Me lo repites?");
    expect(fallo.fallo).toBe("Claude no responde");
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    expect(whatsapp.enviarPlantilla).not.toHaveBeenCalled();
    expect(whatsapp.enviarPlantillaConVariables).not.toHaveBeenCalled();
    expect(whatsapp.marcarLeido).not.toHaveBeenCalled();
    expect(aviso.avisarComercial).not.toHaveBeenCalled();
    expect(aviso.enviarAviso).not.toHaveBeenCalled();
    expect(bd.guardarMutaciones).not.toHaveBeenCalled();
  });

  it("el código de probar.ts no nombra ninguna función que envíe o guarde", () => {
    const codigo = readFileSync(path.join(__dirname, "probar.ts"), "utf8");
    for (const nombre of ["guardarMutaciones", "enviarTexto", "enviarPlantilla", "enviarPlantillaConVariables", "marcarLeido", "avisarComercial", "buzon"]) {
      expect(new RegExp(`\\b${nombre}\\b`).test(codigo), nombre).toBe(false);
    }
  });

  it("valida la prueba y limita a 20 por minuto", async () => {
    const m = sinModelo();
    const falla = async (p: unknown, mensaje: string, status = 400) => {
      const error = await probarAsistente(p as PeticionPrueba, { modelo: m, ahora: AHORA }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorPrueba);
      expect((error as ErrorPrueba).status).toBe(status);
      expect((error as ErrorPrueba).message).toBe(mensaje);
    };
    await falla({}, "No se ha entendido la petición");
    await falla(peticion({ nombre: "" }), "Revisa la prueba: el nombre, de 1 a 40 letras");
    await falla(peticion({ nombre: "x".repeat(41) }), "Revisa la prueba: el nombre, de 1 a 40 letras");
    await falla(peticion({}, ..."a".repeat(61).split("")), "Revisa la prueba: como mucho 60 mensajes de 1.000 caracteres");
    await falla(peticion({}, "x".repeat(1001)), "Revisa la prueba: como mucho 60 mensajes de 1.000 caracteres");
    const deNadie = peticion();
    (deNadie.prueba.mensajes[0] as { de: string }).de = "otro";
    await falla(deNadie, "Revisa la prueba: cada mensaje es del cliente o de tu asistente");
    await falla(peticion({ estado: "cerrado" as never }), "Revisa la prueba: el estado del cliente no es válido");
    await falla(peticion({ datos: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`d${i}`, "x"])) }), "Revisa la prueba: como mucho 20 datos");
    const hueco = { id: "2026-11-03T10:00", texto: "martes 3 nov a las 10:00" };
    await falla(peticion({ huecosOfrecidos: Array(7).fill(hueco) }), "Revisa la prueba: como mucho 6 huecos ofrecidos");
    await falla(peticion({ huecosOfrecidos: [{ id: "mañana", texto: "mañana" }] }), "Revisa la prueba: como mucho 6 huecos ofrecidos");
    await falla(peticion({ silenciadoEn: -3 }), "Revisa la prueba: la fecha del silencio no es válida");
    await falla(peticion({ silenciadoEn: 1.5 }), "Revisa la prueba: la fecha del silencio no es válida");

    // Las que no valen no cuentan; 20 buenas sí, y la 21.ª espera.
    for (let i = 0; i < 20; i++) await probarAsistente(peticion({ estado: "persona" }), { modelo: m, ahora: AHORA });
    await falla(peticion({ estado: "persona" }), "Espera un momento: has hecho muchas pruebas seguidas", 429);
  });

  it("la cita de la prueba ocupa su hueco y no se lee la de otro intento", async () => {
    const visita = { id: "2026-11-03T10:00", texto: "martes 3 nov a las 10:00" };
    vi.mocked(bd.leerReservas).mockResolvedValue([
      { huecoId: "2026-11-04T10:00", texto: "x", leadId: `34000000000:${PERFIL.id}`, nombre: "Ana", perfilNombre: NEGOCIO },
      { huecoId: "2026-11-05T10:00", texto: "y", leadId: "34611111111:otro", nombre: "Luis", perfilNombre: NEGOCIO },
    ]);
    const m = modelo(texto("Tienes la visita el martes 3 nov a las 10:00. ¿Algo más?"));
    const r = await probarAsistente(peticion({ estado: "visita", visita }, "¿Cuándo era la visita?"), { modelo: m, ahora: AHORA });
    expect(r.decision).toBe("contesta");
    expect(bd.leerReservas).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/asistente/probar", () => {
  const pedir = (cuerpo: string) => new Request("http://localhost/api/asistente/probar", { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo });

  it("devuelve el resultado tal cual, o el error en español", async () => {
    const bien = await postProbar(pedir(JSON.stringify(peticion({ estado: "persona" }))));
    expect(bien.status).toBe(200);
    expect(await bien.json()).toMatchObject({ decision: "silencio", texto: null, eventos: ["lo llevas tú"] });

    const roto = await postProbar(pedir("{no es json"));
    expect(roto.status).toBe(400);
    expect(await roto.json()).toEqual({ ok: false, error: "No se ha entendido la petición" });

    const mal = await postProbar(pedir(JSON.stringify(peticion({ nombre: "" }))));
    expect(mal.status).toBe(400);
    expect(await mal.json()).toEqual({ ok: false, error: "Revisa la prueba: el nombre, de 1 a 40 letras" });

    for (let i = 0; i < 19; i++) await postProbar(pedir(JSON.stringify(peticion({ estado: "persona" }))));
    const muchas = await postProbar(pedir(JSON.stringify(peticion({ estado: "persona" }))));
    expect(muchas.status).toBe(429);
    expect(await muchas.json()).toEqual({ ok: false, error: "Espera un momento: has hecho muchas pruebas seguidas" });
  });
});
