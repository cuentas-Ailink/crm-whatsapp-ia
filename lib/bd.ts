import { createHash } from "node:crypto";
import type { DatosDeCliente } from "./api-tipos";
import {
  type ConfiguracionGuardada,
  type CopiaInstrucciones,
  type CopiasInstrucciones,
  CUERPO_POR_DEFECTO,
  CUERPOS_CONOCIDOS,
  LIMITES,
  normalizarGuardada,
} from "./configuracion";
import { type Conexion, type Consultas, conectar } from "./conexion";
import { avisarCambio } from "./eventos";
import { log, recortar } from "./log";
import { esEjemplo, NOMBRE_ETAPA } from "./negocio";
import { formatoImporte } from "./regional";
import { crearSemilla, OPCIONES_POR_DEFECTO } from "./semilla";
import type { OpcionesSemilla, SemillaGenerada } from "./semillas/tipos";
import type {
  Ajustes,
  Actividad,
  Bd,
  CambioEntrega,
  CambiosFicha,
  CambiosProyecto,
  Cierre,
  EstadoEntrega,
  EstadoLead,
  EstadoObra,
  FuenteLead,
  Hueco,
  Lead,
  Mensaje,
  MotivoNoSigue,
  Mutacion,
  Nota,
  Proyecto,
  Reserva,
  Tarea,
} from "./tipos";

