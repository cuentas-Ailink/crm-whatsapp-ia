// Teléfonos e importes con el formato de la región. Puro: lo usan el servidor y el navegador.

// ---- Monedas y países ----

export type Moneda = "EUR" | "USD" | "MXN" | "COP" | "ARS" | "CLP" | "PEN" | "UYU" | "PYG" | "BOB" | "GTQ" | "HNL" | "NIO" | "CRC" | "DOP";
export interface DatosMoneda { locale: string; nombre: string; simbolos: string[]; palabras: string[]; maximo: number; factorEjemplo: number; redondeo: number }

/** `maximo` < 2^31: leads.presupuesto es integer. Los factores solo escalan los importes de ejemplo. */
export const MONEDAS: Record<Moneda, DatosMoneda> = {
  EUR: { locale: "es-ES", nombre: "euros", simbolos: ["€"], palabras: ["euros", "euro", "eur"], maximo: 1_000_000, factorEjemplo: 1, redondeo: 100 },
  USD: { locale: "es-US", nombre: "dólares", simbolos: ["US$", "$"], palabras: ["dólares", "dolares", "usd"], maximo: 1_000_000, factorEjemplo: 1, redondeo: 100 },
  MXN: { locale: "es-MX", nombre: "pesos", simbolos: ["MX$", "$"], palabras: ["pesos", "mxn"], maximo: 20_000_000, factorEjemplo: 20, redondeo: 1_000 },
  COP: { locale: "es-CO", nombre: "pesos", simbolos: ["COP$", "$"], palabras: ["pesos", "cop"], maximo: 2_000_000_000, factorEjemplo: 4_000, redondeo: 100_000 },
  ARS: { locale: "es-AR", nombre: "pesos", simbolos: ["AR$", "$"], palabras: ["pesos", "ars"], maximo: 1_000_000_000, factorEjemplo: 1_000, redondeo: 10_000 },
  CLP: { locale: "es-CL", nombre: "pesos", simbolos: ["CLP$", "$"], palabras: ["pesos", "clp"], maximo: 1_000_000_000, factorEjemplo: 900, redondeo: 10_000 },
  PEN: { locale: "es-PE", nombre: "soles", simbolos: ["S/"], palabras: ["soles", "sol", "pen"], maximo: 4_000_000, factorEjemplo: 4, redondeo: 100 },
  UYU: { locale: "es-UY", nombre: "pesos", simbolos: ["$U", "$"], palabras: ["pesos", "uyu"], maximo: 40_000_000, factorEjemplo: 40, redondeo: 1_000 },
  PYG: { locale: "es-PY", nombre: "guaraníes", simbolos: ["₲", "Gs."], palabras: ["guaraníes", "guaranies", "pyg"], maximo: 2_000_000_000, factorEjemplo: 8_000, redondeo: 100_000 },
  BOB: { locale: "es-BO", nombre: "bolivianos", simbolos: ["Bs."], palabras: ["bolivianos", "bob"], maximo: 7_000_000, factorEjemplo: 7, redondeo: 100 },
  GTQ: { locale: "es-GT", nombre: "quetzales", simbolos: ["Q"], palabras: ["quetzales", "gtq"], maximo: 8_000_000, factorEjemplo: 8, redondeo: 100 },
  HNL: { locale: "es-HN", nombre: "lempiras", simbolos: ["L"], palabras: ["lempiras", "hnl"], maximo: 25_000_000, factorEjemplo: 25, redondeo: 1_000 },
  NIO: { locale: "es-NI", nombre: "córdobas", simbolos: ["C$"], palabras: ["córdobas", "cordobas", "nio"], maximo: 37_000_000, factorEjemplo: 37, redondeo: 1_000 },
  CRC: { locale: "es-CR", nombre: "colones", simbolos: ["₡"], palabras: ["colones", "crc"], maximo: 550_000_000, factorEjemplo: 550, redondeo: 10_000 },
  DOP: { locale: "es-DO", nombre: "pesos", simbolos: ["RD$", "$"], palabras: ["pesos", "dop"], maximo: 60_000_000, factorEjemplo: 60, redondeo: 1_000 },
};

export interface Regional { pais: string; moneda: Moneda; prefijo: string } // "ES", "EUR", "34"
export interface Pais { id: string; nombre: string; zona: string; moneda: Moneda; prefijo: string; digitos: number; movil?: string }

