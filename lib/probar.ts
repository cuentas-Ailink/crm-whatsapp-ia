// «Probar tu asistente», en el servidor: el mismo camino que un mensaje de verdad, con las mismas
// puertas y el mismo asistente, pero sin ningún efecto. No envía nada, no guarda nada y no avisa a
// nadie: solo cuenta lo que haría. Las reservas se leen y nunca se escriben.

import type { LanguageModel } from "ai";
import { ejecutarAgente, type InfoIntento } from "./agente";
import type { PeticionPrueba, ResultadoPrueba } from "./api-tipos";
import { aplicaReglaSpam, levantaSilencio, porQueNoContesta } from "./asistente";
import { leerReservas } from "./bd";
import { modeloEfectivo, parametroSeguro, telefonoComercial } from "./configuracion";
import { configuracionParaProbar } from "./configuracion-servidor";
import { entradaParaAgente } from "./entrada-agente";
import { conPresentacion, necesitaPresentacion, pideBaja, pideBorrarDatos } from "./guion";
import { log } from "./log";
import { crearLead, formatoTelefono, idDeLead } from "./negocio";
import { costeUsd } from "./precios";
import { detectarSpam } from "./spam";
import type { EstadoLead, Lead, Mensaje, Mutacion, Reserva } from "./tipos";

/** El teléfono de la clienta de prueba: no es de nadie. */
const TELEFONO_PRUEBA = "34000000000";
const TIEMPO_MAXIMO_MS = 45_000;
const PRUEBAS_POR_MINUTO = 20;
const MINUTO_MS = 60_000;
const ESTADOS: readonly EstadoLead[] = ["nuevo", "conversacion", "visita", "persona", "spam"];
const HUECO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const PIDE_BORRAR = "Pide que borres sus datos";

/** Un error de la prueba con el código HTTP que debe devolver la ruta. */
export class ErrorPrueba extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorPrueba";
  }
}

const revisa = (problema: string) => new ErrorPrueba(400, `Revisa la prueba: ${problema}`);

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function esHueco(v: unknown): boolean {
  return esObjeto(v) && typeof v.id === "string" && HUECO.test(v.id) && typeof v.texto === "string";
}

/** La primera cosa que no vale de la prueba, como error 400. */
function validar(p: PeticionPrueba): void {
  if (!esObjeto(p) || !esObjeto(p.prueba)) throw new ErrorPrueba(400, "No se ha entendido la petición");
  const prueba = p.prueba as Record<string, unknown>;
  if (prueba.origen !== "formulario" && prueba.origen !== "whatsapp") throw revisa("el origen es el formulario o WhatsApp");
  const nombre = typeof prueba.nombre === "string" ? prueba.nombre.trim() : "";
  if (Array.from(nombre).length < 1 || Array.from(nombre).length > 40) throw revisa("el nombre, de 1 a 40 letras");
  if (!ESTADOS.includes(prueba.estado as EstadoLead)) throw revisa("el estado del cliente no es válido");
  const mensajes = prueba.mensajes;
  const mensajeMalo = (m: unknown) =>
    !esObjeto(m) || typeof m.texto !== "string" || Array.from(m.texto).length > 1000 || typeof m.ts !== "number" || !Number.isFinite(m.ts);
  if (!Array.isArray(mensajes) || mensajes.length > 60 || mensajes.some(mensajeMalo)) throw revisa("como mucho 60 mensajes de 1.000 caracteres");
  if (mensajes.some((m) => m.de !== "cliente" && m.de !== "agente")) throw revisa("cada mensaje es del cliente o de tu asistente");
  const datos = prueba.datos;
  if (!esObjeto(datos) || Object.keys(datos).length > 20 || Object.values(datos).some((v) => typeof v !== "string")) throw revisa("como mucho 20 datos");
  const huecos = prueba.huecosOfrecidos;
  if (!Array.isArray(huecos) || huecos.length > 6 || !huecos.every(esHueco)) throw revisa("como mucho 6 huecos ofrecidos");
  if (prueba.visita !== undefined && !esHueco(prueba.visita)) throw revisa("la cita no es válida");
  const silencio = prueba.silenciadoEn;
  if (silencio !== undefined && !(typeof silencio === "number" && Number.isInteger(silencio) && silencio > 0)) {
    throw revisa("la fecha del silencio no es válida");
  }
}

/** Como mucho 20 pruebas por minuto en este proceso. */
function contarPrueba(): void {
  const g = globalThis as unknown as { __probarAsistente?: number[] };
  const ahora = Date.now();
  const recientes = (g.__probarAsistente ?? []).filter((t) => ahora - t < MINUTO_MS);
  if (recientes.length >= PRUEBAS_POR_MINUTO) {
    g.__probarAsistente = recientes;
    throw new ErrorPrueba(429, "Espera un momento: has hecho muchas pruebas seguidas");
  }
  recientes.push(ahora);
  g.__probarAsistente = recientes;
}

