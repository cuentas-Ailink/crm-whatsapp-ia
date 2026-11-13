// El puente del modo prueba visto desde el CRM: lo instala la primera vez, lo arranca y lo para como
// un proceso aparte (scripts/modo-prueba/puente.mjs), le pregunta cómo está y lo desvincula. Solo en
// el servidor y solo en local.
//
// Baileys nunca entra en las dependencias del CRM: se instala en su propia carpeta, con su versión
// exacta, sin ejecutar ningún script de instalación. Los procesos hijos (la instalación y el puente)
// reciben un entorno mínimo: ninguna clave del CRM sale de este proceso.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cambioDeSistema } from "./cambio-sistema";
import { log, logError } from "./log";
import {
  FECHA_PIEZAS,
  VERSION_BAILEYS,
  archivoModoPrueba,
  carpetaHerramienta,
  carpetaSesion,
  leerModoPrueba,
  modoWhatsApp,
  puertoPuente,
} from "./modo-prueba";
import type { EstadoModoPrueba } from "./modo-prueba-reglas";

export type EstadoPuente = EstadoModoPrueba["puente"];
export type Instalador = (carpeta: string) => Promise<void>;

const PARADO: EstadoPuente = { fase: "parado", qr: null, numero: null, error: null };
const CONECTANDO: EstadoPuente = { fase: "conectando", qr: null, numero: null, error: null };
const TIEMPO_INSTALAR_MS = 5 * 60_000;
const TIEMPO_ESTADO_MS = 1_500;
const TIEMPO_DESVINCULAR_MS = 15_000;
const ESPERA_SALIDA_MS = 2_000;
const REINTENTO_ARRANQUE_MS = 2_500;
const ARRANQUE_CORTO_MS = 5_000;
const INSTALACION_FALSA_MS = 1_500;

const SIN_INTERNET = "Sin conexión a internet: la primera vez hace falta para preparar el modo prueba. Vuelve a intentarlo.";
const FALTA_PIEZA = "Falta una pieza de Node.js para preparar el modo prueba. Vuelve a instalar Node.js y prueba otra vez.";
const NO_SE_HA_PODIDO = "No se ha podido preparar el modo prueba. Vuelve a intentarlo en un momento.";

interface Interno {
  hijo: ChildProcess | null;
  ultimo: EstadoPuente;
  instalacion: { fase: EstadoModoPrueba["instalacion"]["fase"]; desde: number | null; error: string | null; promesa: Promise<void> | null };
  instaladoFalso: boolean;
  alSalir: boolean;
}

function interno(): Interno {
  const g = globalThis as unknown as { __puentePrueba?: Interno };
  g.__puentePrueba ??= {
    hijo: null,
    ultimo: { ...PARADO },
    instalacion: { fase: "sin-instalar", desde: null, error: null, promesa: null },
    instaladoFalso: false,
    alSalir: false,
  };
  return g.__puentePrueba;
}

/** El WhatsApp de mentira de las pruebas: solo con el servidor de pruebas (BD_LOCAL) y MODO_PRUEBA_FALSO=1. */
export function conWhatsAppFalso(): boolean {
  return !!process.env.BD_LOCAL?.trim() && process.env.MODO_PRUEBA_FALSO === "1";
}

/** Si Baileys (con libsignal) está instalado en su carpeta, con la versión que toca. */
export function herramientaLista(): boolean {
  if (conWhatsAppFalso()) return interno().instaladoFalso;
  const modulos = path.join(carpetaHerramienta(), "node_modules");
  try {
    const paquete = JSON.parse(readFileSync(path.join(modulos, "baileys", "package.json"), "utf8")) as { version?: unknown };
    return paquete.version === VERSION_BAILEYS && existsSync(path.join(modulos, "libsignal", "package.json"));
  } catch {
    return false;
  }
}

/** Lo justo para que funcionen node y npm: nunca las claves del CRM. */
function entornoMinimo(extra: Record<string, string>): NodeJS.ProcessEnv {
  const entorno: Record<string, string> = {};
  for (const nombre of [
    "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec", "LANG",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS",
  ]) {
    const valor = process.env[nombre];
    if (valor) entorno[nombre] = valor;
  }
  return { ...entorno, ...extra } as unknown as NodeJS.ProcessEnv;
}

