import { log } from "./log";
import { descargarMedia } from "./whatsapp";

// Las notas de voz se transcriben con Gemini 3.5 Transcribe de Google. Si no hay clave de Gemini,
// con Whisper en Groq o con gpt-4o-mini-transcribe en OpenAI, que comparten la misma API.
// Claude no recibe audio: le llega el texto, marcado como nota de voz.

const TIEMPO_MAXIMO_MS = 20_000;
const CADUCIDAD_MS = 10 * 60_000;
const IDIOMA = "es-ES";

// Con ruido o silencio, Whisper a veces «oye» los créditos de los vídeos con los que se entrenó.
const ALUCINACIONES = /amara\.org|subt[ií]tulos (realizados|por|hechos)|gracias por ver el v[ií]deo|suscr[ií]bete al canal/i;

export interface Proveedor {
  nombre: string;
  /** «google» es la Interactions API de Gemini; «openai», la de /audio/transcriptions, que usa también Groq. */
  api: "google" | "openai";
  url: string;
  clave: string;
  modelo: string;
}

export function proveedorTranscripcion(): Proveedor | null {
  const url = process.env.TRANSCRIPCION_BASE_URL;
  const modelo = process.env.TRANSCRIPCION_MODELO;
  if (process.env.GEMINI_API_KEY) {
    return {
      nombre: "Google",
      api: "google",
      url: url || "https://generativelanguage.googleapis.com/v1beta",
      clave: process.env.GEMINI_API_KEY,
      modelo: modelo || "gemini-3.5-transcribe",
    };
  }
  if (process.env.GROQ_API_KEY) {
    return { nombre: "Groq", api: "openai", url: url || "https://api.groq.com/openai/v1", clave: process.env.GROQ_API_KEY, modelo: modelo || "whisper-large-v3-turbo" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { nombre: "OpenAI", api: "openai", url: url || "https://api.openai.com/v1", clave: process.env.OPENAI_API_KEY, modelo: modelo || "gpt-4o-mini-transcribe" };
  }
  return null;
}

const tipoMime = (mime: string) => mime.split(";")[0].trim() || "audio/ogg";

function extension(mime: string): string {
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("webm")) return "webm";
  return "ogg";
}

interface RespuestaGoogle {
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
  outputs?: { type?: string; text?: string }[];
  output_text?: string;
  error?: { message?: string };
}

/** El texto de una interacción. El formato actual va en `steps`; el anterior, en `outputs`. */
export function textoDeInteraccion(cuerpo: RespuestaGoogle): string {
  const deSteps = (cuerpo.steps ?? [])
    .filter((paso) => !paso.type || paso.type === "model_output")
    .flatMap((paso) => paso.content ?? [])
    .filter((parte) => parte.type === "text" && parte.text)
    .map((parte) => parte.text);
  if (deSteps.length > 0) return deSteps.join(" ").trim();
  const deOutputs = (cuerpo.outputs ?? []).filter((o) => o.type === "text" && o.text).map((o) => o.text);
  if (deOutputs.length > 0) return deOutputs.join(" ").trim();
  return (cuerpo.output_text ?? "").trim();
}

/**
 * Gemini 3.5 Transcribe por la Interactions API. Una nota de voz es pequeña, así que el audio va
 * en la propia petición, sin subirlo antes con la Files API. El modo «smart» quita muletillas y
 * repeticiones, que es lo que le conviene leer al agente.
 */
async function transcribirConGoogle(p: Proveedor, datos: ArrayBuffer, mime: string): Promise<string> {
  const respuesta = await fetch(`${p.url}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": p.clave, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.modelo,
      input: [{ type: "audio", data: Buffer.from(datos).toString("base64"), mime_type: tipoMime(mime) }],
      generation_config: { transcription_config: { mode: "smart", language_codes: [IDIOMA] } },
    }),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as RespuestaGoogle;
  if (!respuesta.ok) throw new Error(`Google respondió ${respuesta.status}: ${cuerpo.error?.message ?? "sin detalle"}`);
  if (cuerpo.status && cuerpo.status !== "completed") throw new Error(`Google no ha terminado la transcripción (${cuerpo.status})`);
  return textoDeInteraccion(cuerpo);
}

async function transcribirConWhisper(p: Proveedor, datos: ArrayBuffer, mime: string): Promise<string> {
  const formulario = new FormData();
  formulario.append("file", new Blob([datos], { type: tipoMime(mime) }), `nota.${extension(mime)}`);
  formulario.append("model", p.modelo);
  formulario.append("language", IDIOMA.slice(0, 2));
  formulario.append("response_format", "json");
  formulario.append("temperature", "0");
  const respuesta = await fetch(`${p.url}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.clave}` },
    body: formulario,
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!respuesta.ok) throw new Error(`${p.nombre} respondió ${respuesta.status}: ${cuerpo.error?.message ?? "sin detalle"}`);
  return (cuerpo.text ?? "").trim();
}

export async function pedirTranscripcion(p: Proveedor, datos: ArrayBuffer, mime: string): Promise<string> {
  const bruto = p.api === "google" ? await transcribirConGoogle(p, datos, mime) : await transcribirConWhisper(p, datos, mime);
  // Gemini separa párrafos con saltos de línea: un mensaje de WhatsApp va en uno solo.
  const texto = bruto.replace(/\s+/g, " ").trim();
  return ALUCINACIONES.test(texto) ? "" : texto;
}

const global_ = globalThis as unknown as { __transcripciones?: Map<string, Promise<string>> };
const enCurso = (global_.__transcripciones ??= new Map());

/**
 * Empieza en cuanto entra el webhook, para que esté lista cuando se cierre el lote, y se guarda
 * por id de mensaje: si el lote se cancela y se rehace, no se paga dos veces. Devuelve "" si no
 * se ha entendido nada.
 */
export function transcribir(wamid: string, mediaId: string): Promise<string> {
  const previa = enCurso.get(wamid);
  if (previa) return previa;
  const promesa = (async () => {
    const proveedor = proveedorTranscripcion();
    if (!proveedor) throw new Error("no hay servicio de transcripción: añade GEMINI_API_KEY a .env");
    const inicio = Date.now();
    const { datos, mime } = await descargarMedia(mediaId);
    const texto = await pedirTranscripcion(proveedor, datos, mime);
    log(`Nota de voz transcrita con ${proveedor.nombre} (${proveedor.modelo}) en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
    return texto;
  })();
  // Quien la espera recoge el error; aquí solo se evita el aviso de promesa sin atender.
  promesa.catch(() => undefined);
  enCurso.set(wamid, promesa);
  setTimeout(() => enCurso.delete(wamid), CADUCIDAD_MS).unref?.();
  return promesa;
}