export const PAISES: Pais[] = [
  { id: "ES", nombre: "España (península y Baleares)", zona: "Europe/Madrid", moneda: "EUR", prefijo: "34", digitos: 9 },
  { id: "ES-CN", nombre: "España (Canarias)", zona: "Atlantic/Canary", moneda: "EUR", prefijo: "34", digitos: 9 },
  { id: "MX", nombre: "México", zona: "America/Mexico_City", moneda: "MXN", prefijo: "52", digitos: 10 },
  { id: "CO", nombre: "Colombia", zona: "America/Bogota", moneda: "COP", prefijo: "57", digitos: 10 },
  { id: "AR", nombre: "Argentina", zona: "America/Argentina/Buenos_Aires", moneda: "ARS", prefijo: "54", digitos: 10, movil: "9" },
  { id: "CL", nombre: "Chile", zona: "America/Santiago", moneda: "CLP", prefijo: "56", digitos: 9 },
  { id: "PE", nombre: "Perú", zona: "America/Lima", moneda: "PEN", prefijo: "51", digitos: 9 },
  { id: "EC", nombre: "Ecuador", zona: "America/Guayaquil", moneda: "USD", prefijo: "593", digitos: 9 },
  { id: "US", nombre: "Estados Unidos", zona: "America/New_York", moneda: "USD", prefijo: "1", digitos: 10 },
  { id: "UY", nombre: "Uruguay", zona: "America/Montevideo", moneda: "UYU", prefijo: "598", digitos: 8 },
  { id: "PY", nombre: "Paraguay", zona: "America/Asuncion", moneda: "PYG", prefijo: "595", digitos: 9 },
  { id: "BO", nombre: "Bolivia", zona: "America/La_Paz", moneda: "BOB", prefijo: "591", digitos: 8 },
  { id: "GT", nombre: "Guatemala", zona: "America/Guatemala", moneda: "GTQ", prefijo: "502", digitos: 8 },
  { id: "SV", nombre: "El Salvador", zona: "America/El_Salvador", moneda: "USD", prefijo: "503", digitos: 8 },
  { id: "HN", nombre: "Honduras", zona: "America/Tegucigalpa", moneda: "HNL", prefijo: "504", digitos: 8 },
  { id: "NI", nombre: "Nicaragua", zona: "America/Managua", moneda: "NIO", prefijo: "505", digitos: 8 },
  { id: "CR", nombre: "Costa Rica", zona: "America/Costa_Rica", moneda: "CRC", prefijo: "506", digitos: 8 },
  { id: "PA", nombre: "Panamá", zona: "America/Panama", moneda: "USD", prefijo: "507", digitos: 8 },
  { id: "DO", nombre: "República Dominicana", zona: "America/Santo_Domingo", moneda: "DOP", prefijo: "1", digitos: 10 },
  { id: "PR", nombre: "Puerto Rico", zona: "America/Puerto_Rico", moneda: "USD", prefijo: "1", digitos: 10 },
  { id: "VE", nombre: "Venezuela", zona: "America/Caracas", moneda: "USD", prefijo: "58", digitos: 10 },
  { id: "OTRO", nombre: "Otro", zona: "Europe/Madrid", moneda: "EUR", prefijo: "", digitos: 0 },
];

export const REGIONAL_POR_DEFECTO: Regional = { pais: "ES", moneda: "EUR", prefijo: "34" };

// ---- Teléfono ----

/** Largo del número nacional de cada prefijo (sin el «9» de los móviles de Argentina). */
const LARGO_NACIONAL: Record<string, number> = {
  "34": 9, "52": 10, "57": 10, "54": 10, "56": 9, "51": 9, "593": 9, "1": 10, "598": 8, "595": 9,
  "591": 8, "502": 8, "503": 8, "504": 8, "505": 8, "506": 8, "507": 8, "58": 10,
};

/** Prefijos cuyo número nacional se puede escribir con un «0» delante, que se quita. */
const CERO_TRONCAL: Record<string, boolean> = { "54": true, "593": true, "598": true, "595": true, "58": true };

/** Prefijo de un país que no está en la lista («Otro»): de 1 a 3 cifras sin 0 delante. */
const PREFIJO_LIBRE = /^[1-9]\d{0,2}$/;
const OTRO_MIN = 6;
const OTRO_MAX = 12;

/** El «9» de los móviles, si el prefijo lo lleva. */
function movilDe(prefijo: string): string {
  return PAISES.find((p) => p.prefijo === prefijo && p.movil)?.movil ?? "";
}

