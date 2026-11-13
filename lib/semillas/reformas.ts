// Los ejemplos de reformas: un mes de uso de un estudio de Barcelona. 44 leads en los últimos 30 días
// (41 activos y 3 de publicidad): 6 nuevos, 17 hablando con el asistente, 7 con visita, 11 con el
// dueño y 3 de publicidad; tres «Ha dicho que sí», tres «No sigue» y uno que ha vuelto a escribir.
// Los guiones están en reformas-conversaciones.ts; el motor que les pone fecha, hora e historial, en
// lib/semilla.ts.

import { generarSector } from "../semilla";
import { CONVERSACIONES_REFORMAS } from "./reformas-conversaciones";
import type { DatosSemilla, OpcionesSemilla, SemillaGenerada } from "./tipos";

// Fuentes de los precios (medio y fecha), una línea por tipo de obra:
// - Baño: El Español 14-may-2026: gama alta 8.000-10.000 € o más; Habitissimo Barcelona ~6.000 €; Andimac 2025 media España 6.700 €.
// - Cocina: idealista 10-oct-2026: 850 €/m² calidad media (12 m² = 10.200 €), cuarzo ~700 €/m²; Habitissimo Barcelona: desde 10.000 €; Andimac: 9.100 €.
// - Vivienda entera: El Español 30-jul-2026: 850 a más de 1.200 €/m²; que.es 4-sep-2026: 80-100 m² = 70.000-95.000 €; Habitissimo Barcelona 100 m² = 61.000-75.000 €; Obrescat: ~120.000 € en Sarrià/Pedralbes.
// - Cocina y baño: suma de los rangos de cocina y baño de arriba.
// - Suelos: Cronoshare 2-ene-2026: porcelánico con retirada 100 m² = 3.500-9.000 €; parquet instalado 40-100 €/m².
// - Terraza: Habitissimo 16-sep-2026: integral 20 m² = 6.500 €, media 4.000 € (2.000-7.500).
// - Local comercial: Habitissimo 4-jun-2026: acondicionar local 300-1.000 €/m² (media ~500) y licencias ~10 %; cafetería integral ~650 €/m² (10-jun-2026).
// - Plato de ducha: estimación propia: ~1.000 € el cambio básico de bañera por ducha (Habitissimo vía El Español) + mampara y alicatado parcial.
// Precios orientativos de Barcelona en 2026 para que los ejemplos parezcan reales; no son una tarifa.
// Peso: parte de las solicitudes de cada tipo; m² y €/m², los rangos de un encargo normal.
export const TIPOS_OBRA: { tipo: string; etiqueta: string; peso: number; metros?: [number, number]; porMetro?: [number, number]; rango: [number, number] }[] = [
  { tipo: "Baño", etiqueta: "baño", peso: 0.24, metros: [4, 8], porMetro: [1_450, 1_850], rango: [7_500, 14_500] },
  { tipo: "Cocina", etiqueta: "cocina", peso: 0.2, metros: [6, 16], porMetro: [1_050, 1_450], rango: [9_500, 24_000] },
  { tipo: "Vivienda entera", etiqueta: "vivienda entera", peso: 0.2, metros: [55, 130], porMetro: [800, 1_150], rango: [50_000, 180_000] },
  { tipo: "Cocina y baño", etiqueta: "cocina y baño", peso: 0.07, rango: [19_000, 32_000] },
  { tipo: "Suelos", etiqueta: "suelos", peso: 0.07, metros: [35, 110], porMetro: [55, 95], rango: [2_800, 11_000] },
  { tipo: "Terraza", etiqueta: "terraza", peso: 0.06, metros: [8, 40], porMetro: [220, 320], rango: [3_500, 13_000] },
  { tipo: "Local comercial", etiqueta: "local", peso: 0.06, metros: [40, 140], porMetro: [450, 1_150], rango: [22_000, 160_000] },
  { tipo: "Plato de ducha", etiqueta: "plato de ducha", peso: 0.1, rango: [1_600, 3_200] },
];

/** Los datos del sector: guiones, cuotas por etapa y lo que el motor necesita para completar. */
export const DATOS_REFORMAS: DatosSemilla = {
  semilla: 20_261_111,
  nombres: {
    formulario: ["Carla Font", "Hugo Navarro", "Lucía Romero", "Unai Ortega", "Vera Lozano", "Andrea Pons", "Bruno Esteve", "Clara Sanz", "Eva Martí", "Guillem Roig"],
    whatsapp: ["Nerea", "Pol", "Helena B.", "Iker", "Martí", "Ona", "Sergio M.", "Txell"],
  },
  zonas: ["Gràcia", "Eixample", "Sant Antoni", "Sants", "Les Corts", "Poblenou", "Sarrià", "Horta", "El Clot", "Poble-sec", "Sant Gervasi", "El Born"],
  servicios: TIPOS_OBRA.map(({ tipo, etiqueta, rango, metros }) => ({ tipo, etiqueta, rango, datos: {}, ...(metros ? { metros } : {}) })),
  conversaciones: CONVERSACIONES_REFORMAS,
  cuotas: { nuevo: 6, conversacion: 17, visita: 7, persona: 11, spam: 3 },
  tareas: [],
  notas: [],
  fuentes: { campana: "Reformas Barcelona", anuncio: "¿Reformas en casa? Pide tu visita sin compromiso" },
};

/** El generador de reformas: los datos de arriba con el motor genérico. */
export function generarReformas(o: OpcionesSemilla, ahora: Date): SemillaGenerada {
  return generarSector(DATOS_REFORMAS, o, ahora);
}
