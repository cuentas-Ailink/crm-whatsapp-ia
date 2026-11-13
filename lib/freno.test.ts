import { beforeEach, describe, expect, it } from "vitest";
import { anotarBienvenida, frenar, ipDeCabecera, TEXTO_DEMASIADAS } from "./freno";

const AHORA = Date.UTC(2026, 10, 13, 10, 0, 0);
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const DEMASIADAS = { ok: false, status: 429, error: TEXTO_DEMASIADAS };

beforeEach(() => {
  delete (globalThis as { __crmFreno?: unknown }).__crmFreno;
});

describe("campo trampa en los dos modos", () => {
  it("con algo escrito es trampa; vacío o con espacios, no", () => {
    for (const servidor of [false, true]) {
      expect(frenar({ ip: "198.51.100.1", telefono: "34611100001", web: "http://spam.example" }, AHORA, servidor)).toEqual({ ok: false, trampa: true });
      expect(frenar({ ip: "198.51.100.2", telefono: "34611100002", web: "   " }, AHORA, servidor)).toEqual({ ok: true });
      expect(frenar({ ip: "198.51.100.3", telefono: "34611100003" }, AHORA, servidor)).toEqual({ ok: true });
    }
  });
});

describe("en local no hay límites", () => {
  it("100 peticiones para un teléfono y una IP pasan", () => {
    for (let i = 0; i < 100; i++) {
      expect(frenar({ ip: "198.51.100.1", telefono: "34611100001" }, AHORA + i, false)).toEqual({ ok: true });
      anotarBienvenida("34611100001", AHORA + i);
    }
  });
});

describe("un teléfono, una bienvenida cada 24 h", () => {
  it("solo cuenta después de anotarBienvenida y se libera a las 24 h", () => {
    expect(frenar({ ip: "198.51.100.1", telefono: "34611100001" }, AHORA, true)).toEqual({ ok: true });
    // El envío falló: no se anota y puede volver a intentarlo.
    expect(frenar({ ip: "198.51.100.2", telefono: "34611100001" }, AHORA + 1000, true)).toEqual({ ok: true });
    anotarBienvenida("34611100001", AHORA + 1000);
    expect(frenar({ ip: "198.51.100.3", telefono: "34611100001" }, AHORA + 2000, true)).toEqual(DEMASIADAS);
    expect(frenar({ ip: "198.51.100.4", telefono: "34611100001" }, AHORA + 1000 + DIA - 1, true)).toEqual(DEMASIADAS);
    expect(frenar({ ip: "198.51.100.5", telefono: "34611100001" }, AHORA + 1000 + DIA, true)).toEqual({ ok: true });
  });
});

describe("5 por IP y hora", () => {
  it("la 6.ª petición de una IP en una hora no pasa; otra IP sí; a la hora, otra vez", () => {
    for (let i = 0; i < 5; i++) expect(frenar({ ip: "198.51.100.9", telefono: `3461110000${i}` }, AHORA + i, true)).toEqual({ ok: true });
    expect(frenar({ ip: "198.51.100.9", telefono: "34611100009" }, AHORA + 10, true)).toEqual(DEMASIADAS);
    expect(frenar({ ip: "198.51.100.10", telefono: "34611100009" }, AHORA + 10, true)).toEqual({ ok: true });
    expect(frenar({ ip: "198.51.100.9", telefono: "34611100009" }, AHORA + HORA, true)).toEqual({ ok: true });
  });
});

describe("sin IP no hay límite por IP", () => {
  it("20 peticiones sin IP pasan; los demás límites siguen", () => {
    for (let i = 0; i < 20; i++) expect(frenar({ ip: null, telefono: `346111000${String(i).padStart(2, "0")}` }, AHORA + i, true)).toEqual({ ok: true });
    anotarBienvenida("34611100000", AHORA);
    expect(frenar({ ip: null, telefono: "34611100000" }, AHORA + 100, true)).toEqual(DEMASIADAS);
  });
});

describe("50 bienvenidas en 24 h", () => {
  it("con 50 enviadas no pasa nadie más hasta que la primera sale de la ventana", () => {
    for (let i = 0; i < 50; i++) anotarBienvenida(`34622200${String(i).padStart(3, "0")}`, AHORA + i);
    expect(frenar({ ip: "198.51.100.1", telefono: "34633300000" }, AHORA + 100, true)).toEqual(DEMASIADAS);
    expect(frenar({ ip: null, telefono: "34633300000" }, AHORA + 100, true)).toEqual(DEMASIADAS);
    expect(frenar({ ip: "198.51.100.1", telefono: "34633300000" }, AHORA + DIA, true)).toEqual({ ok: true });
  });
  it("con 49 aún pasa", () => {
    for (let i = 0; i < 49; i++) anotarBienvenida(`34622200${String(i).padStart(3, "0")}`, AHORA + i);
    expect(frenar({ ip: "198.51.100.1", telefono: "34633300000" }, AHORA + 100, true)).toEqual({ ok: true });
  });
});

describe("el texto del 429", () => {
  it("exacto", () => {
    expect(TEXTO_DEMASIADAS).toBe("Hemos recibido muchas solicitudes. Inténtalo más tarde o escríbenos por WhatsApp.");
  });
});

describe("ipDeCabecera toma la última entrada", () => {
  it("la que añade Caddy", () => {
    expect(ipDeCabecera("203.0.113.9, 10.0.0.1, 198.51.100.7")).toBe("198.51.100.7");
    expect(ipDeCabecera("198.51.100.7")).toBe("198.51.100.7");
    expect(ipDeCabecera(" 198.51.100.7 ")).toBe("198.51.100.7");
    expect(ipDeCabecera(null)).toBeNull();
    expect(ipDeCabecera("")).toBeNull();
    expect(ipDeCabecera("1.2.3.4, ")).toBeNull();
  });
});
