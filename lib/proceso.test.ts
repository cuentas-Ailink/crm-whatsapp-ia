import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SalidaAgente } from "./agente";
import type { Ejecucion } from "./buzon";
import { GUARDADA_VACIA, type ConfiguracionResuelta } from "./configuracion";
import type { Perfil } from "./perfil";
import { resolver } from "./presets";
import type { Entrante, Lead, Lote, Mutacion } from "./tipos";

// ---- Una base de datos en memoria con lo que hace guardarMutaciones ----

const bd = vi.hoisted(() => ({
  leads: new Map<string, Lead>(),
  guardadas: [] as Mutacion[][],
  actividad: new Map<string, string>(),
}));

function aplicar(m: Mutacion): void {
  if (m.t === "lead") {
    bd.leads.set(m.lead.id, structuredClone(m.lead));
    return;
  }
  const leadId = m.t === "reserva" ? m.reserva.leadId : m.leadId;
  const lead = bd.leads.get(leadId);
  if (!lead) return;
  if (m.t === "mensaje" && !lead.mensajes.some((x) => x.id === m.mensaje.id)) lead.mensajes.push(structuredClone(m.mensaje));
  else if (m.t === "estado" && lead.estado !== "persona") {
    lead.estado = m.estado;
    if (m.motivo && m.estado === "persona") lead.motivoPersona = m.motivo;
    bd.actividad.set(`estado-${leadId}-${m.ts}`, m.motivo ?? m.estado);
  } else if (m.t === "silencio" && !lead.silenciadoEn) lead.silenciadoEn = m.ts;
  else if (m.t === "permitir" && lead.silenciadoEn) {
    delete lead.silenciadoEn;
    bd.actividad.set(`permitir-${leadId}-${m.ts}`, m.por);
  } else if (m.t === "actividad" && !bd.actividad.has(m.id)) bd.actividad.set(m.id, m.texto);
  else if (m.t === "respuesta" && lead.msPrimeraRespuesta === undefined) lead.msPrimeraRespuesta = m.ms;
  else if (m.t === "dato") lead.datos[m.campo] = m.valor;
}

vi.mock("./bd", () => ({
  guardarMutaciones: vi.fn(async (ms: Mutacion[]) => {
    bd.guardadas.push(structuredClone(ms));
    for (const m of ms) aplicar(m);
  }),
  leerLead: vi.fn(async (id: string) => {
    const lead = bd.leads.get(id);
    return lead ? structuredClone(lead) : undefined;
  }),
  leerReservas: vi.fn(async () => []),
  mensajesDeClientesDesde: vi.fn(async () =>
    [...bd.leads.values()].flatMap((l) => l.mensajes.filter((m) => m.de === "cliente").map((m) => ({ telefono: l.telefono, texto: m.texto, ts: m.ts }))),
  ),
  registrarMensaje: vi.fn(async () => true),
}));

vi.mock("./whatsapp", async (original) => ({
  ...(await original<typeof import("./whatsapp")>()),
  enviarTexto: vi.fn(async () => "wamid.respuesta"),
  marcarLeido: vi.fn(async () => undefined),
}));

vi.mock("./aviso", () => ({ avisarComercial: vi.fn(async () => undefined) }));
vi.mock("./transcripcion", () => ({ transcribir: vi.fn(async () => "") }));
vi.mock("./configuracion-servidor", () => ({ configuracionActiva: vi.fn() }));
vi.mock("./agente", () => ({ ejecutarAgente: vi.fn() }));
vi.mock("./eventos", async (original) => ({
  ...(await original<typeof import("./eventos")>()),
  avisarLlegada: vi.fn(),
  avisarLlegadaFallida: vi.fn(),
  marcarEscribiendo: vi.fn(),
}));

const { ejecutarAgente } = await import("./agente");
const { avisarComercial } = await import("./aviso");
const { configuracionActiva } = await import("./configuracion-servidor");
const eventos = await import("./eventos");
const { ErrorWhatsApp, enviarTexto, marcarLeido } = await import("./whatsapp");
const { enmascararTelefono, idDeLead } = await import("./negocio");
const { procesarLote } = await import("./proceso");

