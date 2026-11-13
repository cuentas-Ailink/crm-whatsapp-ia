import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MockLanguageModelV4, mockValues } from "ai/test";
import { expect, it, vi } from "vitest";
import { diasDeAgenda } from "./agenda";
import { ejecutarAgente, type InfoIntento } from "./agente";
import { configAgenteDe, GUARDADA_VACIA, type ConfigAgente } from "./configuracion";
import { csvDeLeads } from "./exportar";
import {
  buscarHuecos,
  crearLead,
  diasLaborables,
  fechaMadrid,
  huecoLibre,
  importesCitados,
  motivoParaPersona,
  NOMBRE_ETAPA,
  revisarRespuesta,
  textoHueco,
  verHuecos,
  type RevisionRespuesta,
} from "./negocio";
import { resolver } from "./presets";
import { crearSemilla } from "./semilla";
import type { Lead, Reserva } from "./tipos";
import { textoPlantilla } from "./whatsapp";

// Fixtures doradas: congelan lo que hace hoy el código (prompt y herramientas del agente, leads de
// ejemplo, calendario, CSV y red de seguridad). Cada archivo de __golden__ solo lo vuelve a capturar
// su dueño, a propósito y con un filtro anclado (-t "^nombre$"). Los nombres de las pruebas están
// congelados: uno por archivo, igual que el archivo sin extensión.

// Copias congeladas de los perfiles de hoy: editar el prompt no mueve las fixtures (a).
const REFORMAS = readFileSync("lib/__golden__/entrada-reformas.md", "utf8");
const INMOBILIARIA = readFileSync("lib/__golden__/entrada-inmobiliaria.md", "utf8");

// Lunes 2 nov 2026, 10:00 en Madrid, y miércoles 11 nov 2026, 10:00 en Madrid.
const AHORA_A = new Date("2026-11-02T09:00:00Z");
const AHORA_B = new Date("2026-11-11T09:00:00Z");

