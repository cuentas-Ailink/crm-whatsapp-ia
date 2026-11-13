import { describe, expect, it } from "vitest";
import { costeUsd, FECHA_PRECIOS, PRECIOS } from "./precios";

describe("precios", () => {
  it("1 M de entrada y 1 M de salida cuestan 0,60 $ con Haiku y 12 $ con Sonnet", () => {
    const uso = { entrada: 1_000_000, cacheLeida: 0, salida: 1_000_000 };
    expect(costeUsd(uso, "claude-haiku-5-5")).toBeCloseTo(0.6, 10);
    expect(costeUsd(uso, "claude-sonnet-5-5")).toBeCloseTo(12, 10);
    expect(FECHA_PRECIOS).toBe("2026-10-06");
  });

  it("la caché leída se cobra aparte", () => {
    expect(costeUsd({ entrada: 0, cacheLeida: 1_000_000, salida: 0 }, "claude-haiku-5-5")).toBeCloseTo(PRECIOS["claude-haiku-5-5"].cacheLeida, 10);
    expect(costeUsd({ entrada: 0, cacheLeida: 1_000_000, salida: 0 }, "claude-sonnet-5-5")).toBeCloseTo(0.2, 10);
    // Escribir en la caché: la entrada × 1,25.
    expect(costeUsd({ entrada: 0, cacheLeida: 0, cacheEscrita: 1_000_000, salida: 0 }, "claude-sonnet-5-5")).toBeCloseTo(2.5, 10);
  });

  it("un modelo desconocido usa los precios de Haiku", () => {
    const uso = { entrada: 2000, cacheLeida: 500, salida: 300 };
    expect(costeUsd(uso, "claude-otro-9")).toBe(costeUsd(uso, "claude-haiku-5-5"));
    expect(costeUsd(uso, "toString")).toBe(costeUsd(uso, "claude-haiku-5-5"));
  });
});
