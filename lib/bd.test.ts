import { beforeEach, describe, expect, it } from "vitest";
import {
  contarLeads,
  editarProyecto,
  guardarAjustes,
  guardarMutaciones,
  leerBd,
  leerLead,
  leerReservas,
  mensajesDeClientesDesde,
  registrarMensaje,
  reiniciarBd,
} from "./bd";
import { crearLead, esEjemplo, textoHueco } from "./negocio";
import { crearSemilla } from "./semilla";
import type { Mensaje, Reserva } from "./tipos";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import {
  actualizarEntregas,
  borrarEjemplos,
  contarEjemplos,
  datosDeCliente,
  guardarCopiaInstrucciones,
  guardarLogo,
  hayMensajeRealDeCliente,
  leerConfiguracionGuardada,
  leerCopiasInstrucciones,
  leerLogo,
  modificarConfiguracionGuardada,
  restablecerConfiguracion,
  sustituirEjemplos,
} from "./bd";
import type { ConfiguracionGuardada, CopiaInstrucciones } from "./configuracion";
import { normalizarGuardada } from "./configuracion";
import type { Conexion } from "./conexion";
import { escucharCambios } from "./eventos";
import { formatoImporte, verHuecos } from "./negocio";
import { OPCIONES_POR_DEFECTO } from "./semilla";
import type { OpcionesSemilla, SemillaGenerada } from "./semillas/tipos";
import type { Lead } from "./tipos";

// Los ejemplos de W3 cambian de tamaño: las pruebas comparan con crearSemilla, nunca con números fijos.
// Para probar que la inserción por tablas guarda cada columna, crearSemilla devuelve a mano un
// conjunto fijo solo mientras `fijo.semilla` tenga uno.
const fijo = vi.hoisted(() => ({ semilla: null as SemillaGenerada | null }));
vi.mock("./semilla", async (importOriginal) => {
  const real = await importOriginal<typeof import("./semilla")>();
  return { ...real, crearSemilla: (...args: Parameters<typeof real.crearSemilla>) => fijo.semilla ?? real.crearSemilla(...args) };
});

async function crudo(): Promise<Conexion> {
  await contarLeads(); // abre la conexión de lib/bd.ts si aún no está abierta
  return (globalThis as unknown as { __bd: Promise<Conexion> }).__bd;
}

const base = crearLead({
  telefono: "34612345678",
  perfilId: "p",
  perfilNombre: "P",
  nombre: "Ana",
  origen: "whatsapp",
  creadoEn: 1,
});
const mensaje: Mensaje = { id: "w1", de: "cliente", texto: "hola", ts: 2 };
const h1 = { id: "2026-11-03T10:00", texto: textoHueco("2026-11-03T10:00") };
const h2 = { id: "2026-11-04T17:00", texto: textoHueco("2026-11-04T17:00") };

function reserva(huecoId: string, leadId = base.id): Reserva {
  return { huecoId, texto: textoHueco(huecoId), leadId, nombre: "Ana", perfilNombre: "P" };
}

beforeEach(async () => {
  await guardarAjustes({ leadsPrueba: false });
  await reiniciarBd();
  await restablecerConfiguracion();
});

describe("leads", () => {
  it("guarda y devuelve el lead tal cual", async () => {
    const lead = crearLead({
      telefono: "34612345678",
      perfilId: "p",
      perfilNombre: "P",
      nombre: "Ana",
      email: "ana@ejemplo.es",
      zona: "Eixample",
      origen: "formulario",
      creadoEn: 1,
      msPrimerWhatsApp: 850,
      datos: { tipo: "Baño" },
      huecosOfrecidos: [h1],
      mensajes: [{ id: "p1", de: "agente", texto: "Hola Ana", ts: 1, plantilla: true }],
    });
    await guardarMutaciones([{ t: "lead", lead }]);
    expect(await leerLead(lead.id)).toEqual(lead);
    expect((await leerBd()).leads[lead.id]).toEqual(lead);
  });

  it("un lead de whatsapp no pisa al existente; uno de formulario empieza de cero", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "mensaje", leadId: base.id, mensaje },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
    ]);
    await guardarMutaciones([{ t: "lead", lead: base }]);
    expect((await leerLead(base.id))?.mensajes).toHaveLength(1);

    await guardarMutaciones([{ t: "lead", lead: { ...base, origen: "formulario" } }]);
    expect((await leerLead(base.id))?.mensajes).toHaveLength(0);
    expect(await leerReservas()).toHaveLength(0);
  });
});

describe("mutaciones", () => {
  it("son idempotentes: repetir un lote no duplica nada", async () => {
    const mutaciones = [
      { t: "lead" as const, lead: base },
      { t: "mensaje" as const, leadId: base.id, mensaje },
      { t: "estado" as const, leadId: base.id, estado: "visita" as const, ts: 3 },
      { t: "reserva" as const, reserva: reserva(h1.id), hueco: h1, ts: 3 },
    ];
    await guardarMutaciones(mutaciones);
    const una = await leerBd();
    await guardarMutaciones(mutaciones);
    expect(await leerBd()).toEqual(una);
    expect((await leerLead(base.id))?.mensajes).toHaveLength(1);
    expect(await leerReservas()).toHaveLength(1);
  });

  it("los mensajes van en el orden en que entraron, aunque la hora de Meta sea anterior", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "mensaje", leadId: base.id, mensaje: { id: "a", de: "agente", texto: "respuesta", ts: 5_500 } },
      { t: "mensaje", leadId: base.id, mensaje: { id: "c", de: "cliente", texto: "siguiente", ts: 5_000 } },
    ]);
    expect((await leerLead(base.id))?.mensajes.map((m) => m.id)).toEqual(["a", "c"]);
    expect((await leerBd()).leads[base.id].mensajes.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("guarda los datos sueltos, también con nombres raros", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "dato", leadId: base.id, campo: "tipo", valor: "Baño", ts: 3 },
      { t: "dato", leadId: base.id, campo: "piso de 'interés'", valor: "Mallorca", ts: 4 },
      { t: "dato", leadId: base.id, campo: "tipo", valor: "Cocina", ts: 5 },
    ]);
    const lead = await leerLead(base.id);
    expect(lead?.datos).toEqual({ tipo: "Cocina", "piso de 'interés'": "Mallorca" });
    expect(lead?.actualizadoEn).toBe(5);
  });

  it("guarda los huecos ofrecidos", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "huecos", leadId: base.id, huecos: [h1, h2] },
    ]);
    expect((await leerLead(base.id))?.huecosOfrecidos).toEqual([h1, h2]);
  });

  it("solo actualiza la columna si el estado cambia", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "estado", leadId: base.id, estado: "conversacion", ts: 5 },
      { t: "estado", leadId: base.id, estado: "conversacion", ts: 9 },
    ]);
    expect((await leerLead(base.id))?.cambioEstadoEn).toBe(5);
  });

  it("guarda el motivo al pasar a una persona", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "estado", leadId: base.id, estado: "persona", ts: 5, motivo: "Pide una rebaja" },
    ]);
    const lead = await leerLead(base.id);
    expect(lead?.estado).toBe("persona");
    expect(lead?.motivoPersona).toBe("Pide una rebaja");
  });

  it("pasar a persona es definitivo: lo que decida el asistente después no lo saca de ahí", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "estado", leadId: base.id, estado: "persona", ts: 5, motivo: "Lo ha cogido el equipo desde el panel" },
      { t: "estado", leadId: base.id, estado: "visita", ts: 6 },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 6 },
      { t: "estado", leadId: base.id, estado: "conversacion", ts: 7 },
    ]);
    const lead = await leerLead(base.id);
    expect(lead?.estado).toBe("persona");
    expect(lead?.cambioEstadoEn).toBe(5);
    // La visita sí queda: si el cliente ya la tenía confirmada, sigue en la agenda.
    expect(lead?.visita).toEqual(h1);
  });

  it("lo que llega tarde tras reiniciar no se aplica", async () => {
    await guardarMutaciones([
      { t: "mensaje", leadId: base.id, mensaje },
      { t: "dato", leadId: base.id, campo: "tipo", valor: "Baño", ts: 3 },
      { t: "estado", leadId: base.id, estado: "visita", ts: 3 },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
    ]);
    expect(await contarLeads()).toBe(0);
    expect(await leerReservas()).toHaveLength(0);
  });

  it("si algo falla, no se guarda nada de ese lote", async () => {
    const otro = crearLead({ telefono: "34699999999", perfilId: "p", perfilNombre: "P", nombre: "Otro", origen: "whatsapp" });
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "lead", lead: otro },
      { t: "reserva", reserva: reserva(h1.id, otro.id), hueco: h1, ts: 3 },
    ]);
    await expect(
      guardarMutaciones([
        { t: "mensaje", leadId: base.id, mensaje },
        { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 4 },
      ]),
    ).rejects.toThrow();
    expect((await leerLead(base.id))?.mensajes).toHaveLength(0);
    expect((await leerLead(base.id))?.visita).toBeUndefined();
  });
});

