import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as bd from "./bd";
import { normalizarGuardada, resolverSistema } from "./configuracion";
import {
  cambiarAsistente,
  cambiarDeNegocio,
  configuracionActiva,
  datosConfiguracion,
  guardarCambios,
  guardarInformacion,
  guardarLogoActivo,
  guardarPrompt,
  invalidarCache,
  restablecer,
} from "./configuracion-servidor";
import { escucharCambios } from "./eventos";
import { conSeccion } from "./guion";
import * as whatsappMeta from "./meta";
import { crearLead } from "./negocio";
import { escribirAgente, hashTexto, leerPerfil } from "./perfil";
import * as sistema from "./sistema";

// Las funciones de lib/bd.ts de verdad (PGlite en memoria), envueltas para poder contarlas.
vi.mock("./bd", async (importOriginal) => {
  const real = await importOriginal<typeof import("./bd")>();
  return {
    ...real,
    leerConfiguracionGuardada: vi.fn(real.leerConfiguracionGuardada),
    leerBdYGuardada: vi.fn(real.leerBdYGuardada),
    contarLeads: vi.fn(real.contarLeads),
    modificarConfiguracionGuardada: vi.fn(real.modificarConfiguracionGuardada),
  };
});
// La puesta en marcha es de W9: aquí, fija.
vi.mock("./sistema", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sistema")>();
  return {
    ...real,
    estadoPuesta: vi.fn(async () => ({ negocio: true, claude: false, whatsapp: false, mensajes: true, primerMensaje: true })),
  };
});
vi.mock("./meta", async (importOriginal) => {
  const real = await importOriginal<typeof import("./meta")>();
  return { ...real, numeroDelNegocio: vi.fn(() => null) };
});

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_REFORMAS = fs.readFileSync(path.join(AQUI, "__golden__", "entrada-reformas.md"), "utf8");
const GOLDEN_INMOBILIARIA = fs.readFileSync(path.join(AQUI, "__golden__", "entrada-inmobiliaria.md"), "utf8");

// Los textos de partida se escriben aquí: el resultado no depende de los perfiles/ del repositorio.
function textoDe(titulo: string, quien: string): string {
  return [
    `# Asistente de WhatsApp · ${titulo}`,
    "",
    `Eres el asistente de WhatsApp de ${quien}. Contestas con frases cortas y amables.`,
    "",
    "## Preguntas",
    "Pregunta qué necesita y para cuándo.",
    "",
    "## Información que puedes dar tal cual",
    "Abrimos de lunes a viernes.",
    "",
    "## Cuándo pasar a una persona",
    "Si pide hablar con alguien del equipo.",
    "",
  ].join("\n");
}
const PRESETS_TEXTO = {
  reformas: textoDe("Estudio de reformas", "un estudio de reformas"),
  inmobiliaria: textoDe("Inmobiliaria", "una inmobiliaria"),
  clinica: textoDe("Clínica", "una clínica"),
  generico: textoDe("Mi negocio", "un negocio"),
};

let dir = "";
const agente = () => path.join(dir, "agente.md");
const leerAgente = () => fs.readFileSync(agente(), "utf8");
const escribirAMano = (texto: string) => fs.writeFileSync(agente(), texto);

const leerGuardada = vi.mocked(bd.leerConfiguracionGuardada);
const leerBdYGuardada = vi.mocked(bd.leerBdYGuardada);
const contarLeads = vi.mocked(bd.contarLeads);
const modificar = vi.mocked(bd.modificarConfiguracionGuardada);
const estadoPuesta = vi.mocked(sistema.estadoPuesta);
const numeroDelNegocio = vi.mocked(whatsappMeta.numeroDelNegocio);

type ErrorRuta = Error & { status?: number; campo?: string };
async function errorDe(p: Promise<unknown>): Promise<ErrorRuta> {
  try {
    await p;
  } catch (e) {
    return e as ErrorRuta;
  }
  throw new Error("Tenía que fallar y no ha fallado");
}

function lineasDeLog(espia: { mock: { calls: unknown[][] } }): string[] {
  return espia.mock.calls.map((c) => String(c[0]));
}

function png(...extra: number[]): string {
  return `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...extra]).toString("base64")}`;
}

