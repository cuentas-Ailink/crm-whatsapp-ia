// La contraseña del panel en modo servidor: su hash, la cookie de sesión firmada, el límite de
// intentos y el código de alta de un solo uso. Solo en el servidor (node:crypto). Ningún valor de
// aquí (contraseña, hash, secreto o código) sale nunca en una respuesta ni en el registro (I16).

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const COOKIE = "crm_sesion";
const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
const TREINTA_DIAS_S = TREINTA_DIAS_MS / 1000;
const DIEZ_MINUTOS_MS = 10 * 60 * 1000;
const INTENTOS_POR_VENTANA = 5;

// scrypt: N = 2^15, r = 8, p = 1, sal de 16 bytes y 64 de resultado.
const LOG_N = 15;
const R = 8;
const P = 1;
const LARGO_SAL = 16;
const LARGO_HASH = 64;

/** La regla de la contraseña del panel: la usan la ruta y la página de entrar. */
export const REGLA_CLAVE_PANEL = {
  minimo: 10,
  maximo: 200,
  corta: "La contraseña necesita al menos 10 caracteres",
  larga: "La contraseña puede tener como mucho 200 caracteres",
} as const;

/** El texto del error si la contraseña no cumple la regla; si la cumple, null. */
export function errorDeClavePanel(clave: unknown): string | null {
  if (typeof clave !== "string") return REGLA_CLAVE_PANEL.corta;
  const largo = Array.from(clave).length;
  if (largo < REGLA_CLAVE_PANEL.minimo) return REGLA_CLAVE_PANEL.corta;
  if (largo > REGLA_CLAVE_PANEL.maximo) return REGLA_CLAVE_PANEL.larga;
  return null;
}

/** Un valor del entorno en el momento de la llamada (nunca al cargar el módulo). Vacío = no está. */
function entorno(nombre: "SESION_SECRETO" | "CLAVE_PANEL_HASH" | "CODIGO_ALTA"): string | null {
  const valor = process.env[nombre];
  return valor ? valor : null;
}

function derivar(clave: string, sal: Buffer, logN: number, r: number, p: number, largo: number): Promise<Buffer> {
  const N = 2 ** logN;
  // Con el maxmem por defecto (32 MiB) estos parámetros no caben: se da el doble de lo que piden.
  const opciones: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolver, rechazar) => {
    scrypt(clave.normalize("NFC"), sal, largo, opciones, (error, clave) => (error ? rechazar(error) : resolver(clave)));
  });
}

