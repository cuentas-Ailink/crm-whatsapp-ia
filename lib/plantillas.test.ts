import { describe, expect, it } from "vitest";
import { PLANTILLA_GENERAL } from "./configuracion";
import { componentesParaMeta, PLANTILLA_AVISO, PLANTILLA_RETOMAR, plantillaDeBienvenida, plantillasDeLaApp, rellenar, variablesDe, type PlantillaApp } from "./plantillas";

describe("plantillas de la app", () => {
  it("el aviso al comercial, palabra por palabra", () => {
    expect(PLANTILLA_AVISO).toEqual({
      id: "aviso",
      nombre: "aviso_comercial",
      idioma: "es_ES",
      categoria: "UTILITY",
      texto: "Aviso del CRM: {{1}} necesita hablar contigo ({{2}}). Su teléfono es {{3}}. Tienes la conversación en el panel.",
      ejemplos: ["Laura", "Pide hablar con una persona", "+34 612 345 678"],
    });
  });

  it("retomar la conversación, palabra por palabra", () => {
    expect(PLANTILLA_RETOMAR).toEqual({
      id: "retomar",
      nombre: "retomar_conversacion",
      idioma: "es_ES",
      categoria: "UTILITY",
      texto: "Hola {{1}}, te escribimos de {{2}} sobre tu solicitud. ¿Seguimos por aquí? Responde a este mensaje y te atendemos.",
      ejemplos: ["Laura", "Estudio de reformas"],
    });
  });

  it("la bienvenida sale de la plantilla del negocio, siempre en es_ES", () => {
    expect(plantillaDeBienvenida({ ...PLANTILLA_GENERAL, idioma: "es_MX" }, "Clínica dental")).toEqual({
      id: "bienvenida",
      nombre: "solicitud_general",
      idioma: "es_ES",
      categoria: "UTILITY",
      texto: PLANTILLA_GENERAL.texto,
      ejemplos: ["Laura", "Clínica dental"],
    });
  });

  it("las plantillas de la app son la bienvenida, el aviso y la de retomar", () => {
    const app = plantillasDeLaApp(PLANTILLA_GENERAL, "Clínica dental");
    expect(app.map((p) => p.id)).toEqual(["bienvenida", "aviso", "retomar"]);
    expect(app[1]).toEqual(PLANTILLA_AVISO);
    const { ejemplos, ...resto } = app[2];
    const { ejemplos: _fijos, ...constante } = PLANTILLA_RETOMAR;
    expect(resto).toEqual(constante);
    expect(ejemplos).toEqual(["Laura", "Clínica dental"]);
    // La constante congelada no cambia.
    expect(PLANTILLA_RETOMAR.ejemplos).toEqual(["Laura", "Estudio de reformas"]);
  });
});

describe("variables", () => {
  it("variablesDe devuelve los números distintos, en orden", () => {
    expect(variablesDe(PLANTILLA_AVISO.texto)).toEqual([1, 2, 3]);
    expect(variablesDe("{{3}} y {{1}}, otra vez {{3}} y {{2}}")).toEqual([1, 2, 3]);
    expect(variablesDe("Sin variables")).toEqual([]);
  });

  it("rellenar sustituye cada {{n}} y deja las que no tienen valor", () => {
    expect(rellenar("Hola {{1}}, soy de {{2}}", ["Laura", "Estudio de reformas"])).toBe("Hola Laura, soy de Estudio de reformas");
    expect(rellenar("{{1}} {{3}}", ["Laura"])).toBe("Laura {{3}}");
    expect(rellenar("{{1}}", ["$& y $1"])).toBe("$& y $1");
  });
});

describe("componentesParaMeta", () => {
  it("con ejemplos", () => {
    expect(componentesParaMeta(PLANTILLA_AVISO)).toEqual([
      { type: "BODY", text: PLANTILLA_AVISO.texto, example: { body_text: [["Laura", "Pide hablar con una persona", "+34 612 345 678"]] } },
    ]);
  });

  it("retomar la conversación, con el negocio como ejemplo de {{2}}", () => {
    const retomar = plantillasDeLaApp(PLANTILLA_GENERAL, "Clínica dental")[2];
    expect(componentesParaMeta(retomar)).toEqual([{ type: "BODY", text: PLANTILLA_RETOMAR.texto, example: { body_text: [["Laura", "Clínica dental"]] } }]);
  });

  it("sin ejemplos no lleva example", () => {
    const sin: PlantillaApp = { ...PLANTILLA_AVISO, ejemplos: [] };
    expect(componentesParaMeta(sin)).toEqual([{ type: "BODY", text: PLANTILLA_AVISO.texto }]);
  });
});