// La base de datos del CRM: Postgres, en PGlite (la carpeta `datos`) o en Supabase. Guarda leads,
// mensajes, visitas, la configuración del negocio e ids de mensajes ya procesados. Las tablas se
// crean solas la primera vez que se conecta, así que no hay que preparar nada. La conexión vive en
// globalThis porque Next puede cargar este módulo una vez por cada ruta.

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
    id text PRIMARY KEY,
    telefono text NOT NULL,
    perfil_id text NOT NULL,
    perfil_nombre text NOT NULL,
    nombre text NOT NULL,
    email text,
    zona text,
    origen text NOT NULL CHECK (origen IN ('formulario', 'whatsapp', 'prueba', 'manual')),
    estado text NOT NULL CHECK (estado IN ('nuevo', 'conversacion', 'visita', 'persona', 'spam')),
    datos jsonb NOT NULL,
    huecos_ofrecidos jsonb NOT NULL,
    motivo_persona text,
    motivo_spam text,
    ms_primer_whatsapp integer,
    creado_en bigint NOT NULL,
    actualizado_en bigint NOT NULL,
    cambio_estado_en bigint NOT NULL
  )`,
  // `orden` es el orden en que entraron los mensajes: la hora de Meta solo tiene segundos.
  `CREATE TABLE IF NOT EXISTS mensajes (
    orden bigint GENERATED ALWAYS AS IDENTITY,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    id text NOT NULL,
    de text NOT NULL CHECK (de IN ('cliente', 'agente')),
    texto text NOT NULL,
    ts bigint NOT NULL,
    plantilla boolean NOT NULL DEFAULT false,
    audio boolean NOT NULL DEFAULT false,
    manual boolean NOT NULL DEFAULT false,
    PRIMARY KEY (lead_id, id)
  )`,
  "CREATE INDEX IF NOT EXISTS mensajes_por_lead ON mensajes (lead_id, orden)",
  // Un hueco, una visita, y una visita por lead: la base de datos no admite otra cosa.
  `CREATE TABLE IF NOT EXISTS visitas (
    hueco_id text PRIMARY KEY,
    lead_id text NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    texto text NOT NULL,
    nombre text NOT NULL,
    perfil_nombre text NOT NULL,
    prueba boolean NOT NULL
  )`,
  // Lo que anota el equipo a mano. Se borran con su lead.
  `CREATE TABLE IF NOT EXISTS notas (
    id text PRIMARY KEY,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    texto text NOT NULL,
    ts bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tareas (
    id text PRIMARY KEY,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    texto text NOT NULL,
    vence text,
    hecha boolean NOT NULL DEFAULT false,
    ts bigint NOT NULL
  )`,
  // Columnas nuevas de la ficha. Con IF NOT EXISTS, una base que ya existe las recibe sin perder nada.
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS presupuesto integer",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS cobrado integer",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS etiquetas jsonb NOT NULL DEFAULT '[]'",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS ejemplo boolean NOT NULL DEFAULT false",
  // La línea de tiempo de la ficha. El id es fijo cuando viene del asistente, así repetir un lote no la duplica.
  `CREATE TABLE IF NOT EXISTS actividad (
    id text PRIMARY KEY,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    texto text NOT NULL,
    ts bigint NOT NULL
  )`,
  // Las obras de antes. El panel de la v1.0 ya no las usa y no se siembran; la tabla se queda.
  `CREATE TABLE IF NOT EXISTS proyectos (
    id text PRIMARY KEY,
    foto integer NOT NULL,
    tipo text NOT NULL,
    barrio text NOT NULL,
    estado text NOT NULL CHECK (estado IN ('Proyecto', 'Licencias', 'En obra', 'Acabados', 'Entregada')),
    avance integer NOT NULL CHECK (avance BETWEEN 0 AND 100),
    descripcion text NOT NULL,
    lead_id text REFERENCES leads(id) ON DELETE SET NULL
  )`,
  "CREATE TABLE IF NOT EXISTS mensajes_procesados (wamid text PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS ajustes (id integer PRIMARY KEY CHECK (id = 1), leads_prueba boolean NOT NULL)",
  // Columnas de la v1: silencio, origen del anuncio, cierre, estado de entrega y configuración del negocio.
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS silenciado_en bigint",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS fuente jsonb",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS ms_primera_respuesta integer",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS cierre text CHECK (cierre IN ('si', 'no'))",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS cierre_en bigint",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_cierre text",
  "ALTER TABLE leads ADD COLUMN IF NOT EXISTS vuelta_vista_en bigint",
  // Una base de antes no admite 'manual' en origen: la regla se quita y se vuelve a poner, siempre en este orden.
  "ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_origen_check",
  "ALTER TABLE leads ADD CONSTRAINT leads_origen_check CHECK (origen IN ('formulario', 'whatsapp', 'prueba', 'manual'))",
  "ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS entrega text",
  "ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS fallo text",
  "ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS plantilla_nombre text",
  "CREATE INDEX IF NOT EXISTS mensajes_por_id ON mensajes (id)",
  "ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS configuracion jsonb NOT NULL DEFAULT '{}'",
  "ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS logos jsonb NOT NULL DEFAULT '{}'",
  "ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS ejemplos_de text",
  "ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS instrucciones jsonb NOT NULL DEFAULT '{}'",
  // Con RLS y sin políticas, la API pública de Supabase no puede leer ni escribir nada: hay
  // teléfonos y conversaciones reales. Solo entra el servidor, con la cadena de conexión.
  ...["leads", "mensajes", "visitas", "notas", "tareas", "actividad", "proyectos", "mensajes_procesados", "ajustes"].map(
    (tabla) => `ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`,
  ),
];

/** Cualquier número fijo vale: es la llave para que dos procesos no creen las tablas a la vez. */
const LLAVE_ESQUEMA = 7_301_224;

interface FilaLead {
  id: string;
  telefono: string;
  perfil_id: string;
  perfil_nombre: string;
  nombre: string;
  email: string | null;
  zona: string | null;
  origen: Lead["origen"];
  estado: Lead["estado"];
  datos: Record<string, string>;
  huecos_ofrecidos: Hueco[];
  motivo_persona: string | null;
  motivo_spam: string | null;
  ms_primer_whatsapp: number | null;
  presupuesto: number | null;
  cobrado: number | null;
  etiquetas: string[];
  ejemplo: boolean;
  creado_en: number;
  actualizado_en: number;
  cambio_estado_en: number;
  silenciado_en: number | null;
  fuente: FuenteLead | null;
  ms_primera_respuesta: number | null;
  cierre: Cierre | null;
  cierre_en: number | null;
  motivo_cierre: MotivoNoSigue | null;
  vuelta_vista_en: number | null;
}

interface FilaMensaje {
  lead_id: string;
  id: string;
  de: Mensaje["de"];
  texto: string;
  ts: number;
  plantilla: boolean;
  audio: boolean;
  manual: boolean;
  entrega: EstadoEntrega | null;
  fallo: string | null;
  plantilla_nombre: string | null;
}

interface FilaVisita {
  hueco_id: string;
  lead_id: string;
  texto: string;
  nombre: string;
  perfil_nombre: string;
  prueba: boolean;
}

interface FilaNota {
  id: string;
  lead_id: string;
  texto: string;
  ts: number;
}

interface FilaTarea {
  id: string;
  lead_id: string;
  texto: string;
  vence: string | null;
  hecha: boolean;
  ts: number;
}

interface FilaActividad {
  id: string;
  lead_id: string;
  texto: string;
  ts: number;
}

interface FilaProyecto {
  id: string;
  foto: number;
  tipo: string;
  barrio: string;
  estado: EstadoObra;
  avance: number;
  descripcion: string;
  lead_id: string | null;
}

function aProyecto(f: FilaProyecto): Proyecto {
  return {
    id: f.id,
    foto: Number(f.foto),
    tipo: f.tipo,
    barrio: f.barrio,
    estado: f.estado,
    avance: Number(f.avance),
    descripcion: f.descripcion,
    ...(f.lead_id ? { leadId: f.lead_id } : {}),
  };
}

/** Devuelve false si esa obra no existe. La tabla se queda, aunque el panel de la v1.0 ya no la usa. */
export async function editarProyecto(id: string, cambios: CambiosProyecto): Promise<boolean> {
  const asignaciones: string[] = [];
  const valores: unknown[] = [];
  if (cambios.estado !== undefined) {
    valores.push(cambios.estado);
    asignaciones.push(`estado = $${valores.length}`);
  }
  if (cambios.avance !== undefined) {
    valores.push(cambios.avance);
    asignaciones.push(`avance = $${valores.length}`);
  }
  if (cambios.leadId !== undefined) {
    valores.push(cambios.leadId);
    asignaciones.push(`lead_id = $${valores.length}`);
  }
  if (!asignaciones.length) return (await filas("SELECT id FROM proyectos WHERE id = $1", [id])).length > 0;
  valores.push(id);
  const cambiada = (await ejecutar(`UPDATE proyectos SET ${asignaciones.join(", ")} WHERE id = $${valores.length}`, valores)) > 0;
  if (cambiada) avisarCambio("leads");
  return cambiada;
}

const global_ = globalThis as unknown as { __bd?: Promise<Conexion> };

/** Se conecta al primer uso: `next build` carga las rutas y no debe conectarse. */
function abrir(): Promise<Conexion> {
  global_.__bd ??= preparar().catch((error) => {
    // Sin internet, con la cadena mal puesta o con otro CRM abierto: la siguiente petición lo vuelve a intentar.
    global_.__bd = undefined;
    throw error;
  });
  return global_.__bd;
}

/**
 * Las opciones de los ejemplos cuando nadie las da: el arranque y el reinicio sin configuración.
 * La plantilla sigue la regla E1: con PLANTILLA o PLANTILLA_IDIOMA en .env, el cuerpo de esa plantilla.
 * No lee agente.md ni la caché de la configuración: se llama dentro de la transacción del arranque.
 */
function opcionesPorDefecto(): OpcionesSemilla {
  const plantilla =
    process.env.PLANTILLA || process.env.PLANTILLA_IDIOMA
      ? (CUERPOS_CONOCIDOS[process.env.PLANTILLA || "solicitud_recibida"] ?? CUERPO_POR_DEFECTO)
      : OPCIONES_POR_DEFECTO.plantilla;
  return { ...OPCIONES_POR_DEFECTO, negocio: process.env.NOMBRE_NEGOCIO || "Estudio de reformas", plantilla };
}

async function preparar(): Promise<Conexion> {
  const bd = await conectar();
  let sembrada = false;
  try {
    await bd.transaccion(async (c) => {
      await c.filas("SELECT pg_advisory_xact_lock($1)", [LLAVE_ESQUEMA]);
      for (const sentencia of ESQUEMA) await c.ejecutar(sentencia);
      // La primera vez no hay nada guardado: se crean los ejemplos. Después, nunca más al arrancar.
      if (await c.ejecutar("INSERT INTO ajustes (id, leads_prueba) VALUES (1, true) ON CONFLICT DO NOTHING")) {
        const o = opcionesPorDefecto();
        await insertarSemilla(c, crearSemilla(o.negocio, new Date(), o));
        await c.ejecutar("UPDATE ajustes SET ejemplos_de = $1 WHERE id = 1", [o.sector]);
        sembrada = true;
      }
    });
  } catch (error) {
    await bd.cerrar().catch(() => {});
    throw error;
  }
  if (sembrada) avisarCambio("leads");
  return bd;
}

async function filas<T>(sql: string, parametros: unknown[] = []): Promise<T[]> {
  return (await abrir()).filas<T>(sql, parametros);
}

async function ejecutar(sql: string, parametros: unknown[] = []): Promise<number> {
  return (await abrir()).ejecutar(sql, parametros);
}

async function transaccion(trabajo: (c: Consultas) => Promise<void>): Promise<void> {
  await (await abrir()).transaccion(trabajo);
}

/** El JSON va como texto y lo convierte Postgres (`$1::text::jsonb`): así los dos motores lo pasan igual. */
const json = (valor: unknown) => JSON.stringify(valor);

// ---- Lectura ----

function aMensaje(f: FilaMensaje): Mensaje {
  return {
    id: f.id,
    de: f.de,
    texto: f.texto,
    ts: Number(f.ts),
    ...(f.plantilla ? { plantilla: true } : {}),
    ...(f.audio ? { audio: true } : {}),
    ...(f.manual ? { manual: true } : {}),
    ...(f.entrega ? { entrega: f.entrega } : {}),
    ...(f.fallo ? { fallo: f.fallo } : {}),
    ...(f.plantilla_nombre ? { nombrePlantilla: f.plantilla_nombre } : {}),
  };
}

function aReserva(f: FilaVisita): Reserva {
  return {
    huecoId: f.hueco_id,
    texto: f.texto,
    leadId: f.lead_id,
    nombre: f.nombre,
    perfilNombre: f.perfil_nombre,
    ...(f.prueba ? { prueba: true } : {}),
  };
}

function aNota(f: FilaNota): Nota {
  return { id: f.id, texto: f.texto, ts: Number(f.ts) };
}

function aTarea(f: FilaTarea): Tarea {
  return { id: f.id, texto: f.texto, hecha: f.hecha, ts: Number(f.ts), ...(f.vence ? { vence: f.vence } : {}) };
}

function aActividad(f: FilaActividad): Actividad {
  return { id: f.id, texto: f.texto, ts: Number(f.ts) };
}

function aLead(
  f: FilaLead,
  mensajes: Mensaje[],
  reserva?: Reserva,
  notas: Nota[] = [],
  tareas: Tarea[] = [],
  actividad: Actividad[] = [],
): Lead {
  const visita: Hueco | undefined = reserva && { id: reserva.huecoId, texto: reserva.texto };
  return {
    id: f.id,
    telefono: f.telefono,
    perfilId: f.perfil_id,
    perfilNombre: f.perfil_nombre,
    nombre: f.nombre,
    origen: f.origen,
    estado: f.estado,
    datos: f.datos,
    mensajes,
    creadoEn: Number(f.creado_en),
    actualizadoEn: Number(f.actualizado_en),
    cambioEstadoEn: Number(f.cambio_estado_en),
    huecosOfrecidos: f.huecos_ofrecidos,
    ...(f.email ? { email: f.email } : {}),
    ...(f.zona ? { zona: f.zona } : {}),
    ...(f.ms_primer_whatsapp !== null ? { msPrimerWhatsApp: Number(f.ms_primer_whatsapp) } : {}),
    ...(visita ? { visita } : {}),
    ...(f.motivo_persona ? { motivoPersona: f.motivo_persona } : {}),
    ...(f.motivo_spam ? { motivoSpam: f.motivo_spam } : {}),
    ...(f.presupuesto !== null ? { presupuesto: Number(f.presupuesto) } : {}),
    ...(f.cobrado !== null ? { cobrado: Number(f.cobrado) } : {}),
    ...(notas.length ? { notas } : {}),
    ...(tareas.length ? { tareas } : {}),
    ...(f.etiquetas.length ? { etiquetas: f.etiquetas } : {}),
    ...(f.ejemplo ? { ejemplo: true } : {}),
    ...(actividad.length ? { actividad } : {}),
    ...(f.silenciado_en != null ? { silenciadoEn: Number(f.silenciado_en) } : {}),
    ...(f.fuente ? { fuente: f.fuente } : {}),
    ...(f.ms_primera_respuesta != null ? { msPrimeraRespuesta: Number(f.ms_primera_respuesta) } : {}),
    ...(f.cierre ? { cierre: f.cierre } : {}),
    ...(f.cierre_en != null ? { cierreEn: Number(f.cierre_en) } : {}),
    ...(f.motivo_cierre ? { motivoCierre: f.motivo_cierre } : {}),
    ...(f.vuelta_vista_en != null ? { vueltaVistaEn: Number(f.vuelta_vista_en) } : {}),
  };
}

export async function leerReservas(): Promise<Reserva[]> {
  return (await filas<FilaVisita>("SELECT * FROM visitas ORDER BY hueco_id")).map(aReserva);
}

export async function leerLead(id: string): Promise<Lead | undefined> {
  const [[fila], mensajes, [visita], notas, tareas, actividad] = await Promise.all([
    filas<FilaLead>("SELECT * FROM leads WHERE id = $1", [id]),
    filas<FilaMensaje>("SELECT * FROM mensajes WHERE lead_id = $1 ORDER BY orden", [id]),
    filas<FilaVisita>("SELECT * FROM visitas WHERE lead_id = $1", [id]),
    filas<FilaNota>("SELECT * FROM notas WHERE lead_id = $1 ORDER BY ts, id", [id]),
    filas<FilaTarea>("SELECT * FROM tareas WHERE lead_id = $1 ORDER BY ts, id", [id]),
    filas<FilaActividad>("SELECT * FROM actividad WHERE lead_id = $1 ORDER BY ts, id", [id]),
  ]);
  if (!fila) return undefined;
  return aLead(
    fila,
    mensajes.map(aMensaje),
    visita && aReserva(visita),
    notas.map(aNota),
    tareas.map(aTarea),
    actividad.map(aActividad),
  );
}

interface FilaAjustes {
  leads_prueba: boolean;
  ejemplos_de: string | null;
  configuracion: unknown;
}

/**
 * Todo lo que enseña el panel y la configuración guardada, de una vez. De los ajustes nunca se leen
 * los logos ni las copias de las instrucciones: pueden pesar y el panel lee esto cada 3 s.
 */
export async function leerBdYGuardada(): Promise<{ bd: Bd; guardada: unknown }> {
  const [reservas, filasMensajes, filasLeads, filasNotas, filasTareas, filasActividad, filasProyectos, [fila]] = await Promise.all([
    leerReservas(),
    filas<FilaMensaje>("SELECT * FROM mensajes ORDER BY orden"),
    filas<FilaLead>("SELECT * FROM leads ORDER BY creado_en, id"),
    filas<FilaNota>("SELECT * FROM notas ORDER BY ts, id"),
    filas<FilaTarea>("SELECT * FROM tareas ORDER BY ts, id"),
    filas<FilaActividad>("SELECT * FROM actividad ORDER BY ts, id"),
    filas<FilaProyecto>("SELECT * FROM proyectos ORDER BY foto"),
    filas<FilaAjustes>("SELECT leads_prueba, ejemplos_de, configuracion FROM ajustes WHERE id = 1"),
  ]);
  const porLead = new Map(reservas.map((r) => [r.leadId, r]));
  const mensajes = new Map<string, Mensaje[]>();
  for (const f of filasMensajes) {
    const lista = mensajes.get(f.lead_id) ?? [];
    lista.push(aMensaje(f));
    mensajes.set(f.lead_id, lista);
  }
  const notas = new Map<string, Nota[]>();
  for (const f of filasNotas) notas.set(f.lead_id, [...(notas.get(f.lead_id) ?? []), aNota(f)]);
  const tareas = new Map<string, Tarea[]>();
  for (const f of filasTareas) tareas.set(f.lead_id, [...(tareas.get(f.lead_id) ?? []), aTarea(f)]);
  const actividad = new Map<string, Actividad[]>();
  for (const f of filasActividad) actividad.set(f.lead_id, [...(actividad.get(f.lead_id) ?? []), aActividad(f)]);
  const leads: Bd["leads"] = {};
  for (const f of filasLeads) {
    leads[f.id] = aLead(
      f,
      mensajes.get(f.id) ?? [],
      porLead.get(f.id),
      notas.get(f.id) ?? [],
      tareas.get(f.id) ?? [],
      actividad.get(f.id) ?? [],
    );
  }
  // Una base de antes de la v1.0 no sabe de qué sector son sus ejemplos: entonces eran siempre de reformas.
  const ejemplosDe = fila?.ejemplos_de || (Object.values(leads).some(esEjemplo) ? "reformas" : null);
  const ajustes: Ajustes = { leadsPrueba: fila?.leads_prueba === true, ...(ejemplosDe ? { ejemplosDe } : {}) };
  return { bd: { leads, reservas, ajustes, proyectos: filasProyectos.map(aProyecto) }, guardada: fila?.configuracion ?? {} };
}

/** Todo lo que enseña el panel. */
export async function leerBd(): Promise<Bd> {
  return (await leerBdYGuardada()).bd;
}

/** La configuración del negocio tal como está guardada, o `{}`. */
export async function leerConfiguracionGuardada(): Promise<unknown> {
  const [fila] = await filas<{ configuracion: unknown }>("SELECT configuracion FROM ajustes WHERE id = 1");
  return fila?.configuracion ?? {};
}

/**
 * Cambia la configuración guardada sin pisar otro cambio a la vez: lee con FOR UPDATE, aplica `f` y
 * guarda el resultado entero (nunca `||` ni `jsonb_set`: no llegan a las claves de dentro). Con
 * `o.renombrar`, en la misma transacción, el nombre del negocio de ese perfil en sus leads y visitas.
 */
export async function modificarConfiguracionGuardada(
  f: (actual: unknown) => ConfiguracionGuardada,
  o?: { renombrar?: { perfilId: string; nombre: string } },
): Promise<ConfiguracionGuardada> {
  let nueva: ConfiguracionGuardada | undefined;
  await transaccion(async (c) => {
    const [fila] = await c.filas<{ configuracion: unknown }>("SELECT configuracion FROM ajustes WHERE id = 1 FOR UPDATE");
    const resultado = f(fila?.configuracion ?? {});
    await c.ejecutar("UPDATE ajustes SET configuracion = $1::text::jsonb WHERE id = 1", [json(resultado)]);
    if (o?.renombrar) {
      const { perfilId, nombre } = o.renombrar;
      await c.ejecutar("UPDATE leads SET perfil_nombre = $2 WHERE perfil_id = $1", [perfilId, nombre]);
      await c.ejecutar(
        "UPDATE visitas v SET perfil_nombre = $2 FROM leads l WHERE v.lead_id = l.id AND l.perfil_id = $1",
        [perfilId, nombre],
      );
    }
    nueva = resultado;
  });
  avisarCambio("configuracion");
  if (o?.renombrar) avisarCambio("leads");
  return nueva as ConfiguracionGuardada;
}

/** Las copias de las instrucciones de cada perfil, por id de perfil. */
export async function leerCopiasInstrucciones(): Promise<CopiasInstrucciones> {
  const [fila] = await filas<{ instrucciones: unknown }>("SELECT instrucciones FROM ajustes WHERE id = 1");
  const copias = fila?.instrucciones;
  return copias && typeof copias === "object" && !Array.isArray(copias) ? (copias as CopiasInstrucciones) : {};
}

/** Guarda la copia de las instrucciones de un perfil; `null` la quita. */
export async function guardarCopiaInstrucciones(perfilId: string, copia: CopiaInstrucciones | null): Promise<void> {
  if (copia === null) {
    await ejecutar("UPDATE ajustes SET instrucciones = instrucciones - $1::text WHERE id = 1", [perfilId]);
  } else {
    if (copia.texto.length > LIMITES.copia) throw new Error("Las instrucciones guardadas no pueden pasar de 12.000 caracteres");
    await ejecutar("UPDATE ajustes SET instrucciones = jsonb_set(instrucciones, ARRAY[$1::text], $2::text::jsonb) WHERE id = 1", [
      perfilId,
      json(copia),
    ]);
  }
  avisarCambio("configuracion");
}

/** El logo de un perfil como data URL, o null. Va aparte de la configuración: pesa. */
export async function leerLogo(perfilId: string): Promise<string | null> {
  const [fila] = await filas<{ logo: string | null }>("SELECT logos ->> $1 AS logo FROM ajustes WHERE id = 1", [perfilId]);
  return fila?.logo ?? null;
}

/**
 * Guarda el logo de un perfil (`null` lo quita) y apunta su versión en la configuración, para que el
 * navegador no se quede con el de antes. La versión sale del contenido: otro logo, otra versión.
 */
export async function guardarLogo(perfilId: string, dataUrl: string | null): Promise<string | null> {
  const version = dataUrl === null ? null : createHash("sha1").update(dataUrl).digest("hex").slice(0, 12);
  await transaccion(async (c) => {
    const [fila] = await c.filas<{ configuracion: unknown }>("SELECT configuracion FROM ajustes WHERE id = 1 FOR UPDATE");
    if (dataUrl === null) await c.ejecutar("UPDATE ajustes SET logos = logos - $1::text WHERE id = 1", [perfilId]);
    else {
      await c.ejecutar("UPDATE ajustes SET logos = jsonb_set(logos, ARRAY[$1::text], to_jsonb($2::text)) WHERE id = 1", [
        perfilId,
        dataUrl,
      ]);
    }
    const guardada = normalizarGuardada(fila?.configuracion ?? {});
    const perfil = guardada.perfiles[perfilId];
    if (version) guardada.perfiles[perfilId] = { ...perfil, negocio: { ...perfil?.negocio, logoVersion: version } };
    else if (perfil?.negocio) {
      const { logoVersion: _quitada, ...negocio } = perfil.negocio;
      guardada.perfiles[perfilId] = { ...perfil, negocio };
    }
    guardada.rev += 1;
    await c.ejecutar("UPDATE ajustes SET configuracion = $1::text::jsonb WHERE id = 1", [json(guardada)]);
  });
  avisarCambio("configuracion");
  return version;
}

/** Vuelve a la configuración del preset: borra lo guardado, los logos y las copias de las instrucciones. */
export async function restablecerConfiguracion(): Promise<void> {
  await ejecutar("UPDATE ajustes SET configuracion = '{}'::jsonb, logos = '{}'::jsonb, instrucciones = '{}'::jsonb WHERE id = 1");
  avisarCambio("configuracion");
}

/** Cuántos leads son de ejemplo y cuántos de verdad. */
export async function contarEjemplos(): Promise<{ ejemplo: number; reales: number }> {
  const [fila] = await filas<{ ejemplo: number; reales: number }>(
    `SELECT count(*) FILTER (WHERE ejemplo OR origen = 'prueba') AS ejemplo,
       count(*) FILTER (WHERE NOT (ejemplo OR origen = 'prueba')) AS reales FROM leads`,
  );
  return { ejemplo: Number(fila?.ejemplo ?? 0), reales: Number(fila?.reales ?? 0) };
}

/** Si ya ha escrito algún cliente de verdad: los ejemplos y las pruebas no cuentan. */
export async function hayMensajeRealDeCliente(): Promise<boolean> {
  const [fila] = await filas<{ hay: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM mensajes m JOIN leads l ON l.id = m.lead_id
       WHERE m.de = 'cliente' AND NOT l.ejemplo AND l.origen <> 'prueba') AS hay`,
  );
  return fila?.hay === true;
}

