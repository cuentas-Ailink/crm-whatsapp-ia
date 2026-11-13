import { describe, expect, it } from "vitest";
import { qrDataUrl, qrSvg } from "./qr";

/** Vuelve a montar la matriz de módulos a partir del trazado del SVG (sin el margen). */
function matriz(svg: string): boolean[][] {
  const lado = Number(svg.match(/viewBox="0 0 (\d+) \1"/)?.[1]);
  const d = svg.match(/<path d="([^"]*)"/)?.[1] ?? "";
  const m = Array.from({ length: lado }, () => Array<boolean>(lado).fill(false));
  for (const [, x, y, ancho] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(ancho); i++) m[Number(y)][Number(x) + i] = true;
  }
  return m;
}

/** El patrón de posición de 7×7: borde negro, anillo blanco y centro negro de 3×3. */
function esPatronDePosicion(m: boolean[][], fila: number, columna: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const borde = y === 0 || y === 6 || x === 0 || x === 6;
      const centro = y >= 2 && y <= 4 && x >= 2 && x <= 4;
      if (m[fila + y][columna + x] !== (borde || centro)) return false;
    }
  }
  return true;
}

describe("qrSvg", () => {
  it("un SVG suelto, escalable, negro sobre blanco", () => {
    const svg = qrSvg("hola");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" width="100%"')).toBe(true);
    expect(svg).toContain('<rect width="29" height="29" fill="#ffffff"/>');
    expect(svg).toContain('fill="#000000"');
    expect(svg.endsWith("</svg>")).toBe(true);
    // Lo mismo siempre: se pinta igual en el servidor y en el navegador.
    expect(qrSvg("hola")).toBe(svg);
  });

  it("los tres patrones de posición en su sitio, dentro del margen", () => {
    const m = matriz(qrSvg("https://wa.me/34600000000?text=Hola%2C%20quiero%20pedir%20cita."));
    const lado = m.length;
    const n = lado - 8;
    expect((n - 17) % 4).toBe(0); // 21, 25, 29…: una versión de verdad
    expect(esPatronDePosicion(m, 4, 4)).toBe(true);
    expect(esPatronDePosicion(m, 4, 4 + n - 7)).toBe(true);
    expect(esPatronDePosicion(m, 4 + n - 7, 4)).toBe(true);
    // El margen, blanco.
    for (let i = 0; i < lado; i++) for (const j of [0, 1, 2, 3, lado - 1]) expect(m[j][i] || m[i][j]).toBe(false);
  });

  it("tamaño y margen", () => {
    expect(qrSvg("hola", { tamaño: 136 })).toContain('width="136" height="136"');
    expect(qrSvg("hola", { margen: 0 })).toContain('viewBox="0 0 21 21"');
    expect(qrSvg("hola", { margen: 2 })).toContain('viewBox="0 0 25 25"');
    expect(qrSvg("hola", { margen: -3 })).toContain('viewBox="0 0 21 21"');
  });

  it("tildes y emojis en UTF-8: más bytes, un QR más grande", () => {
    const ascii = Number(qrSvg("a".repeat(14)).match(/viewBox="0 0 (\d+)/)?.[1]);
    const conTildes = Number(qrSvg("á".repeat(14)).match(/viewBox="0 0 (\d+)/)?.[1]);
    expect(conTildes).toBeGreaterThan(ascii);
    expect(() => qrSvg("Hola 👋, ¿qué tal?")).not.toThrow();
  });

  it("como dirección data: para un <img>", () => {
    const url = qrDataUrl("hola");
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(qrSvg("hola"));
  });
});
