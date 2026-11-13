import { estadoConexiones } from "@/lib/sistema";

// Cómo están las conexiones: Claude, WhatsApp, los mensajes que llegan y los datos.
// ?forzar=1 vuelve a mirar (como mucho cada 10 s); ?completo=1 añade la lista de comprobaciones.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const consulta = new URL(request.url).searchParams;
  return Response.json(await estadoConexiones({ forzar: consulta.get("forzar") === "1", completo: consulta.get("completo") === "1" }));
}
