import { describe, expect, it } from "vitest";
import { celda, csvDeLeads } from "./exportar";
import { crearLead } from "./negocio";
import { PRESET_CLINICA } from "./presets/clinica";
import { simboloMoneda, MONEDAS } from "./regional";
import type { Lead } from "./tipos";
import { frases } from "./vocabulario";

describe("celda", () => {
  it("entrecomilla lo que lleva punto y coma, comillas o saltos de línea", () => {
    expect(celda("Cocina")).toBe("Cocina");
    expect(celda("Baño; sin ventana")).toBe('"Baño; sin ventana"');
    expect(celda('Dijo "sí"')).toBe('"Dijo ""sí"""');
    expect(celda("uno\ndos")).toBe('"uno\ndos"');
    expect(celda(undefined)).toBe("");
    expect(celda(6400)).toBe("6400");
  });
});

function cabeceraDe(csv: string): string[] {
  return csv.split("\r\n")[0].replace(/^﻿/, "").split(";");
}

function filaDe(csv: string, n = 1): string[] {
  return csv.split("\r\n")[n].split(";");
}

describe("csvDeLeads", () => {
  const lead = crearLead({
    telefono: "34612345678",
    perfilId: "p",
    perfilNombre: "Estudio",
    nombre: "Laura",
    origen: "whatsapp",
    estado: "conversacion",
    datos: { tipo: "Cocina" },
    presupuesto: 6400,
    cobrado: 1000,
    notas: [{ id: "n1", texto: "Pide dos plazos", ts: 1 }],
    tareas: [
      { id: "t1", texto: "Mandar opciones", hecha: false, ts: 1 },
      { id: "t2", texto: "Ya hecha", hecha: true, ts: 2 },
    ],
  });

  const con = (p: Partial<Lead>): Lead => ({ ...lead, ...p });

  it("empieza con BOM y cabecera, y separa con punto y coma", () => {
    const csv = csvDeLeads([lead]);
    expect(csv.startsWith("﻿Creado;Nombre;Teléfono;")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("cuenta solo las tareas abiertas y saca el teléfono con +", () => {
    const fila = filaDe(csvDeLeads([lead]));
    expect(fila[1]).toBe("Laura");
    expect(fila[2]).toBe("+34612345678");
    expect(fila[5]).toBe("Con tu asistente");
    expect(fila[8]).toBe("6400");
    expect(fila[9]).toBe("1000");
    expect(fila[11]).toBe("1");
    expect(fila[12]).toBe("Pide dos plazos");
    expect(fila[14]).toBe("");
    expect(fila).toHaveLength(18);
  });

  it("la cabecera tiene 18 columnas: las 15 de siempre y Resultado, Importe final y Motivo al final", () => {
    const cabecera = cabeceraDe(csvDeLeads([]));
    expect(cabecera).toHaveLength(18);
    expect(cabecera[14]).toBe("Etiquetas");
    expect(cabecera.slice(15)).toEqual(["Resultado", "Importe final", "Motivo"]);
  });

  it("sin opciones, la cabecera es la de reformas en euros", () => {
    expect(cabeceraDe(csvDeLeads([]))).toEqual([
      "Creado", "Nombre", "Teléfono", "Perfil", "Llegó por", "Etapa", "Zona", "Email", "Importe (€)", "Cobrado (€)",
      "Visita", "Pendientes", "Notas", "Datos", "Etiquetas", "Resultado", "Importe final", "Motivo",
    ]);
  });

  it("con el vocabulario de la clínica: «Cita» en la columna 10, «Zona» en la 6 y «Con cita»", () => {
    const csv = csvDeLeads([con({ estado: "visita" })], { vocabulario: PRESET_CLINICA.vocabulario });
    const cabecera = cabeceraDe(csv);
    expect(PRESET_CLINICA.vocabulario.zona).toBeNull();
    expect(cabecera[6]).toBe("Zona");
    expect(cabecera[10]).toBe("Cita");
    expect(filaDe(csv)[5]).toBe("Con cita");
  });

  it("el símbolo de la moneda va en Importe y Cobrado (MXN)", () => {
    const cabecera = cabeceraDe(csvDeLeads([], { moneda: "MXN" }));
    const f = frases(undefined, { simbolo: simboloMoneda("MXN"), nombre: MONEDAS.MXN.nombre });
    expect(cabecera[8]).toBe(f.importeConSimbolo);
    expect(cabecera[9]).toBe(f.cobradoConSimbolo);
    expect(cabecera[8]).not.toBe("Importe (€)");
  });

  it("«Llegó por» dice de dónde vino con palabras", () => {
    const csv = csvDeLeads([
      con({ id: "a", origen: "formulario", creadoEn: 1 }),
      con({ id: "b", origen: "whatsapp", creadoEn: 2 }),
      con({ id: "c", origen: "manual", creadoEn: 3 }),
      con({ id: "d", origen: "prueba", creadoEn: 4 }),
      con({ id: "e", origen: "whatsapp", fuente: { tipo: "web" }, creadoEn: 5 }),
    ]);
    expect([1, 2, 3, 4, 5].map((n) => filaDe(csv, n)[4])).toEqual(["Tu web", "WhatsApp", "Añadido a mano", "Ejemplo", "Tu web, por WhatsApp"]);
  });

  it("las columnas del cierre: sí con su importe, no con su motivo, y vacías sin cierre", () => {
    const csv = csvDeLeads([
      con({ id: "si", creadoEn: 1, cierre: "si", cierreEn: 5, presupuesto: 7200 }),
      con({ id: "no", creadoEn: 2, cierre: "no", cierreEn: 5, motivoCierre: "Precio" }),
      con({ id: "nada", creadoEn: 3 }),
    ]);
    expect(filaDe(csv, 1).slice(15)).toEqual(["Ha dicho que sí", "7200", ""]);
    expect(filaDe(csv, 2).slice(15)).toEqual(["No sigue", "", "Precio"]);
    expect(filaDe(csv, 3).slice(15)).toEqual(["", "", ""]);
  });

  it("a quien no quiere mensajes se le añade a la etapa", () => {
    expect(filaDe(csvDeLeads([con({ silenciadoEn: 10 })]))[5]).toBe("Con tu asistente · no quiere mensajes");
  });

  it("un ejemplo no enseña teléfono", () => {
    expect(filaDe(csvDeLeads([con({ ejemplo: true })]))[2]).toBe("(ejemplo)");
    expect(filaDe(csvDeLeads([con({ origen: "prueba" })]))[2]).toBe("(ejemplo)");
  });

  it("la fecha va en la zona del negocio (Ciudad de México, cerca de medianoche)", () => {
    const creadoEn = Date.parse("2026-11-12T05:30:00Z"); // 23:30 del 11 en México; 06:30 del 12 en Madrid
    const csv = csvDeLeads([con({ creadoEn })], { zona: "America/Mexico_City" });
    expect(filaDe(csv)[0]).toMatch(/^11\/11\/2026,? 23:30$/);
    expect(filaDe(csvDeLeads([con({ creadoEn })]))[0]).toMatch(/^12\/11\/2026,? 06:30$/);
  });
});
