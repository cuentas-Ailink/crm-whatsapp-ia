import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";
import { decidirAcceso, destinoSeguro, RUTAS_PUBLICAS_SERVIDOR, type DecisionAcceso, type PeticionAcceso } from "./acceso";

// El enrutado de proxy.ts en modo local, congelado en una tabla antes de que el modo servidor lo
// toque (I9). Cada fila es una petición y lo que tiene que pasar con ella: «pasa» o el estado y el
// texto de la respuesta. Las filas no cambian nunca: si una deja de cumplirse, el modo local ha cambiado.

type Cabeceras = Partial<Record<"host" | "x-forwarded-host" | "sec-fetch-site" | "origin" | "content-type", string>>;
type Esperado = "pasa" | readonly [status: number, texto: string];
interface Fila {
  metodo: string;
  ruta: string;
  cabeceras: Cabeceras;
  esperado: Esperado;
}

const LOCAL = { host: "localhost:8120" } as const;
const JSON_ = { "content-type": "application/json" } as const;
const NO_ENCONTRADO = [404, "No encontrado"] as const;
const PROHIBIDO = [403, "Prohibido"] as const;
const SIN_JSON = [415, "Se esperaba JSON"] as const;

const FILAS: readonly Fila[] = [
  // Las dos rutas del webhook pasan desde cualquier sitio y sin JSON: la ruta mira la firma de Meta.
  { metodo: "GET", ruta: "/webhook", cabeceras: { host: "otro.example" }, esperado: "pasa" },
  { metodo: "POST", ruta: "/webhook", cabeceras: { host: "otro.example" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/api/whatsapp/webhook", cabeceras: { host: "otro.example" }, esperado: "pasa" },
  { metodo: "POST", ruta: "/api/whatsapp/webhook", cabeceras: { host: "otro.example" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/WEBHOOK", cabeceras: { host: "otro.example" }, esperado: NO_ENCONTRADO },

  // El Host: solo este ordenador (la primera entrada, sin puerto, en minúsculas).
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "localhost:8120" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "127.0.0.1:8120" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "[::1]:8120" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "LOCALHOST" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "otro.example" }, esperado: NO_ENCONTRADO },
  { metodo: "GET", ruta: "/panel", cabeceras: {}, esperado: NO_ENCONTRADO },
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "localhost", "x-forwarded-host": "demo.ngrok-free.app" }, esperado: NO_ENCONTRADO },
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "localhost", "x-forwarded-host": "localhost:8120" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/panel", cabeceras: { host: "localhost, otro.example" }, esperado: "pasa" },

  // Sec-Fetch-Site: /lead y /api/* solo desde la propia página o tecleadas.
  { metodo: "GET", ruta: "/api/leads", cabeceras: { ...LOCAL, "sec-fetch-site": "cross-site" }, esperado: PROHIBIDO },
  { metodo: "GET", ruta: "/api/leads", cabeceras: { ...LOCAL, "sec-fetch-site": "same-site" }, esperado: PROHIBIDO },
  { metodo: "GET", ruta: "/api/leads", cabeceras: { ...LOCAL, "sec-fetch-site": "same-origin" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/api/leads", cabeceras: { ...LOCAL, "sec-fetch-site": "none" }, esperado: "pasa" },
  { metodo: "GET", ruta: "/api/leads", cabeceras: { ...LOCAL }, esperado: "pasa" },
  { metodo: "GET", ruta: "/panel", cabeceras: { ...LOCAL, "sec-fetch-site": "cross-site" }, esperado: "pasa" },
  { metodo: "POST", ruta: "/lead", cabeceras: { ...LOCAL, ...JSON_, "sec-fetch-site": "cross-site" }, esperado: PROHIBIDO },

  // Escrituras: Origin local cuando lo hay y siempre JSON.
  { metodo: "POST", ruta: "/api/responder", cabeceras: { ...LOCAL, ...JSON_, origin: "http://otro.example" }, esperado: PROHIBIDO },
  { metodo: "POST", ruta: "/api/responder", cabeceras: { ...LOCAL, ...JSON_, origin: "null" }, esperado: PROHIBIDO },
  { metodo: "POST", ruta: "/api/responder", cabeceras: { ...LOCAL, ...JSON_, origin: "http://localhost:8120" }, esperado: "pasa" },
  { metodo: "POST", ruta: "/api/responder", cabeceras: { ...LOCAL, ...JSON_ }, esperado: "pasa" },
  { metodo: "POST", ruta: "/api/responder", cabeceras: { ...LOCAL }, esperado: SIN_JSON },
  { metodo: "POST", ruta: "/api/responder", cabeceras: { ...LOCAL, "content-type": "text/plain" }, esperado: SIN_JSON },
  { metodo: "POST", ruta: "/api/responder", cabeceras: { ...LOCAL, "content-type": "application/json; charset=utf-8" }, esperado: "pasa" },
  { metodo: "PUT", ruta: "/api/responder", cabeceras: { ...LOCAL }, esperado: SIN_JSON },
  { metodo: "DELETE", ruta: "/api/responder", cabeceras: { ...LOCAL }, esperado: SIN_JSON },
  { metodo: "HEAD", ruta: "/api/leads", cabeceras: { ...LOCAL }, esperado: "pasa" },
];

const COOKIE = "crm_sesion=lo-que-sea";

function nombreDe(f: Fila, conCookie: boolean): string {
  const cabeceras = Object.entries(f.cabeceras)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  const esperado = f.esperado === "pasa" ? "pasa" : `${f.esperado[0]} ${f.esperado[1]}`;
  return `${f.metodo} ${f.ruta} [${cabeceras || "sin cabeceras"}]${conCookie ? " con cookie" : ""} → ${esperado}`;
}

function peticion(f: Fila, conCookie: boolean): NextRequest {
  const headers = new Headers();
  for (const [k, v] of Object.entries(f.cabeceras)) headers.set(k, v);
  if (conCookie) headers.set("cookie", COOKIE);
  const conCuerpo = f.metodo !== "GET" && f.metodo !== "HEAD";
  return new NextRequest(`http://localhost${f.ruta}`, { method: f.metodo, headers, ...(conCuerpo ? { body: "{}" } : {}) });
}

async function resultadoDeProxy(f: Fila, conCookie: boolean): Promise<Esperado> {
  const res = proxy(peticion(f, conCookie));
  if (res.headers.get("x-middleware-next") === "1") return "pasa";
  return [res.status, await res.text()];
}

/** La misma fila como la ve lib/acceso.ts: lo que le pasa proxy.ts. */
function peticionAcceso(f: Fila, cookie: string | null): PeticionAcceso {
  const url = new URL(`http://localhost${f.ruta}`);
  return {
    ruta: url.pathname,
    consulta: url.search,
    metodo: f.metodo,
    host: f.cabeceras.host ?? null,
    reenviado: f.cabeceras["x-forwarded-host"] ?? null,
    sitio: f.cabeceras["sec-fetch-site"] ?? null,
    origen: f.cabeceras.origin ?? null,
    tipo: f.cabeceras["content-type"] ?? null,
    cookie,
  };
}

function comoEsperado(d: DecisionAcceso): Esperado {
  if (d.tipo === "pasa") return "pasa";
  if (d.tipo === "respuesta") return [d.status, d.cuerpo];
  return [307, d.a];
}

describe("proxy.ts en modo local (congelado)", () => {
  for (const conCookie of [false, true]) {
    for (const f of FILAS) {
      it(nombreDe(f, conCookie), async () => {
        expect(await resultadoDeProxy(f, conCookie)).toEqual(f.esperado);
        expect(comoEsperado(decidirAcceso(peticionAcceso(f, conCookie ? "lo-que-sea" : null), {}))).toEqual(f.esperado);
      });
    }
  }
});

// ─── Modo servidor ────────────────────────────────────────────────────────────────────────────────

const DOMINIO = "crm.prueba.test";
const ORIGEN = "https://crm.prueba.test";

function pet(p: Partial<PeticionAcceso> & { ruta: string }): PeticionAcceso {
  return {
    consulta: "",
    metodo: "GET",
    host: DOMINIO,
    reenviado: null,
    sitio: null,
    origen: null,
    tipo: null,
    cookie: null,
    ...p,
  };
}

const escritura = (p: Partial<PeticionAcceso> & { ruta: string }) => pet({ metodo: "POST", origen: ORIGEN, tipo: "application/json", ...p });
const sinSesion = (p: PeticionAcceso) => decidirAcceso(p, { dominio: DOMINIO, sesionValida: () => false });
const conSesion = (p: PeticionAcceso) => decidirAcceso(p, { dominio: DOMINIO, sesionValida: () => true });
const JSON_SIN_SESION = '{"ok":false,"error":"Tienes que entrar con tu contraseña","codigo":"sesion"}';
const RESPUESTA_401 = { tipo: "respuesta", status: 401, cuerpo: JSON_SIN_SESION, json: true };

describe("modo servidor: superficie pública", () => {
  const publicas: PeticionAcceso[] = [
    pet({ ruta: "/" }),
    pet({ ruta: "/_next/static/chunks/a.js" }),
    pet({ ruta: "/fotos/formulario.webp" }),
    pet({ ruta: "/icono.svg" }),
    pet({ ruta: "/favicon.ico" }),
    pet({ ruta: "/api/logo", consulta: "?perfil=x&v=1" }),
    escritura({ ruta: "/lead" }),
    pet({ ruta: "/webhook" }),
    pet({ ruta: "/webhook", metodo: "POST" }),
    pet({ ruta: "/api/whatsapp/webhook", metodo: "POST" }),
    pet({ ruta: "/api/estado", consulta: "?solo=firma" }),
    pet({ ruta: "/entrar" }),
    escritura({ ruta: "/api/sesion" }),
  ];
  for (const p of publicas) {
    it(`${p.metodo} ${p.ruta}${p.consulta} pasa sin sesión y sin mirarla`, () => {
      const espia = vi.fn(() => false);
      expect(decidirAcceso(p, { dominio: DOMINIO, sesionValida: espia })).toEqual({ tipo: "pasa" });
      expect(espia).not.toHaveBeenCalled();
    });
  }

  it("HEAD vale como GET", () => {
    expect(sinSesion(pet({ ruta: "/", metodo: "HEAD" }))).toEqual({ tipo: "pasa" });
    expect(sinSesion(pet({ ruta: "/entrar", metodo: "HEAD" }))).toEqual({ tipo: "pasa" });
  });

  it("/api/estado sin solo=firma es privada; con otro parámetro más sigue siendo pública", () => {
    expect(sinSesion(pet({ ruta: "/api/estado" }))).toEqual(RESPUESTA_401);
    expect(sinSesion(pet({ ruta: "/api/estado", consulta: "?solo=otra" }))).toEqual(RESPUESTA_401);
    expect(sinSesion(pet({ ruta: "/api/estado", consulta: "?solo=firma&x=1" }))).toEqual({ tipo: "pasa" });
  });

  it("un POST a /api/estado?solo=firma no es público", () => {
    expect(sinSesion(escritura({ ruta: "/api/estado", consulta: "?solo=firma" }))).toEqual(RESPUESTA_401);
  });

  it("solo el método de la lista: GET /lead, PUT y DELETE /api/sesion y POST / piden sesión", () => {
    expect(sinSesion(pet({ ruta: "/lead" }))).toEqual(RESPUESTA_401);
    expect(sinSesion(escritura({ ruta: "/api/sesion", metodo: "PUT" }))).toEqual(RESPUESTA_401);
    expect(sinSesion(escritura({ ruta: "/api/sesion", metodo: "DELETE" }))).toEqual(RESPUESTA_401);
    expect(sinSesion(pet({ ruta: "/api/sesion" }))).toEqual(RESPUESTA_401);
    expect(sinSesion(escritura({ ruta: "/" }))).toEqual(RESPUESTA_401);
  });

  it("los prefijos piden la barra: /_nextx y /fotos sin barra no son públicos", () => {
    expect(sinSesion(pet({ ruta: "/_nextx/a" }))).toEqual({ tipo: "redirige", a: "/entrar?volver=%2F_nextx%2Fa" });
    expect(sinSesion(pet({ ruta: "/fotos" }))).toEqual({ tipo: "redirige", a: "/entrar?volver=%2Ffotos" });
    expect(sinSesion(pet({ ruta: "/entrar/otra" }))).toEqual({ tipo: "redirige", a: "/entrar?volver=%2Fentrar%2Fotra" });
  });
});

describe("modo servidor: Host", () => {
  it("el dominio, en mayúsculas y con puerto, pasa", () => {
    expect(sinSesion(pet({ ruta: "/", host: "crm.prueba.test" }))).toEqual({ tipo: "pasa" });
    expect(sinSesion(pet({ ruta: "/", host: "CRM.Prueba.Test:443" }))).toEqual({ tipo: "pasa" });
  });
  it("el dominio de la configuración se normaliza (espacios y mayúsculas)", () => {
    expect(decidirAcceso(pet({ ruta: "/" }), { dominio: "  CRM.Prueba.TEST " })).toEqual({ tipo: "pasa" });
  });
  it("otro host, ninguno o localhost: 404", () => {
    for (const host of ["otro.prueba.test", "localhost:8120", "127.0.0.1", null]) {
      expect(conSesion(pet({ ruta: "/", host }))).toEqual({ tipo: "respuesta", status: 404, cuerpo: "No encontrado" });
    }
  });
  it("X-Forwarded-Host: el dominio pasa, otro da 404", () => {
    expect(sinSesion(pet({ ruta: "/", reenviado: DOMINIO }))).toEqual({ tipo: "pasa" });
    expect(sinSesion(pet({ ruta: "/", reenviado: "otro.prueba.test" }))).toEqual({ tipo: "respuesta", status: 404, cuerpo: "No encontrado" });
  });
  it("con una cookie válida, un host ajeno sigue siendo 404 (el host va primero)", () => {
    expect(conSesion(pet({ ruta: "/panel", host: "otro.prueba.test" }))).toEqual({ tipo: "respuesta", status: 404, cuerpo: "No encontrado" });
  });
  it("el webhook pasa con cualquier host y método", () => {
    for (const metodo of ["GET", "POST"]) {
      expect(sinSesion(pet({ ruta: "/webhook", metodo, host: "otro.prueba.test" }))).toEqual({ tipo: "pasa" });
      expect(sinSesion(pet({ ruta: "/api/whatsapp/webhook", metodo, host: null }))).toEqual({ tipo: "pasa" });
    }
  });
  it("Sec-Fetch-Site como en local", () => {
    expect(conSesion(pet({ ruta: "/api/leads", sitio: "cross-site" }))).toEqual({ tipo: "respuesta", status: 403, cuerpo: "Prohibido" });
    expect(sinSesion(escritura({ ruta: "/lead", sitio: "same-site" }))).toEqual({ tipo: "respuesta", status: 403, cuerpo: "Prohibido" });
    expect(conSesion(pet({ ruta: "/api/leads", sitio: "same-origin" }))).toEqual({ tipo: "pasa" });
  });
});

describe("modo servidor: escrituras", () => {
  const prohibido = { tipo: "respuesta", status: 403, cuerpo: "Prohibido" };
  it("Origin falta, es de otro sitio, es http:// o lleva otro puerto: 403", () => {
    for (const origen of [null, "https://otro.prueba.test", "http://crm.prueba.test", "https://crm.prueba.test:8443", "null", "http://localhost:8120"]) {
      expect(conSesion(escritura({ ruta: "/api/borrar-cliente", origen }))).toEqual(prohibido);
      expect(sinSesion(escritura({ ruta: "/lead", origen }))).toEqual(prohibido);
    }
  });
  it("el Origin del dominio por https pasa", () => {
    expect(conSesion(escritura({ ruta: "/api/borrar-cliente" }))).toEqual({ tipo: "pasa" });
  });
  it("sin JSON: 415", () => {
    for (const tipo of [null, "text/plain"]) {
      expect(conSesion(escritura({ ruta: "/api/borrar-cliente", tipo }))).toEqual({ tipo: "respuesta", status: 415, cuerpo: "Se esperaba JSON" });
    }
  });
  it("el webhook no pide Origin ni JSON", () => {
    expect(sinSesion(pet({ ruta: "/webhook", metodo: "POST", origen: null, tipo: null }))).toEqual({ tipo: "pasa" });
  });
});

describe("modo servidor: sin sesión", () => {
  it("una página va a entrar con su volver codificado", () => {
    expect(sinSesion(pet({ ruta: "/panel" }))).toEqual({ tipo: "redirige", a: "/entrar?volver=%2Fpanel" });
    expect(sinSesion(pet({ ruta: "/panel", consulta: "?cliente=x" }))).toEqual({ tipo: "redirige", a: "/entrar?volver=%2Fpanel%3Fcliente%3Dx" });
    expect(sinSesion(pet({ ruta: "/panel", metodo: "HEAD" }))).toEqual({ tipo: "redirige", a: "/entrar?volver=%2Fpanel" });
  });
  it("las API y las escrituras: 401 con el JSON exacto", () => {
    for (const p of [pet({ ruta: "/api/leads" }), pet({ ruta: "/api/eventos" }), escritura({ ruta: "/api/reset" }), escritura({ ruta: "/panel" })]) {
      const d = sinSesion(p);
      expect(d).toEqual(RESPUESTA_401);
      if (d.tipo === "respuesta") expect(JSON.parse(d.cuerpo)).toEqual({ ok: false, error: "Tienes que entrar con tu contraseña", codigo: "sesion" });
    }
  });
  it("sin sesionValida es como sin sesión", () => {
    expect(decidirAcceso(pet({ ruta: "/api/leads", cookie: "x" }), { dominio: DOMINIO })).toEqual(RESPUESTA_401);
  });
});

describe("modo servidor: con sesión", () => {
  it("pasa, y sesionValida recibe la cookie de la petición", () => {
    const espia = vi.fn((c: string | null) => c === "buena");
    expect(decidirAcceso(pet({ ruta: "/panel", cookie: "buena" }), { dominio: DOMINIO, sesionValida: espia })).toEqual({ tipo: "pasa" });
    expect(espia).toHaveBeenCalledWith("buena");
    expect(decidirAcceso(pet({ ruta: "/panel", cookie: "mala" }), { dominio: DOMINIO, sesionValida: espia })).toEqual({ tipo: "redirige", a: "/entrar?volver=%2Fpanel" });
  });
  it("una sesión que no devuelve exactamente true no vale", () => {
    const rara = (() => "si") as unknown as (c: string | null) => boolean;
    expect(decidirAcceso(pet({ ruta: "/api/leads" }), { dominio: DOMINIO, sesionValida: rara })).toEqual(RESPUESTA_401);
  });
});

describe("en local nunca se mira la sesión", () => {
  for (const f of FILAS) {
    it(nombreDe(f, true), () => {
      const espia = vi.fn(() => true);
      expect(comoEsperado(decidirAcceso(peticionAcceso(f, "lo-que-sea"), { sesionValida: espia }))).toEqual(f.esperado);
      expect(comoEsperado(decidirAcceso(peticionAcceso(f, "lo-que-sea"), { dominio: "  ", sesionValida: espia }))).toEqual(f.esperado);
      expect(espia).not.toHaveBeenCalled();
    });
  }
});

describe("destinoSeguro", () => {
  it("una ruta de este sitio se queda", () => {
    expect(destinoSeguro("/panel")).toBe("/panel");
    expect(destinoSeguro("/panel?cliente=x")).toBe("/panel?cliente=x");
    expect(destinoSeguro("/panel#ajustes")).toBe("/panel#ajustes");
  });
  it("otro sitio, entrar otra vez, control, demasiado largo o nada: /panel", () => {
    for (const v of ["//evil.example", "/\\evil.example", "https://evil.example", "/entrar?volver=/panel", "/entrar", "/panel\nx", "/panel\x7f", "", null, `/${"a".repeat(512)}`]) {
      expect(destinoSeguro(v)).toBe("/panel");
    }
    expect(destinoSeguro(`/${"a".repeat(511)}`)).toBe(`/${"a".repeat(511)}`);
  });
});

describe("la lista pública es exactamente la de I21", () => {
  it("literal", () => {
    expect(RUTAS_PUBLICAS_SERVIDOR).toEqual([
      "GET /",
      "GET /_next/*",
      "GET /fotos/*",
      "GET /icono.svg",
      "GET /favicon.ico",
      "GET /api/logo",
      "POST /lead",
      "* /webhook",
      "* /api/whatsapp/webhook",
      "GET /api/estado?solo=firma",
      "GET /entrar",
      "POST /api/sesion",
    ]);
  });
});

describe("proxy.ts en modo servidor (el adaptador)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const peticionServidor = (ruta: string, cabeceras: Record<string, string> = {}) =>
    new NextRequest(`http://crm.prueba.test${ruta}`, { headers: { host: "crm.prueba.test", ...cabeceras } });

  it("la redirección va con una URL completa del mismo origen (Next la vuelve relativa al enviarla) y sin caché", () => {
    vi.stubEnv("CRM_DOMINIO", " CRM.prueba.test ");
    const res = proxy(peticionServidor("/panel?cliente=x"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://crm.prueba.test/entrar?volver=%2Fpanel%3Fcliente%3Dx");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("el 401 va en JSON y sin caché", async () => {
    vi.stubEnv("CRM_DOMINIO", "crm.prueba.test");
    const res = proxy(peticionServidor("/api/leads", { cookie: "crm_sesion=basura" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(JSON_SIN_SESION);
  });

  it("lo público pasa", () => {
    vi.stubEnv("CRM_DOMINIO", "crm.prueba.test");
    expect(proxy(peticionServidor("/")).headers.get("x-middleware-next")).toBe("1");
  });
});
