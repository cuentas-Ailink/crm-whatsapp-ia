import { describe, expect, it } from "vitest";
import type { PeticionPrueba, ResultadoPrueba } from "./api-tipos";
import { PRESETS } from "./presets";
import { accionesDe, aplicarPrueba } from "./prueba";
import type { Hueco, Mutacion } from "./tipos";

type Prueba = PeticionPrueba["prueba"];

const LEAD = "34000000000:reformas";
const H1: Hueco = { id: "2026-11-03T10:00", texto: "martes 3 nov a las 10:00" };
const H2: Hueco = { id: "2026-11-04T17:00", texto: "miércoles 4 nov a las 17:00" };

function prueba(campos: Partial<Prueba> = {}): Prueba {
  return { origen: "whatsapp", nombre: "Ana", estado: "conversacion", mensajes: [{ de: "cliente", texto: "Hola", ts: 1 }], datos: {}, huecosOfrecidos: [], ...campos };
}

function resultado(campos: Partial<ResultadoPrueba> = {}): ResultadoPrueba {
  return {
    decision: "contesta",
    texto: "Hola",
    mutaciones: [],
    eventos: [],
    descartes: [],
    uso: { entrada: 0, cacheLeida: 0, salida: 0 },
    costeUsd: 0,
    ms: 1,
    modelo: "claude-haiku-5-5",
    notas: [],
    ...campos,
  };
}

describe("aplicarPrueba", () => {
  it("aplicarPrueba aplica cada tipo de mutación y persona se queda", () => {
    const antes = prueba();
    const mutaciones: Mutacion[] = [
      { t: "huecos", leadId: LEAD, huecos: [H1, H2] },
      { t: "dato", leadId: LEAD, campo: "tipo", valor: "baño", ts: 2 },
      { t: "reserva", reserva: { huecoId: H1.id, texto: H1.texto, leadId: LEAD, nombre: "Ana", perfilNombre: "P" }, hueco: H1, ts: 3 },
      { t: "estado", leadId: LEAD, estado: "visita", ts: 3 },
      { t: "mensaje", leadId: LEAD, mensaje: { id: "r", de: "agente", texto: "Te espero", ts: 4 } },
      { t: "nota", leadId: LEAD, nota: { id: "n", texto: "no cuenta", ts: 4 } },
    ];
    const despues = aplicarPrueba(antes, mutaciones);
    expect(despues.huecosOfrecidos).toEqual([H1, H2]);
    expect(despues.datos).toEqual({ tipo: "baño" });
    expect(despues.visita).toEqual(H1);
    expect(despues.estado).toBe("visita");
    expect(despues.mensajes.at(-1)).toEqual({ de: "agente", texto: "Te espero", ts: 4 });
    // No toca la de entrada.
    expect(antes.datos).toEqual({});
    expect(antes.mensajes).toHaveLength(1);

    const anulada = aplicarPrueba(despues, [
      { t: "cancelar", leadId: LEAD, ts: 5 },
      { t: "estado", leadId: LEAD, estado: "conversacion", ts: 5 },
    ]);
    expect(anulada.visita).toBeUndefined();
    expect(anulada.estado).toBe("conversacion");

    const persona = aplicarPrueba(anulada, [
      { t: "estado", leadId: LEAD, estado: "persona", ts: 6, motivo: "Quiere negociar" },
      { t: "estado", leadId: LEAD, estado: "conversacion", ts: 7 },
    ]);
    expect(persona.estado).toBe("persona");
    expect(aplicarPrueba(prueba({ estado: "spam" }), [{ t: "estado", leadId: LEAD, estado: "visita", ts: 1 }]).estado).toBe("spam");
  });

  it("silencio y permitir ponen y quitan silenciadoEn", () => {
    const callada = aplicarPrueba(prueba(), [{ t: "silencio", leadId: LEAD, ts: 50 }]);
    expect(callada.silenciadoEn).toBe(50);
    expect(aplicarPrueba(callada, [{ t: "silencio", leadId: LEAD, ts: 90 }]).silenciadoEn).toBe(50);
    const otraVez = aplicarPrueba(callada, [{ t: "permitir", leadId: LEAD, ts: 60, por: "cliente" }]);
    expect(otraVez.silenciadoEn).toBeUndefined();
    expect("silenciadoEn" in otraVez).toBe(false);
  });
});

