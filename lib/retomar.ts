// «Retomar la conversación»: pasadas 24 h desde el último mensaje del cliente, WhatsApp solo deja
// escribirle con un mensaje aprobado. Qué variables se rellenan solas ({{1}} el nombre del cliente,
// {{2}} el del negocio), cuáles se piden, cómo se limpian y el texto que queda guardado. Puro.

import type { PlantillaAprobada } from "./api-tipos";
import { parametroSeguro } from "./configuracion";
import { rellenar } from "./plantillas";
import type { Lead } from "./tipos";
import { nombreDePila } from "./vocabulario";

const LARGO_VARIABLE = 60;

/** {{1}} con el nombre de pila del cliente y {{2}} con el del negocio; lo demás (o lo que no se sepa) se pide. */
export function variablesDePlantilla(p: PlantillaAprobada, lead: Lead, negocio: string): { fijas: Record<number, string>; pedir: number[] } {
  const fijas: Record<number, string> = {};
  const pedir: number[] = [];
  for (const n of p.variables) {
    if (n === 1) {
      // Quien escribió por WhatsApp sin nombre se guarda con el teléfono enmascarado: ese no vale.
      const nombre = parametroSeguro(nombreDePila(lead.nombre), LARGO_VARIABLE);
      if (/\p{L}/u.test(nombre)) fijas[1] = nombre;
      else pedir.push(1);
    } else if (n === 2) {
      const valor = parametroSeguro(negocio, LARGO_VARIABLE);
      if (valor) fijas[2] = valor;
      else pedir.push(2);
    } else {
      pedir.push(n);
    }
  }
  return { fijas, pedir };
}

/** La etiqueta de una variable en el texto de error: «el nombre del cliente», «el dato 3». */
function nombreVariable(n: number): string {
  return n === 1 ? "el nombre del cliente" : n === 2 ? "el nombre del negocio" : `el dato ${n}`;
}

/**
 * `valores[n - 1]` es la variable n. Cada una, en una línea y cortada a 60 caracteres; ninguna vacía.
 * Devuelve la lista limpia, por posición y sin huecos, hasta la última variable de la plantilla.
 */
export function revisarVariables(p: PlantillaAprobada, valores: string[]): { valores: string[] } | { error: string; variable: number } {
  const hasta = p.variables.length ? Math.max(...p.variables) : 0;
  const limpios: string[] = [];
  for (let n = 1; n <= hasta; n++) {
    const crudo = valores[n - 1];
    const valor = parametroSeguro(typeof crudo === "string" ? crudo : "", LARGO_VARIABLE);
    if (!valor) return { error: `Rellena ${nombreVariable(n)}`, variable: n };
    limpios.push(valor);
  }
  return { valores: limpios };
}

/** El texto que recibe el cliente y que se guarda en la conversación. */
export function textoRenderizado(p: PlantillaAprobada, valores: string[]): string {
  return rellenar(p.texto, valores);
}

/** El nombre de cada campo que se pide: «Nombre del cliente», «Nombre del negocio», «Dato 3». */
export function etiquetaVariable(n: number): string {
  return n === 1 ? "Nombre del cliente" : n === 2 ? "Nombre del negocio" : `Dato ${n}`;
}

const CATEGORIAS: Record<string, string> = { UTILITY: "Utilidad", MARKETING: "Marketing", AUTHENTICATION: "Autenticación" };

/** La categoría que ha puesto Meta, en español. Otra cualquiera, tal cual. */
export function nombreCategoria(c: string): string {
  return CATEGORIAS[c] ?? c;
}

/**
 * Si una plantilla aprobada sirve para retomar: no es una de las que no tienen sentido para un cliente
 * (la bienvenida activa, las de la app, la de prueba de Meta) y todas sus variables van numeradas
 * ({{nombre}} no se puede rellenar).
 */
export function sePuedeRetomar(p: PlantillaAprobada, nombresExcluidos: readonly string[]): boolean {
  if (nombresExcluidos.includes(p.nombre)) return false;
  const marcas = p.texto.match(/\{\{[^}]*\}\}/g) ?? [];
  return marcas.every((m) => /^\{\{\d+\}\}$/.test(m));
}
