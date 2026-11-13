"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from "react";
import type { EstadoLlegada } from "@/lib/api-tipos";
import type { ConfiguracionPublica } from "@/lib/configuracion";
import { aplicarEventoLlegada, cerrarConLeads, medidaDe } from "@/lib/llegadas";
import { esEjemplo } from "@/lib/negocio";
import type { Bd, Lead } from "@/lib/tipos";
import { formas, nombreDePila } from "@/lib/vocabulario";
import { desfaseServidor, escucharEventos } from "./datos";

// Las llegadas en directo: un cliente que acaba de llegar (web, WhatsApp o «+ Cliente») y el
// cronómetro hasta su primer WhatsApp. Un solo almacén por pestaña, compartido por el tablero, la
// cabecera de Hoy y la puesta en marcha. Las horas van en el reloj del navegador (lib/llegadas.ts).

/** Una llegada acabada se queda 10 min; un fallo, 10 min desde que llegó. */
const VIGENCIA_MS = 10 * 60_000;
/** Un cronómetro que no ha acabado en 60 s se para: ya no está pasando en directo. */
const EN_MARCHA_MAX_MS = 60_000;
const REPASO_MS = 1_000;

type Estado = Record<string, EstadoLlegada>;

let estado: Estado = {};
/** Cuándo llegó cada fallo, en el reloj del navegador. */
const fallosEn = new Map<string, number>();
/** Los leads que el almacén ya ha visto; null hasta el primer `bd`. */
let vistos: Set<string> | null = null;
const oyentes = new Set<() => void>();
let consumidores = 0;
let dejarDeEscuchar: (() => void) | null = null;
let repaso: ReturnType<typeof setInterval> | null = null;

function poner(siguiente: Estado): void {
  if (siguiente === estado) return;
  // Un fallo nuevo (o una llegada nueva que sustituye a uno viejo) apunta o borra su hora.
  for (const [id, e] of Object.entries(siguiente)) {
    if (e.fallo && estado[id]?.fallo !== e.fallo) fallosEn.set(id, Date.now());
    if (!e.fallo) fallosEn.delete(id);
  }
  for (const id of fallosEn.keys()) if (!siguiente[id]) fallosEn.delete(id);
  estado = siguiente;
  for (const oyente of oyentes) oyente();
}

/** Caducidades: acabadas a los 10 min, fallos a los 10 min, y el cronómetro se para a los 60 s. */
function repasar(): void {
  const ahora = Date.now();
  let siguiente: Estado | null = null;
  for (const [id, e] of Object.entries(estado)) {
    const caducada =
      (e.fallo !== null && ahora - (fallosEn.get(id) ?? ahora) > VIGENCIA_MS) || (e.fallo === null && e.fin !== null && ahora - e.fin > VIGENCIA_MS);
    if (caducada) {
      siguiente ??= { ...estado };
      delete siguiente[id];
    } else if (e.fallo === null && e.fin === null && e.enDirecto && ahora - e.inicio > EN_MARCHA_MAX_MS) {
      siguiente ??= { ...estado };
      siguiente[id] = { ...e, enDirecto: false };
    }
  }
  if (siguiente) poner(siguiente);
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => {
    oyentes.delete(avisar);
  };
}

const leer = () => estado;
const VACIO: Estado = {};
const leerServidor = () => VACIO;

function entrar(): void {
  consumidores++;
  if (consumidores > 1) return;
  dejarDeEscuchar = escucharEventos((e) => poner(aplicarEventoLlegada(estado, e, desfaseServidor())));
  repaso = setInterval(repasar, REPASO_MS);
}

function salir(): void {
  consumidores--;
  if (consumidores > 0) return;
  // El estado se queda en memoria: si se vuelve a montar, sigue donde estaba.
  dejarDeEscuchar?.();
  dejarDeEscuchar = null;
  if (repaso !== null) clearInterval(repaso);
  repaso = null;
}

const CANAL_DE: Partial<Record<Lead["origen"], EstadoLlegada["canal"]>> = { formulario: "formulario", whatsapp: "whatsapp", manual: "manual" };

