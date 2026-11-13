import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReglaPase } from "./configuracion";
import {
  conPresentacion,
  controles,
  importesCitados,
  motivoParaPersona,
  paseObligado,
  pideBaja,
  pideBorrarDatos,
  PROMETE_RECORDATORIO,
  revisarRespuesta,
  type RevisionRespuesta,
} from "./guion";
import type { Moneda } from "./regional";
import type { Hueco } from "./tipos";
import { normalizar, VOCABULARIO_REFORMAS, type Vocabulario } from "./vocabulario";

const TURNO: Vocabulario = { ...VOCABULARIO_REFORMAS, cita: { singular: "turno", plural: "turnos", genero: "m" } };
const COMISIONES: Vocabulario = { ...VOCABULARIO_REFORMAS, importe: { singular: "comisión", plural: "comisiones", genero: "f" } };
const HUECOS: Hueco[] = [
  { id: "2026-11-03T10:00", texto: "martes 3 nov a las 10:00" },
  { id: "2026-11-04T17:00", texto: "miércoles 4 nov a las 17:00" },
];

const revisar = (texto: string, extra: Partial<RevisionRespuesta> = {}) =>
  revisarRespuesta({ texto, validas: HUECOS, reservo: false, pasoAPersona: false, ...extra });

describe("controles", () => {
  const VOCABULARIOS: [string, Vocabulario][] = [
    ["visita", VOCABULARIO_REFORMAS],
    ["turno", TURNO],
  ];

  describe.each(VOCABULARIOS)("con el vocabulario de «%s»", (_nombre, v) => {
    const c = controles(v);

    it.each([
      "Perfecto, le reservo el martes a las 10:00.",
      "Le esperamos el martes 3 nov a las 10:00.",
      "Os he apuntado para el martes.",
      "Hecho, martes a las 10:00.",
      "Reservado: martes a las 10:00.",
      "Listo, tu visita queda reservada para el martes a las 10:00.",
      "Su turno queda reservado.",
      "Turno reservado para el martes.",
    ])("CONFIRMA: «%s»", (texto) => {
      expect(c.CONFIRMA.test(texto)).toBe(true);
    });

    it.each([
      "Ese piso está reservado, pero tengo otro en Gràcia.",
      "Ese está reservado. Te enseño el de Mallorca el martes 3 nov a las 10:00 o el miércoles 4 nov a las 17:00.",
    ])("CONFIRMA no: «%s»", (texto) => {
      expect(c.CONFIRMA.test(texto)).toBe(false);
    });

    it.each([
      "Un compañero le escribirá hoy mismo.",
      "Le paso con una compañera.",
      "Se pondrá en contacto con usted un asesor.",
      "para que le llamen",
      "Un compañero te escribirá mañana",
      "Te llamará un compañero",
      "Mañana te llaman del equipo.",
      "He avisado a un compañero para que te escriba hoy mismo.",
      "Un compañero te escribe hoy mismo.",
      "Te llamamos esta tarde",
      "Te escribimos mañana con el presupuesto",
      "Mañana te escribo",
      "Te llamo en un rato",
      "Lo consulto y te digo algo",
      "Nos pondremos en contacto contigo",
      "Te escribiré cuando lo sepa",
      "Le llamaremos el lunes",
    ])("AVISA_PERSONA: «%s»", (texto) => {
      expect(c.AVISA_PERSONA.test(texto)).toBe(true);
    });

    it.each([
      "¿Cómo te llamas?",
      "Entendido: no te escribiremos más por aquí. Si algún día lo necesitas, escríbenos y te atendemos.",
      "Te escribo desde Estudio de reformas para confirmar la visita.",
      "400.000 € no te lo puedo confirmar yo.",
      "Hecho ✅ martes 3 nov a las 10:00. Si necesitas cambiarla, escríbeme por aquí.",
      "Te propongo martes 3 nov a las 10:00 o miércoles 4 nov a las 17:00. ¿Cuál te va mejor?",
      "Perdona, dime qué día te viene mejor y lo miro.",
    ])("AVISA_PERSONA no: «%s»", (texto) => {
      expect(c.AVISA_PERSONA.test(texto)).toBe(false);
    });

    it.each([
      "Listo, la visita queda cancelada.",
      "Hecho, martes 3 nov a las 10:00; la anterior queda anulada.",
      "El turno queda cancelado.",
    ])("CANCELA: «%s»", (texto) => {
      expect(c.CANCELA.test(texto)).toBe(true);
    });

    it.each([
      "Páseme con una persona",
      "Prefiero hablar con alguien de la clínica",
      "Prefiero hablar con una persona",
      "¿Puedo hablar con alguien de la inmobiliaria?",
    ])("PIDE_PERSONA: «%s»", (texto) => {
      expect(c.PIDE_PERSONA.test(texto)).toBe(true);
    });

    it.each([
      "Tengo que hablar con alguien de mi mutua",
      "Tengo que hablar con alguien de la aseguradora",
      "Antes tengo que hablar con alguien del seguro",
      "Tengo que hablar con alguien de la mutua",
      "Tengo que hablar con alguien de mi banco primero",
    ])("PIDE_PERSONA no: «%s»", (texto) => {
      expect(c.PIDE_PERSONA.test(texto)).toBe(false);
    });
  });

  it("nombra la cita del vocabulario", () => {
    const LA_CONSULTA: Vocabulario = { ...VOCABULARIO_REFORMAS, cita: { singular: "consulta", plural: "consultas", genero: "f" } };
    expect(controles(LA_CONSULTA).CONFIRMA.test("Tu consulta confirmada.")).toBe(true);
    expect(controles(LA_CONSULTA).CANCELA.test("Consulta anulada.")).toBe(true);
    expect(controles().CONFIRMA.test("Tu consulta confirmada.")).toBe(true); // «confirmada» sola ya confirma
    expect(controles().CANCELA.test("Consulta anulada.")).toBe(false);
  });

  it("se construyen una vez por vocabulario", () => {
    expect(controles(TURNO)).toBe(controles(TURNO));
    expect(controles()).toBe(controles(VOCABULARIO_REFORMAS));
    expect(controles(TURNO)).not.toBe(controles());
  });
});

