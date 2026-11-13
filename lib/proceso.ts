import { ejecutarAgente, type SalidaAgente } from "./agente";
import { aplicaReglaSpam, levantaSilencio, porQueNoContesta } from "./asistente";
import { avisarComercial } from "./aviso";
import { guardarMutaciones, leerLead, leerReservas, mensajesDeClientesDesde } from "./bd";
import { buzon, type Ejecucion } from "./buzon";
import { mensajeWeb, parametroSeguro, type ConfiguracionResuelta } from "./configuracion";
import { configuracionActiva } from "./configuracion-servidor";
import { entradaParaAgente } from "./entrada-agente";
import { explicar, explicarClaude, type ErrorExplicado } from "./errores";
import { avisarLlegada, avisarLlegadaFallida, marcarEscribiendo } from "./eventos";
import { esMensajeDeLaWeb, fuenteDeReferido, FUENTE_WEB } from "./fuente";
import { log, logAviso, logError, recortar } from "./log";
import { conPresentacion, crearLead, enmascararTelefono, idDeLead, necesitaPresentacion, pideBaja, pideBorrarDatos } from "./negocio";
import { detectarSpam } from "./spam";
import type { Entrante, Lead, Lote, Mensaje, Mutacion } from "./tipos";
import { transcribir } from "./transcripcion";
import { nombreDePila } from "./vocabulario";
import { ErrorWhatsApp, enviarTexto, marcarLeido } from "./whatsapp";

const HORA_MS = 60 * 60_000;
const MOTIVO_BORRAR_DATOS = "Pide que borres sus datos";

/** Lo que se guarda de cada mensaje entrante. Un audio se guarda ya transcrito. */
async function leerEntrante(m: Entrante): Promise<{ mensaje: Mensaje; entendido: boolean; audio: boolean }> {
  const base = { id: m.wamid, de: "cliente" as const, ts: m.ts };
  if (m.tipo !== "audio" || !m.mediaId) return { mensaje: { ...base, texto: m.texto }, entendido: m.tipo === "texto", audio: false };
  try {
    const texto = await transcribir(m.wamid, m.mediaId);
    if (texto) return { mensaje: { ...base, texto, audio: true }, entendido: true, audio: true };
    log("Nota de voz sin nada que se entienda");
  } catch (error) {
    logError("al transcribir una nota de voz", error);
  }
  return { mensaje: { ...base, texto: m.texto }, entendido: false, audio: true };
}

/** Un número que parezca un estado HTTP, en el error o en su causa (el APICallError del AI SDK lo lleva). */
function estadoHttp(error: unknown): { status?: number; mensaje?: string } {
  const candidatos: unknown[] = [error];
  for (let i = 0; i < candidatos.length && i < 6; i++) {
    const e = candidatos[i];
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    const status = typeof o.statusCode === "number" ? o.statusCode : typeof o.status === "number" ? o.status : undefined;
    if (status !== undefined) {
      const partes = [o.message, o.responseBody].filter((p): p is string => typeof p === "string");
      return { status, mensaje: partes.join(" ") };
    }
    candidatos.push(o.cause, o.lastError);
  }
  return {};
}

/** Por qué no ha podido contestar Claude. Sin estado HTTP (descartada dos veces, tiempo agotado), «Algo ha fallado». */
function falloDeClaude(error: unknown): ErrorExplicado {
  const { status, mensaje } = estadoHttp(error);
  return status === undefined ? explicar("desconocido") : explicarClaude(status, mensaje);
}

/** La presentación («Soy el asistente virtual de…») en la primera respuesta libre, frases fijas incluidas. */
function presentar(texto: string, lead: Lead, config: ConfiguracionResuelta, negocio: string): string {
  return necesitaPresentacion(lead.mensajes) ? conPresentacion(texto, config.agente.frases.presentacion.replace("{negocio}", negocio)) : texto;
}

/** El aviso al comercial nunca hace esperar a la respuesta ni la rompe. */
function avisarSinEsperar(lead: Lead, motivo: string, ultimoMensaje: string, config: ConfiguracionResuelta): void {
  avisarComercial(lead, motivo, ultimoMensaje, config).catch((error) => logError("al avisar al comercial", error));
}

/**
 * Procesa un lote y envía la respuesta. Lo que ha escrito el cliente se guarda al momento, para
 * que el panel lo enseñe sin esperar. Lo que decide el agente se guarda después de enviar: si se
 * cancela o falla el envío, no deja rastro y el cliente no ha leído nada que no sea cierto.
 */
