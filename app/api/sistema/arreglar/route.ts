import type { ErrorApi } from "@/lib/api-tipos";
import { logError } from "@/lib/log";
import { apuntarWebhook, suscribirApp } from "@/lib/meta";
import { estadoConexiones } from "@/lib/sistema";
import { abrirTunel, urlPublica } from "@/lib/tunel";

// «Arreglar» de Ajustes → Conexiones: apuntar el webhook de Meta aquí, suscribir la app a la cuenta
// de WhatsApp o abrir el túnel. Después se vuelve a mirar todo, sin esperar a la caché.

export const dynamic = "force-dynamic";

const ARREGLOS = ["webhook", "suscripcion", "tunel"] as const;
type Arreglo = (typeof ARREGLOS)[number];

function errorApi(status: number, error: string): Response {
  return Response.json({ ok: false, error } satisfies ErrorApi, { status });
}

function metaConectada(): boolean {
  const e = (nombre: string) => !!process.env[nombre]?.trim();
  return e("WHATSAPP_TOKEN") && e("WHATSAPP_PHONE_NUMBER_ID") && e("WHATSAPP_BUSINESS_ACCOUNT_ID") && e("META_APP_SECRET");
}

/** Lo guardado de las conexiones (lib/sistema.ts) se olvida: la respuesta mira todo otra vez. */
function olvidarConexiones(): void {
  const g = globalThis as unknown as { __sistemaConexiones?: unknown; __sistemaComprobaciones?: unknown };
  delete g.__sistemaConexiones;
  delete g.__sistemaComprobaciones;
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => undefined)) as { que?: unknown } | null | undefined;
  if (cuerpo === undefined || typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return errorApi(400, "No se ha entendido la petición");
  }
  const que = cuerpo.que;
  if (typeof que !== "string" || !(ARREGLOS as readonly string[]).includes(que)) return errorApi(400, "Eso no se puede arreglar desde aquí");
  const arreglo = que as Arreglo;
  if ((arreglo === "webhook" || arreglo === "suscripcion") && !metaConectada()) return errorApi(409, "Primero conecta tu WhatsApp");
  const url = urlPublica();
  if (arreglo === "webhook" && !url) return errorApi(409, "Primero abre el túnel");
  try {
    if (arreglo === "webhook") await apuntarWebhook(`${url}/webhook`);
    else if (arreglo === "suscripcion") await suscribirApp();
    else await abrirTunel();
  } catch (error) {
    // El estado nuevo dice qué sigue fallando.
    logError(`al arreglar la conexión (${arreglo})`, error);
  }
  olvidarConexiones();
  return Response.json(await estadoConexiones({ forzar: true }));
}