const g = globalThis as Record<string, unknown>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-w7-"));
  fs.mkdirSync(path.join(dir, "perfiles"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterAll(() => {
  fs.chmodSync(dir, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  fs.chmodSync(dir, 0o755);
  for (const [id, texto] of Object.entries(PRESETS_TEXTO)) fs.writeFileSync(path.join(dir, "perfiles", `${id}.md`), texto);
  for (const f of fs.readdirSync(dir)) if (f.startsWith("agente.md")) fs.rmSync(path.join(dir, f));
  escribirAMano(PRESETS_TEXTO.reformas);
  await bd.guardarAjustes({ leadsPrueba: false });
  await bd.reiniciarBd();
  await bd.restablecerConfiguracion();
  for (const clave of ["__configuracion", "__perfilesLeidos", "__ultimosPerfiles", "__avisosPerfil", "__avisoPuesta"]) delete g[clave];
  invalidarCache();
  vi.clearAllMocks();
  numeroDelNegocio.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("caché", () => {
  it("muchas lecturas, una sola consulta", async () => {
    await Promise.all(Array.from({ length: 10 }, () => configuracionActiva()));
    for (let i = 0; i < 5; i++) await configuracionActiva();
    expect(leerGuardada).toHaveBeenCalledTimes(1);
  });

  it("escribir actualiza la caché sin volver a leer", async () => {
    await configuracionActiva();
    leerGuardada.mockClear();
    await guardarCambios("estudio-de-reformas", { cambios: { negocio: { lema: "Reformas sin sustos" } } });
    expect((await configuracionActiva()).config.negocio.lema).toBe("Reformas sin sustos");
    expect(leerGuardada).not.toHaveBeenCalled();
  });

  it("pasados 5 s devuelve lo que tiene y refresca por detrás", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    expect((await configuracionActiva()).config.negocio.lema).not.toBe("Por detrás");
    // Otro proceso cambia lo guardado sin pasar por esta caché.
    await bd.modificarConfiguracionGuardada(() => ({ version: 1, rev: 1, perfiles: { "estudio-de-reformas": { negocio: { lema: "Por detrás" } } }, sistema: {} }));
    expect((await configuracionActiva()).config.negocio.lema).not.toBe("Por detrás");
    expect(leerGuardada).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-12T10:00:06Z"));
    expect((await configuracionActiva()).config.negocio.lema).not.toBe("Por detrás");
    expect(leerGuardada).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () => expect((await configuracionActiva()).config.negocio.lema).toBe("Por detrás"));
    expect(leerGuardada).toHaveBeenCalledTimes(2);
  });

  it("si la base de datos falla, se queda con lo último", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await guardarCambios("estudio-de-reformas", { cambios: { negocio: { lema: "Lo último" } } });

    vi.setSystemTime(new Date("2026-11-12T10:00:06Z"));
    leerGuardada.mockRejectedValueOnce(new Error("sin conexión"));
    expect((await configuracionActiva()).config.negocio.lema).toBe("Lo último");
    await vi.waitFor(() => expect(lineasDeLog(log).some((l) => l.includes("No se ha podido leer la configuración guardada"))).toBe(true));
    expect((await configuracionActiva()).config.negocio.lema).toBe("Lo último");

    // En frío y sin base de datos: la de partida, sin guardarla como buena, y se reintenta pasados 5 s.
    invalidarCache();
    leerGuardada.mockClear();
    leerGuardada.mockRejectedValueOnce(new Error("sin conexión"));
    expect((await configuracionActiva()).config.guardada).toBe(false);
    expect((await configuracionActiva()).config.guardada).toBe(false);
    expect(leerGuardada).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-11-12T10:00:12Z"));
    expect((await configuracionActiva()).config.negocio.lema).toBe("Lo último");
    expect(leerGuardada).toHaveBeenCalledTimes(2);
    expect(lineasDeLog(log).filter((l) => l.includes("No se ha podido leer la configuración guardada"))).toHaveLength(1);
    log.mockRestore();
  });

  it("una lectura que empezó antes de una escritura se descarta", async () => {
    let soltar = () => {};
    const puerta = new Promise<void>((r) => (soltar = r));
    const real = (await vi.importActual<typeof import("./bd")>("./bd")).leerConfiguracionGuardada;
    leerGuardada.mockImplementationOnce(async () => {
      const vieja = await real();
      await puerta;
      return vieja;
    });
    const lectura = configuracionActiva();
    await vi.waitFor(() => expect(leerGuardada).toHaveBeenCalledTimes(1));
    await cambiarAsistente(false);
    soltar();
    expect((await lectura).config.sistema.asistente.activo).toBe(false);
    expect((await configuracionActiva()).config.sistema.asistente.activo).toBe(false);
  });
});

describe("perfil", () => {
  it("reutiliza lo leído mientras no cambien mtime y tamaño", async () => {
    const fecha = new Date("2026-01-01T00:00:00Z");
    fs.utimesSync(agente(), fecha, fecha);
    const primero = await leerPerfil();
    // El mismo tamaño y la misma fecha: no se vuelve a leer.
    escribirAMano(PRESETS_TEXTO.reformas.replace("amables", "AMABLES"));
    fs.utimesSync(agente(), fecha, fecha);
    expect((await leerPerfil()).hash).toBe(primero.hash);
    // Otro tamaño: sí.
    escribirAMano(`${PRESETS_TEXTO.reformas}\nUna línea más.\n`);
    fs.utimesSync(agente(), fecha, fecha);
    expect((await leerPerfil()).instrucciones).toContain("Una línea más.");
  });

  it("sin agente.md usa perfiles/reformas.md y lo avisa una vez por minuto", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    fs.rmSync(agente());
    const avisos = () => lineasDeLog(log).filter((l) => l.includes("Falta agente.md: se usan las instrucciones de perfiles/reformas.md"));
    const perfil = await leerPerfil();
    expect(perfil.id).toBe("estudio-de-reformas");
    expect(perfil.hash).toBe(hashTexto(PRESETS_TEXTO.reformas));
    await leerPerfil();
    expect(avisos()).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-12T10:01:01Z"));
    await leerPerfil();
    expect(avisos()).toHaveLength(2);
    // Con la huella de ese respaldo, guardar escribe el archivo (F23).
    await guardarPrompt(PRESETS_TEXTO.reformas.replace("amables", "muy amables"), perfil.hash);
    expect(leerAgente()).toContain("muy amables");
    log.mockRestore();
  });

  it("escribirAgente escribe entero o nada", async () => {
    const nuevo = PRESETS_TEXTO.inmobiliaria;
    const perfil = await escribirAgente(nuevo);
    expect(perfil.id).toBe("inmobiliaria");
    expect(leerAgente()).toBe(nuevo);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);

    fs.chmodSync(dir, 0o555);
    await expect(escribirAgente(PRESETS_TEXTO.clinica)).rejects.toMatchObject({ code: "EACCES" });
    fs.chmodSync(dir, 0o755);
    expect(leerAgente()).toBe(nuevo);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
});

describe("datosConfiguracion", () => {
  it("trae guardada, entorno, informacion y los cuatro sectores", async () => {
    vi.stubEnv("NOMBRE_NEGOCIO", "Reformas Ana");
    await guardarCambios("estudio-de-reformas", { cambios: { negocio: { lema: "Sin sustos" } } });
    const d = await datosConfiguracion();
    expect(d.activa.negocio.nombre).toBe("Reformas Ana");
    expect(d.guardada.perfil).toEqual({ negocio: { lema: "Sin sustos" } });
    expect(d.guardada.rev).toBe(1);
    expect(d.entorno).toEqual({ NOMBRE_NEGOCIO: "Reformas Ana" });
    expect(d.prompt.texto).toBe(PRESETS_TEXTO.reformas);
    expect(d.prompt.hash).toBe(hashTexto(PRESETS_TEXTO.reformas));
    expect(d.prompt.informacion).toBe("Abrimos de lunes a viernes.");
    expect(d.prompt.revision.error).toBeUndefined();
    expect(typeof d.prompt.sistema).toBe("string");
    expect(d.sectores.map((s) => [s.id, s.perfilId])).toEqual([
      ["reformas", "estudio-de-reformas"],
      ["inmobiliaria", "inmobiliaria"],
      ["clinica", "clinica"],
      ["generico", null],
    ]);
    expect(d.ejemplos).toEqual({ ejemplo: 0, reales: 0, de: null, leadsPrueba: false });
    expect(d.avisos).toEqual([]);
  });

  it("ninguna clave aparece en la respuesta", async () => {
    const secretos: Record<string, string> = {
      ANTHROPIC_API_KEY: "sk-ant-secreto-111111",
      WHATSAPP_TOKEN: "EAAGsecreto222222",
      META_APP_SECRET: "secretometa333333",
      NGROK_AUTHTOKEN: "ngroksecreto444444",
      WEBHOOK_VERIFY_TOKEN: "verificasecreto555555",
      SUPABASE_DB_URL: "postgres://usuario:clave666666@db.ejemplo.co/postgres",
      SESION_SECRETO: "sesionsecreta777777",
      CLAVE_PANEL_HASH: "hashpanel888888",
    };
    for (const [nombre, valor] of Object.entries(secretos)) vi.stubEnv(nombre, valor);
    const texto = JSON.stringify(await datosConfiguracion());
    for (const valor of Object.values(secretos)) expect(texto).not.toContain(valor);
  });

  it("versionNueva con el texto antiguo de reformas sin copia guardada", async () => {
    escribirAMano(GOLDEN_REFORMAS);
    expect((await datosConfiguracion()).prompt.versionNueva).toBe(true);
  });

  it("también reconoce el texto antiguo de inmobiliaria", async () => {
    escribirAMano(GOLDEN_INMOBILIARIA);
    expect((await datosConfiguracion()).prompt.versionNueva).toBe(true);
    // Editado en Ajustes cuando el archivo aún era el antiguo: lo dice su copia al llegar el nuevo.
    const archivo = path.join(dir, "perfiles", "inmobiliaria.md");
    fs.writeFileSync(archivo, GOLDEN_INMOBILIARIA);
    await guardarPrompt(GOLDEN_INMOBILIARIA.replace(/\n$/, "\nUna nota mía.\n"), hashTexto(GOLDEN_INMOBILIARIA));
    expect((await datosConfiguracion()).prompt.versionNueva).toBe(false);
    fs.writeFileSync(archivo, PRESETS_TEXTO.inmobiliaria);
    expect((await datosConfiguracion()).prompt.versionNueva).toBe(true);
  });

  it("sin versión nueva cuando agente.md es el texto actual", async () => {
    expect((await datosConfiguracion()).prompt.versionNueva).toBe(false);
    escribirAMano(PRESETS_TEXTO.reformas.replace("amables", "cercanas"));
    expect((await datosConfiguracion()).prompt.versionNueva).toBe(false);
  });
});

describe("guardar", () => {
  it("guardarCambios: 409 si el negocio cambió y 400 con el campo", async () => {
    const otro = await errorDe(guardarCambios("inmobiliaria", { cambios: { negocio: { lema: "x" } } }));
    expect(otro.status).toBe(409);
    expect(otro.message).toBe("El tipo de negocio ha cambiado mientras editabas. Recarga la página.");
    const malo = await errorDe(guardarCambios("estudio-de-reformas", { cambios: { negocio: { color: "rojo" } } }));
    expect(malo.status).toBe(400);
    expect(malo.campo).toMatch(/^negocio\.color/);
    expect(modificar).not.toHaveBeenCalled();
  });

  it("guardarCambios fusiona sistema y nunca toca activo ni pausadoEn", async () => {
    const pausa = await cambiarAsistente(false);
    await guardarCambios("estudio-de-reformas", { sistema: { avisos: { comercial: { detalle: "minimo" } } } });
    const r = await guardarCambios("estudio-de-reformas", {
      sistema: { asistente: { modelo: "claude-sonnet-5-5", activo: true, pausadoEn: null } as never, avisos: { comercial: { telefono: "" } } },
    });
    expect(r.sistema.asistente).toEqual({ activo: false, pausadoEn: pausa.pausadoEn, modelo: "claude-sonnet-5-5" });
    expect(r.sistema.avisos.comercial).toEqual({ telefono: "", detalle: "minimo" });
    // Sin nada que cambiar: ni se escribe ni se avisa.
    modificar.mockClear();
    await guardarCambios("estudio-de-reformas", { cambios: {}, sistema: {} });
    expect(modificar).not.toHaveBeenCalled();
  });

  it("renombrar actualiza perfilNombre de los clientes", async () => {
    const lead = crearLead({ telefono: "34612345678", perfilId: "estudio-de-reformas", perfilNombre: "Estudio de reformas", nombre: "Ana", origen: "whatsapp", creadoEn: 1 });
    await bd.guardarMutaciones([{ t: "lead", lead }]);
    const r = await guardarCambios("estudio-de-reformas", { cambios: { negocio: { nombre: "Reformas Pepe" } } });
    expect(r.negocio.nombre).toBe("Reformas Pepe");
    expect((await bd.leerLead(lead.id))?.perfilNombre).toBe("Reformas Pepe");
  });

  it("guardarPrompt: 409 por hash, 400 por título y copia escrita", async () => {
    const hash = hashTexto(PRESETS_TEXTO.reformas);
    expect((await errorDe(guardarPrompt(PRESETS_TEXTO.reformas, "000000000000"))).status).toBe(409);
    const titulo = await errorDe(guardarPrompt(PRESETS_TEXTO.reformas.replace("Estudio de reformas", "Otra cosa"), hash));
    expect(titulo.status).toBe(400);
    expect(titulo.message).toBe("No cambies la primera línea: identifica el perfil y separa las conversaciones.");

    const editado = PRESETS_TEXTO.reformas.replace("amables", "cercanas");
    const { perfil, revision } = await guardarPrompt(editado.replace(/\n/g, "\r\n"), hash);
    expect(revision.error).toBeUndefined();
    expect(leerAgente()).toBe(editado);
    expect(perfil.hash).toBe(hashTexto(editado));
    const copia = (await bd.leerCopiasInstrucciones())["estudio-de-reformas"];
    expect(copia).toMatchObject({ texto: editado, hash: hashTexto(editado), origen: hash });
  });

  it("guardarInformacion cambia solo esa sección, crea la sección si falta y escribe la copia", async () => {
    const original = PRESETS_TEXTO.reformas;
    await guardarInformacion("  Abrimos de lunes a sábado.\r\nAparcamiento en la puerta.  ", hashTexto(original));
    const esperado = conSeccion(original, "Información que puedes dar tal cual", "Abrimos de lunes a sábado.\nAparcamiento en la puerta.");
    expect(leerAgente()).toBe(esperado);
    expect(leerAgente().split("## Información")[0]).toBe(original.split("## Información")[0]);
    expect((await bd.leerCopiasInstrucciones())["estudio-de-reformas"]?.texto).toBe(esperado);

    const sinSeccion = original.replace(/## Información que puedes dar tal cual\nAbrimos de lunes a viernes\.\n\n/, "");
    escribirAMano(sinSeccion);
    await guardarInformacion("Hacemos presupuestos gratis.", hashTexto(sinSeccion));
    expect(leerAgente()).toBe(`${sinSeccion.trimEnd()}\n\n## Información que puedes dar tal cual\nHacemos presupuestos gratis.\n`);
    expect((await datosConfiguracion()).prompt.informacion).toBe("Hacemos presupuestos gratis.");
  });

  it("guardarInformacion: 409 por hash y 400 por largo", async () => {
    expect((await errorDe(guardarInformacion("Hola", "000000000000"))).status).toBe(409);
    const largo = await errorDe(guardarInformacion("a".repeat(4_001), hashTexto(PRESETS_TEXTO.reformas)));
    expect(largo).toMatchObject({ status: 400, campo: "informacion", message: "Lo que tiene que saber de tu negocio: como mucho 4.000 caracteres" });
    expect(leerAgente()).toBe(PRESETS_TEXTO.reformas);
  });

  it("un error al escribir no nombra ningún archivo", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    fs.chmodSync(dir, 0o555);
    const e = await errorDe(guardarPrompt(PRESETS_TEXTO.reformas.replace("amables", "cercanas"), hashTexto(PRESETS_TEXTO.reformas)));
    fs.chmodSync(dir, 0o755);
    expect(e.status).toBe(500);
    expect(e.message).toBe("No se han podido guardar las instrucciones: sin permiso de escritura en la carpeta del CRM");
    expect(e.message).not.toContain("agente");
    expect(e.message).not.toContain(dir);
    expect(leerAgente()).toBe(PRESETS_TEXTO.reformas);
    log.mockRestore();
  });
});

describe("cambiarDeNegocio", () => {
  it("guarda el texto saliente y recupera el editado al volver", async () => {
    const editado = PRESETS_TEXTO.reformas.replace("amables", "cercanas");
    await guardarPrompt(editado, hashTexto(PRESETS_TEXTO.reformas));
    const { activa } = await cambiarDeNegocio({ sector: "inmobiliaria" });
    expect(activa.perfil.id).toBe("inmobiliaria");
    expect(activa.sector).toBe("inmobiliaria");
    expect(leerAgente()).toBe(PRESETS_TEXTO.inmobiliaria);
    expect((await bd.leerCopiasInstrucciones())["estudio-de-reformas"]?.texto).toBe(editado);

    await cambiarDeNegocio({ sector: "reformas" });
    expect(leerAgente()).toBe(editado);
    // La de inmobiliaria no estaba editada: al volver, el texto de su archivo (aunque haya cambiado).
    const copia = (await bd.leerCopiasInstrucciones()).inmobiliaria;
    expect(copia?.hash).toBe(copia?.origen);
    fs.writeFileSync(path.join(dir, "perfiles", "inmobiliaria.md"), PRESETS_TEXTO.inmobiliaria.replace("amables", "nuevas"));
    await cambiarDeNegocio({ sector: "inmobiliaria" });
    expect(leerAgente()).toContain("nuevas");
  });

  it("nuevo con color y sin nombre conserva el nombre", async () => {
    const { activa } = await cambiarDeNegocio({ nuevo: { nombre: "Peluquería Sol", base: "generico", configuracion: { negocio: { color: "#2b7bb9" } } } });
    expect(activa.perfil.id).toBe("peluqueria-sol");
    expect(activa.sector).toBe("personalizado");
    expect(activa.base).toBe("generico");
    expect(activa.negocio.nombre).toBe("Peluquería Sol");
    expect(activa.negocio.color).toBe("#2b7bb9");
    expect(leerAgente().split("\n")[0]).toBe("# Asistente de WhatsApp · Peluquería Sol");
  });

  it("un nombre repetido da (2)", async () => {
    await cambiarDeNegocio({ nuevo: { nombre: "Peluquería Sol", base: "generico" } });
    const segundo = await cambiarDeNegocio({ nuevo: { nombre: "Peluquería Sol", base: "generico" } });
    expect(segundo.activa.perfil.id).toBe("peluqueria-sol-2");
    expect(leerAgente().split("\n")[0]).toBe("# Asistente de WhatsApp · Peluquería Sol (2)");
    // Volver a aplicar el mismo archivo actualiza el mismo negocio.
    const otraVez = await cambiarDeNegocio({ nuevo: { nombre: "Peluquería Sol", base: "generico", sustituir: true, configuracion: { negocio: { lema: "Cortes rápidos" } } } });
    expect(otraVez.activa.perfil.id).toBe("peluqueria-sol");
    expect(otraVez.activa.negocio.lema).toBe("Cortes rápidos");
    // Un nombre de preset nunca se reutiliza.
    expect((await cambiarDeNegocio({ nuevo: { nombre: "Inmobiliaria", base: "inmobiliaria" } })).activa.perfil.id).toBe("inmobiliaria-2");
  });

  it("si falla la escritura, la configuración queda coherente", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await guardarCambios("estudio-de-reformas", { cambios: { negocio: { lema: "Sin sustos" } } });
    fs.chmodSync(dir, 0o555);
    const e = await errorDe(cambiarDeNegocio({ sector: "inmobiliaria" }));
    fs.chmodSync(dir, 0o755);
    expect(e.status).toBe(500);
    expect(e.message).toMatch(/^No se han podido guardar las instrucciones: /);
    expect(leerAgente()).toBe(PRESETS_TEXTO.reformas);
    const { config } = await configuracionActiva();
    expect(config.perfil.id).toBe("estudio-de-reformas");
    expect(config.negocio.lema).toBe("Sin sustos");
    expect((await datosConfiguracion()).avisos).toEqual([]);
    log.mockRestore();
  });

  it("sustituir carga los ejemplos del nuevo sector y no toca los reales", async () => {
    const real = crearLead({ telefono: "34699999999", perfilId: "estudio-de-reformas", perfilNombre: "Estudio de reformas", nombre: "Real", origen: "whatsapp", creadoEn: 1 });
    await bd.guardarMutaciones([{ t: "lead", lead: real }]);
    await cambiarDeNegocio({ sector: "inmobiliaria" }, { ejemplos: "sustituir" });
    const leido = await bd.leerBd();
    expect(leido.ajustes.ejemplosDe).toBe("inmobiliaria");
    expect((await bd.contarEjemplos()).ejemplo).toBeGreaterThan(0);
    expect(leido.leads[real.id]?.nombre).toBe("Real");
  });

  it("borrar deja solo los reales", async () => {
    const real = crearLead({ telefono: "34699999999", perfilId: "estudio-de-reformas", perfilNombre: "Estudio de reformas", nombre: "Real", origen: "whatsapp", creadoEn: 1 });
    await bd.guardarMutaciones([{ t: "lead", lead: real }]);
    await bd.sustituirEjemplos((await import("./semilla")).OPCIONES_POR_DEFECTO);
    await cambiarDeNegocio({ sector: "clinica" }, { ejemplos: "borrar" });
    expect(await bd.contarEjemplos()).toEqual({ ejemplo: 0, reales: 1 });
    expect((await bd.leerBd()).ajustes.ejemplosDe ?? null).toBeNull();
  });

  it("sin indicar: sustituye si había ejemplos y no hace nada si no", async () => {
    await cambiarDeNegocio({ sector: "inmobiliaria" });
    expect((await bd.contarEjemplos()).ejemplo).toBe(0);
    expect((await bd.leerBd()).ajustes.ejemplosDe ?? null).toBeNull();

    await bd.sustituirEjemplos((await import("./semilla")).OPCIONES_POR_DEFECTO);
    await cambiarDeNegocio({ sector: "clinica" });
    expect((await bd.contarEjemplos()).ejemplo).toBeGreaterThan(0);
    expect((await bd.leerBd()).ajustes.ejemplosDe).toBe("clinica");
  });

  it("al mismo negocio aplica el nombre y la casilla", async () => {
    const { activa, avisos } = await cambiarDeNegocio({ sector: "reformas" }, { nombre: "Reformas Luz", ejemplos: "sustituir" });
    expect(avisos).toEqual([]);
    expect(activa.perfil.id).toBe("estudio-de-reformas");
    expect(activa.negocio.nombre).toBe("Reformas Luz");
    expect(leerAgente()).toBe(PRESETS_TEXTO.reformas);
    expect(await bd.leerCopiasInstrucciones()).toEqual({});
    expect((await bd.contarEjemplos()).ejemplo).toBeGreaterThan(0);
    // Sin ejemplos ni nombre: no cambia nada.
    await bd.borrarEjemplos();
    modificar.mockClear();
    await cambiarDeNegocio({ sector: "reformas" });
    expect(modificar).not.toHaveBeenCalled();
    expect((await bd.contarEjemplos()).ejemplo).toBe(0);
  });

  it("un cp a mano guarda el texto editado anterior y lo avisa una vez", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const editado = PRESETS_TEXTO.reformas.replace("amables", "a mano");
    escribirAMano(editado);
    await configuracionActiva();
    fs.copyFileSync(path.join(dir, "perfiles", "inmobiliaria.md"), agente());
    expect((await configuracionActiva()).perfil.id).toBe("inmobiliaria");
    expect((await bd.leerCopiasInstrucciones())["estudio-de-reformas"]?.texto).toBe(editado);
    expect((await datosConfiguracion()).avisos).toEqual([
      "Has cambiado de tipo de negocio fuera de Ajustes: el texto anterior de Estudio de reformas está guardado.",
    ]);
    expect((await datosConfiguracion()).avisos).toEqual([]);
    // Un texto sin tocar no se guarda ni se avisa.
    fs.copyFileSync(path.join(dir, "perfiles", "clinica.md"), agente());
    await configuracionActiva();
    expect((await bd.leerCopiasInstrucciones()).inmobiliaria).toBeUndefined();
    expect((await datosConfiguracion()).avisos).toEqual([]);
    log.mockRestore();
  });
});

