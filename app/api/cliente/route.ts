import { darDeAlta } from "@/lib/alta";

// «+ Cliente» en el panel: el dueño añade a alguien a mano. Con permiso, sale la bienvenida por
// WhatsApp; sin permiso, solo se guarda. Un móvil que ya está devuelve 409 con su ficha.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => undefined);
  if (!cuerpo || typeof cuerpo !== "object") {
    return Response.json({ ok: false, error: "Revisa los datos del cliente" }, { status: 400 });
  }
  const r = await darDeAlta({
    nombre: cuerpo.nombre,
    telefono: cuerpo.telefono,
    quiere: cuerpo.quiere,
    origen: "manual",
    permiso: cuerpo.permiso === true,
  });
  if (r.ok) return Response.json({ ok: true, leadId: r.leadId, enviado: r.enviado });
  const { status, ok: _ok, ...resto } = r;
  return Response.json({ ok: false, ...resto }, { status });
}
