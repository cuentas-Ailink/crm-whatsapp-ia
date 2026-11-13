// Los sectores de partida y cómo se resuelve la configuración activa: lo guardado encima del preset,
// con la regla E1 para lo heredado de .env. Puro: el entorno llega como argumento.

import { revisarReglas } from "../agenda";
import {
  CUERPO_POR_DEFECTO,
  CUERPOS_CONOCIDOS,
  firmaDe,
  FRASES_USTED,
  generarPistaDatos,
  GUARDADA_VACIA,
  publica,
  resolverSistema,
  revisarCambios,
  revisarPlantilla,
  type ConfiguracionGuardada,
  type ConfiguracionPerfil,
  type ConfiguracionResuelta,
  type FrasesFijas,
  type Plantilla,
  type Portada,
  type Preset,
  type ReglasAgente,
  type SectorId,
  type SectorPreset,
  type Web,
} from "../configuracion";
import type { Regional } from "../regional";
import type { ReglasAgenda } from "../tipos";
import type { CampoLead, Vocabulario } from "../vocabulario";
import { PRESET_CLINICA } from "./clinica";
import { PRESET_GENERICO } from "./generico";
import { PRESET_INMOBILIARIA } from "./inmobiliaria";
import { PRESET_REFORMAS } from "./reformas";

export const PRESETS: Record<SectorPreset, Preset> = {
  reformas: PRESET_REFORMAS,
  inmobiliaria: PRESET_INMOBILIARIA,
  clinica: PRESET_CLINICA,
  generico: PRESET_GENERICO,
};

export const SECTOR_DE_PERFIL: Record<string, Exclude<SectorPreset, "generico">> = {
  "estudio-de-reformas": "reformas",
  inmobiliaria: "inmobiliaria",
  clinica: "clinica",
};

/** Ids de perfil que no puede tomar un negocio nuevo: el de los ejemplos y los de los tres presets. */
export const PERFILES_RESERVADOS: ReadonlySet<string> = new Set(["ejemplo", "estudio-de-reformas", "inmobiliaria", "clinica"]);

export interface Entorno { NOMBRE_NEGOCIO?: string; PLANTILLA?: string; PLANTILLA_IDIOMA?: string }

type Registro = Record<string, unknown>;

