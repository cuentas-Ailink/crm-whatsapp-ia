import { describe, expect, it } from "vitest";
import {
  CUERPO_GENERAL,
  CUERPO_POR_DEFECTO,
  FRASES_USTED,
  generarPistaDatos,
  GUARDADA_VACIA,
  PLANTILLA_GENERAL,
  type ConfiguracionGuardada,
  type ConfiguracionPerfil,
} from "./configuracion";
import { configuracionPorDefecto, PRESETS, resolver, type Entorno } from "./presets";

const REFORMAS = { id: "estudio-de-reformas", nombre: "Estudio de reformas", hash: "h1" };
const INMOBILIARIA = { id: "inmobiliaria", nombre: "Inmobiliaria", hash: "h2" };
const CLINICA = { id: "clinica", nombre: "Clínica", hash: "h3" };
const PROPIO = { id: "peluqueria-lola", nombre: "Peluquería Lola", hash: "h4" };
const ENV_LEGADO: Entorno = { NOMBRE_NEGOCIO: "Estudio de reformas", PLANTILLA: "solicitud_recibida", PLANTILLA_IDIOMA: "es_ES" };

function guardada(perfiles: Record<string, ConfiguracionPerfil>, resto: Partial<ConfiguracionGuardada> = {}): ConfiguracionGuardada {
  return { version: 1, rev: 0, perfiles, sistema: {}, ...resto };
}

describe("resolver: plantilla y nombre (regla E1)", () => {
  it("reformas sin nada guardado y el .env de siempre", () => {
    const c = resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: ENV_LEGADO });
    expect(c.negocio.nombre).toBe("Estudio de reformas");
    expect(c.plantilla).toEqual({ nombre: "solicitud_recibida", idioma: "es_ES", texto: CUERPO_POR_DEFECTO });
    expect(c.sector).toBe("reformas");
    expect(c.base).toBe("reformas");
    expect(c.guardada).toBe(false);
  });

  it("sin entorno, la plantilla general", () => {
    const c = resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: {} });
    expect(c.plantilla).toEqual(PLANTILLA_GENERAL);
    expect(c.negocio.nombre).toBe(PRESETS.reformas.negocio.nombre);
    expect(configuracionPorDefecto().plantilla).toEqual(PLANTILLA_GENERAL);
  });

  it("solo PLANTILLA: idioma es_ES y el cuerpo conocido, o el de siempre", () => {
    expect(resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: { PLANTILLA: "solicitud_general" } }).plantilla).toEqual({
      nombre: "solicitud_general",
      idioma: "es_ES",
      texto: CUERPO_GENERAL,
    });
    expect(resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: { PLANTILLA: "mi_plantilla" } }).plantilla).toEqual({
      nombre: "mi_plantilla",
      idioma: "es_ES",
      texto: CUERPO_POR_DEFECTO,
    });
    expect(resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: { PLANTILLA_IDIOMA: "es_MX" } }).plantilla).toEqual({
      nombre: "solicitud_recibida",
      idioma: "es_MX",
      texto: CUERPO_POR_DEFECTO,
    });
  });

  it("inmobiliaria: los valores del preset y el entorno no cuenta", () => {
    const c = resolver({ perfil: INMOBILIARIA, guardada: GUARDADA_VACIA, entorno: { ...ENV_LEGADO, NOMBRE_NEGOCIO: "Otro nombre" } });
    const p = PRESETS.inmobiliaria;
    expect(c.sector).toBe("inmobiliaria");
    expect(c.negocio).toEqual({ ...p.negocio, logoUrl: null });
    expect(c.plantilla).toEqual(p.plantilla);
    expect(c.calendario).toEqual(p.calendario);
    expect(c.vocabulario).toEqual(p.vocabulario);
    expect(c.campos).toEqual(p.campos);
    expect(c.agente).toEqual(p.agente);
    expect(c.portada).toEqual(p.portada);
    expect(c.spam).toEqual(p.spam);
  });

  it("un título desconocido es un perfil propio: base reformas, el nombre del título y E1", () => {
    const c = resolver({ perfil: PROPIO, guardada: GUARDADA_VACIA, entorno: ENV_LEGADO });
    expect(c.sector).toBe("personalizado");
    expect(c.base).toBe("reformas");
    expect(c.negocio.nombre).toBe("Peluquería Lola");
    expect(c.plantilla).toEqual({ nombre: "solicitud_recibida", idioma: "es_ES", texto: CUERPO_POR_DEFECTO });
  });

  it("un perfil propio con base inmobiliaria no mira el entorno", () => {
    const g = guardada({ "peluqueria-lola": { sector: "personalizado", base: "inmobiliaria" } });
    const c = resolver({ perfil: PROPIO, guardada: g, entorno: ENV_LEGADO });
    expect(c.base).toBe("inmobiliaria");
    expect(c.negocio.nombre).toBe("Peluquería Lola");
    expect(c.plantilla).toEqual(PLANTILLA_GENERAL);
    expect(c.vocabulario).toEqual(PRESETS.inmobiliaria.vocabulario);
  });

  it("lo guardado gana al entorno y la plantilla va entera", () => {
    const propia = { nombre: "bienvenida_lola", idioma: "es_MX", texto: "Hola {{1}}, te escribe {{2}}. ¿Qué te hacemos?" };
    const g = guardada({ "estudio-de-reformas": { negocio: { nombre: "Reformas Pepe" }, plantilla: propia } });
    const c = resolver({ perfil: REFORMAS, guardada: g, entorno: ENV_LEGADO });
    expect(c.negocio.nombre).toBe("Reformas Pepe");
    expect(c.plantilla).toEqual(propia);
    // Una plantilla guardada a medias no vale: se queda la de E1 entera, nunca mezclada.
    const rota = guardada({ "estudio-de-reformas": { plantilla: { nombre: "bienvenida_lola" } as never } });
    expect(resolver({ perfil: REFORMAS, guardada: rota, entorno: ENV_LEGADO }).plantilla).toEqual({
      nombre: "solicitud_recibida",
      idioma: "es_ES",
      texto: CUERPO_POR_DEFECTO,
    });
    expect(resolver({ perfil: REFORMAS, guardada: rota, entorno: {} }).plantilla).toEqual(PLANTILLA_GENERAL);
  });
});

