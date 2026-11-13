import { describe, expect, it } from "vitest";
import { REGLAS_POR_DEFECTO, verHuecos } from "./agenda";
import {
  colorAGuardar,
  conListaPaseSiempre,
  diasASemanas,
  informacionDe,
  listaPaseSiempre,
  muestraActiva,
  semanasADias,
  vistaPreviaHuecos,
} from "./ajustes";
import { FRASES_POR_DEFECTO, type ReglaPase, type ReglasAgente } from "./configuracion";
import { conSeccion } from "./guion";
import type { ReglasAgenda, Reserva } from "./tipos";

const agenteCon = (pasarSiempre: ReglaPase[]): ReglasAgente => ({
  catalogo: "auto",
  negociar: "auto",
  pasarSiempre,
  excepciones: [],
  frases: FRASES_POR_DEFECTO,
  trato: "tu",
});

const URGENCIAS: ReglaPase = { motivo: "Urgencia", frases: ["me duele mucho", "sangra"], respuesta: "Llama al 112." };
const FACTURAS: ReglaPase = { motivo: "Factura", frases: ["factura"] };

describe("listaPaseSiempre", () => {
  it("devuelve las frases de la regla sin motivo", () => {
    expect(listaPaseSiempre(agenteCon([URGENCIAS, { motivo: "", frases: ["abogado", "denuncia"] }, FACTURAS]))).toEqual(["abogado", "denuncia"]);
  });

  it("sin regla sin motivo, una lista vacía", () => {
    expect(listaPaseSiempre(agenteCon([URGENCIAS, FACTURAS]))).toEqual([]);
    expect(listaPaseSiempre(agenteCon([]))).toEqual([]);
  });

  it("junta varias reglas sin motivo, en orden y sin repetir", () => {
    const agente = agenteCon([{ motivo: "", frases: ["abogado", "Denuncia"] }, URGENCIAS, { motivo: "", frases: ["denúncia", "hoja de reclamaciones"] }]);
    expect(listaPaseSiempre(agente)).toEqual(["abogado", "Denuncia", "hoja de reclamaciones"]);
  });
});

describe("conListaPaseSiempre", () => {
  it("sustituye la regla sin motivo en su sitio y deja las demás intactas y en orden", () => {
    const agente = agenteCon([URGENCIAS, { motivo: "", frases: ["abogado"] }, FACTURAS]);
    const reglas = conListaPaseSiempre(agente, ["abogado", "denuncia"]);
    expect(reglas).toEqual([URGENCIAS, { motivo: "", frases: ["abogado", "denuncia"] }, FACTURAS]);
    expect(reglas[0]).toBe(URGENCIAS);
    expect(reglas[2]).toBe(FACTURAS);
  });

  it("la añade al final si no existía", () => {
    expect(conListaPaseSiempre(agenteCon([URGENCIAS, FACTURAS]), ["abogado"])).toEqual([URGENCIAS, FACTURAS, { motivo: "", frases: ["abogado"] }]);
  });

  it("la quita si se queda vacía", () => {
    expect(conListaPaseSiempre(agenteCon([URGENCIAS, { motivo: "", frases: ["abogado"] }, FACTURAS]), [])).toEqual([URGENCIAS, FACTURAS]);
    expect(conListaPaseSiempre(agenteCon([URGENCIAS]), ["  ", ""])).toEqual([URGENCIAS]);
  });

  it("recorta, quita las vacías y las repetidas sin mirar mayúsculas ni acentos", () => {
    expect(conListaPaseSiempre(agenteCon([]), ["  abogado ", "", "Abogado", "denuncia", "DENÚNCIA", "   "])).toEqual([
      { motivo: "", frases: ["abogado", "denuncia"] },
    ]);
  });

  it("conserva la respuesta de la regla sin motivo", () => {
    const agente = agenteCon([{ motivo: "", frases: ["abogado"], respuesta: "Te paso con el equipo." }]);
    expect(conListaPaseSiempre(agente, ["abogado", "juicio"])).toEqual([{ motivo: "", frases: ["abogado", "juicio"], respuesta: "Te paso con el equipo." }]);
  });

  it("varias reglas sin motivo se quedan en una, donde estaba la primera", () => {
    const agente = agenteCon([{ motivo: "", frases: ["abogado"] }, URGENCIAS, { motivo: "", frases: ["juicio"] }]);
    expect(conListaPaseSiempre(agente, listaPaseSiempre(agente))).toEqual([{ motivo: "", frases: ["abogado", "juicio"] }, URGENCIAS]);
  });

  it("no cambia el agente que recibe", () => {
    const agente = agenteCon([URGENCIAS, { motivo: "", frases: ["abogado"] }]);
    const copia = structuredClone(agente);
    conListaPaseSiempre(agente, ["otra cosa"]);
    expect(agente).toEqual(copia);
  });
});

