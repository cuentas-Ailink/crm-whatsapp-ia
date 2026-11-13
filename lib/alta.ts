// El único camino para dar de alta a un cliente: el formulario de la web y «+ Cliente» del panel.
// Valida, evita mandar dos bienvenidas seguidas, avisa al panel antes de llamar a Meta y solo
// guarda al cliente si el WhatsApp ha salido (o si se añade a mano sin permiso para escribirle).

import { guardarMutaciones, leerLead } from "./bd";
import { LIMITES, parametroSeguro, textoPlantilla } from "./configuracion";
import { configuracionActiva } from "./configuracion-servidor";
import { explicar, type CodigoError, type ErrorExplicado } from "./errores";
import { avisarLlegada, avisarLlegadaFallida } from "./eventos";
import { fuenteDeUtm } from "./fuente";
import { log, logAviso } from "./log";
import { crearLead, idDeLead, LARGO_FICHA } from "./negocio";
import { enmascararTelefono, normalizarTelefono } from "./regional";
import type { Lead, Mutacion } from "./tipos";
import { modoServidor } from "./tunel";
import { campoPrincipal, nombreDePila } from "./vocabulario";
import { ErrorWhatsApp, enviarPlantillaConVariables } from "./whatsapp";

export interface PeticionAlta {
  nombre: string;
  telefono: string;
  email?: string;
  zona?: string;
  quiere?: string;
  origen: "formulario" | "manual";
  permiso: boolean;
  fuente?: unknown;
}

export type ResultadoAlta =
  | { ok: true; leadId: string; enviado: boolean }
  | { ok: false; status: 400 | 409 | 429 | 502; error: string; codigo?: CodigoError; campo?: string; leadId?: string };

const NO_HEMOS_PODIDO = "No hemos podido enviarte el WhatsApp. Inténtalo de nuevo en un momento.";
/** Dos envíos al mismo móvil en menos de esto mandan una sola bienvenida. */
const VENTANA_REPETIDA_MS = 60_000;
const ESPERA_REINTENTO_MS = 500;

/** Cuándo salió la última bienvenida a cada móvil. En globalThis: sobrevive a la recarga de Next. */
function enviosRecientes(): Map<string, number> {
  const g = globalThis as unknown as { __bienvenidasRecientes?: Map<string, number> };
  g.__bienvenidasRecientes ??= new Map();
  return g.__bienvenidasRecientes;
}

function limpiarRecientes(ahora: number): Map<string, number> {
  const recientes = enviosRecientes();
  for (const [telefono, ts] of recientes) if (ahora - ts >= VENTANA_REPETIDA_MS) recientes.delete(telefono);
  return recientes;
}

const texto = (valor: unknown): string => (typeof valor === "string" ? valor : valor == null ? "" : String(valor));
const recortarA = (valor: unknown, max: number): string => Array.from(texto(valor).trim()).slice(0, max).join("").trim();

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Los códigos de Node cuando no se llega a hablar con el otro lado. */
const CODIGOS_DE_RED = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

/** Sin respuesta de Meta: fetch no llegó (sin red, DNS, conexión cortada) o se agotó el tiempo. */
function fueLaRed(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  const causa = (error as Error & { cause?: unknown }).cause;
  const codigo = typeof causa === "object" && causa !== null ? (causa as { code?: unknown }).code : undefined;
  if (typeof codigo === "string" && CODIGOS_DE_RED.has(codigo)) return true;
  return error instanceof TypeError && error.message === "fetch failed";
}

/** Guarda, y si la base de datos falla, lo intenta una vez más medio segundo después. */
async function guardarConReintento(mutaciones: Mutacion[], enmascarado: string): Promise<boolean> {
  try {
    await guardarMutaciones(mutaciones);
    return true;
  } catch (error) {
    logAviso(`No se ha podido guardar el cliente (${enmascarado}): ${error instanceof Error ? error.message : String(error)}. Se vuelve a intentar.`);
  }
  await esperar(ESPERA_REINTENTO_MS);
  try {
    await guardarMutaciones(mutaciones);
    return true;
  } catch {
    logAviso(`Cliente sin guardar: el WhatsApp ya ha salido (${enmascarado})`);
    return false;
  }
}

