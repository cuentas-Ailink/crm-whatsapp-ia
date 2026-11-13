"use client";

import { Ban, Bot, Check, CheckCheck, FileText, FlaskConical, MessageCircle, UserPlus, UserRound, type LucideIcon } from "lucide-react";
import { vinoDeLaWeb } from "@/lib/fuente";
import { duracion } from "@/lib/inicio";
import { esEjemplo } from "@/lib/negocio";
import type { EstadoLead, Lead, Mensaje, OrigenLead } from "@/lib/tipos";
import { useEtapas } from "./negocio";

// Lo que se repite en el tablero, las listas, la ficha y Hoy: etapa, avatar, canal, quién contesta
// y las marcas de entrega de un WhatsApp.

export const ETAPAS: { estado: EstadoLead; nombre: string; color: string }[] = [
  { estado: "nuevo", nombre: "Con tu asistente", color: "var(--color-nuevo)" },
  { estado: "conversacion", nombre: "Con tu asistente", color: "var(--color-conversacion)" },
  { estado: "visita", nombre: "Con visita", color: "var(--color-visita)" },
  { estado: "persona", nombre: "Te toca", color: "var(--color-persona)" },
  { estado: "spam", nombre: "Publicidad", color: "var(--color-spam)" },
];

export function etapaDe(estado: EstadoLead) {
  return ETAPAS.find((e) => e.estado === estado) ?? ETAPAS[0];
}

/** El color de la etapa, aclarado, para fondos. */
export function tinte(color: string, porcentaje: number): string {
  return `color-mix(in srgb, ${color} ${porcentaje}%, white)`;
}

/** La etapa con las palabras del negocio («Con cita» en una clínica) y el punto de su color. */
export function EtapaPill({ estado }: { estado: EstadoLead }) {
  const etapa = etapaDe(estado);
  const nombre = useEtapas()[estado]?.nombre ?? etapa.nombre;
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] leading-4 font-medium whitespace-nowrap"
      style={{ background: tinte(etapa.color, 16) }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: etapa.color }} />
      {nombre}
    </span>
  );
}

/** Una cifra y su unidad: «85 m²», «1,5 s», «6.120 €», «24 h». */
const CIFRA_Y_UNIDAD = /(\d)[ \t]+(?=(?:m²|m2|m|cm|km|s|min|h|d|€|\$|%)(?![\p{L}\d]))/gu;

/**
 * Pega cada cifra a su unidad con un espacio de no separación: «m²» o «€» nunca se quedan solos al
 * principio de una línea. Todo lo que pinta una medida pasa por aquí.
 */
export function sinCorte(texto: string): string {
  return texto.replace(CIFRA_Y_UNIDAD, "$1\u00a0");
}

const ENLACES = new Set(["de", "del", "la", "las", "los", "y"]);

/**
 * «Cliente de prueba» → «CP», «María de la Fuente» → «MF», «Jordi Vila» → «JV», «Laura (prueba)» → «L».
 * Solo cuentan las palabras que empiezan por letra; «de», «del», «la», «las», «los» e «y» se saltan
 * salvo que no quede otra cosa. Sin ninguna letra (un teléfono enmascarado), "".
 */
export function iniciales(nombre: string): string {
  const palabras = nombre
    .replace(/\(.*?\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p));
  const llenas = palabras.filter((p) => !ENLACES.has(p.toLocaleLowerCase("es")));
  return (llenas.length > 0 ? llenas : palabras)
    .slice(0, 2)
    .map((p) => Array.from(p)[0] ?? "")
    .join("")
    .toLocaleUpperCase("es");
}

