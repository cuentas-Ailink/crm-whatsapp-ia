import type { ErrorApi } from "@/lib/api-tipos";
import { datosDeCliente } from "@/lib/bd";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { log } from "@/lib/log";
import { fechaEn } from "@/lib/negocio";
import { normalizar } from "@/lib/vocabulario";

// «Descargar sus datos» (RGPD): todo lo que el CRM guarda de un cliente, en un JSON que se descarga.

export const dynamic = "force-dynamic";

/** «José Ángel Núñez» → «jose-angel-nunez»; sin letras ni números, «cliente». */
function slug(nombre: string): string {
  const s = normalizar(nombre)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "cliente";
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const datos = id ? await datosDeCliente(id) : null;
  if (!datos) return Response.json({ ok: false, error: "Ese cliente ya no existe" } satisfies ErrorApi, { status: 404 });

  const cfg = await configuracionParaPintar();
  const fecha = fechaEn(new Date(), cfg.calendario.zona).fecha;
  log("Datos de un cliente descargados");
  return new Response(JSON.stringify(datos, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="datos-${slug(datos.cliente.nombre)}-${fecha}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