/** El npm que viene con este mismo Node.js, para no depender de lo que haya en el PATH. */
function npmDeNode(): string | null {
  const carpeta = path.dirname(process.execPath);
  const candidatos = [path.join(carpeta, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), path.join(carpeta, "node_modules", "npm", "bin", "npm-cli.js")];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

/** Lo que se le pide a npm: solo Baileys, con su versión exacta, y nada que se ejecute al instalar. */
export function argumentosInstalacion(): string[] {
  return [
    "install", `baileys@${VERSION_BAILEYS}`, "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund",
    "--omit=dev", "--legacy-peer-deps", `--before=${FECHA_PIEZAS}`, "--loglevel=error", "--no-update-notifier",
  ];
}

/**
 * La instalación de verdad: Baileys con su versión exacta en su propia carpeta. Sin scripts de
 * instalación (--ignore-scripts), sin las piezas opcionales (--legacy-peer-deps) y con las piezas
 * que trae publicadas antes de FECHA_PIEZAS. npm porque viene con Node.js y la carpeta va aparte del CRM.
 */
export const instalarConNpm: Instalador = async (carpeta) => {
  const npm = npmDeNode();
  if (!npm) throw new Error(FALTA_PIEZA);
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(
    path.join(carpeta, "package.json"),
    JSON.stringify({ name: "crm-modo-prueba", private: true, description: "Solo para el modo prueba del CRM: Baileys (MIT) y libsignal (GPL-3.0), instalados aparte." }, null, 2),
  );
  await new Promise<void>((resolver, rechazar) => {
    const hijo = spawn(process.execPath, [npm, ...argumentosInstalacion()], { cwd: carpeta, env: entornoMinimo({}), stdio: ["ignore", "ignore", "pipe"] });
    let errores = "";
    hijo.stderr?.on("data", (trozo: Buffer) => {
      errores = (errores + trozo.toString()).slice(-2_000);
    });
    const reloj = setTimeout(() => hijo.kill("SIGKILL"), TIEMPO_INSTALAR_MS);
    hijo.on("error", () => {
      clearTimeout(reloj);
      rechazar(new Error(FALTA_PIEZA));
    });
    hijo.on("exit", (codigo) => {
      clearTimeout(reloj);
      if (codigo === 0) resolver();
      else rechazar(new Error(/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|network/i.test(errores) ? SIN_INTERNET : NO_SE_HA_PODIDO));
    });
  });
};

/** Cómo va la instalación, con los segundos que lleva. */
export function estadoInstalacion(): EstadoModoPrueba["instalacion"] {
  const i = interno().instalacion;
  const fase = i.promesa ? "instalando" : herramientaLista() ? "preparada" : i.fase === "error" ? "error" : "sin-instalar";
  return { fase, segundos: i.desde !== null ? Math.floor((Date.now() - i.desde) / 1000) : null, error: fase === "error" ? i.error : null };
}

/**
 * Deja el modo prueba listo: instala Baileys si hace falta (en segundo plano) y arranca el puente.
 * Volver a llamarlo mientras instala no hace nada. Con el WhatsApp de mentira no se instala nada.
 */
export function prepararModoPrueba(o: { instalador?: Instalador; arrancar?: () => Promise<void> } = {}): void {
  const i = interno();
  const arrancar = o.arrancar ?? arrancarPuente;
  if (i.instalacion.promesa) return;
  if (herramientaLista()) {
    i.instalacion.fase = "preparada";
    void arrancar().catch((error) => logError("al arrancar el modo prueba", error));
    return;
  }
  const instalar: Instalador = conWhatsAppFalso()
    ? async () => {
        await new Promise((resolver) => setTimeout(resolver, INSTALACION_FALSA_MS));
        i.instaladoFalso = true;
      }
    : (o.instalador ?? instalarConNpm);
  i.instalacion = { fase: "instalando", desde: Date.now(), error: null, promesa: null };
  log("Preparando el modo prueba: solo la primera vez");
  i.instalacion.promesa = instalar(carpetaHerramienta())
    .then(async () => {
      if (!herramientaLista()) throw new Error(NO_SE_HA_PODIDO);
      i.instalacion.fase = "preparada";
      log("Modo prueba preparado");
      await arrancar();
    })
    .catch((error: unknown) => {
      i.instalacion.fase = "error";
      i.instalacion.error = error instanceof Error && [SIN_INTERNET, FALTA_PIEZA, NO_SE_HA_PODIDO].includes(error.message) ? error.message : NO_SE_HA_PODIDO;
      logError("al preparar el modo prueba", error);
    })
    .finally(() => {
      i.instalacion.promesa = null;
      i.instalacion.desde = null;
    });
}

/** Para las pruebas: espera a que acabe la preparación en curso. */
export async function esperarPreparacion(): Promise<void> {
  await interno().instalacion.promesa;
}

// ---- El proceso del puente ----

function pedirPuente(ruta: string, metodo: "GET" | "POST", ms: number): Promise<Response> {
  const secreto = leerModoPrueba()?.secreto ?? "";
  return fetch(`http://127.0.0.1:${puertoPuente()}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${secreto}` },
    signal: AbortSignal.timeout(ms),
  });
}

const vivo = (hijo: ChildProcess | null): hijo is ChildProcess => !!hijo && hijo.exitCode === null && hijo.signalCode === null;

function esperarSalida(hijo: ChildProcess, ms: number): Promise<boolean> {
  if (!vivo(hijo)) return Promise.resolve(true);
  return new Promise((resolver) => {
    const reloj = setTimeout(() => resolver(false), ms);
    hijo.once("exit", () => {
      clearTimeout(reloj);
      resolver(true);
    });
  });
}

