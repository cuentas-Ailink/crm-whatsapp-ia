import { describe, expect, it } from "vitest";
import { conSeccion, seccionDe, sinSeccion } from "./guion";
import { crearLead, NOMBRE_ETAPA } from "./negocio";
import { PRESETS } from "./presets";
import type { Lead } from "./tipos";
import {
  CAMPOS_REFORMAS,
  campoPrincipal,
  cap,
  concordar,
  etiquetaCampo,
  etiquetarActividad,
  formas,
  frases,
  nombreDePila,
  nombresEtapa,
  nombresInternos,
  normalizarClave,
  resumenDatos,
  seccionesDelPrompt,
  valorCampo,
  VOCABULARIO_REFORMAS,
  type Sustantivo,
  type Vocabulario,
} from "./vocabulario";

const CLINICA = PRESETS.clinica.vocabulario;
const TURNO: Sustantivo = { singular: "turno", plural: "turnos", genero: "m" };
const COMISION: Sustantivo = { singular: "comisión", plural: "comisiones", genero: "f" };
const VOCABULARIO_TURNO: Vocabulario = { ...VOCABULARIO_REFORMAS, cita: TURNO };

function lead(campos: Partial<Lead> = {}): Lead {
  return crearLead({ telefono: "34612345678", perfilId: "estudio-de-reformas", perfilNombre: "Estudio de reformas", nombre: "Laura", origen: "formulario", ...campos });
}

describe("frases de reformas", () => {
  const f = frases();

  it("cada clave tiene el texto de la tabla", () => {
    expect(f.seccionClientes).toBe("Clientes");
    expect(f.buscarPlaceholder).toBe("Buscar cliente o teléfono");
    expect(f.nuevoCliente).toBe("+ Cliente");
    expect(f.tituloNuevoCliente).toBe("Nuevo cliente");
    expect(f.conTuAsistente).toBe("Con tu asistente");
    expect(f.conCita).toBe("Con visita");
    expect(f.teToca).toBe("Te toca");
    expect(f.teTocaATi).toBe("Te toca a ti");
    expect(f.publicidad).toBe("Publicidad");
    expect(f.cerrados).toBe("Cerrados");
    expect(f.cita).toBe("Visita");
    expect(f.citaPasada).toBe("Visita pasada");
    expect(f.citasHoyYManana).toBe("Visitas de hoy y mañana");
    expect(f.sinCitasHoy).toBe("Hoy no tienes visitas.");
    expect(f.citasAparecenAqui).toBe("Aquí saldrán las visitas que reserve tu asistente");
    expect(f.comoFue).toBe("¿Cómo fue la visita?");
    expect(f.comoFueCorto).toBe("¿Cómo fue?");
    expect(f.haDichoQueSi).toBe("Ha dicho que sí");
    expect(f.noSigue).toBe("No sigue");
    expect(f.reabrir).toBe("Reabrir");
    expect(f.conversion(40)).toBe("el 40 % de las visitas acaban en sí");
    expect(f.nadieTeEspera).toBe("Nadie te espera. Tu asistente lo lleva todo.");
    expect(f.cliente).toBe("Cliente");
    expect(f.contactoEjemplo).toBe("Contacto de ejemplo");
    expect(f.pendientes(1)).toBe("1 pendiente");
    expect(f.pendientes(3)).toBe("3 pendientes");
    expect(f.notasAyuda).toBe("Solo las ves tú; el cliente, nunca.");
    expect(f.notaPlaceholder).toBe("Algo que quieras recordar de este cliente");
    expect(f.importeConSimbolo).toBe("Importe (€)");
    expect(f.cobradoConSimbolo).toBe("Cobrado (€)");
    expect(f.zona).toBe("Zona");
  });

  it("los dos ejemplos de la ficha son los textos de hoy", () => {
    expect(f.etiquetasPlaceholder).toBe("Separadas por comas, p. ej. cocina, financiación");
    expect(f.datoPlaceholder).toBe("Nombre, como «presupuesto»");
  });

  it("redondea el porcentaje de conversión", () => {
    expect(f.conversion(33.4)).toBe("el 33 % de las visitas acaban en sí");
  });

  it("el símbolo sale de la moneda y se recuerda por vocabulario y moneda", () => {
    const soles = frases(VOCABULARIO_REFORMAS, { simbolo: "S/", nombre: "soles" });
    expect(soles.importeConSimbolo).toBe("Importe (S/)");
    expect(soles.cobradoConSimbolo).toBe("Cobrado (S/)");
    expect(frases(VOCABULARIO_REFORMAS, { simbolo: "S/", nombre: "soles" })).toBe(soles);
    expect(frases()).toBe(f);
  });
});

