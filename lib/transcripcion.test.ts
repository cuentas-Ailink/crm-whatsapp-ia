import { afterEach, describe, expect, it, vi } from "vitest";
import { pedirTranscripcion, proveedorTranscripcion, textoDeInteraccion, type Proveedor } from "./transcripcion";

const AUDIO = new TextEncoder().encode("OggS audio").buffer as ArrayBuffer;
const google: Proveedor = { nombre: "Google", api: "google", url: "https://g.test/v1beta", clave: "k", modelo: "gemini-3.5-transcribe" };

function simularFetch(respuesta: object, estado = 200) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(respuesta), { status: estado });
  });
  return llamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("qué servicio se usa", () => {
  it("Google si hay clave de Gemini, aunque haya otras", () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("GROQ_API_KEY", "q");
    expect(proveedorTranscripcion()).toMatchObject({ nombre: "Google", api: "google", modelo: "gemini-3.5-transcribe" });
  });

  it("si no, Groq, y si no, OpenAI", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "q");
    expect(proveedorTranscripcion()?.nombre).toBe("Groq");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "o");
    expect(proveedorTranscripcion()?.nombre).toBe("OpenAI");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(proveedorTranscripcion()).toBeNull();
  });
});

describe("Gemini 3.5 Transcribe", () => {
  it("manda el audio en línea a la Interactions API, en español y en modo smart", async () => {
    const llamadas = simularFetch({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Para vivir" }] }] });
    expect(await pedirTranscripcion(google, AUDIO, "audio/ogg; codecs=opus")).toBe("Para vivir");
    const [{ url, init }] = llamadas;
    expect(url).toBe("https://g.test/v1beta/interactions");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gemini-3.5-transcribe",
      input: [{ type: "audio", data: Buffer.from(AUDIO).toString("base64"), mime_type: "audio/ogg" }],
      generation_config: { transcription_config: { mode: "smart", language_codes: ["es-ES"] } },
    });
  });

  it("junta los párrafos en uno, como un mensaje de WhatsApp", async () => {
    simularFetch({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Hola, buenas.\n\nLo buscamos para vivir." }] }] });
    expect(await pedirTranscripcion(google, AUDIO, "audio/ogg")).toBe("Hola, buenas. Lo buscamos para vivir.");
  });

  it("lee el texto en el formato actual y en el anterior", () => {
    expect(textoDeInteraccion({ steps: [{ type: "user_input", content: [] }, { type: "model_output", content: [{ type: "text", text: "Hola" }] }] })).toBe("Hola");
    expect(textoDeInteraccion({ outputs: [{ type: "text", text: "Hola" }] })).toBe("Hola");
    expect(textoDeInteraccion({ output_text: " Hola " })).toBe("Hola");
    expect(textoDeInteraccion({})).toBe("");
  });

  it("un error de Google se explica", async () => {
    simularFetch({ error: { message: "API key not valid" } }, 400);
    await expect(pedirTranscripcion(google, AUDIO, "audio/ogg")).rejects.toThrow("Google respondió 400: API key not valid");
  });

  it("una interacción que no ha terminado no se da por buena", async () => {
    simularFetch({ status: "failed", steps: [] });
    await expect(pedirTranscripcion(google, AUDIO, "audio/ogg")).rejects.toThrow("failed");
  });
});

describe("Groq y OpenAI", () => {
  it("usan /audio/transcriptions con el archivo en un formulario", async () => {
    const llamadas = simularFetch({ text: "La tengo preaprobada" });
    const groq: Proveedor = { nombre: "Groq", api: "openai", url: "https://q.test/v1", clave: "k", modelo: "whisper-large-v3-turbo" };
    expect(await pedirTranscripcion(groq, AUDIO, "audio/ogg; codecs=opus")).toBe("La tengo preaprobada");
    const formulario = llamadas[0].init.body as FormData;
    expect(llamadas[0].url).toBe("https://q.test/v1/audio/transcriptions");
    expect(formulario.get("model")).toBe("whisper-large-v3-turbo");
    expect(formulario.get("language")).toBe("es");
    expect((formulario.get("file") as File).name).toBe("nota.ogg");
  });

  it("descarta los créditos que Whisper se inventa con el ruido", async () => {
    simularFetch({ text: "Subtítulos realizados por la comunidad de Amara.org" });
    const groq: Proveedor = { nombre: "Groq", api: "openai", url: "https://q.test/v1", clave: "k", modelo: "m" };
    expect(await pedirTranscripcion(groq, AUDIO, "audio/ogg")).toBe("");
  });
});
