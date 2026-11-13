// De dónde viene un cliente: los parámetros de la web (utm, gclid, fbclid), el anuncio de clic a
// WhatsApp que manda Meta en el primer mensaje o el mensaje del botón de WhatsApp de la web. Puro: lo
// usan el servidor y el panel.

import type { FuenteLead, Lead, ReferidoMeta } from "./tipos";

const MAX_VALOR = 100;
const MAX_PLATAFORMA = 40;

const PAGADO = new Set(["cpc", "ppc", "paid", "paid_social", "paidsocial", "ads", "ad", "cpm", "display"]);
const DE_META = new Set(["facebook", "fb", "instagram", "ig", "meta"]);
const BUSCADORES = new Set(["google", "bing", "yahoo", "duckduckgo", "ecosia"]);
const REDES = new Set(["facebook", "fb", "instagram", "ig", "tiktok", "linkedin", "x", "twitter", "youtube", "whatsapp"]);
const RECOMENDACION = new Set(["recomendacion", "referido", "boca-oreja"]);

/** Cómo se escribe cada plataforma conocida; las demás, con la primera letra en mayúscula. */
const NOMBRES: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  facebook: "Facebook",
  fb: "Facebook",
  instagram: "Instagram",
  ig: "Instagram",
  meta: "Meta",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};

/** Un parámetro de texto, recortado; vacío o de otro tipo, nada. */
function valor(o: Record<string, unknown>, clave: string): string | undefined {
  const v = o[clave];
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, MAX_VALOR);
  return t || undefined;
}

function nombrePlataforma(source: string): string {
  const nombre = Object.hasOwn(NOMBRES, source) ? NOMBRES[source] : source.charAt(0).toUpperCase() + source.slice(1);
  return nombre.slice(0, MAX_PLATAFORMA);
}

/** La fuente de un alta desde la web, a partir de sus parámetros. Sin ninguno reconocido, ninguna. */
export function fuenteDeUtm(p: unknown): FuenteLead | undefined {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return undefined;
  const o = p as Record<string, unknown>;
  const utmSource = valor(o, "utm_source");
  const utmMedium = valor(o, "utm_medium");
  const campana = valor(o, "utm_campaign");
  const contenido = valor(o, "utm_content");
  const gclid = valor(o, "gclid");
  const fbclid = valor(o, "fbclid");
  if (!utmSource && !utmMedium && !campana && !contenido && !gclid && !fbclid) return undefined;

  const source = utmSource?.toLowerCase() ?? "";
  const medium = utmMedium?.toLowerCase() ?? "";
  const pagado = PAGADO.has(medium);
  const conCampana = (f: FuenteLead): FuenteLead => (campana ? { ...f, campana } : f);
  const conPlataforma = (f: FuenteLead): FuenteLead => (source ? { ...f, plataforma: nombrePlataforma(source) } : f);

  if (gclid) return conCampana({ tipo: "anuncio", plataforma: "Google" });
  if (fbclid || (DE_META.has(source) && (campana || pagado))) return conCampana({ tipo: "anuncio", plataforma: "Meta" });
  if (campana || pagado) return conCampana({ tipo: "anuncio", plataforma: source ? nombrePlataforma(source) : "Otro" });
  if (BUSCADORES.has(source) || medium === "organic") return conPlataforma({ tipo: "buscador" });
  if (REDES.has(source) || medium === "social") return conPlataforma({ tipo: "redes" });
  if (medium === "referral" || RECOMENDACION.has(source)) return { tipo: "recomendacion" };
  return conPlataforma({ tipo: "otro" });
}

/** La fuente de quien escribe desde un anuncio o una publicación de Meta. Sin anuncio, ninguna. */
export function fuenteDeReferido(r?: ReferidoMeta): FuenteLead | undefined {
  if (typeof r !== "object" || r === null) return undefined;
  const titular = typeof r.headline === "string" ? r.headline.trim().slice(0, MAX_VALOR) : "";
  const conTitular = (f: FuenteLead): FuenteLead => (titular ? { ...f, anuncio: titular } : f);
  const tipo = typeof r.source_type === "string" ? r.source_type.trim().toLowerCase() : "";
  if (tipo === "ad") return conTitular({ tipo: "anuncio", plataforma: "Meta" });
  if (tipo === "post") return conTitular({ tipo: "redes", plataforma: "Meta" });
  if (typeof r.ctwa_clid === "string" && r.ctwa_clid) return conTitular({ tipo: "anuncio", plataforma: "Meta" });
  return undefined;
}

/** La fuente de quien escribe con el botón de WhatsApp de la web. */
export const FUENTE_WEB: FuenteLead = Object.freeze({ tipo: "web" }) as FuenteLead;

/** Un texto para comparar: sin mayúsculas, tildes, signos ni emojis, y con un solo espacio entre palabras. */
function paraComparar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Si el primer mensaje es el que escribe solo el botón de la web: el mismo texto, aunque cambien los
 * signos, las mayúsculas o lleve un emoji al final. Un texto con otras palabras es un WhatsApp normal.
 */
export function esMensajeDeLaWeb(texto: string | undefined, mensaje: string): boolean {
  if (typeof texto !== "string" || typeof mensaje !== "string") return false;
  const esperado = paraComparar(mensaje);
  return esperado !== "" && paraComparar(texto) === esperado;
}

/** El cliente empezó a escribir por WhatsApp desde el botón de tu web. */
export function vinoDeLaWeb(lead: Pick<Lead, "origen" | "fuente"> | undefined): boolean {
  return lead?.origen === "whatsapp" && lead.fuente?.tipo === "web";
}

/** «Anuncio de Meta · Otoño», «Google», «Instagram», «Recomendación», «Directo»… Sin fuente, "". */
export function textoFuente(f?: FuenteLead): string {
  if (!f) return "";
  switch (f.tipo) {
    case "anuncio": {
      const detalle = f.campana ?? f.anuncio;
      return `Anuncio${f.plataforma ? ` de ${f.plataforma}` : ""}${detalle ? ` · ${detalle}` : ""}`;
    }
    case "buscador":
      return f.plataforma ?? "Buscador";
    case "redes":
      return f.plataforma ?? "Redes sociales";
    case "recomendacion":
      return "Recomendación";
    case "directo":
      return "Directo";
    case "web":
      return "Tu web, por WhatsApp";
    default:
      return f.plataforma ?? "Otro";
  }
}
