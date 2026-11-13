import type { ErrorApi, PasoMeta, PeticionConectarMeta } from "@/lib/api-tipos";
import { conectarPaso } from "@/lib/meta";
import { modoWhatsApp } from "@/lib/modo-prueba";

// «Conecta tu WhatsApp», paso a paso: cada llamada hace uno y dice cuál va después. El cuerpo lleva
// claves: no se escribe en ningún registro.

export const dynamic = "force-dynamic";

const PASOS: readonly PasoMeta[] = ["claves", "cuenta", "numero", "tunel", "suscripcion", "webhook", "firma"];
const CAMPOS = ["token", "secreto", "ngrok", "waba", "numero"] as const;
const MAXIMO = 500;

function errorApi(error: string, campo?: string): Response {
  return Response.json({ ok: false, error, ...(campo ? { campo } : {}) } satisfies ErrorApi, { status: 400 });
}

export async function POST(request: Request) {
  if (modoWhatsApp() === "prueba") return errorApi("Estás en modo prueba: pulsa «Pasar a WhatsApp oficial» antes de conectar Meta");
  const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const paso = cuerpo?.paso;
  if (typeof paso !== "string" || !(PASOS as readonly string[]).includes(paso)) return errorApi("Ese paso no existe", "paso");
  const peticion: PeticionConectarMeta = { paso: paso as PasoMeta };
  for (const campo of CAMPOS) {
    const crudo = cuerpo?.[campo];
    if (crudo === undefined || crudo === null) continue;
    const valor = String(crudo).trim();
    if (/[\r\n\0]/.test(valor) || valor.length > MAXIMO) return errorApi("Revisa lo que has pegado: tiene un salto de línea", campo);
    if (valor) peticion[campo] = valor;
  }
  return Response.json(await conectarPaso(peticion));
}