describe("PIDE_BAJA", () => {
  it.each([
    "no me escribas",
    "Por favor, no me escribáis más",
    "No me escribáis más, gracias",
    "no quiero que me escribáis",
    "Dejad de escribirme",
    "Deja de escribirme ya",
    "quiero darme de baja",
    "dame de baja de la lista",
    "Baja",
    "STOP",
    "stop.",
    "Basta",
    "no me mandéis más",
    "no me mandéis más mensajes",
    "no me envíes nada más",
    "no me contactes",
    "no me volváis a escribir",
    "no me escribas nunca más",
    "no quiero recibir más mensajes",
    "no me escribáis más por aquí 🙏",
    "No me interesa, no me escribáis más",
    "Gracias, pero no me escribáis más",
    "quiero darme de baja y que borréis mis datos",
  ])("pide la baja: «%s»", (texto) => {
    expect(pideBaja(texto)).toBe(true);
  });

  it.each([
    "no me escribió nadie después de la visita",
    "no me escribas hasta el lunes",
    "no me mandes el presupuesto por aquí, mejor por email",
    "¿Me escribís mañana?",
    "No me escribas por la mañana, que trabajo",
    "no me escribas más tarde",
    "no me contactes el sábado",
    "No me mandéis más fotos de cocinas",
    "no quiero que me envíen el presupuesto en papel",
    "dame de baja la cita del jueves",
    "no me escribas tú, que me escriba el arquitecto",
    "¿no me escribes?",
    "no me llames, escríbeme por aquí",
    "deja de escribirme a estas horas",
    "no me escribas por aquí hasta el lunes",
    "no quiero que me escribáis por la noche",
    "no me escriba antes de las 9, por favor",
    "no me escribas y que me escriba el arquitecto",
  ])("no es una baja: «%s»", (texto) => {
    expect(pideBaja(texto)).toBe(false);
  });
});

