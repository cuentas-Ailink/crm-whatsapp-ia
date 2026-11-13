// El generador de ejemplos de cada sector. Nada de este archivo se usa al cargarlo: forma un ciclo con
// lib/semilla.ts (que llama a `generadorDe`) y los generadores (que usan su motor), así que la elección
// se hace dentro de la función, nunca en una tabla al cargar el módulo.

import type { SectorPreset } from "../configuracion";
import { generarClinica } from "./clinica";
import { generarGenerico } from "./generico";
import { generarInmobiliaria } from "./inmobiliaria";
import { generarReformas } from "./reformas";
import type { GeneradorSemilla } from "./tipos";

export { crearSemilla, OPCIONES_POR_DEFECTO } from "../semilla";

export function generadorDe(base: SectorPreset): GeneradorSemilla {
  switch (base) {
    case "inmobiliaria":
      return generarInmobiliaria;
    case "clinica":
      return generarClinica;
    case "generico":
      return generarGenerico;
    case "reformas":
    default:
      return generarReformas;
  }
}
