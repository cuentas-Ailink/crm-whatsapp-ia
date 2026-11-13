// Los dos sonidos del panel (cliente/sonido.ts) con los números de F49, con un AudioContext de mentira:
// «llegada», dos senos de 659 y 988 Hz con 120 ms entre ellos; «turno», dos golpes de 440 Hz con 160 ms;
// ataque de 10 ms, caída de 300 ms y volumen 0,08. Vive en lib/ porque vitest solo mira lib/**.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Ganancia {
  rampas: [valor: number, cuando: number][];
}

interface Nota {
  frecuencia: number;
  empieza: number;
  ganancia: Ganancia | null;
}

let notas: Nota[] = [];

/** Lo justo de AudioContext para ver qué notas se tocan y con qué envolvente. */
class ContextoFalso {
  state = "running";
  currentTime = 1;
  destination = {};
  createOscillator() {
    const nota: Nota = { frecuencia: 0, empieza: -1, ganancia: null };
    notas.push(nota);
    return {
      type: "",
      frequency: { setValueAtTime: (f: number) => void (nota.frecuencia = f) },
      connect: (g: Ganancia & { connect: (d: unknown) => unknown }) => {
        nota.ganancia = g;
        return g;
      },
      start: (t: number) => void (nota.empieza = t),
      stop: () => undefined,
    };
  }
  createGain() {
    const g = {
      rampas: [] as [number, number][],
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: (v: number, t: number) => void g.rampas.push([v, t]),
      },
      connect: (d: unknown) => d,
    };
    return g;
  }
  resume() {
    return Promise.resolve();
  }
}

async function cargar() {
  vi.resetModules();
  const almacen = new Map<string, string>();
  vi.stubGlobal("window", {
    AudioContext: ContextoFalso,
    localStorage: { getItem: (k: string) => almacen.get(k) ?? null, setItem: (k: string, v: string) => almacen.set(k, v), removeItem: (k: string) => almacen.delete(k) },
  });
  return import("../cliente/sonido");
}

const redondear = (n: number) => Math.round(n * 1000) / 1000;

beforeEach(() => {
  notas = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sonidos del panel (F49)", () => {
  it("sin desbloquear no suena nada", async () => {
    const { sonar } = await cargar();
    sonar("llegada");
    sonar("turno");
    expect(notas).toEqual([]);
  });

  it("«llegada»: 659 Hz y 988 Hz, 120 ms entre ellas, ataque 10 ms, caída 300 ms, volumen 0,08", async () => {
    const { desbloquearSonido, sonar } = await cargar();
    desbloquearSonido();
    sonar("llegada");
    expect(notas.map((n) => n.frecuencia)).toEqual([659, 988]);
    expect(redondear(notas[1].empieza - notas[0].empieza)).toBe(0.12);
    for (const n of notas) {
      expect(n.ganancia?.rampas.map(([v, t]) => [v, redondear(t - n.empieza)])).toEqual([
        [0.08, 0.01],
        [0.0001, 0.31],
      ]);
    }
  });

  it("«turno»: dos golpes de 440 Hz con 160 ms entre ellos", async () => {
    const { desbloquearSonido, sonar } = await cargar();
    desbloquearSonido();
    sonar("turno");
    expect(notas.map((n) => n.frecuencia)).toEqual([440, 440]);
    expect(redondear(notas[1].empieza - notas[0].empieza)).toBe(0.16);
    for (const n of notas) expect(n.ganancia?.rampas.map(([v, t]) => [v, redondear(t - n.empieza)])).toEqual([[0.08, 0.01], [0.0001, 0.31]]);
  });

  it("silenciado no suena y se recuerda en crm:sonido", async () => {
    const { desbloquearSonido, sonar, useSilencio } = await cargar();
    expect(typeof useSilencio).toBe("function");
    const w = (globalThis as unknown as { window: { localStorage: Storage } }).window;
    w.localStorage.setItem("crm:sonido", "no");
    // El silencio se lee al cargar el módulo: se vuelve a cargar con el valor guardado.
    vi.resetModules();
    const otro = await import("../cliente/sonido");
    otro.desbloquearSonido();
    otro.sonar("llegada");
    expect(notas).toEqual([]);
    desbloquearSonido();
    sonar("turno");
    expect(notas).toHaveLength(2);
  });
});
