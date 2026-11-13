// Los cuatro sectores de partida: instrucciones honestas, textos de la portada, frases, la regla de
// urgencias de la clínica, los ejemplos de inmobiliaria, clínica y «Otro» y el negocio de ejemplo que
// copia Claude Code. Lo que aquí se comprueba es lo que recibe cualquier usuario, no un truco para enseñarlo.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { revisarReglas, sumarDias, textoHueco, verHuecos } from "./agenda";
import {
  CUERPO_POR_DEFECTO,
  FOTOS_PORTADA,
  FRASES_POR_DEFECTO,
  GUARDADA_VACIA,
  opcionesSemilla,
  PLANTILLA_GENERAL,
  revisarCambios,
  revisarInstrucciones,
  revisarPlantilla,
  type ConfiguracionGuardada,
  type ConfiguracionResuelta,
  type NegocioExportado,
  type Plantilla,
  type Preset,
  type ReglasAgente,
  type SectorPreset,
} from "./configuracion";
import { controles, paseObligado, pideBaja } from "./guion";
import { visitaSinCerrar } from "./hilo";
import { esEjemplo, leerFichas, leerTitulo } from "./negocio";
import { PRESETS, resolver } from "./presets";
import { formatoImporte } from "./regional";
import { detectarSpam } from "./spam";
import { crearSemilla, generarSector, huecosProtegidos, momentoEn, OPCIONES_POR_DEFECTO } from "./semilla";
import { generadorDe } from "./semillas/index";
import { generarClinica } from "./semillas/clinica";
import { generarGenerico } from "./semillas/generico";
import { generarInmobiliaria } from "./semillas/inmobiliaria";
import { DATOS_REFORMAS, generarReformas } from "./semillas/reformas";
import type { OpcionesSemilla, SemillaGenerada } from "./semillas/tipos";
import { MOTIVOS_NO_SIGUE, type Lead, type ReglasAgenda } from "./tipos";
import type { Vocabulario } from "./vocabulario";

// Miércoles 11 nov 2026, 10:00 en Madrid; el mismo día a las 07:30 y a las 22:00.
const AHORA = new Date("2026-11-11T09:00:00Z");
const TEMPRANO = new Date("2026-11-11T06:30:00Z");
const NOCHE = new Date("2026-11-11T21:00:00Z");
const MISMO_DIA = [AHORA, TEMPRANO, NOCHE];
const ZONA = "Europe/Madrid";
const SECTORES = Object.keys(PRESETS) as SectorPreset[];

const leer = (ruta: string) => readFileSync(ruta, "utf8");

/** Lo que no puede prometer nadie: el texto literal de la regla 3 de los ejemplos. */
const LITERAL = /d[ií]a antes|v[ií]spera|recordatorio|record[áa]rtelo|\d+\s*h(oras)? antes|antes de (la|tu) (visita|cita)|hoy mismo/i;
const PRIMERA_PERSONA = /(?<!\bno\s)\b(te|le|os)\s+(llam(o|amos|ar[eé]|aremos)|escrib(imos|ir[eé]|iremos))(?![a-záéíóúüñ])|te digo algo|nos pondremos en contacto/i;

function contexto(p: Preset, plantilla: Plantilla = PLANTILLA_GENERAL, perfilId = p.perfilId ?? "mi-negocio") {
  return { perfilId, vocabulario: p.vocabulario, agente: p.agente, moneda: p.regional.moneda, negocio: p.negocio.nombre, plantilla };
}

// La tabla de pisos y la frase del piso reservado: los leen otros tests y los scripts de prueba.
const FILAS_PISOS = [
  "| Ref   | Calle y barrio               | Precio    | m² | Hab. | Lo más destacado                         | Estado     |",
  "|-------|------------------------------|-----------|----|------|------------------------------------------|------------|",
  "| P-101 | Calle Mallorca (Eixample)    | 465.000 € | 85 | 3    | Reformado, ascensor, balcón              | Disponible |",
  "| P-102 | Carrer de Verdi (Gràcia)     | 389.000 € | 68 | 2    | Ático con terraza de 15 m², sin ascensor | Disponible |",
  "| P-103 | Carrer de Sants (Sants)      | 298.000 € | 72 | 3    | Para reformar, con ascensor              | Reservado  |",
];
const FRASE_RESERVADO = "Si preguntan por uno reservado, dilo y ofrece el que más se le parezca de los disponibles.";

