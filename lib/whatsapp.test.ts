import { afterEach, describe, expect, it, vi } from "vitest";
import { enviarPlantillaConVariables, enviarTexto, ErrorWhatsApp, marcarLeido } from "./whatsapp";

function simularMeta(respuestas: { status: number; cuerpo: object }[], cuerpos: Record<string, unknown>[] = []) {
  const destinos: unknown[] = [];
  let vez = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, opciones: { body: string }) => {
      destinos.push(JSON.parse(opciones.body).to);
      cuerpos.push(JSON.parse(opciones.body));
      const { status, cuerpo } = respuestas[Math.min(vez++, respuestas.length - 1)];
      return new Response(JSON.stringify(cuerpo), { status });
    }),
  );
  return destinos;
}

const ACEPTADO = { status: 200, cuerpo: { messages: [{ id: "wamid.1" }] } };
const NO_ESTA = { status: 400, cuerpo: { error: { code: 131030, message: "not in allowed list" } } };

afterEach(() => vi.unstubAllGlobals());

describe("enviarTexto", () => {
  it("envía al número tal cual si Meta lo acepta", async () => {
    const destinos = simularMeta([ACEPTADO]);
    await expect(enviarTexto("34612345678", "Hola")).resolves.toBe("wamid.1");
    expect(destinos).toEqual(["34612345678"]);
  });

  it("en México reintenta con el 1 si el móvil no está en la lista", async () => {
    const destinos = simularMeta([NO_ESTA, ACEPTADO]);
    await expect(enviarTexto("528711234567", "Hola")).resolves.toBe("wamid.1");
    expect(destinos).toEqual(["528711234567", "5218711234567"]);
  });

  it("si tampoco está con el 1, explica qué hacer", async () => {
    const destinos = simularMeta([NO_ESTA, NO_ESTA]);
    await expect(enviarTexto("528711234567", "Hola")).rejects.toThrow("lista de prueba de Meta");
    expect(destinos).toHaveLength(2);
  });

  it("fuera de México no reintenta", async () => {
    const destinos = simularMeta([NO_ESTA]);
    await expect(enviarTexto("34612345678", "Hola")).rejects.toThrow("lista de prueba de Meta");
    expect(destinos).toHaveLength(1);
  });

  it("otros errores de Meta no provocan reintento", async () => {
    const destinos = simularMeta([{ status: 401, cuerpo: { error: { code: 190, message: "token" } } }]);
    await expect(enviarTexto("528711234567", "Hola")).rejects.toThrow("token");
    expect(destinos).toHaveLength(1);
  });
});

describe("marcarLeido", () => {
  it("un fallo no rompe la conversación", async () => {
    simularMeta([NO_ESTA]);
    await expect(marcarLeido("wamid.1", true)).resolves.toBeUndefined();
  });
});

describe("plantillas y errores de Meta", () => {
  it("enviarPlantillaConVariables pasa cada variable por parametroSeguro", async () => {
    const cuerpos: Record<string, unknown>[] = [];
    simularMeta([ACEPTADO], cuerpos);
    await expect(
      enviarPlantillaConVariables("34612345678", { nombre: "solicitud_general", idioma: "es_ES", variables: ["  Laura\n\tMartínez  ", "Estudio     de reformas"] }),
    ).resolves.toBe("wamid.1");
    const plantilla = cuerpos[0].template as { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] };
    expect(plantilla.name).toBe("solicitud_general");
    expect(plantilla.language.code).toBe("es_ES");
    const textos = plantilla.components[0].parameters.map((p) => p.text);
    for (const t of textos) {
      expect(t).not.toMatch(/[\n\t]| {4,}/);
      expect(t).toBe(t.trim());
    }
    expect(textos[0]).toContain("Laura");
  });

  it("sin variables no manda components", async () => {
    const cuerpos: Record<string, unknown>[] = [];
    simularMeta([ACEPTADO], cuerpos);
    await enviarPlantillaConVariables("34612345678", { nombre: "hello_world", idioma: "en_US", variables: [] });
    expect(cuerpos[0].template).toEqual({ name: "hello_world", language: { code: "en_US" } });
    expect(Object.hasOwn(cuerpos[0].template as object, "components")).toBe(false);
  });

  it("ErrorWhatsApp trae el código y la explicación en español", async () => {
    simularMeta([{ status: 400, cuerpo: { error: { code: 132001, message: "Template name does not exist in the translation" } } }]);
    const error = await enviarTexto("34612345678", "Hola").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorWhatsApp);
    const e = error as ErrorWhatsApp;
    expect(e.codigo).toBe(132001);
    expect(e.explicado.codigo).toBe("meta.bienvenida");
    expect(e.explicado.titulo).toBe("Meta aún no ha aprobado tu mensaje de bienvenida");
    expect(e.message).toContain("Meta aún no ha aprobado tu mensaje de bienvenida");

    simularMeta([{ status: 400, cuerpo: { error: { code: 999, message: "Algo raro de Meta" } } }]);
    const otro = (await enviarTexto("34612345678", "Hola").catch((x: unknown) => x)) as ErrorWhatsApp;
    expect(otro.explicado.codigo).toBe("meta.otro");
    expect(otro.explicado.solucion).toBe("Algo raro de Meta");
    expect(otro.message).not.toMatch(/\.env|WHATSAPP_TOKEN/);
  });
});
