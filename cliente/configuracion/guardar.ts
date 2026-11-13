import { avisarCambioDeConfiguracion } from "../datos";

// Guarda un dato de la configuración por su ruta: "negocio.nombre", "calendario.horas", "agente.trato",
// "sistema.avisos.comercial.telefono"… → POST /api/configuracion con { perfilId, cambios } o { perfilId, sistema }.

const SIN_CONEXION = "Sin conexión con el servidor. Vuelve a intentarlo en un momento.";
const NO_SE_PUEDE = "No se ha podido guardar ese dato.";
const PROHIBIDAS = new Set(["", "__proto__", "constructor", "prototype"]);

type Datos = Record<string, unknown>;
type Respuesta = { ok: true; datos: Datos | null } | { ok: false; error: string; datos: Datos | null; status: number | null };
type Resultado = { ok: true } | { ok: false; error: string; campo?: string };

// El perfil del último GET /api/configuracion (o del último guardado).
let perfilId: string | null = null;

/** Sin sesión en modo servidor: a la pantalla de entrar, volviendo luego a donde estaba. */
function irAEntrar(): void {
  location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
}

async function pedir(url: string, cuerpo?: unknown): Promise<Respuesta> {
  let respuesta: Response;
  try {
    respuesta =
      cuerpo === undefined
        ? await fetch(url, { cache: "no-store" })
        : await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store" });
  } catch {
    return { ok: false, error: SIN_CONEXION, datos: null, status: null };
  }
  const leidos = (await respuesta.json().catch(() => null)) as unknown;
  const datos = typeof leidos === "object" && leidos !== null ? (leidos as Datos) : null;
  if (respuesta.status === 401 && datos?.codigo === "sesion") irAEntrar();
  if (!respuesta.ok) {
    const error = typeof datos?.error === "string" ? datos.error : `El servidor respondió ${respuesta.status}`;
    return { ok: false, error, datos, status: respuesta.status };
  }
  return { ok: true, datos };
}

/** El id de perfil de `activa.perfil.id`, si viene. */
function perfilDe(datos: Datos | null): string | null {
  const activa = datos?.activa as { perfil?: { id?: unknown } } | undefined;
  return typeof activa?.perfil?.id === "string" ? activa.perfil.id : null;
}

async function leerPerfil(): Promise<Resultado> {
  const r = await pedir("/api/configuracion");
  if (!r.ok) return { ok: false, error: r.error };
  const id = perfilDe(r.datos);
  if (id === null) return { ok: false, error: NO_SE_PUEDE };
  perfilId = id;
  return { ok: true };
}

/** { a: { b: valor } } a partir de ["a", "b"]. */
function anidar(claves: string[], valor: unknown): unknown {
  return claves.reduceRight<unknown>((dentro, clave) => ({ [clave]: dentro }), valor);
}

export async function guardarCampo(ruta: string, valor: unknown): Promise<{ ok: true } | { ok: false; error: string; campo?: string }> {
  const partes = ruta.split(".");
  if (partes.some((p) => PROHIBIDAS.has(p)) || (partes[0] === "sistema" && partes.length === 1)) return { ok: false, error: NO_SE_PUEDE };
  const cuerpo = (id: string) => (partes[0] === "sistema" ? { perfilId: id, sistema: anidar(partes.slice(1), valor) } : { perfilId: id, cambios: anidar(partes, valor) });

  if (perfilId === null) {
    const leido = await leerPerfil();
    if (!leido.ok) return leido;
  }
  let r = await pedir("/api/configuracion", cuerpo(perfilId as string));
  // 409: el perfil ha cambiado desde la última lectura. Se vuelve a leer y se intenta una vez más.
  if (!r.ok && r.status === 409) {
    const leido = await leerPerfil();
    if (!leido.ok) return leido;
    r = await pedir("/api/configuracion", cuerpo(perfilId as string));
  }
  if (!r.ok) {
    const fallo: { ok: false; error: string; campo?: string } = { ok: false, error: r.error };
    if (r.status === 400 && typeof r.datos?.campo === "string") fallo.campo = r.datos.campo;
    return fallo;
  }
  perfilId = perfilDe(r.datos) ?? perfilId;
  avisarCambioDeConfiguracion();
  return { ok: true };
}
