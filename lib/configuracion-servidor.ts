// La configuración del negocio en el servidor: lo guardado en la base de datos encima del preset del
// sector, con lo heredado de .env. Leerla para pintar nunca falla (I7). Todo lo que la cambia pasa por
// aquí: Ajustes guarda cada control al momento, las instrucciones, el cambio de negocio y el logo.
//
// Lo guardado se lee una vez y se queda en memoria (globalThis.__configuracion): con la caché fría se
// espera una sola lectura para todos; con más de 5 s se devuelve lo que hay y se refresca por detrás.
// Cada escritura de aquí deja su resultado en la caché, y una lectura que empezó antes se descarta.

import type { RespuestaConfiguracion } from "./api-tipos";
import {
  borrarEjemplos,
  contarEjemplos,
  guardarCopiaInstrucciones,
  guardarLogo,
  leerBdYGuardada,
  leerConfiguracionGuardada,
  leerCopiasInstrucciones,
  modificarConfiguracionGuardada,
  restablecerConfiguracion,
  sustituirEjemplos,
} from "./bd";
import {
  aplicarCambios,
  configAgenteDe,
  GUARDADA_VACIA,
  LIMITES,
  normalizarGuardada,
  opcionesSemilla,
  publica,
  resolverSistema,
  revisarCambios,
  revisarInstrucciones,
  revisarSistema,
  sinLogoVersion,
  slugPerfil,
  type CambiosPerfil,
  type CambiosSistema,
  type ConfiguracionGuardada,
  type ConfiguracionPerfil,
  type ConfiguracionResuelta,
  type ConfiguracionSistema,
  type CopiaInstrucciones,
  type NegocioExportado,
  type RevisionPrompt,
  type SectorId,
  type SectorPreset,
} from "./configuracion";
import { vistaPreviaContexto } from "./agente";
import { avisarCambio, leadsEscribiendo } from "./eventos";
import { conSeccion, seccionDe } from "./guion";
import { log, logAviso, logError } from "./log";
import { leerTitulo } from "./negocio";
import { escribirAgente, hashTexto, leerPerfil, leerPreset, type Perfil } from "./perfil";
import { configuracionPorDefecto, PRESETS, resolver, SECTOR_DE_PERFIL, type Entorno } from "./presets";
import type { Bd } from "./tipos";

const REFRESCO_MS = 5_000;
const UN_MINUTO = 60_000;
const SECCION_INFORMACION = "Información que puedes dar tal cual";
const ALGO_HA_FALLADO = "Algo ha fallado. Vuelve a intentarlo en un momento.";

/**
 * Las huellas (hashTexto) de las instrucciones de la v0, para avisar de que hay una versión nueva a
 * quien siga con el texto de siempre. Salen de las copias congeladas de W0 en lib/__golden__:
 * `node -e 'console.log(require("crypto").createHash("sha1").update(require("fs").readFileSync(f,"utf8")).digest("hex").slice(0,12))'`
 * con f = lib/__golden__/entrada-reformas.md y lib/__golden__/entrada-inmobiliaria.md.
 */
const HASHES_ANTERIORES: Partial<Record<SectorPreset, readonly string[]>> = {
  reformas: ["5503b9951821"],
  inmobiliaria: ["51d40fa4efa8"],
};

// ---- La caché ----

interface Memo {
  id: string;
  nombre: string;
  hash: string;
  guardada: ConfiguracionGuardada;
  entorno: [string | undefined, string | undefined, string | undefined];
  config: ConfiguracionResuelta;
}

interface EstadoCache {
  guardada: ConfiguracionGuardada | null;
  /** Cuándo se obtuvo lo que hay (Date.now()). */
  leidaEn: number;
  /** Orden de la última escritura de aquí: una lectura que empezó antes no se guarda. */
  escritoEn: number;
  refresco?: Promise<ConfiguracionGuardada>;
  /** Contador de lecturas y escrituras, para saber cuál empezó antes. */
  orden: number;
  /** Cuándo falló la última lectura; se reintenta pasados 5 s. */
  falloEn: number | null;
  memo: Memo | null;
  /** El último perfil visto, para notar un `cp` a mano. */
  previo: Perfil | null;
  /** Avisos para Ajustes; cada uno sale una vez. */
  avisos: string[];
  descartes: Set<string>;
  registros: Map<string, number>;
}

const global_ = globalThis as unknown as { __configuracion?: EstadoCache };

function cache(): EstadoCache {
  global_.__configuracion ??= {
    guardada: null,
    leidaEn: 0,
    escritoEn: 0,
    orden: 0,
    falloEn: null,
    memo: null,
    previo: null,
    avisos: [],
    descartes: new Set(),
    registros: new Map(),
  };
  return global_.__configuracion;
}

