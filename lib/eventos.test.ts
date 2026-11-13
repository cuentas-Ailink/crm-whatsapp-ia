import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cambio, Llegada, LlegadaFallida } from "./api-tipos";

// Cuenta las suscripciones vivas a escucharServidor para comprobar que la ruta deja de escuchar al cortar.
const contador = vi.hoisted(() => ({ activos: 0 }));

vi.mock("@/lib/eventos", async (original) => {
  const real = await original<typeof import("@/lib/eventos")>();
  return {
    ...real,
    escucharServidor: (f: Parameters<typeof real.escucharServidor>[0]) => {
      contador.activos += 1;
      const dejar = real.escucharServidor(f);
      let hecho = false;
      return () => {
        if (!hecho) {
          hecho = true;
          contador.activos -= 1;
        }
        dejar();
      };
    },
  };
});

const {
  avisarCambio,
  avisarLlegada,
  avisarLlegadaFallida,
  escucharCambios,
  escucharServidor,
  leadsEscribiendo,
  marcarEscribiendo,
  registrarWebhook,
  ultimosWebhooks,
} = await import("@/lib/eventos");
const { GET } = await import("@/app/api/eventos/route");

type EventoServidor = Parameters<Parameters<typeof escucharServidor>[0]>[0];

const pendientes: (() => void)[] = [];

/** Se quita sola en afterEach. */
function oir<T>(suscribir: (f: (x: T) => void) => () => void): T[] {
  const recibidos: T[] = [];
  pendientes.push(suscribir((x) => recibidos.push(x)));
  return recibidos;
}

afterEach(() => {
  while (pendientes.length) pendientes.pop()!();
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

const llegada: Llegada = { leadId: "34612345678:estudio-de-reformas", nombre: "Laura", canal: "formulario", inicio: 1731312000123 };
const fallo: LlegadaFallida = {
  leadId: "34612345678:estudio-de-reformas",
  nombre: "Laura",
  codigo: "meta.bienvenida",
  texto: "Meta aún no ha aprobado tu mensaje de bienvenida",
};

describe("bus de eventos", () => {
  it("junta dos avisos del mismo tipo en 50 ms y sube rev", () => {
    vi.useFakeTimers();
    const cambios = oir<Cambio>(escucharCambios);
    avisarCambio("leads");
    avisarCambio("leads");
    vi.advanceTimersByTime(50);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].tipo).toBe("leads");
    avisarCambio("leads");
    vi.advanceTimersByTime(50);
    expect(cambios).toHaveLength(2);
    expect(cambios[1].rev).toBe(cambios[0].rev + 1);
  });

  it("dos tipos distintos salen por separado", () => {
    vi.useFakeTimers();
    const cambios = oir<Cambio>(escucharCambios);
    avisarCambio("leads");
    avisarCambio("configuracion");
    vi.advanceTimersByTime(50);
    expect(cambios.map((c) => c.tipo).sort()).toEqual(["configuracion", "leads"]);
    expect(cambios[1].rev).toBe(cambios[0].rev + 1);
  });

  it("dos oyentes reciben el mismo cambio; quitar uno no afecta al otro", () => {
    vi.useFakeTimers();
    const uno: Cambio[] = [];
    const dejarUno = escucharCambios((c) => uno.push(c));
    const otro = oir<Cambio>(escucharCambios);
    avisarCambio("sistema");
    vi.advanceTimersByTime(50);
    expect(uno).toHaveLength(1);
    expect(otro).toEqual(uno);
    dejarUno();
    avisarCambio("sistema");
    vi.advanceTimersByTime(50);
    expect(uno).toHaveLength(1);
    expect(otro).toHaveLength(2);
  });

  it("escucharCambios y escucharServidor reciben el cambio", () => {
    vi.useFakeTimers();
    const cambios = oir<Cambio>(escucharCambios);
    const servidor = oir<EventoServidor>(escucharServidor);
    avisarCambio("configuracion");
    vi.advanceTimersByTime(50);
    expect(cambios).toHaveLength(1);
    expect(servidor).toEqual([{ tipo: "cambio", cambio: cambios[0] }]);
  });

  it("escribiendo: entra, sale y caduca a los 60 s", () => {
    vi.useFakeTimers();
    const cambios = oir<Cambio>(escucharCambios);
    marcarEscribiendo("lead-escribe-1", true);
    expect(leadsEscribiendo()).toContain("lead-escribe-1");
    vi.advanceTimersByTime(50);
    expect(cambios.map((c) => c.tipo)).toEqual(["escribiendo"]);

    marcarEscribiendo("lead-escribe-1", false);
    expect(leadsEscribiendo()).not.toContain("lead-escribe-1");
    vi.advanceTimersByTime(50);
    expect(cambios).toHaveLength(2);

    marcarEscribiendo("lead-escribe-2", true);
    vi.advanceTimersByTime(30_000);
    expect(leadsEscribiendo()).toContain("lead-escribe-2");
    vi.advanceTimersByTime(30_001);
    expect(leadsEscribiendo()).not.toContain("lead-escribe-2");
  });

  it("registrarWebhook guarda la hora del último válido y del último rechazado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    registrarWebhook("valido");
    vi.setSystemTime(new Date("2026-11-12T10:05:00Z"));
    registrarWebhook("rechazado");
    expect(ultimosWebhooks()).toEqual({
      valido: Date.parse("2026-11-12T10:00:00Z"),
      rechazado: Date.parse("2026-11-12T10:05:00Z"),
    });
    vi.setSystemTime(new Date("2026-11-12T10:10:00Z"));
    registrarWebhook("valido");
    expect(ultimosWebhooks().valido).toBe(Date.parse("2026-11-12T10:10:00Z"));
    expect(ultimosWebhooks().rechazado).toBe(Date.parse("2026-11-12T10:05:00Z"));
  });

  it("la llegada sale al momento y nunca se junta con otra", () => {
    vi.useFakeTimers();
    const servidor = oir<EventoServidor>(escucharServidor);
    const otra: Llegada = { ...llegada, leadId: "34600000000:estudio-de-reformas", nombre: "Pedro" };
    avisarLlegada(llegada);
    avisarLlegada(otra);
    expect(servidor).toEqual([
      { tipo: "llegada", llegada },
      { tipo: "llegada", llegada: otra },
    ]);
  });

  it("la llegada fallida sale al momento", () => {
    const servidor = oir<EventoServidor>(escucharServidor);
    avisarLlegadaFallida(fallo);
    expect(servidor).toEqual([{ tipo: "llegada-fallida", fallo }]);
  });
});