describe("instrucciones", () => {
  it("el título de cada archivo es el perfil del preset", () => {
    for (const id of SECTORES) {
      const p = PRESETS[id];
      if (p.perfilId === null) {
        expect(leer(p.archivo).split("\n")[0]).toBe("# Asistente de WhatsApp · Mi negocio");
        continue;
      }
      expect(leerTitulo(leer(p.archivo)).id, id).toBe(p.perfilId);
    }
  });

  it("cada instrucción pasa las Comprobaciones sin un solo aviso", () => {
    for (const id of SECTORES) {
      const p = PRESETS[id];
      const r = revisarInstrucciones(leer(p.archivo), contexto(p));
      expect(r.error, id).toBeUndefined();
      expect(r.avisos, id).toEqual([]);
    }
    const reformas = PRESETS.reformas;
    const legado = { nombre: "solicitud_recibida", idioma: "es_ES", texto: CUERPO_POR_DEFECTO };
    const r = revisarInstrucciones(leer(reformas.archivo), contexto(reformas, legado));
    expect(r.error).toBeUndefined();
    expect(r.avisos).toEqual([]);
  });

  it("ninguna promete «hoy mismo», «el día antes» ni pide que no parezca un robot", () => {
    for (const ruta of SECTORES.map((id) => PRESETS[id].archivo)) {
      const t = leer(ruta).toLowerCase();
      for (const prohibido of ["hoy mismo", "día antes", "robot"]) expect(t.includes(prohibido), `${ruta}: ${prohibido}`).toBe(false);
      expect(t).toContain("asistente virtual");
      expect(t).not.toMatch(/no digas que eres una ia/);
    }
  });

  it("sin agente.md, el CRM parte de perfiles/reformas.md", () => {
    // agente.md es de cada instalación (no está en el repositorio): quien lo crea copia reformas.
    expect(PRESETS.reformas.archivo).toBe("perfiles/reformas.md");
    for (const script of ["scripts/arrancar.mjs", "scripts/servidor-pruebas.mjs"]) {
      expect(leer(script), script).toContain('copyFileSync("perfiles/reformas.md", "agente.md")');
    }
  });

  it("la tabla de pisos y la frase del reservado no se mueven", () => {
    const lineas = leer("perfiles/inmobiliaria.md").split("\n");
    const inicio = lineas.indexOf(FILAS_PISOS[0]);
    expect(lineas.slice(inicio, inicio + FILAS_PISOS.length)).toEqual(FILAS_PISOS);
    expect(lineas).toContain(FRASE_RESERVADO);
    expect(leerFichas(leer("perfiles/inmobiliaria.md")).map((f) => [f.ref, f.disponible])).toEqual([
      ["P-101", true],
      ["P-102", true],
      ["P-103", false],
    ]);
    expect(leerFichas(leer("perfiles/reformas.md"))).toEqual([]);
  });

  it("el pase de cada instrucción dice lo mismo que su frase fija: «…te escribe en cuanto pueda»", () => {
    for (const id of SECTORES) {
      const p = PRESETS[id];
      expect(p.agente.frases.pase, id).toMatch(/te escribe en cuanto pueda\.$/);
      expect(leer(p.archivo), id).toMatch(/## Pasar a una persona\n[^\n]*escribe en cuanto pueda\./);
    }
  });
});

/** Todos los textos de la portada de un preset. */
function textosPortada(p: Preset): string[] {
  const { portada } = p;
  return [
    portada.descripcion,
    portada.hero.antetitulo,
    portada.hero.titular,
    portada.hero.subtitulo,
    ...portada.formulario.chips,
    portada.formulario.zona,
    portada.formulario.consentimiento,
    portada.formulario.boton,
    ...portada.formulario.enviado,
    portada.proceso.titular,
    portada.proceso.boton,
    ...portada.proceso.pasos.flatMap((x) => [x.titulo, x.detalle]),
    ...portada.proceso.ejemplo.map((x) => x.texto),
  ];
}

describe("presets", () => {
  it("cada preset entero pasa como cambio completo", () => {
    for (const id of SECTORES) {
      const p = PRESETS[id];
      const { negocio, plantilla, calendario, regional, vocabulario, campos, agente, spam, portada } = p;
      const r = revisarCambios({ negocio, plantilla, calendario, regional, vocabulario, campos, agente, spam, portada }, { ahora: AHORA, vocabulario });
      expect("error" in r ? r : "ok", id).toBe("ok");
    }
  });

  it("plantilla general, agenda que da huecos y trato de tú", () => {
    for (const id of SECTORES) {
      const p = PRESETS[id];
      expect(revisarPlantilla(p.plantilla), id).toEqual({ plantilla: PLANTILLA_GENERAL });
      expect(p.plantilla).toEqual(PLANTILLA_GENERAL);
      const reglas = revisarReglas(p.calendario, p.calendario);
      expect("error" in reglas ? reglas : "ok", id).toBe("ok");
      expect(verHuecos([], AHORA, p.calendario), id).toHaveLength(2);
      expect(p.agente.trato, id).toBe("tu");
    }
  });

  it("frases: borrar datos nombra al negocio y la presentación dice «asistente virtual»", () => {
    for (const id of SECTORES) {
      const { frases } = PRESETS[id].agente;
      expect(frases.borrarDatos, id).toContain("{negocio}");
      expect(frases.presentacion, id).toBe("Soy el asistente virtual de {negocio}.");
    }
    expect(PRESETS.reformas.agente.frases).toEqual(FRASES_POR_DEFECTO);
    expect(PRESETS.inmobiliaria.agente.frases).toEqual(FRASES_POR_DEFECTO);
    expect(PRESETS.generico.agente.frases).toEqual({ ...FRASES_POR_DEFECTO, pase: "Entendido, te paso con una persona del equipo, que te escribe en cuanto pueda." });
    expect(PRESETS.clinica.agente.frases).toEqual({
      ...FRASES_POR_DEFECTO,
      pase: "Entendido, te paso con recepción, que te escribe en cuanto pueda.",
      borrarDatos: "Se lo paso a recepción de {negocio} para que borre tus datos.",
    });
  });

  it("la portada: sin galería ni estudio, fotos de la lista, casilla sin marcar y el ejemplo acaba igual", () => {
    for (const id of SECTORES) {
      const { portada } = PRESETS[id];
      expect(portada.galeria, id).toBeUndefined();
      expect(portada.estudio, id).toBeUndefined();
      for (const foto of [portada.hero.foto, portada.proceso.foto]) {
        if (foto !== null) expect(FOTOS_PORTADA as readonly string[]).toContain(foto);
      }
      expect(portada.hero.subtitulo).toBe("Te escribimos por WhatsApp en segundos.");
      expect(portada.formulario).toMatchObject({
        zona: "Zona o barrio",
        consentimiento: "Acepto que {negocio} me escriba por WhatsApp sobre esta solicitud.",
        urlPrivacidad: null,
        marcado: false,
        boton: "Enviar solicitud",
        enviado: ["Hecho", "Busca el mensaje de {negocio} en tu móvil"],
      });
      expect(portada.proceso.titular).toBe("Cómo funciona");
      expect(portada.proceso.boton).toBe("Rellenar el formulario");
      expect(portada.proceso.pasos.some((x) => x.detalle.includes("{opciones}")), id).toBe(true);
      expect(portada.proceso.ejemplo.at(-1)?.texto.endsWith("Si prefieres hablar con una persona, dímelo por aquí."), id).toBe(true);
      // Con el botón de WhatsApp: los dos primeros pasos cuentan que escribe el cliente; el resto, los mismos.
      expect(portada.whatsapp.subtitulo).toBe("Escríbenos por WhatsApp y te contestamos en segundos.");
      expect(portada.whatsapp.boton).toBe("Escribir por WhatsApp");
      expect(portada.whatsapp.pasos[0].titulo).toBe("Nos escribes por WhatsApp");
      expect(portada.whatsapp.pasos[1].titulo).toBe("Te contestamos en segundos");
      expect(portada.whatsapp.pasos.slice(2), id).toEqual(portada.proceso.pasos.slice(2));
      const formulario = /formulario|solicitud/i;
      for (const t of [portada.whatsapp.descripcion, portada.whatsapp.subtitulo, portada.whatsapp.boton, ...portada.whatsapp.pasos.flatMap((x) => [x.titulo, x.detalle])]) {
        expect(t, id).not.toMatch(formulario);
      }
    }
    // Todos empiezan con el botón de WhatsApp, cada uno con su mensaje.
    expect(Object.fromEntries(SECTORES.map((id) => [id, PRESETS[id].web]))).toEqual({
      reformas: { entrada: "whatsapp", mensaje: "Hola, quiero pedir presupuesto para una reforma." },
      inmobiliaria: { entrada: "whatsapp", mensaje: "Hola, quiero información sobre un inmueble." },
      clinica: { entrada: "whatsapp", mensaje: "Hola, quiero pedir cita." },
      generico: { entrada: "whatsapp", mensaje: "Hola, quiero más información." },
    });
    expect(PRESETS.clinica.portada.hero.foto).toBeNull();
    expect(PRESETS.generico.portada.proceso.foto).toBeNull();
  });

  it("ningún texto de la portada promete un aviso", () => {
    for (const id of SECTORES) {
      const p = PRESETS[id];
      const { PROMETE_RECORDATORIO } = controles(p.vocabulario);
      for (const t of textosPortada(p)) {
        expect(PROMETE_RECORDATORIO.test(t), `${id}: ${t}`).toBe(false);
        expect(LITERAL.test(t), `${id}: ${t}`).toBe(false);
      }
    }
  });

  it("las etiquetas de «¿Qué negocio es?»", () => {
    expect(SECTORES.map((id) => [PRESETS[id].etiqueta, PRESETS[id].descripcion, PRESETS[id].negocio.lema])).toEqual([
      ["Reformas", "Visitas para presupuestar obras", "Reformas integrales · Barcelona centro"],
      ["Inmobiliaria", "Pisos, visitas y comisiones", "Compra y venta de pisos · Barcelona"],
      ["Clínica", "Citas para pacientes", "Odontología general y estética"],
      ["Otro", "Tu negocio, desde cero", ""],
    ]);
  });
});

describe("urgencias de la clínica", () => {
  const clinica = PRESETS.clinica;
  const instrucciones = leer(clinica.archivo);
  const opciones = { pasarSiempre: clinica.agente.pasarSiempre, excepciones: clinica.agente.excepciones, negociar: "no" as const };
  const URGENCIA = { motivo: "Posible urgencia", respuesta: "Si es una urgencia grave, llama al 112. Te paso con recepción, que te escribe en cuanto pueda." };

  it("la regla: 15 frases enteras, de 3 a 40 caracteres", () => {
    const [regla] = clinica.agente.pasarSiempre;
    expect(clinica.agente.pasarSiempre).toHaveLength(1);
    expect(regla.frases).toHaveLength(15);
    expect(regla.frases.every((f) => f.length >= 3 && f.length <= 40)).toBe(true);
    expect(regla).toMatchObject(URGENCIA);
    expect(clinica.agente.excepciones).toEqual(["no es urgente"]);
  });

  it.each([
    "Se me ha hinchado la cara",
    "Me sangra la encía desde ayer",
    "Se me ha caído un empaste",
    "Tengo un flemón",
    "Buenos días, me duele mucho la muela",
    "Necesito cita urgente",
    "No aguanto el dolor",
    "Se me ha partido una muela",
  ])("«%s» pasa a recepción con el 112", (frase) => {
    expect(paseObligado(frase, instrucciones, opciones)).toEqual(URGENCIA);
  });

  it.each([
    "Quiero una limpieza",
    "No es urgente, cuando podáis",
    "sin dolor fuerte, solo es una revisión",
    "nada urgente",
    "no me duele mucho",
    "Quería pedir cita para una revisión",
    "ni sangra ni nada",
  ])("«%s» no pasa", (frase) => {
    expect(paseObligado(frase, instrucciones, opciones)).toBeNull();
  });
});

describe("resolver con la agenda", () => {
  it("un calendario guardado a medias se normaliza con las reglas de la agenda", () => {
    const guardada: ConfiguracionGuardada = { version: 1, rev: 0, perfiles: { "estudio-de-reformas": { calendario: { horas: ["9", "17h30"] } } }, sistema: {} };
    const c = resolver({ perfil: { id: "estudio-de-reformas", nombre: "Estudio de reformas", hash: "" }, guardada, entorno: {} });
    expect(c.calendario.horas).toEqual(["09:00", "17:30"]);
  });
});

// ---- Los ejemplos de inmobiliaria, clínica y «Otro» ----

interface Sector {
  nombre: string;
  base: SectorPreset;
  generador: (o: OpcionesSemilla, ahora: Date) => SemillaGenerada;
  perfil: { id: string; nombre: string; hash: string };
  guardada: ConfiguracionGuardada;
  cuotas: [number, number, number, number, number];
  /** Pasados por el asistente y tras la cita, con sus cierres. */
  persona: { pases: number; pasesNo: string[]; tras: number; si: [number, number | undefined][]; no: string[] };
  manual: number;
  carga: [number, number];
  campana?: string;
  anuncio?: string;
}

const SECTORES_EJEMPLO: Sector[] = [
  {
    nombre: "inmobiliaria",
    base: "inmobiliaria",
    generador: generarInmobiliaria,
    perfil: { id: "inmobiliaria", nombre: "Inmobiliaria", hash: "" },
    guardada: GUARDADA_VACIA,
    cuotas: [5, 10, 6, 12, 2],
    persona: { pases: 5, pasesNo: ["No contesta", "Precio"], tras: 7, si: [[8_940, 4_470], [10_560, undefined]], no: ["Ha elegido a otro", "Precio", "Se lo ha pensado"] },
    manual: 1,
    carga: [3, 6],
    campana: "Inmobiliaria Barcelona",
    anuncio: "¿Buscas piso en Barcelona? Pide una visita",
  },
  {
    nombre: "clínica",
    base: "clinica",
    generador: generarClinica,
    perfil: { id: "clinica", nombre: "Clínica", hash: "" },
    guardada: GUARDADA_VACIA,
    cuotas: [5, 10, 7, 11, 2],
    persona: { pases: 4, pasesNo: ["No contesta", "Se lo ha pensado"], tras: 7, si: [[1_250, undefined], [3_900, 600]], no: ["Ha elegido a otro", "Precio", "Se lo ha pensado"] },
    manual: 1,
    carga: [3, 6],
    campana: "Clínica dental",
    anuncio: "¿Te toca revisión? Pide cita por WhatsApp",
  },
  {
    nombre: "«Otro»",
    base: "generico",
    generador: generarGenerico,
    perfil: { id: "mi-negocio", nombre: "Mi negocio", hash: "" },
    guardada: { version: 1, rev: 0, perfiles: { "mi-negocio": { sector: "personalizado", base: "generico" } }, sistema: {} },
    cuotas: [3, 6, 4, 6, 1],
    persona: { pases: 2, pasesNo: ["Se lo ha pensado"], tras: 4, si: [[1_200, 300]], no: ["Precio"] },
    manual: 0,
    carga: [2, 4],
  },
];

const SINTOMAS = /dolor|duele|sangr|inflam|hinch|fiebre|infecci|flem[oó]n|roto|partid/i;
const DIA_MS = 86_400_000;
const CIERRE_PERSONA = "Si prefieres hablar con una persona, dímelo por aquí.";

function madrid(ts: number): { fecha: string; hora: string; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const fecha = `${v("year")}-${v("month")}-${v("day")}`;
  return { fecha, hora: `${v("hour")}:${v("minute")}`, dia: new Date(`${fecha}T00:00:00Z`).getUTCDay() };
}

/** Los ratos en los que el dueño toca el panel, en los días abiertos del negocio. */
function enOficina(ts: number, r: ReglasAgenda): boolean {
  const { hora, dia } = madrid(ts);
  return r.diasAbiertos.includes(dia) && ((hora >= "09:00" && hora < "14:00") || (hora >= "15:30" && hora <= "19:30"));
}

/** Del texto de un hueco a su id, para leer los que salen en los mensajes. */
function lectorDeHuecos(r: ReglasAgenda): (texto: string) => string[] {
  const deTexto = new Map<string, string>();
  for (let f = "2026-09-01"; f <= "2027-02-28"; f = sumarDias(f, 1)) for (const h of r.horas) deTexto.set(textoHueco(`${f}T${h}`), `${f}T${h}`);
  const re = /(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) a las \d{2}:\d{2}/g;
  return (texto) => [...texto.matchAll(re)].map((m) => deTexto.get(m[0]) ?? `?${m[0]}`);
}

const esPase = (l: Lead) => (l.actividad ?? []).some((a) => a.texto.startsWith("Pasado a persona: ") && a.texto !== "Pasado a persona: Lo llevas tú desde el panel");
const libres = (l: Lead) => l.mensajes.filter((m) => m.de === "agente" && !m.manual && !m.plantilla);

describe.each(SECTORES_EJEMPLO)("ejemplos de $nombre", (sector) => {
  const config: ConfiguracionResuelta = resolver({ perfil: sector.perfil, guardada: sector.guardada, entorno: {} });
  const o = opcionesSemilla(config);
  const reglas = config.calendario;
  const memoria = new Map<number, SemillaGenerada>();
  const semilla = (ahora: Date) => {
    let s = memoria.get(ahora.getTime());
    if (!s) {
      s = crearSemilla(o.negocio, ahora, o);
      memoria.set(ahora.getTime(), s);
    }
    return s;
  };
  const leads = (ahora: Date = AHORA) => Object.values(semilla(ahora).leads);
  const huecos = lectorDeHuecos(reglas);
  const momento = (id: string) => momentoEn(id.slice(0, 10), id.slice(11), reglas.zona);

  it("el generador es el del sector y reformas no cambia", () => {
    expect(config.base).toBe(sector.base);
    expect(generadorDe(sector.base)).toBe(sector.generador);
    expect(generadorDe("reformas")).toBe(generarReformas);
    expect(crearSemilla("Estudio de reformas", AHORA)).toEqual(generarSector(DATOS_REFORMAS, OPCIONES_POR_DEFECTO, AHORA));
    expect(semilla(AHORA)).toEqual(sector.generador({ ...o }, AHORA));
  });

  it("todos de ejemplo y nada después de ahora", () => {
    for (const ahora of MISMO_DIA) {
      const t = ahora.getTime();
      for (const l of leads(ahora)) {
        expect(esEjemplo(l) && l.ejemplo === true).toBe(true);
        const instantes = [
          l.creadoEn,
          l.actualizadoEn,
          l.cambioEstadoEn,
          ...l.mensajes.map((m) => m.ts),
          ...(l.notas ?? []).map((n) => n.ts),
          ...(l.tareas ?? []).map((x) => x.ts),
          ...(l.actividad ?? []).map((a) => a.ts),
          ...[l.cierreEn, l.vueltaVistaEn, l.silenciadoEn].filter((x): x is number => x !== undefined),
        ];
        expect(Math.max(...instantes), `${l.nombre} en ${ahora.toISOString()}`).toBeLessThanOrEqual(t);
      }
    }
  });

  it("el mismo día a otra hora: los mismos ids, etapas, importes, cierres y citas", () => {
    const resumen = (s: SemillaGenerada) => ({
      leads: Object.values(s.leads)
        .map((l) => [l.id, l.estado, l.cierre ?? "", l.motivoCierre ?? "", l.presupuesto ?? "", l.cobrado ?? "", l.visita?.id ?? "", l.mensajes.map((m) => m.id).join(",")].join("|"))
        .sort(),
      reservas: s.reservas.map((r) => `${r.huecoId}|${r.leadId}`).sort(),
    });
    const referencia = resumen(semilla(AHORA));
    for (const ahora of [TEMPRANO, NOCHE]) expect(resumen(semilla(ahora))).toEqual(referencia);
  });

  it("las cuotas por etapa, los pases, las citas pasadas y los cierres", () => {
    for (const ahora of MISMO_DIA) {
      const lista = leads(ahora);
      const cuenta = (e: Lead["estado"]) => lista.filter((l) => l.estado === e).length;
      expect([cuenta("nuevo"), cuenta("conversacion"), cuenta("visita"), cuenta("persona"), cuenta("spam")]).toEqual(sector.cuotas);
      const persona = lista.filter((l) => l.estado === "persona");
      const pases = persona.filter(esPase);
      const tras = persona.filter((l) => l.visita);
      expect(pases).toHaveLength(sector.persona.pases);
      expect(tras).toHaveLength(sector.persona.tras);
      expect(pases.length + tras.length).toBe(persona.length);
      expect(pases.filter((l) => l.cierre === "no").map((l) => l.motivoCierre).sort()).toEqual([...sector.persona.pasesNo].sort());
      expect(pases.some((l) => l.cierre === "si")).toBe(false);
      expect(tras.filter((l) => l.cierre === "si").map((l) => [l.presupuesto, l.cobrado]).sort((x, y) => (x[0] as number) - (y[0] as number))).toEqual(sector.persona.si);
      expect(tras.filter((l) => l.cierre === "no").map((l) => l.motivoCierre).sort()).toEqual([...sector.persona.no].sort());
      const nuevos = lista.filter((l) => l.estado === "nuevo");
      expect(nuevos.filter((l) => l.origen === "manual")).toHaveLength(sector.manual);
      expect(nuevos.filter((l) => l.origen === "formulario")).toHaveLength(sector.cuotas[0] - sector.manual);
      for (const l of lista.filter((x) => x.estado === "visita")) expect(momento(l.visita?.id ?? "")).toBeGreaterThan(ahora.getTime());
    }
  });

  it("los cierres: la señal solo en los «sí», motivos de la lista, del dueño y con su línea", () => {
    for (const ahora of MISMO_DIA) {
      const t = ahora.getTime();
      for (const l of leads(ahora)) {
        if (l.cierre !== "no") expect(l.motivoCierre).toBeUndefined();
        if (l.cierre !== "si") expect(l.cobrado).toBeUndefined();
        if (l.estado !== "persona") expect(l.cierre).toBeUndefined();
        if (l.estado === "nuevo" || l.estado === "conversacion" || l.estado === "spam") expect(l.presupuesto, l.nombre).toBeUndefined();
        if (!l.cierre) continue;
        if (l.cierre === "no") expect(MOTIVOS_NO_SIGUE).toContain(l.motivoCierre);
        else expect(l.cobrado ?? 0).toBeLessThanOrEqual(l.presupuesto as number);
        const cierreEn = l.cierreEn as number;
        expect(t - cierreEn).toBeLessThanOrEqual(30 * DIA_MS);
        expect(madrid(cierreEn).fecha < madrid(t).fecha).toBe(true);
        expect(enOficina(cierreEn, reglas), `${l.nombre} cierra a las ${madrid(cierreEn).hora}`).toBe(true);
        if (l.visita) expect(momento(l.visita.id)).toBeLessThan(cierreEn);
        else expect((l.actividad ?? []).find((a) => a.texto.startsWith("Pasado a persona: "))?.ts as number).toBeLessThan(cierreEn);
        const texto = l.cierre === "si" ? `Ha dicho que sí · ${formatoImporte(l.presupuesto as number, "EUR")}` : `No sigue · ${l.motivoCierre}`;
        expect(l.actividad).toContainEqual({ id: `cierre-${l.id}-${cierreEn}`, texto, ts: cierreEn });
        expect((l.actividad ?? []).filter((a) => a.texto.startsWith("Ha dicho que sí") || a.texto.startsWith("No sigue"))).toHaveLength(1);
      }
    }
  });

  it("la carga de «Te toca a ti» en la referencia es la de una mañana normal", () => {
    const t = AHORA.getTime();
    const abiertos = leads().filter((l) => (!l.cierre && l.estado === "persona") || visitaSinCerrar(l, t, reglas.zona));
    expect(abiertos.length).toBeGreaterThanOrEqual(sector.carga[0]);
    expect(abiertos.length).toBeLessThanOrEqual(sector.carga[1]);
    for (const l of leads().filter((x) => x.visita && !x.cierre && momento(x.visita.id) < t)) {
      let abiertosDesde = 0;
      for (let f = l.visita?.id.slice(0, 10) as string; f < madrid(t).fecha; f = sumarDias(f, 1)) if (reglas.diasAbiertos.includes(new Date(`${f}T00:00:00Z`).getUTCDay())) abiertosDesde++;
      expect(abiertosDesde, l.nombre).toBeGreaterThanOrEqual(1);
      expect(abiertosDesde, l.nombre).toBeLessThanOrEqual(3);
    }
  });

  it("ninguna promesa que el código no cumple y el asistente dice que es un asistente virtual", () => {
    const { PROMETE_RECORDATORIO } = controles(o.vocabulario);
    for (const l of leads()) {
      for (const m of l.mensajes) {
        expect(PROMETE_RECORDATORIO.test(m.texto), m.texto).toBe(false);
        expect(LITERAL.test(m.texto), m.texto).toBe(false);
        if (m.de === "agente" && !m.manual && !m.plantilla) expect(PRIMERA_PERSONA.test(m.texto), m.texto).toBe(false);
      }
      if (esPase(l)) expect(libres(l).at(-1)?.texto, l.nombre).toMatch(/te escribe en cuanto pueda\.$/);
      const delAsistente = libres(l);
      if (!delAsistente.length) continue;
      const plantilla = l.mensajes.find((m) => m.plantilla);
      if (plantilla) expect(plantilla.texto).toContain("asistente virtual");
      else expect(delAsistente[0].texto, l.nombre).toContain("asistente virtual");
      expect(l.mensajes.some((m) => /te esperamos/i.test(m.texto) && !m.manual)).toBe(false);
    }
  });

  it("cada cita: dos huecos de la rejilla, el cliente elige y el asistente confirma ese", () => {
    for (const ahora of MISMO_DIA) {
      for (const l of leads(ahora)) {
        const agente = l.mensajes.map((m, k) => ({ m, k })).filter(({ m }) => m.de === "agente" && !m.manual && !m.plantilla);
        for (const { m } of agente) {
          for (const id of huecos(m.texto)) {
            expect(id.startsWith("?"), `${l.nombre}: hueco fuera de la rejilla en «${m.texto}»`).toBe(false);
            expect(reglas.diasAbiertos).toContain(new Date(`${id.slice(0, 10)}T00:00:00Z`).getUTCDay());
          }
        }
        if (!l.visita) {
          expect(agente.some(({ m }) => m.texto.endsWith(CIERRE_PERSONA) && huecos(m.texto).length === 1), l.nombre).toBe(false);
          continue;
        }
        const confirma = agente.find(({ m }) => huecos(m.texto).length === 1 && m.texto.endsWith(CIERRE_PERSONA));
        expect(confirma, `${l.nombre}: sin confirmación`).toBeDefined();
        expect(huecos(confirma?.m.texto ?? "")).toEqual([l.visita.id]);
        const oferta = agente.filter((x) => x.k < (confirma?.k ?? 0) && huecos(x.m.texto).length === 2).at(-1);
        expect(oferta, `${l.nombre}: confirma sin haber ofrecido`).toBeDefined();
        const ofrecidos = huecos(oferta?.m.texto ?? "");
        expect(new Set(ofrecidos).size).toBe(2);
        expect(ofrecidos).toContain(l.visita.id);
        expect(l.mensajes.slice((oferta?.k ?? 0) + 1, confirma?.k).some((x) => x.de === "cliente")).toBe(true);
        expect(reglas.horas).toContain(l.visita.id.slice(11));
      }
    }
  });

  it("largo de las conversaciones según la etapa", () => {
    for (const ahora of MISMO_DIA) {
      for (const l of leads(ahora)) {
        const n = l.mensajes.length;
        const manuales = l.mensajes.filter((m) => m.manual).length;
        const reciente = l.mensajes.some((m) => m.de === "cliente" && ahora.getTime() - m.ts <= DIA_MS);
        if (l.origen === "manual") expect(n).toBe(0);
        else if (l.estado === "nuevo") expect(n).toBe(1);
        else if (l.estado === "spam") expect(n).toBeGreaterThanOrEqual(1);
        else if (l.estado === "conversacion") {
          expect(n, l.nombre).toBeGreaterThanOrEqual(3);
          expect(n, l.nombre).toBeLessThanOrEqual(reciente ? 9 : 6);
        } else if (l.estado === "visita") {
          expect(n, l.nombre).toBeGreaterThanOrEqual(8);
          expect(n, l.nombre).toBeLessThanOrEqual(11);
        } else if (l.visita) {
          expect(n, l.nombre).toBeGreaterThanOrEqual(11);
          expect(n, l.nombre).toBeLessThanOrEqual(16);
        } else {
          expect(n - manuales, l.nombre).toBeGreaterThanOrEqual(4);
          expect(n - manuales, l.nombre).toBeLessThanOrEqual(8);
          expect(manuales, l.nombre).toBeGreaterThanOrEqual(1);
          expect(manuales, l.nombre).toBeLessThanOrEqual(3);
        }
        if (l.estado === "spam") expect(n).toBeLessThanOrEqual(2);
      }
    }
  });

  it("tiempos: el primer WhatsApp del formulario, la primera respuesta, el asistente y el dueño", () => {
    for (const l of leads()) {
      if (l.origen === "formulario") {
        expect(l.msPrimerWhatsApp as number).toBeGreaterThanOrEqual(1_100);
        expect(l.msPrimerWhatsApp as number).toBeLessThanOrEqual(5_000);
        expect(l.mensajes[0]).toMatchObject({ de: "agente", plantilla: true, nombrePlantilla: "solicitud_general", ts: l.creadoEn });
      } else expect(l.msPrimerWhatsApp).toBeUndefined();
      const agente = l.mensajes.find((m) => m.de === "agente" && !m.manual);
      if (l.origen === "whatsapp" && agente) {
        expect(l.mensajes[0].de).toBe("cliente");
        expect(l.msPrimeraRespuesta).toBe(agente.ts - l.mensajes[0].ts);
        expect(l.msPrimeraRespuesta as number).toBeGreaterThanOrEqual(5_000);
        expect(l.msPrimeraRespuesta as number).toBeLessThanOrEqual(12_000);
      } else expect(l.msPrimeraRespuesta, l.nombre).toBeUndefined();
      for (const [k, m] of l.mensajes.entries()) {
        const previo = l.mensajes[k - 1];
        if (m.de === "agente" && !m.manual && !m.plantilla && previo?.de === "cliente") {
          expect(m.ts - previo.ts).toBeGreaterThanOrEqual(5_000);
          expect(m.ts - previo.ts).toBeLessThanOrEqual(12_000);
        }
        if (!m.manual) continue;
        const cliente = l.mensajes.slice(0, k).filter((x) => x.de === "cliente").at(-1);
        expect(m.ts - (cliente?.ts ?? Number.NEGATIVE_INFINITY), `${l.nombre}: a mano fuera de las 24 h`).toBeLessThanOrEqual(DIA_MS);
        expect(enOficina(m.ts, reglas), `${l.nombre}: a mano a las ${madrid(m.ts).hora}`).toBe(true);
      }
    }
  });

  it("datos, teléfonos y origen como los guarda el producto", () => {
    const claves = new Set(o.campos.map((c) => c.clave));
    const lista = leads();
    const numeros = lista.map((l) => Number(l.telefono.slice(5)));
    expect(new Set(numeros).size).toBe(lista.length);
    expect(numeros.some((n) => numeros.includes(n + 1))).toBe(false);
    for (const l of lista) {
      expect(l.telefono).toMatch(/^34600\d{6}$/);
      expect(Object.keys(l.datos).every((k) => claves.has(k)), JSON.stringify(l.datos)).toBe(true);
      if (l.origen !== "formulario" || o.vocabulario.zona === null) expect(l.zona, l.nombre).toBeUndefined();
      expect((l.etiquetas ?? []).every((e) => e === e.toLowerCase() && e.length <= 24)).toBe(true);
      if (l.origen === "manual" || l.estado === "spam") expect(l.fuente).toBeUndefined();
      if (sector.campana === undefined) {
        if (l.fuente) expect(l.fuente).toEqual({ tipo: "buscador", plataforma: "Google" });
        continue;
      }
      if (l.fuente?.tipo === "anuncio") {
        expect(l.fuente).toEqual(l.origen === "formulario" ? { tipo: "anuncio", plataforma: "Meta", campana: sector.campana } : { tipo: "anuncio", plataforma: "Meta", anuncio: sector.anuncio });
      } else if (l.fuente) expect(l.fuente).toEqual({ tipo: "buscador", plataforma: "Google" });
    }
    if (sector.campana === undefined) expect(lista.some((l) => l.fuente?.tipo === "buscador")).toBe(true);
    else expect(lista.filter((l) => l.origen === "formulario" && l.fuente?.tipo === "anuncio").length).toBeGreaterThan(lista.filter((l) => l.origen === "formulario" && l.fuente?.tipo === "buscador").length);
    expect(JSON.stringify(semilla(AHORA))).not.toMatch(/"(asignado|autor|proyectos|equipo)":/);
  });

  it("uno pidió que no le escribieran: silencio, la frase de baja y su línea", () => {
    const callados = leads().filter((l) => l.silenciadoEn !== undefined);
    expect(callados).toHaveLength(1);
    const [l] = callados;
    expect(l).toMatchObject({ estado: "conversacion", origen: "whatsapp" });
    const baja = l.mensajes.filter((m) => m.de === "cliente").at(-1);
    expect(pideBaja(baja?.texto ?? "")).toBe(true);
    expect(l.silenciadoEn).toBe(baja?.ts);
    expect(l.mensajes.at(-1)?.texto).toBe(FRASES_POR_DEFECTO.baja);
    expect(l.actividad).toContainEqual({ id: `silencio-${l.id}-${baja?.ts}`, texto: "Ha pedido que no le escribamos", ts: baja?.ts });
  });

  it("el cliente añadido a mano", () => {
    for (const m of leads().filter((l) => l.origen === "manual")) {
      expect(m).toMatchObject({ estado: "nuevo", mensajes: [] });
      expect(m.actividad?.[0]).toMatchObject({ texto: "Lo añadiste tú", ts: m.creadoEn });
      expect(enOficina(m.creadoEn, reglas)).toBe(true);
    }
  });

  it("la publicidad: lo que para el código lleva su motivo exacto y sin respuesta; lo demás, una respuesta", () => {
    for (const l of leads().filter((x) => x.estado === "spam")) {
      expect(l.origen).toBe("whatsapp");
      expect(l.zona).toBeUndefined();
      expect(l.mensajes.filter((m) => m.de === "cliente")).toHaveLength(1);
      const respuestas = libres(l);
      if (respuestas.length === 0) {
        expect(detectarSpam({ textos: [l.mensajes[0].texto], recientes: [], telefono: l.telefono, ahora: l.creadoEn })?.motivo).toBe(l.motivoSpam);
      } else {
        expect(respuestas).toHaveLength(1);
        expect(detectarSpam({ textos: [l.mensajes[0].texto], recientes: [], telefono: l.telefono, ahora: l.creadoEn })).toBeNull();
      }
    }
  });

  it("las citas futuras: únicas, en la rejilla, fuera de los primeros huecos libres y de los ocupados", () => {
    for (const ahora of MISMO_DIA) {
      const { leads: todos, reservas } = semilla(ahora);
      const ids = reservas.map((r) => r.huecoId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(Object.values(todos).filter((l) => l.visita).map((l) => `${l.id}|${l.visita?.id}`).sort()).toEqual(reservas.map((r) => `${r.leadId}|${r.huecoId}`).sort());
      for (const r of reservas) {
        expect(r.prueba).toBe(true);
        expect(reglas.horas).toContain(r.huecoId.slice(11));
        if (momento(r.huecoId) < ahora.getTime()) continue;
        expect(huecosProtegidos(reservas.filter((x) => x !== r), ahora, reglas).has(r.huecoId), `${r.nombre} ocupa uno de los primeros huecos`).toBe(false);
      }
    }
    const futuras = semilla(AHORA).reservas.filter((r) => momento(r.huecoId) > AHORA.getTime()).map((r) => r.huecoId);
    const ocupados = [...futuras.slice(0, 2), "2026-11-09T10:00"];
    const conOcupados = crearSemilla(o.negocio, AHORA, { ...o, ocupados });
    expect(conOcupados.reservas.some((r) => ocupados.includes(r.huecoId))).toBe(false);
    expect(conOcupados.reservas).toHaveLength(semilla(AHORA).reservas.length);
  });

  it("el historial usa los formatos que escribe el producto", () => {
    const hueco = String.raw`(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} [a-z]{3} a las \d{2}:\d{2}`;
    const formatos = [
      /^Estado: (En conversación|Visita reservada)$/,
      new RegExp(`^Visita reservada: ${hueco}$`),
      /^Pasado a persona: .+$/,
      /^Marcado como spam: .+$/,
      /^Nota interna: .{1,60}$/u,
      /^Tarea añadida: .+$/,
      /^Tarea hecha$/,
      /^Ficha editada: (presupuesto|etiquetas)(, (presupuesto|etiquetas))*$/,
      /^Ha pedido que no le escribamos$/,
      /^Ha pedido que le escribamos por WhatsApp desde tu web$/,
      /^Lo añadiste tú$/,
      /^Ha dicho que sí · \d{1,3}(\.\d{3})*\s€$/,
      new RegExp(`^No sigue · (${MOTIVOS_NO_SIGUE.join("|")})$`),
    ];
    for (const l of leads()) {
      for (const a of l.actividad ?? []) expect(formatos.some((f) => f.test(a.texto)), a.texto).toBe(true);
      expect(volvioYCerrado(l)).toBe(false);
    }
  });

  if (sector.base === "inmobiliaria") {
    it("las visitas futuras son a P-101 o P-102, nunca al reservado", () => {
      const futuras = leads().filter((l) => l.estado === "visita");
      expect(futuras.every((l) => /^P-10[12] · /.test(l.datos.piso ?? "")), JSON.stringify(futuras.map((l) => l.datos.piso))).toBe(true);
      for (const l of futuras) expect(l.mensajes.at(-1)?.texto).toContain(l.datos.piso.includes("P-101") ? "Calle Mallorca (Eixample)" : "Carrer de Verdi (Gràcia)");
      const si = leads().filter((l) => l.cierre === "si").map((l) => l.datos.piso).sort();
      expect(si).toEqual(["P-097 · Carrer del Parlament (Sant Antoni)", "P-103 · Carrer de Sants (Sants)"]);
      const negocia = leads().find((l) => l.motivoPersona === "Quiere negociar el precio");
      expect(negocia?.mensajes.some((m) => m.de === "cliente" && m.texto.includes("¿Aceptaríais 440.000?"))).toBe(true);
      expect(libres(negocia as Lead).at(-1)?.texto).toMatch(/te escribe en cuanto pueda\.$/);
    });
  }

  if (sector.base === "clinica") {
    it("sin síntomas fuera del único mensaje de la urgencia (RGPD)", () => {
      const urgencias = leads().filter((l) => l.motivoPersona === "Posible urgencia");
      expect(urgencias).toHaveLength(1);
      const [u] = urgencias;
      const conSintomas = u.mensajes.filter((m) => SINTOMAS.test(m.texto));
      expect(conSintomas).toHaveLength(1);
      expect(conSintomas[0].de).toBe("cliente");
      const k = u.mensajes.indexOf(conSintomas[0]);
      expect(u.mensajes[k + 1]).toMatchObject({ de: "agente", texto: PRESETS.clinica.agente.pasarSiempre[0].respuesta });
      expect(u.mensajes.find((m) => m.manual)?.texto).toBe("Hola, soy de recepción. Te llamo ahora para verlo.");
      for (const l of leads()) {
        const textos = [...(l.notas ?? []).map((n) => n.texto), ...(l.etiquetas ?? []), ...Object.values(l.datos), ...(l.tareas ?? []).map((t) => t.texto)];
        for (const t of textos) expect(SINTOMAS.test(t), `${l.nombre}: ${t}`).toBe(false);
        if (l === u) continue;
        for (const m of l.mensajes) expect(SINTOMAS.test(m.texto), `${l.nombre}: ${m.texto}`).toBe(false);
      }
    });

    it("sin importe en limpiezas ni revisiones", () => {
      for (const l of leads().filter((x) => x.datos.tratamiento === "Limpieza" || x.datos.tratamiento === "Revisión")) expect(l.presupuesto, l.nombre).toBeUndefined();
    });
  }

  if (sector.base === "generico") {
    it("con servicios propios, los clientes piden esos servicios", () => {
      const s = crearSemilla("Peluquería Ana", AHORA, { ...o, servicios: ["Corte", "Color"] });
      const necesidades = new Set(Object.values(s.leads).map((l) => l.datos.necesidad).filter(Boolean));
      expect([...necesidades].sort()).toEqual(["Color", "Corte"]);
      const sin = new Set(leads().map((l) => l.datos.necesidad).filter(Boolean));
      expect([...sin].sort()).toEqual(["Presupuesto", "Primera consulta", "Seguimiento"]);
    });
  }
});

/** Ninguno de estos ejemplos ha vuelto a escribir después de cerrarse. */
function volvioYCerrado(l: Lead): boolean {
  return !!l.cierre && l.mensajes.some((m) => m.de === "cliente" && m.ts > (l.cierreEn as number));
}

describe("negocio de ejemplo", () => {
  const negocio = JSON.parse(leer("negocios/ejemplo-peluqueria.json")) as NegocioExportado;

  it("tiene la forma de un negocio exportado", () => {
    expect(negocio.formato).toBe("crm-whatsapp/negocio@1");
    expect(negocio.nombre).toBe("Peluquería Ana");
    expect(negocio.base).toBe("generico");
    expect(negocio.configuracion.negocio).toBeDefined();
    expect(negocio.configuracion.negocio).not.toHaveProperty("nombre");
    expect(negocio.configuracion.negocio).not.toHaveProperty("logoVersion");
    expect(Object.keys(negocio.configuracion)).not.toContain("sector");
    expect(Object.keys(negocio.configuracion)).not.toContain("base");
    expect(leer("negocios/ejemplo-peluqueria.json")).toBe(`${JSON.stringify(negocio, null, 2)}\n`);
  });

  it("pasa la misma comprobación que «Comprobar» sin un solo aviso", () => {
    const base = PRESETS.generico;
    const r = revisarCambios(negocio.configuracion, { ahora: AHORA, vocabulario: base.vocabulario, calendario: base.calendario, regional: base.regional });
    expect("error" in r ? r : "ok").toBe("ok");
    const perfilId = leerTitulo(negocio.instrucciones).id;
    expect(perfilId).toBe("peluqueria-ana");
    const vocabulario = { ...base.vocabulario, ...negocio.configuracion.vocabulario } as Vocabulario;
    const agente: ReglasAgente = { ...base.agente, frases: { ...base.agente.frases, ...negocio.configuracion.agente?.frases } } as ReglasAgente;
    const plantilla = negocio.configuracion.plantilla as Plantilla;
    expect(revisarPlantilla(plantilla)).toEqual({ plantilla });
    const revision = revisarInstrucciones(negocio.instrucciones, { perfilId, vocabulario, agente, moneda: base.regional.moneda, negocio: negocio.nombre, plantilla });
    expect(revision.error).toBeUndefined();
    expect(revision.avisos).toEqual([]);
    const reglas = revisarReglas({ ...base.calendario, ...negocio.configuracion.calendario }, base.calendario);
    expect("error" in reglas ? reglas : "ok").toBe("ok");
    for (const prohibido of ["hoy mismo", "día antes", "robot"]) expect(negocio.instrucciones.toLowerCase()).not.toContain(prohibido);
  });
});
