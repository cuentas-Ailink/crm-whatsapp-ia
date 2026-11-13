import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUARDADA_VACIA, type ConfiguracionResuelta } from "./configuracion";
import type { Perfil } from "./perfil";
import { resolver } from "./presets";

// La base de datos es la de verdad, en memoria (BD_LOCAL=memoria). guardarMutaciones se envuelve
// para poder hacerla fallar en una prueba.
vi.mock("./bd", async (original) => {
  const real = await original<typeof import("./bd")>();
  return { ...real, guardarMutaciones: vi.fn(real.guardarMutaciones) };
});
vi.mock("./whatsapp", async (original) => ({
  ...(await original<typeof import("./whatsapp")>()),
  enviarPlantillaConVariables: vi.fn(async () => "wamid.bienvenida"),
}));
vi.mock("./configuracion-servidor", () => ({ configuracionActiva: vi.fn() }));
vi.mock("./eventos", async (original) => ({
  ...(await original<typeof import("./eventos")>()),
  avisarLlegada: vi.fn(),
  avisarLlegadaFallida: vi.fn(),
}));

const { darDeAlta } = await import("./alta");
const bd = await import("./bd");
const { ErrorWhatsApp, enviarPlantillaConVariables } = await import("./whatsapp");
const { configuracionActiva } = await import("./configuracion-servidor");
const { avisarLlegada, avisarLlegadaFallida } = await import("./eventos");

const PERFIL: Perfil = { id: "estudio-de-reformas", nombre: "Estudio de reformas", instrucciones: "# Instrucciones", hash: "" };
const NEGOCIO = "Estudio de reformas";

function configuracion(cambiar?: (c: ConfiguracionResuelta) => void): ConfiguracionResuelta {
  const config = resolver({ perfil: { id: PERFIL.id, nombre: PERFIL.nombre, hash: "" }, guardada: GUARDADA_VACIA, entorno: { NOMBRE_NEGOCIO: NEGOCIO } });
  cambiar?.(config);
  return config;
}

function usar(config: ConfiguracionResuelta, perfil: Perfil = PERFIL): void {
  vi.mocked(configuracionActiva).mockImplementation(async () => ({ perfil, config }));
}

const formulario = (extra: Record<string, unknown> = {}) =>
  darDeAlta({ nombre: "Laura Martínez", telefono: "612 345 678", origen: "formulario", permiso: true, ...extra } as Parameters<typeof darDeAlta>[0]);
const aMano = (extra: Record<string, unknown> = {}) =>
  darDeAlta({ nombre: "Marta Soler", telefono: "612 000 111", origen: "manual", permiso: false, ...extra } as Parameters<typeof darDeAlta>[0]);
const idDe = (telefono: string) => `${telefono}:${PERFIL.id}`;
const lineas = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0]));

