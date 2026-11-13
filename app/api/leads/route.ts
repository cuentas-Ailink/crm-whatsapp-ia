import { leerBdConConfiguracion } from "@/lib/configuracion-servidor";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await leerBdConConfiguracion());
}