describe("ficha editada a mano", () => {
  it("cambia solo lo que trae, y el nombre también en la agenda", async () => {
    await guardarMutaciones([
      { t: "lead", lead: { ...base, email: "ana@ejemplo.es", datos: { tipo: "Baño", metros: "5 m²" } } },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
      { t: "ficha", leadId: base.id, cambios: { nombre: "Ana García", email: null, zona: "Gràcia", datos: { tipo: "Cocina", metros: null, plazo: "Enero" } } },
    ]);
    const lead = await leerLead(base.id);
    expect(lead?.nombre).toBe("Ana García");
    expect(lead?.email).toBeUndefined();
    expect(lead?.zona).toBe("Gràcia");
    expect(lead?.datos).toEqual({ tipo: "Cocina", plazo: "Enero" });
    // No es actividad del cliente: no cambia la hora ni la columna.
    expect(lead?.actualizadoEn).toBe(3);
    expect(lead?.cambioEstadoEn).toBe(base.cambioEstadoEn);
    expect((await leerReservas())[0].nombre).toBe("Ana García");
  });

  it("no pisa un dato que el asistente guarde en el mismo momento", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await Promise.all([
      guardarMutaciones([{ t: "ficha", leadId: base.id, cambios: { datos: { zona_preferida: "Sants" } } }]),
      guardarMutaciones([{ t: "dato", leadId: base.id, campo: "tipo", valor: "Baño", ts: 4 }]),
    ]);
    expect((await leerLead(base.id))?.datos).toEqual({ zona_preferida: "Sants", tipo: "Baño" });
  });
});

describe("visitas", () => {
  it("cambiar de visita libera el hueco anterior", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
      { t: "reserva", reserva: reserva(h2.id), hueco: h2, ts: 4 },
    ]);
    expect((await leerReservas()).map((r) => r.huecoId)).toEqual([h2.id]);
    expect((await leerLead(base.id))?.visita).toEqual(h2);
  });
});

// Las citas a mano de la ficha (/api/cita) componen las mutaciones de siempre en una sola llamada.
describe("citas a mano", () => {
  it("una cita a mano a un cliente de «Te toca» lo deja en «Con visita»", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "mensaje", leadId: base.id, mensaje }]);
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 4, a: "persona" }]);
    await guardarMutaciones([
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 5 },
      { t: "etapa", leadId: base.id, ts: 5, a: "asistente" },
    ]);
    const lead = await leerLead(base.id);
    expect(lead).toMatchObject({ estado: "visita", visita: h1, cambioEstadoEn: 5 });
    expect(lead?.motivoPersona).toBeUndefined();
    expect(await historial()).toEqual(["Pasado a persona: Lo llevas tú desde el panel", "Devuelto a tu asistente", `Visita reservada: ${h1.texto}`]);
  });

  it("anular deja el hueco libre y vuelve a conversación o a nuevo", async () => {
    await conVisita();
    await guardarMutaciones([
      { t: "cancelar", leadId: base.id, ts: 5 },
      { t: "estado", leadId: base.id, estado: "conversacion", ts: 5 },
    ]);
    expect(await leerReservas()).toEqual([]);
    expect(await leerLead(base.id)).toMatchObject({ estado: "conversacion", cambioEstadoEn: 5 });
    expect((await leerLead(base.id))?.visita).toBeUndefined();
    expect((await historial()).slice(-2)).toEqual([`Visita anulada: ${h1.texto}`, "Estado: En conversación"]);

    // Un cliente añadido a mano que nunca ha escrito vuelve a «nuevo».
    const otro = crearLead({ telefono: "34699999999", perfilId: "p", perfilNombre: "P", nombre: "Otro", origen: "manual" });
    await guardarMutaciones([
      { t: "lead", lead: otro },
      { t: "reserva", reserva: reserva(h2.id, otro.id), hueco: h2, ts: 6 },
      { t: "estado", leadId: otro.id, estado: "visita", ts: 6 },
    ]);
    expect((await leerLead(otro.id))?.estado).toBe("visita");
    await guardarMutaciones([
      { t: "cancelar", leadId: otro.id, ts: 7 },
      { t: "estado", leadId: otro.id, estado: "nuevo", ts: 7 },
    ]);
    expect(await leerReservas()).toEqual([]);
    expect(await leerLead(otro.id)).toMatchObject({ estado: "nuevo", cambioEstadoEn: 7 });
    // Misma hora: van por id (estado, reserva; anulada, estado).
    expect(await historial(otro.id)).toEqual(["Estado: Visita reservada", `Visita reservada: ${h2.texto}`, `Visita anulada: ${h2.texto}`, "Estado: Nuevo"]);
  });

  it("un hueco de otro cliente hace fallar la transacción entera", async () => {
    const otro = crearLead({ telefono: "34699999999", perfilId: "p", perfilNombre: "P", nombre: "Otro", origen: "whatsapp" });
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "mensaje", leadId: base.id, mensaje },
      { t: "lead", lead: otro },
      { t: "reserva", reserva: reserva(h1.id, otro.id), hueco: h1, ts: 3 },
    ]);
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 4, a: "persona" }]);
    const fallo = await guardarMutaciones([
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 5 },
      { t: "etapa", leadId: base.id, ts: 5, a: "asistente" },
    ]).catch((e: unknown) => e);
    // La ruta reconoce la clave repetida por el código de Postgres.
    expect((fallo as { code?: string })?.code).toBe("23505");
    const lead = await leerLead(base.id);
    expect(lead).toMatchObject({ estado: "persona", cambioEstadoEn: 4 });
    expect(lead?.visita).toBeUndefined();
    expect(await historial()).toEqual(["Pasado a persona: Lo llevas tú desde el panel"]);
    expect(await leerReservas()).toEqual([expect.objectContaining({ huecoId: h1.id, leadId: otro.id })]);
  });

  it("cambiar escribe «Visita cambiada: de … a …»", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "reserva", reserva: reserva(h2.id), hueco: h2, ts: 5 }]);
    expect((await leerLead(base.id))?.visita).toEqual(h2);
    expect((await leerReservas()).map((r) => r.huecoId)).toEqual([h2.id]);
    expect((await historial()).at(-1)).toBe(`Visita cambiada: de ${h1.texto} a ${h2.texto}`);
  });
});