describe("restablecer y logo", () => {
  it("restablecer perfil en un negocio propio conserva sector, base y nombre", async () => {
    await cambiarDeNegocio({ nuevo: { nombre: "Peluquería Sol", base: "generico", configuracion: { negocio: { color: "#2b7bb9", lema: "Cortes rápidos" } } } });
    const texto = leerAgente();
    const r = await restablecer("perfil");
    expect(r.perfil.id).toBe("peluqueria-sol");
    expect(r.sector).toBe("personalizado");
    expect(r.base).toBe("generico");
    expect(r.negocio.nombre).toBe("Peluquería Sol");
    expect(r.negocio.color).not.toBe("#2b7bb9");
    expect(r.negocio.lema).not.toBe("Cortes rápidos");
    expect(leerAgente()).toBe(texto);
  });

  it("restablecer todo deja reformas", async () => {
    await cambiarDeNegocio({ sector: "inmobiliaria" }, { nombre: "Pisos Mar" });
    await cambiarAsistente(false);
    const r = await restablecer("todo");
    expect(r.perfil.id).toBe("estudio-de-reformas");
    expect(r.guardada).toBe(false);
    expect(r.sistema.asistente.activo).toBe(true);
    expect(leerAgente()).toBe(PRESETS_TEXTO.reformas);
    expect(normalizarGuardada(await bd.leerConfiguracionGuardada()).perfiles).toEqual({});
  });

  it("logo A, quitar, logo B dan logoUrl distintos", async () => {
    const a = await guardarLogoActivo(png(1, 2, 3));
    const sinLogo = await guardarLogoActivo(null);
    const b = await guardarLogoActivo(png(4, 5, 6));
    expect(a.negocio.logoUrl).toMatch(/^\/api\/logo\?perfil=estudio-de-reformas&v=/);
    expect(sinLogo.negocio.logoUrl).toBeNull();
    expect(b.negocio.logoUrl).toMatch(/^\/api\/logo\?perfil=estudio-de-reformas&v=/);
    expect(b.negocio.logoUrl).not.toBe(a.negocio.logoUrl);
    expect((await configuracionActiva()).config.negocio.logoUrl).toBe(b.negocio.logoUrl);
  });

  it("SVG → 400 y más de 300 KB → 413", async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")}`;
    expect(await errorDe(guardarLogoActivo(svg))).toMatchObject({ status: 400, message: "Ese archivo no es una imagen PNG, JPG o WebP" });
    const disfrazado = `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;
    expect((await errorDe(guardarLogoActivo(disfrazado))).status).toBe(400);
    const grande = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(301 * 1024)]).toString("base64")}`;
    expect(await errorDe(guardarLogoActivo(grande))).toMatchObject({ status: 413, message: "La imagen es demasiado grande" });
    expect((await configuracionActiva()).config.negocio.logoUrl).toBeNull();
  });
});

