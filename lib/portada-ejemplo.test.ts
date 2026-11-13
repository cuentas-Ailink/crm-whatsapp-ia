import { describe, expect, it } from "vitest";
import { lineasEjemplo } from "@/app/secciones";
import { PRESETS } from "./presets";
import type { Hueco } from "./tipos";

// La conversación de ejemplo de la portada dice lo que haría el asistente con los huecos que hay.

const hueco = (id: string, texto: string): Hueco => ({ id, texto }) as Hueco;
const DOS = [hueco("2026-11-03T10:00", "martes 3 nov a las 10:00"), hueco("2026-11-04T17:00", "miércoles 4 nov a las 17:00")];

describe("conversación de ejemplo de la portada", () => {
  for (const [sector, preset] of Object.entries(PRESETS)) {
    const ejemplo = preset.portada.proceso.ejemplo;

    it(`${sector}: con dos huecos, ofrece los dos y pregunta cuál`, () => {
      const oferta = lineasEjemplo(ejemplo, DOS).find((l) => l.texto.includes("10:00") && l.texto.includes("17:00"));
      expect(oferta?.texto).toMatch(/el martes a las 10:00 o el miércoles a las 17:00\. ¿Cuál/);
    });

    it(`${sector}: con un solo hueco, ofrece uno sin decir «dos» ni preguntar cuál`, () => {
      const lineas = lineasEjemplo(ejemplo, DOS.slice(0, 1));
      const oferta = lineas.find((l) => l.de === "agente" && l.texto.includes("10:00"));
      expect(oferta?.texto).toMatch(/el martes a las 10:00\. ¿Te va bien\?$/);
      for (const l of lineas) {
        expect(l.texto).not.toMatch(/\bdos\b|¿Cuál|\{(dia|hora)\d\}/);
      }
    });
  }
});
