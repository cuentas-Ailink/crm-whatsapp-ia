// La zona horaria vive en lib/agenda.ts (ZONA, REGLAS_POR_DEFECTO) y lib/regional.ts; el resto la toma
// de ahí o de la configuración del negocio. Este test lee el código fuente y falla, con archivo y línea,
// si «Europe/Madrid» o fechaMadrid( aparecen en otro sitio.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "..");
const PERMITIDOS = new Set(["lib/agenda.ts", "lib/regional.ts"]);

// Excepciones en archivos congelados (§7.14): se informan, no se editan.
const EXCEPCIONES: Record<string, RegExp> = {
  // lib/tipos.ts está congelado: el comentario de ReglasAgenda.zona dice cuál es el valor por defecto.
  "lib/tipos.ts": /^\s*zona: string;\s*\/\/ IANA, de ZONAS_HORARIAS\.\s+default "Europe\/Madrid"\s*$/,
};

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(path.join(RAIZ, dir))) {
    const rel = `${dir}/${nombre}`;
    if (rel === "lib/__golden__") continue;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...archivos(rel));
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(rel);
  }
  return salida;
}

describe("zonas", () => {
  it("no hay Europe/Madrid ni fechaMadrid( fuera de lib/agenda.ts y lib/regional.ts", () => {
    const fallos: string[] = [];
    for (const rel of ["lib", "cliente", "app"].flatMap(archivos)) {
      if (PERMITIDOS.has(rel)) continue;
      readFileSync(path.join(RAIZ, rel), "utf8")
        .split("\n")
        .forEach((linea, i) => {
          if (!linea.includes("Europe/Madrid") && !linea.includes("fechaMadrid(")) return;
          if (EXCEPCIONES[rel]?.test(linea)) return;
          fallos.push(`${rel}:${i + 1}: ${linea.trim()}`);
        });
    }
    expect(fallos).toEqual([]);
  });
});
