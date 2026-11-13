import { guardarAjustes } from "@/lib/bd";

export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => null);
  if (typeof cuerpo?.leadsPrueba !== "boolean") {
    return Response.json({ ok: false, error: "Falta leadsPrueba" }, { status: 400 });
  }
  await guardarAjustes({ leadsPrueba: cuerpo.leadsPrueba });
  return Response.json({ ok: true });
}
