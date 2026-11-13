import { afterEach, describe, expect, it, vi } from "vitest";
import { numeroDelNegocio } from "./meta";
import { modoWhatsApp } from "./modo-prueba";
import { consultarPuente, ultimoEstadoPuente } from "./modo-prueba-puente";
import { cifrasDeLaWeb } from "./numero-web";

// El número del botón de WhatsApp de la web: el de Meta en la vía oficial y el móvil vinculado en el
// modo prueba (solo cuando ya está conectado).

vi.mock("./meta", () => ({ numeroDelNegocio: vi.fn(() => null) }));
vi.mock("./modo-prueba", () => ({ modoWhatsApp: vi.fn(() => "oficial") }));
vi.mock("./modo-prueba-puente", () => ({
  consultarPuente: vi.fn(async () => ({ fase: "parado", qr: null, numero: null, error: null })),
  ultimoEstadoPuente: vi.fn(() => ({ fase: "parado", qr: null, numero: null, error: null })),
}));

afterEach(() => vi.clearAllMocks());

describe("cifrasDeLaWeb", () => {
  it("vía oficial: las cifras del número de Meta, o null sin saberlo", () => {
    expect(cifrasDeLaWeb()).toBeNull();
    vi.mocked(numeroDelNegocio).mockReturnValue({ id: "1", texto: "+34 600 000 000", nombre: "Estudio", prueba: false });
    expect(cifrasDeLaWeb()).toBe("34600000000");
    expect(consultarPuente).not.toHaveBeenCalled();
  });

  it("modo prueba: el móvil vinculado, nunca el de Meta", () => {
    vi.mocked(modoWhatsApp).mockReturnValue("prueba");
    vi.mocked(numeroDelNegocio).mockReturnValue({ id: "1", texto: "+34 600 000 000", nombre: "Estudio", prueba: false });
    expect(cifrasDeLaWeb()).toBeNull();
    vi.mocked(ultimoEstadoPuente).mockReturnValue({ fase: "qr", qr: "x", numero: null, error: null });
    expect(cifrasDeLaWeb()).toBeNull();
    vi.mocked(ultimoEstadoPuente).mockReturnValue({ fase: "conectado", qr: null, numero: "34600000001", error: null });
    expect(cifrasDeLaWeb()).toBe("34600000001");
    expect(consultarPuente).toHaveBeenCalled();
  });
});
