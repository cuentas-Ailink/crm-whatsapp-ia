import { describe, expect, it } from "vitest";
import {
  aplicaReglaSpam,
  CIERRES,
  esCierre,
  esperanRespuesta,
  levantaSilencio,
  PALABRAS_COMUNES,
  palabraDemasiadoComun,
  porQueNoContesta,
} from "./asistente";
import { SISTEMA_POR_DEFECTO } from "./configuracion";
import { crearLead } from "./negocio";
import type { Lead, Mensaje } from "./tipos";

const ENCENDIDO = { asistente: { activo: true, pausadoEn: null, modelo: null } };
const APAGADO = { asistente: { activo: false, pausadoEn: 1_000, modelo: null } };

let n = 0;
function lead(campos: Partial<Lead> = {}): Lead {
  n++;
  return crearLead({ telefono: `3461234${String(n).padStart(4, "0")}`, perfilId: "p", perfilNombre: "P", nombre: "Laura", origen: "whatsapp", ...campos });
}
const mensaje = (de: Mensaje["de"], ts: number): Mensaje => ({ id: `${de}-${ts}`, de, texto: "…", ts });

describe("porQueNoContesta", () => {
  it("por defecto contesta", () => {
    expect(porQueNoContesta(lead(), SISTEMA_POR_DEFECTO)).toBeNull();
    expect(porQueNoContesta(lead({ estado: "visita" }), ENCENDIDO)).toBeNull();
  });

  it("un cliente cerrado que vuelve a escribir se atiende", () => {
    expect(porQueNoContesta(lead({ estado: "conversacion", cierre: "no" }), ENCENDIDO)).toBeNull();
  });

  it("en orden: persona, spam, silencio, pausa", () => {
    expect(porQueNoContesta({ estado: "persona", silenciadoEn: 5 }, APAGADO)).toBe("persona");
    expect(porQueNoContesta({ estado: "spam", silenciadoEn: 5 }, APAGADO)).toBe("spam");
    expect(porQueNoContesta({ estado: "conversacion", silenciadoEn: 5 }, APAGADO)).toBe("silencio");
    expect(porQueNoContesta({ estado: "conversacion" }, APAGADO)).toBe("pausa");
    expect(porQueNoContesta({ estado: "persona" }, ENCENDIDO)).toBe("persona");
    expect(porQueNoContesta({ estado: "nuevo", silenciadoEn: 5 }, ENCENDIDO)).toBe("silencio");
  });
});

describe("aplicaReglaSpam", () => {
  it("el formulario, los añadidos a mano y los que tienen cita quedan fuera", () => {
    expect(aplicaReglaSpam({ origen: "formulario", estado: "conversacion" })).toBe(false);
    expect(aplicaReglaSpam({ origen: "manual", estado: "nuevo" })).toBe(false);
    expect(aplicaReglaSpam({ origen: "whatsapp", estado: "visita" })).toBe(false);
  });

  it("un WhatsApp en conversación pasa por la regla", () => {
    expect(aplicaReglaSpam({ origen: "whatsapp", estado: "conversacion" })).toBe(true);
    expect(aplicaReglaSpam({ origen: "whatsapp", estado: "nuevo" })).toBe(true);
  });
});