/** scrypt$15$8$1$<sal>$<hash>, sal y hash en base64url. */
export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(LARGO_SAL);
  const hash = await derivar(clave, sal, LOG_N, R, P, LARGO_HASH);
  return `scrypt$${LOG_N}$${R}$${P}$${sal.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Si la contraseña es la del hash, con los parámetros que lleve el propio hash. Nunca lanza. */
export async function comprobarClave(clave: string, hash: string): Promise<boolean> {
  try {
    if (typeof clave !== "string" || typeof hash !== "string") return false;
    const partes = hash.split("$");
    if (partes.length !== 6 || partes[0] !== "scrypt") return false;
    const [logN, r, p] = partes.slice(1, 4).map((n) => (/^\d{1,2}$/.test(n) ? Number(n) : NaN));
    if (!(logN >= 1 && logN <= 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) return false;
    const sal = Buffer.from(partes[4], "base64url");
    const esperado = Buffer.from(partes[5], "base64url");
    if (sal.length < 8 || esperado.length < 16 || esperado.length > 128) return false;
    const calculado = await derivar(clave, sal, logN, r, p, esperado.length);
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

/** La huella de la contraseña actual que lleva la cookie: cambiarla invalida todas las cookies. */
function huella(hash: string): string {
  return createHash("sha256").update(hash).digest("hex").slice(0, 16);
}

function firma(payload: string, secreto: string): Buffer {
  return createHmac("sha256", secreto).update(payload).digest();
}

/** El valor de la cookie: {v, exp} en base64url, un punto y su HMAC-SHA256 con SESION_SECRETO. */
export function firmarSesion(ahora: number): string {
  const secreto = entorno("SESION_SECRETO");
  const hash = entorno("CLAVE_PANEL_HASH");
  if (!secreto || !hash) throw new Error("Falta el secreto de la sesión o la contraseña del panel");
  const payload = Buffer.from(JSON.stringify({ v: huella(hash), exp: ahora + TREINTA_DIAS_MS })).toString("base64url");
  return `${payload}.${firma(payload, secreto).toString("base64url")}`;
}

/** Si la cookie la ha firmado este servidor, no ha caducado y es de la contraseña actual. */
export function verificarCookie(valor: string | null, ahora: number): boolean {
  try {
    if (!valor) return false;
    const secreto = entorno("SESION_SECRETO");
    const hash = entorno("CLAVE_PANEL_HASH");
    if (!secreto || !hash) return false;
    const partes = valor.split(".");
    if (partes.length !== 2 || !partes[0] || !partes[1]) return false;
    const [payload, recibida] = partes;
    const esperada = firma(payload, secreto);
    const dada = Buffer.from(recibida, "base64url");
    if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return false;
    const datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; exp?: unknown };
    if (typeof datos?.exp !== "number" || !Number.isFinite(datos.exp) || datos.exp <= ahora) return false;
    return datos.v === huella(hash);
  } catch {
    return false;
  }
}

export function cabeceraCookie(valor: string): string {
  return `${COOKIE}=${valor}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TREINTA_DIAS_S}`;
}

export function cookieCaducada(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// ─── Límite de intentos ───────────────────────────────────────────────────────────────────────────

/** Los intentos de cada IP en los últimos 10 minutos. En globalThis: sobrevive a la recarga de Next. */
function intentos(): Map<string, number[]> {
  const g = globalThis as unknown as { __crmIntentosEntrada?: Map<string, number[]> };
  g.__crmIntentosEntrada ??= new Map();
  return g.__crmIntentosEntrada;
}

/** Apunta un intento: como mucho 5 por IP en cualquier ventana de 10 minutos. */
export function intentoLogin(ip: string, ahora: number): { permitido: boolean } {
  const mapa = intentos();
  for (const [clave, lista] of mapa) {
    const vivos = lista.filter((ts) => ahora - ts < DIEZ_MINUTOS_MS);
    if (vivos.length === 0) mapa.delete(clave);
    else if (vivos.length !== lista.length) mapa.set(clave, vivos);
  }
  const lista = mapa.get(ip) ?? [];
  if (lista.length >= INTENTOS_POR_VENTANA) return { permitido: false };
  lista.push(ahora);
  mapa.set(ip, lista);
  return { permitido: true };
}

/** Tras entrar bien, los fallos de antes no cuentan: el dueño nunca se queda fuera por sus erratas. */
export function olvidarIntentos(ip: string): void {
  intentos().delete(ip);
}

// ─── Código de alta ───────────────────────────────────────────────────────────────────────────────

/** Como se teclea a mano: sin espacios ni guiones y en mayúsculas. */
function normalizarCodigo(codigo: string): string {
  return codigo.trim().replace(/[\s-]+/g, "").toUpperCase();
}

/** Si es el código de alta de un solo uso. Sin CODIGO_ALTA, ninguno vale. */
export function codigoAltaValido(codigo: string): boolean {
  const guardado = entorno("CODIGO_ALTA");
  if (!guardado || typeof codigo !== "string") return false;
  const dado = normalizarCodigo(codigo);
  if (!dado) return false;
  const a = createHash("sha256").update(dado).digest();
  const b = createHash("sha256").update(normalizarCodigo(guardado)).digest();
  return timingSafeEqual(a, b);
}

/** Sin SESION_SECRETO, lo genera y lo guarda en el archivo de claves. Si no se puede guardar, lanza. */
export async function asegurarSecreto(): Promise<void> {
  if (entorno("SESION_SECRETO")) return;
  // Import perezoso: proxy.ts importa este módulo y no debe arrastrar el que escribe archivos.
  const { guardarClave } = await import("./claves");
  const r = await guardarClave("SESION_SECRETO", randomBytes(32).toString("base64url"));
  if (!r.ok) throw new Error("No se ha podido guardar el secreto de la sesión");
}