describe("anular y spam", () => {
  it("anular la visita la quita de la agenda", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
      { t: "cancelar", leadId: base.id, ts: 4 },
    ]);
    expect(await leerReservas()).toHaveLength(0);
    expect((await leerLead(base.id))?.visita).toBeUndefined();
  });

  it("el motivo del spam va aparte del de pasar a persona", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "estado", leadId: base.id, estado: "spam", ts: 5, motivo: "Mensaje masivo" },
    ]);
    const lead = await leerLead(base.id);
    expect(lead?.estado).toBe("spam");
    expect(lead?.motivoSpam).toBe("Mensaje masivo");
    expect(lead?.motivoPersona).toBeUndefined();
  });

  it("guarda que un mensaje era una nota de voz", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "mensaje", leadId: base.id, mensaje: { id: "v1", de: "cliente", texto: "Para vivir", ts: 3, audio: true } },
    ]);
    expect((await leerLead(base.id))?.mensajes[0]).toEqual({ id: "v1", de: "cliente", texto: "Para vivir", ts: 3, audio: true });
    expect(await mensajesDeClientesDesde(0)).toEqual([{ telefono: base.telefono, texto: "Para vivir", ts: 3 }]);
  });

  it("guarda que un mensaje lo ha escrito el equipo a mano", async () => {
    const manual: Mensaje = { id: "m1", de: "agente", texto: "Hola, soy Marta", ts: 4, manual: true };
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "mensaje", leadId: base.id, mensaje },
      { t: "mensaje", leadId: base.id, mensaje: manual },
    ]);
    expect((await leerLead(base.id))?.mensajes).toEqual([mensaje, manual]);
  });
});

describe("mensajes ya procesados", () => {
  it("el mismo id de Meta solo pasa una vez", async () => {
    expect(await registrarMensaje("w1")).toBe(true);
    expect(await registrarMensaje("w1")).toBe(false);
    expect(await registrarMensaje("w2")).toBe(true);
  });
});

describe("reiniciar", () => {
  it("con el ajuste apagado queda vacío", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
    ]);
    await registrarMensaje("w1");
    await reiniciarBd();
    const bd = await leerBd();
    expect(bd.leads).toEqual({});
    expect(bd.reservas).toEqual([]);
    expect(await registrarMensaje("w1")).toBe(true);
  });

  it("con el ajuste encendido recarga los leads de ejemplo, que ocupan su hueco", async () => {
    await guardarAjustes({ leadsPrueba: true });
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await reiniciarBd();
    const bd = await leerBd();
    expect(bd.ajustes.leadsPrueba).toBe(true);
    const semilla = crearSemilla("Estudio", new Date());
    expect(Object.values(bd.leads).every((l) => esEjemplo(l))).toBe(true);
    expect(Object.keys(bd.leads)).toHaveLength(Object.keys(semilla.leads).length);
    expect(bd.reservas).toHaveLength(semilla.reservas.length);
    expect(bd.reservas.every((r) => r.prueba)).toBe(true);
    const conVisita = Object.values(bd.leads).filter((l) => l.visita);
    expect(conVisita.map((l) => l.visita?.id).sort()).toEqual(bd.reservas.map((r) => r.huecoId).sort());
  });
});

describe("actividad", () => {
  it("anota en la ficha lo que pasa con el lead, en orden", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await guardarMutaciones([{ t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 5 }]);
    await guardarMutaciones([{ t: "ficha", leadId: base.id, cambios: { etiquetas: ["cocina"], presupuesto: 6400 } }]);
    await guardarMutaciones([{ t: "nota", leadId: base.id, nota: { id: "n1", texto: "Quiere dos plazos", ts: 9 } }]);
    await guardarMutaciones([{ t: "estado", leadId: base.id, estado: "persona", ts: 12, motivo: "Quiere llamada" }]);
    const textos = (await leerLead(base.id))?.actividad?.map((a) => a.texto) ?? [];
    // La ficha se anota con la hora real del cambio, así que va la última.
    expect(textos).toEqual([
      `Visita reservada: ${h1.texto}`,
      "Nota interna: Quiere dos plazos",
      "Pasado a persona: Quiere llamada",
      "Ficha editada: presupuesto, etiquetas",
    ]);
  });

  it("repetir un aviso del asistente no duplica la línea de tiempo", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    const aviso = { t: "estado" as const, leadId: base.id, estado: "spam" as const, ts: 7, motivo: "Publicidad" };
    await guardarMutaciones([aviso]);
    await guardarMutaciones([aviso]);
    expect((await leerLead(base.id))?.actividad?.map((a) => a.texto)).toEqual(["Marcado como spam: Publicidad"]);
  });

  it("las etiquetas se guardan y vuelven al leer", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await guardarMutaciones([{ t: "ficha", leadId: base.id, cambios: { etiquetas: ["baño", "extractor"] } }]);
    expect((await leerBd()).leads[base.id].etiquetas).toEqual(["baño", "extractor"]);
    await guardarMutaciones([{ t: "ficha", leadId: base.id, cambios: { etiquetas: [] } }]);
    expect((await leerLead(base.id))?.etiquetas).toBeUndefined();
  });
});

describe("proyectos", () => {
  it("ya no se siembran; una obra guardada se edita y el reinicio la borra", async () => {
    expect((await leerBd()).proyectos).toEqual([]);
    const c = await crudo();
    await c.ejecutar(
      "INSERT INTO proyectos (id, foto, tipo, barrio, estado, avance, descripcion) VALUES ('obra-1', 1, 'Reforma cocina', 'Gràcia', 'En obra', 62, 'Cocina abierta')",
    );
    await guardarMutaciones([{ t: "lead", lead: base }]);
    expect(await editarProyecto("obra-1", { estado: "Acabados", avance: 90, leadId: base.id })).toBe(true);
    expect((await leerBd()).proyectos).toEqual([
      { id: "obra-1", foto: 1, tipo: "Reforma cocina", barrio: "Gràcia", estado: "Acabados", avance: 90, descripcion: "Cocina abierta", leadId: base.id },
    ]);
    expect(await editarProyecto("obra-1", { leadId: null })).toBe(true);
    expect((await leerBd()).proyectos[0].leadId).toBeUndefined();
    expect(await editarProyecto("obra-99", { avance: 10 })).toBe(false);
    await reiniciarBd();
    expect((await leerBd()).proyectos).toEqual([]);
  });
});