/** Lo que ha escrito el cliente desde la última respuesta del asistente. */
function pendientes(mensajes: Mensaje[]): string[] {
  const ultima = mensajes.findLastIndex((m) => m.de === "agente");
  return mensajes
    .slice(ultima + 1)
    .filter((m) => m.de === "cliente")
    .map((m) => m.texto);
}

const SIN_USO = { entrada: 0, cacheLeida: 0, salida: 0 };

/**
 * Prueba el asistente con una conversación inventada. Pasa por las mismas puertas que un mensaje
 * real (la persona, la publicidad, el silencio, el borrado de datos, la baja) y, si toca, llama al
 * asistente con la configuración activa. Lanza ErrorPrueba con el código de la ruta.
 */
export async function probarAsistente(
  p: PeticionPrueba,
  deps?: { senal?: AbortSignal; modelo?: LanguageModel; ahora?: Date },
): Promise<ResultadoPrueba> {
  validar(p);
  contarPrueba();
  const inicio = Date.now();
  const prueba = p.prueba;
  const { perfil, config } = await configuracionParaProbar();
  const ahora = deps?.ahora ?? new Date();
  const ts = ahora.getTime();
  const frases = config.agente.frases;
  const negocio = parametroSeguro(config.negocio.nombre) || perfil.nombre;
  const modelo = modeloEfectivo(config.sistema, process.env.MODELO);
  const prefijo = config.regional.prefijo;

  // La clienta, solo en memoria. Nueva o en conversación pasa a conversación, como en producción.
  const mensajes: Mensaje[] = prueba.mensajes.map((m, i) => ({
    id: `prueba-${i}`,
    de: m.de,
    texto: m.texto,
    ts: m.ts,
    ...(m.plantilla ? { plantilla: true } : {}),
  }));
  const estado: EstadoLead = prueba.estado === "nuevo" ? "conversacion" : prueba.estado;
  const lead: Lead = crearLead({
    telefono: TELEFONO_PRUEBA,
    perfilId: perfil.id,
    perfilNombre: config.negocio.nombre,
    nombre: prueba.nombre.trim(),
    origen: prueba.origen,
    estado,
    datos: { ...prueba.datos },
    mensajes,
    huecosOfrecidos: [...prueba.huecosOfrecidos],
    ...(prueba.visita ? { visita: prueba.visita } : {}),
    ...(prueba.silenciadoEn ? { silenciadoEn: prueba.silenciadoEn } : {}),
  });
  const textos = pendientes(mensajes);
  const pendiente = textos.join(" ");

  const notas: string[] = [];
  const mutaciones: Mutacion[] = [];
  const conPresentarse = (texto: string) =>
    necesitaPresentacion(lead.mensajes) ? conPresentacion(texto, frases.presentacion.replace("{negocio}", negocio)) : texto;
  const notaAviso = () => {
    const telefono = telefonoComercial(config.sistema, process.env.TELEFONO_COMERCIAL, prefijo);
    if (telefono) notas.push(`Te avisaría por WhatsApp al ${formatoTelefono(telefono, prefijo)}`);
  };
  type Parcial = Omit<ResultadoPrueba, "uso" | "costeUsd" | "ms" | "modelo" | "notas" | "descartes"> & Partial<ResultadoPrueba> & { cacheEscrita?: number };
  const terminar = (r: Parcial): ResultadoPrueba => {
    const uso = r.uso ?? SIN_USO;
    const ms = Date.now() - inicio;
    log(`Prueba del asistente: ${(ms / 1000).toFixed(1)} s (no se envía nada)`);
    return {
      decision: r.decision,
      texto: r.texto,
      mutaciones: r.mutaciones,
      eventos: r.eventos,
      ...(r.persona !== undefined ? { persona: r.persona } : {}),
      descartes: r.descartes ?? [],
      ...(r.fallo !== undefined ? { fallo: r.fallo } : {}),
      uso,
      costeUsd: r.uso ? costeUsd({ ...uso, cacheEscrita: r.cacheEscrita ?? 0 }, modelo) : 0,
      ms,
      modelo,
      notas,
    };
  };

  // 1. Ha vuelto a escribir algo de verdad: se le vuelve a contestar.
  if (levantaSilencio(lead, pendiente)) {
    mutaciones.push({ t: "permitir", leadId: lead.id, ts, por: "cliente" });
    notas.push("Ha vuelto a escribir: a un cliente real se le volvería a contestar");
    delete lead.silenciadoEn;
  }

  // 2. Lo lleva una persona o es publicidad: no se contesta.
  const motivo = porQueNoContesta(lead, config.sistema);
  if (motivo === "persona" || motivo === "spam") {
    return terminar({ decision: "silencio", texto: null, mutaciones, eventos: [motivo === "persona" ? "lo llevas tú" : "es publicidad"] });
  }

  // 3. Pide que borren sus datos: se pasa al dueño con la frase fija, sin el asistente.
  if (pideBorrarDatos(pendiente)) {
    mutaciones.push({ t: "estado", leadId: lead.id, estado: "persona", ts, motivo: PIDE_BORRAR });
    if (pideBaja(pendiente)) mutaciones.push({ t: "silencio", leadId: lead.id, ts });
    notas.push("A un cliente real te lo pasaría para que borres sus datos");
    notaAviso();
    const texto = lead.silenciadoEn ? null : conPresentarse(frases.borrarDatos.replace("{negocio}", negocio));
    return terminar({ decision: "persona", texto, mutaciones, eventos: [], persona: PIDE_BORRAR });
  }

  // 4. Pidió que no le escribamos y no ha escrito nada nuevo.
  if (motivo === "silencio") {
    return terminar({ decision: "silencio", texto: null, mutaciones, eventos: ["pidió que no le escribamos"] });
  }

  // 5. Pide que no le escribamos: la única confirmación que se le manda.
  if (pideBaja(pendiente)) {
    mutaciones.push({ t: "silencio", leadId: lead.id, ts });
    notas.push("En la prueba no se guarda: a un cliente real ya no le escribiría nadie hasta que vuelva a escribir");
    return terminar({ decision: "baja", texto: conPresentarse(frases.baja), mutaciones, eventos: [] });
  }

  // 6. En pausa: se prueba igual, pero se dice.
  if (motivo === "pausa") notas.push("En pausa: a un cliente real no le contestaría");

  // 7. La regla de publicidad, antes del modelo, solo para quien nadie ha avalado.
  if (aplicaReglaSpam(lead)) {
    const spam = detectarSpam(
      {
        textos,
        recientes: mensajes.filter((m) => m.de === "cliente").map((m) => ({ telefono: TELEFONO_PRUEBA, texto: m.texto, ts: m.ts })),
        telefono: TELEFONO_PRUEBA,
        ahora: ts,
      },
      config.spam,
    );
    if (spam) {
      mutaciones.push({ t: "estado", leadId: lead.id, estado: "spam", ts, motivo: spam.motivo });
      return terminar({ decision: "spam", texto: null, mutaciones, eventos: [] });
    }
  }

  // 8. Las citas que hay, sin la de esta clienta y con la de la prueba.
  let reservas: Reserva[] = [];
  try {
    reservas = (await leerReservas()).filter((r) => r.leadId !== lead.id && r.leadId !== idDeLead(TELEFONO_PRUEBA, perfil.id));
  } catch {
    reservas = [];
  }
  if (prueba.visita) {
    reservas.push({ huecoId: prueba.visita.id, texto: prueba.visita.texto, leadId: lead.id, nombre: lead.nombre, perfilNombre: lead.perfilNombre });
  }

  // 9. El asistente, con el uso de cada intento.
  const uso = { entrada: 0, cacheLeida: 0, salida: 0 };
  let cacheEscrita = 0;
  const descartes: string[] = [];
  const alIntento = (i: InfoIntento) => {
    // El uso que da el SDK: entrada sin caché (o toda), lo leído de la caché y la salida.
    if (i.uso) {
      uso.entrada += i.uso.inputTokenDetails?.noCacheTokens ?? i.uso.inputTokens ?? 0;
      uso.cacheLeida += i.uso.inputTokenDetails?.cacheReadTokens ?? 0;
      cacheEscrita += i.uso.inputTokenDetails?.cacheWriteTokens ?? 0;
      uso.salida += i.uso.outputTokens ?? 0;
    }
    if (i.descartada) descartes.push(i.descartada);
  };
  const senales = [...(deps?.senal ? [deps.senal] : []), AbortSignal.timeout(TIEMPO_MAXIMO_MS)];
  let texto: string;
  let fallo: string | undefined;
  let salida: Awaited<ReturnType<typeof ejecutarAgente>> | undefined;
  try {
    salida = await ejecutarAgente(
      entradaParaAgente({ perfil, config, lead, reservas, senal: AbortSignal.any(senales), modelo: deps?.modelo, ahora: deps?.ahora, alIntento }),
    );
    texto = salida.texto;
  } catch (error) {
    if (deps?.senal?.aborted) throw new ErrorPrueba(400, "Prueba cancelada");
    texto = frases.fallo;
    fallo = error instanceof Error ? error.message : String(error);
  }

  const delModelo = salida?.mutaciones ?? [];
  const decision = delModelo.some((m) => m.t === "estado" && m.estado === "spam")
    ? "spam"
    : delModelo.some((m) => m.t === "estado" && m.estado === "persona")
      ? "persona"
      : "contesta";
  if (decision === "persona") notaAviso();
  return terminar({
    decision,
    texto: conPresentarse(texto),
    mutaciones: [...mutaciones, ...delModelo],
    eventos: salida?.eventos ?? [],
    ...(salida?.persona !== undefined ? { persona: salida.persona } : {}),
    descartes,
    ...(fallo !== undefined ? { fallo } : {}),
    uso,
    cacheEscrita,
  });
}