// ---- Escenario ----

const PERFIL: Perfil = { id: "estudio-de-reformas", nombre: "Estudio de reformas", instrucciones: "# Instrucciones", hash: "" };
const TELEFONO = "34612345678";
const LEAD_ID = idDeLead(TELEFONO, PERFIL.id);
const PRESENTACION = "Soy el asistente virtual de Estudio de reformas.";

function configuracion(activo = true): { perfil: Perfil; config: ConfiguracionResuelta } {
  const config = resolver({ perfil: { id: PERFIL.id, nombre: PERFIL.nombre, hash: "" }, guardada: GUARDADA_VACIA, entorno: { NOMBRE_NEGOCIO: "Estudio de reformas" } });
  config.sistema.asistente.activo = activo;
  if (!activo) config.sistema.asistente.pausadoEn = 1;
  return { perfil: PERFIL, config };
}

let vez = 0;
function lote(texto: string, extra: Partial<Entrante> = {}): Lote {
  vez++;
  const entrante: Entrante = { wamid: `wamid.c${vez}`, telefono: TELEFONO, nombrePerfil: "Laura Martínez", tipo: "texto", texto, ts: Date.now() - 1000, ...extra };
  return { loteId: `lote-${vez}`, telefono: TELEFONO, mensajes: [entrante] };
}

const ejecucion = (): Ejecucion => ({ controlador: new AbortController(), enviando: false });

async function procesar(l: Lote): Promise<Ejecucion> {
  const e = ejecucion();
  await procesarLote(l, e);
  return e;
}

function existente(campos: Partial<Lead> = {}): Lead {
  const lead: Lead = {
    id: LEAD_ID,
    telefono: TELEFONO,
    perfilId: PERFIL.id,
    perfilNombre: "Estudio de reformas",
    nombre: "Laura",
    origen: "whatsapp",
    estado: "conversacion",
    datos: {},
    mensajes: [
      { id: "c0", de: "cliente", texto: "Hola", ts: 1000 },
      { id: "a0", de: "agente", texto: `¡Hola! ${PRESENTACION} ¿Qué quieres reformar?`, ts: 2000 },
    ],
    creadoEn: 1000,
    actualizadoEn: 2000,
    cambioEstadoEn: 1000,
    huecosOfrecidos: [],
    ...campos,
  };
  bd.leads.set(lead.id, structuredClone(lead));
  return lead;
}

const respuesta = (texto: string, mutaciones: Mutacion[] = [], extra: Partial<SalidaAgente> = {}): SalidaAgente => ({ texto, mutaciones, eventos: [], ...extra });
const mutaciones = () => bd.guardadas.flat();
const enviados = () => vi.mocked(enviarTexto).mock.calls.map((c) => c[1]);
const leadGuardado = () => bd.leads.get(LEAD_ID);

