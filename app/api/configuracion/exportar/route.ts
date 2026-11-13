import type { ErrorApi } from "@/lib/api-tipos";
import { leerConfiguracionGuardada } from "@/lib/bd";
import { normalizarGuardada, sinLogoVersion, type NegocioExportado } from "@/lib/configuracion";
import { configuracionActiva } from "@/lib/configuracion-servidor";
import { logError } from "@/lib/log";

// El negocio activo en un archivo, para guardarlo o pasárselo a Claude Code: su configuración propia
// (sin el logo) y sus instrucciones.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [{ perfil, config }, raw] = await Promise.all([configuracionActiva(), leerConfiguracionGuardada()]);
    const { sector: _sector, base: _base, ...propia } = normalizarGuardada(raw).perfiles[perfil.id] ?? {};
    const negocio: NegocioExportado = {
      formato: "crm-whatsapp/negocio@1",
      nombre: config.negocio.nombre,
      base: config.base,
      configuracion: sinLogoVersion(propia),
      instrucciones: perfil.instrucciones,
    };
    return new Response(`${JSON.stringify(negocio, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="negocio-${perfil.id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logError("al exportar el negocio", error);
    return Response.json({ ok: false, error: "Algo ha fallado. Vuelve a intentarlo en un momento." } satisfies ErrorApi, { status: 500 });
  }
}
