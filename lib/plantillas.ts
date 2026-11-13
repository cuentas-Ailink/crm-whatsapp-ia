// Las plantillas de WhatsApp que la app crea y usa. Puro: los textos y lo que se manda a Meta.

import type { IdPlantillaApp } from "./api-tipos";
import type { Plantilla } from "./configuracion";

export interface PlantillaApp { id: IdPlantillaApp; nombre: string; idioma: "es_ES"; categoria: "UTILITY"; texto: string; ejemplos: string[] }
export const PLANTILLA_AVISO: PlantillaApp = { id: "aviso", nombre: "aviso_comercial", idioma: "es_ES", categoria: "UTILITY",
  texto: "Aviso del CRM: {{1}} necesita hablar contigo ({{2}}). Su teléfono es {{3}}. Tienes la conversación en el panel.",
  ejemplos: ["Laura", "Pide hablar con una persona", "+34 612 345 678"] };
export const PLANTILLA_RETOMAR: PlantillaApp = { id: "retomar", nombre: "retomar_conversacion", idioma: "es_ES", categoria: "UTILITY",
  texto: "Hola {{1}}, te escribimos de {{2}} sobre tu solicitud. ¿Seguimos por aquí? Responde a este mensaje y te atendemos.",
  ejemplos: ["Laura", "Estudio de reformas"] };

/** El mensaje de bienvenida del negocio como plantilla de la app (siempre en es_ES). */
export function plantillaDeBienvenida(p: Plantilla, negocio: string): PlantillaApp {
  return { id: "bienvenida", nombre: p.nombre, idioma: "es_ES", categoria: "UTILITY", texto: p.texto, ejemplos: ["Laura", negocio] };
}

/** Las plantillas que la app necesita aprobadas: la bienvenida, el aviso al comercial y la de retomar (con el negocio de ejemplo). */
export function plantillasDeLaApp(bienvenida: Plantilla, negocio: string): PlantillaApp[] {
  return [plantillaDeBienvenida(bienvenida, negocio), PLANTILLA_AVISO, { ...PLANTILLA_RETOMAR, ejemplos: ["Laura", negocio] }];
}

/** «{{1}} … {{3}}» → [1, 2, 3]: los números distintos, en orden. */
export function variablesDe(texto: string): number[] {
  const numeros = new Set<number>();
  for (const m of texto.matchAll(/\{\{(\d+)\}\}/g)) numeros.add(Number(m[1]));
  return [...numeros].sort((a, b) => a - b);
}

/** {{n}} → valores[n-1]; una variable sin valor se queda como está. */
export function rellenar(texto: string, valores: string[]): string {
  return texto.replace(/\{\{(\d+)\}\}/g, (marca: string, n: string) => valores[Number(n) - 1] ?? marca);
}

/** Los componentes de la plantilla para crearla en Meta. */
export function componentesParaMeta(p: PlantillaApp): unknown[] {
  return [{ type: "BODY", text: p.texto, ...(p.ejemplos.length ? { example: { body_text: [p.ejemplos] } } : {}) }];
}