/** Arranca el puente si el modo prueba está elegido y preparado. Si ya está en marcha, no hace nada. */
export async function arrancarPuente(reintento = false): Promise<void> {
  const i = interno();
  if (modoWhatsApp() !== "prueba" || !herramientaLista() || vivo(i.hijo)) return;
  // Uno que se quedó de antes (un CRM cerrado de golpe) se para: el puerto tiene que ser de este.
  await pedirPuente("/parar", "POST", 1_000).catch(() => null);
  const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "modo-prueba", "puente.mjs");
  const entorno = entornoMinimo({
    PUERTO_PUENTE: String(puertoPuente()),
    URL_WEBHOOK_MODO_PRUEBA: `http://127.0.0.1:${process.env.PUERTO || "8000"}/webhook`,
    ARCHIVO_MODO_PRUEBA: archivoModoPrueba(),
    DIR_SESION_MODO_PRUEBA: carpetaSesion(),
    DIR_HERRAMIENTA_MODO_PRUEBA: carpetaHerramienta(),
    PID_APP: String(process.pid),
    ...(conWhatsAppFalso() ? { MODO_PRUEBA_FALSO: "1" } : {}),
  });
  mkdirSync(carpetaSesion(), { recursive: true, mode: 0o700 });
  const hijo = spawn(process.execPath, [script], { env: entorno, stdio: ["ignore", "inherit", "inherit"] });
  const inicio = Date.now();
  i.hijo = hijo;
  i.ultimo = { ...CONECTANDO };
  hijo.on("exit", (codigo) => {
    if (i.hijo !== hijo) return;
    i.hijo = null;
    i.ultimo = { ...PARADO };
    // Si sale nada más arrancar (el puerto aún era del de antes), se prueba una vez más.
    if (codigo !== 0 && !reintento && Date.now() - inicio < ARRANQUE_CORTO_MS) {
      setTimeout(() => void arrancarPuente(true).catch(() => undefined), REINTENTO_ARRANQUE_MS).unref?.();
    }
  });
  if (!i.alSalir) {
    i.alSalir = true;
    // Al cerrarse el CRM se cierra el puente (y si el CRM se cierra de golpe, el puente lo nota solo).
    process.once("exit", () => {
      if (vivo(interno().hijo)) interno().hijo?.kill("SIGTERM");
    });
  }
}

/** Cómo está el puente ahora mismo (le pregunta; si no contesta, lo último que se sabe). */
export async function consultarPuente(): Promise<EstadoPuente> {
  const antes = interno().ultimo;
  const ahora = await preguntarPuente();
  // El móvil se acaba de vincular o desvincular: el panel vuelve a mirar las conexiones al momento.
  if ((antes.fase === "conectado") !== (ahora.fase === "conectado") || (ahora.fase === "conectado" && antes.numero !== ahora.numero)) cambioDeSistema();
  return ahora;
}

async function preguntarPuente(): Promise<EstadoPuente> {
  const i = interno();
  if (modoWhatsApp() !== "prueba") return (i.ultimo = { ...PARADO });
  try {
    const r = await pedirPuente("/estado", "GET", TIEMPO_ESTADO_MS);
    const datos = (await r.json().catch(() => null)) as Partial<EstadoPuente> | null;
    if (r.ok && datos) {
      const fases: EstadoPuente["fase"][] = ["parado", "conectando", "qr", "conectado", "error"];
      i.ultimo = {
        fase: fases.includes(datos.fase as EstadoPuente["fase"]) ? (datos.fase as EstadoPuente["fase"]) : "conectando",
        qr: typeof datos.qr === "string" ? datos.qr.slice(0, 1_000) : null,
        numero: typeof datos.numero === "string" && /^\d{6,15}$/.test(datos.numero) ? datos.numero : null,
        error: typeof datos.error === "string" ? datos.error.slice(0, 200) : null,
      };
      return { ...i.ultimo };
    }
  } catch {
    // No contesta: lo de abajo.
  }
  i.ultimo = vivo(i.hijo) ? { ...CONECTANDO } : { ...PARADO };
  return { ...i.ultimo };
}

/** Lo último que se sabe del puente, sin preguntar (para lo que no puede esperar). */
export function ultimoEstadoPuente(): EstadoPuente {
  return { ...interno().ultimo };
}

/** Para el puente sin cerrar la sesión (al pasar a la vía oficial se desvincula antes). */
export async function pararPuente(): Promise<void> {
  const i = interno();
  const hijo = i.hijo;
  await pedirPuente("/parar", "POST", 1_500).catch(() => null);
  if (vivo(hijo)) {
    if (!(await esperarSalida(hijo, ESPERA_SALIDA_MS))) {
      hijo.kill("SIGTERM");
      if (!(await esperarSalida(hijo, ESPERA_SALIDA_MS))) hijo.kill("SIGKILL");
    }
  }
  if (i.hijo === hijo) i.hijo = null;
  i.ultimo = { ...PARADO };
}

/** «Desvincular»: cierra la sesión en WhatsApp (sale de los dispositivos del móvil), para el puente y borra la sesión. */
export async function desvincularPuente(): Promise<void> {
  if (vivo(interno().hijo)) await pedirPuente("/desvincular", "POST", TIEMPO_DESVINCULAR_MS).catch(() => null);
  await pararPuente();
  rmSync(carpetaSesion(), { recursive: true, force: true });
}
