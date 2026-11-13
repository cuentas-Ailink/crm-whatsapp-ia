import { describe, expect, it } from "vitest";
import { crearLead, revisarCambiosFicha } from "./negocio";
import type { Vocabulario } from "./vocabulario";
import { VOCABULARIO_REFORMAS } from "./vocabulario";

// Los importes de la ficha en la moneda del negocio. Los textos completos los cambia W13: aquí solo
// se mira la palabra de la moneda y que no admite decimales.

const lead = crearLead({ telefono: "34612345678", perfilId: "p", perfilNombre: "P", nombre: "Ana", origen: "whatsapp", creadoEn: 1 });
const error = (r: ReturnType<typeof revisarCambiosFicha>) => ("error" in r ? r.error : null);

describe("importes de la ficha por moneda", () => {
  it("el máximo es el de cada moneda", () => {
    expect(error(revisarCambiosFicha(lead, { presupuesto: 1_000_001 }, { moneda: "EUR" }))).toMatch(/euros/);
    expect(revisarCambiosFicha(lead, { presupuesto: 1_000_001 }, { moneda: "MXN" })).toEqual({ cambios: { presupuesto: 1_000_001 } });
    expect(error(revisarCambiosFicha(lead, { presupuesto: 20_000_001 }, { moneda: "MXN" }))).toMatch(/pesos/);
    expect(revisarCambiosFicha(lead, { cobrado: 20_000_000 }, { moneda: "MXN" })).toEqual({ cambios: { cobrado: 20_000_000 } });
  });

  it("los dos mensajes dicen la moneda del negocio", () => {
    for (const campo of ["presupuesto", "cobrado"]) {
      expect(error(revisarCambiosFicha(lead, { [campo]: 1.5 }, { moneda: "MXN" }))).toMatch(/pesos/);
      expect(error(revisarCambiosFicha(lead, { [campo]: -1 }, { moneda: "PEN" }))).toMatch(/soles/);
      expect(error(revisarCambiosFicha(lead, { [campo]: "300" }, { moneda: "PEN" }))).toMatch(/sin decimales/);
    }
  });

  it("el importe dice «El importe» en cualquier sector (F46); lo cobrado, siempre la misma", () => {
    const v: Vocabulario = { ...VOCABULARIO_REFORMAS, importe: { singular: "comisión", plural: "comisiones", genero: "f" } };
    expect(error(revisarCambiosFicha(lead, { presupuesto: 1.5 }, { vocabulario: v, moneda: "USD" }))).toMatch(/^El importe .*dólares/);
    expect(error(revisarCambiosFicha(lead, { cobrado: 1.5 }, { vocabulario: v, moneda: "USD" }))).toMatch(/^Lo cobrado .*dólares/);
  });

  it("decimales y negativos no; null borra el importe que había", () => {
    const conImporte = { ...lead, presupuesto: 500, cobrado: 100 };
    expect(error(revisarCambiosFicha(conImporte, { presupuesto: 99.9 }))).toMatch(/sin decimales/);
    expect(error(revisarCambiosFicha(conImporte, { cobrado: -5 }))).toMatch(/sin decimales/);
    expect(revisarCambiosFicha(conImporte, { presupuesto: null, cobrado: null }, { moneda: "COP" })).toEqual({ cambios: { presupuesto: null, cobrado: null } });
    expect(revisarCambiosFicha(lead, { presupuesto: null })).toEqual({ cambios: {} });
  });

  it("sin opciones, como siempre: euros y hasta un millón", () => {
    expect(error(revisarCambiosFicha(lead, { presupuesto: 1_000_001 }))).toMatch(/euros/);
    expect(error(revisarCambiosFicha(lead, { cobrado: 1.5 }))).toMatch(/euros/);
    expect(revisarCambiosFicha(lead, { presupuesto: 1_000_000, cobrado: 0 })).toEqual({ cambios: { presupuesto: 1_000_000, cobrado: 0 } });
    expect(revisarCambiosFicha(lead, { presupuesto: 6400 })).toEqual(revisarCambiosFicha(lead, { presupuesto: 6400 }, { vocabulario: VOCABULARIO_REFORMAS, moneda: "EUR" }));
    expect(revisarCambiosFicha(lead, { presupuesto: 6400.5 })).toEqual(revisarCambiosFicha(lead, { presupuesto: 6400.5 }, { moneda: "EUR" }));
  });
});