// ---- v1.0: esquema, campos nuevos, acciones del dueño, entregas, configuración y ejemplos ----

async function historial(id = base.id): Promise<string[]> {
  return (await leerLead(id))?.actividad?.map((a) => a.texto) ?? [];
}

async function cuantas(tabla: string, leadId: string): Promise<number> {
  const [fila] = await (await crudo()).filas<{ n: number }>(`SELECT count(*) AS n FROM ${tabla} WHERE lead_id = $1`, [leadId]);
  return Number(fila.n);
}

/** Un lead con un mensaje del cliente, en «visita» y con su cita. */
async function conVisita(): Promise<void> {
  await guardarMutaciones([
    { t: "lead", lead: base },
    { t: "mensaje", leadId: base.id, mensaje },
    { t: "estado", leadId: base.id, estado: "visita", ts: 3 },
    { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
  ]);
}

const opciones = (o: Partial<OpcionesSemilla> = {}): OpcionesSemilla => ({ ...OPCIONES_POR_DEFECTO, negocio: "Estudio", ...o });

describe("esquema", () => {
  it("se crea dos veces sobre la misma base sin error y no vuelve a sembrar", async () => {
    const carpeta = mkdtempSync(path.join(os.tmpdir(), "crm-bd-"));
    const g = globalThis as unknown as { __bd?: Promise<Conexion> };
    const memoria = g.__bd;
    const abierta = () => (globalThis as unknown as { __bd: Promise<Conexion> }).__bd;
    try {
      vi.stubEnv("BD_LOCAL", carpeta);
      g.__bd = undefined;
      const primera = await contarLeads();
      expect(primera).toBe(Object.keys(crearSemilla("Estudio de reformas", new Date()).leads).length);
      await (await abierta()).cerrar();
      g.__bd = undefined;
      expect(await contarLeads()).toBe(primera);
      await (await abierta()).cerrar();
    } finally {
      g.__bd = memoria;
      vi.unstubAllEnvs();
      rmSync(carpeta, { recursive: true, force: true });
    }
  }, 60_000);

  it("todas las tablas tienen RLS", async () => {
    const sin = await (await crudo()).filas(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity",
    );
    expect(sin).toEqual([]);
  });

  it("una base de antes de la v1.0 con ejemplos los da por reformas", async () => {
    await guardarMutaciones([{ t: "lead", lead: { ...base, ejemplo: true } }]);
    expect((await leerBd()).ajustes).toEqual({ leadsPrueba: false, ejemplosDe: "reformas" });
    await reiniciarBd();
    expect((await leerBd()).ajustes).toEqual({ leadsPrueba: false });
  });
});

describe("campos nuevos del lead y del mensaje", () => {
  it("van y vuelven tal cual, también con origen manual", async () => {
    const lead = crearLead({
      telefono: "34611111111",
      perfilId: "p",
      perfilNombre: "P",
      nombre: "Marta",
      origen: "manual",
      creadoEn: 10,
      silenciadoEn: 20,
      fuente: { tipo: "anuncio", plataforma: "Instagram", campana: "otono", anuncio: "Reforma tu baño" },
      msPrimeraRespuesta: 4200,
      cierre: "no",
      cierreEn: 30,
      motivoCierre: "Precio",
      vueltaVistaEn: 40,
      mensajes: [
        { id: "x1", de: "agente", texto: "Hola", ts: 11, plantilla: true, nombrePlantilla: "solicitud_general", entrega: "fallido", fallo: "El número no tiene WhatsApp" },
        { id: "x2", de: "agente", texto: "¿Seguimos?", ts: 12, manual: true, entrega: "leido" },
      ],
    });
    await guardarMutaciones([{ t: "lead", lead }]);
    expect(await leerLead(lead.id)).toEqual(lead);
    expect((await leerBd()).leads[lead.id]).toEqual(lead);
  });

  it("un cliente añadido a mano no pisa al que ya existe", async () => {
    await guardarMutaciones([{ t: "lead", lead: { ...base, origen: "manual" } }, { t: "mensaje", leadId: base.id, mensaje }]);
    await guardarMutaciones([{ t: "lead", lead: { ...base, origen: "manual", nombre: "Otra" } }]);
    expect((await leerLead(base.id))?.nombre).toBe("Ana");
    expect((await leerLead(base.id))?.mensajes).toHaveLength(1);
  });
});

describe("silencio", () => {
  it("se guarda una vez, se levanta por el cliente o por el equipo y se puede volver a pedir", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await guardarMutaciones([{ t: "silencio", leadId: base.id, ts: 5 }]);
    await guardarMutaciones([{ t: "silencio", leadId: base.id, ts: 6 }]);
    expect((await leerLead(base.id))?.silenciadoEn).toBe(5);
    expect((await leerLead(base.id))?.actualizadoEn).toBe(5);
    await guardarMutaciones([{ t: "permitir", leadId: base.id, ts: 7, por: "cliente" }]);
    expect((await leerLead(base.id))?.silenciadoEn).toBeUndefined();
    await guardarMutaciones([{ t: "permitir", leadId: base.id, ts: 8, por: "equipo" }]);
    await guardarMutaciones([{ t: "silencio", leadId: base.id, ts: 9 }]);
    await guardarMutaciones([{ t: "permitir", leadId: base.id, ts: 10, por: "equipo" }]);
    expect(await historial()).toEqual([
      "Ha pedido que no le escribamos",
      "Ha vuelto a escribir: se le puede contestar",
      "Ha pedido que no le escribamos",
      "Se le puede volver a escribir: lo has decidido tú",
    ]);
  });

  it("un formulario nuevo es un consentimiento nuevo: quita el silencio", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "silencio", leadId: base.id, ts: 5 }]);
    await guardarMutaciones([{ t: "lead", lead: { ...base, origen: "formulario" } }]);
    expect((await leerLead(base.id))?.silenciadoEn).toBeUndefined();
  });
});