/** Un aviso rojo sale como mucho una vez por minuto. */
function rojoCadaMinuto(clave: string, avisar: () => void): void {
  const c = cache();
  const ahora = Date.now();
  const ultimo = c.registros.get(clave);
  if (ultimo !== undefined && ahora - ultimo < UN_MINUTO) return;
  c.registros.set(clave, ahora);
  avisar();
}

function normalizar(raw: unknown): ConfiguracionGuardada {
  const c = cache();
  return normalizarGuardada(raw, (ruta) => {
    if (c.descartes.has(ruta)) return;
    c.descartes.add(ruta);
    logAviso(`Se ignora una parte de la configuración guardada que no vale (${ruta})`);
  });
}

/** Lo leído entra en la caché solo si la lectura empezó después de la última escritura. */
function aceptarLectura(raw: unknown, inicio: number): ConfiguracionGuardada {
  const c = cache();
  const leida = normalizar(raw);
  if (inicio < c.escritoEn) return c.guardada ?? leida;
  c.guardada = leida;
  c.leidaEn = Date.now();
  c.falloEn = null;
  return leida;
}

function lanzarLectura(): Promise<ConfiguracionGuardada> {
  const c = cache();
  if (c.refresco) return c.refresco;
  const inicio = ++c.orden;
  const lectura = leerConfiguracionGuardada().then(
    (raw) => aceptarLectura(raw, inicio),
    () => {
      c.falloEn = Date.now();
      rojoCadaMinuto("lectura", () => logAviso("No se ha podido leer la configuración guardada: se usa la última que había"));
      return c.guardada ?? GUARDADA_VACIA;
    },
  );
  c.refresco = lectura;
  void lectura.finally(() => {
    if (c.refresco === lectura) c.refresco = undefined;
  });
  return lectura;
}

/** Lo guardado, de la caché. Nunca lanza: si la base de datos falla, lo último que había o nada. */
async function guardadaEnCache(): Promise<ConfiguracionGuardada> {
  const c = cache();
  const ahora = Date.now();
  const puedeReintentar = c.falloEn === null || ahora - c.falloEn >= REFRESCO_MS;
  if (c.guardada) {
    if (ahora - c.leidaEn > REFRESCO_MS && !c.refresco && puedeReintentar) void lanzarLectura();
    return c.guardada;
  }
  if (!puedeReintentar && !c.refresco) return GUARDADA_VACIA;
  return lanzarLectura();
}

/** Lo que acaba de escribir este proceso: entra en la caché sin volver a leer. */
function escribirEnCache(nueva: unknown): ConfiguracionGuardada {
  const c = cache();
  const n = normalizar(nueva);
  c.guardada = n;
  c.leidaEn = Date.now();
  c.escritoEn = ++c.orden;
  c.falloEn = null;
  return n;
}

/** Tras una escritura de lib/bd.ts que no devuelve lo guardado (logo, restablecer), se lee una vez. */
async function recargarTrasEscribir(): Promise<ConfiguracionGuardada> {
  try {
    return escribirEnCache(await leerConfiguracionGuardada());
  } catch {
    invalidarCache();
    return guardadaEnCache();
  }
}

/** Lo que se hereda de .env: el nombre del negocio y la plantilla. Un valor vacío no cuenta. Nunca una clave. */
export function entorno(): Entorno {
  const valor = (nombre: "NOMBRE_NEGOCIO" | "PLANTILLA" | "PLANTILLA_IDIOMA") => process.env[nombre]?.trim() || undefined;
  const e: Entorno = {};
  const nombre = valor("NOMBRE_NEGOCIO");
  const plantilla = valor("PLANTILLA");
  const idioma = valor("PLANTILLA_IDIOMA");
  if (nombre !== undefined) e.NOMBRE_NEGOCIO = nombre;
  if (plantilla !== undefined) e.PLANTILLA = plantilla;
  if (idioma !== undefined) e.PLANTILLA_IDIOMA = idioma;
  return e;
}

/** La configuración resuelta, recordada mientras no cambien las instrucciones, lo guardado ni .env. */
function resolverCon(perfil: Pick<Perfil, "id" | "nombre" | "hash">, guardada: ConfiguracionGuardada): ConfiguracionResuelta {
  const c = cache();
  const e = entorno();
  const claves: Memo["entorno"] = [e.NOMBRE_NEGOCIO, e.PLANTILLA, e.PLANTILLA_IDIOMA];
  const m = c.memo;
  if (
    m &&
    m.guardada === guardada &&
    m.id === perfil.id &&
    m.nombre === perfil.nombre &&
    m.hash === perfil.hash &&
    m.entorno.every((v, i) => v === claves[i])
  ) {
    return m.config;
  }
  const config = resolver({ perfil: { id: perfil.id, nombre: perfil.nombre, hash: perfil.hash }, guardada, entorno: e });
  c.memo = { id: perfil.id, nombre: perfil.nombre, hash: perfil.hash, guardada, entorno: claves, config };
  return config;
}

