import { describe, expect, it } from "vitest";
import {
  agruparMensajes,
  asistenteCallado,
  esperaDesde,
  MS_GRUPO,
  MS_SIN_CONTESTAR,
  sinResponder,
  textoVentana,
  tipoRemitente,
  ultimoMensaje,
  ventana24h,
  visitaSinCerrar,
  volvioAEscribir,
  type ItemHilo,
} from "./hilo";
import { crearLead } from "./negocio";
import type { Lead, Mensaje } from "./tipos";

const T = Date.UTC(2026, 10, 11, 12, 0); // miércoles 11 nov 2026, 12:00 UTC

function m(de: Mensaje["de"], ts: number, texto = "hola"): Mensaje {
  return { id: `${de}-${ts}`, de, texto, ts };
}

function lead(campos: Partial<Lead> = {}): Lead {
  return crearLead({ telefono: "34612345678", perfilId: "estudio-de-reformas", perfilNombre: "Estudio de reformas", nombre: "Laura", origen: "whatsapp", ...campos });
}

describe("ultimoMensaje, sinResponder y esperaDesde", () => {
  it("sin mensajes", () => {
    const l = lead();
    expect(ultimoMensaje(l)).toBeUndefined();
    expect(sinResponder(l)).toBe(0);
    expect(esperaDesde(l)).toBeNull();
  });

  it("cuenta los mensajes del cliente tras el último del asistente", () => {
    const l = lead({ mensajes: [m("cliente", 1), m("agente", 2), m("cliente", 3), m("cliente", 4)] });
    expect(ultimoMensaje(l)?.ts).toBe(4);
    expect(sinResponder(l)).toBe(2);
    expect(esperaDesde(l)).toBe(3);
  });

  it("sin mensajes del asistente, cuenta todos los del cliente", () => {
    const l = lead({ mensajes: [m("cliente", 5), m("cliente", 6)] });
    expect(sinResponder(l)).toBe(2);
    expect(esperaDesde(l)).toBe(5);
  });

  it("si el último es del asistente, no espera nadie", () => {
    const l = lead({ mensajes: [m("cliente", 1), m("agente", 2)] });
    expect(sinResponder(l)).toBe(0);
    expect(esperaDesde(l)).toBeNull();
  });
});

describe("asistenteCallado", () => {
  const espera = lead({ estado: "conversacion", mensajes: [m("agente", T - 600_000), m("cliente", T - 300_000)] });
  const ahora = T;

  it("un cliente sin respuesta hace más de 2 minutos es un fallo", () => {
    expect(asistenteCallado(espera, ahora, false, null)).toBe("fallo");
  });

  it("con el asistente en pausa es una pausa", () => {
    expect(asistenteCallado(espera, ahora, false, T - 1_000_000)).toBe("pausa");
  });

  it("exactamente 120 000 ms aún no es «Sin contestar»; 120 001, sí", () => {
    const l = lead({ estado: "nuevo", mensajes: [m("cliente", T)] });
    expect(asistenteCallado(l, T + MS_SIN_CONTESTAR, false, null)).toBeNull();
    expect(asistenteCallado(l, T + 120_001, false, null)).toBe("fallo");
  });

  it("vale para los estados nuevo, conversación y visita", () => {
    for (const estado of ["nuevo", "conversacion", "visita"] as const) {
      expect(asistenteCallado({ ...espera, estado }, ahora, false, null)).toBe("fallo");
    }
  });

  it("cada exclusión da null", () => {
    expect(asistenteCallado({ ...espera, ejemplo: true }, ahora, false, null)).toBeNull();
    expect(asistenteCallado({ ...espera, origen: "prueba" }, ahora, false, null)).toBeNull();
    expect(asistenteCallado({ ...espera, cierre: "si", cierreEn: T - 400_000 }, ahora, false, null)).toBeNull();
    expect(asistenteCallado({ ...espera, cierre: "no", cierreEn: T - 400_000, motivoCierre: "Precio" }, ahora, false, null)).toBeNull();
    expect(asistenteCallado({ ...espera, estado: "persona" }, ahora, false, null)).toBeNull();
    expect(asistenteCallado({ ...espera, estado: "spam" }, ahora, false, null)).toBeNull();
    expect(asistenteCallado({ ...espera, silenciadoEn: T - 200_000 }, ahora, false, null)).toBeNull();
    expect(asistenteCallado(espera, ahora, true, null)).toBeNull();
    expect(asistenteCallado({ ...espera, mensajes: [m("cliente", T - 300_000), m("agente", T - 200_000)] }, ahora, false, null)).toBeNull();
  });
});

describe("visitaSinCerrar", () => {
  const visita = { id: "2026-11-11T10:00", texto: "miércoles 11 nov a las 10:00" };

  it("a las 12:00 UTC la visita de las 10:00 ya pasó en Madrid y aún no en Ciudad de México", () => {
    const l = lead({ estado: "visita", visita });
    expect(visitaSinCerrar(l, T)).toBe(true);
    expect(visitaSinCerrar(l, T, "Europe/Madrid")).toBe(true);
    expect(visitaSinCerrar(l, T, "America/Mexico_City")).toBe(false);
  });

  it("cerrado o sin visita, no", () => {
    expect(visitaSinCerrar(lead({ estado: "visita", visita, cierre: "si", cierreEn: T - 1 }), T)).toBe(false);
    expect(visitaSinCerrar(lead({ estado: "conversacion" }), T)).toBe(false);
  });
});