/** Todo lo que se guarda de un cliente, para dárselo si lo pide (RGPD). null si no existe. */
export async function datosDeCliente(leadId: string): Promise<DatosDeCliente | null> {
  const [cliente, citas] = await Promise.all([
    leerLead(leadId),
    filas<FilaVisita>("SELECT * FROM visitas WHERE lead_id = $1 ORDER BY hueco_id", [leadId]),
  ]);
  if (!cliente) return null;
  return {
    formato: "crm-whatsapp/cliente@1",
    exportadoEn: new Date().toISOString(),
    negocio: cliente.perfilNombre,
    cliente,
    citas: citas.map(aReserva),
  };
}

/** Mensajes de clientes desde `desde`, con su número: para ver si un texto llega desde muchos móviles. */
export async function mensajesDeClientesDesde(desde: number): Promise<{ telefono: string; texto: string; ts: number }[]> {
  const lista = await filas<{ telefono: string; texto: string; ts: number }>(
    `SELECT l.telefono AS telefono, m.texto AS texto, m.ts AS ts FROM mensajes m JOIN leads l ON l.id = m.lead_id
     WHERE m.de = 'cliente' AND m.ts >= $1 ORDER BY m.orden`,
    [desde],
  );
  return lista.map((m) => ({ ...m, ts: Number(m.ts) }));
}

