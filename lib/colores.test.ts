import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Los colores del panel (app/globals.css): un color, un significado, y todo texto de color se lee sobre blanco (I20).

const CSS = readFileSync("app/globals.css", "utf8");

/** Las variables del bloque @theme: nombre → valor. */
function tokens(): Map<string, string> {
  const bloque = CSS.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!bloque) throw new Error("No hay bloque @theme en app/globals.css");
  const salida = new Map<string, string>();
  for (const [, nombre, valor] of bloque[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) salida.set(nombre, valor.trim());
  return salida;
}

function luminancia(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`No es un color #rrggbb: ${hex}`);
  const canal = (i: number) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

/** Contraste WCAG de un color sobre blanco. */
function contrasteSobreBlanco(hex: string): number {
  return 1.05 / (luminancia(hex) + 0.05);
}

describe("colores del panel", () => {
  const t = tokens();

  it("tiene los tres colores base y su versión para texto", () => {
    expect(t.get("--color-ok")).toBe("#2f9e6e");
    expect(t.get("--color-ok-texto")).toBe("#23794f");
    expect(t.get("--color-atencion")).toBe("#d9932f");
    expect(t.get("--color-atencion-texto")).toBe("#a8661a");
    expect(t.get("--color-error")).toBe("#e0584b");
    expect(t.get("--color-error-texto")).toBe("#c23d30");
  });

  it("todo color de texto tiene al menos 4,5:1 sobre blanco", () => {
    const deTexto = [...t].filter(([nombre]) => /^--color-.*-texto$/.test(nombre));
    expect(deTexto.map(([nombre]) => nombre).sort()).toEqual(["--color-atencion-texto", "--color-error-texto", "--color-marca-texto", "--color-ok-texto"]);
    for (const [nombre, valor] of deTexto) {
      expect(contrasteSobreBlanco(valor), `${nombre} ${valor}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("las etapas visita y persona son alias de ok y atención", () => {
    expect(t.get("--color-visita")).toBe("var(--color-ok)");
    expect(t.get("--color-persona")).toBe("var(--color-atencion)");
  });
});