/** Los prefijos de la lista, del más largo al más corto. */
const PREFIJOS = [...new Set(PAISES.map((p) => p.prefijo).filter(Boolean))].sort((a, b) => b.length - a.length);

/**
 * Los móviles de México llegan en los avisos de WhatsApp como 521…, con un 1 tras el prefijo,
 * pero la lista de destinatarios de Meta suele guardarlos como 52…. Se usa siempre sin el 1,
 * para que el formulario y los mensajes entrantes acaben en el mismo lead.
 */
export function unificarTelefono(telefono: string): string {
  return /^521\d{10}$/.test(telefono) ? `52${telefono.slice(3)}` : telefono;
}

/**
 * Normaliza a solo dígitos con prefijo. Con «+» o «00», tal cual; sin ellos, el número nacional
 * toma el prefijo del país del negocio (+34 si no se dice): «612 345 678» → 34612345678.
 */
export function normalizarTelefono(entrada: string, prefijo = "34"): string | null {
  const limpio = String(entrada ?? "").trim();
  const digitos = limpio.replace(/\D/g, "");
  if (limpio.startsWith("+")) return digitos.length >= 8 ? unificarTelefono(digitos) : null;
  if (digitos.startsWith("00") && digitos.length >= 10) return unificarTelefono(digitos.slice(2));
  if (prefijo === "34") {
    if (digitos.length === 9) return `34${digitos}`;
    if (digitos.length === 11 && digitos.startsWith("34")) return digitos;
    return null;
  }
  if (!PREFIJO_LIBRE.test(prefijo)) return null;
  const largo = LARGO_NACIONAL[prefijo];
  if (largo === undefined) {
    // Primero el número que ya lleva el prefijo (uno guardado), luego el nacional.
    const resto = digitos.slice(prefijo.length);
    if (digitos.startsWith(prefijo) && resto.length >= OTRO_MIN && resto.length <= OTRO_MAX) return digitos;
    return digitos.length >= OTRO_MIN && digitos.length <= OTRO_MAX ? `${prefijo}${digitos}` : null;
  }
  const movil = movilDe(prefijo);
  const nacional = CERO_TRONCAL[prefijo] && digitos.startsWith("0") ? digitos.slice(1) : digitos;
  if (nacional.length === largo) return `${prefijo}${movil}${nacional}`;
  if (movil && nacional.length === movil.length + largo && nacional.startsWith(movil)) return `${prefijo}${nacional}`;
  if (digitos.startsWith(prefijo) && digitos.length === prefijo.length + movil.length + largo && digitos.slice(prefijo.length).startsWith(movil)) {
    return digitos;
  }
  return null;
}

/** Los grupos del número nacional: 9 → 3-3-3, 10 → 3-3-4, 8 → 4-4, Argentina «9» + 2-4-4, el resto de 3 en 3. */
function patronDe(prefijo: string, nacional: string): number[] {
  const largo = LARGO_NACIONAL[prefijo];
  const movil = movilDe(prefijo);
  if (movil && nacional.startsWith(movil)) return [movil.length, 2, 4, 4];
  if (movil) return [2, 4, 4];
  if (largo === 9) return [3, 3, 3];
  if (largo === 10) return [3, 3, 4];
  if (largo === 8) return [4, 4];
  return [];
}

/** Agrupa los dígitos con el patrón hasta donde llegan; lo que sobra, de 3 en 3. Nunca quita ni pone un dígito. */
function agrupar(digitos: string, patron: number[]): string {
  const grupos: string[] = [];
  let i = 0;
  for (const n of patron) {
    if (i >= digitos.length) break;
    grupos.push(digitos.slice(i, i + n));
    i += n;
  }
  while (i < digitos.length) {
    grupos.push(digitos.slice(i, i + 3));
    i += 3;
  }
  return grupos.join(" ");
}

/** Si el resto, tras el prefijo, tiene el largo de ese país (Argentina: el «9» y 10 cifras). */
function encajaPrefijo(prefijo: string, resto: string): boolean {
  const largo = LARGO_NACIONAL[prefijo];
  if (largo === undefined) return PREFIJO_LIBRE.test(prefijo) && resto.length >= OTRO_MIN && resto.length <= OTRO_MAX;
  const movil = movilDe(prefijo);
  return resto.length === movil.length + largo && resto.startsWith(movil) && /^\d+$/.test(resto);
}