export async function contarLeads(): Promise<number> {
  const [fila] = await filas<{ total: number }>("SELECT COUNT(*) AS total FROM leads");
  return Number(fila.total);
}

// ---- Escritura ----

async function insertarMensaje(c: Consultas, leadId: string, m: Mensaje): Promise<boolean> {
  const nuevas = await c.ejecutar(
    `INSERT INTO mensajes (lead_id, id, de, texto, ts, plantilla, audio, manual, entrega, fallo, plantilla_nombre)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT DO NOTHING`,
    [leadId, m.id, m.de, m.texto, m.ts, !!m.plantilla, !!m.audio, !!m.manual, m.entrega ?? null, m.fallo ?? null, m.nombrePlantilla ?? null],
  );
  return nuevas > 0;
}

async function insertarNota(c: Consultas, leadId: string, n: Nota): Promise<void> {
  await c.ejecutar("INSERT INTO notas (id, lead_id, texto, ts) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [n.id, leadId, n.texto, n.ts]);
}

async function insertarTarea(c: Consultas, leadId: string, t: Tarea): Promise<void> {
  await c.ejecutar(
    "INSERT INTO tareas (id, lead_id, texto, vence, hecha, ts) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
    [t.id, leadId, t.texto, t.vence ?? null, t.hecha, t.ts],
  );
}

async function insertarLead(c: Consultas, lead: Lead): Promise<void> {
  const nuevo = await c.ejecutar(
    `INSERT INTO leads (id, telefono, perfil_id, perfil_nombre, nombre, email, zona, origen, estado, datos,
       huecos_ofrecidos, motivo_persona, motivo_spam, ms_primer_whatsapp, creado_en, actualizado_en, cambio_estado_en,
       presupuesto, cobrado, etiquetas, ejemplo, silenciado_en, fuente, ms_primera_respuesta, cierre, cierre_en,
       motivo_cierre, vuelta_vista_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text::jsonb, $11::text::jsonb, $12, $13, $14, $15, $16, $17, $18, $19,
       $20::text::jsonb, $21, $22, $23::text::jsonb, $24, $25, $26, $27, $28)
     ON CONFLICT DO NOTHING`,
    [
      lead.id,
      lead.telefono,
      lead.perfilId,
      lead.perfilNombre,
      lead.nombre,
      lead.email ?? null,
      lead.zona ?? null,
      lead.origen,
      lead.estado,
      json(lead.datos),
      json(lead.huecosOfrecidos),
      lead.motivoPersona ?? null,
      lead.motivoSpam ?? null,
      lead.msPrimerWhatsApp ?? null,
      lead.creadoEn,
      lead.actualizadoEn,
      lead.cambioEstadoEn,
      lead.presupuesto ?? null,
      lead.cobrado ?? null,
      json(lead.etiquetas ?? []),
      lead.ejemplo === true,
      lead.silenciadoEn ?? null,
      lead.fuente ? json(lead.fuente) : null,
      lead.msPrimeraRespuesta ?? null,
      lead.cierre ?? null,
      lead.cierreEn ?? null,
      lead.motivoCierre ?? null,
      lead.vueltaVistaEn ?? null,
    ],
  );
  if (!nuevo) return;
  for (const m of lead.mensajes) await insertarMensaje(c, lead.id, m);
  for (const n of lead.notas ?? []) await insertarNota(c, lead.id, n);
  for (const t of lead.tareas ?? []) await insertarTarea(c, lead.id, t);
  for (const a of lead.actividad ?? []) await registrarActividad(c, lead.id, a.id, a.texto, a.ts);
}

async function insertarVisita(c: Consultas, r: Reserva): Promise<void> {
  await c.ejecutar(
    "INSERT INTO visitas (hueco_id, lead_id, texto, nombre, perfil_nombre, prueba) VALUES ($1, $2, $3, $4, $5, $6)",
    [r.huecoId, r.leadId, r.texto, r.nombre, r.perfilNombre, !!r.prueba],
  );
}

/** Una tabla entera de una vez: las filas van como JSON y Postgres las abre con `jsonb_to_recordset`. */
async function insertarFilas(c: Consultas, sql: string, lista: object[]): Promise<void> {
  if (lista.length) await c.ejecutar(sql, [json(lista)]);
}

/**
 * Los ejemplos, en unas pocas sentencias por tabla y no una por fila: con Supabase cada viaje cuesta.
 * Todos van marcados como ejemplo y sus visitas como prueba. Lo que choque con algo que ya existe
 * (un lead con el mismo id, un hueco ocupado por una visita real) no entra, y los mensajes, notas y
 * demás de un lead que no ha entrado tampoco. Devuelve cuántos leads de ejemplo ha metido.
 */
async function insertarSemilla(c: Consultas, s: SemillaGenerada): Promise<number> {
  const lista = Object.values(s.leads);
  if (!lista.length) return 0;
  const nuevos = await c.filas<{ id: string }>(
    `INSERT INTO leads (id, telefono, perfil_id, perfil_nombre, nombre, email, zona, origen, estado, datos, huecos_ofrecidos,
       motivo_persona, motivo_spam, ms_primer_whatsapp, creado_en, actualizado_en, cambio_estado_en, presupuesto, cobrado,
       etiquetas, ejemplo, silenciado_en, fuente, ms_primera_respuesta, cierre, cierre_en, motivo_cierre, vuelta_vista_en)
     SELECT id, telefono, perfil_id, perfil_nombre, nombre, email, zona, origen, estado, datos, huecos_ofrecidos,
       motivo_persona, motivo_spam, ms_primer_whatsapp, creado_en, actualizado_en, cambio_estado_en, presupuesto, cobrado,
       etiquetas, true, silenciado_en, fuente, ms_primera_respuesta, cierre, cierre_en, motivo_cierre, vuelta_vista_en
     FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, telefono text, perfil_id text, perfil_nombre text, nombre text,
       email text, zona text, origen text, estado text, datos jsonb, huecos_ofrecidos jsonb, motivo_persona text,
       motivo_spam text, ms_primer_whatsapp integer, creado_en bigint, actualizado_en bigint, cambio_estado_en bigint,
       presupuesto integer, cobrado integer, etiquetas jsonb, silenciado_en bigint, fuente jsonb,
       ms_primera_respuesta integer, cierre text, cierre_en bigint, motivo_cierre text, vuelta_vista_en bigint)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      json(
        lista.map((l) => ({
          id: l.id,
          telefono: l.telefono,
          perfil_id: l.perfilId,
          perfil_nombre: l.perfilNombre,
          nombre: l.nombre,
          email: l.email ?? null,
          zona: l.zona ?? null,
          origen: l.origen,
          estado: l.estado,
          datos: l.datos,
          huecos_ofrecidos: l.huecosOfrecidos,
          motivo_persona: l.motivoPersona ?? null,
          motivo_spam: l.motivoSpam ?? null,
          ms_primer_whatsapp: l.msPrimerWhatsApp ?? null,
          creado_en: l.creadoEn,
          actualizado_en: l.actualizadoEn,
          cambio_estado_en: l.cambioEstadoEn,
          presupuesto: l.presupuesto ?? null,
          cobrado: l.cobrado ?? null,
          etiquetas: l.etiquetas ?? [],
          silenciado_en: l.silenciadoEn ?? null,
          fuente: l.fuente ?? null,
          ms_primera_respuesta: l.msPrimeraRespuesta ?? null,
          cierre: l.cierre ?? null,
          cierre_en: l.cierreEn ?? null,
          motivo_cierre: l.motivoCierre ?? null,
          vuelta_vista_en: l.vueltaVistaEn ?? null,
        })),
      ),
    ],
  );
  const ids = new Set(nuevos.map((f) => f.id));
  const entran = lista.filter((l) => ids.has(l.id));

  // `n` es el orden de la conversación: la identidad `orden` se reparte en ese orden.
  let n = 0;
  await insertarFilas(
    c,
    `INSERT INTO mensajes (lead_id, id, de, texto, ts, plantilla, audio, manual, entrega, fallo, plantilla_nombre)
     SELECT lead_id, id, de, texto, ts, plantilla, audio, manual, entrega, fallo, plantilla_nombre
     FROM jsonb_to_recordset($1::text::jsonb) AS x(lead_id text, id text, de text, texto text, ts bigint, plantilla boolean,
       audio boolean, manual boolean, entrega text, fallo text, plantilla_nombre text, n integer)
     ORDER BY n
     ON CONFLICT DO NOTHING`,
    entran.flatMap((l) =>
      l.mensajes.map((m) => ({
        lead_id: l.id,
        id: m.id,
        de: m.de,
        texto: m.texto,
        ts: m.ts,
        plantilla: !!m.plantilla,
        audio: !!m.audio,
        manual: !!m.manual,
        entrega: m.entrega ?? null,
        fallo: m.fallo ?? null,
        plantilla_nombre: m.nombrePlantilla ?? null,
        n: n++,
      })),
    ),
  );
  await insertarFilas(
    c,
    `INSERT INTO notas (id, lead_id, texto, ts)
     SELECT id, lead_id, texto, ts FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, lead_id text, texto text, ts bigint)
     ON CONFLICT DO NOTHING`,
    entran.flatMap((l) => (l.notas ?? []).map((x) => ({ id: x.id, lead_id: l.id, texto: x.texto, ts: x.ts }))),
  );
  await insertarFilas(
    c,
    `INSERT INTO tareas (id, lead_id, texto, vence, hecha, ts)
     SELECT id, lead_id, texto, vence, hecha, ts
     FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, lead_id text, texto text, vence text, hecha boolean, ts bigint)
     ON CONFLICT DO NOTHING`,
    entran.flatMap((l) =>
      (l.tareas ?? []).map((t) => ({ id: t.id, lead_id: l.id, texto: t.texto, vence: t.vence ?? null, hecha: t.hecha, ts: t.ts })),
    ),
  );
  await insertarFilas(
    c,
    `INSERT INTO actividad (id, lead_id, texto, ts)
     SELECT id, lead_id, texto, ts FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, lead_id text, texto text, ts bigint)
     ON CONFLICT DO NOTHING`,
    entran.flatMap((l) => (l.actividad ?? []).map((a) => ({ id: a.id, lead_id: l.id, texto: a.texto, ts: a.ts }))),
  );
  await insertarFilas(
    c,
    `INSERT INTO visitas (hueco_id, lead_id, texto, nombre, perfil_nombre, prueba)
     SELECT hueco_id, lead_id, texto, nombre, perfil_nombre, true
     FROM jsonb_to_recordset($1::text::jsonb) AS x(hueco_id text, lead_id text, texto text, nombre text, perfil_nombre text)
     ON CONFLICT DO NOTHING`,
    s.reservas
      .filter((r) => ids.has(r.leadId))
      .map((r) => ({ hueco_id: r.huecoId, lead_id: r.leadId, texto: r.texto, nombre: r.nombre, perfil_nombre: r.perfilNombre })),
  );
  return entran.length;
}

/** Lo que cambia el equipo desde la ficha. Solo toca lo que trae: lo demás queda como lo dejó el asistente. */
async function editarFicha(c: Consultas, leadId: string, cambios: CambiosFicha): Promise<void> {
  if (cambios.nombre !== undefined) {
    await c.ejecutar("UPDATE leads SET nombre = $1 WHERE id = $2", [cambios.nombre, leadId]);
    // La agenda guarda el nombre junto a la visita.
    await c.ejecutar("UPDATE visitas SET nombre = $1 WHERE lead_id = $2", [cambios.nombre, leadId]);
  }
  if (cambios.email !== undefined) await c.ejecutar("UPDATE leads SET email = $1 WHERE id = $2", [cambios.email, leadId]);
  if (cambios.zona !== undefined) await c.ejecutar("UPDATE leads SET zona = $1 WHERE id = $2", [cambios.zona, leadId]);
  if (cambios.presupuesto !== undefined) await c.ejecutar("UPDATE leads SET presupuesto = $1 WHERE id = $2", [cambios.presupuesto, leadId]);
  if (cambios.cobrado !== undefined) await c.ejecutar("UPDATE leads SET cobrado = $1 WHERE id = $2", [cambios.cobrado, leadId]);
  if (cambios.etiquetas !== undefined) await c.ejecutar("UPDATE leads SET etiquetas = $1::text::jsonb WHERE id = $2", [json(cambios.etiquetas), leadId]);
  for (const [campo, valor] of Object.entries(cambios.datos ?? {})) {
    if (valor === null) await c.ejecutar("UPDATE leads SET datos = datos - $1::text WHERE id = $2", [campo, leadId]);
    else await c.ejecutar("UPDATE leads SET datos = datos || jsonb_build_object($1::text, $2::text) WHERE id = $3", [campo, valor, leadId]);
  }
}

/** La línea de tiempo de la ficha. Con id fijo cuando viene del asistente: repetir un lote no la duplica. */
async function registrarActividad(c: Consultas, leadId: string, id: string, texto: string, ts: number): Promise<void> {
  await c.ejecutar("INSERT INTO actividad (id, lead_id, texto, ts) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [id, leadId, texto, ts]);
}

async function visitaActual(c: Consultas, leadId: string): Promise<string | undefined> {
  const [fila] = await c.filas<{ texto: string }>("SELECT texto FROM visitas WHERE lead_id = $1", [leadId]);
  return fila?.texto;
}

/** Qué ha cambiado en la ficha, en palabras: «Ficha editada: presupuesto, etiquetas». */
function textoFicha(cambios: CambiosFicha): string {
  const campos = [
    cambios.nombre !== undefined && "nombre",
    cambios.email !== undefined && "email",
    cambios.zona !== undefined && "zona",
    cambios.presupuesto !== undefined && "presupuesto",
    cambios.cobrado !== undefined && "cobrado",
    cambios.etiquetas !== undefined && "etiquetas",
    ...Object.keys(cambios.datos ?? {}),
  ].filter((campo): campo is string => typeof campo === "string");
  return `Ficha editada: ${campos.join(", ")}`;
}

function textoEstado(estado: EstadoLead, motivo?: string): string {
  const base = estado === "persona" ? "Pasado a persona" : estado === "spam" ? "Marcado como spam" : `Estado: ${NOMBRE_ETAPA[estado]}`;
  return motivo ? `${base}: ${motivo}` : base;
}

/** El motivo cuando el dueño pasa un lead a sí mismo o lo marca como publicidad sin decir por qué. */
const MOTIVO_PERSONA_PANEL = "Lo llevas tú desde el panel";
const MOTIVO_SPAM_PANEL = "Lo has marcado tú como publicidad";

/** A dónde vuelve un lead que sale de «persona» o de spam: a su cita, a su conversación o a nuevo. */
const ETAPA_DE_VUELTA = `CASE
  WHEN EXISTS (SELECT 1 FROM visitas v WHERE v.lead_id = leads.id) THEN 'visita'
  WHEN EXISTS (SELECT 1 FROM mensajes m WHERE m.lead_id = leads.id AND m.de = 'cliente') THEN 'conversacion'
  ELSE 'nuevo' END`;

/** Lo mismo que la mutación `cancelar`, pero solo si tiene cita. Devuelve si la había. */
async function anularVisita(c: Consultas, leadId: string, ts: number): Promise<boolean> {
  const anterior = await visitaActual(c, leadId);
  if (!anterior) return false;
  await c.ejecutar("DELETE FROM visitas WHERE lead_id = $1", [leadId]);
  await c.ejecutar("UPDATE leads SET actualizado_en = $1 WHERE id = $2", [ts, leadId]);
  await registrarActividad(c, leadId, `anulada-${leadId}-${ts}`, `Visita anulada: ${anterior}`, ts);
  return true;
}

type MutacionCierre = Extract<Mutacion, { t: "cierre" }>;
type MutacionEtapa = Extract<Mutacion, { t: "etapa" }>;

/** El cierre lo decide el dueño. Un lead marcado como publicidad no se cierra. */
async function aplicarCierre(c: Consultas, m: MutacionCierre): Promise<void> {
  const { leadId, ts } = m;
  if (m.accion === "si" || m.accion === "no") {
    let cerrado: number;
    if (m.accion === "si") {
      const valores: unknown[] = [m.importe, ts, leadId];
      // `cobrado` solo se toca si viene: null lo borra; sin él, se queda como estaba.
      if (m.cobrado !== undefined) valores.push(m.cobrado);
      cerrado = await c.ejecutar(
        `UPDATE leads SET presupuesto = $1, cierre = 'si', cierre_en = $2, motivo_cierre = NULL, vuelta_vista_en = NULL
           ${m.cobrado !== undefined ? ", cobrado = $4" : ""}
         WHERE id = $3 AND estado <> 'spam'`,
        valores,
      );
      if (cerrado > 0) {
        await registrarActividad(c, leadId, `cierre-${leadId}-${ts}`, `Ha dicho que sí · ${formatoImporte(m.importe, m.moneda ?? "EUR")}`, ts);
      }
    } else {
      cerrado = await c.ejecutar(
        `UPDATE leads SET cierre = 'no', motivo_cierre = $1, cierre_en = $2, vuelta_vista_en = NULL
         WHERE id = $3 AND estado <> 'spam'`,
        [m.motivo, ts, leadId],
      );
      if (cerrado > 0) {
        await registrarActividad(c, leadId, `cierre-${leadId}-${ts}`, `No sigue · ${m.motivo}`, ts);
        // Como cuando el asistente anula: la cita se va y, si estaba en «visita», vuelve a la conversación.
        if (m.anularCita && (await anularVisita(c, leadId, ts))) {
          const vuelta = await c.ejecutar(
            "UPDATE leads SET estado = 'conversacion', actualizado_en = $1, cambio_estado_en = $1 WHERE id = $2 AND estado = 'visita'",
            [ts, leadId],
          );
          if (vuelta > 0) await registrarActividad(c, leadId, `estado-${leadId}-${ts}`, textoEstado("conversacion"), ts);
        }
      }
    }
    if (cerrado > 0 && m.nota) {
      const nota: Nota = { id: `cierre-${leadId}-${ts}`, texto: m.nota, ts };
      await insertarNota(c, leadId, nota);
      await registrarActividad(c, leadId, `nota-${nota.id}`, `Nota interna: ${recortar(nota.texto, 60)}`, ts);
    }
  } else if (m.accion === "reabrir") {
    // La cita que se anuló al cerrar no vuelve: el hueco puede tenerlo ya otro.
    const reabierto = await c.ejecutar(
      "UPDATE leads SET cierre = NULL, cierre_en = NULL, motivo_cierre = NULL, vuelta_vista_en = NULL WHERE id = $1 AND cierre IS NOT NULL",
      [leadId],
    );
    if (reabierto > 0) await registrarActividad(c, leadId, `reabierto-${leadId}-${ts}`, "Reabierto", ts);
  } else {
    await c.ejecutar("UPDATE leads SET vuelta_vista_en = $1 WHERE id = $2 AND cierre IS NOT NULL", [ts, leadId]);
  }
}

/** Lo que el dueño cambia de etapa a mano. Una transición que no toca no cambia nada ni deja línea. */
async function aplicarEtapa(c: Consultas, m: MutacionEtapa): Promise<void> {
  const { leadId, ts } = m;
  if (m.a === "persona") {
    const motivo = m.motivo || null;
    const cambio = await c.ejecutar(
      `UPDATE leads SET estado = 'persona', motivo_persona = COALESCE($1, '${MOTIVO_PERSONA_PANEL}'), actualizado_en = $2, cambio_estado_en = $2
       WHERE id = $3 AND estado IN ('nuevo', 'conversacion', 'visita')`,
      [motivo, ts, leadId],
    );
    if (cambio > 0) await registrarActividad(c, leadId, `estado-${leadId}-${ts}`, textoEstado("persona", motivo ?? MOTIVO_PERSONA_PANEL), ts);
  } else if (m.a === "asistente") {
    // El único camino para salir de «persona»: la mutación `estado` del asistente no puede.
    const cambio = await c.ejecutar(
      `UPDATE leads SET estado = ${ETAPA_DE_VUELTA}, motivo_persona = NULL, actualizado_en = $1, cambio_estado_en = $1
       WHERE id = $2 AND estado = 'persona'`,
      [ts, leadId],
    );
    if (cambio > 0) await registrarActividad(c, leadId, `etapa-${leadId}-${ts}`, "Devuelto a tu asistente", ts);
  } else if (m.a === "spam") {
    const motivo = m.motivo || null;
    const cambio = await c.ejecutar(
      `UPDATE leads SET estado = 'spam', motivo_spam = COALESCE($1, '${MOTIVO_SPAM_PANEL}'), actualizado_en = $2, cambio_estado_en = $2
       WHERE id = $3 AND estado IN ('nuevo', 'conversacion', 'visita', 'persona')`,
      [motivo, ts, leadId],
    );
    if (cambio > 0) {
      await registrarActividad(c, leadId, `estado-${leadId}-${ts}`, textoEstado("spam", motivo ?? MOTIVO_SPAM_PANEL), ts);
      if (m.anularCita) await anularVisita(c, leadId, ts);
    }
  } else {
    const cambio = await c.ejecutar(
      `UPDATE leads SET estado = ${ETAPA_DE_VUELTA}, actualizado_en = $1, cambio_estado_en = $1 WHERE id = $2 AND estado = 'spam'`,
      [ts, leadId],
    );
    if (cambio > 0) await registrarActividad(c, leadId, `etapa-${leadId}-${ts}`, "No es publicidad", ts);
  }
}

/** Borra un cliente y todo lo suyo (RGPD). Hijos primero, por si un esquema futuro no los borra en cascada. */
async function borrarLead(c: Consultas, leadId: string): Promise<boolean> {
  for (const tabla of ["mensajes", "notas", "tareas", "actividad", "visitas"]) {
    await c.ejecutar(`DELETE FROM ${tabla} WHERE lead_id = $1`, [leadId]);
  }
  return (await c.ejecutar("DELETE FROM leads WHERE id = $1", [leadId])) > 0;
}

/**
 * `bloqueados` son los leads de este lote que ya se han encontrado y bloqueado: siguen así hasta el
 * final, así que no hace falta volver a pedirlo en cada cambio. Lo que cambia el panel y lo que
 * guarda el asistente a la vez no se pisan. `borrados`, los que este lote ya ha borrado: lo que
 * venga después para ellos no se aplica.
 */
interface EstadoLote {
  bloqueados: Set<string>;
  borrados: Set<string>;
}

async function aplicar(c: Consultas, m: Mutacion, lote: EstadoLote): Promise<void> {
  if (m.t === "lead") {
    if (lote.borrados.has(m.lead.id)) return;
    // Volver a rellenar el formulario empieza de cero (es un consentimiento nuevo). Un mensaje de WhatsApp
    // o un cliente añadido a mano no pisan lo que haya.
    if (m.lead.origen === "formulario") await c.ejecutar("DELETE FROM leads WHERE id = $1", [m.lead.id]);
    await insertarLead(c, m.lead);
    return;
  }

  const leadId = m.t === "reserva" ? m.reserva.leadId : m.leadId;
  if (lote.borrados.has(leadId)) return;
  if (!lote.bloqueados.has(leadId)) {
    const [lead] = await c.filas("SELECT id FROM leads WHERE id = $1 FOR UPDATE", [leadId]);
    // Lo que llegue tarde tras un reinicio ya no tiene a quién aplicarse.
    if (!lead) return;
    lote.bloqueados.add(leadId);
  }

  if (m.t === "mensaje") {
    if (await insertarMensaje(c, leadId, m.mensaje)) {
      await c.ejecutar("UPDATE leads SET actualizado_en = $1 WHERE id = $2", [m.mensaje.ts, leadId]);
    }
  } else if (m.t === "dato") {
    await c.ejecutar(
      "UPDATE leads SET datos = datos || jsonb_build_object($1::text, $2::text), actualizado_en = $3 WHERE id = $4",
      [m.campo, m.valor, m.ts, leadId],
    );
  } else if (m.t === "huecos") {
    await c.ejecutar("UPDATE leads SET huecos_ofrecidos = $1::text::jsonb WHERE id = $2", [json(m.huecos), leadId]);
  } else if (m.t === "ficha") {
    await editarFicha(c, leadId, m.cambios);
    await registrarActividad(c, leadId, crypto.randomUUID(), textoFicha(m.cambios), Date.now());
  } else if (m.t === "cancelar") {
    const anterior = await visitaActual(c, leadId);
    await c.ejecutar("DELETE FROM visitas WHERE lead_id = $1", [leadId]);
    await c.ejecutar("UPDATE leads SET actualizado_en = $1 WHERE id = $2", [m.ts, leadId]);
    if (anterior) await registrarActividad(c, leadId, `anulada-${leadId}-${m.ts}`, `Visita anulada: ${anterior}`, m.ts);
  } else if (m.t === "estado") {
    // Cada motivo va a su columna: el de spam y el de pasar a persona no se pisan. Pasar a persona
    // es definitivo: una respuesta del asistente que ya estaba en curso no lo saca de ahí.
    const columna = m.estado === "spam" ? "motivo_spam" : "motivo_persona";
    const cambio = await c.ejecutar(
      `UPDATE leads SET estado = $1, ${columna} = COALESCE($2, ${columna}), actualizado_en = $3, cambio_estado_en = $3
       WHERE id = $4 AND estado <> $1 AND estado <> 'persona'`,
      [m.estado, m.motivo ?? null, m.ts, leadId],
    );
    if (cambio > 0) await registrarActividad(c, leadId, `estado-${leadId}-${m.ts}`, textoEstado(m.estado, m.motivo), m.ts);
  } else if (m.t === "nota") {
    await insertarNota(c, leadId, m.nota);
    await registrarActividad(c, leadId, `nota-${m.nota.id}`, `Nota interna: ${recortar(m.nota.texto, 60)}`, m.nota.ts);
  } else if (m.t === "tarea") {
    await insertarTarea(c, leadId, m.tarea);
    await registrarActividad(c, leadId, `tarea-${m.tarea.id}`, `Tarea añadida: ${m.tarea.texto}`, m.tarea.ts);
  } else if (m.t === "tareaCambio") {
    // Siempre por lead_id: una tarea de otro lead no se toca aunque llegue el id.
    if (m.borrar) {
      const borradas = await c.ejecutar("DELETE FROM tareas WHERE id = $1 AND lead_id = $2", [m.tareaId, leadId]);
      if (borradas > 0) await registrarActividad(c, leadId, crypto.randomUUID(), "Tarea borrada", Date.now());
    } else if (m.hecha !== undefined) {
      const cambiadas = await c.ejecutar("UPDATE tareas SET hecha = $1 WHERE id = $2 AND lead_id = $3", [m.hecha, m.tareaId, leadId]);
      if (cambiadas > 0) await registrarActividad(c, leadId, crypto.randomUUID(), m.hecha ? "Tarea hecha" : "Tarea reabierta", Date.now());
    }
  } else if (m.t === "reserva") {
    const anterior = await visitaActual(c, leadId);
    await c.ejecutar("DELETE FROM visitas WHERE lead_id = $1", [leadId]);
    await insertarVisita(c, m.reserva);
    await c.ejecutar("UPDATE leads SET actualizado_en = $1 WHERE id = $2", [m.ts, leadId]);
    const nueva = m.reserva.texto;
    if (anterior !== nueva) {
      const texto = anterior ? `Visita cambiada: de ${anterior} a ${nueva}` : `Visita reservada: ${nueva}`;
      await registrarActividad(c, leadId, `reserva-${leadId}-${m.ts}`, texto, m.ts);
    }
  } else if (m.t === "silencio") {
    // Se puede volver a silenciar después de levantarlo: cada vez es una línea nueva.
    const cambio = await c.ejecutar(
      "UPDATE leads SET silenciado_en = COALESCE(silenciado_en, $1), actualizado_en = $1 WHERE id = $2 AND silenciado_en IS NULL",
      [m.ts, leadId],
    );
    if (cambio > 0) await registrarActividad(c, leadId, `silencio-${leadId}-${m.ts}`, "Ha pedido que no le escribamos", m.ts);
  } else if (m.t === "permitir") {
    const cambio = await c.ejecutar(
      "UPDATE leads SET silenciado_en = NULL, actualizado_en = $1 WHERE id = $2 AND silenciado_en IS NOT NULL",
      [m.ts, leadId],
    );
    if (cambio > 0) {
      const texto = m.por === "cliente" ? "Ha vuelto a escribir: se le puede contestar" : "Se le puede volver a escribir: lo has decidido tú";
      await registrarActividad(c, leadId, `permitir-${leadId}-${m.ts}`, texto, m.ts);
    }
  } else if (m.t === "cierre") {
    await aplicarCierre(c, m);
  } else if (m.t === "etapa") {
    await aplicarEtapa(c, m);
  } else if (m.t === "borrar") {
    if (await borrarLead(c, leadId)) lote.borrados.add(leadId);
    lote.bloqueados.delete(leadId);
  } else if (m.t === "actividad") {
    await registrarActividad(c, leadId, m.id, m.texto, m.ts);
  } else if (m.t === "respuesta") {
    await c.ejecutar("UPDATE leads SET ms_primera_respuesta = $1 WHERE id = $2 AND ms_primera_respuesta IS NULL", [m.ms, leadId]);
  }
}

/** Aplica los cambios juntos o ninguno. Es idempotente: repetir un lote no duplica nada. */
export async function guardarMutaciones(mutaciones: Mutacion[]): Promise<void> {
  const lote: EstadoLote = { bloqueados: new Set(), borrados: new Set() };
  await transaccion(async (c) => {
    for (const m of mutaciones) await aplicar(c, m, lote);
  });
  // Sin nombre ni teléfono: de ese cliente no queda nada, tampoco en el registro.
  for (let i = 0; i < lote.borrados.size; i++) log("Cliente borrado a petición");
  if (mutaciones.length) avisarCambio("leads");
}

/** Lo que Meta dice de cada mensaje enviado. Solo avanza: un «entregado» que llega tras «leído» no cuenta. */
const RANGO_ENTREGA: Record<EstadoEntrega, number> = { enviado: 1, entregado: 2, leido: 3, fallido: 4 };
const rangoSql = (columna: string) =>
  `CASE ${columna} WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2 WHEN 'leido' THEN 3 WHEN 'fallido' THEN 4 ELSE 0 END`;

/** Devuelve cuántos mensajes han cambiado. Un id que no es de un mensaje nuestro no hace nada. */
export async function actualizarEntregas(cambios: CambioEntrega[]): Promise<number> {
  // Del mismo mensaje en un lote, solo el estado más avanzado: un UPDATE … FROM aplica uno cualquiera.
  const porMensaje = new Map<string, CambioEntrega>();
  for (const cambio of cambios) {
    if (typeof cambio.wamid !== "string" || !Object.hasOwn(RANGO_ENTREGA, cambio.estado)) continue;
    const antes = porMensaje.get(cambio.wamid);
    if (!antes || RANGO_ENTREGA[cambio.estado] >= RANGO_ENTREGA[antes.estado]) porMensaje.set(cambio.wamid, cambio);
  }
  if (!porMensaje.size) return 0;
  const cambiados = await ejecutar(
    `UPDATE mensajes m SET entrega = x.estado, fallo = x.fallo
     FROM jsonb_to_recordset($1::text::jsonb) AS x(wamid text, estado text, fallo text)
     WHERE m.id = x.wamid AND m.de = 'agente' AND (m.entrega IS NULL OR ${rangoSql("m.entrega")} < ${rangoSql("x.estado")})`,
    [
      json(
        [...porMensaje.values()].map((c) => ({
          wamid: c.wamid,
          estado: c.estado,
          fallo: c.estado === "fallido" ? (c.fallo ?? null) : null,
        })),
      ),
    ],
  );
  if (cambiados > 0) avisarCambio("leads");
  return cambiados;
}

/** Devuelve false si ese mensaje de Meta ya se había recibido antes. */
export async function registrarMensaje(wamid: string): Promise<boolean> {
  return (await ejecutar("INSERT INTO mensajes_procesados (wamid) VALUES ($1) ON CONFLICT DO NOTHING", [wamid])) > 0;
}

export async function guardarAjustes(ajustes: Ajustes): Promise<void> {
  await ejecutar("UPDATE ajustes SET leads_prueba = $1", [ajustes.leadsPrueba]);
  avisarCambio("leads");
}

/** Lo que son ejemplos: los marcados así y los de prueba de versiones anteriores. Sus hijos van en cascada. */
const BORRAR_EJEMPLOS = "DELETE FROM leads WHERE ejemplo OR origen = 'prueba'";

/**
 * El reinicio (`/api/reset` con `{}`): borra todo y vuelve a cargar los ejemplos si el ajuste está activo. Con
 * `{ ejemplos: false }` lo borra todo, también los clientes reales, y no carga ejemplos. La
 * configuración, los logos y las copias de las instrucciones se quedan.
 */
export async function reiniciarBd(o: OpcionesSemilla = opcionesPorDefecto(), opciones?: { ejemplos?: boolean }): Promise<void> {
  await transaccion(async (c) => {
    for (const tabla of ["visitas", "mensajes", "notas", "tareas", "actividad", "proyectos", "leads", "mensajes_procesados"]) {
      await c.ejecutar(`DELETE FROM ${tabla}`);
    }
    if (opciones?.ejemplos === false) {
      await c.ejecutar("UPDATE ajustes SET leads_prueba = false, ejemplos_de = NULL WHERE id = 1");
      return;
    }
    const [ajustes] = await c.filas<{ leads_prueba: boolean }>("SELECT leads_prueba FROM ajustes WHERE id = 1");
    const conEjemplos = ajustes?.leads_prueba === true;
    if (conEjemplos) await insertarSemilla(c, crearSemilla(o.negocio, new Date(), o));
    await c.ejecutar("UPDATE ajustes SET ejemplos_de = $1 WHERE id = 1", [conEjemplos ? o.sector : null]);
  });
  avisarCambio("leads");
}

/**
 * Cambia los ejemplos por los de este negocio. Los clientes reales, sus mensajes y sus visitas no se
 * tocan, y los ejemplos no cogen ningún hueco que ya tenga una visita real.
 */
export async function sustituirEjemplos(o: OpcionesSemilla): Promise<{ leads: number }> {
  let leads = 0;
  await transaccion(async (c) => {
    await c.ejecutar(BORRAR_EJEMPLOS);
    const reales = await c.filas<{ hueco_id: string }>("SELECT hueco_id FROM visitas");
    const ocupados = [...(o.ocupados ?? []), ...reales.map((f) => f.hueco_id)];
    leads = await insertarSemilla(c, crearSemilla(o.negocio, new Date(), { ...o, ocupados }));
    await c.ejecutar("UPDATE ajustes SET leads_prueba = true, ejemplos_de = $1 WHERE id = 1", [o.sector]);
  });
  avisarCambio("leads");
  return { leads };
}

/** Quita los ejemplos y deja solo los clientes reales. */
export async function borrarEjemplos(): Promise<void> {
  await transaccion(async (c) => {
    await c.ejecutar(BORRAR_EJEMPLOS);
    await c.ejecutar("UPDATE ajustes SET leads_prueba = false, ejemplos_de = NULL WHERE id = 1");
  });
  avisarCambio("leads");
}
