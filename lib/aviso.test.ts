import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUARDADA_VACIA, type ConfiguracionResuelta } from "./configuracion";
import { resolver } from "./presets";
import type { Lead } from "./tipos";

vi.mock("./whatsapp", async (original) => ({
  ...(await original<typeof import("./whatsapp")>()),
  enviarTexto: vi.fn(async () => "wamid.aviso"),
  enviarPlantillaConVariables: vi.fn(async () => "wamid.plantilla"),
}));
vi.mock("./meta", () => ({ estadoPlantilla: vi.fn() }));
vi.mock("./configuracion-servidor", () => ({ configuracionActiva: vi.fn() }));

const { textoAviso, avisarComercial } = await import("./aviso");
const { ErrorWhatsApp, enviarTexto, enviarPlantillaConVariables } = await import("./whatsapp");
const { estadoPlantilla } = await import("./meta");
const { configuracionActiva } = await import("./configuracion-servidor");

const MOVIL_DUENO = "34600999999";

function configuracion(telefono: string | null = MOVIL_DUENO): ConfiguracionResuelta {
  const config = resolver({ perfil: { id: "estudio-de-reformas", nombre: "Estudio de reformas", hash: "" }, guardada: GUARDADA_VACIA, entorno: { NOMBRE_NEGOCIO: "Estudio de reformas" } });
  config.sistema.avisos.comercial.telefono = telefono;
  return config;
}

const lead: Lead = {
  id: "34612345678:estudio-de-reformas",
  telefono: "34612345678",
  perfilId: "estudio-de-reformas",
  perfilNombre: "Estudio de reformas",
  nombre: "Laura Martínez",
  origen: "whatsapp",
  estado: "persona",
  datos: { tipo: "cocina", metros: "12" },
  mensajes: [],
  creadoEn: 1,
  actualizadoEn: 1,
  cambioEstadoEn: 1,
  huecosOfrecidos: [],
};

const fueraDeVentana = () => new ErrorWhatsApp("Han pasado más de 24 h", 131047, "(#131047) Re-engagement message");
const lineasDelRegistro = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(configuracionActiva).mockImplementation(async () => ({ perfil: { id: "estudio-de-reformas", nombre: "Estudio de reformas", instrucciones: "", hash: "" }, config: configuracion() }));
  vi.mocked(enviarTexto).mockResolvedValue("wamid.aviso");
  vi.spyOn(console, "log").mockImplementation(() => {});
  delete process.env.TELEFONO_COMERCIAL;
});

afterEach(() => vi.restoreAllMocks());

describe("textoAviso", () => {
  it("completo: te toca, llámale con el teléfono entero, quiere y último mensaje", () => {
    const config = configuracion();
    const texto = textoAviso(lead, "Pide hablar con una persona", "Quiero hablar con alguien de verdad", {
      detalle: "completo",
      campos: config.campos,
      prefijo: "34",
    });
    expect(texto).toBe(
      [
        "🔔 Te toca: Laura Martínez · Pide hablar con una persona",
        "Llámale: +34 612 345 678",
        "Quiere: Cocina · 12 m²",
        "Último mensaje: «Quiero hablar con alguien de verdad»",
        "",
        "Tu asistente ya no le contesta. Contéstale desde el panel del ordenador o llámale.",
      ].join("\n"),
    );
    expect(texto).not.toContain("metros:");
    // Sin datos ni último mensaje, esas dos líneas no salen.
    const corto = textoAviso({ ...lead, datos: {} }, "Pide hablar con una persona", "");
    expect(corto).not.toContain("Quiere:");
    expect(corto).not.toContain("Último mensaje");
    expect(corto.split("\n")[1]).toBe("Llámale: +34 612 345 678");
  });

  it("minimo: solo las dos primeras líneas", () => {
    expect(textoAviso(lead, "Urgencia", "Me duele mucho", { detalle: "minimo", prefijo: "34" })).toBe(
      "🔔 Te toca: Laura Martínez · Urgencia\nLlámale: +34 612 345 678",
    );
  });
});