describe("resolver: secciones", () => {
  it("un calendario a medias se fusiona con el del preset", () => {
    const g = guardada({ clinica: { calendario: { diasAbiertos: [1, 2, 3, 4, 5, 6] } } });
    const c = resolver({ perfil: CLINICA, guardada: g, entorno: {} });
    expect(c.calendario).toEqual({ ...PRESETS.clinica.calendario, diasAbiertos: [1, 2, 3, 4, 5, 6] });
    expect(c.calendario.horas).toEqual(PRESETS.clinica.calendario.horas);
  });

  it("un calendario guardado que no vale: el del preset", () => {
    const g = guardada({ clinica: { calendario: { horas: [] } } });
    expect(resolver({ perfil: CLINICA, guardada: g, entorno: {} }).calendario).toEqual(PRESETS.clinica.calendario);
  });

  it("una sección rota: la del preset; las demás se quedan", () => {
    const g = guardada({
      "estudio-de-reformas": {
        negocio: { lema: "Desde 1990" },
        portada: { hero: { titular: "x".repeat(41) } },
        vocabulario: { cita: { singular: "cita" } as never },
        spam: { dominiosNormales: ["habitissimo.es"] },
      },
    });
    const c = resolver({ perfil: REFORMAS, guardada: g, entorno: {} });
    expect(c.negocio.lema).toBe("Desde 1990");
    expect(c.portada).toEqual(PRESETS.reformas.portada);
    expect(c.vocabulario).toEqual(PRESETS.reformas.vocabulario);
    expect(c.spam).toEqual({ dominiosNormales: ["habitissimo.es"], ganchosQuitados: [] });
  });

  it("los objetos se fusionan y los arrays se sustituyen", () => {
    const g = guardada({
      "estudio-de-reformas": {
        portada: { hero: { titular: "Tu cocina nueva." }, formulario: { chips: ["Rápido", "Sin compromiso"] } },
        vocabulario: { cita: { singular: "cita", plural: "citas", genero: "f" } },
      },
    });
    const c = resolver({ perfil: REFORMAS, guardada: g, entorno: {} });
    const p = PRESETS.reformas.portada;
    expect(c.portada.hero).toEqual({ ...p.hero, titular: "Tu cocina nueva." });
    expect(c.portada.formulario).toEqual({ ...p.formulario, chips: ["Rápido", "Sin compromiso"] });
    expect(c.portada.proceso).toEqual(p.proceso);
    expect(c.vocabulario).toEqual({ ...PRESETS.reformas.vocabulario, cita: { singular: "cita", plural: "citas", genero: "f" } });
  });

  it("sin galería en el preset no hay clave galeria; una galería guardada entera, sí; a medias, no", () => {
    expect(resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: {} }).portada).not.toHaveProperty("galeria");
    const galeria = { titular: "Trabajos", nota: "", tarjetas: [{ titulo: "Cocina", detalle: "", foto: 1, descripcion: "" }] };
    const entera = resolver({ perfil: REFORMAS, guardada: guardada({ "estudio-de-reformas": { portada: { galeria } } }), entorno: {} });
    expect(entera.portada.galeria).toEqual(galeria);
    const aMedias = resolver({ perfil: REFORMAS, guardada: guardada({ "estudio-de-reformas": { portada: { galeria: { nota: "x" } as never } } }), entorno: {} });
    expect(aMedias.portada).toEqual(PRESETS.reformas.portada);
  });

  it("el país y el prefijo van juntos", () => {
    const bien = guardada({ "estudio-de-reformas": { regional: { pais: "MX", moneda: "MXN", prefijo: "52" } } });
    expect(resolver({ perfil: REFORMAS, guardada: bien, entorno: {} }).regional).toEqual({ pais: "MX", moneda: "MXN", prefijo: "52" });
    const solo = guardada({ "estudio-de-reformas": { regional: { pais: "MX" } } });
    expect(resolver({ perfil: REFORMAS, guardada: solo, entorno: {} }).regional).toEqual(PRESETS.reformas.regional);
    const moneda = guardada({ "estudio-de-reformas": { regional: { moneda: "USD" } } });
    expect(resolver({ perfil: REFORMAS, guardada: moneda, entorno: {} }).regional).toEqual({ ...PRESETS.reformas.regional, moneda: "USD" });
  });

  it("la pista de datos sale de los campos guardados", () => {
    const campos = [{ clave: "tratamiento", etiqueta: "Tratamiento" }];
    const c = resolver({ perfil: REFORMAS, guardada: guardada({ "estudio-de-reformas": { campos } }), entorno: {} });
    expect(c.campos).toEqual(campos);
    expect(c.pistaDatos).toEqual(generarPistaDatos(campos, c.vocabulario));
    expect(resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: {} }).pistaDatos).toEqual(PRESETS.reformas.pistaDatos);
    const clinica = resolver({ perfil: CLINICA, guardada: GUARDADA_VACIA, entorno: {} });
    expect(clinica.pistaDatos).toEqual(generarPistaDatos(PRESETS.clinica.campos, PRESETS.clinica.vocabulario));
  });
});