describe("volvioAEscribir", () => {
  const cerrado = lead({ cierre: "no", motivoCierre: "Precio", cierreEn: T, mensajes: [m("cliente", T - 1000), m("agente", T - 500)] });

  it("un mensaje del cliente después del cierre", () => {
    expect(volvioAEscribir(cerrado)).toBe(false);
    expect(volvioAEscribir({ ...cerrado, mensajes: [...cerrado.mensajes, m("cliente", T + 1000)] })).toBe(true);
  });

  it("si el dueño ya lo vio después, no; un mensaje más nuevo, otra vez sí", () => {
    const visto = { ...cerrado, mensajes: [...cerrado.mensajes, m("cliente", T + 1000)], vueltaVistaEn: T + 2000 };
    expect(volvioAEscribir(visto)).toBe(false);
    expect(volvioAEscribir({ ...visto, mensajes: [...visto.mensajes, m("cliente", T + 3000)] })).toBe(true);
  });

  it("sin cierre, no", () => {
    expect(volvioAEscribir(lead({ mensajes: [m("cliente", T + 1000)] }))).toBe(false);
  });

  it("un mensaje del asistente después del cierre no cuenta", () => {
    expect(volvioAEscribir({ ...cerrado, mensajes: [...cerrado.mensajes, m("agente", T + 1000)] })).toBe(false);
  });
});

describe("ventana24h", () => {
  const DIA = 86_400_000;
  const l = lead({ mensajes: [m("cliente", T), m("agente", T + 1000)] });

  it("abierta durante 24 h desde el último mensaje del cliente", () => {
    expect(ventana24h(l, T + 1000)).toEqual({ abierta: true, hasta: T + DIA });
  });

  it("cerrada después", () => {
    expect(ventana24h(l, T + DIA + 1)).toEqual({ abierta: false, hasta: T + DIA });
  });

  it("exactamente a las 24 h ya está cerrada", () => {
    expect(ventana24h(l, T + DIA)).toEqual({ abierta: false, hasta: T + DIA });
  });

  it("sin mensajes del cliente", () => {
    expect(ventana24h(lead({ mensajes: [m("agente", T)] }), T)).toEqual({ abierta: false, hasta: null });
  });
});

// ---- Fase 3: el hilo pintado (W13) ----

const BIENVENIDAS = ["solicitud_recibida", "solicitud_general"];
const MADRID = "Europe/Madrid";

/** Lo que se ve del hilo, en corto: «#Hoy» para un día y «remitente:n» para un grupo de n mensajes. */
function resumen(items: ItemHilo[]): string[] {
  return items.map((i) => (i.tipo === "dia" ? `#${i.texto}` : `${i.grupo.remitente}:${i.grupo.mensajes.length}`));
}

const opciones = { zona: MADRID, ahora: T, nombreCliente: "Laura", bienvenidas: BIENVENIDAS };

describe("tipoRemitente", () => {
  it("cliente, asistente y tú", () => {
    expect(tipoRemitente(m("cliente", 1), BIENVENIDAS)).toBe("cliente");
    expect(tipoRemitente(m("agente", 1), BIENVENIDAS)).toBe("asistente");
    expect(tipoRemitente({ ...m("agente", 1), manual: true }, BIENVENIDAS)).toBe("manual");
  });

  it("la bienvenida por su nombre, la plantilla antigua sin nombre y cualquier otra aprobada", () => {
    expect(tipoRemitente({ ...m("agente", 1), plantilla: true, nombrePlantilla: "solicitud_general" }, BIENVENIDAS)).toBe("bienvenida");
    expect(tipoRemitente({ ...m("agente", 1), plantilla: true, nombrePlantilla: "bienvenida_clinica" }, ["bienvenida_clinica"])).toBe("bienvenida");
    expect(tipoRemitente({ ...m("agente", 1), plantilla: true }, BIENVENIDAS)).toBe("bienvenida");
    expect(tipoRemitente({ ...m("agente", 1), plantilla: true, nombrePlantilla: "retomar_conversacion" }, BIENVENIDAS)).toBe("aprobado");
  });
});