describe("avisarComercial", () => {
  it("manda el texto completo al móvil de los avisos", async () => {
    await avisarComercial(lead, "Pide hablar con una persona", "Quiero hablar con alguien", configuracion());
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    const [telefono, texto] = vi.mocked(enviarTexto).mock.calls[0];
    expect(telefono).toBe(MOVIL_DUENO);
    expect(texto.startsWith("🔔 Te toca: Laura Martínez · Pide hablar con una persona\nLlámale: +34 612 345 678")).toBe(true);
    expect(lineasDelRegistro().some((l) => l.includes("Aviso enviado por WhatsApp (+34 6•• ••• •••)"))).toBe(true);
  });

  it("sin móvil no hace nada", async () => {
    await avisarComercial(lead, "Pide hablar con una persona", "Hola", configuracion(""));
    await avisarComercial(lead, "Pide hablar con una persona", "Hola", configuracion(null));
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(enviarPlantillaConVariables).not.toHaveBeenCalled();
    expect(estadoPlantilla).not.toHaveBeenCalled();
  });

  it("sin configuración la lee y usa TELEFONO_COMERCIAL si no hay móvil guardado", async () => {
    vi.mocked(configuracionActiva).mockImplementation(async () => ({ perfil: { id: "estudio-de-reformas", nombre: "Estudio de reformas", instrucciones: "", hash: "" }, config: configuracion(null) }));
    process.env.TELEFONO_COMERCIAL = "600 111 222";
    await avisarComercial(lead, "Pide hablar con una persona", "Hola");
    expect(vi.mocked(enviarTexto).mock.calls[0][0]).toBe("34600111222");
  });

  it("131047 con el aviso aprobado: sale la plantilla con nombre, motivo y teléfono", async () => {
    vi.mocked(enviarTexto).mockRejectedValue(fueraDeVentana());
    vi.mocked(estadoPlantilla).mockResolvedValue({ nombre: "aviso_comercial", idioma: "es_ES", estado: "APROBADA" });
    await avisarComercial(lead, "Pide hablar con una persona", "Hola", configuracion());
    expect(estadoPlantilla).toHaveBeenCalledWith("aviso_comercial", "es_ES");
    expect(enviarPlantillaConVariables).toHaveBeenCalledWith(MOVIL_DUENO, {
      nombre: "aviso_comercial",
      idioma: "es_ES",
      variables: ["Laura Martínez", "Pide hablar con una persona", "+34 612 345 678"],
    });
    expect(lineasDelRegistro().some((l) => l.includes("Aviso enviado con el mensaje aprobado «aviso_comercial»"))).toBe(true);
  });

  it("131047 sin aviso aprobado: solo el registro en rojo", async () => {
    vi.mocked(enviarTexto).mockRejectedValue(fueraDeVentana());
    vi.mocked(estadoPlantilla).mockResolvedValue({ nombre: "aviso_comercial", idioma: "es_ES", estado: "EN_REVISION" });
    await avisarComercial(lead, "Pide hablar con una persona", "Hola", configuracion());
    expect(enviarPlantillaConVariables).not.toHaveBeenCalled();
    const rojo = lineasDelRegistro().find((l) => l.includes("No se ha podido avisarte por WhatsApp"));
    expect(rojo).toContain("\x1b[31m");
    expect(rojo).toContain("han pasado más de 24 h desde que escribiste al número del negocio");
    expect(rojo).toContain("Ajustes → Conexiones");
  });

  it("nunca lanza", async () => {
    vi.mocked(enviarTexto).mockRejectedValue(new Error("red caída"));
    await expect(avisarComercial(lead, "Motivo", "Hola", configuracion())).resolves.toBeUndefined();

    vi.mocked(enviarTexto).mockRejectedValue(fueraDeVentana());
    vi.mocked(estadoPlantilla).mockRejectedValue(new Error("Meta no responde"));
    await expect(avisarComercial(lead, "Motivo", "Hola", configuracion())).resolves.toBeUndefined();

    vi.mocked(estadoPlantilla).mockResolvedValue({ nombre: "aviso_comercial", idioma: "es_ES", estado: "APROBADA" });
    vi.mocked(enviarPlantillaConVariables).mockRejectedValue(new Error("plantilla pausada"));
    await expect(avisarComercial(lead, "Motivo", "Hola", configuracion())).resolves.toBeUndefined();

    vi.mocked(configuracionActiva).mockRejectedValue(new Error("sin agente.md"));
    await expect(avisarComercial(lead, "Motivo", "Hola")).resolves.toBeUndefined();
    expect(lineasDelRegistro().filter((l) => l.includes("ERROR al avisarte por WhatsApp")).length).toBeGreaterThanOrEqual(3);
  });
});
