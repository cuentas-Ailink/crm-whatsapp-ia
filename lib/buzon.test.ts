import { beforeEach, describe, expect, it, vi } from "vitest";
import { buzon, type Ejecucion } from "./buzon";
import type { Lote } from "./tipos";

// El buzón solo necesita saber si un mensaje ya había llegado: esa parte de la base de datos se
// prueba en bd.test.ts.
const { vistos, esperas } = vi.hoisted(() => ({ vistos: new Set<string>(), esperas: new Map<string, Promise<void>>() }));
vi.mock("./bd", () => ({
  registrarMensaje: async (wamid: string) => {
    await esperas.get(wamid);
    return !vistos.has(wamid) && !!vistos.add(wamid);
  },
}));

/** Hace que apuntar ese mensaje en la base de datos tarde hasta que se llame a la función. */
function retener(wamid: string): () => void {
  let soltar = () => {};
  esperas.set(wamid, new Promise<void>((r) => (soltar = r)));
  return soltar;
}

function mensaje(wamid: string, telefono = "34612345678") {
  return { wamid, telefono, nombrePerfil: "Ana", tipo: "texto" as const, texto: "hola", ts: Date.now() };
}

const procesados: { lote: Lote; ejecucion: Ejecucion }[] = [];
const procesar = async (lote: Lote, ejecucion: Ejecucion) => {
  procesados.push({ lote, ejecucion });
};

beforeEach(() => {
  vi.useFakeTimers();
  buzon.reiniciar();
  vistos.clear();
  esperas.clear();
  procesados.length = 0;
});

describe("agrupar mensajes", () => {
  it("varios seguidos forman un solo lote con todos", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    vi.advanceTimersByTime(1_000);
    await buzon.recibir(mensaje("w2"), procesar);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(procesados).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(procesados).toHaveLength(1);
    expect(procesados[0].lote.mensajes.map((m) => m.wamid)).toEqual(["w1", "w2"]);
  });

  it("entran en el orden en que llegan, aunque apuntar uno tarde más", async () => {
    const soltar = retener("w1");
    const primero = buzon.recibir(mensaje("w1"), procesar);
    const segundo = buzon.recibir(mensaje("w2"), procesar);
    soltar();
    expect(await primero).toBe(true);
    expect(await segundo).toBe(true);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(procesados[0].lote.mensajes.map((m) => m.wamid)).toEqual(["w1", "w2"]);
  });

  it("descarta los duplicados y los reintentos antiguos de Meta", async () => {
    expect(await buzon.recibir(mensaje("w1"), procesar)).toBe(true);
    expect(await buzon.recibir(mensaje("w1"), procesar)).toBe(false);
    expect(await buzon.recibir({ ...mensaje("w2"), ts: Date.now() - 600_000 }, procesar)).toBe(false);
  });
});

describe("un mensaje nuevo mientras se contesta", () => {
  it("cancela lo que aún no se ha enviado y rehace el lote con todos", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;

    await buzon.recibir(mensaje("w2"), procesar);
    expect(primero.ejecucion.controlador.signal.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(1_600);
    expect(procesados[1].lote.mensajes.map((m) => m.wamid)).toEqual(["w1", "w2"]);
  });

  it("si ya se está enviando no se cancela, y lo nuevo va en otro lote", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;
    buzon.empezarEnvio(primero.ejecucion, primero.lote);

    await buzon.recibir(mensaje("w2"), procesar);
    expect(primero.ejecucion.controlador.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1_600);
    expect(procesados[1].lote.mensajes.map((m) => m.wamid)).toEqual(["w2"]);
  });

  it("no afecta a otro número", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;
    await buzon.recibir(mensaje("w2", "34699999999"), procesar);
    expect(primero.ejecucion.controlador.signal.aborted).toBe(false);
  });
});

describe("una persona coge la conversación", () => {
  it("cancela lo que aún no se ha enviado y vuelve a pasar esos mensajes", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;

    buzon.tomarControl("34612345678", procesar);
    expect(primero.ejecucion.controlador.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(procesados).toHaveLength(2);
    expect(procesados[1].lote.mensajes.map((m) => m.wamid)).toEqual(["w1"]);
  });

  it("si ya se ha enviado, o no hay nada en curso, no hace nada", async () => {
    buzon.tomarControl("34612345678", procesar);
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;
    buzon.empezarEnvio(primero.ejecucion, primero.lote);

    buzon.tomarControl("34612345678", procesar);
    expect(primero.ejecucion.controlador.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(procesados).toHaveLength(1);
  });
});

describe("la cola", () => {
  it("procesa de uno en uno y sigue aunque uno falle", async () => {
    const orden: string[] = [];
    let terminarPrimero = () => {};
    const lento = (lote: Lote) => {
      orden.push(`empieza ${lote.telefono}`);
      if (lote.telefono !== "1") return Promise.resolve();
      return new Promise<void>((_, rechazar) => {
        terminarPrimero = () => rechazar(new Error("fallo"));
      });
    };

    await buzon.recibir(mensaje("w1", "1"), lento);
    await buzon.recibir(mensaje("w2", "2"), lento);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(orden).toEqual(["empieza 1"]);

    terminarPrimero();
    await vi.advanceTimersByTimeAsync(0);
    expect(orden).toEqual(["empieza 1", "empieza 2"]);
  });
});

describe("reiniciar", () => {
  it("lo que estaba entrando en ese momento ya no cuenta", async () => {
    const soltar = retener("w1");
    const entrada = buzon.recibir(mensaje("w1"), procesar);
    buzon.reiniciar();
    soltar();
    expect(await entrada).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(procesados).toHaveLength(0);
  });

  it("cancela lo que esté en curso y descarta lo que estuviera esperando", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;
    await buzon.recibir(mensaje("w2", "34699999999"), procesar);

    buzon.reiniciar();

    expect(primero.ejecucion.controlador.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(procesados).toHaveLength(1);
  });
});

describe("olvidar un número (W13: borrar sus datos)", () => {
  it("tira el lote pendiente: no se procesa al acabar el silencio", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    buzon.olvidar("34612345678");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(procesados).toHaveLength(0);
  });

  it("cancela lo que se estaba contestando y no lo rehace", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;
    buzon.olvidar("34612345678");
    expect(primero.ejecucion.controlador.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(procesados).toHaveLength(1);
  });

  it("no cancela lo que ya se está enviando", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    const [primero] = procesados;
    buzon.empezarEnvio(primero.ejecucion, primero.lote);
    buzon.olvidar("34612345678");
    expect(primero.ejecucion.controlador.signal.aborted).toBe(false);
  });

  it("los demás números siguen con su lote", async () => {
    await buzon.recibir(mensaje("w1", "34611111111"), procesar);
    await buzon.recibir(mensaje("w2", "34622222222"), procesar);
    buzon.olvidar("34611111111");
    await vi.advanceTimersByTimeAsync(1_600);
    expect(procesados).toHaveLength(1);
    expect(procesados[0].lote.telefono).toBe("34622222222");
    expect(procesados[0].lote.mensajes.map((m) => m.wamid)).toEqual(["w2"]);
  });

  it("un mensaje posterior del mismo número empieza un lote nuevo, sin los olvidados", async () => {
    await buzon.recibir(mensaje("w1"), procesar);
    buzon.olvidar("34612345678");
    await buzon.recibir(mensaje("w2"), procesar);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(procesados).toHaveLength(1);
    expect(procesados[0].lote.mensajes.map((m) => m.wamid)).toEqual(["w2"]);
  });

  it("un número sin nada pendiente no falla", () => {
    expect(() => buzon.olvidar("34699999999")).not.toThrow();
  });
});
