import { describe, expect, it } from "vitest";
import { ZONAS_HORARIAS } from "./agenda";
import {
  enmascararTelefono,
  euros,
  formatoImporte,
  formatoTelefono,
  importeMaximo,
  MONEDAS,
  normalizarTelefono,
  PAISES,
  simboloMoneda,
  unificarTelefono,
  type Moneda,
} from "./regional";

describe("normalizarTelefono", () => {
  it("los casos de siempre, idénticos", () => {
    expect(normalizarTelefono("612 345 678")).toBe("34612345678");
    expect(normalizarTelefono("+34 612345678")).toBe("34612345678");
    expect(normalizarTelefono("0034612345678")).toBe("34612345678");
    expect(normalizarTelefono("34612345678")).toBe("34612345678");
    expect(unificarTelefono("5218711234567")).toBe("528711234567");
    expect(unificarTelefono("528711234567")).toBe("528711234567");
    expect(normalizarTelefono("+52 1 871 123 4567")).toBe("528711234567");
    expect(normalizarTelefono("+52 871 123 4567")).toBe("528711234567");
    expect(unificarTelefono("34612345678")).toBe("34612345678");
    expect(normalizarTelefono("+49 151 2345 6789")).toBe("4915123456789");
    expect(normalizarTelefono("1234")).toBeNull();
    expect(normalizarTelefono("")).toBeNull();
  });

  it("México", () => {
    expect(normalizarTelefono("871 123 4567", "52")).toBe("528711234567");
    expect(normalizarTelefono("528711234567", "52")).toBe("528711234567");
    expect(normalizarTelefono("+52 1 871 123 4567", "52")).toBe("528711234567");
    expect(normalizarTelefono("612 345 678", "52")).toBeNull();
  });

  it("Argentina: con y sin el 9, y con el 0 delante", () => {
    expect(normalizarTelefono("11 2345 6789", "54")).toBe("5491123456789");
    expect(normalizarTelefono("9 11 2345 6789", "54")).toBe("5491123456789");
    expect(normalizarTelefono("011 2345 6789", "54")).toBe("5491123456789");
    expect(normalizarTelefono("5491123456789", "54")).toBe("5491123456789");
    expect(normalizarTelefono("+54 9 11 2345 6789", "54")).toBe("5491123456789");
  });

  it("Colombia, Estados Unidos y el Caribe", () => {
    expect(normalizarTelefono("300 123 4567", "57")).toBe("573001234567");
    expect(normalizarTelefono("573001234567", "57")).toBe("573001234567");
    expect(normalizarTelefono("(809) 555-0100", "1")).toBe("18095550100");
    expect(normalizarTelefono("1 809 555 0100", "1")).toBe("18095550100");
  });

  it("Ecuador y Uruguay, con el 0 delante", () => {
    expect(normalizarTelefono("099 123 4567", "593")).toBe("593991234567");
    expect(normalizarTelefono("99 123 4567", "593")).toBe("593991234567");
    expect(normalizarTelefono("099 123 456", "598")).toBe("59899123456");
    expect(normalizarTelefono("9912 3456", "598")).toBe("59899123456");
    expect(normalizarTelefono("59899123456", "598")).toBe("59899123456");
  });

  it("Otro: de 6 a 12 cifras", () => {
    expect(normalizarTelefono("123456", "49")).toBe("49123456");
    expect(normalizarTelefono("151 2345 678", "49")).toBe("491512345678");
    expect(normalizarTelefono("1234 5678 9012", "49")).toBe("49123456789012");
    expect(normalizarTelefono("12345", "49")).toBeNull();
    expect(normalizarTelefono("1234 5678 90123", "49")).toBeNull();
    expect(normalizarTelefono("123456", "0")).toBeNull();
  });

  it("lo que no es un teléfono, null", () => {
    expect(normalizarTelefono("hola", "52")).toBeNull();
    expect(normalizarTelefono("12", "57")).toBeNull();
    expect(normalizarTelefono("+12", "52")).toBeNull();
    expect(normalizarTelefono("12345678901234", "1")).toBeNull();
  });
});

describe("formatoTelefono", () => {
  it("el número entero", () => {
    expect(formatoTelefono("34612345678")).toBe("+34 612 345 678");
    expect(formatoTelefono("612345678")).toBe("+34 612 345 678");
    expect(formatoTelefono("528711234567", "52")).toBe("+52 871 123 4567");
    expect(formatoTelefono("5491123456789", "54")).toBe("+54 9 11 2345 6789");
    expect(formatoTelefono("59899123456", "598")).toBe("+598 9912 3456");
    expect(formatoTelefono("18095550100", "1")).toBe("+1 809 555 0100");
    expect(formatoTelefono("34612345678", "52")).toBe("+34 612 345 678");
    expect(formatoTelefono("4915123456789")).toBe("+4915123456789");
  });

  it("un número guardado de otro país", () => {
    expect(formatoTelefono("528711234567")).toBe("+52 871 123 4567");
    expect(formatoTelefono("5491123456789")).toBe("+54 9 11 2345 6789");
    expect(formatoTelefono("491512345678", "49")).toBe("+49 151 234 567 8");
  });

  it("mientras se escribe", () => {
    expect(formatoTelefono("6123")).toBe("612 3");
    expect(formatoTelefono("61234567")).toBe("612 345 67");
    expect(formatoTelefono("+3461")).toBe("+34 61");
    expect(formatoTelefono("")).toBe("");
    expect(formatoTelefono("+")).toBe("+");
    expect(formatoTelefono("+34")).toBe("+34");
    expect(formatoTelefono("0034 6")).toBe("+34 6");
    expect(formatoTelefono("+4915")).toBe("+4915");
    expect(formatoTelefono("871 12", "52")).toBe("871 12");
    expect(formatoTelefono("+52 87", "52")).toBe("+52 87");
    expect(formatoTelefono("9912", "598")).toBe("9912");
  });

  it("nunca quita ni pone un dígito", () => {
    for (const t of ["6", "61", "612", "6123456", "+346123", "5291", "+1 809", "0099"]) {
      expect(formatoTelefono(t).replace(/\D/g, "")).toBe(t.replace(/\D/g, "").replace(/^00/, ""));
    }
  });
});

