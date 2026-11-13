import { describe, expect, it } from "vitest";
import type { PlantillaAprobada } from "./api-tipos";
import { crearLead } from "./negocio";
import { PLANTILLA_RETOMAR, variablesDe } from "./plantillas";
import { etiquetaVariable, nombreCategoria, revisarVariables, sePuedeRetomar, textoRenderizado, variablesDePlantilla } from "./retomar";

const aprobada = (nombre: string, texto: string, categoria = "UTILITY"): PlantillaAprobada => ({ nombre, idioma: "es_ES", categoria, texto, variables: variablesDe(texto) });
const RETOMAR = aprobada(PLANTILLA_RETOMAR.nombre, PLANTILLA_RETOMAR.texto);
const SEGUIMIENTO = aprobada("seguimiento_presupuesto", "Hola {{1}}, soy de {{2}}. Te escribo por {{3}}. ¿Te viene bien que lo hablemos?", "MARKETING");
const HOLA = aprobada("hello_world", "Hello World");

const lead = (nombre: string) => crearLead({ telefono: "34612345678", perfilId: "p", perfilNombre: "P", nombre, origen: "whatsapp" });

describe("variablesDePlantilla", () => {
  it("{{1}} el nombre de pila y {{2}} el negocio", () => {
    expect(variablesDePlantilla(RETOMAR, lead("Laura Martínez"), "Estudio de reformas")).toEqual({ fijas: { 1: "Laura", 2: "Estudio de reformas" }, pedir: [] });
  });

  it("un nombre sin letras (el teléfono enmascarado) se pide", () => {
    expect(variablesDePlantilla(RETOMAR, lead("+34 6•• ••• •••"), "Estudio de reformas")).toEqual({ fijas: { 2: "Estudio de reformas" }, pedir: [1] });
    expect(variablesDePlantilla(RETOMAR, lead("   "), "Estudio de reformas").pedir).toEqual([1]);
  });

  it("un negocio sin nombre se pide", () => {
    expect(variablesDePlantilla(RETOMAR, lead("Laura"), "  \n ")).toEqual({ fijas: { 1: "Laura" }, pedir: [2] });
  });

  it("{{3}} y las demás se piden", () => {
    expect(variablesDePlantilla(SEGUIMIENTO, lead("Laura"), "Estudio de reformas")).toEqual({ fijas: { 1: "Laura", 2: "Estudio de reformas" }, pedir: [3] });
    expect(variablesDePlantilla(aprobada("x", "Solo {{2}} y {{5}}"), lead("Laura"), "Estudio")).toEqual({ fijas: { 2: "Estudio" }, pedir: [5] });
  });

  it("sin variables, nada", () => {
    expect(variablesDePlantilla(HOLA, lead("Laura"), "Estudio de reformas")).toEqual({ fijas: {}, pedir: [] });
  });

  it("los valores fijos también pasan por el limpiador", () => {
    const largo = "N".repeat(80);
    expect(variablesDePlantilla(RETOMAR, lead("Laura"), `Estudio\tde\n\nreformas ${largo}`).fijas[2]).toBe(`Estudio de reformas ${largo}`.slice(0, 60).trim());
  });
});