describe("resolver: el asistente y el trato", () => {
  it("por defecto, tú con las frases del preset (clínica: pase y borrarDatos propios)", () => {
    const c = resolver({ perfil: CLINICA, guardada: GUARDADA_VACIA, entorno: {} });
    expect(c.agente.trato).toBe("tu");
    expect(c.agente.frases).toEqual(PRESETS.clinica.agente.frases);
    expect(c.agente.frases.pase).toBe(PRESETS.clinica.agente.frases.pase);
    expect(c.agente.frases.borrarDatos).toBe(PRESETS.clinica.agente.frases.borrarDatos);
  });

  it("de usted: las frases de usted campo a campo, y las guardadas ganan", () => {
    const usted = resolver({ perfil: CLINICA, guardada: guardada({ clinica: { agente: { trato: "usted" } } }), entorno: {} });
    expect(usted.agente.frases).toEqual(FRASES_USTED);
    const conPase = resolver({
      perfil: CLINICA,
      guardada: guardada({ clinica: { agente: { trato: "usted", frases: { pase: "Le paso con recepción ahora mismo." } } } }),
      entorno: {},
    });
    expect(conPase.agente.frases).toEqual({ ...FRASES_USTED, pase: "Le paso con recepción ahora mismo." });
    expect(conPase.agente.trato).toBe("usted");
    expect(conPase.agente.pasarSiempre).toEqual(PRESETS.clinica.agente.pasarSiempre);
  });

  it("una frase guardada con tú se queda aunque el resto venga del preset", () => {
    const c = resolver({ perfil: REFORMAS, guardada: guardada({ "estudio-de-reformas": { agente: { negociar: "no", frases: { fallo: "Uy, repítemelo." } } } }), entorno: {} });
    expect(c.agente).toEqual({ ...PRESETS.reformas.agente, negociar: "no", frases: { ...PRESETS.reformas.agente.frases, fallo: "Uy, repítemelo." } });
  });
});