describe("cierre", () => {
  it("«sí» guarda el importe y lo cobrado, sin tocar la etapa", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 20, accion: "si", importe: 5200, cobrado: 1000 }]);
    const lead = await leerLead(base.id);
    expect(lead).toMatchObject({ presupuesto: 5200, cobrado: 1000, cierre: "si", cierreEn: 20, estado: "visita", actualizadoEn: 3 });
    expect(lead?.motivoCierre).toBeUndefined();
    expect(await historial()).toContain(`Ha dicho que sí · ${formatoImporte(5200, "EUR")}`);
    // formatoImporte separa la cifra del símbolo con un espacio duro, como Intl.
    expect(await historial()).toContain("Ha dicho que sí · 5.200\u00a0€");
  });

  it("«sí» sin cobrado lo deja como estaba, y con cobrado null lo borra", async () => {
    await guardarMutaciones([{ t: "lead", lead: { ...base, cobrado: 300 } }]);
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 20, accion: "si", importe: 900, moneda: "MXN" }]);
    expect((await leerLead(base.id))?.cobrado).toBe(300);
    expect(await historial()).toEqual([`Ha dicho que sí · ${formatoImporte(900, "MXN")}`]);
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 21, accion: "si", importe: 900, cobrado: null }]);
    expect((await leerLead(base.id))?.cobrado).toBeUndefined();
  });

  it("«sí» después de un «no» quita el motivo y la vuelta vista", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await guardarMutaciones([
      { t: "cierre", leadId: base.id, ts: 20, accion: "no", motivo: "Precio" },
      { t: "cierre", leadId: base.id, ts: 21, accion: "visto" },
      { t: "cierre", leadId: base.id, ts: 22, accion: "si", importe: 100 },
    ]);
    const lead = await leerLead(base.id);
    expect(lead).toMatchObject({ cierre: "si", cierreEn: 22, presupuesto: 100 });
    expect(lead?.motivoCierre).toBeUndefined();
    expect(lead?.vueltaVistaEn).toBeUndefined();
  });

  it("«no» sin anular la cita la deja en la agenda", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 20, accion: "no", motivo: "Se lo ha pensado" }]);
    const lead = await leerLead(base.id);
    expect(lead).toMatchObject({ cierre: "no", motivoCierre: "Se lo ha pensado", cierreEn: 20, estado: "visita", visita: h1 });
    expect(await historial()).toContain("No sigue · Se lo ha pensado");
  });

  it("«no» anulando la cita libera el hueco y vuelve a la conversación", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 20, accion: "no", motivo: "Precio", anularCita: true }]);
    const lead = await leerLead(base.id);
    expect(lead).toMatchObject({ cierre: "no", estado: "conversacion", cambioEstadoEn: 20, actualizadoEn: 20 });
    expect(lead?.visita).toBeUndefined();
    expect(await leerReservas()).toEqual([]);
    // Misma hora: van por id (anulada, cierre, estado).
    expect((await historial()).slice(-3)).toEqual([`Visita anulada: ${h1.texto}`, "No sigue · Precio", "Estado: En conversación"]);
  });

  it("«no» anulando la cita sin cita: no hay línea de anulada ni cambio de etapa", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "mensaje", leadId: base.id, mensaje }]);
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 20, accion: "no", motivo: "No contesta", anularCita: true }]);
    expect(await leerLead(base.id)).toMatchObject({ cierre: "no", motivoCierre: "No contesta", estado: "nuevo" });
    expect(await historial()).toEqual(["No sigue · No contesta"]);
  });

  it("con nota, la guarda como una nota más", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 20, accion: "no", motivo: "Otro", nota: "Se muda a Valencia" }]);
    expect((await leerLead(base.id))?.notas).toEqual([{ id: `cierre-${base.id}-20`, texto: "Se muda a Valencia", ts: 20 }]);
    expect(await historial()).toEqual(["No sigue · Otro", "Nota interna: Se muda a Valencia"]);
  });

  it("reabrir lo deja sin cierre y no devuelve la cita anulada", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 20, accion: "no", motivo: "Precio", anularCita: true }]);
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 21, accion: "visto" }]);
    expect((await leerLead(base.id))?.vueltaVistaEn).toBe(21);
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 22, accion: "reabrir" }]);
    await guardarMutaciones([{ t: "cierre", leadId: base.id, ts: 23, accion: "reabrir" }]);
    const lead = await leerLead(base.id);
    for (const campo of ["cierre", "cierreEn", "motivoCierre", "vueltaVistaEn", "visita"] as const) expect(lead?.[campo]).toBeUndefined();
    expect(await leerReservas()).toEqual([]);
    expect((await historial()).filter((t) => t === "Reabierto")).toHaveLength(1);
  });

  it("«visto» sin cierre no hace nada", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "cierre", leadId: base.id, ts: 21, accion: "visto" }]);
    expect((await leerLead(base.id))?.vueltaVistaEn).toBeUndefined();
  });

  it("un lead marcado como publicidad no se cierra", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "estado", leadId: base.id, estado: "spam", ts: 5, motivo: "Masivo" }]);
    await guardarMutaciones([
      { t: "cierre", leadId: base.id, ts: 20, accion: "si", importe: 5200, nota: "No debería quedar" },
      { t: "cierre", leadId: base.id, ts: 21, accion: "no", motivo: "Precio" },
    ]);
    const lead = await leerLead(base.id);
    expect(lead?.cierre).toBeUndefined();
    expect(lead?.presupuesto).toBeUndefined();
    expect(lead?.notas).toBeUndefined();
    expect(await historial()).toEqual(["Marcado como spam: Masivo"]);
  });
});

describe("etapa a mano", () => {
  it("pasar a persona desde el panel, con el motivo por defecto", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 5, a: "persona" }]);
    expect(await leerLead(base.id)).toMatchObject({ estado: "persona", motivoPersona: "Lo llevas tú desde el panel", cambioEstadoEn: 5, actualizadoEn: 5 });
    expect(await historial()).toEqual(["Pasado a persona: Lo llevas tú desde el panel"]);
  });

  it("el candado de «persona» solo lo abre «asistente»", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "mensaje", leadId: base.id, mensaje }]);
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 5, a: "persona", motivo: "Quiere hablar con alguien" }]);
    await guardarMutaciones([{ t: "estado", leadId: base.id, estado: "visita", ts: 6 }]);
    expect((await leerLead(base.id))?.estado).toBe("persona");
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 7, a: "asistente" }]);
    const devuelto = await leerLead(base.id);
    expect(devuelto).toMatchObject({ estado: "conversacion", cambioEstadoEn: 7 });
    expect(devuelto?.motivoPersona).toBeUndefined();
    await guardarMutaciones([{ t: "estado", leadId: base.id, estado: "visita", ts: 8 }]);
    expect((await leerLead(base.id))?.estado).toBe("visita");
    expect(await historial()).toEqual([
      "Pasado a persona: Quiere hablar con alguien",
      "Devuelto a tu asistente",
      "Estado: Visita reservada",
    ]);
  });

  it("devuelto al asistente con cita vuelve a «visita»; sin mensajes del cliente, a «nuevo»", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 5, a: "persona" }, { t: "etapa", leadId: base.id, ts: 6, a: "asistente" }]);
    expect((await leerLead(base.id))?.estado).toBe("visita");
    const otro = crearLead({ telefono: "34699999999", perfilId: "p", perfilNombre: "P", nombre: "Otro", origen: "manual" });
    await guardarMutaciones([{ t: "lead", lead: otro }, { t: "etapa", leadId: otro.id, ts: 5, a: "persona" }, { t: "etapa", leadId: otro.id, ts: 6, a: "asistente" }]);
    expect((await leerLead(otro.id))?.estado).toBe("nuevo");
  });

  it("publicidad sin anular la cita la conserva, y «no es publicidad» vuelve a «visita»", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 5, a: "spam" }]);
    expect(await leerLead(base.id)).toMatchObject({ estado: "spam", motivoSpam: "Lo has marcado tú como publicidad", visita: h1 });
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 6, a: "no-spam" }]);
    expect(await leerLead(base.id)).toMatchObject({ estado: "visita", cambioEstadoEn: 6 });
    expect((await historial()).slice(-2)).toEqual(["Marcado como spam: Lo has marcado tú como publicidad", "No es publicidad"]);
  });

  it("publicidad anulando la cita: hueco libre y línea de anulada, sin línea de etapa", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 5, a: "spam", motivo: "Vende cursos", anularCita: true }]);
    expect(await leerReservas()).toEqual([]);
    // Misma hora: van por id (anulada, estado).
    expect((await historial()).slice(-2)).toEqual([`Visita anulada: ${h1.texto}`, "Marcado como spam: Vende cursos"]);
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 6, a: "no-spam" }]);
    expect((await leerLead(base.id))?.estado).toBe("conversacion");
  });

  it("una transición que no toca no cambia nada ni deja línea", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "mensaje", leadId: base.id, mensaje }, { t: "estado", leadId: base.id, estado: "conversacion", ts: 3 }]);
    await guardarMutaciones([
      { t: "etapa", leadId: base.id, ts: 5, a: "asistente" },
      { t: "etapa", leadId: base.id, ts: 6, a: "no-spam" },
    ]);
    expect(await leerLead(base.id)).toMatchObject({ estado: "conversacion", cambioEstadoEn: 3 });
    await guardarMutaciones([{ t: "etapa", leadId: base.id, ts: 7, a: "spam" }, { t: "etapa", leadId: base.id, ts: 8, a: "persona" }]);
    expect(await leerLead(base.id)).toMatchObject({ estado: "spam", cambioEstadoEn: 7 });
    expect(await historial()).toEqual(["Estado: En conversación", "Marcado como spam: Lo has marcado tú como publicidad"]);
  });
});

