import { describe, expect, it } from "vitest";
import type { EstadoLlegada, EventoPanel } from "./api-tipos";
import { aplicarEventoLlegada, cerrarConLeads } from "./llegadas";
import { crearLead } from "./negocio";
import type { Lead } from "./tipos";

const ID = "34612345678:estudio-de-reformas";

function llegada(canal: "formulario" | "whatsapp" | "manual" = "formulario", inicio = 1_000_000, leadId = ID): EventoPanel {
  return { tipo: "llegada", llegada: { leadId, nombre: "Laura", canal, inicio } };
}

function fallida(leadId = ID): EventoPanel {
  return { tipo: "llegada-fallida", fallo: { leadId, nombre: "Laura", codigo: "meta.bienvenida", texto: "Meta aún no ha aprobado tu mensaje de bienvenida" } };
}

function lead(p: Partial<Lead> = {}): Lead {
  return crearLead({ telefono: "34612345678", perfilId: "estudio-de-reformas", perfilNombre: "Estudio", nombre: "Laura", origen: "formulario", ...p });
}

function congelar<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) congelar(v);
    Object.freeze(x);
  }
  return x;
}

describe("aplicarEventoLlegada", () => {
  it("una llegada crea una entrada en directo, en marcha, con el inicio en el reloj del navegador", () => {
    const antes = congelar({});
    const estado = aplicarEventoLlegada(antes, llegada("formulario", 1_000_000), 250);
    expect(estado[ID]).toEqual({ leadId: ID, nombre: "Laura", canal: "formulario", inicio: 999_750, fin: null, fallo: null, enDirecto: true });
    expect(antes).toEqual({});
  });

  it("un desfase negativo (el servidor va por detrás) suma", () => {
    const estado = aplicarEventoLlegada({}, llegada("whatsapp", 5_000), -1_500);
    expect(estado[ID].inicio).toBe(6_500);
    expect(estado[ID].canal).toBe("whatsapp");
  });

  it("una segunda llegada del mismo lead sustituye a la anterior, aunque estuviera acabada o fallida", () => {
    const vieja: Record<string, EstadoLlegada> = congelar({
      [ID]: { leadId: ID, nombre: "Laura", canal: "formulario", inicio: 1, fin: 2, fallo: { codigo: "meta.otro", texto: "x" }, enDirecto: false },
    });
    const estado = aplicarEventoLlegada(vieja, llegada("manual", 9_000), 0);
    expect(estado[ID]).toEqual({ leadId: ID, nombre: "Laura", canal: "manual", inicio: 9_000, fin: null, fallo: null, enDirecto: true });
    expect(vieja[ID].fin).toBe(2);
  });

  it("no toca las llegadas de otros leads", () => {
    const otra = aplicarEventoLlegada({}, llegada("formulario", 1, "otro"), 0);
    const estado = aplicarEventoLlegada(congelar(otra), llegada(), 0);
    expect(Object.keys(estado).sort()).toEqual([ID, "otro"].sort());
    expect(estado.otro).toBe(otra.otro);
  });

  it("un fallo con entrada previa la conserva y le añade el fallo, sin tocar el fin", () => {
    const previa = congelar(aplicarEventoLlegada({}, llegada("formulario", 4_000), 0));
    const estado = aplicarEventoLlegada(previa, fallida(), 0);
    expect(estado[ID]).toEqual({
      leadId: ID,
      nombre: "Laura",
      canal: "formulario",
      inicio: 4_000,
      fin: null,
      fallo: { codigo: "meta.bienvenida", texto: "Meta aún no ha aprobado tu mensaje de bienvenida" },
      enDirecto: true,
    });
    expect(previa[ID].fallo).toBeNull();
  });

  it("un fallo sin entrada previa crea una entrada parada", () => {
    const estado = aplicarEventoLlegada(congelar({}), fallida(), 300);
    expect(estado[ID]).toEqual({
      leadId: ID,
      nombre: "Laura",
      canal: "formulario",
      inicio: 0,
      fin: null,
      fallo: { codigo: "meta.bienvenida", texto: "Meta aún no ha aprobado tu mensaje de bienvenida" },
      enDirecto: false,
    });
  });

  it("cambio y hora devuelven el mismo objeto", () => {
    const estado = aplicarEventoLlegada({}, llegada(), 0);
    expect(aplicarEventoLlegada(estado, { tipo: "cambio", cambio: { tipo: "leads", rev: 3 } }, 0)).toBe(estado);
    expect(aplicarEventoLlegada(estado, { tipo: "hora", desfaseMs: 120 }, 120)).toBe(estado);
  });
});

describe("cerrarConLeads", () => {
  it("cierra una llegada del formulario con msPrimerWhatsApp", () => {
    const estado = congelar(aplicarEventoLlegada({}, llegada("formulario", 10_000), 0));
    const leads = congelar({ [ID]: lead({ msPrimerWhatsApp: 1_600 }) });
    const cerrado = cerrarConLeads(estado, leads);
    expect(cerrado[ID].fin).toBe(11_600);
    expect(cerrado[ID].enDirecto).toBe(true);
    expect(estado[ID].fin).toBeNull();
  });

  it("cierra una llegada a mano con msPrimerWhatsApp", () => {
    const estado = aplicarEventoLlegada({}, llegada("manual", 10_000), 0);
    expect(cerrarConLeads(estado, { [ID]: lead({ origen: "manual", msPrimerWhatsApp: 900 }) })[ID].fin).toBe(10_900);
  });

  it("cierra una llegada de WhatsApp con msPrimeraRespuesta, no con msPrimerWhatsApp", () => {
    const estado = aplicarEventoLlegada({}, llegada("whatsapp", 10_000), 0);
    expect(cerrarConLeads(estado, { [ID]: lead({ origen: "whatsapp", msPrimerWhatsApp: 500 }) })).toBe(estado);
    expect(cerrarConLeads(estado, { [ID]: lead({ origen: "whatsapp", msPrimeraRespuesta: 6_200 }) })[ID].fin).toBe(16_200);
  });

  it("sin la medida, o sin el lead, devuelve el mismo objeto", () => {
    const estado = aplicarEventoLlegada({}, llegada("formulario", 10_000), 0);
    expect(cerrarConLeads(estado, { [ID]: lead() })).toBe(estado);
    expect(cerrarConLeads(estado, {})).toBe(estado);
  });

  it("no toca las llegadas fallidas ni las ya acabadas", () => {
    const fallo = aplicarEventoLlegada(aplicarEventoLlegada({}, llegada(), 0), fallida(), 0);
    expect(cerrarConLeads(fallo, { [ID]: lead({ msPrimerWhatsApp: 1_000 }) })).toBe(fallo);
    const acabada = cerrarConLeads(aplicarEventoLlegada({}, llegada("formulario", 10_000), 0), { [ID]: lead({ msPrimerWhatsApp: 1_000 }) });
    expect(acabada[ID].fin).toBe(11_000);
    expect(cerrarConLeads(acabada, { [ID]: lead({ msPrimerWhatsApp: 5_000 }) })).toBe(acabada);
  });

  it("solo cambia las entradas que se cierran", () => {
    const dos = aplicarEventoLlegada(aplicarEventoLlegada({}, llegada("formulario", 1_000), 0), llegada("formulario", 2_000, "otro"), 0);
    const cerrado = cerrarConLeads(congelar(dos), { [ID]: lead({ msPrimerWhatsApp: 300 }) });
    expect(cerrado[ID].fin).toBe(1_300);
    expect(cerrado.otro).toBe(dos.otro);
  });
});