beforeEach(async () => {
  vi.clearAllMocks();
  delete (globalThis as { __bienvenidasRecientes?: unknown }).__bienvenidasRecientes;
  delete process.env.CRM_DOMINIO;
  usar(configuracion());
  vi.mocked(enviarPlantillaConVariables).mockResolvedValue("wamid.bienvenida");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await bd.reiniciarBd(undefined, { ejemplos: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRM_DOMINIO;
});

describe("darDeAlta", () => {
  it("valida nombre, móvil y consentimiento con los textos del formulario y de + Cliente", async () => {
    expect(await formulario({ nombre: "   " })).toEqual({ ok: false, status: 400, error: "Escribe tu nombre", campo: "nombre" });
    expect(await formulario({ telefono: "123" })).toEqual({ ok: false, status: 400, error: "Revisa el teléfono", campo: "telefono" });
    expect(await formulario({ permiso: false })).toEqual({
      ok: false,
      status: 400,
      error: "Falta aceptar que te contactemos por WhatsApp",
      campo: "consentimiento",
    });
    expect(await aMano({ nombre: "" })).toEqual({ ok: false, status: 400, error: "Escribe su nombre", campo: "nombre" });
    expect(await aMano({ telefono: "abc" })).toEqual({ ok: false, status: 400, error: "Revisa el móvil", campo: "telefono" });
    expect(enviarPlantillaConVariables).not.toHaveBeenCalled();
    expect(avisarLlegada).not.toHaveBeenCalled();
    expect(await bd.contarLeads()).toBe(0);
  });

  it("la llegada sale antes de llamar a Meta", async () => {
    const orden: string[] = [];
    vi.mocked(avisarLlegada).mockImplementation(() => void orden.push("llegada"));
    vi.mocked(enviarPlantillaConVariables).mockImplementation(async () => {
      orden.push("meta");
      return "wamid.bienvenida";
    });
    const r = await formulario();
    expect(r).toEqual({ ok: true, leadId: idDe("34612345678"), enviado: true });
    expect(orden).toEqual(["llegada", "meta"]);
    expect(avisarLlegada).toHaveBeenCalledWith({ leadId: idDe("34612345678"), nombre: "Laura", canal: "formulario", inicio: expect.any(Number) });

    const lead = await bd.leerLead(idDe("34612345678"));
    expect(lead?.origen).toBe("formulario");
    expect(lead?.mensajes).toEqual([
      expect.objectContaining({ id: "wamid.bienvenida", de: "agente", plantilla: true, nombrePlantilla: "solicitud_general", entrega: "enviado" }),
    ]);
    expect(lead?.mensajes[0].texto).toContain("Laura Martínez");
    expect(lead?.msPrimerWhatsApp).toEqual(expect.any(Number));
    expect(lead?.actividad?.map((a) => a.texto)).toContain("Ha pedido que le escribamos por WhatsApp desde tu web");
  });

  it("dos envíos al mismo móvil en 60 s mandan una sola bienvenida", async () => {
    const [a, b] = await Promise.all([formulario(), formulario()]);
    expect([a, b]).toContainEqual({ ok: true, leadId: idDe("34612345678"), enviado: true });
    expect([a, b]).toContainEqual({ ok: true, leadId: idDe("34612345678"), enviado: false });
    // También entre el formulario y + Cliente.
    expect(await formulario()).toEqual({ ok: true, leadId: idDe("34612345678"), enviado: false });
    expect(enviarPlantillaConVariables).toHaveBeenCalledTimes(1);
    expect(lineas().some((l) => l.includes("Bienvenida repetida en menos de 60 s: no se vuelve a enviar (+34 6•• ••• •••)"))).toBe(true);
    expect((await bd.leerLead(idDe("34612345678")))?.mensajes).toHaveLength(1);

    // Pasado el minuto, sí.
    const ahora = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(ahora + 61_000);
    expect(await formulario()).toEqual({ ok: true, leadId: idDe("34612345678"), enviado: true });
    expect(enviarPlantillaConVariables).toHaveBeenCalledTimes(2);
  });

  it("si Meta falla: llegada-fallida, 502 con el código y la causa solo en local, y no se guarda", async () => {
    vi.mocked(enviarPlantillaConVariables).mockRejectedValue(new ErrorWhatsApp("x", 132001, "Template name does not exist in the translation"));
    expect(await formulario()).toEqual({
      ok: false,
      status: 502,
      error: "No hemos podido enviarte el WhatsApp. Inténtalo de nuevo en un momento.",
      codigo: "meta.bienvenida",
      causa: "Meta aún no ha aprobado tu mensaje de bienvenida",
    });
    expect(avisarLlegadaFallida).toHaveBeenCalledWith({
      leadId: idDe("34612345678"),
      nombre: "Laura",
      codigo: "meta.bienvenida",
      texto: "Meta aún no ha aprobado tu mensaje de bienvenida",
    });
    expect(await bd.leerLead(idDe("34612345678"))).toBeUndefined();

    // En un servidor, sin la causa. El fallo no cuenta para los 60 s: se puede volver a intentar.
    process.env.CRM_DOMINIO = "crm.ejemplo.es";
    const r = await formulario();
    expect(r).toEqual({ ok: false, status: 502, error: "No hemos podido enviarte el WhatsApp. Inténtalo de nuevo en un momento.", codigo: "meta.bienvenida" });
    expect(enviarPlantillaConVariables).toHaveBeenCalledTimes(2);

    // A mano, el título y la solución; un error que no es de Meta es «desconocido».
    vi.mocked(enviarPlantillaConVariables).mockRejectedValue(new Error("se cayó la red"));
    expect(await aMano({ permiso: true })).toEqual({
      ok: false,
      status: 502,
      error: "No se ha podido enviar el WhatsApp: Algo ha fallado. Vuelve a intentarlo en un momento.",
      codigo: "desconocido",
    });
    expect(await bd.contarLeads()).toBe(0);
  });

  it("si no se llega a Meta (sin red o sin tiempo): «red», no «desconocido»", async () => {
    const sinRed = [
      new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" }) }),
      new TypeError("fetch failed"),
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    ];
    for (const [i, error] of sinRed.entries()) {
      vi.mocked(enviarPlantillaConVariables).mockRejectedValueOnce(error);
      const r = await aMano({ permiso: true, telefono: `61200044${i}` });
      expect(r).toMatchObject({ ok: false, status: 502, codigo: "red" });
    }
    vi.mocked(enviarPlantillaConVariables).mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await formulario()).toMatchObject({ ok: false, status: 502, codigo: "red", causa: "Sin conexión con el servidor" });
    expect(avisarLlegadaFallida).toHaveBeenLastCalledWith(expect.objectContaining({ codigo: "red" }));
  });

  it("a mano sin permiso: se guarda con «Lo añadiste tú» y no se envía nada", async () => {
    const r = await aMano({ quiere: "Reformar el baño" });
    expect(r).toEqual({ ok: true, leadId: idDe("34612000111"), enviado: false });
    expect(enviarPlantillaConVariables).not.toHaveBeenCalled();
    expect(avisarLlegada).not.toHaveBeenCalled();
    const lead = await bd.leerLead(idDe("34612000111"));
    expect(lead).toMatchObject({ origen: "manual", estado: "nuevo", nombre: "Marta Soler", mensajes: [] });
    expect(lead?.actividad?.map((a) => a.texto)).toEqual(["Lo añadiste tú"]);
  });

  it("a mano con permiso: sale la bienvenida y quedan las dos líneas de historial", async () => {
    const r = await aMano({ nombre: "Pau Prueba", telefono: "612 000 333", permiso: true });
    expect(r).toEqual({ ok: true, leadId: idDe("34612000333"), enviado: true });
    expect(avisarLlegada).toHaveBeenCalledWith(expect.objectContaining({ canal: "manual", nombre: "Pau" }));
    expect(enviarPlantillaConVariables).toHaveBeenCalledWith("34612000333", { nombre: "solicitud_general", idioma: "es_ES", variables: ["Pau Prueba", NEGOCIO] });
    const lead = await bd.leerLead(idDe("34612000333"));
    expect(lead?.origen).toBe("manual");
    expect(lead?.mensajes).toHaveLength(1);
    expect(lead?.actividad?.map((a) => a.texto)).toEqual(["Lo añadiste tú", "Te ha dado permiso para escribirle por WhatsApp (lo has marcado tú)"]);
  });

  it("a mano con un móvil que ya existe: 409 con el leadId", async () => {
    await formulario({ telefono: "612 000 111", nombre: "Marta Soler" });
    vi.clearAllMocks();
    for (const permiso of [false, true]) {
      expect(await aMano({ permiso })).toEqual({ ok: false, status: 409, error: "Ya tienes a Marta Soler con ese móvil", leadId: idDe("34612000111") });
    }
    expect(enviarPlantillaConVariables).not.toHaveBeenCalled();
    expect(avisarLlegada).not.toHaveBeenCalled();
  });

  it("el formulario otra vez es un consentimiento nuevo: quita el silencio", async () => {
    await formulario();
    await bd.guardarMutaciones([{ t: "silencio", leadId: idDe("34612345678"), ts: 5 }]);
    expect((await bd.leerLead(idDe("34612345678")))?.silenciadoEn).toBe(5);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    expect(await formulario()).toEqual({ ok: true, leadId: idDe("34612345678"), enviado: true });
    expect((await bd.leerLead(idDe("34612345678")))?.silenciadoEn).toBeUndefined();
  });

  it("si la base de datos falla tras enviar: reintenta una vez y el formulario responde ok", async () => {
    vi.mocked(bd.guardarMutaciones).mockRejectedValueOnce(new Error("conexión perdida"));
    expect(await formulario()).toEqual({ ok: true, leadId: idDe("34612345678"), enviado: true });
    expect(bd.guardarMutaciones).toHaveBeenCalledTimes(2);
    expect(await bd.leerLead(idDe("34612345678"))).toBeDefined();

    // Si falla también el reintento: el formulario responde ok (el WhatsApp ya ha salido), a mano 502.
    vi.mocked(bd.guardarMutaciones).mockClear();
    vi.mocked(bd.guardarMutaciones).mockRejectedValueOnce(new Error("conexión perdida")).mockRejectedValueOnce(new Error("conexión perdida"));
    expect(await formulario({ telefono: "612 000 555" })).toEqual({ ok: true, leadId: idDe("34612000555"), enviado: true });
    expect(lineas().some((l) => l.includes("Cliente sin guardar: el WhatsApp ya ha salido (+34 6•• ••• •••)"))).toBe(true);
    expect(await bd.leerLead(idDe("34612000555"))).toBeUndefined();

    vi.mocked(bd.guardarMutaciones).mockRejectedValueOnce(new Error("conexión perdida")).mockRejectedValueOnce(new Error("conexión perdida"));
    expect(await aMano({ telefono: "612 000 666", permiso: true })).toEqual({
      ok: false,
      status: 502,
      error: "El WhatsApp ha salido, pero no se ha podido guardar el cliente. Vuelve a cargar en un momento.",
    });
  });

  it("{{2}} nunca va vacío", async () => {
    usar(configuracion((c) => (c.negocio.nombre = "  ")), { ...PERFIL, nombre: "Reformas Pérez" });
    await formulario();
    expect(vi.mocked(enviarPlantillaConVariables).mock.calls[0][1].variables).toEqual(["Laura Martínez", "Reformas Pérez"]);

    usar(configuracion((c) => (c.negocio.nombre = "")), { ...PERFIL, nombre: "" });
    await formulario({ telefono: "612 000 777" });
    expect(vi.mocked(enviarPlantillaConVariables).mock.calls[1][1].variables).toEqual(["Laura Martínez", "el negocio"]);
  });

  it("zona: se ignora sin vocabulario de zona y va a datos si hay campo zona", async () => {
    usar(configuracion((c) => (c.vocabulario = { ...c.vocabulario, zona: null })));
    await formulario({ zona: "Gràcia" });
    const sinZona = await bd.leerLead(idDe("34612345678"));
    expect(sinZona?.zona).toBeUndefined();
    expect(sinZona?.datos).toEqual({});

    usar(configuracion((c) => (c.campos = [...c.campos, { clave: "zona", etiqueta: "Zona" }])));
    await formulario({ telefono: "612 000 888", zona: "  Gràcia  " });
    const conCampo = await bd.leerLead(idDe("34612000888"));
    expect(conCampo?.zona).toBe("Gràcia");
    expect(conCampo?.datos).toEqual({ zona: "Gràcia" });

    await formulario({ telefono: "612 000 999", zona: "Sants" });
    expect((await bd.leerLead(idDe("34612000999")))?.datos).toEqual({ zona: "Sants" });
  });

  it("quiere va al campo principal", async () => {
    await aMano({ quiere: "  Reformar el baño  " });
    expect((await bd.leerLead(idDe("34612000111")))?.datos).toEqual({ tipo: "Reformar el baño" });

    usar(configuracion((c) => (c.campos = c.campos.map((x) => ({ ...x, resumen: false })))));
    await aMano({ telefono: "612 000 222", quiere: "x".repeat(250) });
    expect((await bd.leerLead(idDe("34612000222")))?.datos).toEqual({ necesidad: "x".repeat(200) });
  });

  it("la fuente del formulario sale de los parámetros de la web", async () => {
    await formulario({ fuente: { utm_source: "facebook", utm_campaign: "otoño" } });
    expect((await bd.leerLead(idDe("34612345678")))?.fuente).toEqual({ tipo: "anuncio", plataforma: "Meta", campana: "otoño" });
  });
});
