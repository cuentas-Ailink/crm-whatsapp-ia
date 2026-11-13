// Lo que cuesta una prueba del asistente, para la línea de «Probar tu asistente». Puro.
// Precios de Anthropic por millón de tokens, copiados el día de FECHA_PRECIOS. Los prompts de la
// prueba son de unos pocos miles de tokens: el tramo de Haiku de más de 100 000 nunca se aplica.

import type { IdModelo } from "./configuracion";

export const FECHA_PRECIOS = "2026-10-06";

/** USD por millón de tokens. */
export const PRECIOS: Record<IdModelo, { entrada: number; salida: number; cacheLeida: number }> = {
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, cacheLeida: 0.01 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10, cacheLeida: 0.2 },
};

/** Escribir en la caché cuesta la entrada × 1,25 (hoy cero: no se pide caché). */
const FACTOR_CACHE_ESCRITA = 1.25;
const MILLON = 1_000_000;

/** El coste en dólares de un uso. Un modelo desconocido se cobra como Haiku. */
export function costeUsd(uso: { entrada: number; cacheLeida: number; cacheEscrita?: number; salida: number }, id: string): number {
  const p = Object.hasOwn(PRECIOS, id) ? PRECIOS[id as IdModelo] : PRECIOS["claude-haiku-5-5"];
  const partes =
    uso.entrada * p.entrada + uso.cacheLeida * p.cacheLeida + (uso.cacheEscrita ?? 0) * p.entrada * FACTOR_CACHE_ESCRITA + uso.salida * p.salida;
  return partes / MILLON;
}