/** Con `color`, el círculo toma el tono de la etapa del lead. */
export function Avatar({ nombre, grande = false, color }: { nombre: string; grande?: boolean; color?: string }) {
  const letras = iniciales(nombre);
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-medium ${color ? "" : "bg-fondo text-tinta/80"} ${
        grande ? "size-11 text-[15px]" : "size-9 text-[13px]"
      }`}
      style={color ? { background: tinte(color, 18), color: `color-mix(in srgb, ${color} 70%, black)` } : undefined}
    >
      {letras || <UserRound className="size-4" strokeWidth={1.75} />}
    </span>
  );
}

/** Por dónde llegó: el icono, la palabra corta y la frase completa (para `title` y lectores de pantalla). */
export const CANALES: Record<OrigenLead, { nombre: string; frase: string; Icono: LucideIcon }> = {
  formulario: { nombre: "Tu web", frase: "Llegó por tu web", Icono: FileText },
  whatsapp: { nombre: "WhatsApp", frase: "Llegó por WhatsApp", Icono: MessageCircle },
  manual: { nombre: "A mano", frase: "Lo añadiste tú", Icono: UserPlus },
  prueba: { nombre: "Ejemplo", frase: "Ejemplo", Icono: FlaskConical },
};

/** Por dónde llegó un cliente: quien escribió con el botón de la web sale como «Te escribió desde tu web». */
export function canalDe(lead: Pick<Lead, "origen" | "fuente"> | undefined, origen: OrigenLead): (typeof CANALES)[OrigenLead] {
  if (vinoDeLaWeb(lead)) return { nombre: "Tu web", frase: "Te escribió desde tu web", Icono: MessageCircle };
  return CANALES[origen] ?? CANALES.formulario;
}

/** La marca pequeña de los contactos de ejemplo. */
export function ChipEjemplo() {
  return <span className="shrink-0 rounded-[4px] bg-fondo px-1 text-[11px] leading-4 text-secundario">Ejemplo</span>;
}

export function Origen({ lead }: { lead: Lead }) {
  const { nombre, Icono } = canalDe(lead, lead.origen);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icono className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{nombre}</span>
      {esEjemplo(lead) && lead.origen !== "prueba" && <ChipEjemplo />}
    </span>
  );
}

/** Quién le contesta ahora. Sale del estado: no hay más responsables que estos. */
export function Responsable({ lead }: { lead: Lead }) {
  const [nombre, Icono, clase] =
    lead.estado === "persona"
      ? (["Tú", UserRound, "text-atencion-texto"] as const)
      : lead.estado === "spam"
        ? (["Sin respuesta", Ban, ""] as const)
        : (["Tu asistente", Bot, ""] as const);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${clase}`}>
      <Icono className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{nombre}</span>
    </span>
  );
}

/**
 * Lo que Meta dice de un mensaje enviado, como en WhatsApp: ✓ enviado, ✓✓ entregado, ✓✓ azul leído,
 * «No entregado» en rojo. Sin estado conocido, nada.
 */
export function Ticks({ mensaje }: { mensaje: Pick<Mensaje, "entrega" | "fallo"> }) {
  switch (mensaje.entrega) {
    case "enviado":
      return <Check role="img" aria-label="Enviado" className="size-4 shrink-0 text-secundario" strokeWidth={2} />;
    case "entregado":
      return <CheckCheck role="img" aria-label="Entregado" className="size-4 shrink-0 text-secundario" strokeWidth={2} />;
    case "leido":
      return <CheckCheck role="img" aria-label="Leído" className="size-4 shrink-0 text-[#53bdeb]" strokeWidth={2} />;
    case "fallido":
      return (
        <span className="shrink-0 text-error-texto" title={mensaje.fallo} aria-label={`No entregado: ${mensaje.fallo ?? ""}`}>
          No entregado
        </span>
      );
    default:
      return null;
  }
}

export { resumenDatos } from "@/lib/vocabulario";

/** «ahora» o «hace 3 min»: el mismo redondeo que Hoy y las tarjetas (`duracion`). */
export function haceCuanto(ts: number, ahora: Date): string {
  const ms = ahora.getTime() - ts;
  if (Math.round(ms / 60_000) < 1) return "ahora";
  return `hace ${duracion(ms)}`;
}