/** El prefijo y el número nacional de un número completo: el del negocio si encaja; si no, el más largo de la lista. */
function partir(n: string, prefijo: string): { prefijo: string; nacional: string } | null {
  if (prefijo && n.startsWith(prefijo) && encajaPrefijo(prefijo, n.slice(prefijo.length))) {
    return { prefijo, nacional: n.slice(prefijo.length) };
  }
  for (const p of PREFIJOS) {
    if (n.startsWith(p) && LARGO_NACIONAL[p] !== undefined && encajaPrefijo(p, n.slice(p.length))) {
      return { prefijo: p, nacional: n.slice(p.length) };
    }
  }
  return null;
}

/** Un número entero (de los pasos 1 y 2 de `formatoTelefono`), o null si se está escribiendo. */
function numeroCompleto(t: string, prefijo: string): { digitos: string; partes: { prefijo: string; nacional: string } | null } | null {
  const n = normalizarTelefono(t, prefijo);
  if (n) return { digitos: n, partes: partir(n, prefijo) };
  const limpio = t.trim();
  const digitos = limpio.replace(/\D/g, "");
  const nacional = LARGO_NACIONAL[prefijo] ?? OTRO_MAX;
  if (!limpio.startsWith("+") && !digitos.startsWith("00") && digitos.length > nacional) {
    return { digitos, partes: partir(digitos, "") };
  }
  return null;
}

/**
 * El número entero, para personas: «+34 612 345 678», «+52 871 123 4567», «+54 9 11 2345 6789».
 * También mientras se escribe: «6123» → «612 3», «+3461» → «+34 61». Nunca lanza, nunca quita ni pone un dígito.
 */
export function formatoTelefono(telefono: string, prefijo = "34"): string {
  const t = String(telefono ?? "");
  const completo = numeroCompleto(t, prefijo);
  if (completo) {
    const { digitos, partes } = completo;
    return partes ? `+${partes.prefijo} ${agrupar(partes.nacional, patronDe(partes.prefijo, partes.nacional))}` : `+${digitos}`;
  }
  // Se está escribiendo.
  const limpio = t.trim();
  const digitos = limpio.replace(/\D/g, "");
  const conMas = limpio.startsWith("+") || digitos.startsWith("00");
  if (conMas) {
    const resto = limpio.startsWith("+") ? digitos : digitos.slice(2);
    if (prefijo && resto.startsWith(prefijo)) {
      const nacional = resto.slice(prefijo.length);
      return nacional ? `+${prefijo} ${agrupar(nacional, patronDe(prefijo, nacional))}` : `+${prefijo}`;
    }
    return `+${resto}`;
  }
  return agrupar(digitos, patronDe(prefijo, digitos));
}

/**
 * Para los registros de la terminal y el nombre de un lead sin nombre de perfil: «+34 6•• ••• •••»,
 * «+52 8•• ••• ••••». Si no se reconoce el país, «+49 •••• 89».
 */
export function enmascararTelefono(telefono: string, prefijo = "34"): string {
  const t = String(telefono ?? "");
  if (t.startsWith("34") && t.length === 11) return `+34 ${t[2]}•• ••• •••`;
  const partes = numeroCompleto(t, prefijo)?.partes;
  if (partes) {
    const oculto = partes.nacional.slice(0, 1) + "•".repeat(Math.max(0, partes.nacional.length - 1));
    return `+${partes.prefijo} ${agrupar(oculto, patronDe(partes.prefijo, partes.nacional))}`;
  }
  return `+${t.slice(0, 2)} •••• ${t.slice(-2)}`;
}

// ---- Importes ----

/** Euros sin decimales, con el formato español: 6.400 €. */
export function euros(cantidad: number): string {
  // useGrouping «always»: en español, sin él 9300 sale sin punto y 34.400 con punto.
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" }).format(cantidad);
}

/** Un importe sin decimales en la moneda del negocio. En euros, igual que `euros`. */
export function formatoImporte(cantidad: number, moneda: Moneda = "EUR"): string {
  if (moneda === "EUR") return euros(cantidad);
  return new Intl.NumberFormat(MONEDAS[moneda].locale, { style: "currency", currency: moneda, maximumFractionDigits: 0, useGrouping: "always" }).format(cantidad);
}

/** «€», «US$», «S/»… */
export function simboloMoneda(moneda: Moneda): string {
  return MONEDAS[moneda].simbolos[0];
}

export function importeMaximo(moneda: Moneda = "EUR"): number {
  return MONEDAS[moneda].maximo;
}
