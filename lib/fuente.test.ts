import { describe, expect, it } from "vitest";
import { esMensajeDeLaWeb, fuenteDeReferido, fuenteDeUtm, textoFuente, vinoDeLaWeb } from "./fuente";

describe("fuenteDeUtm: una fila de la tabla por prueba", () => {
  it("sin ningún parámetro reconocido, o sin objeto: ninguna fuente", () => {
    expect(fuenteDeUtm({})).toBeUndefined();
    expect(fuenteDeUtm({ otra: "cosa", utm_source: "" })).toBeUndefined();
    expect(fuenteDeUtm(null)).toBeUndefined();
    expect(fuenteDeUtm("utm_source=google")).toBeUndefined();
    expect(fuenteDeUtm(["google"])).toBeUndefined();
    expect(fuenteDeUtm({ utm_source: 42 })).toBeUndefined();
  });

  it("con gclid: anuncio de Google con la campaña", () => {
    expect(fuenteDeUtm({ gclid: "abc", utm_campaign: "reformas-otoño" })).toEqual({ tipo: "anuncio", plataforma: "Google", campana: "reformas-otoño" });
    expect(fuenteDeUtm({ gclid: "abc", utm_source: "facebook" })).toEqual({ tipo: "anuncio", plataforma: "Google" });
  });

  it("con fbclid, o de Meta con campaña o medio de pago: anuncio de Meta", () => {
    expect(fuenteDeUtm({ fbclid: "x", utm_campaign: "baños" })).toEqual({ tipo: "anuncio", plataforma: "Meta", campana: "baños" });
    expect(fuenteDeUtm({ utm_source: "IG", utm_medium: "paid_social" })).toEqual({ tipo: "anuncio", plataforma: "Meta" });
    expect(fuenteDeUtm({ utm_source: "meta", utm_medium: "cpm" })).toEqual({ tipo: "anuncio", plataforma: "Meta" });
  });

  it("con campaña o medio de pago y otra fuente: anuncio de esa plataforma, o «Otro»", () => {
    expect(fuenteDeUtm({ utm_source: "Tiktok", utm_campaign: "verano" })).toEqual({ tipo: "anuncio", plataforma: "TikTok", campana: "verano" });
    expect(fuenteDeUtm({ utm_source: "linkedin", utm_medium: "cpc" })).toEqual({ tipo: "anuncio", plataforma: "LinkedIn" });
    expect(fuenteDeUtm({ utm_source: "google", utm_medium: "cpc" })).toEqual({ tipo: "anuncio", plataforma: "Google" });
    expect(fuenteDeUtm({ utm_source: "bing", utm_campaign: "x" })).toEqual({ tipo: "anuncio", plataforma: "Bing", campana: "x" });
    expect(fuenteDeUtm({ utm_campaign: "sin-fuente" })).toEqual({ tipo: "anuncio", plataforma: "Otro", campana: "sin-fuente" });
    expect(fuenteDeUtm({ utm_source: "periodico", utm_medium: "display" })).toEqual({ tipo: "anuncio", plataforma: "Periodico" });
  });

  it("buscadores, o medio orgánico: buscador", () => {
    expect(fuenteDeUtm({ utm_source: "bing" })).toEqual({ tipo: "buscador", plataforma: "Bing" });
    expect(fuenteDeUtm({ utm_source: "duckduckgo" })).toEqual({ tipo: "buscador", plataforma: "DuckDuckGo" });
    expect(fuenteDeUtm({ utm_source: "ecosia", utm_medium: "organic" })).toEqual({ tipo: "buscador", plataforma: "Ecosia" });
    expect(fuenteDeUtm({ utm_source: "qwant", utm_medium: "organic" })).toEqual({ tipo: "buscador", plataforma: "Qwant" });
  });

  it("redes, o medio social: redes", () => {
    expect(fuenteDeUtm({ utm_source: "fb" })).toEqual({ tipo: "redes", plataforma: "Facebook" });
    expect(fuenteDeUtm({ utm_source: "tiktok" })).toEqual({ tipo: "redes", plataforma: "TikTok" });
    expect(fuenteDeUtm({ utm_source: "linkedin" })).toEqual({ tipo: "redes", plataforma: "LinkedIn" });
    expect(fuenteDeUtm({ utm_source: "twitter" })).toEqual({ tipo: "redes", plataforma: "X" });
    expect(fuenteDeUtm({ utm_source: "x" })).toEqual({ tipo: "redes", plataforma: "X" });
    expect(fuenteDeUtm({ utm_source: "youtube" })).toEqual({ tipo: "redes", plataforma: "YouTube" });
    expect(fuenteDeUtm({ utm_source: "whatsapp" })).toEqual({ tipo: "redes", plataforma: "WhatsApp" });
    expect(fuenteDeUtm({ utm_source: "pinterest", utm_medium: "social" })).toEqual({ tipo: "redes", plataforma: "Pinterest" });
  });

  it("medio referral o fuente de recomendación: recomendación", () => {
    expect(fuenteDeUtm({ utm_medium: "referral", utm_source: "blog-amigo" })).toEqual({ tipo: "recomendacion" });
    expect(fuenteDeUtm({ utm_source: "boca-oreja" })).toEqual({ tipo: "recomendacion" });
    expect(fuenteDeUtm({ utm_source: "referido" })).toEqual({ tipo: "recomendacion" });
    expect(fuenteDeUtm({ utm_source: "recomendacion" })).toEqual({ tipo: "recomendacion" });
  });

  it("cualquier otra fuente: otro, con su nombre", () => {
    expect(fuenteDeUtm({ utm_source: "newsletter" })).toEqual({ tipo: "otro", plataforma: "Newsletter" });
    expect(fuenteDeUtm({ utm_source: "  Folleto  " })).toEqual({ tipo: "otro", plataforma: "Folleto" });
  });
});