describe("enmascararTelefono", () => {
  it("España, como siempre", () => {
    expect(enmascararTelefono("34612345678")).toBe("+34 6•• ••• •••");
    expect(enmascararTelefono("34612345678", "52")).toBe("+34 6•• ••• •••");
  });

  it("México, Uruguay y Argentina", () => {
    expect(enmascararTelefono("528711234567", "52")).toBe("+52 8•• ••• ••••");
    expect(enmascararTelefono("528711234567")).toBe("+52 8•• ••• ••••");
    expect(enmascararTelefono("59899123456", "598")).toBe("+598 9••• ••••");
    expect(enmascararTelefono("5491123456789", "54")).toBe("+54 9 •• •••• ••••");
  });

  it("un país que no se reconoce: lo de siempre", () => {
    expect(enmascararTelefono("4915123456789")).toBe("+49 •••• 89");
  });
});

describe("PAISES", () => {
  const TABLA: [string, string, string, Moneda, string, number, string?][] = [
    ["ES", "España (península y Baleares)", "Europe/Madrid", "EUR", "34", 9],
    ["ES-CN", "España (Canarias)", "Atlantic/Canary", "EUR", "34", 9],
    ["MX", "México", "America/Mexico_City", "MXN", "52", 10],
    ["CO", "Colombia", "America/Bogota", "COP", "57", 10],
    ["AR", "Argentina", "America/Argentina/Buenos_Aires", "ARS", "54", 10, "9"],
    ["CL", "Chile", "America/Santiago", "CLP", "56", 9],
    ["PE", "Perú", "America/Lima", "PEN", "51", 9],
    ["EC", "Ecuador", "America/Guayaquil", "USD", "593", 9],
    ["US", "Estados Unidos", "America/New_York", "USD", "1", 10],
    ["UY", "Uruguay", "America/Montevideo", "UYU", "598", 8],
    ["PY", "Paraguay", "America/Asuncion", "PYG", "595", 9],
    ["BO", "Bolivia", "America/La_Paz", "BOB", "591", 8],
    ["GT", "Guatemala", "America/Guatemala", "GTQ", "502", 8],
    ["SV", "El Salvador", "America/El_Salvador", "USD", "503", 8],
    ["HN", "Honduras", "America/Tegucigalpa", "HNL", "504", 8],
    ["NI", "Nicaragua", "America/Managua", "NIO", "505", 8],
    ["CR", "Costa Rica", "America/Costa_Rica", "CRC", "506", 8],
    ["PA", "Panamá", "America/Panama", "USD", "507", 8],
    ["DO", "República Dominicana", "America/Santo_Domingo", "DOP", "1", 10],
    ["PR", "Puerto Rico", "America/Puerto_Rico", "USD", "1", 10],
    ["VE", "Venezuela", "America/Caracas", "USD", "58", 10],
  ];

  it("22 filas con ids únicos y «Otro» al final", () => {
    expect(PAISES).toHaveLength(22);
    expect(new Set(PAISES.map((p) => p.id)).size).toBe(22);
    expect(PAISES[21]).toEqual({ id: "OTRO", nombre: "Otro", zona: "Europe/Madrid", moneda: "EUR", prefijo: "", digitos: 0 });
  });

  it("los valores de la tabla, con zona y moneda conocidas", () => {
    const zonas = new Set(ZONAS_HORARIAS.map((z) => z.id));
    TABLA.forEach(([id, nombre, zona, moneda, prefijo, digitos, movil], i) => {
      const p = PAISES[i];
      expect(p).toEqual({ id, nombre, zona, moneda, prefijo, digitos, ...(movil ? { movil } : {}) });
      expect(zonas.has(p.zona)).toBe(true);
      expect(MONEDAS[p.moneda]).toBeDefined();
    });
  });

  it("cada país formatea un número suyo", () => {
    for (const p of PAISES.slice(0, 21)) {
      const nacional = (p.movil ?? "") + "2".repeat(p.digitos);
      const numero = normalizarTelefono(nacional, p.prefijo);
      expect(numero).toBe(`${p.prefijo}${nacional}`);
      expect(formatoTelefono(numero ?? "", p.prefijo).startsWith(`+${p.prefijo} `)).toBe(true);
    }
  });
});

describe("dinero", () => {
  const CODIGOS = Object.keys(MONEDAS) as Moneda[];

  it("en euros, igual que euros()", () => {
    for (const n of [0, 9300, 34400, 1_000_000]) expect(formatoImporte(n)).toBe(euros(n));
    expect(formatoImporte(9300)).toBe("9.300\u00a0€");
  });

  it("todas las monedas, sin decimales y sin lanzar", () => {
    expect(CODIGOS).toHaveLength(15);
    for (const m of CODIGOS) {
      const texto = formatoImporte(1234.56, m);
      expect(texto).not.toMatch(/[.,]\d{2}(?!\d)/);
      expect(texto).toMatch(/1.?235/);
    }
  });

  it("importeMaximo cabe en un integer y simboloMoneda es el primero", () => {
    for (const m of CODIGOS) {
      expect(importeMaximo(m)).toBeLessThan(2 ** 31);
      expect(simboloMoneda(m)).toBe(MONEDAS[m].simbolos[0]);
    }
    expect(importeMaximo()).toBe(MONEDAS.EUR.maximo);
  });
});