describe("frases de la clínica", () => {
  const f = frases(CLINICA);

  it("habla de pacientes y de citas", () => {
    expect(f.seccionClientes).toBe("Pacientes");
    expect(f.nuevoCliente).toBe("+ Paciente");
    expect(f.tituloNuevoCliente).toBe("Nuevo paciente");
    expect(f.conCita).toBe("Con cita");
    expect(f.citasHoyYManana).toBe("Citas de hoy y mañana");
    expect(f.sinCitasHoy).toBe("Hoy no tienes citas.");
    expect(f.comoFue).toBe("¿Cómo fue la cita?");
    expect(f.notasAyuda).toBe("Solo las ves tú; el paciente, nunca.");
    expect(f.zona).toBeNull();
  });

  it("los ejemplos de la ficha salen del vocabulario", () => {
    expect(f.buscarPlaceholder).toBe("Buscar paciente o teléfono");
    expect(f.cita).toBe("Cita");
    expect(f.citaPasada).toBe("Cita pasada");
    expect(f.cliente).toBe("Paciente");
    expect(f.notaPlaceholder).toBe("Algo que quieras recordar de este paciente");
    expect(f.etiquetasPlaceholder).toBe("Separadas por comas, p. ej. ortodoncia, financiación");
    expect(f.datoPlaceholder).toBe("Nombre, como «seguro»");
    expect(f.conversion(50)).toBe("el 50 % de las citas acaban en sí");
  });
});

describe("concordancia", () => {
  it("visita y cita son femeninas", () => {
    expect(concordar(VOCABULARIO_REFORMAS.cita, "reservad")).toBe("reservada");
    expect(concordar(CLINICA.cita, "pasad")).toBe("pasada");
    expect(formas(VOCABULARIO_REFORMAS.cita).el).toBe("la");
    expect(formas(CLINICA.cita).los).toBe("las");
  });

  it("turno es masculino", () => {
    const f = formas(TURNO);
    expect(concordar(TURNO, "reservad")).toBe("reservado");
    expect([f.el, f.los, f.un, f.uno, f.ningun, f.otro, f.lo, f.ese]).toEqual(["el", "los", "un", "uno", "ningún", "otro", "lo", "ese"]);
    expect(frases(VOCABULARIO_TURNO).citaPasada).toBe("Turno pasado");
    expect(frases(VOCABULARIO_TURNO).comoFue).toBe("¿Cómo fue el turno?");
    expect(frases(VOCABULARIO_TURNO).citasAparecenAqui).toBe("Aquí saldrán los turnos que reserve tu asistente");
  });

  it("comisión es femenina", () => {
    const f = formas(COMISION);
    expect([f.el, f.los, f.un, f.uno, f.ningun, f.otro, f.lo, f.ese]).toEqual(["la", "las", "una", "una", "ninguna", "otra", "la", "esa"]);
    expect(f.adj("nuev")).toBe("nueva");
  });

  it("en plural", () => {
    expect(concordar(TURNO, "nuev", true)).toBe("nuevos");
    expect(concordar(COMISION, "nuev", true)).toBe("nuevas");
    expect(formas(COMISION).adj("abiert", true)).toBe("abiertas");
  });

  it("un sustantivo de solo plural usa siempre las formas en plural", () => {
    const gafas: Sustantivo = { singular: "gafas", plural: "gafas", genero: "f", soloPlural: true };
    const f = formas(gafas);
    expect([f.el, f.un, f.ningun, f.otro, f.ese]).toEqual(["las", "unas", "ningunas", "otras", "esas"]);
    expect(concordar(gafas, "nuev")).toBe("nuevas");
    const zapatos = formas({ singular: "zapatos", plural: "zapatos", genero: "m", soloPlural: true });
    expect([zapatos.el, zapatos.un, zapatos.ningun, zapatos.otro, zapatos.ese]).toEqual(["los", "unos", "ningunos", "otros", "esos"]);
  });

  it("cap pone en mayúscula la primera letra", () => {
    expect(cap("visita")).toBe("Visita");
    expect(cap("")).toBe("");
  });
});