beforeEach(() => {
  bd.leads.clear();
  bd.guardadas.length = 0;
  bd.actividad.clear();
  vi.clearAllMocks();
  vi.mocked(configuracionActiva).mockImplementation(async () => configuracion());
  vi.mocked(ejecutarAgente).mockResolvedValue(respuesta("¡Hola! ¿Qué quieres reformar?"));
  vi.mocked(enviarTexto).mockResolvedValue("wamid.respuesta");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

// ---- Pruebas ----

describe("procesarLote", () => {
  it("en pausa guarda el mensaje, no contesta y no marca leído", async () => {
    vi.mocked(configuracionActiva).mockImplementation(async () => configuracion(false));
    const e = await procesar(lote("Hola, quiero reformar la cocina"));
    expect(leadGuardado()?.mensajes.map((m) => m.texto)).toEqual(["Hola, quiero reformar la cocina"]);
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(marcarLeido).not.toHaveBeenCalled();
    expect(ejecutarAgente).not.toHaveBeenCalled();
    expect(e.enviando).toBe(true);
  });

  it("la baja: una confirmación, la mutación silencio y después silencio", async () => {
    existente();
    await procesar(lote("No me escribáis más, por favor"));
    expect(enviados()).toEqual(["Entendido: no te escribiremos más por aquí. Si algún día lo necesitas, escríbenos y te atendemos."]);
    expect(mutaciones().filter((m) => m.t === "silencio")).toHaveLength(1);
    expect(leadGuardado()?.silenciadoEn).toEqual(expect.any(Number));
    expect(ejecutarAgente).not.toHaveBeenCalled();

    await procesar(lote("Vale, gracias"));
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect(leadGuardado()?.silenciadoEn).toEqual(expect.any(Number));
  });

  it("en pausa la baja se guarda sin mensaje", async () => {
    existente();
    vi.mocked(configuracionActiva).mockImplementation(async () => configuracion(false));
    await procesar(lote("No me escribáis más"));
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(leadGuardado()?.silenciadoEn).toEqual(expect.any(Number));
    expect(leadGuardado()?.mensajes.filter((m) => m.de === "agente")).toHaveLength(1);
  });

  it("silenciado y «gracias»: no contesta y sigue silenciado", async () => {
    existente({ silenciadoEn: 3000 });
    await procesar(lote("Gracias 👍"));
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(ejecutarAgente).not.toHaveBeenCalled();
    expect(marcarLeido).toHaveBeenCalledWith(expect.any(String), false);
    expect(mutaciones().some((m) => m.t === "permitir")).toBe(false);
    expect(leadGuardado()?.silenciadoEn).toBe(3000);
  });

  it("silenciado y una pregunta de verdad: permitir por el cliente y contesta", async () => {
    existente({ silenciadoEn: 3000 });
    vi.mocked(ejecutarAgente).mockResolvedValue(respuesta("Claro, ¿qué día te viene bien?"));
    await procesar(lote("¿Al final cuándo podéis venir?"));
    expect(mutaciones()).toContainEqual(expect.objectContaining({ t: "permitir", leadId: LEAD_ID, por: "cliente" }));
    expect(leadGuardado()?.silenciadoEn).toBeUndefined();
    expect(vi.mocked(ejecutarAgente).mock.calls[0][0].lead.silenciadoEn).toBeUndefined();
    expect(enviados()).toEqual(["Claro, ¿qué día te viene bien?"]);
  });

  it("se presenta solo en la primera respuesta", async () => {
    await procesar(lote("Hola, quiero reformar la cocina"));
    expect(enviados()[0]).toBe(`¡Hola! ${PRESENTACION} ¿Qué quieres reformar?`);
    vi.mocked(ejecutarAgente).mockResolvedValue(respuesta("¿Cuántos metros tiene?"));
    await procesar(lote("La cocina entera"));
    expect(enviados()[1]).toBe("¿Cuántos metros tiene?");
    // También las frases fijas: una foto como primer mensaje.
    bd.leads.clear();
    await procesar(lote("(foto)", { tipo: "otro", telefono: TELEFONO }));
    expect(enviados()[2]).toBe(`${PRESENTACION} ¿Me lo puedes escribir? Así no se me escapa nada`);
  });

  it("si se pausa mientras piensa, no envía nada", async () => {
    existente();
    vi.mocked(configuracionActiva).mockImplementationOnce(async () => configuracion(true)).mockImplementation(async () => configuracion(false));
    vi.mocked(ejecutarAgente).mockResolvedValue(respuesta("Perfecto, ¿cuántos metros?", [{ t: "dato", leadId: LEAD_ID, campo: "tipo", valor: "cocina", ts: 1 }]));
    const e = await procesar(lote("Quiero reformar la cocina"));
    expect(ejecutarAgente).toHaveBeenCalled();
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(mutaciones().some((m) => m.t === "dato")).toBe(false);
    expect(e.enviando).toBe(true);
  });

  it("escribiendo se pone y siempre se quita, también con error", async () => {
    existente();
    await procesar(lote("Quiero reformar la cocina"));
    expect(vi.mocked(eventos.marcarEscribiendo).mock.calls).toEqual([
      [LEAD_ID, true],
      [LEAD_ID, false],
    ]);
    vi.mocked(eventos.marcarEscribiendo).mockClear();
    vi.mocked(enviarTexto).mockRejectedValue(new Error("sin red"));
    await procesar(lote("¿Hola?"));
    expect(vi.mocked(eventos.marcarEscribiendo).mock.calls).toEqual([
      [LEAD_ID, true],
      [LEAD_ID, false],
    ]);
    vi.mocked(eventos.marcarEscribiendo).mockClear();
    vi.mocked(ejecutarAgente).mockRejectedValue(new Error("fallo"));
    await procesar(lote("¿Sigues ahí?"));
    expect(vi.mocked(eventos.marcarEscribiendo).mock.calls.at(-1)).toEqual([LEAD_ID, false]);
  });

  it("un lead de WhatsApp sin nombre se guarda enmascarado", async () => {
    await procesar(lote("Hola", { nombrePerfil: "" }));
    const nombre = leadGuardado()?.nombre;
    expect(nombre).toBe(enmascararTelefono(TELEFONO, "34"));
    expect(nombre).not.toContain("612345678");
    expect(leadGuardado()?.telefono).toBe(TELEFONO);
  });

  it("un lead nuevo de WhatsApp emite llegada con la hora del webhook", async () => {
    const recibidoEn = Date.now() - 1500;
    await procesar(lote("Hola", { recibidoEn }));
    expect(eventos.avisarLlegada).toHaveBeenCalledTimes(1);
    expect(eventos.avisarLlegada).toHaveBeenCalledWith({ leadId: LEAD_ID, nombre: "Laura", canal: "whatsapp", inicio: recibidoEn });
    await procesar(lote("¿Sigues?", { recibidoEn: Date.now() }));
    expect(eventos.avisarLlegada).toHaveBeenCalledTimes(1);
  });

  it("pide borrar sus datos: pasa a ti con el motivo, contesta la frase fija y avisa", async () => {
    existente();
    await procesar(lote("Quiero que borréis mis datos"));
    expect(ejecutarAgente).not.toHaveBeenCalled();
    expect(enviados()).toEqual(["Se lo paso a Estudio de reformas para que borre tus datos."]);
    expect(mutaciones()).toContainEqual(expect.objectContaining({ t: "estado", estado: "persona", motivo: "Pide que borres sus datos" }));
    expect(leadGuardado()?.estado).toBe("persona");
    expect(leadGuardado()?.mensajes.at(-1)).toMatchObject({ de: "agente", texto: "Se lo paso a Estudio de reformas para que borre tus datos." });
    expect(avisarComercial).toHaveBeenCalledWith(expect.objectContaining({ id: LEAD_ID }), "Pide que borres sus datos", "Quiero que borréis mis datos", expect.anything());
  });

  it("pide borrar sus datos y la baja: un solo mensaje y queda silenciado", async () => {
    existente();
    await procesar(lote("Dadme de baja y que borréis mis datos"));
    expect(enviados()).toEqual(["Se lo paso a Estudio de reformas para que borre tus datos."]);
    expect(leadGuardado()?.silenciadoEn).toEqual(expect.any(Number));
    expect(leadGuardado()?.estado).toBe("persona");
    expect(avisarComercial).toHaveBeenCalledTimes(1);
  });

  it("pide borrar sus datos en pausa: pasa a ti sin contestar", async () => {
    existente();
    vi.mocked(configuracionActiva).mockImplementation(async () => configuracion(false));
    await procesar(lote("Borrad mis datos, por favor"));
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(marcarLeido).not.toHaveBeenCalled();
    expect(leadGuardado()?.estado).toBe("persona");
    expect(avisarComercial).toHaveBeenCalledWith(expect.anything(), "Pide que borres sus datos", expect.any(String), expect.anything());
  });

  it("un cliente cerrado que vuelve a escribir deja una sola línea y el cierre sigue", async () => {
    existente({ cierre: "no", cierreEn: 5000, motivoCierre: "Precio" });
    await procesar(lote("Hola, al final me lo he pensado"));
    await procesar(lote("¿Podéis venir el jueves?"));
    const lineas = mutaciones().filter((m) => m.t === "actividad" && m.texto === "Ha vuelto a escribir");
    expect(lineas).toHaveLength(2);
    expect(new Set(lineas.map((m) => (m as { id: string }).id))).toEqual(new Set([`volvio-${LEAD_ID}-5000`]));
    expect([...bd.actividad.values()].filter((t) => t === "Ha vuelto a escribir")).toHaveLength(1);
    expect(leadGuardado()).toMatchObject({ cierre: "no", cierreEn: 5000 });
    expect(enviarTexto).toHaveBeenCalledTimes(2);
  });

  it("si Claude falla: disculpa, historial «No se ha podido contestar» y llegada-fallida en un lead nuevo", async () => {
    vi.mocked(ejecutarAgente).mockRejectedValue(Object.assign(new Error("Overloaded"), { statusCode: 529 }));
    await procesar(lote("Hola", { recibidoEn: Date.now() }));
    expect(enviados()).toEqual([`${PRESENTACION} Perdona, se me ha cortado. ¿Me lo repites?`]);
    expect(mutaciones()).toContainEqual(expect.objectContaining({ t: "actividad", texto: "No se ha podido contestar: Claude está saturado ahora mismo" }));
    expect(eventos.avisarLlegadaFallida).toHaveBeenCalledWith({ leadId: LEAD_ID, nombre: "Laura", codigo: "claude.ocupado", texto: "Claude está saturado ahora mismo" });

    // La causa del AI SDK también cuenta; descartada dos veces, sin estado: «Algo ha fallado». Ya no es nuevo: sin llegada-fallida.
    vi.mocked(eventos.avisarLlegadaFallida).mockClear();
    vi.mocked(ejecutarAgente).mockRejectedValue(new Error("respuesta descartada: hora inventada"));
    await procesar(lote("¿Hola?"));
    expect(mutaciones()).toContainEqual(expect.objectContaining({ t: "actividad", texto: "No se ha podido contestar: Algo ha fallado" }));
    expect(eventos.avisarLlegadaFallida).not.toHaveBeenCalled();

    vi.mocked(ejecutarAgente).mockRejectedValue(new Error("envoltorio", { cause: { statusCode: 401, message: "invalid x-api-key" } }));
    await procesar(lote("¿Sigues?"));
    expect(mutaciones()).toContainEqual(expect.objectContaining({ t: "actividad", texto: "No se ha podido contestar: Esa clave no es válida" }));
  });

  it("si Meta falla al enviar: historial y nada más", async () => {
    vi.mocked(ejecutarAgente).mockResolvedValue(respuesta("¿Cuántos metros?", [{ t: "dato", leadId: LEAD_ID, campo: "tipo", valor: "cocina", ts: 1 }]));
    vi.mocked(enviarTexto).mockRejectedValue(new ErrorWhatsApp("Ese número no puede recibir WhatsApp. Compruébalo con el cliente.", 131026));
    await procesar(lote("Quiero reformar la cocina", { recibidoEn: Date.now() }));
    const guardado = leadGuardado();
    expect(guardado?.mensajes.filter((m) => m.de === "agente")).toHaveLength(0);
    expect(guardado?.datos).toEqual({});
    expect(guardado?.msPrimeraRespuesta).toBeUndefined();
    expect(mutaciones()).toContainEqual(expect.objectContaining({ t: "actividad", texto: "No se ha podido contestar: Ese número no puede recibir WhatsApp" }));
    expect(eventos.avisarLlegadaFallida).toHaveBeenCalledWith(expect.objectContaining({ codigo: "meta.numero" }));
  });

  it("msPrimeraRespuesta se guarda una vez y no con la disculpa", async () => {
    await procesar(lote("Hola", { recibidoEn: Date.now() - 4000 }));
    const primeras = mutaciones().filter((m) => m.t === "respuesta");
    expect(primeras).toHaveLength(1);
    expect((primeras[0] as { ms: number }).ms).toBeGreaterThanOrEqual(4000);
    expect(leadGuardado()?.mensajes.at(-1)).toMatchObject({ id: "wamid.respuesta", de: "agente", entrega: "enviado" });
    await procesar(lote("Una cocina", { recibidoEn: Date.now() }));
    expect(mutaciones().filter((m) => m.t === "respuesta")).toHaveLength(1);

    // Un lead nuevo cuya primera respuesta es la disculpa: no cuenta.
    bd.leads.clear();
    bd.guardadas.length = 0;
    vi.mocked(ejecutarAgente).mockRejectedValue(new Error("fallo"));
    await procesar(lote("Hola", { recibidoEn: Date.now() }));
    expect(mutaciones().filter((m) => m.t === "respuesta")).toHaveLength(0);
  });

  it("la regla de spam no se aplica a quien añadiste tú", async () => {
    const SPAM = "Gana dinero desde casa con nuestra oferta exclusiva: https://bit.ly/abc123";
    existente({ origen: "manual", estado: "nuevo", mensajes: [] });
    await procesar(lote(SPAM));
    expect(leadGuardado()?.estado).not.toBe("spam");
    expect(ejecutarAgente).toHaveBeenCalledTimes(1);

    bd.leads.clear();
    existente({ origen: "whatsapp", estado: "nuevo", mensajes: [] });
    await procesar(lote(SPAM));
    expect(leadGuardado()?.estado).toBe("spam");
    expect(ejecutarAgente).toHaveBeenCalledTimes(1);
  });

  it("el mensaje del botón de la web: el cliente nuevo viene de tu web y se le contesta con un texto normal", async () => {
    // Con otros signos, en minúscula y con un emoji al final sigue siendo el mensaje del botón.
    await procesar(lote("hola quiero pedir presupuesto para una reforma 🙂", { recibidoEn: Date.now() - 500 }));
    expect(leadGuardado()?.fuente).toEqual({ tipo: "web" });
    expect(leadGuardado()?.origen).toBe("whatsapp");
    expect(enviados()).toHaveLength(1);
    expect(leadGuardado()?.msPrimeraRespuesta).toEqual(expect.any(Number));
  });

  it("el botón de la web: un texto con otras palabras, un anuncio o un cliente que ya existía no son de la web", async () => {
    await procesar(lote("Hola, quiero pedir presupuesto para una reforma del baño"));
    expect(leadGuardado()?.fuente).toBeUndefined();

    bd.leads.clear();
    await procesar(lote("Hola, quiero pedir presupuesto para una reforma.", { referido: { source_type: "ad", headline: "Reforma tu baño" } }));
    expect(leadGuardado()?.fuente).toEqual({ tipo: "anuncio", plataforma: "Meta", anuncio: "Reforma tu baño" });

    bd.leads.clear();
    existente();
    await procesar(lote("Hola, quiero pedir presupuesto para una reforma."));
    expect(leadGuardado()?.fuente).toBeUndefined();
  });

  it("el botón de la web con un mensaje propio que nombra al negocio", async () => {
    vi.mocked(configuracionActiva).mockImplementation(async () => {
      const c = configuracion();
      c.config.web = { entrada: "whatsapp", mensaje: "Hola {negocio}, quiero cita" };
      return c;
    });
    await procesar(lote("Hola Estudio de reformas, quiero cita!"));
    expect(leadGuardado()?.fuente).toEqual({ tipo: "web" });
  });
});