describe("accionesDe", () => {
  it("chips de reformas", () => {
    const r = resultado({
      mutaciones: [
        { t: "huecos", leadId: LEAD, huecos: [H1, H2] },
        { t: "huecos", leadId: LEAD, huecos: [H1, H2] },
        { t: "reserva", reserva: { huecoId: H1.id, texto: H1.texto, leadId: LEAD, nombre: "Ana", perfilNombre: "P" }, hueco: H1, ts: 3 },
        { t: "estado", leadId: LEAD, estado: "visita", ts: 3 },
        { t: "cancelar", leadId: LEAD, ts: 4 },
        { t: "dato", leadId: LEAD, campo: "metros", valor: "8", ts: 5 },
        { t: "estado", leadId: LEAD, estado: "spam", ts: 6, motivo: "Ofrece seguidores" },
        { t: "silencio", leadId: LEAD, ts: 7 },
        { t: "permitir", leadId: LEAD, ts: 8, por: "cliente" },
      ],
      descartes: ["Has citado las 11:00"],
    });
    expect(accionesDe(r)).toEqual([
      { texto: "Ofrecería: martes 3 nov a las 10:00 · miércoles 4 nov a las 17:00", tono: "normal" },
      { texto: "Reservaría: martes 3 nov a las 10:00 (en la prueba no se reserva)", tono: "normal" },
      { texto: "Anularía la visita", tono: "normal" },
      { texto: "Guardaría: metros = 8", tono: "normal" },
      { texto: "Lo marcaría como publicidad: Ofrece seguidores", tono: "aviso" },
      { texto: "Dejaría de escribirle: ha pedido que no le escriban", tono: "aviso" },
      { texto: "Volvería a contestarle: ha vuelto a escribir", tono: "normal" },
      { texto: "Respuesta descartada y repetida: Has citado las 11:00", tono: "aviso" },
    ]);
    const fallo = accionesDe(resultado({ texto: "Perdona, se me ha cortado. ¿Me lo repites?", fallo: "sin conexión" }));
    expect(fallo).toEqual([{ texto: "Le enviaría la disculpa: «Perdona, se me ha cortado. ¿Me lo repites?»", tono: "error" }]);
    // Las palabras del producto: nada de «spam» ni «agente».
    for (const a of accionesDe(r)) expect(a.texto).not.toMatch(/spam|agente|Asistente IA/i);
  });

  it("chips de la clínica dicen la cita", () => {
    const r = resultado({ mutaciones: [{ t: "cancelar", leadId: LEAD, ts: 4 }] });
    expect(accionesDe(r, PRESETS.clinica.vocabulario)).toEqual([{ texto: "Anularía la cita", tono: "normal" }]);
  });

  it("sin contestar: el motivo va en el chip", () => {
    expect(accionesDe(resultado({ decision: "silencio", texto: null, eventos: ["lo llevas tú"] }))).toEqual([{ texto: "No contestaría: lo llevas tú", tono: "aviso" }]);
    expect(accionesDe(resultado({ decision: "silencio", texto: null, eventos: ["es publicidad"] }))[0].texto).toBe("No contestaría: es publicidad");
    expect(accionesDe(resultado({ decision: "silencio", texto: null, eventos: ["pidió que no le escribamos"] }))[0].texto).toBe(
      "No contestaría: pidió que no le escribamos",
    );
  });

  it("la petición de borrar datos sale como Te lo pasaría", () => {
    const r = resultado({
      decision: "persona",
      persona: "Pide que borres sus datos",
      mutaciones: [{ t: "estado", leadId: LEAD, estado: "persona", ts: 1, motivo: "Pide que borres sus datos" }],
    });
    expect(accionesDe(r)).toEqual([{ texto: "Te lo pasaría: Pide que borres sus datos", tono: "aviso" }]);
  });
});
