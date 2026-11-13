import type { EstadoApp, Puesta } from "@/lib/api-tipos";
import { contarLeads } from "@/lib/bd";
import { firmaDePortada } from "@/lib/configuracion";
import { configuracionParaPintar, leerBdConConfiguracion } from "@/lib/configuracion-servidor";
import { logAviso, logError } from "@/lib/log";
import { numeroDelNegocio } from "@/lib/meta";
import { modoWhatsApp } from "@/lib/modo-prueba";
import { cifrasDeLaWeb } from "@/lib/numero-web";
import { leerPerfil } from "@/lib/perfil";
import { estadoPuesta } from "@/lib/sistema";
import { modoServidor } from "@/lib/tunel";

export const dynamic = "force-dynamic";

const UN_MINUTO = 60_000;
const global_ = globalThis as unknown as { __avisoPuesta?: number };

async function estadoBd(): Promise<{ ok: boolean; leads?: number }> {
  try {
    return { ok: true, leads: await contarLeads() };
  } catch (error) {
    logError("al abrir la base de datos", error);
    return { ok: false };
  }
}

/** Solo los cinco sí o no. Si no se puede saber, todo a sí y un aviso rojo por minuto. */
async function puesta(): Promise<Puesta> {
  try {
    const p = await estadoPuesta();
    return {
      negocio: p.negocio === true,
      claude: p.claude === true,
      whatsapp: p.whatsapp === true,
      mensajes: p.mensajes === true,
      primerMensaje: p.primerMensaje === true,
    };
  } catch (error) {
    const ahora = Date.now();
    if (global_.__avisoPuesta === undefined || ahora - global_.__avisoPuesta >= UN_MINUTO) {
      global_.__avisoPuesta = ahora;
      logAviso(`No se ha podido mirar la puesta en marcha: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { negocio: true, claude: true, whatsapp: true, mensajes: true, primerMensaje: true };
  }
}

async function ejemplosDe(): Promise<string | null> {
  try {
    return (await leerBdConConfiguracion()).ajustes.ejemplosDe ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  // La portada lo mira cada 3 s: solo la firma, de la caché, sin contar clientes. Con el botón de
  // WhatsApp, la firma de la portada cuenta también el número conectado (firmaDePortada).
  if (new URL(request.url).searchParams.get("solo") === "firma") {
    const c = await configuracionParaPintar();
    return Response.json({ firma: firmaDePortada(c, cifrasDeLaWeb()) });
  }

  const bd = await estadoBd();
  const perfil = await leerPerfil().catch(() => null);
  const deEjemplo = await ejemplosDe();
  const config = await configuracionParaPintar();
  const prueba = modoWhatsApp() === "prueba";
  // En el modo prueba no hay número del negocio: se escribe al móvil de pruebas.
  const n = prueba ? null : numeroDelNegocio();
  const estado: EstadoApp = {
    bd,
    perfil: perfil ? { id: perfil.id, nombre: perfil.nombre } : null,
    // BD_LOCAL solo lo pone scripts/servidor-pruebas.mjs. Las pruebas que borran datos lo miran antes.
    pruebas: Boolean(process.env.BD_LOCAL),
    modo: modoServidor() ? "servidor" : "local",
    modoWhatsApp: prueba ? "prueba" : "oficial",
    puesta: await puesta(),
    numero: n ? { texto: n.texto, enlace: `https://wa.me/${n.texto.replace(/\D/g, "")}?text=Hola` } : null,
    configuracion: {
      sector: config.sector,
      base: config.base,
      negocio: { nombre: config.negocio.nombre },
      plantilla: config.plantilla,
      web: config.web,
      guardada: config.guardada,
      ejemplosDe: deEjemplo,
      firma: config.firma,
    },
  };
  return Response.json(estado);
}