describe("agruparMensajes", () => {
  it("junta los seguidos del mismo remitente a menos de 2 minutos", () => {
    const items = agruparMensajes([m("cliente", T - 60_000), m("cliente", T - 30_000), m("agente", T - 20_000), m("agente", T)], opciones);
    expect(resumen(items)).toEqual(["#Hoy", "Laura:2", "Tu asistente:2"]);
  });

  it("separa cuando pasan más de 2 minutos", () => {
    const justo = agruparMensajes([m("cliente", T - MS_GRUPO), m("cliente", T)], opciones);
    expect(resumen(justo)).toEqual(["#Hoy", "Laura:2"]);
    const despues = agruparMensajes([m("cliente", T - MS_GRUPO - 1), m("cliente", T)], opciones);
    expect(resumen(despues)).toEqual(["#Hoy", "Laura:1", "Laura:1"]);
  });

  it("un cambio de remitente corta el grupo, y los ordena por hora", () => {
    const manual = { ...m("agente", T - 10_000), manual: true };
    const items = agruparMensajes([m("agente", T), manual, m("agente", T - 20_000)], opciones);
    expect(resumen(items)).toEqual(["#Hoy", "Tu asistente:1", "Tú:1", "Tu asistente:1"]);
  });

  it("una plantilla va siempre sola", () => {
    const bienvenida = (ts: number) => ({ ...m("agente", ts), plantilla: true, nombrePlantilla: "solicitud_general" });
    const otra = { ...m("agente", T - 5_000), plantilla: true, nombrePlantilla: "retomar_conversacion" };
    const items = agruparMensajes([bienvenida(T - 30_000), bienvenida(T - 20_000), otra, m("agente", T)], opciones);
    expect(resumen(items)).toEqual(["#Hoy", "Mensaje de bienvenida:1", "Mensaje de bienvenida:1", "Mensaje aprobado:1", "Tu asistente:1"]);
  });

  it("separadores: «Hoy», «Ayer», el día y, en otro año, también el año", () => {
    const lunes = Date.UTC(2026, 10, 9, 10, 0);
    const ayer = Date.UTC(2026, 10, 10, 10, 0);
    const otroAno = Date.UTC(2025, 10, 10, 10, 0);
    const items = agruparMensajes([m("cliente", otroAno), m("cliente", lunes), m("cliente", ayer), m("cliente", T)], opciones);
    expect(resumen(items)).toEqual(["#lunes 10 nov 2025", "Laura:1", "#lunes 9 nov", "Laura:1", "#Ayer", "Laura:1", "#Hoy", "Laura:1"]);
  });

  it("de un día a otro corta aunque no pasen 2 minutos, en la zona del negocio (Ciudad de México)", () => {
    // 23:55 y 00:05 en Ciudad de México (UTC−6): 10 minutos y dos días distintos.
    const antes = Date.UTC(2026, 10, 11, 5, 55);
    const despues = Date.UTC(2026, 10, 11, 6, 5);
    const o = { ...opciones, zona: "America/Mexico_City", ahora: Date.UTC(2026, 10, 11, 18, 0) };
    expect(resumen(agruparMensajes([m("cliente", antes), m("cliente", despues)], o))).toEqual(["#Ayer", "Laura:1", "#Hoy", "Laura:1"]);
    // A un minuto, pero a cada lado de la medianoche: también dos días.
    const casi = Date.UTC(2026, 10, 11, 5, 59, 30);
    const pasada = Date.UTC(2026, 10, 11, 6, 0, 30);
    expect(resumen(agruparMensajes([m("cliente", casi), m("cliente", pasada)], o))).toEqual(["#Ayer", "Laura:1", "#Hoy", "Laura:1"]);
    // En Madrid son las 6:59 y las 7:00 del mismo día: un solo grupo, sin separador en medio.
    expect(resumen(agruparMensajes([m("cliente", casi), m("cliente", pasada)], { ...o, zona: MADRID }))).toEqual(["#Hoy", "Laura:2"]);
  });

  it("sin mensajes, nada", () => {
    expect(agruparMensajes([], opciones)).toEqual([]);
  });
});

describe("textoVentana", () => {
  it("hasta hoy o hasta mañana, con la hora de la zona", () => {
    // T son las 13:00 en Madrid.
    expect(textoVentana({ abierta: true, hasta: T + 5 * 3_600_000 + 40 * 60_000 }, T, MADRID)).toBe("Puedes escribirle hasta las 18:40");
    expect(textoVentana({ abierta: true, hasta: T + 20 * 3_600_000 }, T, MADRID)).toBe("Puedes escribirle hasta mañana a las 09:00");
  });

  it("la zona cambia la hora y el día", () => {
    // 22:00 UTC: 23:00 en Madrid (hoy) y 16:00 en Ciudad de México.
    const hasta = Date.UTC(2026, 10, 11, 22, 0);
    expect(textoVentana({ abierta: true, hasta }, T, MADRID)).toBe("Puedes escribirle hasta las 23:00");
    expect(textoVentana({ abierta: true, hasta }, T, "America/Mexico_City")).toBe("Puedes escribirle hasta las 16:00");
    expect(textoVentana({ abierta: true, hasta: hasta + 2 * 3_600_000 }, T, MADRID)).toBe("Puedes escribirle hasta mañana a las 01:00");
  });

  it("cerrada o sin ventana, null", () => {
    expect(textoVentana({ abierta: false, hasta: T - 1 }, T, MADRID)).toBeNull();
    expect(textoVentana({ abierta: false, hasta: null }, T, MADRID)).toBeNull();
  });
});