describe("lineaMes", () => {
  const f = frases();

  it("la línea completa", () => {
    expect(f.lineaMes({ nuevos: 12, conCita: 5, si: 3, importeSi: "15.600 €", conversion: 60, medianaSegundos: "4,2" })).toBe(
      "Este mes: 12 clientes nuevos · 5 con visita · 3 han dicho que sí (15.600 €) · el 60 % de las visitas acaban en sí · primer WhatsApp en 4,2 s de mediana",
    );
  });

  it("en singular", () => {
    expect(f.lineaMes({ nuevos: 1, conCita: 1, si: 1, importeSi: "5.200 €", conversion: null, medianaSegundos: null })).toBe(
      "Este mes: 1 cliente nuevo · 1 con visita · 1 ha dicho que sí (5.200 €)",
    );
  });

  it("deja fuera lo que no tiene valor, pero no los ceros", () => {
    expect(f.lineaMes({ nuevos: 0, conCita: 0, si: 0, importeSi: "", conversion: null, medianaSegundos: null })).toBe(
      "Este mes: 0 clientes nuevos · 0 con visita · 0 han dicho que sí",
    );
    expect(f.lineaMes({ nuevos: 4, conCita: 2, si: 2, importeSi: "", conversion: null, medianaSegundos: "8" })).toBe(
      "Este mes: 4 clientes nuevos · 2 con visita · 2 han dicho que sí · primer WhatsApp en 8 s de mediana",
    );
  });

  it("sin «()» cuando nadie ha dicho que sí", () => {
    const linea = f.lineaMes({ nuevos: 3, conCita: 1, si: 0, importeSi: "0 €", conversion: 0, medianaSegundos: null });
    expect(linea).toBe("Este mes: 3 clientes nuevos · 1 con visita · 0 han dicho que sí · el 0 % de las visitas acaban en sí");
    expect(linea).not.toContain("(");
  });

  it("en la clínica, pacientes y citas", () => {
    expect(frases(CLINICA).lineaMes({ nuevos: 2, conCita: 1, si: 0, importeSi: "", conversion: null, medianaSegundos: null })).toBe(
      "Este mes: 2 pacientes nuevos · 1 con cita · 0 han dicho que sí",
    );
  });
});

describe("nombres de etapa", () => {
  it("los que ve el dueño en reformas", () => {
    expect(nombresEtapa()).toEqual({
      nuevo: { nombre: "Con tu asistente", tono: "gris" },
      conversacion: { nombre: "Con tu asistente", tono: "gris" },
      visita: { nombre: "Con visita", tono: "ok" },
      persona: { nombre: "Te toca", tono: "atencion" },
      spam: { nombre: "Publicidad", tono: "gris" },
    });
  });

  it("los que ve el dueño en la clínica", () => {
    expect(nombresEtapa(CLINICA).visita).toEqual({ nombre: "Con cita", tono: "ok" });
    expect(nombresEtapa(CLINICA).persona).toEqual({ nombre: "Te toca", tono: "atencion" });
  });

  it("los internos sin argumento son NOMBRE_ETAPA", () => {
    expect(nombresInternos()).toEqual(NOMBRE_ETAPA);
    expect(nombresInternos(VOCABULARIO_REFORMAS)).toEqual(NOMBRE_ETAPA);
  });

  it("los internos de la clínica y de un turno", () => {
    expect(nombresInternos(CLINICA)).toEqual({ ...NOMBRE_ETAPA, visita: "Cita reservada" });
    expect(nombresInternos(VOCABULARIO_TURNO).visita).toBe("Turno reservado");
  });

  it("los títulos de las secciones del prompt", () => {
    expect(seccionesDelPrompt().cita).toBe("La visita");
    expect(seccionesDelPrompt(CLINICA).cita).toBe("La cita");
    expect(seccionesDelPrompt(VOCABULARIO_TURNO).cita).toBe("El turno");
    expect(seccionesDelPrompt().informacion).toBe("Información que puedes dar tal cual");
  });
});

