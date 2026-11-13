import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PASOS_META, PISTA_PUBLICAR, pasosMeta } from "./pasos-meta";

// W28 · Meta no entrega los mensajes a una app en modo desarrollo: «Publica la app» es un paso más.

const raiz = path.resolve(__dirname, "..");
const leer = (archivo: string) => readFileSync(path.join(raiz, archivo), "utf8");
const linea = (p: { titulo: string; texto: string }) => `${p.titulo} ${p.texto}`;

const PUBLICA =
  "Publica la app: en Meta for Developers, «Configuración de la app» → «Básica», pega la URL de tu política de privacidad, «Guardar cambios» y «Publicar».";

describe("Lo que tienes que hacer en Meta", () => {
  it("lleva «Publica la app» en una línea, después de la lista de prueba", () => {
    const lineas = PASOS_META.map(linea);
    expect(lineas).toContain(PUBLICA);
    const publica = lineas.indexOf(PUBLICA);
    expect(lineas.findIndex((l) => l.startsWith("Añade tu móvil a la lista de prueba."))).toBe(publica - 1);
    expect(lineas.slice(publica + 1).every((l) => !/modo Live/.test(l))).toBe(true);
  });

  it("en el modo servidor no sale ngrok, pero sí «Publica la app»", () => {
    expect(pasosMeta(true).map(linea)).toContain(PUBLICA);
    expect(pasosMeta(true).some((p) => p.titulo.includes("ngrok"))).toBe(false);
    expect(pasosMeta(false).some((p) => p.titulo.includes("ngrok"))).toBe(true);
  });

  it("README.md e INSTALAR.md cuentan el mismo paso", () => {
    const texto = "en Meta for Developers, «Configuración de la app» → «Básica», pega la URL de tu política de privacidad, «Guardar cambios» y «Publicar».";
    expect(leer("README.md")).toContain(`**Publica la app:** ${texto}`);
    expect(leer("INSTALAR.md")).toContain(`**Publica la app:** ${texto}`);
  });
});

describe("¿No llega? (paso 4)", () => {
  it("lo primero que pregunta es si la app está publicada", () => {
    expect(PISTA_PUBLICAR).toBe("¿Has publicado la app en Meta?");
    const puesta = leer("cliente/puesta-en-marcha.tsx");
    const oficial = puesta.slice(puesta.indexOf("function PasoPrimerOficial("));
    const pistas = [...oficial.matchAll(/^\s*¿No llega\?(.*)$/gm)].map((m) => m[1].trim());
    expect(pistas).toHaveLength(2);
    for (const resto of pistas) expect(resto.startsWith("{PISTA_PUBLICAR}")).toBe(true);
  });
});