describe("borrar un cliente", () => {
  it("no deja nada suyo, libera el hueco y el registro no lleva ni nombre ni teléfono", async () => {
    const ahora = new Date("2026-11-11T09:00:00Z");
    const [primero] = verHuecos([], ahora);
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "mensaje", leadId: base.id, mensaje },
      { t: "reserva", reserva: reserva(primero.id), hueco: primero, ts: 3 },
      { t: "nota", leadId: base.id, nota: { id: "n1", texto: "Nota", ts: 4 } },
      { t: "tarea", leadId: base.id, tarea: { id: "t1", texto: "Llamar", hecha: false, ts: 4 } },
    ]);
    expect(verHuecos(await leerReservas(), ahora).map((h) => h.id)).not.toContain(primero.id);
    const espia = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await guardarMutaciones([
        { t: "borrar", leadId: base.id, ts: 5 },
        { t: "mensaje", leadId: base.id, mensaje: { id: "tarde", de: "cliente", texto: "¿Hola?", ts: 6 } },
        { t: "silencio", leadId: base.id, ts: 6 },
      ]);
      const lineas = espia.mock.calls.map((c) => String(c[0]));
      expect(lineas.filter((l) => l.includes("Cliente borrado a petición"))).toHaveLength(1);
      expect(lineas.some((l) => l.includes("Ana") || l.includes(base.telefono))).toBe(false);
    } finally {
      espia.mockRestore();
    }
    for (const tabla of ["mensajes", "notas", "tareas", "actividad", "visitas"]) expect(await cuantas(tabla, base.id)).toBe(0);
    const [fila] = await (await crudo()).filas<{ n: number }>("SELECT count(*) AS n FROM leads WHERE id = $1", [base.id]);
    expect(Number(fila.n)).toBe(0);
    expect(verHuecos(await leerReservas(), ahora)[0].id).toBe(primero.id);
  });
});

describe("historial y primera respuesta", () => {
  it("una línea con id fijo no se repite", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    const linea = { t: "actividad" as const, leadId: base.id, id: "web-1", texto: "Ha pedido que le escribamos por WhatsApp desde tu web", ts: 5 };
    await guardarMutaciones([linea]);
    await guardarMutaciones([linea]);
    expect(await historial()).toEqual(["Ha pedido que le escribamos por WhatsApp desde tu web"]);
  });

  it("la primera respuesta se guarda una sola vez", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await guardarMutaciones([{ t: "respuesta", leadId: base.id, ms: 4200 }]);
    await guardarMutaciones([{ t: "respuesta", leadId: base.id, ms: 9000 }]);
    expect((await leerLead(base.id))?.msPrimeraRespuesta).toBe(4200);
  });

  it("después de guardar, avisa al panel", async () => {
    const cambios: string[] = [];
    const dejar = escucharCambios((c) => cambios.push(c.tipo));
    try {
      await guardarMutaciones([{ t: "lead", lead: base }]);
      await modificarConfiguracionGuardada((actual) => normalizarGuardada(actual));
      await new Promise((r) => setTimeout(r, 120));
      expect(cambios).toEqual(expect.arrayContaining(["leads", "configuracion"]));
    } finally {
      dejar();
    }
  });
});

describe("entregas", () => {
  const enviado: Mensaje = { id: "wamid.A", de: "agente", texto: "Hola", ts: 3 };

  it("solo avanzan: enviado, entregado, leído; un entregado tarde no lo baja", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "mensaje", leadId: base.id, mensaje: enviado }]);
    const entrega = async () => (await leerLead(base.id))?.mensajes[0].entrega;
    expect(await actualizarEntregas([{ wamid: "wamid.A", estado: "enviado", ts: 4 }])).toBe(1);
    expect(await entrega()).toBe("enviado");
    expect(await actualizarEntregas([{ wamid: "wamid.A", estado: "entregado", ts: 5 }])).toBe(1);
    expect(await actualizarEntregas([{ wamid: "wamid.A", estado: "leido", ts: 6 }])).toBe(1);
    expect(await actualizarEntregas([{ wamid: "wamid.A", estado: "entregado", ts: 7 }])).toBe(0);
    expect(await entrega()).toBe("leido");
  });

  it("en un mismo lote cuenta el más avanzado", async () => {
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "mensaje", leadId: base.id, mensaje: enviado }]);
    await actualizarEntregas([
      { wamid: "wamid.A", estado: "leido", ts: 6 },
      { wamid: "wamid.A", estado: "entregado", ts: 5 },
    ]);
    expect((await leerLead(base.id))?.mensajes[0].entrega).toBe("leido");
  });

  it("un fallo guarda su motivo; un id desconocido o un mensaje del cliente no cambian nada", async () => {
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "mensaje", leadId: base.id, mensaje: enviado },
      { t: "mensaje", leadId: base.id, mensaje: { ...mensaje, id: "wamid.C" } },
    ]);
    expect(await actualizarEntregas([{ wamid: "wamid.A", estado: "fallido", ts: 4, fallo: "Fuera de las 24 horas" }])).toBe(1);
    expect((await leerLead(base.id))?.mensajes[0]).toEqual({ ...enviado, entrega: "fallido", fallo: "Fuera de las 24 horas" });
    expect(await actualizarEntregas([{ wamid: "wamid.NADA", estado: "leido", ts: 4 }])).toBe(0);
    expect(await actualizarEntregas([{ wamid: "wamid.C", estado: "leido", ts: 4 }])).toBe(0);
    expect(await actualizarEntregas([])).toBe(0);
  });
});