describe("etiquetarActividad", () => {
  const f = frases();

  it("cambia cada línea de la tabla", () => {
    const casos: [string, string][] = [
      ["Estado: Nuevo", "Llegó"],
      ["Estado: En conversación", "Ha contestado"],
      ["Estado: Visita reservada", "Visita reservada"],
      ["Visita reservada: martes 3 nov a las 10:00", "Visita reservada: martes 3 nov a las 10:00"],
      ["Visita cambiada: de martes 3 nov a las 10:00 a miércoles 4 nov a las 17:00", "Visita cambiada: de martes 3 nov a las 10:00 a miércoles 4 nov a las 17:00"],
      ["Visita anulada: martes 3 nov a las 10:00", "Visita anulada: martes 3 nov a las 10:00"],
      ["Pasado a persona: Pide hablar con una persona", "Te toca: Pide hablar con una persona"],
      ["Marcado como spam: Publicidad de SEO", "Es publicidad: Publicidad de SEO"],
      ["Nota interna: Llamar por la tarde", "Nota: Llamar por la tarde"],
      ["Tarea añadida: Mandar el presupuesto", "Pendiente: Mandar el presupuesto"],
      ["Tarea hecha", "Pendiente hecho"],
      ["Tarea reabierta", "Pendiente reabierto"],
      ["Tarea borrada", "Pendiente borrado"],
    ];
    for (const [guardado, pintado] of casos) expect(etiquetarActividad(guardado, f)).toBe(pintado);
  });

  it("sin motivo", () => {
    expect(etiquetarActividad("Pasado a persona", f)).toBe("Te toca");
    expect(etiquetarActividad("Marcado como spam", f)).toBe("Es publicidad");
  });

  it("en «Ficha editada» solo el elemento «presupuesto» pasa a «importe»", () => {
    expect(etiquetarActividad("Ficha editada: nombre, presupuesto, cobrado, presupuesto_cocina", f)).toBe(
      "Ficha editada: nombre, importe, cobrado, presupuesto_cocina",
    );
    expect(etiquetarActividad("Ficha editada: presupuesto", f)).toBe("Ficha editada: importe");
  });

  it("lo que no está en la tabla sale tal cual", () => {
    for (const texto of ["Ha pedido que no le escribamos", "Ha dicho que sí · 5.200 €", "No sigue · Precio", "Lo añadiste tú", "Algo raro", ""]) {
      expect(etiquetarActividad(texto, f)).toBe(texto);
    }
  });

  it("en la clínica, «Cita reservada»", () => {
    const fc = frases(CLINICA);
    expect(etiquetarActividad("Estado: Visita reservada", fc)).toBe("Cita reservada");
    expect(etiquetarActividad("Visita reservada: martes 3 nov a las 10:00", fc)).toBe("Cita reservada: martes 3 nov a las 10:00");
    expect(etiquetarActividad("Visita anulada: martes 3 nov a las 10:00", fc)).toBe("Cita anulada: martes 3 nov a las 10:00");
  });

  it("con un turno, en masculino", () => {
    const ft = frases(VOCABULARIO_TURNO);
    expect(etiquetarActividad("Visita cambiada: de A a B", ft)).toBe("Turno cambiado: de A a B");
    expect(etiquetarActividad("Estado: Visita reservada", ft)).toBe("Turno reservado");
  });
});