function sectorPreset(perfilId: string): Exclude<SectorPreset, "generico"> | undefined {
  return Object.hasOwn(SECTOR_DE_PERFIL, perfilId) ? SECTOR_DE_PERFIL[perfilId] : undefined;
}

function sectorDe(perfilId: string | undefined): SectorId {
  return (perfilId !== undefined && sectorPreset(perfilId)) || "personalizado";
}

function etiquetaDe(c: ConfiguracionResuelta): string {
  return c.sector === "personalizado" ? c.negocio.nombre : PRESETS[c.sector].etiqueta;
}

// ---- El perfil activo y la red del `cp` ----

/**
 * Si agente.md ha cambiado de perfil sin pasar por aquí (un `cp` a mano) y el texto anterior estaba
 * editado, se guarda como copia de su perfil para no perderlo. Nunca lanza.
 */
async function guardarTextoSaliente(previo: Perfil): Promise<void> {
  try {
    const sector = sectorPreset(previo.id);
    const copia = (await leerCopiasInstrucciones())[previo.id];
    const origen = copia?.origen ?? (sector ? hashTexto(await leerPreset(sector)) : null);
    if (sector && previo.hash === origen) return;
    await guardarCopiaInstrucciones(previo.id, { texto: previo.instrucciones, hash: previo.hash, origen, guardadaEn: Date.now() });
    cache().avisos.push(`Has cambiado de tipo de negocio fuera de Ajustes: el texto anterior de ${previo.nombre} está guardado.`);
    log(`agente.md ha cambiado de perfil a mano: se guarda el texto anterior de ${previo.nombre}`);
  } catch (error) {
    rojoCadaMinuto("saliente", () => logError("al guardar el texto anterior de agente.md", error));
  }
}

/** El perfil de agente.md, notando si ha cambiado de perfil por fuera. */
async function perfilActivo(): Promise<Perfil> {
  const perfil = await leerPerfil();
  const c = cache();
  const previo = c.previo;
  c.previo = perfil;
  if (previo && previo.id !== perfil.id) await guardarTextoSaliente(previo);
  return perfil;
}

async function activaConGuardada(): Promise<{ perfil: Perfil; guardada: ConfiguracionGuardada; config: ConfiguracionResuelta }> {
  const [perfil, guardada] = await Promise.all([perfilActivo(), guardadaEnCache()]);
  return { perfil, guardada, config: resolverCon(perfil, guardada) };
}

/** El perfil activo y su configuración. Solo falla si no hay ningunas instrucciones válidas. */
export async function configuracionActiva(): Promise<{ perfil: Perfil; config: ConfiguracionResuelta }> {
  const { perfil, config } = await activaConGuardada();
  return { perfil, config };
}

/** La configuración para pintar una pantalla. Nunca falla: si algo va mal, la de reformas por defecto. */
export async function configuracionParaPintar(): Promise<ConfiguracionResuelta> {
  try {
    return (await configuracionActiva()).config;
  } catch {
    return configuracionPorDefecto();
  }
}

/** Los datos del panel; de paso, refresca la caché con la configuración que viene con ellos. */
async function leerBdYCache(): Promise<Bd> {
  const inicio = ++cache().orden;
  const { bd, guardada } = await leerBdYGuardada();
  aceptarLectura(guardada, inicio);
  return bd;
}

/** Lo que lee el panel: los datos, la parte pública de la configuración y a quién se está contestando. */
export async function leerBdConConfiguracion(): Promise<Bd> {
  const bd = await leerBdYCache();
  let config: ConfiguracionResuelta;
  try {
    config = (await configuracionActiva()).config;
  } catch {
    config = configuracionPorDefecto();
  }
  return { ...bd, configuracion: publica(config), escribiendo: leadsEscribiendo() };
}

// ---- Errores ----

type ErrorConEstado = Error & { status: number; campo?: string };

/** Un error que la ruta convierte en { ok: false, error, campo? } con ese estado. */
function fallo(status: number, mensaje: string, campo?: string): ErrorConEstado {
  const e = new Error(mensaje) as ErrorConEstado;
  e.status = status;
  if (campo !== undefined && campo !== "") e.campo = campo;
  return e;
}