describe("PROMETE_RECORDATORIO", () => {
  it.each([
    "Te escribimos el día antes para confirmar.",
    "El día antes te mandamos un recordatorio.",
    "Os escribiremos el día antes para recordarlo",
    "le mandarás la dirección exacta el día antes",
    "Te escribo el día antes para recordártelo",
    "Te mandaré un recordatorio el día antes",
    "Te avisaremos la víspera",
    "Recibirás un recordatorio 24 h antes",
    "Un día antes te avisamos",
    "Te recordaremos la cita 2 horas antes",
    "Te enviaremos un aviso antes de la visita",
    "Te llamamos antes de la visita para confirmar",
    "Te llegará un WhatsApp el día antes",
    "Confirma: día, hora y que le escribiremos el día antes.",
  ])("promete un aviso: «%s»", (texto) => {
    expect(PROMETE_RECORDATORIO.test(texto)).toBe(true);
    expect(controles(TURNO).PROMETE_RECORDATORIO.test(texto)).toBe(true);
  });

  it("con «turno»: «Te escribimos antes del turno para confirmarlo.»", () => {
    expect(controles(TURNO).PROMETE_RECORDATORIO.test("Te escribimos antes del turno para confirmarlo.")).toBe(true);
    expect(controles(TURNO).PROMETE_RECORDATORIO.test("Le escribiremos antes de su turno.")).toBe(true);
  });

  it.each([
    "Si el día antes te surge algo, escríbeme por aquí.",
    "No mandamos recordatorios automáticos, pero puedes escribirnos.",
    "Te recuerdo que la visita es el martes a las 10:00.",
    "No te mandamos recordatorios: si necesitas cambiarla, escríbenos por aquí.",
    "Hecho, visita reservada para el martes 3 nov a las 10:00. Si prefieres hablar con una persona, dímelo por aquí.",
    "Entendido: no te escribiremos más por aquí. Si algún día lo necesitas, escríbenos y te atendemos.",
    "400.000 € no te lo puedo confirmar yo.",
    "Un compañero te escribe hoy mismo.",
    "Hecho ✅ martes 3 nov a las 10:00. Si necesitas cambiarla, escríbeme por aquí.",
  ])("no promete nada: «%s»", (texto) => {
    expect(PROMETE_RECORDATORIO.test(texto)).toBe(false);
    expect(controles(TURNO).PROMETE_RECORDATORIO.test(texto)).toBe(false);
  });
});

describe("pideBorrarDatos", () => {
  it.each([
    "borrad mis datos",
    "Quiero que borréis mis datos",
    "quiero que eliminéis mis datos",
    "eliminad mi número",
    "borrad todo lo que tengáis de mí",
    "quiero que me borréis de vuestra base de datos",
    "ejerzo mi derecho de supresión",
    "derecho al olvido",
    "no quiero que guardéis mis datos",
    "quiero darme de baja y que borréis mis datos",
    "No me interesa. Borrad mis datos, por favor",
    "no, borrad mis datos",
    "¿Me borráis de vuestra base de datos?",
    "Bórrame de vuestra lista, gracias",
    "borradme de vuestros registros",
  ])("pide que borren sus datos: «%s»", (texto) => {
    expect(pideBorrarDatos(texto)).toBe(true);
  });

  it.each([
    "borra la cita del jueves",
    "¿qué datos guardáis?",
    "no borréis mis datos",
    "he borrado el mensaje sin querer",
    "elimina el presupuesto anterior, ya no vale",
    "mis datos son Laura, 612 345 678",
    "¿podéis borrar el mensaje de antes?",
    "no quiero que me borréis de vuestra base de datos",
    "he borrado mis datos del formulario sin querer",
    "borrad la foto que os mandé",
    "mis datos de contacto están en el formulario",
    "¿Habéis guardado mis datos bien?",
    "no hace falta que borréis mis datos",
  ])("no lo pide: «%s»", (texto) => {
    expect(pideBorrarDatos(texto)).toBe(false);
  });

  it("darse de baja y pedir el borrado a la vez cuenta para las dos cosas", () => {
    const texto = "quiero darme de baja y que borréis mis datos";
    expect(pideBaja(texto)).toBe(true);
    expect(pideBorrarDatos(texto)).toBe(true);
  });

  it("no depende del vocabulario y se aplica sobre el texto normalizado", () => {
    expect(controles(TURNO).PIDE_BORRAR_DATOS).toBe(controles().PIDE_BORRAR_DATOS);
    expect(controles().PIDE_BORRAR_DATOS.test(normalizar("Quiero que BORRÉIS mis datos"))).toBe(true);
  });

  it("el pase obligado no mira las peticiones de borrado", () => {
    expect(paseObligado("borrad mis datos", "")).toBeNull();
  });
});

