import { fechaEn } from "@/lib/agenda";
import { leerBd } from "@/lib/bd";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { csvDeLeads } from "@/lib/exportar";

// «Descargar en Excel (CSV)»: todos los clientes en una hoja, con las palabras, la zona y la moneda del
// negocio. Siempre se calcula de nuevo, nunca se guarda en caché. El nombre empieza por «leads-».
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await configuracionParaPintar();
  const bd = await leerBd();
  const zona = cfg.calendario.zona;
  const fecha = fechaEn(new Date(), zona).fecha;
  const csv = csvDeLeads(Object.values(bd.leads), { vocabulario: cfg.vocabulario, zona, moneda: cfg.regional.moneda });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${fecha}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
