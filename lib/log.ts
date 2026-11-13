// Terminal legible: una línea por evento, en español, con la hora de este ordenador. Nunca se
// imprimen claves ni el teléfono completo.

function hora(): string {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

export function log(mensaje: string): void {
  console.log(`${hora()}  ${mensaje}`);
}

/** Un aviso rojo, para lo que hay que ver aunque no se esté mirando la terminal. */
export function logAviso(mensaje: string): void {
  console.log(`\x1b[31m${hora()}  ${mensaje}\x1b[0m`);
}

export function logError(contexto: string, error: unknown): void {
  const detalle = error instanceof Error ? error.message : String(error);
  console.log(`\x1b[31m${hora()}  ERROR ${contexto}: ${detalle}\x1b[0m`);
}

export function recortar(texto: string, largo = 70): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : limpio;
}