describe("cambiarAsistente", () => {
  it("la pausa se ve al momento, se registra y avisa de sistema y configuracion", async () => {
    await configuracionActiva();
    leerGuardada.mockClear();
    const tipos: string[] = [];
    const dejar = escucharCambios((c) => tipos.push(c.tipo));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await cambiarAsistente(false);
    expect((await configuracionActiva()).config.sistema.asistente.activo).toBe(false);
    expect(leerGuardada).not.toHaveBeenCalled();
    expect(lineasDeLog(log).some((l) => l.includes("Asistente en pausa desde el panel"))).toBe(true);
    await vi.waitFor(() => expect(tipos).toEqual(expect.arrayContaining(["sistema", "configuracion"])));
    await cambiarAsistente(true);
    expect(lineasDeLog(log).some((l) => l.includes("Asistente reactivado desde el panel"))).toBe(true);
    dejar();
    log.mockRestore();
  });

  it("devuelve lo mismo que la versión mínima", async () => {
    const pausa = await cambiarAsistente(false);
    expect(pausa).toEqual({ activo: false, pausadoEn: expect.any(Number), modelo: null });
    expect(await cambiarAsistente(false)).toEqual(pausa);
    const guardada = normalizarGuardada(await bd.leerConfiguracionGuardada());
    expect(resolverSistema(guardada.sistema, "reformas").asistente).toEqual(pausa);
    expect(await cambiarAsistente(true)).toEqual({ activo: true, pausadoEn: null, modelo: null });
  });
});