describe("configuración guardada", () => {
  const guardada: ConfiguracionGuardada = {
    version: 1,
    rev: 3,
    perfiles: { "reformas-ana": { negocio: { nombre: "Reformas Ana", lema: "Bien hecho" } } },
    sistema: {},
  };

  it("empieza vacía y vuelve tal cual se guarda", async () => {
    expect(await leerConfiguracionGuardada()).toEqual({});
    const nueva = await modificarConfiguracionGuardada(() => guardada);
    expect(nueva).toEqual(guardada);
    const leida = normalizarGuardada(await leerConfiguracionGuardada());
    expect(leida.perfiles["reformas-ana"]).toEqual(guardada.perfiles["reformas-ana"]);
    expect(leida.rev).toBe(3);
  });

  it("renombrar cambia el nombre del negocio en los leads y las visitas de ese perfil, nada más", async () => {
    const otro = crearLead({ telefono: "34699999999", perfilId: "otro", perfilNombre: "Otro", nombre: "Luis", origen: "whatsapp" });
    await guardarMutaciones([
      { t: "lead", lead: base },
      { t: "lead", lead: otro },
      { t: "reserva", reserva: reserva(h1.id), hueco: h1, ts: 3 },
      { t: "reserva", reserva: { ...reserva(h2.id, otro.id), perfilNombre: "Otro" }, hueco: h2, ts: 3 },
    ]);
    await modificarConfiguracionGuardada(() => guardada, { renombrar: { perfilId: "p", nombre: "Nuevo nombre" } });
    expect((await leerLead(base.id))?.perfilNombre).toBe("Nuevo nombre");
    expect((await leerLead(otro.id))?.perfilNombre).toBe("Otro");
    const reservas = await leerReservas();
    expect(reservas.find((r) => r.leadId === base.id)?.perfilNombre).toBe("Nuevo nombre");
    expect(reservas.find((r) => r.leadId === otro.id)?.perfilNombre).toBe("Otro");
  });

  it("el logo cambia de versión con el contenido y al quitarlo se va su versión", async () => {
    await modificarConfiguracionGuardada(() => guardada);
    const a = await guardarLogo("reformas-ana", "data:image/png;base64,AAAA");
    await restablecerConfiguracion();
    expect(await leerLogo("reformas-ana")).toBeNull();
    const b = await guardarLogo("reformas-ana", "data:image/png;base64,BBBB");
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).not.toBe(a);
    expect(await leerLogo("reformas-ana")).toBe("data:image/png;base64,BBBB");
    const conLogo = normalizarGuardada(await leerConfiguracionGuardada());
    expect(conLogo.perfiles["reformas-ana"].negocio?.logoVersion).toBe(b);
    expect(await guardarLogo("reformas-ana", null)).toBeNull();
    const sinLogo = normalizarGuardada(await leerConfiguracionGuardada());
    expect(sinLogo.perfiles["reformas-ana"]?.negocio?.logoVersion).toBeUndefined();
    expect(sinLogo.rev).toBe(conLogo.rev + 1);
    expect(await leerLogo("reformas-ana")).toBeNull();
  });

  it("las copias de las instrucciones se guardan, se leen y se quitan; más de 12.000 caracteres no", async () => {
    const copia: CopiaInstrucciones = { texto: "Eres el asistente de Reformas Ana.", hash: "abc", origen: null, guardadaEn: 5 };
    await guardarCopiaInstrucciones("reformas-ana", copia);
    await guardarCopiaInstrucciones("otro", { ...copia, origen: "reformas" });
    expect(await leerCopiasInstrucciones()).toEqual({ "reformas-ana": copia, otro: { ...copia, origen: "reformas" } });
    await guardarCopiaInstrucciones("otro", null);
    expect(await leerCopiasInstrucciones()).toEqual({ "reformas-ana": copia });
    await expect(guardarCopiaInstrucciones("largo", { ...copia, texto: "x".repeat(12_001) })).rejects.toThrow(
      "Las instrucciones guardadas no pueden pasar de 12.000 caracteres",
    );
    expect(Object.keys(await leerCopiasInstrucciones())).toEqual(["reformas-ana"]);
  });
});

describe("ejemplos", () => {
  it("el reinicio no toca la configuración, los logos ni las copias", async () => {
    const guardada: ConfiguracionGuardada = { version: 1, rev: 1, perfiles: { mio: { negocio: { nombre: "Mío" } } }, sistema: {} };
    await modificarConfiguracionGuardada(() => guardada);
    await guardarLogo("mio", "data:image/png;base64,CCCC");
    await guardarCopiaInstrucciones("mio", { texto: "Instrucciones", hash: "h", origen: null, guardadaEn: 1 });
    await reiniciarBd();
    expect(normalizarGuardada(await leerConfiguracionGuardada()).perfiles.mio.negocio?.nombre).toBe("Mío");
    expect(await leerLogo("mio")).toBe("data:image/png;base64,CCCC");
    expect(Object.keys(await leerCopiasInstrucciones())).toEqual(["mio"]);
  });

  it("«Borrar todo» no deja ni leads ni citas, y apaga los ejemplos", async () => {
    await guardarAjustes({ leadsPrueba: true });
    await reiniciarBd();
    expect(await contarLeads()).toBeGreaterThan(0);
    await guardarMutaciones([{ t: "lead", lead: base }]);
    await reiniciarBd(undefined, { ejemplos: false });
    const bd = await leerBd();
    expect(bd.leads).toEqual({});
    expect(bd.reservas).toEqual([]);
    expect(bd.ajustes).toEqual({ leadsPrueba: false });
  });

  it("el reinicio con ejemplos apunta su sector", async () => {
    await guardarAjustes({ leadsPrueba: true });
    await reiniciarBd(opciones({ sector: "clinica" }));
    expect((await leerBd()).ajustes).toEqual({ leadsPrueba: true, ejemplosDe: "clinica" });
  });

  it("cargar ejemplos no toca los clientes reales ni sus citas", async () => {
    const o = opciones();
    const semilla = crearSemilla(o.negocio, new Date(), o);
    const hueco = semilla.reservas[0]?.huecoId ?? "2030-01-07T10:00";
    const real = crearLead({ telefono: "34655555555", perfilId: "p", perfilNombre: "P", nombre: "Real", origen: "whatsapp", creadoEn: 1 });
    const cita = { huecoId: hueco, texto: textoHueco(hueco), leadId: real.id, nombre: "Real", perfilNombre: "P" };
    await guardarMutaciones([
      { t: "lead", lead: real },
      { t: "mensaje", leadId: real.id, mensaje },
      { t: "reserva", reserva: cita, hueco: { id: hueco, texto: cita.texto }, ts: 2 },
    ]);
    const antes = await leerLead(real.id);
    const { leads } = await sustituirEjemplos(o);
    expect(leads).toBe(Object.keys(crearSemilla(o.negocio, new Date(), { ...o, ocupados: [hueco] }).leads).length);
    expect(await contarEjemplos()).toEqual({ ejemplo: leads, reales: 1 });
    expect(await leerLead(real.id)).toEqual(antes);
    const reservas = await leerReservas();
    expect(reservas.filter((r) => r.huecoId === hueco)).toEqual([cita]);
    expect(reservas.filter((r) => r.prueba).every((r) => r.huecoId !== hueco)).toBe(true);
    const bd = await leerBd();
    expect(bd.ajustes).toEqual({ leadsPrueba: true, ejemplosDe: "reformas" });
    // Cargarlos otra vez no los duplica.
    expect((await sustituirEjemplos(o)).leads).toBe(leads);
    expect(await contarEjemplos()).toEqual({ ejemplo: leads, reales: 1 });

    await borrarEjemplos();
    expect(Object.keys((await leerBd()).leads)).toEqual([real.id]);
    expect(await leerReservas()).toEqual([cita]);
    expect((await leerBd()).ajustes).toEqual({ leadsPrueba: false });
    expect(await contarEjemplos()).toEqual({ ejemplo: 0, reales: 1 });
  });

  it("solo cuenta como primer mensaje uno de un cliente real", async () => {
    await sustituirEjemplos(opciones());
    expect(await hayMensajeRealDeCliente()).toBe(false);
    await guardarMutaciones([{ t: "lead", lead: base }, { t: "mensaje", leadId: base.id, mensaje: { id: "a1", de: "agente", texto: "Hola", ts: 2 } }]);
    expect(await hayMensajeRealDeCliente()).toBe(false);
    await guardarMutaciones([{ t: "mensaje", leadId: base.id, mensaje }]);
    expect(await hayMensajeRealDeCliente()).toBe(true);
  });

  it("los datos de un cliente, con todo lo suyo; null si no existe", async () => {
    await conVisita();
    await guardarMutaciones([{ t: "nota", leadId: base.id, nota: { id: "n1", texto: "Nota", ts: 4 } }]);
    const datos = await datosDeCliente(base.id);
    expect(datos).toEqual({
      formato: "crm-whatsapp/cliente@1",
      exportadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      negocio: "P",
      cliente: await leerLead(base.id),
      citas: [reserva(h1.id)],
    });
    expect(datos?.cliente.mensajes).toEqual([mensaje]);
    expect(await datosDeCliente("34600000000:nadie")).toBeNull();
  });
});

