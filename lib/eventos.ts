// Los avisos del servidor al panel: qué ha cambiado, quién acaba de llegar y a quién se está
// contestando. Solo en el servidor. El estado vive en globalThis porque Next puede cargar este
// módulo una vez por cada ruta, y todas tienen que oír lo mismo.

import type { Cambio, Llegada, LlegadaFallida, TipoCambio } from "./api-tipos";

export type EventoServidor = { tipo: "cambio"; cambio: Cambio } | { tipo: "llegada"; llegada: Llegada } | { tipo: "llegada-fallida"; fallo: LlegadaFallida };

/** Los cambios del mismo tipo que llegan en este margen salen juntos, en un solo aviso. */
const MARGEN_MS = 50;
/** Una marca de «escribiendo» que nadie quita deja de contar pasado este tiempo. */
const CADUCIDAD_ESCRIBIENDO_MS = 60_000;

interface Estado {
  rev: number;
  pendientes: Map<TipoCambio, ReturnType<typeof setTimeout>>;
  cambios: Set<(c: Cambio) => void>;
  servidor: Set<(e: EventoServidor) => void>;
  escribiendo: Map<string, number>;
  webhooks: { valido: number | null; rechazado: number | null };
}

const global_ = globalThis as unknown as { __eventos?: Estado };

function estado(): Estado {
  global_.__eventos ??= {
    rev: 0,
    pendientes: new Map(),
    cambios: new Set(),
    servidor: new Set(),
    escribiendo: new Map(),
    webhooks: { valido: null, rechazado: null },
  };
  return global_.__eventos;
}

/** Un oyente que falla no impide que les llegue a los demás. */
function repartir<T>(oyentes: Set<(x: T) => void>, valor: T): void {
  for (const oyente of [...oyentes]) {
    try {
      oyente(valor);
    } catch {
      // Lo que haga mal un oyente es cosa suya.
    }
  }
}

function emitirServidor(evento: EventoServidor): void {
  repartir(estado().servidor, evento);
}

/** Avisa de que algo de ese tipo ha cambiado. Varios avisos seguidos del mismo tipo salen en uno. */
export function avisarCambio(tipo: TipoCambio): void {
  const e = estado();
  if (e.pendientes.has(tipo)) return;
  const temporizador = setTimeout(() => {
    e.pendientes.delete(tipo);
    e.rev += 1;
    const cambio: Cambio = { tipo, rev: e.rev };
    repartir(e.cambios, cambio);
    emitirServidor({ tipo: "cambio", cambio });
  }, MARGEN_MS);
  (temporizador as { unref?: () => void }).unref?.();
  e.pendientes.set(tipo, temporizador);
}

export function escucharCambios(f: (c: Cambio) => void): () => void {
  const oyentes = estado().cambios;
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** Acaba de llegar alguien: sale en el momento, sin juntarse con nada. */
export function avisarLlegada(l: Llegada): void {
  emitirServidor({ tipo: "llegada", llegada: l });
}

export function avisarLlegadaFallida(f: LlegadaFallida): void {
  emitirServidor({ tipo: "llegada-fallida", fallo: f });
}

export function escucharServidor(f: (e: EventoServidor) => void): () => void {
  const oyentes = estado().servidor;
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** El asistente empieza o deja de contestar a ese lead. */
export function marcarEscribiendo(leadId: string, activo: boolean): void {
  const e = estado();
  if (activo) e.escribiendo.set(leadId, Date.now());
  else e.escribiendo.delete(leadId);
  avisarCambio("escribiendo");
}

/** Los leads a los que el asistente está contestando ahora mismo. */
export function leadsEscribiendo(): string[] {
  const e = estado();
  const ahora = Date.now();
  for (const [leadId, desde] of e.escribiendo) {
    if (ahora - desde > CADUCIDAD_ESCRIBIENDO_MS) e.escribiendo.delete(leadId);
  }
  return [...e.escribiendo.keys()];
}

export function registrarWebhook(r: "valido" | "rechazado"): void {
  estado().webhooks[r] = Date.now();
}

export function ultimosWebhooks(): { valido: number | null; rechazado: number | null } {
  const { valido, rechazado } = estado().webhooks;
  return { valido, rechazado };
}