function esObjeto(v: unknown): v is Registro {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function esSectorPreset(v: unknown): v is SectorPreset {
  return typeof v === "string" && Object.hasOwn(PRESETS, v);
}

const CLAVES_PROHIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

/** Lo guardado encima del preset: los objetos se fusionan, los arrays se sustituyen y null deja el valor del preset. */
function mezclar<T>(base: T, encima: unknown): T {
  if (!esObjeto(encima)) return base;
  const salida: Registro = { ...(base as Registro) };
  for (const [clave, valor] of Object.entries(encima)) {
    if (valor === null || valor === undefined || CLAVES_PROHIBIDAS.has(clave)) continue;
    const debajo = salida[clave];
    salida[clave] = esObjeto(valor) && esObjeto(debajo) ? mezclar(debajo, valor) : valor;
  }
  return salida as T;
}

/** revisarCambios solo mira la fecha para los huecos libres, y el resolver no le pasa el calendario. */
const SIN_FECHA = new Date(0);

/** Una sección guardada, revisada con las reglas de revisarCambios. Si no vale, undefined: manda el preset. */
function seccionGuardada(clave: string, valor: unknown, p: Preset): Registro | unknown[] | undefined {
  if (valor === undefined || valor === null) return undefined;
  const r = revisarCambios({ [clave]: valor }, { ahora: SIN_FECHA, calendario: p.calendario, regional: p.regional });
  if ("error" in r) return undefined;
  const revisado = (r.cambios as Registro)[clave];
  return esObjeto(revisado) || Array.isArray(revisado) ? revisado : undefined;
}

/** La galería y el estudio no tienen base en el preset: si están, tienen que estar enteros. */
function extrasCompletos(portada: Portada): boolean {
  const g: unknown = portada.galeria;
  if (g !== undefined && !(esObjeto(g) && typeof g.titular === "string" && typeof g.nota === "string" && Array.isArray(g.tarjetas))) return false;
  const e: unknown = portada.estudio;
  if (e !== undefined && !(esObjeto(e) && typeof e.titular === "string" && typeof e.texto === "string" && Array.isArray(e.servicios))) return false;
  return true;
}

function sinNulos(v: Registro): Registro {
  return Object.fromEntries(Object.entries(v).filter(([clave, valor]) => valor !== null && valor !== undefined && !CLAVES_PROHIBIDAS.has(clave)));
}

const CLAVES_FRASES = Object.keys(FRASES_USTED) as (keyof FrasesFijas)[];

function resolverSinRed(e: { perfil: { id: string; nombre: string; hash: string }; guardada: ConfiguracionGuardada; entorno: Entorno }): ConfiguracionResuelta {
  const env: Entorno = esObjeto(e.entorno) ? e.entorno : {};
  const id = e.perfil.id;
  const guardada: unknown = e.guardada;
  const perfiles = esObjeto(guardada) && esObjeto(guardada.perfiles) ? guardada.perfiles : {};
  const over: ConfiguracionPerfil = Object.hasOwn(perfiles, id) && esObjeto(perfiles[id]) ? (perfiles[id] as ConfiguracionPerfil) : {};

  // 1. Sector y base
  const delPerfil = Object.hasOwn(SECTOR_DE_PERFIL, id) ? SECTOR_DE_PERFIL[id] : undefined;
  const sector: SectorId = delPerfil ?? "personalizado";
  const base: SectorPreset = delPerfil ?? (esSectorPreset(over.base) ? over.base : "reformas");
  const p = PRESETS[base];

  // 4 y 8. El negocio: el nombre guardado, el del título si es un perfil propio, el de .env solo en reformas
  const negocioGuardado: Registro = esObjeto(over.negocio) ? over.negocio : {};
  const { logoVersion, ...negocioSinLogo } = negocioGuardado;
  const negocioValido = seccionGuardada("negocio", Object.keys(negocioSinLogo).length ? negocioSinLogo : undefined, p) as Registro | undefined;
  const nombreGuardado = typeof negocioValido?.nombre === "string" ? negocioValido.nombre : undefined;
  const nombre =
    nombreGuardado ??
    (sector === "personalizado" && e.perfil.nombre ? e.perfil.nombre : undefined) ??
    (base === "reformas" && sector !== "personalizado" && env.NOMBRE_NEGOCIO ? env.NOMBRE_NEGOCIO : undefined) ??
    p.negocio.nombre;
  const negocio = {
    ...mezclar(p.negocio, negocioValido),
    nombre,
    logoUrl: typeof logoVersion === "string" && logoVersion !== "" ? `/api/logo?perfil=${encodeURIComponent(id)}&v=${encodeURIComponent(logoVersion)}` : null,
  };

  // 5. La plantilla va entera, nunca mezclada (regla E1)
  const plantillaGuardada = over.plantilla !== undefined && over.plantilla !== null ? revisarPlantilla(over.plantilla) : null;
  let plantilla: Plantilla;
  if (plantillaGuardada && "plantilla" in plantillaGuardada) plantilla = plantillaGuardada.plantilla;
  else if (base === "reformas" && (env.PLANTILLA || env.PLANTILLA_IDIOMA)) {
    const n = env.PLANTILLA || "solicitud_recibida";
    plantilla = { nombre: n, idioma: env.PLANTILLA_IDIOMA || "es_ES", texto: Object.hasOwn(CUERPOS_CONOCIDOS, n) ? CUERPOS_CONOCIDOS[n] : CUERPO_POR_DEFECTO };
  } else plantilla = p.plantilla;

  // 3. El calendario, por revisarReglas con el del preset debajo
  const calendarioGuardado = esObjeto(over.calendario) ? sinNulos(over.calendario) : {};
  const reglas = revisarReglas({ ...p.calendario, ...calendarioGuardado }, p.calendario);
  const calendario: ReglasAgenda = "error" in reglas ? { ...p.calendario } : reglas.reglas;

  // 2. Cada sección encima de la del preset; si no vale, la del preset
  const regionalMezclada = mezclar<Regional>(p.regional, seccionGuardada("regional", over.regional, p));
  const regional = (seccionGuardada("regional", regionalMezclada, p) as Regional | undefined) ?? p.regional;
  const vocabulario = mezclar<Vocabulario>(p.vocabulario, seccionGuardada("vocabulario", over.vocabulario, p));
  const camposGuardados = seccionGuardada("campos", over.campos, p) as CampoLead[] | undefined;
  const campos = camposGuardados ?? p.campos;
  const spam = mezclar(p.spam, seccionGuardada("spam", over.spam, p));
  const portadaMezclada = mezclar<Portada>(p.portada, seccionGuardada("portada", over.portada, p));
  const portada = extrasCompletos(portadaMezclada) ? portadaMezclada : p.portada;
  const web = mezclar<Web>(p.web, seccionGuardada("web", over.web, p));

  // 6. El asistente: el trato manda en las frases que no se han guardado
  const agenteGuardado = (seccionGuardada("agente", over.agente, p) as Registro | undefined) ?? {};
  const { frases: frasesGuardadas, ...restoAgente } = agenteGuardado;
  const trato: ReglasAgente["trato"] = agenteGuardado.trato === "tu" || agenteGuardado.trato === "usted" ? agenteGuardado.trato : p.agente.trato;
  const frases = {} as FrasesFijas;
  for (const clave of CLAVES_FRASES) {
    const guardadaFrase = esObjeto(frasesGuardadas) ? frasesGuardadas[clave] : undefined;
    frases[clave] = typeof guardadaFrase === "string" ? guardadaFrase : trato === "usted" ? FRASES_USTED[clave] : p.agente.frases[clave];
  }
  const agente: ReglasAgente = { ...mezclar(p.agente, restoAgente), trato, frases };

  // 7. La pista de guardar_dato
  const pistaDatos = camposGuardados ? generarPistaDatos(campos, vocabulario) : (p.pistaDatos ?? generarPistaDatos(p.campos, vocabulario));

  // 9. Lo demás; la firma, la última
  const rev = esObjeto(guardada) && typeof guardada.rev === "number" && Number.isInteger(guardada.rev) && guardada.rev >= 0 ? guardada.rev : 0;
  const resultado: ConfiguracionResuelta = {
    perfil: { id, nombre: e.perfil.nombre, hash: e.perfil.hash },
    sector,
    base,
    guardada: Object.keys(over).length > 0,
    negocio,
    plantilla,
    calendario,
    regional,
    vocabulario,
    campos,
    agente,
    pistaDatos,
    spam,
    portada,
    web,
    sistema: resolverSistema(esObjeto(guardada) ? guardada.sistema : undefined, sector),
    rev,
    firma: "",
  };
  resultado.firma = firmaDe(publica({ ...resultado, firma: "" }));
  return resultado;
}

/** La configuración activa de un perfil. Nunca lanza: con lo guardado roto, el preset tal cual. */
export function resolver(e: { perfil: { id: string; nombre: string; hash: string }; guardada: ConfiguracionGuardada; entorno: Entorno }): ConfiguracionResuelta {
  try {
    return resolverSinRed(e);
  } catch {
    const perfil =
      esObjeto(e) && esObjeto(e.perfil) && typeof e.perfil.id === "string" && typeof e.perfil.nombre === "string" && typeof e.perfil.hash === "string"
        ? (e.perfil as { id: string; nombre: string; hash: string })
        : { id: "estudio-de-reformas", nombre: "Estudio de reformas", hash: "" };
    try {
      return resolverSinRed({ perfil, guardada: GUARDADA_VACIA, entorno: {} });
    } catch {
      return resolverSinRed({ perfil: { id: "estudio-de-reformas", nombre: "Estudio de reformas", hash: "" }, guardada: GUARDADA_VACIA, entorno: {} });
    }
  }
}

/** Reformas, sin nada guardado y sin entorno. */
export function configuracionPorDefecto(): ConfiguracionResuelta {
  return resolver({ perfil: { id: "estudio-de-reformas", nombre: "Estudio de reformas", hash: "" }, guardada: GUARDADA_VACIA, entorno: {} });
}
