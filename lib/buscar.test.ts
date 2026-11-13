import { describe, expect, it } from "vitest";
import { buscar } from "./buscar";
import { crearLead } from "./negocio";
import type { Lead } from "./tipos";
import type { CampoLead } from "./vocabulario";

let n = 0;
function lead(campos: Partial<Lead> = {}): Lead {
  n += 1;
  return crearLead({
    perfilId: "p",
    perfilNombre: "P",
    nombre: `Cliente ${n}`,
    telefono: `3470000${String(n).padStart(4, "0")}`,
    origen: "formulario",
    actualizadoEn: 1_000 + n,
    ...campos,
  });
}

const laura = lead({ nombre: "Laura Martínez", zona: "Gracia", telefono: "34612345678", email: "laura@correo.es", etiquetas: ["cocina"], datos: { tipo: "Reforma integral" } });
const jordi = lead({ nombre: "Jordi Vila", zona: "Gràcia", telefono: "34699111222", etiquetas: ["financiación"], datos: { metros: "6" } });
const ana = lead({ nombre: "Ana Ruiz", zona: "Sants", telefono: "34655000333" });
const TODOS = [laura, jordi, ana];
const ids = (r: Lead[]) => r.map((l) => l.nombre);

describe("buscar", () => {
  it("sin tildes ni mayúsculas, en los dos sentidos", () => {
    expect(ids(buscar(TODOS, "martinez"))).toEqual(["Laura Martínez"]);
    expect(ids(buscar(TODOS, "gràcia"))).toEqual(["Jordi Vila", "Laura Martínez"]);
    expect(ids(buscar(TODOS, "JORDI"))).toEqual(["Jordi Vila"]);
  });

  it("por teléfono desde tres cifras, con o sin +34 y espacios", () => {
    expect(ids(buscar(TODOS, "612"))).toEqual(["Laura Martínez"]);
    expect(ids(buscar(TODOS, "+34 612"))).toEqual(["Laura Martínez"]);
    expect(ids(buscar(TODOS, "612 345 678"))).toEqual(["Laura Martínez"]);
    expect(ids(buscar(TODOS, "699 111"))).toEqual(["Jordi Vila"]);
  });

  it("con dos cifras no busca en el teléfono", () => {
    expect(buscar(TODOS, "61")).toEqual([]);
    expect(buscar(TODOS, "34")).toEqual([]);
  });

  it("cada palabra puede estar en un campo distinto", () => {
    expect(ids(buscar(TODOS, "laura gracia"))).toEqual(["Laura Martínez"]);
    expect(buscar(TODOS, "laura sants")).toEqual([]);
  });

  it("etiquetas, zona, email y datos", () => {
    expect(ids(buscar(TODOS, "cocina"))).toEqual(["Laura Martínez"]);
    expect(ids(buscar(TODOS, "financiacion"))).toEqual(["Jordi Vila"]);
    expect(ids(buscar(TODOS, "sants"))).toEqual(["Ana Ruiz"]);
    expect(ids(buscar(TODOS, "correo.es"))).toEqual(["Laura Martínez"]);
    expect(ids(buscar(TODOS, "integral"))).toEqual(["Laura Martínez"]);
  });

  it("con los campos del negocio, también el valor con su unidad", () => {
    const campos: CampoLead[] = [{ clave: "metros", etiqueta: "Metros", unidad: "m²" }];
    expect(buscar(TODOS, "6 m²")).toEqual([]);
    expect(ids(buscar(TODOS, "6 m²", { campos }))).toEqual(["Jordi Vila"]);
  });

  it("vacío no devuelve nada", () => {
    expect(buscar(TODOS, "")).toEqual([]);
    expect(buscar(TODOS, "   ")).toEqual([]);
  });

  it("del más reciente al más antiguo, como mucho `max`", () => {
    const muchos = Array.from({ length: 25 }, (_, i) => lead({ nombre: `Pepe ${i}`, actualizadoEn: 5_000 + i }));
    expect(buscar(muchos, "pepe")).toHaveLength(20);
    expect(ids(buscar(muchos, "pepe", { max: 3 }))).toEqual(["Pepe 24", "Pepe 23", "Pepe 22"]);
    expect(ids(buscar(TODOS, "a"))).toEqual(["Ana Ruiz", "Jordi Vila", "Laura Martínez"]);
  });

  it("los ejemplos también se encuentran", () => {
    const ejemplo = lead({ nombre: "Marta Ejemplo", ejemplo: true });
    expect(ids(buscar([ejemplo], "marta"))).toEqual(["Marta Ejemplo"]);
  });
});
