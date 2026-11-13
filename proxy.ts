import { NextResponse, type NextRequest } from "next/server";
import { decidirAcceso } from "@/lib/acceso";
import { verificarCookie } from "@/lib/sesion";

// Solo traduce la petición y el entorno para lib/acceso.ts, donde está toda la decisión, y su
// respuesta para Next. Sin config.matcher: un matcher que se salta rutas les quita la protección.

export function proxy(request: NextRequest) {
  const dominio = process.env.CRM_DOMINIO?.trim().toLowerCase() || undefined;
  const decision = decidirAcceso(
    {
      ruta: request.nextUrl.pathname,
      consulta: request.nextUrl.search,
      metodo: request.method,
      host: request.headers.get("host"),
      reenviado: request.headers.get("x-forwarded-host"),
      sitio: request.headers.get("sec-fetch-site"),
      origen: request.headers.get("origin"),
      tipo: request.headers.get("content-type"),
      // En local no se lee nunca la sesión (I21).
      cookie: dominio ? (request.cookies.get("crm_sesion")?.value ?? null) : null,
    },
    { dominio, sesionValida: (cookie) => verificarCookie(cookie, Date.now()) },
  );
  if (decision.tipo === "pasa") return NextResponse.next();
  if (decision.tipo === "redirige") {
    // Next exige aquí una URL completa y la vuelve relativa al enviarla (mismo origen que request.url):
    // el navegador recibe «/entrar?volver=…» y la resuelve en su dominio, aunque detrás de Caddy
    // request.url diga 127.0.0.1.
    const destino = new URL(decision.a, request.url).toString();
    return new NextResponse(null, { status: 307, headers: { Location: destino, "Cache-Control": "no-store" } });
  }
  const headers = new Headers();
  if (decision.json) headers.set("Content-Type", "application/json");
  if (decision.status === 401) headers.set("Cache-Control", "no-store");
  return new NextResponse(decision.cuerpo, { status: decision.status, headers });
}