describe("campos", () => {
  it("añade la unidad a un número suelto", () => {
    expect(valorCampo("metros", "6", CAMPOS_REFORMAS)).toBe("6 m²");
    expect(valorCampo("metros", " 12,5 ", CAMPOS_REFORMAS)).toBe("12,5 m²");
  });

  it("cambia m2 por m²", () => {
    expect(valorCampo("metros", "60 m2", CAMPOS_REFORMAS)).toBe("60 m²");
    expect(valorCampo("tipo", "cocina de 10 M2", CAMPOS_REFORMAS)).toBe("cocina de 10 m²");
  });

  it("sin campos, la regla de siempre de los metros", () => {
    expect(valorCampo("metros_cuadrados", "80")).toBe("80 m²");
    expect(valorCampo("plazo", "3")).toBe("3");
    expect(valorCampo("superficie", "70 m2")).toBe("70 m²");
  });

  it("etiquetaCampo usa la etiqueta del campo o la clave sin «_»", () => {
    expect(etiquetaCampo("metros", CAMPOS_REFORMAS)).toBe("Metros");
    expect(etiquetaCampo("Primera visita", PRESETS.clinica.campos)).toBe("Primera visita");
    expect(etiquetaCampo("primera_visita", PRESETS.clinica.campos)).toBe("Primera visita");
    expect(etiquetaCampo("forma_de_pago", CAMPOS_REFORMAS)).toBe("forma de pago");
    expect(etiquetaCampo("forma_de_pago")).toBe("forma de pago");
  });

  it("campoPrincipal es el primero con resumen", () => {
    expect(campoPrincipal(CAMPOS_REFORMAS)).toBe("tipo");
    expect(campoPrincipal(PRESETS.clinica.campos)).toBe("tratamiento");
    expect(campoPrincipal([{ clave: "plazo", etiqueta: "Plazo" }])).toBeUndefined();
    expect(campoPrincipal()).toBeUndefined();
  });

  it("normalizarClave", () => {
    expect(normalizarClave("Primera visita")).toBe("primera_visita");
    expect(normalizarClave("  Financiación   y  plazo ")).toBe("financiacion_y_plazo");
  });
});

describe("resumenDatos", () => {
  it("con y sin CAMPOS_REFORMAS da lo mismo, con metros", () => {
    const l = lead({ datos: { tipo: "cocina", metros: "12", plazo: "enero", zona: "Gràcia" } });
    expect(resumenDatos(l)).toBe("Cocina · 12 m² · enero");
    expect(resumenDatos(l, CAMPOS_REFORMAS)).toBe(resumenDatos(l));
  });

  it("con y sin CAMPOS_REFORMAS da lo mismo, sin metros", () => {
    const l = lead({ datos: { tipo: "baño completo", plazo: "en primavera", presupuesto: "unos 60 m2" } });
    expect(resumenDatos(l)).toBe("Baño completo · en primavera · unos 60 m²");
    expect(resumenDatos(l, CAMPOS_REFORMAS)).toBe(resumenDatos(l));
  });

  it("sin datos, según el canal", () => {
    expect(resumenDatos(lead({ origen: "whatsapp" }))).toBe("Escribió por WhatsApp");
    expect(resumenDatos(lead({ origen: "whatsapp", fuente: { tipo: "web" } }))).toBe("Te escribió desde tu web");
    expect(resumenDatos(lead({ origen: "formulario" }))).toBe("Pidió información");
    expect(resumenDatos(lead({ origen: "manual" }))).toBe("Pidió información");
  });
});

describe("nombreDePila", () => {
  it("el primer nombre", () => {
    expect(nombreDePila("Laura Martínez")).toBe("Laura");
    expect(nombreDePila("  Laura G. ")).toBe("Laura");
    expect(nombreDePila("Jordi")).toBe("Jordi");
  });

  it("un teléfono enmascarado o vacío sale tal cual", () => {
    expect(nombreDePila("+34 6•• ••• •••")).toBe("+34 6•• ••• •••");
    expect(nombreDePila("612 345 678")).toBe("612 345 678");
    expect(nombreDePila("")).toBe("");
  });
});