describe("paseObligado", () => {
  const URGENCIA: ReglaPase = {
    motivo: "Posible urgencia",
    frases: ["urgencia", "es urgente", "me duele mucho", "mucho dolor", "dolor fuerte", "sangra", "se me ha roto"],
    respuesta: "Si es una urgencia grave, llama al 112. Te paso con recepción, que te escribe en cuanto pueda.",
  };
  const opciones = { pasarSiempre: [URGENCIA], excepciones: ["no es urgente"] };
  const pase = (texto: string) => paseObligado(texto, "", opciones);

  it.each([
    "Buenos días, me duele mucho la muela",
    "Bueno, es urgente",
    "Buenas noches, sangra",
    "No aguanto, me duele mucho",
    "me duele mucho",
    "se me ha roto un diente",
    "tengo mucho dolor",
  ])("pasa: «%s»", (texto) => {
    expect(pase(texto)).toEqual({ motivo: "Posible urgencia", respuesta: URGENCIA.respuesta });
  });

  it.each(["no es urgente", "nada urgente", "no me duele mucho", "sin dolor fuerte", "ni sangra ni nada"])("no pasa: «%s»", (texto) => {
    expect(pase(texto)).toBeNull();
  });

  it("la excepción gana a la frase que contiene", () => {
    expect(pase("Tranquilos, no es urgente")).toBeNull();
    expect(paseObligado("Tranquilos, no es urgente", "", { pasarSiempre: [{ motivo: "", frases: ["urgente"] }], excepciones: ["no es urgente"] })).toBeNull();
    expect(paseObligado("Tranquilos, es urgente", "", { pasarSiempre: [{ motivo: "", frases: ["urgente"] }], excepciones: ["no es urgente"] })).toEqual({
      motivo: "Ha escrito «urgente»",
    });
  });

  it("una negación en otra oración no cuenta", () => {
    expect(pase("No sé qué pasa, me duele mucho")).not.toBeNull();
    expect(pase("No me duele mucho. Bueno, sí, sangra")).not.toBeNull();
  });

  it("devuelve la respuesta de la regla, y sin ella no la pone", () => {
    expect(pase("sangra")?.respuesta).toBe(URGENCIA.respuesta);
    expect(paseObligado("sangra", "", { pasarSiempre: [{ motivo: "Urgencia", frases: ["sangra"] }] })).toEqual({ motivo: "Urgencia" });
  });

  it("sin motivo, dice qué frase ha escrito, tal como está guardada", () => {
    const lista: ReglaPase = { motivo: "", frases: ["reclamación"] };
    expect(paseObligado("Quiero poner una reclamación", "", { pasarSiempre: [lista] })).toEqual({ motivo: "Ha escrito «reclamación»" });
    expect(motivoParaPersona("Quiero poner una reclamación", "", { pasarSiempre: [lista] })).toBe("Ha escrito «reclamación»");
  });

  it("solo palabras o frases enteras", () => {
    expect(paseObligado("Quiero poner una reclamación", "", { pasarSiempre: [{ motivo: "", frases: ["recla"] }] })).toBeNull();
    expect(paseObligado("Está muy hinchado", "", { pasarSiempre: [{ motivo: "", frases: ["hinchad"] }] })).toBeNull();
  });

  it("sin mayúsculas ni acentos", () => {
    expect(paseObligado("QUIERO PONER UNA RECLAMACION", "", { pasarSiempre: [{ motivo: "", frases: ["Reclamación"] }] })).toEqual({
      motivo: "Ha escrito «Reclamación»",
    });
    expect(pase("SE ME HA ROTO EL DIENTE")).not.toBeNull();
  });

  it("no rompe con frases o textos raros", () => {
    const raras: ReglaPase = { motivo: "", frases: ["c++", "(", "[", "", "  ", "🦷"] };
    for (const texto of ["c++", "(", "[", "🦷🦷", "", "\\", "a)b(c"]) {
      expect(() => paseObligado(texto, "", { pasarSiempre: [raras], excepciones: ["(", "[", ""] })).not.toThrow();
    }
    expect(paseObligado("me gusta c++ mucho", "", { pasarSiempre: [raras] })).toEqual({ motivo: "Ha escrito «c++»" });
    expect(paseObligado("hola", "", { pasarSiempre: [{ motivo: "", frases: [] }] })).toBeNull();
    expect(() => pase("c++ ( [ 🦷")).not.toThrow();
  });

  it("pedir una persona va primero, con su motivo", () => {
    expect(paseObligado("Páseme con una persona", "", opciones)).toEqual({ motivo: "Pide hablar con una persona" });
    expect(paseObligado("me duele mucho, prefiero hablar con una persona", "", opciones)).toEqual({ motivo: "Pide hablar con una persona" });
  });

  it("hablar con alguien del seguro no es pedir una persona del equipo", () => {
    expect(paseObligado("Tengo que hablar con alguien de la mutua", "", opciones)).toBeNull();
    expect(paseObligado("Antes tengo que hablar con alguien del seguro", "", opciones)).toBeNull();
  });
});