/** Lo que trae cada `bd`: cierra cronómetros y descubre llegadas que el evento no trajo. */
function conLeads(leads: Record<string, Lead>): void {
  let siguiente = cerrarConLeads(estado, leads);
  const primera = vistos === null;
  const conocidos = vistos ?? new Set<string>();
  const ahora = Date.now();
  const desfase = desfaseServidor();
  for (const lead of Object.values(leads)) {
    if (conocidos.has(lead.id)) continue;
    conocidos.add(lead.id);
    if (primera || siguiente[lead.id] || esEjemplo(lead)) continue;
    // Llegó sin que viéramos el evento: se enseña el resultado final, quieto (sin directo, no hay repetición).
    const canal = CANAL_DE[lead.origen];
    if (!canal) continue;
    const inicio = lead.creadoEn - desfase;
    const ms = medidaDe(canal, lead);
    if (ms === undefined || ahora - inicio > VIGENCIA_MS) continue;
    if (siguiente === estado) siguiente = { ...estado };
    siguiente[lead.id] = { leadId: lead.id, nombre: nombreDePila(lead.nombre), canal, inicio, fin: inicio + ms, fallo: null, enDirecto: false };
  }
  vistos = conocidos;
  poner(siguiente);
}

/** Quita una llegada: el «Quitar aviso» de una tarjeta en rojo. */
export function descartarLlegada(leadId: string): void {
  if (!estado[leadId]) return;
  const siguiente = { ...estado };
  delete siguiente[leadId];
  poner(siguiente);
}

export function useLlegadas(bd: Bd): { porLead: Record<string, EstadoLlegada>; provisionales: EstadoLlegada[] } {
  const porLead = useSyncExternalStore(suscribir, leer, leerServidor);

  useEffect(() => {
    entrar();
    return salir;
  }, []);

  useEffect(() => {
    conLeads(bd.leads);
  }, [bd.leads]);

  const provisionales = useMemo(
    () => Object.values(porLead).filter((e) => !bd.leads[e.leadId]).sort((a, b) => b.inicio - a.inicio),
    [porLead, bd.leads],
  );
  return { porLead, provisionales };
}

const SEGUNDOS = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function segundos(ms: number): string {
  return `${SEGUNDOS.format(Math.max(0, ms) / 1000)} s`;
}

function usePocoMovimiento(): boolean {
  const [reducir, setReducir] = useState(false);
  useEffect(() => {
    const consulta = matchMedia("(prefers-reduced-motion: reduce)");
    setReducir(consulta.matches);
    const cambiar = () => setReducir(consulta.matches);
    consulta.addEventListener("change", cambiar);
    return () => consulta.removeEventListener("change", cambiar);
  }, []);
  return reducir;
}

/** El número corre con requestAnimationFrame mientras no hay `fin`. */
function EnMarcha({ inicio }: { inicio: number }): JSX.Element {
  const [ahora, setAhora] = useState<number | null>(null);
  useEffect(() => {
    let marco = 0;
    const pintar = () => {
      setAhora(Date.now());
      marco = requestAnimationFrame(pintar);
    };
    marco = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(marco);
  }, []);
  return <>{segundos(ahora === null ? 0 : ahora - inicio)}</>;
}

/**
 * Solo los segundos, con un decimal: «1,6 s». Con `fin`, quieto; sin `fin` y en directo, corriendo
 * (con movimiento reducido, «…»); sin `fin` y fuera de directo, nada (I19). Las palabras, quien lo usa.
 */
export function Cronometro(p: { inicio: number; fin: number | null; enDirecto: boolean }): JSX.Element {
  const reducir = usePocoMovimiento();
  if (p.fin !== null) return <span className="tabular-nums">{segundos(p.fin - p.inicio)}</span>;
  if (!p.enDirecto) return <span className="tabular-nums" />;
  return (
    <span className="tabular-nums">
      <span aria-hidden="true">{reducir ? "…" : <EnMarcha inicio={p.inicio} />}</span>
      <span className="sr-only">Enviando…</span>
    </span>
  );
}

/**
 * Cómo llegó, en palabras (las mismas en el tablero y en la cabecera de Hoy): «pide presupuesto desde
 * tu web» (reformas), «pide una cita desde tu web», «te ha escrito por WhatsApp», «lo añadiste tú».
 */
export function fraseDeLlegada(canal: EstadoLlegada["canal"], cfg: Pick<ConfiguracionPublica, "base" | "vocabulario">): string {
  if (canal === "whatsapp") return "te ha escrito por WhatsApp";
  if (canal === "manual") return "lo añadiste tú";
  if (cfg.base === "reformas") return "pide presupuesto desde tu web";
  return `pide ${formas(cfg.vocabulario.cita).un} ${cfg.vocabulario.cita.singular} desde tu web`;
}
