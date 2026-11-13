import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alPedirRefrescoConexiones,
  crearRefrescoConexiones,
  debeForzar,
  FONDO_CONEXIONES_MS,
  MARGEN_REFRESCO_MS,
  motivoDeEvento,
  pedirRefrescoConexiones,
  type MotivoRefresco,
} from "./refresco-conexiones";

// Cuándo vuelve a mirar el panel las conexiones: al momento tras cada acción que las cambia (juntando
// los avisos seguidos en una petición), forzando la caché si la acción es de esta pestaña, y de fondo
// cada 5 minutos.

function montar(visible = true) {
  const llamadas: boolean[] = [];
  const estado = { visible };
  const r = crearRefrescoConexiones({ comprobar: (forzar) => llamadas.push(forzar), visible: () => estado.visible });
  return { r, llamadas, estado };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("motivos", () => {
  it("las acciones de esta pestaña fuerzan la caché; el aviso del servidor no", () => {
    const forzados: MotivoRefresco[] = ["puesta-terminada", "conectar", "clave", "modo-prueba"];
    for (const m of forzados) expect(debeForzar(m)).toBe(true);
    expect(debeForzar("sistema")).toBe(false);
  });

  it("solo el cambio «sistema» del servidor toca a las conexiones", () => {
    expect(motivoDeEvento({ tipo: "cambio", cambio: { tipo: "sistema" } })).toBe("sistema");
    expect(motivoDeEvento({ tipo: "cambio", cambio: { tipo: "leads" } })).toBeNull();
    expect(motivoDeEvento({ tipo: "cambio", cambio: { tipo: "configuracion" } })).toBeNull();
    expect(motivoDeEvento({ tipo: "cambio", cambio: { tipo: "escribiendo" } })).toBeNull();
    expect(motivoDeEvento({ tipo: "llegada" })).toBeNull();
  });
});

describe("crearRefrescoConexiones", () => {
  it("el primer suscriptor mira al momento, sin forzar", () => {
    const { r, llamadas } = montar();
    r.suscribir();
    expect(llamadas).toEqual([false]);
    r.suscribir();
    expect(llamadas).toEqual([false]);
  });

  it("al terminar la puesta en marcha mira enseguida y fuerza la caché del servidor", () => {
    const { r, llamadas } = montar();
    r.suscribir();
    llamadas.length = 0;
    r.pedir("puesta-terminada");
    expect(llamadas).toEqual([]);
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    expect(llamadas).toEqual([true]);
  });

  it("cada disparador vuelve a mirar: «Conectar», una clave, el modo prueba y el aviso del servidor", () => {
    const { r, llamadas } = montar();
    r.suscribir();
    llamadas.length = 0;
    for (const m of ["conectar", "clave", "modo-prueba", "sistema"] as MotivoRefresco[]) {
      r.pedir(m);
      vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    }
    expect(llamadas).toEqual([true, true, true, false]);
  });

  it("muchos avisos seguidos salen en una sola petición, forzada si alguno lo pedía", () => {
    const { r, llamadas } = montar();
    r.suscribir();
    llamadas.length = 0;
    r.pedir("sistema");
    r.pedir("clave");
    for (let i = 0; i < 20; i++) r.pedir("sistema");
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    expect(llamadas).toEqual([true]);
    // Pasado el margen, el siguiente aviso es otra petición, y sin forzar si nadie lo pide.
    r.pedir("sistema");
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    expect(llamadas).toEqual([true, false]);
  });

  it("los avisos seguidos no retrasan la petición más allá del margen", () => {
    const { r, llamadas } = montar();
    r.suscribir();
    llamadas.length = 0;
    r.pedir("sistema");
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS - 10);
    r.pedir("sistema");
    vi.advanceTimersByTime(10);
    expect(llamadas).toEqual([false]);
  });

  it("de fondo, cada 5 minutos y solo con la pestaña a la vista", () => {
    const { r, llamadas, estado } = montar();
    r.suscribir();
    llamadas.length = 0;
    vi.advanceTimersByTime(FONDO_CONEXIONES_MS - 1);
    expect(llamadas).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(llamadas).toEqual([false]);
    estado.visible = false;
    vi.advanceTimersByTime(FONDO_CONEXIONES_MS);
    expect(llamadas).toEqual([false]);
    estado.visible = true;
    vi.advanceTimersByTime(FONDO_CONEXIONES_MS);
    expect(llamadas).toEqual([false, false]);
  });

  it("sin nadie mirando no pide nada, pero el primero que mire lo cobra (forzado si se debía)", () => {
    const { r, llamadas } = montar();
    const dejar = r.suscribir();
    dejar();
    llamadas.length = 0;
    r.pedir("conectar");
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    vi.advanceTimersByTime(FONDO_CONEXIONES_MS * 2);
    expect(llamadas).toEqual([]);
    r.suscribir();
    expect(llamadas).toEqual([true]);
  });

  it("si alguien empieza a mirar con un aviso a punto de salir, sale uno solo", () => {
    const { r, llamadas } = montar();
    r.pedir("clave");
    r.suscribir();
    expect(llamadas).toEqual([]);
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    expect(llamadas).toEqual([true]);
  });

  it("dejar de mirar dos veces no descuenta dos", () => {
    const { r, llamadas } = montar();
    const a = r.suscribir();
    r.suscribir();
    a();
    a();
    llamadas.length = 0;
    vi.advanceTimersByTime(FONDO_CONEXIONES_MS);
    expect(llamadas).toEqual([false]);
  });

  it("parar olvida el aviso pendiente", () => {
    const { r, llamadas } = montar();
    r.suscribir();
    llamadas.length = 0;
    r.pedir("conectar");
    r.parar();
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS * 4);
    expect(llamadas).toEqual([]);
  });

  it("si comprobar falla, el siguiente aviso vuelve a mirar", () => {
    let veces = 0;
    const r = crearRefrescoConexiones({
      comprobar: () => {
        veces++;
        throw new Error("sin red");
      },
      visible: () => true,
    });
    r.suscribir();
    r.pedir("sistema");
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    expect(veces).toBe(2);
  });
});

describe("avisos de la pestaña", () => {
  it("llegan a quien escucha y dejan de llegar al soltarlo", () => {
    const oidos: MotivoRefresco[] = [];
    const dejar = alPedirRefrescoConexiones((m) => oidos.push(m));
    pedirRefrescoConexiones("puesta-terminada");
    pedirRefrescoConexiones("clave");
    dejar();
    pedirRefrescoConexiones("conectar");
    expect(oidos).toEqual(["puesta-terminada", "clave"]);
  });

  it("un oyente que falla no impide que les llegue a los demás", () => {
    const oidos: MotivoRefresco[] = [];
    const a = alPedirRefrescoConexiones(() => {
      throw new Error("mal");
    });
    const b = alPedirRefrescoConexiones((m) => oidos.push(m));
    pedirRefrescoConexiones("modo-prueba");
    a();
    b();
    expect(oidos).toEqual(["modo-prueba"]);
  });

  it("de punta a punta: el fin de la puesta en marcha llega al programador y sale forzado", () => {
    const { r, llamadas } = montar();
    r.suscribir();
    llamadas.length = 0;
    const dejar = alPedirRefrescoConexiones((m) => r.pedir(m));
    pedirRefrescoConexiones("puesta-terminada");
    vi.advanceTimersByTime(MARGEN_REFRESCO_MS);
    dejar();
    expect(llamadas).toEqual([true]);
  });
});