describe("resolver: logo, sistema, firma y basura", () => {
  it("logoVersion da la URL del logo", () => {
    const c = resolver({ perfil: PROPIO, guardada: guardada({ "peluqueria-lola": { negocio: { logoVersion: "0123456789ab" } } }), entorno: {} });
    expect(c.negocio.logoUrl).toBe("/api/logo?perfil=peluqueria-lola&v=0123456789ab");
    expect(c.guardada).toBe(true);
    expect(resolver({ perfil: PROPIO, guardada: GUARDADA_VACIA, entorno: {} }).negocio.logoUrl).toBeNull();
  });

  it("la clínica avisa con el detalle mínimo salvo que se haya guardado otro", () => {
    expect(resolver({ perfil: CLINICA, guardada: GUARDADA_VACIA, entorno: {} }).sistema.avisos.comercial.detalle).toBe("minimo");
    expect(resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: {} }).sistema.avisos.comercial.detalle).toBe("completo");
    const g = guardada({}, { sistema: { avisos: { comercial: { detalle: "completo" } } } });
    expect(resolver({ perfil: CLINICA, guardada: g, entorno: {} }).sistema.avisos.comercial.detalle).toBe("completo");
  });

  it("rev viene de lo guardado", () => {
    expect(resolver({ perfil: REFORMAS, guardada: guardada({}, { rev: 7 }), entorno: {} }).rev).toBe(7);
  });

  it("la firma es estable y cambia con la parte pública", () => {
    const g = () => guardada({ "estudio-de-reformas": { negocio: { color: "#2b7bb9" } } });
    const a = resolver({ perfil: REFORMAS, guardada: g(), entorno: {} });
    const b = resolver({ perfil: REFORMAS, guardada: g(), entorno: {} });
    expect(a.firma).toMatch(/^[0-9a-f]{8}$/);
    expect(a.firma).toBe(b.firma);
    const otroColor = resolver({ perfil: REFORMAS, guardada: guardada({ "estudio-de-reformas": { negocio: { color: "#c2562d" } } }), entorno: {} });
    expect(otroColor.firma).not.toBe(a.firma);
    expect(resolver({ perfil: REFORMAS, guardada: guardada({}, { rev: 1 }), entorno: {} }).firma).not.toBe(
      resolver({ perfil: REFORMAS, guardada: guardada({}, { rev: 2 }), entorno: {} }).firma,
    );
  });

  it("la basura nunca lanza", () => {
    const basura: unknown[] = [null, undefined, 1, "x", [], { perfiles: null }, { perfiles: { "estudio-de-reformas": "x" } }, { perfiles: { "estudio-de-reformas": { agente: 3, portada: [], calendario: "x", negocio: { nombre: 5 } } } }];
    for (const g of basura) {
      const c = resolver({ perfil: REFORMAS, guardada: g as ConfiguracionGuardada, entorno: {} });
      expect(c.negocio.nombre).toBe("Estudio de reformas");
      expect(c.agente).toEqual(PRESETS.reformas.agente);
    }
    expect(() => resolver(null as never)).not.toThrow();
    expect(() => resolver({ perfil: null, guardada: null, entorno: null } as never)).not.toThrow();
  });
});

describe("la entrada de la web", () => {
  it("sin nada guardado, el botón de WhatsApp con el mensaje del preset; un negocio propio, el de su base", () => {
    expect(resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: {} }).web).toEqual(PRESETS.reformas.web);
    expect(resolver({ perfil: CLINICA, guardada: GUARDADA_VACIA, entorno: {} }).web).toEqual(PRESETS.clinica.web);
    expect(resolver({ perfil: PROPIO, guardada: guardada({ [PROPIO.id]: { sector: "personalizado", base: "generico" } }), entorno: {} }).web).toEqual(PRESETS.generico.web);
  });

  it("lo guardado manda campo a campo; lo roto se queda en el preset; la firma cambia", () => {
    const base = resolver({ perfil: REFORMAS, guardada: GUARDADA_VACIA, entorno: {} });
    const formulario = resolver({ perfil: REFORMAS, guardada: guardada({ [REFORMAS.id]: { web: { entrada: "formulario" } } }), entorno: {} });
    expect(formulario.web).toEqual({ entrada: "formulario", mensaje: PRESETS.reformas.web.mensaje });
    expect(formulario.firma).not.toBe(base.firma);
    const mensaje = resolver({ perfil: REFORMAS, guardada: guardada({ [REFORMAS.id]: { web: { mensaje: "Hola {negocio}" } } }), entorno: {} });
    expect(mensaje.web).toEqual({ entrada: "whatsapp", mensaje: "Hola {negocio}" });
    const roto = resolver({ perfil: REFORMAS, guardada: guardada({ [REFORMAS.id]: { web: { entrada: "fax" } as never } }), entorno: {} });
    expect(roto.web).toEqual(PRESETS.reformas.web);
  });
});