describe("negociar", () => {
  const inmobiliaria = readFileSync("perfiles/inmobiliaria.md", "utf8");
  const reformas = readFileSync("perfiles/reformas.md", "utf8");
  const oferta = "¿Me lo dejaríais en 400.000 €?";

  it("auto: solo donde «Pasar a una persona» habla de negociar", () => {
    expect(motivoParaPersona(oferta, inmobiliaria)).toBe("Quiere negociar el precio");
    expect(motivoParaPersona(oferta, inmobiliaria, { negociar: "auto" })).toBe("Quiere negociar el precio");
    expect(motivoParaPersona(oferta, reformas, { negociar: "auto" })).toBeNull();
  });

  it("sí: siempre; no: nunca", () => {
    expect(motivoParaPersona(oferta, inmobiliaria, { negociar: "si" })).toBe("Quiere negociar el precio");
    expect(motivoParaPersona(oferta, reformas, { negociar: "si" })).toBe("Quiere negociar el precio");
    expect(motivoParaPersona(oferta, inmobiliaria, { negociar: "no" })).toBeNull();
  });

  it("con otra moneda lee sus importes", () => {
    expect(motivoParaPersona("Te pago $15,000 por él", "Cuesta $20,000.", { negociar: "si", moneda: "MXN" })).toBe("Quiere negociar el precio");
    expect(motivoParaPersona("¿Sigue a $20,000?", "Cuesta $20,000.", { negociar: "si", moneda: "MXN" })).toBeNull();
  });
});

describe("importesCitados por moneda", () => {
  it("en euros, igual que siempre", () => {
    expect(importesCitados("465.000 €, 389 000 euros, 400 mil euros y 1.200,50€")).toEqual([465000, 389000, 400000, 1200]);
    expect(importesCitados("465.000 €, 389 000 euros, 400 mil euros y 1.200,50€", "EUR")).toEqual([465000, 389000, 400000, 1200]);
    expect(importesCitados("Son 6.400 € más o menos.")).toEqual([6400]);
    expect(importesCitados("sin precio")).toEqual([]);
    expect(importesCitados("$20,000 y 1.500 soles")).toEqual([]);
  });

  const CASOS: [Moneda, string, number[]][] = [
    ["MXN", "Son $20,000 más o menos", [20000]],
    ["MXN", "MX$ 15.500 al mes", [15500]],
    ["MXN", "20 mil pesos", [20000]],
    ["MXN", "Tengo 3 hijos y 2 perros", []],
    ["MXN", "vale 400.000 €", [400000]],
    ["COP", "COP$ 2.500.000 o 3 millones", [2500000]],
    ["COP", "Son 1.200.000 pesos", [1200000]],
    ["PEN", "S/ 1,500 o S/1.500,50", [1500, 1500]],
    ["PEN", "1.500 soles", [1500]],
    ["GTQ", "Q500 o 1.200 quetzales", [500, 1200]],
    ["GTQ", "la Q de Quetzaltenango 2", []],
    ["HNL", "L1,200 lempiras", [1200]],
    ["HNL", "l1200", []],
    ["BOB", "Bs. 3.000", [3000]],
    ["BOB", "3000 bolivianos", [3000]],
    ["PYG", "₲ 2.000.000", [2000000]],
    ["PYG", "Gs. 2.000.000", [2000000]],
    ["CRC", "₡250.000", [250000]],
    ["DOP", "RD$ 35,000", [35000]],
    ["DOP", "35k pesos", [35000]],
  ];
  it.each(CASOS)("%s: «%s»", (moneda, texto, esperado) => {
    expect(importesCitados(texto, moneda)).toEqual(esperado);
  });
});