describe("inserción de los ejemplos por tablas", () => {
  const hueco = "2030-01-08T10:00";
  const huecoTexto = textoHueco(hueco);
  const comun = { perfilId: "ejemplo", perfilNombre: "Estudio", ejemplo: true } as const;
  const leads: Lead[] = [
    crearLead({
      ...comun,
      telefono: "34600000101",
      nombre: "Lucía",
      origen: "formulario",
      estado: "visita",
      creadoEn: 1000,
      actualizadoEn: 2000,
      cambioEstadoEn: 2000,
      msPrimerWhatsApp: 900,
      zona: "Gràcia",
      email: "lucia@ejemplo.es",
      datos: { tipo: "Baño", metros: "5 m²" },
      huecosOfrecidos: [{ id: hueco, texto: huecoTexto }],
      presupuesto: 5200,
      cobrado: 1000,
      cierre: "si",
      cierreEn: 3000,
      etiquetas: ["baño"],
      visita: { id: hueco, texto: huecoTexto },
      mensajes: [
        { id: "f1-0", de: "agente", texto: "Hola Lucía", ts: 1000, plantilla: true, nombrePlantilla: "solicitud_general", entrega: "leido" },
        { id: "f1-1", de: "cliente", texto: "Quiero reformar el baño", ts: 1100 },
      ],
      notas: [{ id: "f1-nota", texto: "Paga en dos plazos", ts: 2000 }],
      tareas: [{ id: "f1-tarea", texto: "Llamar", vence: "2030-01-07", hecha: false, ts: 2000 }],
      actividad: [{ id: "f1-act", texto: `Visita reservada: ${huecoTexto}`, ts: 2000 }],
    }),
    crearLead({
      ...comun,
      telefono: "34600000102",
      nombre: "Pablo",
      origen: "whatsapp",
      estado: "conversacion",
      creadoEn: 1001,
      cierre: "no",
      motivoCierre: "Precio",
      cierreEn: 3001,
      vueltaVistaEn: 3500,
      mensajes: [{ id: "f2-0", de: "cliente", texto: "¿Cuánto cuesta?", ts: 1001 }],
    }),
    crearLead({
      ...comun,
      telefono: "34600000103",
      nombre: "Inés",
      origen: "whatsapp",
      estado: "spam",
      motivoSpam: "Mensaje masivo",
      creadoEn: 1002,
      silenciadoEn: 1500,
      mensajes: [{ id: "f3-0", de: "cliente", texto: "Baja", ts: 1002 }],
    }),
    crearLead({ ...comun, telefono: "34600000104", nombre: "Tomás", origen: "manual", creadoEn: 1003 }),
    crearLead({
      ...comun,
      telefono: "34600000105",
      nombre: "Sara",
      origen: "whatsapp",
      estado: "persona",
      motivoPersona: "Quiere hablar con alguien",
      creadoEn: 1004,
      msPrimeraRespuesta: 4200,
      fuente: { tipo: "anuncio", plataforma: "Instagram", anuncio: "Reforma tu cocina" },
      mensajes: [
        { id: "f5-0", de: "cliente", texto: "Audio", ts: 1004, audio: true },
        { id: "f5-1", de: "agente", texto: "Te leo", ts: 1005, entrega: "fallido", fallo: "Fuera de las 24 horas" },
        { id: "f5-2", de: "agente", texto: "Soy Marta", ts: 1006, manual: true, entrega: "entregado" },
      ],
    }),
  ];
  const fixture: SemillaGenerada = {
    leads: Object.fromEntries(leads.map((l) => [l.id, l])),
    reservas: [{ huecoId: hueco, texto: huecoTexto, leadId: leads[0].id, nombre: "Lucía", perfilNombre: "Estudio", prueba: true }],
  };

  it("guarda cada columna de cada tipo de ejemplo", async () => {
    fijo.semilla = fixture;
    try {
      expect(await sustituirEjemplos(opciones())).toEqual({ leads: leads.length });
    } finally {
      fijo.semilla = null;
    }
    const bd = await leerBd();
    expect(Object.keys(bd.leads).sort()).toEqual(leads.map((l) => l.id).sort());
    for (const lead of leads) expect(bd.leads[lead.id]).toEqual(lead);
    expect(bd.reservas).toEqual(fixture.reservas);
  });

  it("los mensajes van en el orden de la conversación, aunque la hora no lo diga", async () => {
    const charla = Array.from({ length: 10 }, (_, n): Mensaje => ({ id: `m${n}`, de: n % 2 ? "agente" : "cliente", texto: `Mensaje ${n}`, ts: 5000 - n }));
    const lead = crearLead({ ...comun, telefono: "34600000106", nombre: "Diez", origen: "whatsapp", mensajes: charla, creadoEn: 1 });
    fijo.semilla = { leads: { [lead.id]: lead }, reservas: [] };
    try {
      await sustituirEjemplos(opciones());
    } finally {
      fijo.semilla = null;
    }
    expect((await leerLead(lead.id))?.mensajes.map((m) => m.id)).toEqual(charla.map((m) => m.id));
    expect((await leerBd()).leads[lead.id].mensajes).toEqual(charla);
  });
});