// ─── La ruta ──────────────────────────────────────────────────────────────────────────────────────

interface Lector {
  /** Lee hasta que lo acumulado contiene el texto o pasa el tiempo; devuelve lo acumulado. */
  hasta(texto: string, ms?: number): Promise<string>;
  /** Lee hasta el final del flujo. */
  final(ms?: number): Promise<{ texto: string; terminado: boolean }>;
  todo(): string;
}

function abrirFlujo(): { respuesta: Promise<Response>; cortar: () => void; lector: () => Promise<Lector> } {
  const control = new AbortController();
  const respuesta = GET(new Request("http://localhost/api/eventos", { signal: control.signal }));
  let cortado = false;
  const cortar = () => {
    if (cortado) return;
    cortado = true;
    control.abort();
  };
  pendientes.push(cortar);
  const lector = async (): Promise<Lector> => {
    const r = await respuesta;
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();
    let acumulado = "";
    let terminado = false;
    let enCurso: Promise<void> | null = null;
    const leerUno = () => {
      enCurso ??= reader.read().then(({ value, done }) => {
        enCurso = null;
        if (done) terminado = true;
        else acumulado += decoder.decode(value, { stream: true });
      });
      return enCurso;
    };
    const conPlazo = async (condicion: () => boolean, ms: number) => {
      const limite = Date.now() + ms;
      while (!condicion() && !terminado) {
        const quedan = limite - Date.now();
        if (quedan <= 0) break;
        await Promise.race([leerUno(), new Promise((resolver) => setTimeout(resolver, quedan))]);
      }
    };
    return {
      async hasta(texto, ms = 1_000) {
        await conPlazo(() => acumulado.includes(texto), ms);
        return acumulado;
      },
      async final(ms = 1_000) {
        await conPlazo(() => false, ms);
        return { texto: acumulado, terminado };
      },
      todo: () => acumulado,
    };
  };
  return { respuesta, cortar, lector };
}

/** Los `data:` de los eventos con ese nombre, ya leídos como JSON. */
function datosDe(texto: string, nombre: string): Record<string, unknown>[] {
  return texto
    .split("\n\n")
    .filter((bloque) => bloque.startsWith(`event: ${nombre}\n`))
    .map((bloque) => {
      const lineas = bloque.split("\n");
      expect(lineas).toHaveLength(2);
      expect(lineas[1].startsWith("data: ")).toBe(true);
      return JSON.parse(lineas[1].slice("data: ".length)) as Record<string, unknown>;
    });
}