describe("Información que puedes dar tal cual", () => {
  const FRASE = "La primera visita es gratuita y dura unos cuarenta y cinco minutos en total.";
  const INSTRUCCIONES = [
    "# Asistente de WhatsApp · Estudio de reformas",
    "",
    "## Cómo escribes",
    "- Mensajes cortos. El horario de oficina empieza a las 08:30 y nadie lo cita.",
    "",
    "## Información que puedes dar tal cual",
    `- ${FRASE}`,
    "- Abrimos los sábados a las 9:30.",
    "",
    "## Pasar a una persona",
    "Si pide hablar con alguien, usa pasar_a_persona.",
    "",
  ].join("\n");
  const SIN_SECCION = INSTRUCCIONES.replace("## Información que puedes dar tal cual", "## Otras cosas");

  it("una frase de la sección se puede repetir; la misma fuera de ella, no", () => {
    expect(revisar(FRASE, { instrucciones: INSTRUCCIONES })).toBeNull();
    expect(revisar(FRASE, { instrucciones: SIN_SECCION })).toContain("instrucciones");
  });

  it("una hora de la sección se puede citar; la misma fuera de ella, no", () => {
    expect(revisar("Abrimos los sábados a las 9:30.", { instrucciones: INSTRUCCIONES })).toBeNull();
    expect(revisar("Abrimos los sábados a las 9:30.", { instrucciones: SIN_SECCION })).toContain("09:30");
    expect(revisar("La oficina abre a las 8:30.", { instrucciones: INSTRUCCIONES })).toContain("08:30");
  });

  it("sin «informacion», sale de las instrucciones; con ella, manda la que llega", () => {
    expect(revisar("Abrimos los sábados a las 9:30.", { instrucciones: INSTRUCCIONES, informacion: "Nada de horas." })).toContain("09:30");
    expect(revisar("Abrimos los sábados a las 9:30.", { informacion: "- Abrimos los sábados a las 9:30." })).toBeNull();
  });

  it("las horas de la rejilla solo valen si llegan en horasExtra", () => {
    expect(revisar("También tengo el martes a las 12:30.")).toContain("12:30");
    expect(revisar("También tengo el martes a las 12:30.", { horasExtra: ["10:00", "12:30", "17:00"] })).toBeNull();
  });
});