export async function darDeAlta(p: PeticionAlta): Promise<ResultadoAlta> {
  const inicio = Date.now();
  const manual = p.origen === "manual";
  let activa: Awaited<ReturnType<typeof configuracionActiva>>;
  try {
    activa = await configuracionActiva();
  } catch {
    return { ok: false, status: 502, error: NO_HEMOS_PODIDO };
  }
  const { perfil, config } = activa;
  const prefijo = config.regional.prefijo;

  // 1. Validación.
  const nombre = parametroSeguro(texto(p.nombre), LARGO_FICHA.nombre);
  if (!nombre) return { ok: false, status: 400, error: manual ? "Escribe su nombre" : "Escribe tu nombre", campo: "nombre" };
  const telefono = normalizarTelefono(texto(p.telefono), prefijo);
  if (!telefono) return { ok: false, status: 400, error: manual ? "Revisa el móvil" : "Revisa el teléfono", campo: "telefono" };
  if (!manual && p.permiso !== true) {
    return { ok: false, status: 400, error: "Falta aceptar que te contactemos por WhatsApp", campo: "consentimiento" };
  }
  const email = recortarA(p.email, LARGO_FICHA.email) || undefined;
  const zona = config.vocabulario.zona === null ? undefined : recortarA(p.zona, LARGO_FICHA.zona) || undefined;
  const datos: Record<string, string> = {};
  if (zona && config.campos.some((c) => c.clave === "zona")) datos.zona = zona;
  const quiere = recortarA(p.quiere, LIMITES.quiere);
  if (quiere) datos[campoPrincipal(config.campos) ?? "necesidad"] = quiere;
  const fuente = manual ? undefined : fuenteDeUtm(p.fuente);
  const negocio = parametroSeguro(config.negocio.nombre) || parametroSeguro(perfil.nombre) || "el negocio";

  // 2. A mano, un móvil que ya está: se abre su ficha, no se pisa nada.
  const leadId = idDeLead(telefono, perfil.id);
  const enmascarado = enmascararTelefono(telefono, prefijo);
  if (manual) {
    const existente = await leerLead(leadId).catch(() => undefined);
    if (existente) return { ok: false, status: 409, error: `Ya tienes a ${existente.nombre} con ese móvil`, leadId };
  }

  const base = { telefono, perfilId: perfil.id, perfilNombre: config.negocio.nombre, nombre, email, zona, origen: p.origen, datos };

  // 3. A mano y sin permiso: se guarda y no se le escribe.
  if (manual && p.permiso !== true) {
    const lead = crearLead({ ...base, estado: "nuevo", creadoEn: inicio });
    try {
      await guardarMutaciones([{ t: "lead", lead }, { t: "actividad", leadId, id: `alta-${leadId}-${inicio}`, texto: "Lo añadiste tú", ts: inicio }]);
    } catch (error) {
      logAviso(`No se ha podido guardar el cliente (${enmascarado}): ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, status: 502, error: "No se ha podido guardar el cliente. Vuelve a intentarlo en un momento." };
    }
    log(`Nuevo cliente: ${nombre} (añadido a mano), sin escribirle por WhatsApp`);
    return { ok: true, leadId, enviado: false };
  }

  // 4. Con permiso: la bienvenida, una sola vez por minuto y móvil.
  const recientes = limpiarRecientes(inicio);
  if (recientes.has(telefono)) {
    log(`Bienvenida repetida en menos de 60 s: no se vuelve a enviar (${enmascarado})`);
    return { ok: true, leadId, enviado: false };
  }
  recientes.set(telefono, inicio);

  avisarLlegada({ leadId, nombre: nombreDePila(nombre), canal: manual ? "manual" : "formulario", inicio });

  let wamid: string;
  try {
    wamid = await enviarPlantillaConVariables(telefono, { nombre: config.plantilla.nombre, idioma: config.plantilla.idioma, variables: [nombre, negocio] });
  } catch (error) {
    if (recientes.get(telefono) === inicio) recientes.delete(telefono);
    const e: ErrorExplicado = error instanceof ErrorWhatsApp ? error.explicado : explicar(fueLaRed(error) ? "red" : "desconocido");
    avisarLlegadaFallida({ leadId, nombre: nombreDePila(nombre), codigo: e.codigo, texto: e.titulo });
    logAviso(`No se ha podido enviar la bienvenida (${enmascarado}): ${error instanceof Error ? error.message : String(error)}`);
    if (manual) return { ok: false, status: 502, error: `No se ha podido enviar el WhatsApp: ${e.titulo}. ${e.solucion}`, codigo: e.codigo };
    return { ok: false, status: 502, error: NO_HEMOS_PODIDO, codigo: e.codigo, ...(modoServidor() ? {} : { causa: e.titulo }) };
  }

  const ahora = Date.now();
  const lead: Lead = crearLead({
    ...base,
    creadoEn: ahora,
    msPrimerWhatsApp: ahora - inicio,
    ...(fuente ? { fuente } : {}),
    mensajes: [
      {
        id: wamid || `plantilla-${ahora}`,
        de: "agente",
        texto: textoPlantilla(nombre, negocio, config.plantilla.texto),
        ts: ahora,
        plantilla: true,
        nombrePlantilla: config.plantilla.nombre,
        ...(wamid ? { entrega: "enviado" as const } : {}),
      },
    ],
  });
  const historial: Mutacion[] = manual
    ? [
        { t: "actividad", leadId, id: `alta-${leadId}-${ahora}`, texto: "Lo añadiste tú", ts: ahora },
        { t: "actividad", leadId, id: `permiso-${leadId}-${ahora}`, texto: "Te ha dado permiso para escribirle por WhatsApp (lo has marcado tú)", ts: ahora },
      ]
    : [{ t: "actividad", leadId, id: `alta-${leadId}-${ahora}`, texto: "Ha pedido que le escribamos por WhatsApp desde tu web", ts: ahora }];

  const guardado = await guardarConReintento([{ t: "lead", lead }, ...historial], enmascarado);
  if (!guardado && manual) {
    return { ok: false, status: 502, error: "El WhatsApp ha salido, pero no se ha podido guardar el cliente. Vuelve a cargar en un momento." };
  }

  const segundos = ((ahora - inicio) / 1000).toFixed(1).replace(".", ",");
  log(`Nuevo cliente: ${nombre} (${manual ? "añadido a mano" : "formulario"}) → mensaje de bienvenida enviado en ${segundos} s`);
  return { ok: true, leadId, enviado: true };
}
