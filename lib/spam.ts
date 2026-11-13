// La regla de spam la aplica el código antes de llamar al modelo: no cuesta nada y no depende de
// lo que el modelo opine. Lo que se le escape (una agencia que ofrece sus servicios sin enlaces,
// por ejemplo) lo marca el modelo con la herramienta marcar_spam. Es puro: no toca ni disco ni red.

/** Mismo texto desde tantos números distintos en una hora: es un envío masivo. */
export const NUMEROS_PARA_MASIVO = 3;
/** Tantos mensajes de un número en un minuto: es una ráfaga, no una persona escribiendo. */
export const MENSAJES_PARA_RAFAGA = 8;
/** Puntos a partir de los que un mensaje es spam. */
export const UMBRAL = 3;

// Corto, dos clientes pueden escribir lo mismo («Hola, ¿sigue disponible?»). Largo e idéntico, no.
const MINIMO_CARACTERES_MASIVO = 40;
const MINUTO = 60_000;

// Enlaces que manda un cliente normal de una inmobiliaria o un estudio de reformas.
const DOMINIOS_NORMALES = [
  "idealista.com",
  "fotocasa.es",
  "habitaclia.com",
  "pisos.com",
  "yaencontre.com",
  "milanuncios.com",
  "google.com",
  "google.es",
  "maps.app.goo.gl",
  "maps.apple.com",
  "sedecatastro.gob.es",
  "pinterest.com",
  "pinterest.es",
  "houzz.es",
  "instagram.com",
];

// Acortadores e invitaciones: esconden adónde llevan o sacan la conversación de aquí.
const DOMINIOS_RAROS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "cutt.ly",
  "is.gd",
  "ow.ly",
  "rebrand.ly",
  "shorturl.at",
  "rb.gy",
  "tiny.cc",
  "s.id",
  "t.me",
  "telegram.me",
  "chat.whatsapp.com",
  "wa.me",
  "discord.gg",
];
const TLD_RAROS = /\.(xyz|top|click|loan|win|bid|icu|buzz|rest|monster|cfd|sbs|cyou|quest|zip|mov)$/;

// Ganchos típicos de publicidad y estafas. Frases concretas: «oferta» o «gratis» sueltas
// también las escribe un cliente normal.
export const GANCHOS = [
  "gana dinero",
  "ganar dinero",
  "ingresos extra",
  "ingresos pasivos",
  "desde casa",
  "inversion garantizada",
  "rentabilidad garantizada",
  "beneficios garantizados",
  "cripto",
  "bitcoin",
  "forex",
  "trading",
  "has ganado",
  "has sido seleccionad",
  "premio",
  "sorteo",
  "haz clic",
  "haz click",
  "click aqui",
  "clic aqui",
  "pincha aqui",
  "pulsa aqui",
  "oferta exclusiva",
  "oferta limitada",
  "tiempo limitado",
  "solo hoy",
  "descuento exclusivo",
  "compra ahora",
  "seguidores",
  "posicionamiento web",
  "seo",
  "diseno web",
  "pagina web",
  "marketing digital",
  "leads cualificados",
  "prestamo rapido",
  "credito rapido",
  "casino",
  "apuestas",
  "unete al grupo",
  "unete a nuestro",
  "contesta si",
  "responde si",
];
// «30 % de descuento», «hasta un 50% dto.»: así escriben los anuncios, no los clientes.
const PORCENTAJE_DE_DESCUENTO = /\d+\s*%\s*(de\s+)?(descuento|dto)/;