describe("revisarRespuesta", () => {
  it("el recordatorio va antes que AVISA_PERSONA, haya reservado o pasado a una persona", () => {
    const mensaje = "Has prometido un aviso para más adelante y nadie lo va a enviar. No prometas recordatorios ni mensajes: si necesita cambiar algo, que escriba por aquí.";
    expect(revisar("Te escribimos el día antes para confirmar.")).toBe(mensaje);
    expect(revisar("Te escribimos el día antes para confirmar.", { reservo: true })).toBe(mensaje);
    expect(revisar("Te escribimos el día antes para confirmar.", { pasoAPersona: true })).toBe(mensaje);
  });

  it("una promesa en primera persona sin pasar_a_persona, el mensaje de siempre; con la herramienta, vale", () => {
    const mensaje =
      "Has dicho que alguien del equipo le va a escribir sin usar pasar_a_persona, y así no se avisa a nadie. Usa la herramienta si toca pasarlo a una persona; si no, no lo prometas.";
    for (const texto of ["Te llamamos esta tarde", "Mañana te escribo", "Lo consulto y te digo algo", "Un compañero te escribirá mañana"]) {
      expect(revisar(texto)).toBe(mensaje);
      expect(revisar(texto, { pasoAPersona: true })).toBeNull();
    }
    expect(revisar("Entendido: no te escribiremos más por aquí. Si algún día lo necesitas, escríbenos y te atendemos.")).toBeNull();
  });

  it("el mensaje de importes en euros es el de siempre", () => {
    expect(revisar("Son 6.400 € más o menos.")).toBe(
      "Has dado una cifra (6400 €) que no está en tus instrucciones ni la ha dicho el cliente. No inventes precios, rebajas ni presupuestos.",
    );
    expect(revisar("Son 6.400 € más o menos.", { moneda: "EUR" })).toBe(
      "Has dado una cifra (6400 €) que no está en tus instrucciones ni la ha dicho el cliente. No inventes precios, rebajas ni presupuestos.",
    );
  });

  it("con el vocabulario de la inmobiliaria habla de comisiones", () => {
    expect(revisar("Son 6.400 € más o menos.", { vocabulario: COMISIONES })).toBe(
      "Has dado una cifra (6400 €) que no está en tus instrucciones ni la ha dicho el cliente. No inventes precios, rebajas ni comisiones.",
    );
  });

  it("en otra moneda, la cifra sale con su formato", () => {
    const problema = revisar("Son $20,000 más o menos.", { moneda: "MXN" });
    expect(problema).toContain(`(${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0, useGrouping: "always" }).format(20000)})`);
    expect(problema).not.toContain("€");
    expect(revisar("Son $20,000 más o menos.", { moneda: "MXN", textoCliente: "¿Unos 20 mil pesos?" })).toBeNull();
  });

  it("los mensajes nombran la cita del vocabulario", () => {
    expect(revisar("Hecho, martes a las 10:00.", { vocabulario: TURNO })).toBe(
      "Has confirmado un turno sin usar reservar_visita. Si el cliente ha elegido hueco, usa la herramienta antes de confirmar; si no, vuelve a ofrecerle los huecos.",
    );
    expect(revisar("Hecho, martes a las 10:00.")).toBe(
      "Has confirmado una visita sin usar reservar_visita. Si el cliente ha elegido hueco, usa la herramienta antes de confirmar; si no, vuelve a ofrecerle los huecos.",
    );
    expect(revisar("Listo, el turno queda cancelado.", { vocabulario: TURNO })).toBe(
      "Has dicho que el turno queda cancelado sin usar cancelar_visita, así que sigue en la agenda. Si quiere otra hora, ofrece huecos y usa reservar_visita; si solo quiere anularlo, usa cancelar_visita.",
    );
    expect(revisar("Listo, la visita queda cancelada.")).toBe(
      "Has dicho que la visita queda cancelada sin usar cancelar_visita, así que sigue en la agenda. Si quiere otra hora, ofrece huecos y usa reservar_visita; si solo quiere anularla, usa cancelar_visita.",
    );
  });

  it("sigue el orden: lo interno, importes, porcentajes, horas, confirmar sin reservar", () => {
    expect(revisar("Uso ver_huecos: 6.400 €, un 10 % y a las 9:15.")).toContain("instrucciones");
    expect(revisar("6.400 €, un 10 % y a las 9:15.")).toContain("6400 €");
    expect(revisar("Un 10 % y a las 9:15.")).toContain("10 %");
    expect(revisar("Hecho, a las 9:15.")).toContain("09:15");
    expect(revisar("Hecho, martes a las 10:00. Te escribimos el día antes.")).toContain("reservar_visita");
    expect(revisar("Hecho, martes a las 10:00. Te escribimos el día antes.", { reservo: true })).toContain("recordatorios");
  });

  it("la visita ya reservada se puede citar aunque no esté entre las válidas", () => {
    const visita = { id: "2026-11-05T12:30", texto: "jueves 5 nov a las 12:30" };
    expect(revisar("Tu visita es el jueves a las 12:30.", { visita })).toBeNull();
  });
});

describe("conPresentacion", () => {
  const FRASE = "Soy el asistente virtual de Estudio de reformas.";

  it.each([
    ["¡Hola, Laura! ¿Cuántos metros tiene la cocina?", "¡Hola, Laura! Soy el asistente virtual de Estudio de reformas. ¿Cuántos metros tiene la cocina?"],
    ["Perdona, se me ha cortado. ¿Me lo repites?", "Soy el asistente virtual de Estudio de reformas. Perdona, se me ha cortado. ¿Me lo repites?"],
    ["Hola Laura, ¿cuántos metros tiene la cocina?", "Hola Laura, soy el asistente virtual de Estudio de reformas. ¿Cuántos metros tiene la cocina?"],
    [
      "Buenos días. Te propongo el martes 3 nov a las 10:00 o el miércoles 4 nov a las 17:00.",
      "Buenos días. Soy el asistente virtual de Estudio de reformas. Te propongo el martes 3 nov a las 10:00 o el miércoles 4 nov a las 17:00.",
    ],
    ["Hola", "Hola, soy el asistente virtual de Estudio de reformas."],
    ["Hola, soy el asistente virtual de Estudio de reformas. ¿Qué quieres reformar?", "Hola, soy el asistente virtual de Estudio de reformas. ¿Qué quieres reformar?"],
  ])("«%s»", (texto, esperado) => {
    expect(conPresentacion(texto, FRASE)).toBe(esperado);
  });

  it("sin frase, el texto sale igual", () => {
    expect(conPresentacion("Hola Laura, ¿cuántos metros tiene la cocina?", "")).toBe("Hola Laura, ¿cuántos metros tiene la cocina?");
  });
});