describe("/api/estado", () => {
  async function estado(url = "http://localhost/api/estado"): Promise<Record<string, unknown>> {
    const { GET } = await import("@/app/api/estado/route");
    return (await (await GET(new Request(url))).json()) as Record<string, unknown>;
  }

  it("bd es la primera clave, pruebas, modo y puesta solo con booleanos", async () => {
    const e = await estado();
    expect(Object.keys(e)).toEqual(["bd", "perfil", "pruebas", "modo", "modoWhatsApp", "puesta", "numero", "configuracion"]);
    expect(e.bd).toEqual({ ok: true, leads: 0 });
    expect(e.perfil).toEqual({ id: "estudio-de-reformas", nombre: "Estudio de reformas" });
    expect(e.pruebas).toBe(true);
    expect(e.modo).toBe("local");
    expect(e.modoWhatsApp).toBe("oficial");
    expect(e.puesta).toEqual({ negocio: true, claude: false, whatsapp: false, mensajes: true, primerMensaje: true });
    expect(Object.values(e.puesta as object).every((v) => typeof v === "boolean")).toBe(true);
    expect(e.numero).toBeNull();
    expect(e.configuracion).toMatchObject({ sector: "reformas", base: "reformas", negocio: { nombre: "Estudio de reformas" }, guardada: false, ejemplosDe: null });
    expect(Object.keys(e.configuracion as object)).toEqual(["sector", "base", "negocio", "plantilla", "web", "guardada", "ejemplosDe", "firma"]);

    // Si no se puede mirar la puesta: todo a sí.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    estadoPuesta.mockRejectedValueOnce(new Error("roto"));
    expect((await estado()).puesta).toEqual({ negocio: true, claude: true, whatsapp: true, mensajes: true, primerMensaje: true });
    log.mockRestore();
  });

  it("numero con el enlace de wa.me", async () => {
    numeroDelNegocio.mockReturnValue({ id: "123", texto: "+34 600 000 000", nombre: "Estudio", prueba: false });
    expect((await estado()).numero).toEqual({ texto: "+34 600 000 000", enlace: "https://wa.me/34600000000?text=Hola" });
  });

  it("?solo=firma no cuenta clientes ni mira la puesta", async () => {
    const completo = await estado();
    vi.clearAllMocks();
    const e = await estado("http://localhost/api/estado?solo=firma");
    expect(Object.keys(e)).toEqual(["firma"]);
    expect(e.firma).toBe((completo.configuracion as { firma: string }).firma);
    expect(contarLeads).not.toHaveBeenCalled();
    expect(estadoPuesta).not.toHaveBeenCalled();
    expect(leerGuardada).not.toHaveBeenCalled();
    expect(leerBdYGuardada).not.toHaveBeenCalled();
  });

  it("modo servidor con CRM_DOMINIO", async () => {
    vi.stubEnv("CRM_DOMINIO", "crm.ejemplo.es");
    expect((await estado()).modo).toBe("servidor");
  });
});

