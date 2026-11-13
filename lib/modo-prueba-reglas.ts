// Lo que el modo prueba decide sin disco ni red, para el servidor y el navegador: la lista de
// números permitidos y cómo se enseña el móvil vinculado. Puro: ni process.env ni nada del servidor.

import { enmascararTelefono, normalizarTelefono, unificarTelefono } from "./regional";

export const NO_DISPONIBLE_EN_PRUEBA = "No disponible en modo prueba";
export const MAXIMO_PERMITIDOS = 10;

/** Lo que la puesta en marcha y Ajustes saben del modo prueba (GET /api/modo-prueba). */
export interface EstadoModoPrueba {
  ok: true;
  activo: boolean;
  instalacion: { fase: "sin-instalar" | "instalando" | "preparada" | "error"; segundos: number | null; error: string | null };
  puente: { fase: "parado" | "conectando" | "qr" | "conectado" | "error"; qr: string | null; numero: string | null /* enmascarado */; error: string | null };
  permitidos: string[];
  /** Si el móvil de los avisos está en la lista: solo entonces le llegan en modo prueba. null = sin móvil de avisos. */
  avisoPermitido: boolean | null;
}

/**
 * La lista que escribe el dueño: al menos un número, cada uno con el formato del país del negocio,
 * sin repetidos y como mucho diez. Los huecos vacíos se saltan.
 */
export function revisarPermitidos(entrada: unknown, prefijo: string): { numeros: string[] } | { error: string; indice?: number } {
  if (!Array.isArray(entrada)) return { error: "Escribe al menos un número" };
  const numeros: string[] = [];
  for (const [indice, valor] of entrada.entries()) {
    if (typeof valor !== "string") return { error: "Revisa los números", indice };
    if (!valor.trim()) continue;
    const numero = normalizarTelefono(valor, prefijo);
    if (!numero) return { error: `Revisa el número ${indice + 1}`, indice };
    if (!numeros.includes(numero)) numeros.push(numero);
  }
  if (numeros.length === 0) return { error: "Escribe al menos un número" };
  if (numeros.length > MAXIMO_PERMITIDOS) return { error: `Como mucho ${MAXIMO_PERMITIDOS} números` };
  return { numeros };
}

/** Si un teléfono está en la lista. Una lista vacía no deja pasar a nadie. */
export function estaPermitido(telefono: string, permitidos: readonly string[]): boolean {
  const t = unificarTelefono(String(telefono ?? "").replace(/\D/g, ""));
  return t.length > 0 && permitidos.some((p) => unificarTelefono(p.replace(/\D/g, "")) === t);
}

/** «+34 6•• ••• ••8»: el móvil vinculado se enseña con la primera y la última cifra. */
export function enmascararVinculado(telefono: string, prefijo: string): string {
  const oculto = enmascararTelefono(telefono, prefijo);
  const ultima = String(telefono ?? "").replace(/\D/g, "").slice(-1);
  const posicion = oculto.lastIndexOf("•");
  return posicion >= 0 && ultima ? `${oculto.slice(0, posicion)}${ultima}${oculto.slice(posicion + 1)}` : oculto;
}