export async function procesarLote(lote: Lote, ejecucion: Ejecucion): Promise<void> {
  const senal = ejecucion.controlador.signal;
  if (senal.aborted) return;

  try {
    // La transcripción empezó al entrar el webhook: aquí normalmente ya está.
    const [{ perfil, config }, entrantes] = await Promise.all([configuracionActiva(), Promise.all(lote.mensajes.map(leerEntrante))]);
    if (senal.aborted) return;
    const frases = config.agente.frases;
    const negocio = parametroSeguro(config.negocio.nombre) || perfil.nombre;
    const prefijo = config.regional.prefijo;

    const leadId = idDeLead(lote.telefono, perfil.id);
    const primero = lote.mensajes[0];
    const ultimo = lote.mensajes[lote.mensajes.length - 1];
    const previo = await leerLead(leadId);
    const nuevo = !previo;

    const entrada: Mutacion[] = [];
    if (!previo) {
      // Sin nombre de perfil se guarda la máscara: el nombre sale en la terminal; el teléfono entero está en `telefono`.
      // El anuncio de Meta manda; si no, el mensaje que escribe solo el botón de la web dice que viene de ella.
      const fuente = fuenteDeReferido(primero.referido) ?? (primero.tipo === "texto" && esMensajeDeLaWeb(primero.texto, mensajeWeb(config)) ? { ...FUENTE_WEB } : undefined);
      entrada.push({
        t: "lead",
        lead: crearLead({
          telefono: lote.telefono,
          perfilId: perfil.id,
          perfilNombre: config.negocio.nombre,
          nombre: primero.nombrePerfil || enmascararTelefono(lote.telefono, prefijo),
          origen: "whatsapp",
          creadoEn: primero.ts,
          ...(fuente ? { fuente } : {}),
        }),
      });
    }
    for (const { mensaje } of entrantes) entrada.push({ t: "mensaje", leadId, mensaje });
    if (!previo || previo.estado === "nuevo" || previo.estado === "conversacion") {
      entrada.push({ t: "estado", leadId, estado: "conversacion", ts: ultimo.ts });
    }
    await guardarMutaciones(entrada);

    // El cronómetro del panel cuenta desde que llegó el webhook, no desde que se cerró el lote.
    if (nuevo) {
      const nombre = primero.nombrePerfil || enmascararTelefono(lote.telefono, prefijo);
      avisarLlegada({ leadId, nombre: nombreDePila(nombre), canal: "whatsapp", inicio: primero.recibidoEn ?? Date.now() });
    }

    // Las tres lecturas a la vez: con la base de datos en Supabase, cada una es un viaje por internet.
    const [leido, recientes, reservas] = await Promise.all([leerLead(leadId), mensajesDeClientesDesde(Date.now() - HORA_MS), leerReservas()]);
    if (!leido) return;
    let lead: Lead = leido;
    const textoNuevo = entrantes
      .filter((e) => e.entendido)
      .map((e) => e.mensaje.texto)
      .join(" ");

    /** La primera respuesta a un lead de WhatsApp que ha llegado en este lote: lo que tardó en contestar. */
    const respuestaPrimera = (ts: number): Mutacion[] =>
      nuevo && primero.recibidoEn !== undefined ? [{ t: "respuesta", leadId, ms: Math.max(0, ts - primero.recibidoEn) }] : [];

    /** Envía una frase fija (con la presentación si es la primera) y devuelve lo que hay que guardar. */
    const enviarFija = async (texto: string): Promise<Mutacion[]> => {
      const final = presentar(texto, lead, config, negocio);
      const ts0 = Date.now();
      try {
        const wamid = await enviarTexto(lote.telefono, final);
        const ts = Date.now();
        log(`Respuesta a ${lead.nombre} (${((ts - ultimo.ts) / 1000).toFixed(1)} s): ${recortar(final)}`);
        return [
          { t: "mensaje", leadId, mensaje: { id: wamid || `${lote.loteId}-r`, de: "agente", texto: final, ts, ...(wamid ? { entrega: "enviado" as const } : {}) } },
          ...respuestaPrimera(ts),
        ];
      } catch (error) {
        const e = error instanceof ErrorWhatsApp ? error.explicado : explicar("desconocido");
        logError(`al contestar a ${lead.nombre}`, error);
        if (nuevo) avisarLlegadaFallida({ leadId, nombre: nombreDePila(lead.nombre), codigo: e.codigo, texto: e.titulo });
        return [{ t: "actividad", leadId, id: `fallo-${leadId}-${ts0}`, texto: `No se ha podido contestar: ${e.titulo}`, ts: ts0 }];
      }
    };

    // Quien pidió que no le escribieran y ahora escribe algo de verdad: se le vuelve a contestar.
    if (levantaSilencio(lead, textoNuevo)) {
      await guardarMutaciones([{ t: "permitir", leadId, ts: Date.now(), por: "cliente" }]);
      log(`Ha vuelto a escribir: se le puede contestar (${lead.nombre})`);
      lead = { ...lead, silenciadoEn: undefined };
    }

    // Un cliente cerrado que vuelve a escribir: una línea por cierre, el cierre no se toca y se le contesta como siempre.
    if (lead.cierre && lote.mensajes.some((m) => m.ts > (lead.cierreEn ?? 0))) {
      await guardarMutaciones([{ t: "actividad", leadId, id: `volvio-${leadId}-${lead.cierreEn}`, texto: "Ha vuelto a escribir", ts: Date.now() }]);
    }

    const motivo = porQueNoContesta(lead, config.sistema);

    // Ya lo lleva una persona, o es spam: el asistente no contesta más a este número con este perfil.
    if (motivo === "persona" || motivo === "spam") {
      void marcarLeido(ultimo.wamid, false);
      if (motivo === "persona" && pideBaja(textoNuevo)) await guardarMutaciones([{ t: "silencio", leadId, ts: Date.now() }]);
      log(motivo === "persona" ? `Sin respuesta, ya lo lleva una persona: ${lead.nombre}` : `Sin respuesta, es spam: ${lead.nombre}`);
      buzon.empezarEnvio(ejecucion, lote);
      return;
    }

    // Pide que borren sus datos: pasa al dueño con el motivo. El asistente nunca dice que los borra.
    if (pideBorrarDatos(textoNuevo)) {
      const ts = Date.now();
      const mutaciones: Mutacion[] = [{ t: "estado", leadId, estado: "persona", ts, motivo: MOTIVO_BORRAR_DATOS }];
      if (pideBaja(textoNuevo)) mutaciones.push({ t: "silencio", leadId, ts });
      if (config.sistema.asistente.activo && !lead.silenciadoEn) {
        void marcarLeido(ultimo.wamid, false);
        buzon.empezarEnvio(ejecucion, lote);
        mutaciones.push(...(await enviarFija(frases.borrarDatos.replace("{negocio}", negocio))));
      } else {
        if (lead.silenciadoEn) void marcarLeido(ultimo.wamid, false);
        buzon.empezarEnvio(ejecucion, lote);
      }
      await guardarMutaciones(mutaciones);
      log(`${MOTIVO_BORRAR_DATOS}: ${lead.nombre}`);
      const actualizado = (await leerLead(leadId)) ?? lead;
      avisarSinEsperar(actualizado, MOTIVO_BORRAR_DATOS, textoNuevo, config);
      return;
    }

    if (motivo === "silencio") {
      void marcarLeido(ultimo.wamid, false);
      log(`Sin respuesta: ha pedido que no le escribamos (${lead.nombre})`);
      buzon.empezarEnvio(ejecucion, lote);
      return;
    }

    // La baja: una sola confirmación (si el asistente está encendido) y nadie le vuelve a escribir.
    if (pideBaja(textoNuevo)) {
      const mutaciones: Mutacion[] = [{ t: "silencio", leadId, ts: Date.now() }];
      if (config.sistema.asistente.activo) {
        void marcarLeido(ultimo.wamid, false);
        buzon.empezarEnvio(ejecucion, lote);
        mutaciones.push(...(await enviarFija(frases.baja)));
      } else {
        buzon.empezarEnvio(ejecucion, lote);
      }
      await guardarMutaciones(mutaciones);
      log(`Ha pedido que no le escribamos: ${lead.nombre}`);
      return;
    }

    if (motivo === "pausa") {
      log(`Asistente en pausa: guardado sin responder (${lead.nombre})`);
      buzon.empezarEnvio(ejecucion, lote);
      return;
    }

    // La regla de spam va antes del modelo: no gasta nada y no depende de lo que opine. Quien ha
    // rellenado el formulario, quien añadiste tú o quien tiene una cita es un cliente: no se le aplica.
    if (aplicaReglaSpam(lead)) {
      const ahora = Date.now();
      const spam = detectarSpam(
        {
          textos: entrantes.filter((e) => e.entendido).map((e) => e.mensaje.texto),
          recientes,
          telefono: lote.telefono,
          ahora,
        },
        config.spam,
      );
      if (spam) {
        // En un envío masivo, los que llegaron antes también lo eran: ya no se les vuelve a contestar.
        const otros = (await Promise.all(spam.otros.map((telefono) => leerLead(idDeLead(telefono, perfil.id))))).filter(
          (otro): otro is Lead => !!otro && aplicaReglaSpam(otro) && (otro.estado === "nuevo" || otro.estado === "conversacion"),
        );
        await guardarMutaciones([lead, ...otros].map((l): Mutacion => ({ t: "estado", leadId: l.id, estado: "spam", ts: ahora, motivo: spam.motivo })));
        logAviso(`Spam, no se contesta: ${lead.nombre}. ${spam.motivo}${otros.length ? ` (y ${otros.length} más con el mismo texto)` : ""}`);
        buzon.empezarEnvio(ejecucion, lote);
        return;
      }
    }

    void marcarLeido(ultimo.wamid, true);
    marcarEscribiendo(lead.id, true);
    try {
      let texto: string;
      let salida: SalidaAgente | undefined;
      let fallo: ErrorExplicado | undefined;

      if (!entrantes.some((e) => e.entendido)) {
        const soloAudios = entrantes.every((e) => e.audio);
        texto = soloAudios ? frases.audio : frases.noTexto;
        log(`${soloAudios ? "Audio que no se ha podido entender" : "Mensaje que no es texto"} de ${lead.nombre}: se le pide otra vez`);
      } else {
        try {
          salida = await ejecutarAgente(entradaParaAgente({ perfil, config, lead, reservas, senal }));
          texto = salida.texto;
        } catch (error) {
          if (senal.aborted) return;
          logError(`del agente con ${lead.nombre}`, error);
          texto = frases.fallo;
          fallo = falloDeClaude(error);
        }
      }

      if (senal.aborted) return;

      // Si se ha apagado el asistente mientras pensaba, no sale nada.
      const ahoraActiva = await configuracionActiva().catch(() => null);
      if (ahoraActiva && !ahoraActiva.config.sistema.asistente.activo) {
        log(`Asistente en pausa: guardado sin responder (${lead.nombre})`);
        buzon.empezarEnvio(ejecucion, lote);
        return;
      }
      if (senal.aborted) return;

      texto = presentar(texto, lead, config, negocio);

      // Punto sin retorno: a partir de aquí, lo que entre será un lote nuevo.
      buzon.empezarEnvio(ejecucion, lote);
      let wamid: string;
      try {
        wamid = await enviarTexto(lote.telefono, texto);
      } catch (error) {
        const e = error instanceof ErrorWhatsApp ? error.explicado : explicar("desconocido");
        const ts = Date.now();
        await guardarMutaciones([{ t: "actividad", leadId, id: `fallo-${leadId}-${ts}`, texto: `No se ha podido contestar: ${e.titulo}`, ts }]);
        if (nuevo) avisarLlegadaFallida({ leadId, nombre: nombreDePila(lead.nombre), codigo: e.codigo, texto: e.titulo });
        logError(`al contestar a ${lead.nombre}`, error);
        return;
      }
      const ts = Date.now();
      await guardarMutaciones([
        ...(salida?.mutaciones ?? []),
        { t: "mensaje", leadId, mensaje: { id: wamid || `${lote.loteId}-r`, de: "agente", texto, ts, ...(wamid ? { entrega: "enviado" as const } : {}) } },
        ...(fallo ? [{ t: "actividad", leadId, id: `fallo-${leadId}-${ts}`, texto: `No se ha podido contestar: ${fallo.titulo}`, ts } satisfies Mutacion] : []),
        ...(fallo ? [] : respuestaPrimera(ts)),
      ]);
      if (fallo && nuevo) avisarLlegadaFallida({ leadId, nombre: nombreDePila(lead.nombre), codigo: fallo.codigo, texto: fallo.titulo });

      const ms = ts - ultimo.ts;
      log(`Respuesta a ${lead.nombre} (${(ms / 1000).toFixed(1)} s): ${recortar(texto)}`);
      for (const evento of salida?.eventos ?? []) {
        if (evento.startsWith("⚠")) logAviso(evento);
        else log(evento);
      }

      if (salida?.persona) {
        const actualizado = (await leerLead(leadId)) ?? lead;
        const ultimoDelCliente = entrantes.map((e) => e.mensaje.texto).join(" ");
        avisarSinEsperar(actualizado, salida.persona, ultimoDelCliente, config);
      }
    } finally {
      marcarEscribiendo(lead.id, false);
    }
  } catch (error) {
    logError(`al procesar un mensaje de ${enmascararTelefono(lote.telefono)}`, error);
  }
}
