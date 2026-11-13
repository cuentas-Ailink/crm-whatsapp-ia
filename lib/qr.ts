// El código QR de un texto, como un SVG suelto: módulos negros sobre fondo blanco, escalable (viewBox).
// Lo usan la portada (el botón de WhatsApp) y el modo prueba. Puro: el mismo SVG en el servidor y en el navegador.

import qrcode from "qrcode-generator";

export interface OpcionesQr {
  /** Lado en píxeles de los atributos width y height. Sin él, el SVG ocupa el ancho de su caja. */
  tamaño?: number;
  /** El margen blanco alrededor, en módulos. Por defecto 4, el que pide la norma. */
  margen?: number;
}

const MARGEN_POR_DEFECTO = 4;

/** El texto en UTF-8, un carácter por byte: así lo espera la librería en modo «Byte». */
function bytesUtf8(texto: string): string {
  let salida = "";
  for (const byte of new TextEncoder().encode(texto)) salida += String.fromCharCode(byte);
  return salida;
}

/** Un número entero dentro de unos límites; lo demás, el valor por defecto. */
function entero(valor: number | undefined, min: number, max: number, defecto: number): number {
  return typeof valor === "number" && Number.isFinite(valor) ? Math.min(max, Math.max(min, Math.round(valor))) : defecto;
}

/**
 * El SVG del código QR de `texto`. Corrección de errores media (M) y la versión más pequeña en la que cabe.
 * Un texto que no cabe en un QR (más de unos 2.300 bytes) lanza un error.
 */
export function qrSvg(texto: string, opciones?: OpcionesQr): string {
  const qr = qrcode(0, "M");
  qr.addData(bytesUtf8(String(texto ?? "")), "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const margen = entero(opciones?.margen, 0, 16, MARGEN_POR_DEFECTO);
  const lado = n + margen * 2;

  // Un solo trazado: cada fila, los tramos seguidos de módulos negros como un rectángulo.
  let trazado = "";
  for (let fila = 0; fila < n; fila++) {
    let columna = 0;
    while (columna < n) {
      if (!qr.isDark(fila, columna)) {
        columna++;
        continue;
      }
      const inicio = columna;
      while (columna < n && qr.isDark(fila, columna)) columna++;
      trazado += `M${inicio + margen} ${fila + margen}h${columna - inicio}v1h${inicio - columna}z`;
    }
  }

  const tamaño = opciones?.tamaño === undefined ? null : entero(opciones.tamaño, 16, 4096, 200);
  const medidas = tamaño === null ? `width="100%"` : `width="${tamaño}" height="${tamaño}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" ${medidas} shape-rendering="crispEdges">` +
    `<rect width="${lado}" height="${lado}" fill="#ffffff"/>` +
    `<path d="${trazado}" fill="#000000"/>` +
    `</svg>`
  );
}

/** El SVG como dirección data:, para un <img> (sin pegar HTML crudo en la página). */
export function qrDataUrl(texto: string, opciones?: OpcionesQr): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(texto, opciones))}`;
}
