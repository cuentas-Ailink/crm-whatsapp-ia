import type {
  EstadoClave,
  EstadoConexiones,
  EstadoPlantilla,
  IdPlantillaApp,
  NombreClave,
  PeticionConectarMeta,
  PeticionPrueba,
  ResultadoPasoMeta,
  ResultadoPrueba,
} from "@/lib/api-tipos";
import type { IdModelo } from "@/lib/configuracion";
import type { CodigoError } from "@/lib/errores";

// Envoltorios finos de las rutas del sistema: devuelven lo que dice el servidor o su error en español.
// El valor de una clave nunca se escribe en la consola ni se guarda en el módulo.

const SIN_CONEXION = "Sin conexión con el servidor. Vuelve a intentarlo en un momento.";

type Datos = Record<string, unknown>;
type Respuesta = { ok: true; datos: Datos | null } | { ok: false; error: string; datos: Datos | null };

/** Sin sesión en modo servidor: a la pantalla de entrar, volviendo luego a donde estaba. */
function irAEntrar(): void {
  location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
}

/** GET sin cuerpo; POST con JSON (todas las rutas de escritura solo aceptan JSON). */
async function pedir(url: string, cuerpo?: unknown): Promise<Respuesta> {
  let respuesta: Response;
  try {
    respuesta =
      cuerpo === undefined
        ? await fetch(url, { cache: "no-store" })
        : await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store" });
  } catch {
    return { ok: false, error: SIN_CONEXION, datos: null };
  }
  const leidos = (await respuesta.json().catch(() => null)) as unknown;
  const datos = typeof leidos === "object" && leidos !== null ? (leidos as Datos) : null;
  if (respuesta.status === 401 && datos?.codigo === "sesion") irAEntrar();
  if (!respuesta.ok) {
    return { ok: false, error: typeof datos?.error === "string" ? datos.error : `El servidor respondió ${respuesta.status}`, datos };
  }
  return { ok: true, datos };
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** null = ha ido bien; si no, el error del servidor (también un 200 con { ok: false, error }). */
function errorDe(r: Respuesta): string | null {
  if (!r.ok) return r.error;
  return r.datos?.ok === false ? (texto(r.datos.error) ?? "El servidor no ha podido hacerlo.") : null;
}

export async function cambiarAsistente(activo: boolean): Promise<{ ok: true; activo: boolean; pausadoEn: number | null } | { ok: false; error: string }> {
  const r = await pedir("/api/asistente/activo", { activo });
  const error = errorDe(r);
  if (error !== null) return { ok: false, error };
  return {
    ok: true,
    activo: typeof r.datos?.activo === "boolean" ? r.datos.activo : activo,
    pausadoEn: typeof r.datos?.pausadoEn === "number" ? r.datos.pausadoEn : null,
  };
}

/** null = el modelo responde. */
export async function comprobarModelo(modelo: IdModelo): Promise<string | null> {
  return errorDe(await pedir("/api/asistente/modelo", { modelo }));
}

export async function probarAsistente(p: PeticionPrueba): Promise<ResultadoPrueba | { error: string }> {
  const r = await pedir("/api/asistente/probar", p);
  if (!r.ok) return { error: r.error };
  return r.datos as unknown as ResultadoPrueba;
}

/** null si no se ha podido leer. */
export async function leerConexiones(forzar?: boolean): Promise<EstadoConexiones | null> {
  const r = await pedir(forzar ? "/api/sistema?forzar=1" : "/api/sistema");
  return r.ok && r.datos ? (r.datos as unknown as EstadoConexiones) : null;
}

export async function arreglar(que: "webhook" | "suscripcion" | "tunel"): Promise<EstadoConexiones | { error: string }> {
  const r = await pedir("/api/sistema/arreglar", { que });
  if (!r.ok) return { error: r.error };
  return r.datos as unknown as EstadoConexiones;
}

/** [] si no se ha podido leer. */
export async function leerClaves(): Promise<EstadoClave[]> {
  const r = await pedir("/api/claves");
  return r.ok && Array.isArray(r.datos?.claves) ? (r.datos.claves as EstadoClave[]) : [];
}

export async function guardarClave(
  nombre: NombreClave,
  valor: string,
): Promise<{ ok: true; terminaEn: string; nota?: string } | { ok: false; error: string; codigo?: CodigoError; guardada?: boolean }> {
  const r = await pedir("/api/claves", { nombre, valor });
  const d = r.datos;
  // Un 400 (ErrorApi) o un 200 { ok: false, guardada: true, codigo: "claude.saldo" }: se devuelven igual.
  if (!r.ok || d?.ok === false) {
    const fallo: { ok: false; error: string; codigo?: CodigoError; guardada?: boolean } = { ok: false, error: r.ok ? (texto(d?.error) ?? "No se ha podido guardar la clave.") : r.error };
    if (typeof d?.codigo === "string") fallo.codigo = d.codigo as CodigoError;
    if (typeof d?.guardada === "boolean") fallo.guardada = d.guardada;
    return fallo;
  }
  const bien: { ok: true; terminaEn: string; nota?: string } = { ok: true, terminaEn: texto(d?.terminaEn) ?? "" };
  const nota = texto(d?.nota);
  if (nota !== undefined) bien.nota = nota;
  return bien;
}

/** Un paso que falla es un 200 con ResultadoPasoMeta: se devuelve tal cual. */
export async function conectarMeta(p: PeticionConectarMeta): Promise<ResultadoPasoMeta | { error: string }> {
  const r = await pedir("/api/meta/conectar", p);
  if (!r.ok) return { error: r.error };
  return r.datos as unknown as ResultadoPasoMeta;
}

/** [] si no se han podido leer. */
export async function leerPlantillas(): Promise<EstadoPlantilla[]> {
  const r = await pedir("/api/meta/plantillas");
  return r.ok && Array.isArray(r.datos?.plantillas) ? (r.datos.plantillas as EstadoPlantilla[]) : [];
}

export async function crearPlantillas(ids: IdPlantillaApp[]): Promise<EstadoPlantilla[] | { error: string }> {
  const r = await pedir("/api/meta/plantillas", { crear: ids });
  if (!r.ok) return { error: r.error };
  return Array.isArray(r.datos?.plantillas) ? (r.datos.plantillas as EstadoPlantilla[]) : [];
}

export async function enviarWhatsAppPrueba(telefono: string, nombre?: string): Promise<{ ok: true; plantilla: string; nota?: string } | { ok: false; error: string }> {
  const r = await pedir("/api/whatsapp/prueba", { telefono, nombre });
  const d = r.datos;
  if (!r.ok) return { ok: false, error: r.error };
  if (d?.ok === false) return { ok: false, error: texto(d.error) ?? "No se ha podido enviar el WhatsApp de prueba." };
  const bien: { ok: true; plantilla: string; nota?: string } = { ok: true, plantilla: texto(d?.plantilla) ?? "" };
  const nota = texto(d?.nota);
  if (nota !== undefined) bien.nota = nota;
  return bien;
}

/** null = aviso enviado. */
export async function enviarAvisoPrueba(): Promise<string | null> {
  return errorDe(await pedir("/api/avisos/prueba", {}));
}