describe("fuenteDeUtm: los ejemplos", () => {
  it("los cinco ejemplos de la tabla", () => {
    expect(fuenteDeUtm({ utm_source: "facebook", utm_campaign: "otoño" })).toEqual({ tipo: "anuncio", plataforma: "Meta", campana: "otoño" });
    expect(fuenteDeUtm({ utm_source: "google", utm_medium: "organic" })).toEqual({ tipo: "buscador", plataforma: "Google" });
    expect(fuenteDeUtm({ utm_source: "instagram" })).toEqual({ tipo: "redes", plataforma: "Instagram" });
    expect(fuenteDeUtm({ fbclid: "x" })).toEqual({ tipo: "anuncio", plataforma: "Meta" });
    expect(fuenteDeUtm({})).toBeUndefined();
  });

  it("recorta los valores a 100 y la plataforma a 40", () => {
    const largo = "a".repeat(150);
    expect(fuenteDeUtm({ gclid: "x", utm_campaign: largo })?.campana).toHaveLength(100);
    const plataforma = fuenteDeUtm({ utm_source: "b".repeat(150) })?.plataforma;
    expect(plataforma).toHaveLength(40);
    expect(plataforma?.startsWith("B")).toBe(true);
  });
});

describe("fuenteDeReferido", () => {
  it("un anuncio, una publicación o un clic de anuncio sin tipo", () => {
    expect(fuenteDeReferido({ source_type: "ad", headline: "Reforma tu baño en 10 días", ctwa_clid: "c" })).toEqual({
      tipo: "anuncio",
      plataforma: "Meta",
      anuncio: "Reforma tu baño en 10 días",
    });
    expect(fuenteDeReferido({ source_type: "post", headline: "Nuestro último proyecto" })).toEqual({ tipo: "redes", plataforma: "Meta", anuncio: "Nuestro último proyecto" });
    expect(fuenteDeReferido({ ctwa_clid: "c" })).toEqual({ tipo: "anuncio", plataforma: "Meta" });
    expect(fuenteDeReferido({ source_type: "otro", ctwa_clid: "c", headline: "Titular" })).toEqual({ tipo: "anuncio", plataforma: "Meta", anuncio: "Titular" });
  });

  it("sin anuncio no hay fuente, y el titular se recorta a 100", () => {
    expect(fuenteDeReferido(undefined)).toBeUndefined();
    expect(fuenteDeReferido({ source_type: "ad", headline: "t".repeat(150) })?.anuncio).toHaveLength(100);
  });
});