/** Por qué no se ha podido escribir, sin nombrar ninguna ruta. */
function motivoEscritura(error: unknown): string {
  const codigo = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (codigo === "EACCES" || codigo === "EPERM") return "sin permiso de escritura en la carpeta del CRM";
  if (codigo === "ENOSPC") return "el disco está lleno";
  if (codigo === "EROFS") return "la carpeta es de solo lectura";
  return `error del sistema (${typeof codigo === "string" ? codigo : "desconocido"})`;
}

/** Escribe agente.md y deja apuntado el perfil nuevo antes, para no confundirlo con un `cp` a mano. */
async function escribirInstrucciones(texto: string, anterior: Perfil): Promise<Perfil> {
  const c = cache();
  c.previo = { ...leerTitulo(texto), instrucciones: texto, hash: hashTexto(texto) };
  try {
    const perfil = await escribirAgente(texto);
    c.previo = perfil;
    return perfil;
  } catch (error) {
    c.previo = anterior;
    logError("al guardar agente.md", error);
    throw fallo(500, `No se han podido guardar las instrucciones: ${motivoEscritura(error)}`);
  }
}

// ---- Lectura para Ajustes ----

function revisar(texto: string, perfilId: string, config: ConfiguracionResuelta): RevisionPrompt {
  return revisarInstrucciones(texto, {
    perfilId,
    vocabulario: config.vocabulario,
    agente: config.agente,
    moneda: config.regional.moneda,
    negocio: config.negocio.nombre,
    plantilla: config.plantilla,
  });
}

function sacarAvisos(): string[] {
  const c = cache();
  return c.avisos.splice(0, c.avisos.length);
}

export async function datosConfiguracion(): Promise<RespuestaConfiguracion> {
  const bd = await leerBdYCache();
  const { perfil, guardada, config: activa } = await activaConGuardada();
  const [copias, conteo] = await Promise.all([leerCopiasInstrucciones(), contarEjemplos()]);
  const texto = perfil.instrucciones;

  // Hay una versión nueva si el perfil es de un preset, su archivo ya no es agente.md y lo que se
  // tiene viene del texto de la v0 (por su copia o porque agente.md sigue siendo ese texto).
  let versionNueva = false;
  const sector = sectorPreset(perfil.id);
  if (sector) {
    const anteriores = HASHES_ANTERIORES[sector] ?? [];
    try {
      const delPreset = hashTexto(await leerPreset(sector));
      const origen = copias[perfil.id]?.origen ?? null;
      // Mientras el archivo del preset siga siendo el de la v0, no hay nada nuevo que ofrecer.
      versionNueva =
        delPreset !== perfil.hash &&
        !anteriores.includes(delPreset) &&
        ((origen !== null && anteriores.includes(origen)) || anteriores.includes(perfil.hash));
    } catch {
      versionNueva = false;
    }
  }

  let sistema = "";
  try {
    sistema = vistaPreviaContexto(configAgenteDe(activa));
  } catch (error) {
    rojoCadaMinuto("vista-previa", () => logError("al preparar la vista previa del contexto", error));
  }

  return {
    activa,
    guardada: { perfil: guardada.perfiles[perfil.id] ?? {}, sistema: guardada.sistema, rev: guardada.rev },
    entorno: entorno(),
    prompt: {
      texto,
      hash: perfil.hash,
      revision: revisar(texto, perfil.id, activa),
      sistema,
      versionNueva,
      informacion: seccionDe(texto, SECCION_INFORMACION),
    },
    sectores: Object.values(PRESETS).map((p) => ({ id: p.id, etiqueta: p.etiqueta, descripcion: p.descripcion, perfilId: p.perfilId, plantilla: p.plantilla })),
    ejemplos: { ...conteo, de: bd.ajustes.ejemplosDe ?? null, leadsPrueba: bd.ajustes.leadsPrueba },
    avisos: sacarAvisos(),
  };
}

// ---- Escrituras ----