/** Arrays en orden, claves de objeto ordenadas y sin `undefined`: el mismo JSON siempre. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor !== null && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const clave of Object.keys(valor).sort()) {
      const v = (valor as Record<string, unknown>)[clave];
      if (v !== undefined) salida[clave] = canonico(v);
    }
    return salida;
  }
  return valor;
}

const json = (v: unknown) => JSON.stringify(canonico(v), null, 2) + "\n";

// Copia congelada del generador mulberry32 de lib/semilla.ts (líneas 206-216 de hoy). W3 reescribe
// lib/semilla.ts en la fase 1 y no debe mover la fixture (c): por eso no se importa de allí.
/** Números pseudoaleatorios entre 0 y 1 a partir de una semilla fija (mulberry32). */
function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ---- El modelo simulado, igual que en lib/agente.test.ts ----

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const texto = (t: string) => ({
  content: [{ type: "text" as const, text: t }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: USO,
  warnings: [],
});

function modelo(...respuestas: object[]) {
  const siguiente = mockValues(...respuestas) as () => never;
  return new MockLanguageModelV4({ doGenerate: async () => siguiente() });
}

interface Extras {
  config?: ConfigAgente;
  alIntento?: (i: InfoIntento) => void;
}

/** Ejecuta el agente con el modelo simulado y escribe el prompt y las herramientas de la llamada `llamada`. */
async function capturar(
  instrucciones: string,
  lead: Lead,
  reservas: Reserva[],
  respuestas: object[],
  llamada: number,
  extras: Extras = {},
): Promise<string> {
  const m = modelo(...respuestas);
  await ejecutarAgente({ instrucciones, lead, reservas, ahora: AHORA_A, senal: new AbortController().signal, modelo: m, ...extras });
  const { prompt, tools } = m.doGenerateCalls[llamada];
  const herramientas = (tools ?? [])
    .map((h) => {
      const { name, description, inputSchema } = h as { name: string; description?: string; inputSchema?: unknown };
      return { name, description, inputSchema };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [
    "=== SISTEMA ===",
    (prompt[0] as { content: string }).content,
    "",
    "=== MENSAJES ===",
    json(prompt.slice(1)) + "=== HERRAMIENTAS ===",
    json(herramientas),
  ].join("\n");
}

// ---- (a) Prompt y herramientas del agente ----

// La configuración resuelta de reformas con la plantilla heredada de .env, como se capturó.
const CONFIG_REFORMAS = configAgenteDe(
  resolver({
    perfil: { id: "estudio-de-reformas", nombre: "Estudio de reformas", hash: "" },
    guardada: GUARDADA_VACIA,
    entorno: { NOMBRE_NEGOCIO: "Estudio de reformas", PLANTILLA: "solicitud_recibida", PLANTILLA_IDIOMA: "es_ES" },
  }),
);

/**
 * Cada escenario (a) dos veces: sin `config` y con la de reformas. Tienen que salir iguales, y se
 * comprueba antes de la fixture: un `-u` nunca puede tapar una diferencia entre los dos modos.
 */
async function ambosModos(
  instrucciones: string,
  lead: () => Lead,
  reservas: Reserva[],
  respuestas: object[],
  llamada: number,
  espias: { sin?: (i: InfoIntento) => void; con?: (i: InfoIntento) => void } = {},
): Promise<string> {
  const sinConfig = await capturar(instrucciones, lead(), reservas, respuestas, llamada, { alIntento: espias.sin });
  const conConfig = await capturar(instrucciones, lead(), reservas, respuestas, llamada, { config: CONFIG_REFORMAS, alIntento: espias.con });
  expect(conConfig).toBe(sinConfig);
  return sinConfig;
}

function leadFormulario(): Lead {
  return crearLead({
    telefono: "34612345678",
    perfilId: "estudio-de-reformas",
    perfilNombre: "Estudio de reformas",
    nombre: "Laura Martínez",
    origen: "formulario",
    creadoEn: AHORA_A.getTime() - 120_000,
    mensajes: [
      { id: "plantilla", de: "agente", texto: textoPlantilla("Laura", "Estudio de reformas"), ts: AHORA_A.getTime() - 120_000, plantilla: true },
      { id: "c1", de: "cliente", texto: "Quiero reformar un baño", ts: AHORA_A.getTime() - 60_000 },
    ],
  });
}

it("a1-formulario", async () => {
  const salida = await ambosModos(REFORMAS, leadFormulario, [], [texto("Perfecto. ¿Cuántos metros tiene más o menos?")], 0);
  await expect(salida).toMatchFileSnapshot("__golden__/a1-formulario.txt");
});

it("a2-reintento", async () => {
  const espias = { sin: vi.fn<(i: InfoIntento) => void>(), con: vi.fn<(i: InfoIntento) => void>() };
  const salida = await ambosModos(
    REFORMAS,
    leadFormulario,
    [],
    [texto("Te propongo el martes a las 09:15."), texto("Perfecto. ¿Cuántos metros tiene más o menos?")],
    1,
    espias,
  );
  // alIntento ve los dos intentos: el descartado por la red de seguridad y el aceptado, con su uso.
  for (const espia of [espias.sin, espias.con]) {
    expect(espia).toHaveBeenCalledTimes(2);
    const [[descartado], [aceptado]] = espia.mock.calls;
    expect(descartado.descartada).toEqual(expect.any(String));
    expect(descartado.descartada).not.toBe("");
    expect(descartado.uso).not.toBeNull();
    expect(descartado.error).toBeUndefined();
    expect(aceptado.descartada).toBeNull();
    expect(aceptado.uso).not.toBeNull();
    expect(aceptado.error).toBeUndefined();
  }
  await expect(salida).toMatchFileSnapshot("__golden__/a2-reintento.txt");
});

it("a3-ofrecidos", async () => {
  const ofrecidos = verHuecos([], AHORA_A);
  const visita = ofrecidos[0];
  const t = AHORA_A.getTime();
  const crear = () => crearLead({
    telefono: "34612345678",
    perfilId: "estudio-de-reformas",
    perfilNombre: "Estudio de reformas",
    nombre: "Pol",
    origen: "whatsapp",
    estado: "visita",
    creadoEn: t - 600_000,
    datos: { tipo: "baño", metros: "6" },
    huecosOfrecidos: ofrecidos,
    visita,
    mensajes: [
      { id: "c1", de: "cliente", texto: "Quiero reformar un baño de 6 metros", ts: t - 600_000 },
      { id: "a1", de: "agente", texto: "Te propongo martes 3 nov a las 10:00 o miércoles 4 nov a las 17:00. ¿Cuál te va mejor?", ts: t - 540_000 },
      { id: "c2", de: "cliente", texto: "El martes", ts: t - 480_000 },
      { id: "a2", de: "agente", texto: "Hecho ✅ martes 3 nov a las 10:00.", ts: t - 420_000 },
      { id: "c3", de: "cliente", texto: "¿Me lo puedes cambiar a otra hora?", ts: t - 60_000 },
    ],
  });
  const lead = crear();
  const reservas: Reserva[] = [
    { huecoId: visita.id, texto: visita.texto, leadId: lead.id, nombre: lead.nombre, perfilNombre: lead.perfilNombre },
  ];
  const salida = await ambosModos(REFORMAS, crear, reservas, [texto("Claro, ¿qué día te viene mejor?")], 0);
  await expect(salida).toMatchFileSnapshot("__golden__/a3-ofrecidos.txt");
});

it("a4-inmobiliaria", async () => {
  const t = AHORA_A.getTime();
  const lead = () => crearLead({
    telefono: "34612345678",
    perfilId: "inmobiliaria",
    perfilNombre: "Inmobiliaria",
    nombre: "Marta",
    origen: "whatsapp",
    creadoEn: t - 60_000,
    datos: { piso: "P-101" },
    mensajes: [{ id: "c1", de: "cliente", texto: "Hola, ¿sigue disponible el piso de la calle Mallorca?", ts: t - 60_000 }],
  });
  const salida = await ambosModos(
    INMOBILIARIA,
    lead,
    [],
    [texto("¡Hola! Sí, sigue disponible. ¿Lo buscas para vivir o como inversión?")],
    0,
  );
  await expect(salida).toMatchFileSnapshot("__golden__/a4-inmobiliaria.txt");
});

// ---- (b) Leads de ejemplo ----

it("b-semilla", async () => {
  const { leads, reservas } = crearSemilla("Estudio de reformas", AHORA_B);
  const ordenadas = [...reservas].sort((a, b) => (a.huecoId < b.huecoId ? -1 : a.huecoId > b.huecoId ? 1 : 0));
  await expect(json({ leads, reservas: ordenadas })).toMatchFileSnapshot("__golden__/b-semilla.json");
});

// ---- (c) Calendario ----

it("c-agenda", async () => {
  // La receta está congelada con el archivo: mismo orden de consumo de azar() en cada caso.
  const azar = generador(7);
  const INICIO = Date.UTC(2026, 9, 1);
  const FIN = Date.UTC(2027, 2, 31, 23, 59);
  const HORAS = ["10:00", "12:30", "17:00"];
  const casos: unknown[] = [];
  for (let i = 0; i < 1000; i++) {
    const ahora = new Date(INICIO + Math.floor(azar() * (FIN - INICIO)));
    const fecha = fechaMadrid(ahora).fecha;
    const dias = diasLaborables(fecha, 60);
    const n = Math.floor(azar() * 41);
    // n sorteos; uno repetido no cuenta dos veces.
    const ids = new Set<string>();
    for (let k = 0; k < n; k++) {
      ids.add(`${dias[Math.floor(azar() * dias.length)]}T${HORAS[Math.floor(azar() * 3)]}`);
    }
    const ordenados = [...ids].sort();
    const reservas: Reserva[] = ordenados.map((huecoId, k) => ({
      huecoId,
      texto: textoHueco(huecoId),
      leadId: `l${k}`,
      nombre: "X",
      perfilNombre: "Y",
    }));
    const diaPedido = dias[Math.floor(azar() * dias.length)];
    const ver = verHuecos(reservas, ahora);
    casos.push({
      ahora: ahora.toISOString(),
      reservas: ordenados,
      ver,
      buscar: [
        {},
        { dia: diaPedido },
        { hora: "12:30" },
        { hora: "11:00" },
        { franja: "manana" as const },
        { franja: "tarde" as const },
        { dia: "3 de nov" },
        { dia: diaPedido, hora: "17:00" },
      ].map((p) => buscarHuecos(reservas, ahora, p)),
      libre: [ver[0]?.id ?? `${dias[0]}T10:00`, reservas[0]?.huecoId ?? `${dias[0]}T12:30`, `${fecha}T10:00`].map((id) =>
        huecoLibre(id, reservas, ahora),
      ),
      laborables: diasLaborables(fecha, 5),
      agenda: diasDeAgenda(ahora),
    });
  }
  const sha256 = createHash("sha256").update(JSON.stringify(canonico(casos))).digest("hex");
  const archivo =
    `{\n  "total": 1000,\n  "sha256": "${sha256}",\n  "casos": [\n` +
    casos
      .slice(0, 200)
      .map((caso) => `    ${JSON.stringify(canonico(caso))}`)
      .join(",\n") +
    "\n  ]\n}\n";
  await expect(archivo).toMatchFileSnapshot("__golden__/c-agenda.json");
});

// ---- (d) Textos y red de seguridad ----

it("d1-textos", async () => {
  const creadoA = Date.parse("2026-11-03T10:15:00Z");
  const leadA = crearLead({
    telefono: "34612345678",
    perfilId: "estudio-de-reformas",
    perfilNombre: "Estudio de reformas",
    nombre: "Laura Martínez",
    origen: "formulario",
    estado: "visita",
    creadoEn: creadoA,
    zona: "Gràcia",
    email: "laura@ejemplo.es",
    presupuesto: 6400,
    cobrado: 1000,
    visita: { id: "2026-11-05T10:00", texto: textoHueco("2026-11-05T10:00") },
    tareas: [
      { id: "t1", texto: "Preparar el presupuesto", vence: "2026-11-06", hecha: false, ts: creadoA + 60_000 },
      { id: "t2", texto: "Llamar para confirmar", hecha: true, ts: creadoA + 120_000 },
    ],
    notas: [
      { id: "n1", texto: "Quiere plato de ducha", ts: creadoA + 180_000 },
      { id: "n2", texto: "Prefiere tardes", ts: creadoA + 240_000 },
    ],
    datos: { tipo: "baño", metros: "6", plazo: "antes de Navidad" },
    etiquetas: ["baño", "financiación"],
  });
  const creadoB = creadoA + 86_400_000;
  const leadB = crearLead({
    telefono: "34698765432",
    perfilId: "estudio-de-reformas",
    perfilNombre: "Estudio de reformas",
    nombre: "Pol",
    origen: "whatsapp",
    estado: "conversacion",
    creadoEn: creadoB,
    notas: [{ id: "n1", texto: 'Dice "urgente"; mejor por la mañana', ts: creadoB + 60_000 }],
  });
  const salida = json({
    cabecera: csvDeLeads([]).split("\r\n")[0],
    csv: csvDeLeads([leadA, leadB]),
    nombreEtapa: NOMBRE_ETAPA,
    plantilla: textoPlantilla("Laura", "Estudio de reformas"),
  });
  await expect(salida).toMatchFileSnapshot("__golden__/d1-textos.json");
});

it("d2-revisar", async () => {
  const validas = verHuecos([], AHORA_A);
  const revisiones: Pick<RevisionRespuesta, "texto" | "reservo" | "pasoAPersona">[] = [
    { texto: "Te propongo martes 3 nov a las 10:00 o miércoles 4 nov a las 17:00.", reservo: false, pasoAPersona: false },
    { texto: "Hecho, martes a las 10:00.", reservo: false, pasoAPersona: false },
    { texto: "Hecho, martes a las 10:00.", reservo: true, pasoAPersona: false },
    { texto: "Un compañero te escribe hoy mismo.", reservo: false, pasoAPersona: false },
    { texto: "Un compañero te escribe hoy mismo.", reservo: false, pasoAPersona: true },
    { texto: "Te escribimos el día antes para confirmar.", reservo: true, pasoAPersona: false },
    { texto: "Listo, la visita queda cancelada.", reservo: false, pasoAPersona: false },
    { texto: "Son 6.400 € más o menos.", reservo: false, pasoAPersona: false },
    { texto: "Te hacemos un 10 % de descuento.", reservo: false, pasoAPersona: false },
    { texto: "Uso ver_huecos para mirarlo.", reservo: false, pasoAPersona: false },
    { texto: "A las 9:15 te va bien?", reservo: false, pasoAPersona: false },
    { texto: "Perfecto, ¿cuántos metros tiene?", reservo: false, pasoAPersona: false },
  ];
  const perfiles = { reformas: REFORMAS, inmobiliaria: INMOBILIARIA };
  const paraPersona: { texto: string; instrucciones: keyof typeof perfiles }[] = [
    { texto: "Prefiero hablar con una persona", instrucciones: "reformas" },
    { texto: "¿Me lo dejaríais en 400.000 €?", instrucciones: "inmobiliaria" },
    { texto: "¿Me lo dejaríais en 400.000 €?", instrucciones: "reformas" },
    { texto: "Tengo que hablar con alguien de mi banco primero", instrucciones: "reformas" },
  ];
  const importes = ["465.000 €", "400 mil euros", "1.200,50€", "sin precio"];
  const salida = json({
    revisarRespuesta: revisiones.map((entrada) => ({
      entrada,
      resultado: revisarRespuesta({ ...entrada, validas, instrucciones: REFORMAS }),
    })),
    motivoParaPersona: paraPersona.map((entrada) => ({
      entrada,
      resultado: motivoParaPersona(entrada.texto, perfiles[entrada.instrucciones]),
    })),
    importesCitados: importes.map((entrada) => ({ entrada, resultado: importesCitados(entrada) })),
  });
  await expect(salida).toMatchFileSnapshot("__golden__/d2-revisar.json");
});