describe("revisarVariables", () => {
  it("vacío o solo espacios → «Rellena …» con su número", () => {
    expect(revisarVariables(SEGUIMIENTO, ["Laura", "Estudio de reformas"])).toEqual({ error: "Rellena el dato 3", variable: 3 });
    expect(revisarVariables(SEGUIMIENTO, ["Laura", "Estudio de reformas", "   \t\n "])).toEqual({ error: "Rellena el dato 3", variable: 3 });
  });

  it("las tres etiquetas", () => {
    expect(revisarVariables(SEGUIMIENTO, ["", "b", "c"])).toEqual({ error: "Rellena el nombre del cliente", variable: 1 });
    expect(revisarVariables(SEGUIMIENTO, ["a", "", "c"])).toEqual({ error: "Rellena el nombre del negocio", variable: 2 });
    expect(revisarVariables(SEGUIMIENTO, ["a", "b", ""])).toEqual({ error: "Rellena el dato 3", variable: 3 });
  });

  it("tabuladores y saltos de línea fuera, cortado a 60", () => {
    const r = revisarVariables(SEGUIMIENTO, ["  Laura\n", "Estudio\tde   reformas", `la reforma\n\ndel baño ${"x".repeat(80)}`]);
    expect(r).toEqual({ valores: ["Laura", "Estudio de reformas", `la reforma del baño ${"x".repeat(80)}`.slice(0, 60)] });
  });

  it("por posición y sin huecos: una variable que la plantilla salta también se pide", () => {
    const salta = aprobada("x", "Hola {{1}}, {{3}}");
    expect(revisarVariables(salta, ["Laura", undefined as unknown as string, "algo"])).toEqual({ error: "Rellena el nombre del negocio", variable: 2 });
    expect(revisarVariables(salta, ["Laura", "Estudio", "algo", "sobra"])).toEqual({ valores: ["Laura", "Estudio", "algo"] });
  });

  it("sin variables, lista vacía", () => {
    expect(revisarVariables(HOLA, ["sobra"])).toEqual({ valores: [] });
  });
});

describe("textoRenderizado", () => {
  it("rellena cada {{n}}", () => {
    expect(textoRenderizado(RETOMAR, ["Laura", "Estudio de reformas"])).toBe(
      "Hola Laura, te escribimos de Estudio de reformas sobre tu solicitud. ¿Seguimos por aquí? Responde a este mensaje y te atendemos.",
    );
    expect(textoRenderizado(SEGUIMIENTO, ["Laura", "Estudio de reformas", "la reforma del baño"])).toBe(
      "Hola Laura, soy de Estudio de reformas. Te escribo por la reforma del baño. ¿Te viene bien que lo hablemos?",
    );
    expect(textoRenderizado(HOLA, [])).toBe("Hello World");
  });
});

describe("etiquetas y categorías", () => {
  it("etiquetaVariable", () => {
    expect([1, 2, 3, 7].map(etiquetaVariable)).toEqual(["Nombre del cliente", "Nombre del negocio", "Dato 3", "Dato 7"]);
  });

  it("nombreCategoria", () => {
    expect(nombreCategoria("UTILITY")).toBe("Utilidad");
    expect(nombreCategoria("MARKETING")).toBe("Marketing");
    expect(nombreCategoria("AUTHENTICATION")).toBe("Autenticación");
    expect(nombreCategoria("OTRA_COSA")).toBe("OTRA_COSA");
  });
});

describe("sePuedeRetomar", () => {
  const EXCLUIDAS = ["solicitud_general", "solicitud_recibida", "aviso_comercial", "hello_world"];

  it("las de la app y la de prueba de Meta no", () => {
    expect(sePuedeRetomar(HOLA, EXCLUIDAS)).toBe(false);
    expect(sePuedeRetomar(aprobada("aviso_comercial", "Aviso del CRM: {{1}}"), EXCLUIDAS)).toBe(false);
    expect(sePuedeRetomar(RETOMAR, EXCLUIDAS)).toBe(true);
    expect(sePuedeRetomar(SEGUIMIENTO, EXCLUIDAS)).toBe(true);
  });

  it("una variable con nombre no se puede rellenar", () => {
    expect(sePuedeRetomar(aprobada("oferta_nombrada", "Hola {{nombre}}, tenemos una oferta para ti."), EXCLUIDAS)).toBe(false);
    expect(sePuedeRetomar(aprobada("mezcla", "Hola {{1}}, {{ciudad}}"), EXCLUIDAS)).toBe(false);
    expect(sePuedeRetomar(aprobada("sin", "Hola, ¿seguimos?"), EXCLUIDAS)).toBe(true);
  });
});
