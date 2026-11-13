import type { ErrorApi } from "@/lib/api-tipos";
import {
  aplicarCambios,
  LIMITES,
  revisarCambios,
  revisarInstrucciones,
  sinLogoVersion,
  slugPerfil,
  type CambiosPerfil,
  type CambiosSistema,
  type ConfiguracionGuardada,
  type SectorPreset,
} from "@/lib/configuracion";
import { datosConfiguracion, entorno, guardarCambios, restablecer } from "@/lib/configuracion-servidor";
import { logError } from "@/lib/log";
import { PRESETS, resolver } from "@/lib/presets";

// La configuración del negocio: leerla entera para Ajustes, guardar un cambio, volver a la de partida
// y comprobar un archivo de negocio sin guardar nada.

export const dynamic = "force-dynamic";

const NO_SE_ENTIENDE = "No se ha entendido la petición";
const DEMASIADO = "El cambio es demasiado grande";
const ALGO_HA_FALLADO = "Algo ha fallado. Vuelve a intentarlo en un momento.";
const ESTADOS = new Set([400, 404, 409, 413, 500]);

function error(status: number, mensaje: string, campo?: string): Response {
  return Response.json({ ok: false, error: mensaje, ...(campo ? { campo } : {}) } satisfies ErrorApi, { status });
}

function respuestaDeError(e: unknown, contexto: string): Response {
  const status = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
  if (e instanceof Error && typeof status === "number" && ESTADOS.has(status)) {
    const campo = (e as { campo?: unknown }).campo;
    return error(status, e.message, typeof campo === "string" ? campo : undefined);
  }
  logError(contexto, e);
  return error(500, ALGO_HA_FALLADO);
}

/** El cuerpo JSON, sin pasar del límite: primero por la cabecera y luego por lo leído. */
async function leerJson(request: Request, limite: number): Promise<{ cuerpo: unknown } | { respuesta: Response }> {
  if (Number(request.headers.get("content-length") ?? 0) > limite) return { respuesta: error(413, DEMASIADO) };
  const trozos: Uint8Array[] = [];
  let total = 0;
  const lector = request.body?.getReader();
  if (lector) {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > limite) {
        await lector.cancel().catch(() => {});
        return { respuesta: error(413, DEMASIADO) };
      }
      trozos.push(value);
    }
  }
  try {
    return { cuerpo: JSON.parse(Buffer.concat(trozos).toString("utf8")) as unknown };
  } catch {
    return { respuesta: error(400, NO_SE_ENTIENDE) };
  }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function GET() {
  try {
    return Response.json(await datosConfiguracion());
  } catch (e) {
    return respuestaDeError(e, "al leer la configuración");
  }
}

/** Revisa un archivo de negocio (negocios/x.json) como si se fuera a aplicar, sin guardar nada. */
async function comprobar(archivo: unknown): Promise<Response> {
  const errores: { error: string; campo: string }[] = [];
  const avisos: string[] = [];
  const x = esObjeto(archivo) ? archivo : {};
  if (x.formato !== "crm-whatsapp/negocio@1") errores.push({ error: "No es un archivo de negocio de este CRM", campo: "formato" });
  const base = typeof x.base === "string" && Object.hasOwn(PRESETS, x.base) ? (x.base as SectorPreset) : null;
  if (!base) errores.push({ error: "Elige un tipo de negocio de partida: reformas, inmobiliaria, clinica o generico", campo: "base" });
  const nombre = typeof x.nombre === "string" ? x.nombre.trim() : "";
  if (!nombre) errores.push({ error: "Ponle un nombre al negocio", campo: "nombre" });
  const preset = PRESETS[base ?? "generico"];

  let cambios: CambiosPerfil = {};
  const configuracion = x.configuracion === undefined ? {} : x.configuracion;
  if (!esObjeto(configuracion)) errores.push({ error: NO_SE_ENTIENDE, campo: "configuracion" });
  else {
    const r = revisarCambios(sinLogoVersion(configuracion as { negocio?: { logoVersion?: string } }), {
      ahora: new Date(),
      calendario: preset.calendario,
      regional: preset.regional,
    });
    if ("error" in r) errores.push({ error: r.error, campo: r.campo });
    else cambios = r.cambios;
  }

  if (typeof x.instrucciones !== "string") errores.push({ error: "Faltan las instrucciones", campo: "instrucciones" });
  else if (nombre) {
    const { id, titulo } = slugPerfil(nombre, new Set());
    const lineas = x.instrucciones.replace(/\r\n/g, "\n").split("\n");
    const i = lineas.findIndex((l) => /^#\s+\S/.test(l));
    if (i >= 0) lineas[i] = titulo;
    else lineas.unshift(titulo, "");
    const texto = lineas.join("\n");
    const guardada: ConfiguracionGuardada = {
      version: 1,
      rev: 0,
      perfiles: { [id]: aplicarCambios(aplicarCambios({ sector: "personalizado", base: preset.id }, cambios), { negocio: { nombre } }) },
      sistema: {},
    };
    const c = resolver({ perfil: { id, nombre, hash: "" }, guardada, entorno: entorno() });
    const revision = revisarInstrucciones(texto, {
      perfilId: id,
      vocabulario: c.vocabulario,
      agente: c.agente,
      moneda: c.regional.moneda,
      negocio: c.negocio.nombre,
      plantilla: c.plantilla,
    });
    if (revision.error) errores.push({ error: revision.error, campo: "instrucciones" });
    avisos.push(...revision.avisos);
  }

  // Regla E1: con PLANTILLA en .env, un negocio sobre reformas sin plantilla propia hereda solicitud_recibida.
  const e = entorno();
  if (base === "reformas" && !(esObjeto(configuracion) && configuracion.plantilla !== undefined) && (e.PLANTILLA || e.PLANTILLA_IDIOMA)) {
    avisos.push("La plantilla es la de Reformas y pregunta qué reformar: crea la tuya en Meta");
  }
  return Response.json({ ok: errores.length === 0, errores, avisos });
}

export async function POST(request: Request) {
  const leido = await leerJson(request, LIMITES.cuerpoConfigBytes);
  if ("respuesta" in leido) return leido.respuesta;
  const cuerpo = leido.cuerpo;
  if (!esObjeto(cuerpo)) return error(400, NO_SE_ENTIENDE);
  try {
    if (Object.hasOwn(cuerpo, "comprobar")) return await comprobar(cuerpo.comprobar);
    if (Object.hasOwn(cuerpo, "restablecer")) {
      if (cuerpo.restablecer !== "perfil" && cuerpo.restablecer !== "todo") return error(400, NO_SE_ENTIENDE);
      return Response.json({ ok: true, activa: await restablecer(cuerpo.restablecer) });
    }
    if (typeof cuerpo.perfilId !== "string") return error(400, NO_SE_ENTIENDE);
    const activa = await guardarCambios(cuerpo.perfilId, {
      ...(cuerpo.cambios !== undefined ? { cambios: cuerpo.cambios as CambiosPerfil } : {}),
      ...(cuerpo.sistema !== undefined ? { sistema: cuerpo.sistema as CambiosSistema } : {}),
    });
    return Response.json({ ok: true, activa });
  } catch (e) {
    return respuestaDeError(e, "al guardar la configuración");
  }
}