describe("vistaPreviaHuecos", () => {
  // Miércoles 11 de noviembre de 2026, 10:00 en Madrid (09:00 UTC, horario de invierno).
  const AHORA = new Date("2026-11-11T09:00:00Z");
  const reglas = (r: Partial<ReglasAgenda> = {}): ReglasAgenda => ({ ...REGLAS_POR_DEFECTO, horas: [...REGLAS_POR_DEFECTO.horas], diasAbiertos: [...REGLAS_POR_DEFECTO.diasAbiertos], cerrados: [], ...r });

  it("con dos huecos o más, ofrece los dos que daría el asistente", () => {
    const r = reglas();
    const [a, b] = verHuecos([], AHORA, r);
    expect(vistaPreviaHuecos([], AHORA, r)).toBe(`Si alguien pidiera cita ahora, le ofrecería: ${a.texto} o ${b.texto}`);
    expect(vistaPreviaHuecos([], AHORA, r)).toBe("Si alguien pidiera cita ahora, le ofrecería: jueves 12 nov a las 10:00 o viernes 13 nov a las 17:00");
  });

  it("tiene en cuenta lo reservado", () => {
    const r = reglas();
    const reservas: Reserva[] = [{ huecoId: "2026-11-12T10:00", texto: "jueves 12 nov a las 10:00", leadId: "l1", nombre: "Ana", perfilNombre: "Ana" }];
    const [a, b] = verHuecos(reservas, AHORA, r);
    expect(vistaPreviaHuecos(reservas, AHORA, r)).toBe(`Si alguien pidiera cita ahora, le ofrecería: ${a.texto} o ${b.texto}`);
    expect(a.texto).toBe("jueves 12 nov a las 12:30");
  });

  it("con un solo hueco, solo ese", () => {
    const r = reglas({ horas: ["10:00"], diasAbiertos: [4], diasVista: 1 });
    expect(vistaPreviaHuecos([], AHORA, r)).toBe("Si alguien pidiera cita ahora, le ofrecería: jueves 12 nov a las 10:00");
  });

  it("sin huecos libres, lo dice", () => {
    const r = reglas({ horas: ["10:00"], diasAbiertos: [4], diasVista: 1 });
    const reservas: Reserva[] = [{ huecoId: "2026-11-12T10:00", texto: "jueves 12 nov a las 10:00", leadId: "l1", nombre: "Ana", perfilNombre: "Ana" }];
    expect(vistaPreviaHuecos(reservas, AHORA, r)).toBe("Con este horario no hay huecos en las próximas semanas");
    expect(vistaPreviaHuecos([], AHORA, reglas({ diasAbiertos: [] }))).toBe("Con este horario no hay huecos en las próximas semanas");
  });
});

describe("informacionDe", () => {
  const TEXTO = [
    "# Asistente de WhatsApp · Reformas Norte",
    "",
    "## Quién eres",
    "El asistente.",
    "",
    "## Información que puedes dar tal cual",
    "",
    "  Abrimos de 9 a 18.",
    "Reformas desde 6.000 €.  ",
    "",
    "## Cuándo pasar a una persona",
    "Si pide hablar con alguien.",
  ].join("\n");

  it("sin la sección, cadena vacía", () => {
    expect(informacionDe("# Asistente de WhatsApp · Reformas Norte\n\n## Quién eres\nEl asistente.")).toBe("");
    expect(informacionDe("")).toBe("");
  });

  it("devuelve el cuerpo recortado y se para en el siguiente ## ", () => {
    expect(informacionDe(TEXTO)).toBe("Abrimos de 9 a 18.\nReformas desde 6.000 €.");
  });

  it("encuentra el título con otras mayúsculas y sin acentos", () => {
    expect(informacionDe("# A\n\n## INFORMACION que puedes DAR tal cual\nHola\n")).toBe("Hola");
  });

  it("hasta el final cuando es la última sección", () => {
    expect(informacionDe("# A\n\n## Información que puedes dar tal cual\nUno\nDos\n")).toBe("Uno\nDos");
  });

  it("ida y vuelta con conSeccion", () => {
    expect(informacionDe(conSeccion(TEXTO, "Información que puedes dar tal cual", "X"))).toBe("X");
    const sinSeccion = "# Asistente de WhatsApp · Reformas Norte\n\n## Quién eres\nEl asistente.\n";
    expect(informacionDe(conSeccion(sinSeccion, "Información que puedes dar tal cual", "Precios: desde 50 €"))).toBe("Precios: desde 50 €");
  });
});

describe("semanas y días", () => {
  it("12 semanas de 5 días son 60 días", () => {
    expect(semanasADias(12, [1, 2, 3, 4, 5])).toBe(60);
    expect(diasASemanas(60, [1, 2, 3, 4, 5])).toBe(12);
  });

  it("se queda entre 1 y 365 días", () => {
    expect(semanasADias(52, [0, 1, 2, 3, 4, 5, 6])).toBe(364);
    expect(semanasADias(60, [0, 1, 2, 3, 4, 5, 6])).toBe(365);
    expect(semanasADias(0, [1, 2, 3])).toBe(1);
  });

  it("como mínimo una semana", () => {
    expect(diasASemanas(1, [1, 2, 3, 4, 5])).toBe(1);
    expect(diasASemanas(2, [1, 2, 3, 4, 5])).toBe(1);
    expect(diasASemanas(8, [1, 2, 3, 4, 5])).toBe(2);
  });
});

describe("colores", () => {
  it("«Clásico» se guarda como el verde, explícito", () => {
    expect(colorAGuardar(null)).toBe("#2f9e6e");
    expect(colorAGuardar("#2b7bb9")).toBe("#2b7bb9");
  });

  it("null y el verde clásico son la muestra «Clásico»", () => {
    expect(muestraActiva(null)).toBeNull();
    expect(muestraActiva("#2f9e6e")).toBeNull();
    expect(muestraActiva("#2F9E6E")).toBeNull();
    expect(muestraActiva("#c2562d")).toBe("#c2562d");
  });
});