describe("rutas de configuración", () => {
  it("POST con un móvil del aviso mal escrito: 400 con el campo y el guardado se queda como estaba", async () => {
    const { POST } = await import("@/app/api/configuracion/route");
    const enviar = async (telefono: unknown) => {
      const r = await POST(
        new Request("http://localhost/api/configuracion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ perfilId: "estudio-de-reformas", sistema: { avisos: { comercial: { telefono } } } }),
        }),
      );
      return { status: r.status, cuerpo: (await r.json()) as { ok: boolean; campo?: string } };
    };
    expect((await enviar("+34 612 345 678")).status).toBe(200);
    expect((await configuracionActiva()).config.sistema.avisos.comercial.telefono).toBe("34612345678");

    for (const malo of ["+34 612 345 678 901 234 567", "12", 612345678]) {
      const r = await enviar(malo);
      expect(r.status).toBe(400);
      expect(r.cuerpo).toMatchObject({ ok: false, campo: "sistema.avisos.comercial.telefono" });
      invalidarCache();
      expect((await configuracionActiva()).config.sistema.avisos.comercial.telefono).toBe("34612345678");
    }
  });

  it("POST con comprobar no escribe nada y avisa de la plantilla solo con la regla E1", async () => {
    const { POST } = await import("@/app/api/configuracion/route");
    const E1 = "La plantilla es la de Reformas y pregunta qué reformar: crea la tuya en Meta";
    const archivo = (base: string, configuracion: object = {}) => ({
      formato: "crm-whatsapp/negocio@1",
      nombre: "Reformas Luz",
      base,
      configuracion,
      instrucciones: PRESETS_TEXTO.reformas,
    });
    const comprobar = async (cuerpo: unknown) =>
      (await (await POST(new Request("http://localhost/api/configuracion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comprobar: cuerpo }) }))).json()) as {
        ok: boolean;
        errores: { error: string; campo: string }[];
        avisos: string[];
      };

    const sinEnv = await comprobar(archivo("reformas"));
    expect(sinEnv.ok).toBe(true);
    expect(sinEnv.errores).toEqual([]);
    expect(sinEnv.avisos).not.toContain(E1);

    vi.stubEnv("PLANTILLA", "solicitud_recibida");
    expect((await comprobar(archivo("reformas"))).avisos).toContain(E1);
    expect((await comprobar(archivo("generico"))).avisos).not.toContain(E1);
    const conPlantilla = archivo("reformas", { plantilla: { nombre: "mi_bienvenida", idioma: "es_ES", texto: "Hola {{1}}, te escribe {{2}}. ¿En qué te ayudamos?" } });
    expect((await comprobar(conPlantilla)).avisos).not.toContain(E1);

    const malo = await comprobar({ ...archivo("otro"), formato: "x", configuracion: { negocio: { color: "rojo" } } });
    expect(malo.ok).toBe(false);
    expect(malo.errores.map((e) => e.campo)).toEqual(expect.arrayContaining(["formato", "base"]));

    expect(modificar).not.toHaveBeenCalled();
    expect(leerAgente()).toBe(PRESETS_TEXTO.reformas);
    expect(await bd.leerCopiasInstrucciones()).toEqual({});
  });

  it("cuerpo demasiado grande → 413", async () => {
    const config = await import("@/app/api/configuracion/route");
    const logo = await import("@/app/api/logo/route");
    const peticion = (url: string, body: string, cabeceras: Record<string, string> = {}) =>
      new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body });

    const porCabecera = await config.POST(peticion("http://localhost/api/configuracion", "{}", { "Content-Length": String(300 * 1024) }));
    expect(porCabecera.status).toBe(413);
    expect(await porCabecera.json()).toEqual({ ok: false, error: "El cambio es demasiado grande" });

    const relleno = JSON.stringify({ perfilId: "estudio-de-reformas", cambios: { negocio: { lema: "x".repeat(210 * 1024) } } });
    const porBytes = await config.POST(peticion("http://localhost/api/configuracion", relleno));
    expect(porBytes.status).toBe(413);

    const roto = await config.POST(peticion("http://localhost/api/configuracion", "{no es json"));
    expect(roto.status).toBe(400);
    expect(await roto.json()).toEqual({ ok: false, error: "No se ha entendido la petición" });

    const grande = await logo.POST(peticion("http://localhost/api/logo", JSON.stringify({ dataUrl: `data:image/png;base64,${"A".repeat(460 * 1024)}` })));
    expect(grande.status).toBe(413);
    expect(await grande.json()).toEqual({ ok: false, error: "La imagen es demasiado grande" });
    expect(modificar).not.toHaveBeenCalled();
  });

  it("GET /api/logo con nosniff, CSP y CORP", async () => {
    const { GET } = await import("@/app/api/logo/route");
    const activa = await guardarLogoActivo(png(7, 8, 9));
    const url = `http://localhost${activa.negocio.logoUrl}`;
    const r = await GET(new Request(url));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(r.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const vieja = await GET(new Request("http://localhost/api/logo?perfil=estudio-de-reformas&v=otra"));
    expect(vieja.status).toBe(200);
    expect(vieja.headers.get("Cache-Control")).toBe("no-store");
    expect((await GET(new Request("http://localhost/api/logo?perfil=inmobiliaria&v=x"))).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/logo?perfil=../etc"))).status).toBe(404);
  });
});
