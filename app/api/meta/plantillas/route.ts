import type { EstadoPlantilla, ErrorApi, IdPlantillaApp } from "@/lib/api-tipos";
import { parametroSeguro } from "@/lib/configuracion";
import { configuracionActiva } from "@/lib/configuracion-servidor";
import { explicar } from "@/lib/errores";
import { crearPlantilla, estadoPlantilla, listarPlantillas, plantillasAprobadas } from "@/lib/meta";
import { modoWhatsApp } from "@/lib/modo-prueba";
import { NO_DISPONIBLE_EN_PRUEBA } from "@/lib/modo-prueba-reglas";
import { plantillasDeLaApp, type PlantillaApp } from "@/lib/plantillas";

// Los mensajes aprobados que necesita la app: cómo están en Meta y, si no existen, crearlos.

export const dynamic = "force-dynamic";

function errorApi(status: number, error: string): Response {
  return Response.json({ ok: false, error } satisfies ErrorApi, { status });
}

/** Las plantillas de la app con el negocio activo. */
async function plantillasApp(): Promise<PlantillaApp[]> {
  const { config } = await configuracionActiva();
  const negocio = parametroSeguro(config.negocio.nombre) || config.perfil.nombre;
  return plantillasDeLaApp(config.plantilla, negocio);
}

/** Cómo está cada una en Meta. Primero una lectura forzada (con su espera de 5 s entre pestañas). */
async function estados(app: PlantillaApp[]): Promise<EstadoPlantilla[]> {
  try {
    await listarPlantillas({ forzar: true });
  } catch {
    // estadoPlantilla lo cuenta en cada fila.
  }
  return Promise.all(
    app.map(async (p) => {
      const e = await estadoPlantilla(p.nombre, p.idioma);
      return { ...e, id: p.id, texto: e.texto ?? p.texto };
    }),
  );
}

function noSePuede(): Response {
  const e = explicar("desconocido");
  return errorApi(500, `${e.titulo}. ${e.solucion}`);
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("aprobadas") === "1") return Response.json({ aprobadas: await plantillasAprobadas() });
  let app: PlantillaApp[];
  try {
    app = await plantillasApp();
  } catch {
    return noSePuede();
  }
  return Response.json({ plantillas: await estados(app) });
}

export async function POST(request: Request) {
  if (modoWhatsApp() === "prueba") return errorApi(409, `${NO_DISPONIBLE_EN_PRUEBA}: los mensajes aprobados son de WhatsApp oficial`);
  const cuerpo = (await request.json().catch(() => null)) as { crear?: unknown } | null;
  let app: PlantillaApp[];
  try {
    app = await plantillasApp();
  } catch {
    return noSePuede();
  }
  const ids = new Set<string>(app.map((p) => p.id));
  const crear = cuerpo?.crear;
  if (!Array.isArray(crear) || crear.some((id) => typeof id !== "string" || !ids.has(id))) {
    return errorApi(400, "Ese mensaje no se puede crear desde aquí");
  }
  if (!process.env.WHATSAPP_TOKEN?.trim() || !process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim()) {
    return errorApi(409, "Primero conecta tu WhatsApp");
  }
  const pedidas = new Set(crear as IdPlantillaApp[]);
  // Antes de crear, una lectura fresca: con la de la caché se podría dar por existente una que ya no está.
  try {
    await listarPlantillas({ forzar: true });
  } catch {
    // estadoPlantilla lo cuenta.
  }
  for (const p of app) {
    if (!pedidas.has(p.id)) continue;
    const e = await estadoPlantilla(p.nombre, p.idioma);
    if (e.estado === "NO_EXISTE") await crearPlantilla(p);
  }
  return Response.json({ plantillas: await estados(app) });
}