describe("esperanRespuesta", () => {
  const PAUSA = 10_000;

  it("con el asistente encendido, nadie espera", () => {
    expect(esperanRespuesta([lead({ mensajes: [mensaje("cliente", PAUSA + 1)] })], null)).toBe(0);
  });

  it("cuenta a quien escribió después de apagarlo y aún no tiene respuesta", () => {
    const leads = [
      lead({ mensajes: [mensaje("cliente", PAUSA + 1)] }),
      lead({ estado: "conversacion", mensajes: [mensaje("agente", 5), mensaje("cliente", PAUSA)] }),
      lead({ estado: "visita", mensajes: [mensaje("cliente", PAUSA + 50)] }),
    ];
    expect(esperanRespuesta(leads, PAUSA)).toBe(3);
  });

  it("no cuenta ejemplos, silenciados, mensajes viejos, ya contestados ni otras etapas", () => {
    const leads = [
      lead({ ejemplo: true, mensajes: [mensaje("cliente", PAUSA + 1)] }),
      lead({ origen: "prueba", mensajes: [mensaje("cliente", PAUSA + 1)] }),
      lead({ silenciadoEn: 5, mensajes: [mensaje("cliente", PAUSA + 1)] }),
      lead({ mensajes: [mensaje("cliente", PAUSA - 1)] }),
      lead({ mensajes: [mensaje("cliente", PAUSA + 1), mensaje("agente", PAUSA + 2)] }),
      lead({ estado: "persona", mensajes: [mensaje("cliente", PAUSA + 1)] }),
      lead({ estado: "spam", mensajes: [mensaje("cliente", PAUSA + 1)] }),
      lead({ mensajes: [] }),
    ];
    expect(esperanRespuesta(leads, PAUSA)).toBe(0);
  });
});

describe("palabraDemasiadoComun", () => {
  it("la lista", () => {
    expect(PALABRAS_COMUNES).toEqual(["hola", "precio", "cita", "visita", "información", "presupuesto", "gracias"]);
  });

  it.each(["precio", "¿Qué PRECIO tiene?", "más información", "informacion por favor", "Hola", "una cita urgente"])("común: «%s»", (frase) => {
    expect(palabraDemasiadoComun(frase)).toBe(true);
  });

  it.each(["reclamación", "me duele mucho", "precios", "citación", "abogado", ""])("no común: «%s»", (frase) => {
    expect(palabraDemasiadoComun(frase)).toBe(false);
  });
});

describe("esCierre", () => {
  it("la lista no lleva acentos", () => {
    expect(CIERRES).toContain("manana");
    expect(CIERRES.every((p) => p === p.normalize("NFD").replace(/[̀-ͯ]/g, ""))).toBe(true);
  });

  it.each([
    "gracias",
    "Ok 👍",
    "vale, gracias",
    "Perfecto, hasta luego",
    "👍",
    "Gracias a vosotros",
    "sí, gracias",
    "",
    "Gracias, hasta mañana",
    "Muchas gracias!!",
  ])("cierra: «%s»", (texto) => {
    expect(esCierre(texto)).toBe(true);
  });

  it.each([
    "Al final sí quiero el presupuesto",
    "¿Cuándo podéis venir?",
    "No, solo que por la mañana no puedo",
    "hola",
    "vale, pero llamadme mejor",
    "ok, el martes me va bien",
    "Gracias. ¿Y el precio?",
  ])("no cierra: «%s»", (texto) => {
    expect(esCierre(texto)).toBe(false);
  });
});

describe("levantaSilencio", () => {
  const silenciado = { silenciadoEn: 1_000 };

  it("un mensaje de verdad levanta el silencio", () => {
    expect(levantaSilencio(silenciado, "¿Al final cuándo podéis venir?")).toBe(true);
    expect(levantaSilencio(silenciado, "Hola")).toBe(true);
    expect(levantaSilencio(silenciado, "No, solo que por la mañana no puedo")).toBe(true);
  });

  it("una despedida, otra baja o pedir el borrado no lo levantan", () => {
    expect(levantaSilencio(silenciado, "gracias")).toBe(false);
    expect(levantaSilencio(silenciado, "Ok 👍")).toBe(false);
    expect(levantaSilencio(silenciado, "")).toBe(false);
    expect(levantaSilencio(silenciado, "no me escribáis más")).toBe(false);
    expect(levantaSilencio(silenciado, "borrad mis datos")).toBe(false);
  });

  it("sin silencio no hay nada que levantar", () => {
    expect(levantaSilencio({}, "¿Al final cuándo podéis venir?")).toBe(false);
    expect(levantaSilencio({ silenciadoEn: undefined }, "Hola")).toBe(false);
  });
});