export function normalizarTexto(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

function dominios(texto: string): string[] {
  const encontrados: string[] = [];
  const enlace = /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(\/\S*)?/gi;
  for (const m of texto.matchAll(enlace)) {
    const conEsquema = /^(https?:\/\/|www\.)/i.test(m[0]);
    // «P-101.Precio» o «Sra.García» no son enlaces: o lleva esquema, o ruta, o es un dominio conocido.
    const dominio = m[1].toLowerCase();
    if (conEsquema || m[2] || DOMINIOS_RAROS.includes(dominio) || /\.(com|es|net|org|io|me|ly|gl)$/.test(dominio)) {
      encontrados.push(dominio);
    }
  }
  return encontrados;
}

const esDe = (dominio: string, lista: string[]) => lista.some((d) => dominio === d || dominio.endsWith(`.${d}`));

export interface EntradaSpam {
  /** Los mensajes de este lote. */
  textos: string[];
  /** Mensajes de clientes de la última hora, de todos los números, este lote incluido. */
  recientes: { telefono: string; texto: string; ts: number }[];
  telefono: string;
  ahora: number;
}

export interface Spam {
  motivo: string;
  /** En un envío masivo, los demás números que mandaron el mismo texto: también son spam. */
  otros: string[];
}

/**
 * Devuelve el motivo si es spam, o null. Gana la primera regla que se cumple:
 * 1. Masivo: el mismo texto (40 caracteres o más) ha llegado desde 3 números distintos en una hora.
 * 2. Ráfaga: 8 mensajes o más del mismo número en un minuto, o el mismo texto 3 veces seguidas.
 * 3. Puntos, 3 o más: enlace acortado, de invitación o de dominio raro (2), enlace a un dominio
 *    desconocido (1), un gancho publicitario (2) o dos o más (3).
 */
/** Un gancho está en el texto ya normalizado. Las palabras cortas, enteras: «seo» no salta con «deseo» ni con «seora». */
function tieneGancho(normal: string, gancho: string): boolean {
  return new RegExp(`\\b${gancho}${gancho.length <= 4 ? "\\b" : ""}`).test(normal);
}

/** Los ganchos publicitarios de la lista que aparecen en el texto, con la misma regla que detectarSpam. */
export function ganchosEn(texto: string): string[] {
  const normal = normalizarTexto(texto);
  return GANCHOS.filter((g) => tieneGancho(normal, g));
}

/** Un dominio de la configuración tal como se compara: en minúsculas, sin esquema, «www.» ni ruta. */
function limpiarDominio(d: unknown): string {
  if (typeof d !== "string") return "";
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
}

/**
 * Las opciones vienen de la configuración del negocio: `dominiosNormales` (enlaces que mandan sus
 * clientes, como doctoralia.es) no cuentan como raros ni como desconocidos, y `ganchosQuitados` salen
 * de la lista de ganchos. Solo se comparan como texto: nunca entran en una expresión regular.
 */
export function detectarSpam(e: EntradaSpam, o?: { dominiosNormales?: string[]; ganchosQuitados?: string[] }): Spam | null {
  const spam = (motivo: string, otros: string[] = []): Spam => ({ motivo, otros });
  const delNegocio = (Array.isArray(o?.dominiosNormales) ? o.dominiosNormales : []).map(limpiarDominio).filter(Boolean);
  const quitados = new Set((Array.isArray(o?.ganchosQuitados) ? o.ganchosQuitados : []).filter((g) => typeof g === "string").map(normalizarTexto));
  const ganchosActivos = quitados.size ? GANCHOS.filter((g) => !quitados.has(g)) : GANCHOS;
  const propios = e.recientes.filter((m) => m.telefono === e.telefono);

  for (const texto of e.textos) {
    const normal = normalizarTexto(texto);
    if (normal.length < MINIMO_CARACTERES_MASIVO) continue;
    const numeros = new Set(e.recientes.filter((m) => normalizarTexto(m.texto) === normal).map((m) => m.telefono));
    if (numeros.size >= NUMEROS_PARA_MASIVO) {
      return spam(`Mensaje masivo: el mismo texto ha llegado desde ${numeros.size} números`, [...numeros].filter((t) => t !== e.telefono));
    }
  }

  const ultimoMinuto = propios.filter((m) => e.ahora - m.ts <= MINUTO).length;
  if (ultimoMinuto >= MENSAJES_PARA_RAFAGA) return spam(`Ráfaga: ${ultimoMinuto} mensajes en un minuto`);
  const ultimos = propios.slice(-3).map((m) => normalizarTexto(m.texto));
  if (ultimos.length === 3 && ultimos.every((t) => t === ultimos[0] && t.length > 0)) return spam("El mismo mensaje tres veces seguidas");

  const todo = e.textos.join(" ");
  const normal = normalizarTexto(todo);
  const motivos: string[] = [];
  let puntos = 0;

  const enlaces = dominios(todo).filter((d) => !esDe(d, delNegocio));
  const raro = enlaces.find((d) => esDe(d, DOMINIOS_RAROS) || TLD_RAROS.test(d) || /^\d+(\.\d+){3}$/.test(d));
  const desconocido = enlaces.find((d) => !esDe(d, DOMINIOS_NORMALES) && d !== raro);
  if (raro) {
    puntos += 2;
    motivos.push(`enlace raro (${raro})`);
  } else if (desconocido) {
    puntos += 1;
    motivos.push(`enlace a ${desconocido}`);
  }

  // Las palabras cortas, enteras: «seo» no debe saltar con «deseo» ni con «seora».
  const ganchos = ganchosActivos.filter((g) => tieneGancho(normal, g));
  if (PORCENTAJE_DE_DESCUENTO.test(normal)) ganchos.push("% de descuento");
  if (ganchos.length > 0) {
    puntos += ganchos.length >= 2 ? 3 : 2;
    motivos.push(`publicidad («${ganchos.slice(0, 2).join("», «")}»)`);
  }

  if (puntos >= UMBRAL) return spam(motivos.join(" y ").replace(/^./, (c) => c.toUpperCase()));
  return null;
}