function esObjeto(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const CLAVES_PROHIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

/** Los objetos se fusionan; cualquier otro valor (null y "" incluidos) sustituye. */
function fusionar(base: unknown, cambios: unknown): unknown {
  if (!esObjeto(cambios)) return cambios;
  const salida: Record<string, unknown> = esObjeto(base) ? { ...base } : {};
  for (const [clave, valor] of Object.entries(cambios)) {
    if (valor === undefined || CLAVES_PROHIBIDAS.has(clave)) continue;
    salida[clave] = esObjeto(valor) ? fusionar(salida[clave], valor) : valor;
  }
  return salida;
}

/** El nombre del negocio que quedaría con estos cambios. */
function nombreTras(perfil: Perfil, guardada: ConfiguracionGuardada, id: string, cambios: CambiosPerfil): string {
  const hipotetica: ConfiguracionGuardada = { ...guardada, perfiles: { ...guardada.perfiles, [id]: aplicarCambios(guardada.perfiles[id] ?? {}, cambios) } };
  return resolver({ perfil: { id: perfil.id, nombre: perfil.nombre, hash: perfil.hash }, guardada: hipotetica, entorno: entorno() }).negocio.nombre;
}

export async function guardarCambios(perfilId: string, c: { cambios?: CambiosPerfil; sistema?: CambiosSistema }): Promise<ConfiguracionResuelta> {
  const { perfil, guardada, config: activa } = await activaConGuardada();
  if (perfilId !== perfil.id) throw fallo(409, "El tipo de negocio ha cambiado mientras editabas. Recarga la página.");

  let cambios: CambiosPerfil = {};
  if (c.cambios !== undefined) {
    const r = revisarCambios(c.cambios, { ahora: new Date(), vocabulario: activa.vocabulario, calendario: activa.calendario, regional: activa.regional });
    if ("error" in r) throw fallo(400, r.error, r.campo);
    cambios = r.cambios;
  }
  let sistema: CambiosSistema = {};
  if (c.sistema !== undefined) {
    const r = revisarSistema(c.sistema, { prefijo: activa.regional.prefijo });
    if ("error" in r) throw fallo(400, r.error, r.campo);
    sistema = r.cambios;
  }
  const secciones = [...Object.keys(cambios), ...Object.keys(sistema).map((s) => `sistema.${s}`)];
  if (secciones.length === 0) return activa;

  const id = perfil.id;
  const hayCambios = Object.keys(cambios).length > 0;
  const tocaNombre = esObjeto(cambios.negocio) && Object.hasOwn(cambios.negocio, "nombre");
  const nombreNuevo = tocaNombre ? nombreTras(perfil, guardada, id, cambios) : activa.negocio.nombre;
  const renombrar = tocaNombre && nombreNuevo !== activa.negocio.nombre ? { renombrar: { perfilId: id, nombre: nombreNuevo } } : undefined;

  const nueva = await modificarConfiguracionGuardada((raw): ConfiguracionGuardada => {
    const g = normalizar(raw);
    return {
      ...g,
      rev: g.rev + 1,
      perfiles: hayCambios ? { ...g.perfiles, [id]: aplicarCambios(g.perfiles[id] ?? {}, cambios) } : g.perfiles,
      sistema: fusionar(g.sistema, sistema) as ConfiguracionGuardada["sistema"],
    };
  }, renombrar);
  const enCache = escribirEnCache(nueva);
  avisarCambio("configuracion");
  log(`Configuración guardada (${secciones.join(", ")})`);
  return resolverCon(perfil, enCache);
}

/** El origen de una copia nueva: el de la copia anterior o, en un preset, la huella de su archivo. */
async function origenPara(perfilId: string, copiaPrevia: CopiaInstrucciones | undefined): Promise<string | null> {
  if (copiaPrevia) return copiaPrevia.origen;
  const sector = sectorPreset(perfilId);
  if (!sector) return null;
  try {
    return hashTexto(await leerPreset(sector));
  } catch {
    return null;
  }
}

/** Revisa, escribe agente.md y guarda la copia: lo común de guardar el prompt y la información. */
async function guardarTexto(texto: string, actual: Perfil, config: ConfiguracionResuelta): Promise<{ perfil: Perfil; revision: RevisionPrompt }> {
  const revision = revisar(texto, actual.id, config);
  if (revision.error) throw fallo(400, revision.error);
  const copiaPrevia = (await leerCopiasInstrucciones())[actual.id];
  const perfil = await escribirInstrucciones(texto, actual);
  try {
    await guardarCopiaInstrucciones(perfil.id, {
      texto,
      hash: hashTexto(texto),
      origen: await origenPara(perfil.id, copiaPrevia),
      guardadaEn: Date.now(),
    });
  } catch (error) {
    logError("al guardar la copia de las instrucciones", error);
  }
  avisarCambio("configuracion");
  log(`Instrucciones guardadas (${perfil.nombre})`);
  return { perfil, revision };
}

const HASH_CAMBIADO = "Las instrucciones han cambiado fuera de Ajustes. Recarga para ver la versión nueva.";

export async function guardarPrompt(texto: string, hash: string): Promise<{ perfil: Perfil; revision: RevisionPrompt }> {
  const limpio = String(texto).replace(/\r\n/g, "\n");
  const { perfil: actual, config } = await activaConGuardada();
  if (actual.hash !== hash) throw fallo(409, HASH_CAMBIADO);
  return guardarTexto(limpio, actual, config);
}

/** Cambia la sección «Información que puedes dar tal cual» de las instrucciones. */
export async function guardarInformacion(cuerpo: string, hash: string): Promise<{ perfil: Perfil; revision: RevisionPrompt }> {
  const limpio = String(cuerpo).replace(/\r\n/g, "\n").trim();
  if (limpio.length > LIMITES.informacion) throw fallo(400, "Lo que tiene que saber de tu negocio: como mucho 4.000 caracteres", "informacion");
  const { perfil: actual, config } = await activaConGuardada();
  if (actual.hash !== hash) throw fallo(409, HASH_CAMBIADO);
  return guardarTexto(conSeccion(actual.instrucciones, SECCION_INFORMACION, limpio), actual, config);
}

/** La primera línea «# …» sustituida por `titulo` (o añadida si no hay). */
function conTitulo(texto: string, titulo: string): string {
  const lineas = texto.split("\n");
  const i = lineas.findIndex((l) => /^#\s+\S/.test(l));
  if (i < 0) return `${titulo}\n\n${texto}`;
  lineas[i] = titulo;
  return lineas.join("\n");
}

function tituloDe(texto: string): string {
  return texto.split("\n").find((l) => /^#\s+\S/.test(l)) ?? `# Asistente de WhatsApp · ${leerTitulo(texto).nombre}`;
}

/** El texto de partida de un perfil: el de su preset o, en un negocio propio, el de su base con su título. */
async function textoDePartida(actual: Perfil, config: ConfiguracionResuelta): Promise<{ texto: string; origen: string }> {
  const sector = sectorPreset(actual.id);
  const archivo = await leerPreset(sector ?? config.base);
  return { texto: sector ? archivo : conTitulo(archivo, tituloDe(actual.instrucciones)), origen: hashTexto(archivo) };
}

export async function restaurarPrompt(): Promise<Perfil> {
  const { perfil: actual, config } = await activaConGuardada();
  let partida: { texto: string; origen: string };
  try {
    partida = await textoDePartida(actual, config);
  } catch (error) {
    logError("al leer las instrucciones de partida", error);
    throw fallo(500, ALGO_HA_FALLADO);
  }
  const perfil = await escribirInstrucciones(partida.texto, actual);
  try {
    await guardarCopiaInstrucciones(perfil.id, { texto: partida.texto, hash: perfil.hash, origen: partida.origen, guardadaEn: Date.now() });
  } catch (error) {
    logError("al guardar la copia de las instrucciones", error);
  }
  avisarCambio("configuracion");
  log(`Instrucciones restauradas (${perfil.nombre})`);
  return perfil;
}

export type Destino = { sector: "reformas" | "inmobiliaria" | "clinica" } | { perfilId: string } | { nuevo: NegocioNuevo };

export interface NegocioNuevo {
  nombre: string;
  base: SectorPreset;
  configuracion?: NegocioExportado["configuracion"];
  instrucciones?: string;
  sustituir?: boolean;
}

/** Los clientes de ejemplo tras un cambio de negocio. Si falla, devuelve el aviso. */
async function aplicarEjemplos(activa: ConfiguracionResuelta, ejemplos: "sustituir" | "borrar" | undefined): Promise<string | null> {
  try {
    const accion = ejemplos ?? ((await contarEjemplos()).ejemplo > 0 ? "sustituir" : undefined);
    if (accion === "sustituir") {
      await sustituirEjemplos(opcionesSemilla(activa));
      log(`Datos de ejemplo cargados (${activa.sector})`);
    } else if (accion === "borrar") {
      await borrarEjemplos();
      log("Datos de ejemplo borrados");
    }
    return null;
  } catch (error) {
    logError("al cambiar los clientes de ejemplo", error);
    return `Ahora el CRM es de ${etiquetaDe(activa)}, pero no se han podido cambiar los clientes de ejemplo: pulsa «Cargar» al pie de Ajustes.`;
  }
}

function esSectorPreset(v: unknown): v is SectorPreset {
  return typeof v === "string" && Object.hasOwn(PRESETS, v);
}

export async function cambiarDeNegocio(
  d: Destino,
  o?: { ejemplos?: "sustituir" | "borrar"; nombre?: string },
): Promise<{ activa: ConfiguracionResuelta; avisos: string[] }> {
  const ahora = new Date();
  const { perfil: actual, guardada, config: anterior } = await activaConGuardada();
  const avisos: string[] = [];

  // El nombre que se pide, revisado como en Ajustes.
  const revisarNombre = (nombre: string, preset: SectorPreset): string => {
    const r = revisarCambios({ negocio: { nombre } }, { ahora, calendario: PRESETS[preset].calendario, regional: PRESETS[preset].regional });
    if ("error" in r) throw fallo(400, r.error, r.campo);
    return r.cambios.negocio?.nombre ?? nombre;
  };

  // 2. El perfil de destino y su texto.
  let destinoId: string;
  let texto: string | null = null;
  let configNueva: ConfiguracionPerfil | null = null;
  let nombre = o?.nombre;
  const copias = await leerCopiasInstrucciones();

  if ("sector" in d) {
    if (!sectorPreset(PRESETS[d.sector]?.perfilId ?? "")) throw fallo(400, "Ese tipo de negocio no existe");
    destinoId = PRESETS[d.sector].perfilId as string;
  } else if ("perfilId" in d) {
    destinoId = String(d.perfilId);
  } else {
    const n = d.nuevo;
    if (!esSectorPreset(n.base)) throw fallo(400, "Elige un tipo de negocio de partida", "base");
    const nombreNegocio = revisarNombre(String(o?.nombre ?? n.nombre ?? ""), n.base);
    const natural = slugPerfil(nombreNegocio, new Set());
    const existe = Object.hasOwn(guardada.perfiles, natural.id) || Object.hasOwn(copias, natural.id) || actual.id === natural.id;
    const ocupados = new Set([...Object.keys(guardada.perfiles), ...Object.keys(copias), actual.id]);
    const { id, titulo } = n.sustituir === true && existe && !sectorPreset(natural.id) ? natural : slugPerfil(nombreNegocio, ocupados);
    destinoId = id;
    const base = n.instrucciones ?? (await leerPreset(n.base));
    texto = conTitulo(String(base).replace(/\r\n/g, "\n"), titulo);
    let revisada: CambiosPerfil = {};
    if (n.configuracion !== undefined) {
      const r = revisarCambios(sinLogoVersion(n.configuracion ?? {}), { ahora, calendario: PRESETS[n.base].calendario, regional: PRESETS[n.base].regional });
      if ("error" in r) throw fallo(400, r.error, r.campo);
      revisada = r.cambios;
    }
    // El nombre va el último: un archivo con color y sin nombre conserva el nombre (verifier #25).
    configNueva = aplicarCambios(aplicarCambios({ sector: "personalizado", base: n.base }, revisada), { negocio: { nombre: nombreNegocio } });
    nombre = nombreNegocio;
  }

  // Al mismo negocio: solo el nombre y la casilla de los ejemplos.
  if (destinoId === actual.id && configNueva === null) {
    let activa = anterior;
    if (nombre !== undefined) activa = await guardarCambios(actual.id, { cambios: { negocio: { nombre } } });
    const aviso = await aplicarEjemplos(activa, o?.ejemplos);
    if (aviso) avisos.push(aviso);
    return { activa, avisos };
  }

  if (texto === null) {
    const copia = copias[destinoId];
    const sector = sectorPreset(destinoId);
    if (sector) texto = copia && copia.hash !== copia.origen ? copia.texto : await leerPreset(sector);
    else if (copia) texto = copia.texto;
    else throw fallo(404, "Ese negocio no existe");
  }
  if (nombre !== undefined && configNueva === null) nombre = revisarNombre(nombre, sectorPreset(destinoId) ?? "generico");

  // 3. Las instrucciones tienen que valer y ser de ese perfil.
  const perfilDestino = { ...leerTitulo(texto), hash: hashTexto(texto) };
  const hipotetica: ConfiguracionGuardada = configNueva
    ? { ...guardada, perfiles: { ...guardada.perfiles, [destinoId]: configNueva } }
    : guardada;
  const configDestino = resolver({ perfil: { id: destinoId, nombre: perfilDestino.nombre, hash: perfilDestino.hash }, guardada: hipotetica, entorno: entorno() });
  const revision = revisar(texto, destinoId, configDestino);
  if (revision.error) throw fallo(400, revision.error);

  // 4. El texto saliente se guarda siempre como copia de su perfil; luego, la configuración del destino.
  try {
    await guardarCopiaInstrucciones(actual.id, {
      texto: actual.instrucciones,
      hash: actual.hash,
      origen: await origenPara(actual.id, copias[actual.id]),
      guardadaEn: Date.now(),
    });
  } catch (error) {
    logError("al guardar la copia de las instrucciones", error);
  }
  if (configNueva !== null || nombre !== undefined) {
    const final = nombre;
    const nueva = await modificarConfiguracionGuardada(
      (raw): ConfiguracionGuardada => {
        const g = normalizar(raw);
        const perfilGuardado = configNueva ?? aplicarCambios(g.perfiles[destinoId] ?? {}, { negocio: { nombre: final } });
        return { ...g, rev: g.rev + 1, perfiles: { ...g.perfiles, [destinoId]: perfilGuardado } };
      },
      final !== undefined ? { renombrar: { perfilId: destinoId, nombre: final } } : undefined,
    );
    escribirEnCache(nueva);
  }

  // 5. agente.md.
  const perfil = await escribirInstrucciones(texto, actual);

  // 6. La configuración nueva.
  const activa = resolverCon(perfil, await guardadaEnCache());

  // 7. Los clientes de ejemplo.
  const aviso = await aplicarEjemplos(activa, o?.ejemplos);
  if (aviso) avisos.push(aviso);

  // 8.
  log(`Tipo de negocio: ${etiquetaDe(anterior)} → ${etiquetaDe(activa)}`);
  avisarCambio("configuracion");
  return { activa, avisos };
}

const TIPOS_LOGO: Record<string, (b: Buffer) => boolean> = {
  png: (b) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
};

export async function guardarLogoActivo(dataUrl: string | null): Promise<ConfiguracionResuelta> {
  if (dataUrl !== null) {
    const m = typeof dataUrl === "string" ? dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/) : null;
    const bytes = m ? Buffer.from(m[2], "base64") : null;
    if (!m || !bytes || !TIPOS_LOGO[m[1]](bytes)) throw fallo(400, "Ese archivo no es una imagen PNG, JPG o WebP");
    if (bytes.length > LIMITES.logoBytes) throw fallo(413, "La imagen es demasiado grande");
  }
  const perfil = await perfilActivo();
  await guardarLogo(perfil.id, dataUrl);
  const guardada = await recargarTrasEscribir();
  avisarCambio("configuracion");
  log(dataUrl === null ? "Logo quitado" : "Logo cambiado");
  return resolverCon(perfil, guardada);
}

export async function restablecer(alcance: "perfil" | "todo"): Promise<ConfiguracionResuelta> {
  const { perfil: actual } = await activaConGuardada();
  let perfil = actual;
  if (alcance === "todo") {
    await restablecerConfiguracion();
    await recargarTrasEscribir();
    perfil = await escribirInstrucciones(await leerPreset("reformas"), actual);
  } else {
    const id = actual.id;
    const sector = sectorPreset(id);
    await guardarLogo(id, null);
    await modificarConfiguracionGuardada((raw): ConfiguracionGuardada => {
      const g = normalizar(raw);
      const perfiles = { ...g.perfiles };
      const previo = perfiles[id];
      delete perfiles[id];
      if (!sector && previo) {
        // Un negocio propio conserva su tipo, su base y su nombre (verifier #16), y sus instrucciones.
        const queda: ConfiguracionPerfil = {};
        if (previo.sector !== undefined) queda.sector = previo.sector;
        if (previo.base !== undefined) queda.base = previo.base;
        if (previo.negocio?.nombre !== undefined) queda.negocio = { nombre: previo.negocio.nombre };
        if (Object.keys(queda).length > 0) perfiles[id] = queda;
      }
      return { ...g, rev: g.rev + 1, perfiles };
    });
    await recargarTrasEscribir();
    if (sector) {
      await guardarCopiaInstrucciones(id, null);
      perfil = await escribirInstrucciones(await leerPreset(sector), actual);
    }
  }
  avisarCambio("configuracion");
  log(`Configuración restablecida (${alcance})`);
  return resolverCon(perfil, await guardadaEnCache());
}

/**
 * Enciende o pausa el asistente. Al pausarlo se guarda desde cuándo; pausarlo otra vez no cambia ese
 * momento. La caché se actualiza al instante: lo siguiente que se envíe ya ve la pausa.
 */
export async function cambiarAsistente(activo: boolean): Promise<ConfiguracionSistema["asistente"]> {
  const perfil = await perfilActivo().catch(() => null);
  const sector = sectorDe(perfil?.id);
  const nueva = await modificarConfiguracionGuardada((g): ConfiguracionGuardada => {
    const n = normalizar(g);
    const anterior = n.sistema.asistente ?? {};
    return {
      ...n,
      rev: n.rev + 1,
      sistema: {
        ...n.sistema,
        asistente: { ...anterior, activo, pausadoEn: activo ? null : (anterior.pausadoEn ?? Date.now()) },
      },
    };
  });
  escribirEnCache(nueva);
  log(activo ? "Asistente reactivado desde el panel" : "Asistente en pausa desde el panel");
  avisarCambio("sistema");
  avisarCambio("configuracion");
  return resolverSistema(nueva.sistema, sector).asistente;
}

/** Lo que usa «Probar tu asistente»: lo activo, porque Ajustes guarda cada cambio al momento. */
export async function configuracionParaProbar(): Promise<{ perfil: Perfil; config: ConfiguracionResuelta }> {
  return configuracionActiva();
}

/** Olvida lo guardado en memoria: la siguiente lectura va a la base de datos. */
export function invalidarCache(): void {
  const c = cache();
  c.guardada = null;
  c.memo = null;
  c.refresco = undefined;
  c.falloEn = null;
  c.escritoEn = ++c.orden;
}