/** Con temporizadores falsos: lee lo que haya en el flujo sin esperar a nada. */
async function leerYa(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder, veces = 1): Promise<string> {
  let texto = "";
  for (let i = 0; i < veces; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    texto += decoder.decode(value, { stream: true });
  }
  return texto;
}

describe("GET /api/eventos", () => {
  it("empieza con retry: 3000 y la hora del servidor", async () => {
    const antes = Date.now();
    const lector = await abrirFlujo().lector();
    const texto = await lector.hasta("event: hora");
    expect(texto.startsWith("retry: 3000\n\n")).toBe(true);
    const [hora] = datosDe(texto, "hora");
    expect(Object.keys(hora)).toEqual(["ahora"]);
    expect(hora.ahora as number).toBeGreaterThanOrEqual(antes);
    expect(hora.ahora as number).toBeLessThanOrEqual(Date.now());
  });

  it("manda un cambio en menos de 300 ms", async () => {
    const lector = await abrirFlujo().lector();
    await lector.hasta("event: hora");
    const inicio = Date.now();
    avisarCambio("leads");
    const texto = await lector.hasta("event: cambio", 300);
    expect(Date.now() - inicio).toBeLessThan(300);
    const [cambio] = datosDe(texto, "cambio");
    expect(cambio).toEqual({ tipo: "leads", rev: expect.any(Number) });
    expect(Object.keys(cambio)).toEqual(["tipo", "rev"]);
  });

  it("manda la llegada con solo sus cuatro campos", async () => {
    const lector = await abrirFlujo().lector();
    await lector.hasta("event: hora");
    avisarLlegada({ ...llegada, telefono: "34612345678" } as Llegada);
    const texto = await lector.hasta("event: llegada\n");
    const [dato] = datosDe(texto, "llegada");
    expect(Object.keys(dato).sort()).toEqual(["canal", "inicio", "leadId", "nombre"]);
    expect(dato).toEqual({ ...llegada });
    expect(texto).not.toContain("telefono");
  });

  it("manda la llegada fallida con su código y su título", async () => {
    const lector = await abrirFlujo().lector();
    await lector.hasta("event: hora");
    avisarLlegadaFallida({ ...fallo, causa: "token-secreto" } as LlegadaFallida);
    const texto = await lector.hasta("event: llegada-fallida");
    const [dato] = datosDe(texto, "llegada-fallida");
    expect(dato).toEqual({ ...fallo });
    expect(Object.keys(dato).sort()).toEqual(["codigo", "leadId", "nombre", "texto"]);
    expect(texto).not.toContain("token-secreto");
  });

  it("latido cada 20 s y hora cada 60 s", async () => {
    vi.useFakeTimers();
    const { respuesta } = abrirFlujo();
    const reader = (await respuesta).body!.getReader();
    const decoder = new TextDecoder();
    const inicio = await leerYa(reader, decoder, 2);
    expect(datosDe(inicio, "hora")).toHaveLength(1);

    vi.advanceTimersByTime(20_000);
    expect(await leerYa(reader, decoder)).toBe(": latido\n\n");
    vi.advanceTimersByTime(20_000);
    expect(await leerYa(reader, decoder)).toBe(": latido\n\n");
    vi.advanceTimersByTime(20_000);
    const minuto = await leerYa(reader, decoder, 2);
    expect(minuto).toContain(": latido\n\n");
    const [hora] = datosDe(minuto.replace(": latido\n\n", ""), "hora");
    expect(hora.ahora).toBe(Date.now());
    reader.releaseLock();
  });

  it("al cortar la conexión deja de escuchar", async () => {
    const antes = contador.activos;
    const flujo = abrirFlujo();
    const lector = await flujo.lector();
    await lector.hasta("event: hora");
    expect(contador.activos).toBe(antes + 1);
    flujo.cortar();
    const { terminado } = await lector.final();
    expect(terminado).toBe(true);
    expect(contador.activos).toBe(antes);
    // Tras el corte, un aviso no llega a nadie ni lanza.
    expect(() => avisarLlegada(llegada)).not.toThrow();
  });

  it("las cabeceras son las de un flujo de eventos", async () => {
    const r = await abrirFlujo().respuesta;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(r.headers.get("connection")).toBe("keep-alive");
    expect(r.headers.get("x-accel-buffering")).toBe("no");
  });
});
