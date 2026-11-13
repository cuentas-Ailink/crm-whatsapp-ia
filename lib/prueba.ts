// «Probar tu asistente», la parte pura: cómo queda la conversación de prueba con lo que decidiría
// el asistente y cómo se cuenta cada decisión, con las palabras del negocio. Se usa también en el
// navegador: nada de Node, base de datos, claves ni variables de entorno.

import type { PeticionPrueba, ResultadoPrueba } from "./api-tipos";
import type { Mutacion } from "./tipos";
import { formas, VOCABULARIO_REFORMAS, type Vocabulario } from "./vocabulario";

type Prueba = PeticionPrueba["prueba"];

/** Lo mismo que haría la base de datos con estos cambios, pero sobre la conversación de prueba. */
export function aplicarPrueba(p: Prueba, mutaciones: Mutacion[]): Prueba {
  const r: Prueba = { ...p, datos: { ...p.datos }, mensajes: [...p.mensajes], huecosOfrecidos: [...p.huecosOfrecidos] };
  for (const m of mutaciones) {
    if (m.t === "estado") {
      // Pasar a una persona y marcar como publicidad son definitivos.
      if (r.estado !== "persona" && r.estado !== "spam") r.estado = m.estado;
    } else if (m.t === "huecos") {
      r.huecosOfrecidos = [...m.huecos];
    } else if (m.t === "dato") {
      r.datos[m.campo] = m.valor;
    } else if (m.t === "reserva") {
      r.visita = m.hueco;
    } else if (m.t === "cancelar") {
      delete r.visita;
    } else if (m.t === "silencio") {
      r.silenciadoEn ??= m.ts;
    } else if (m.t === "permitir") {
      delete r.silenciadoEn;
    } else if (m.t === "mensaje") {
      const { de, texto, ts, plantilla } = m.mensaje;
      r.mensajes.push({ de, texto, ts, ...(plantilla ? { plantilla } : {}) });
    }
  }
  return r;
}

type Accion = { texto: string; tono: "normal" | "aviso" | "error" };

/** Lo que haría el asistente, en frases cortas para enseñar bajo la respuesta de la prueba. */
export function accionesDe(r: ResultadoPrueba, v: Vocabulario = VOCABULARIO_REFORMAS): Accion[] {
  const acciones: Accion[] = [];
  const poner = (texto: string, tono: Accion["tono"] = "normal") => {
    // Dos llamadas a ver_huecos pueden dejar dos veces lo mismo: se cuenta una.
    if (!acciones.some((a) => a.texto === texto)) acciones.push({ texto, tono });
  };
  if (r.decision === "silencio") poner(`No contestaría: ${r.eventos[0] ?? "no le toca"}`, "aviso");
  for (const m of r.mutaciones) {
    if (m.t === "huecos" && m.huecos.length > 0) poner(`Ofrecería: ${m.huecos.map((h) => h.texto).join(" · ")}`);
    else if (m.t === "reserva") poner(`Reservaría: ${m.hueco.texto} (en la prueba no se reserva)`);
    else if (m.t === "cancelar") poner(`Anularía ${formas(v.cita).el} ${v.cita.singular}`);
    else if (m.t === "dato") poner(`Guardaría: ${m.campo} = ${m.valor}`);
    else if (m.t === "estado" && m.estado === "persona") poner(`Te lo pasaría: ${m.motivo ?? "lo lleva una persona"}`, "aviso");
    else if (m.t === "estado" && m.estado === "spam") poner(`Lo marcaría como publicidad: ${m.motivo ?? "es publicidad"}`, "aviso");
    else if (m.t === "silencio") poner("Dejaría de escribirle: ha pedido que no le escriban", "aviso");
    else if (m.t === "permitir") poner("Volvería a contestarle: ha vuelto a escribir");
  }
  for (const motivo of r.descartes) poner(`Respuesta descartada y repetida: ${motivo}`, "aviso");
  if (r.fallo) poner(`Le enviaría la disculpa: «${r.texto ?? ""}»`, "error");
  return acciones;
}