describe("secciones del prompt (lib/guion.ts)", () => {
  const PROMPT = [
    "# Asistente de WhatsApp · Estudio de reformas",
    "",
    "Eres el asistente.",
    "",
    "## Cómo escribes",
    "- Corto.",
    "",
    "## Información que puedes dar tal cual",
    "- La visita es gratis.",
    "",
    "### Horario",
    "De lunes a viernes.",
    "",
    "## Datos que guardas",
    "Guarda lo útil.",
    "",
  ].join("\n");

  it("seccionDe devuelve el cuerpo, con sus subsecciones ###", () => {
    expect(seccionDe(PROMPT, "Información que puedes dar tal cual")).toBe("- La visita es gratis.\n\n### Horario\nDe lunes a viernes.");
    expect(seccionDe(PROMPT, "No existe")).toBe("");
  });

  it("encuentra el título sin mayúsculas ni acentos", () => {
    const texto = PROMPT.replace("## Información que puedes", "## INFORMACION que puedes");
    expect(seccionDe(texto, "Información que puedes dar tal cual")).toBe("- La visita es gratis.\n\n### Horario\nDe lunes a viernes.");
    expect(seccionDe(PROMPT, "datos que guardas")).toBe("Guarda lo útil.");
  });

  it("conSeccion sustituye el cuerpo y deja intacto el resto, H1 incluido", () => {
    const nuevo = conSeccion(PROMPT, "Información que puedes dar tal cual", "- Aparcamiento en la calle.\n\n");
    expect(nuevo).toBe(
      [
        "# Asistente de WhatsApp · Estudio de reformas",
        "",
        "Eres el asistente.",
        "",
        "## Cómo escribes",
        "- Corto.",
        "",
        "## Información que puedes dar tal cual",
        "- Aparcamiento en la calle.",
        "",
        "## Datos que guardas",
        "Guarda lo útil.",
        "",
      ].join("\n"),
    );
  });

  it("conSeccion con el título en mayúsculas lo conserva tal cual", () => {
    const texto = PROMPT.replace("## Información que puedes", "## INFORMACION que puedes");
    const nuevo = conSeccion(texto, "Información que puedes dar tal cual", "- Nada.");
    expect(nuevo).toContain("## INFORMACION que puedes dar tal cual\n- Nada.\n\n## Datos que guardas");
    expect(nuevo.startsWith("# Asistente de WhatsApp · Estudio de reformas\n")).toBe(true);
  });

  it("una sección que falta se añade al final con una línea en blanco", () => {
    const nuevo = conSeccion("# Título\n\n## Cómo escribes\n- Corto.\n\n\n", "Información que puedes dar tal cual", "- Gratis.");
    expect(nuevo).toBe("# Título\n\n## Cómo escribes\n- Corto.\n\n## Información que puedes dar tal cual\n- Gratis.\n");
  });

  it("si la sección es la última, el archivo acaba en un solo salto de línea", () => {
    const nuevo = conSeccion(PROMPT, "Datos que guardas", "Guarda el teléfono.\n\n\n");
    expect(nuevo.endsWith("## Datos que guardas\nGuarda el teléfono.\n")).toBe(true);
    expect(nuevo.endsWith("\n\n")).toBe(false);
  });

  it("sinSeccion quita la sección entera", () => {
    expect(sinSeccion(PROMPT, "Información que puedes dar tal cual")).toBe(
      "# Asistente de WhatsApp · Estudio de reformas\n\nEres el asistente.\n\n## Cómo escribes\n- Corto.\n\n## Datos que guardas\nGuarda lo útil.\n",
    );
    expect(sinSeccion(PROMPT, "datos que guardas")).toBe(
      "# Asistente de WhatsApp · Estudio de reformas\n\nEres el asistente.\n\n## Cómo escribes\n- Corto.\n\n## Información que puedes dar tal cual\n- La visita es gratis.\n\n### Horario\nDe lunes a viernes.\n",
    );
    expect(sinSeccion(PROMPT, "No existe")).toBe(PROMPT);
  });
});
