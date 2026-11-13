import type { ErrorApi } from "@/lib/api-tipos";
import { darDeAlta } from "@/lib/alta";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { anotarBienvenida, frenar, ipDeCabecera } from "@/lib/freno";
import { logAviso } from "@/lib/log";
import { modoWhatsApp } from "@/lib/modo-prueba";
import { NO_DISPONIBLE_EN_PRUEBA } from "@/lib/modo-prueba-reglas";
import { normalizarTelefono } from "@/lib/regional";
import { modoServidor } from "@/lib/tunel";

// El formulario de la web. Todo lo hace darDeAlta, el mismo camino que «+ Cliente»: validar, la
// bienvenida por WhatsApp una sola vez por minuto y móvil, y guardar al cliente solo si ha salido.
// Antes, el freno contra el abuso (lib/freno.ts): `web` es la trampa para robots del formulario y,
// en modo servidor, hay topes por teléfono, por IP y por día.

export const dynamic = "force-dynamic";

const REVISA = "Revisa el formulario";
const MAXIMO_EMAIL = 120;
const MAXIMO_ZONA = 60;
const MAXIMO_CLAVES_FUENTE = 10;
const MAXIMO_VALOR_FUENTE = 100;

const largo = (valor: unknown) => (typeof valor === "string" ? Array.from(valor).length : 0);

/** De dónde viene la visita: como mucho 10 claves, solo textos y cada uno de 100 caracteres. */
function fuenteRecortada(fuente: unknown): Record<string, string> | undefined {
  if (typeof fuente !== "object" || fuente === null || Array.isArray(fuente)) return undefined;
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(fuente).slice(0, MAXIMO_CLAVES_FUENTE)) {
    if (typeof valor === "string") salida[clave] = Array.from(valor).slice(0, MAXIMO_VALOR_FUENTE).join("");
  }
  return salida;
}

export async function POST(request: Request) {
  // El formulario empieza con la bienvenida, un mensaje aprobado de Meta: en el modo prueba no existe.
  if (modoWhatsApp() === "prueba") {
    return Response.json({ ok: false, error: `${NO_DISPONIBLE_EN_PRUEBA}: el formulario necesita WhatsApp oficial` } satisfies ErrorApi, { status: 409 });
  }
  const cuerpo = await request.json().catch(() => undefined);
  if (!cuerpo || typeof cuerpo !== "object") {
    return Response.json({ ok: false, error: REVISA } satisfies ErrorApi, { status: 400 });
  }
  if (largo(cuerpo.email) > MAXIMO_EMAIL || largo(cuerpo.zona) > MAXIMO_ZONA) {
    return Response.json({ ok: false, error: REVISA } satisfies ErrorApi, { status: 400 });
  }

  // El teléfono como lo guardará darDeAlta; si no se puede normalizar, el texto tal cual (y darDeAlta dará su 400).
  const crudo = typeof cuerpo.telefono === "string" ? cuerpo.telefono : cuerpo.telefono == null ? "" : String(cuerpo.telefono);
  const { regional } = await configuracionParaPintar();
  const telefono = normalizarTelefono(crudo, regional.prefijo) ?? crudo;
  const web = cuerpo.web == null ? undefined : String(cuerpo.web);
  const freno = frenar({ ip: ipDeCabecera(request.headers.get("x-forwarded-for")), telefono, web }, Date.now(), modoServidor());
  if (!freno.ok) {
    if ("trampa" in freno) {
      // Como si hubiera ido bien: el robot no aprende nada. Sin nombre ni teléfono en el registro.
      logAviso("Formulario descartado: campo trampa");
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: freno.error } satisfies ErrorApi, { status: freno.status });
  }

  const r = await darDeAlta({
    nombre: cuerpo.nombre,
    telefono: cuerpo.telefono,
    email: cuerpo.email,
    zona: cuerpo.zona,
    origen: "formulario",
    permiso: cuerpo.consentimiento === true,
    fuente: fuenteRecortada(cuerpo.fuente),
  });
  if (r.ok) {
    // Solo una bienvenida que ha salido cuenta para el tope: un envío fallido se puede repetir.
    if (r.enviado) anotarBienvenida(telefono, Date.now());
    return Response.json({ ok: true });
  }
  const { status, ok: _ok, leadId: _leadId, ...resto } = r;
  return Response.json({ ok: false, ...resto } satisfies ErrorApi, { status });
}