describe("textoFuente", () => {
  it("cada tipo en una línea legible", () => {
    expect(textoFuente({ tipo: "anuncio", plataforma: "Meta", campana: "otoño" })).toBe("Anuncio de Meta · otoño");
    expect(textoFuente({ tipo: "anuncio", plataforma: "Meta", anuncio: "Reforma tu baño" })).toBe("Anuncio de Meta · Reforma tu baño");
    expect(textoFuente({ tipo: "anuncio", plataforma: "Meta", campana: "c", anuncio: "a" })).toBe("Anuncio de Meta · c");
    expect(textoFuente({ tipo: "anuncio", plataforma: "Google" })).toBe("Anuncio de Google");
    expect(textoFuente({ tipo: "buscador", plataforma: "Google" })).toBe("Google");
    expect(textoFuente({ tipo: "redes", plataforma: "Instagram" })).toBe("Instagram");
    expect(textoFuente({ tipo: "recomendacion" })).toBe("Recomendación");
    expect(textoFuente({ tipo: "directo" })).toBe("Directo");
    expect(textoFuente({ tipo: "web" })).toBe("Tu web, por WhatsApp");
    expect(textoFuente({ tipo: "otro", plataforma: "Newsletter" })).toBe("Newsletter");
    expect(textoFuente({ tipo: "otro" })).toBe("Otro");
    expect(textoFuente(undefined)).toBe("");
  });
});

describe("el mensaje del botón de WhatsApp de la web", () => {
  const MENSAJE = "Hola, quiero pedir presupuesto para una reforma.";

  it("el mismo texto, aunque cambien signos, mayúsculas, tildes o lleve un emoji al final", () => {
    expect(esMensajeDeLaWeb(MENSAJE, MENSAJE)).toBe(true);
    expect(esMensajeDeLaWeb("hola quiero pedir presupuesto para una reforma", MENSAJE)).toBe(true);
    expect(esMensajeDeLaWeb("  HOLA, quiero pedir presupuesto para una reforma!!! 😊🙏 ", MENSAJE)).toBe(true);
    expect(esMensajeDeLaWeb("Hola, quiero información sobre un inmueble", "Hola, quiero informacion sobre un inmueble.")).toBe(true);
  });

  it("un texto editado es un WhatsApp normal", () => {
    expect(esMensajeDeLaWeb("Hola, quiero pedir presupuesto para una reforma del baño.", MENSAJE)).toBe(false);
    expect(esMensajeDeLaWeb("Hola", MENSAJE)).toBe(false);
    expect(esMensajeDeLaWeb("", MENSAJE)).toBe(false);
    expect(esMensajeDeLaWeb(undefined, MENSAJE)).toBe(false);
    expect(esMensajeDeLaWeb("!!!", "...")).toBe(false);
  });

  it("vinoDeLaWeb: solo un cliente de WhatsApp con la fuente de la web", () => {
    expect(vinoDeLaWeb({ origen: "whatsapp", fuente: { tipo: "web" } })).toBe(true);
    expect(vinoDeLaWeb({ origen: "whatsapp", fuente: { tipo: "anuncio", plataforma: "Meta" } })).toBe(false);
    expect(vinoDeLaWeb({ origen: "whatsapp" })).toBe(false);
    expect(vinoDeLaWeb({ origen: "formulario", fuente: { tipo: "web" } })).toBe(false);
    expect(vinoDeLaWeb(undefined)).toBe(false);
  });
});
