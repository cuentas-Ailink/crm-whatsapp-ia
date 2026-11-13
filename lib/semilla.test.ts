import { describe, expect, it } from "vitest";
import { REGLAS_POR_DEFECTO, sumarDias, textoHueco } from "./agenda";
import { CUERPO_GENERAL, CUERPO_POR_DEFECTO, CUERPOS_CONOCIDOS, FRASES_POR_DEFECTO } from "./configuracion";
import { controles, pideBaja } from "./guion";
import { asistenteCallado, visitaSinCerrar, volvioAEscribir } from "./hilo";
import { recortar } from "./log";
import { esEjemplo } from "./negocio";
import { formatoImporte, MONEDAS } from "./regional";
import { crearSemilla, generador, generarSector, huecosProtegidos, momentoEn, OPCIONES_POR_DEFECTO } from "./semilla";
import { generadorDe } from "./semillas/index";
import { DATOS_REFORMAS, generarReformas } from "./semillas/reformas";
import type { ConversacionSemilla, DatosSemilla, SemillaGenerada } from "./semillas/tipos";
import { MOTIVOS_NO_SIGUE, type Lead } from "./tipos";

// Miércoles 11 nov 2026, 10:00 en Madrid (la referencia), el mismo día a las 07:30 y a las 22:00, y el
// lunes 9 y el viernes 13 a las 10:00 para lo que tiene que valer cualquier día.
const AHORA = new Date("2026-11-11T09:00:00Z");
const TEMPRANO = new Date("2026-11-11T06:30:00Z");
const NOCHE = new Date("2026-11-11T21:00:00Z");
const LUNES = new Date("2026-11-09T09:00:00Z");
const VIERNES = new Date("2026-11-13T09:00:00Z");
const MISMO_DIA = [AHORA, TEMPRANO, NOCHE];
const TODOS = [AHORA, TEMPRANO, NOCHE, LUNES, VIERNES];
const ZONA = "Europe/Madrid";
const NEGOCIO = "Estudio de reformas";

const cache = new Map<number, SemillaGenerada>();
function semilla(ahora: Date): SemillaGenerada {
  let s = cache.get(ahora.getTime());
  if (!s) {
    s = crearSemilla(NEGOCIO, ahora);
    cache.set(ahora.getTime(), s);
  }
  return s;
}
const leadsDe = (ahora: Date) => Object.values(semilla(ahora).leads);
const porNombre = (ahora: Date, nombre: string) => leadsDe(ahora).find((l) => l.nombre === nombre) as Lead;

function madrid(ts: number): { fecha: string; hora: string; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const fecha = `${v("year")}-${v("month")}-${v("day")}`;
  return { fecha, hora: `${v("hour")}:${v("minute")}`, dia: new Date(`${fecha}T00:00:00Z`).getUTCDay() };
}
const laborable = (fecha: string) => {
  const d = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
};
/** Días abiertos (lunes a viernes) entre una fecha pasada y hoy: 1 = el último día abierto antes de hoy. */
function diasAbiertosHasta(fecha: string, hoy: string): number {
  let n = 0;
  for (let f = fecha; f < hoy; f = sumarDias(f, 1)) if (laborable(f)) n++;
  return n;
}
const enOficina = (ts: number) => {
  const { hora, dia } = madrid(ts);
  return dia >= 1 && dia <= 5 && ((hora >= "09:00" && hora < "14:00") || (hora >= "15:30" && hora <= "19:30"));
};
const momentoHueco = (id: string) => momentoEn(id.slice(0, 10), id.slice(11), ZONA);

/** La aproximación de las filas de «Te toca» de W11 (una por lead). */
function filasTeToca(s: SemillaGenerada, ahora: Date): string[] {
  const ms = ahora.getTime();
  return Object.values(s.leads)
    .filter((l) => (!l.cierre && l.estado === "persona") || visitaSinCerrar(l, ms, ZONA) || volvioAEscribir(l) || asistenteCallado(l, ms, false, null) !== null)
    .map((l) => l.id);
}

/** Los tramos en los que lleva el lead una persona: de cada «Pasado a persona» al siguiente «Devuelto a tu asistente». */
function tramosPersona(l: Lead): [number, number][] {
  const tramos: [number, number][] = [];
  let desde: number | null = null;
  for (const a of l.actividad ?? []) {
    if (a.texto.startsWith("Pasado a persona: ") && desde === null) desde = a.ts;
    if (a.texto === "Devuelto a tu asistente" && desde !== null) {
      tramos.push([desde, a.ts]);
      desde = null;
    }
  }
  if (desde !== null) tramos.push([desde, Number.POSITIVE_INFINITY]);
  return tramos;
}
const conPersona = (l: Lead, ts: number) => tramosPersona(l).some(([a, b]) => ts > a && ts < b);

// Los textos de los huecos de la rejilla, para leer los que salen en los mensajes.
const HUECO = /(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) a las \d{2}:\d{2}/g;
const DE_TEXTO = new Map<string, string>();
for (let f = "2026-08-01"; f <= "2027-03-31"; f = sumarDias(f, 1)) {
  for (const h of REGLAS_POR_DEFECTO.horas) DE_TEXTO.set(textoHueco(`${f}T${h}`), `${f}T${h}`);
}
const huecosDe = (texto: string) => [...texto.matchAll(HUECO)].map((m) => DE_TEXTO.get(m[0]) ?? `?${m[0]}`);

describe("crearSemilla (reformas)", () => {
  it("son todos de ejemplo, con canal de verdad y un mes de historia", () => {
    const lista = leadsDe(AHORA);
    expect(lista).toHaveLength(44);
    expect(lista.every((l) => esEjemplo(l) && l.ejemplo === true)).toBe(true);
    expect(new Set(lista.map((l) => l.origen))).toEqual(new Set(["formulario", "whatsapp", "manual"]));
    const masViejo = Math.min(...lista.map((l) => l.creadoEn));
    expect(AHORA.getTime() - masViejo).toBeGreaterThanOrEqual(25 * 86_400_000);
  });

  it("nada pasa después de ahora: leads, mensajes, notas, tareas, historial, cierres", () => {
    for (const ahora of TODOS) {
      const t = ahora.getTime();
      for (const l of leadsDe(ahora)) {
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

  it("el mismo día a otra hora deja los mismos ids, etapas, cierres, importes, visitas y cifras", () => {
    const resumen = (s: SemillaGenerada) => ({
      leads: Object.values(s.leads)
        .map((l) => [l.id, l.estado, l.cierre ?? "", l.motivoCierre ?? "", l.presupuesto ?? "", l.cobrado ?? "", l.visita?.id ?? "", l.mensajes.map((m) => m.id).join(","), (l.notas ?? []).length, (l.tareas ?? []).length].join("|"))
        .sort(),
      reservas: s.reservas.map((r) => `${r.huecoId}|${r.leadId}`).sort(),
    });
    const referencia = resumen(semilla(AHORA));
    for (const ahora of [TEMPRANO, NOCHE, new Date(AHORA.getTime() + 60_000)]) expect(resumen(crearSemilla(NEGOCIO, ahora))).toEqual(referencia);
  });

  it("las cuotas por etapa de la regla 8, cualquier día", () => {
    for (const ahora of TODOS) {
      const lista = leadsDe(ahora);
      const cuenta = (e: Lead["estado"]) => lista.filter((l) => l.estado === e).length;
      expect([cuenta("nuevo"), cuenta("conversacion"), cuenta("visita"), cuenta("persona"), cuenta("spam")], ahora.toISOString()).toEqual([6, 17, 7, 11, 3]);
      const persona = lista.filter((l) => l.estado === "persona");
      expect(persona.filter((l) => l.visita).length).toBe(8);
      const nuevos = lista.filter((l) => l.estado === "nuevo");
      expect(nuevos.filter((l) => l.origen === "manual")).toHaveLength(1);
      expect(nuevos.filter((l) => l.origen === "formulario")).toHaveLength(5);
    }
  });

  it("la serie diaria: hoy como mucho 3, ningún día más de 4, como mucho 3 días vacíos y nunca dos seguidos", () => {
    for (const ahora of MISMO_DIA) {
      const hoy = madrid(ahora.getTime()).fecha;
      const porDia = new Map<string, number>();
      for (const l of leadsDe(ahora)) {
        const f = madrid(l.creadoEn).fecha;
        porDia.set(f, (porDia.get(f) ?? 0) + 1);
      }
      expect(porDia.get(hoy) ?? 0).toBeLessThanOrEqual(3);
      const serie = Array.from({ length: 30 }, (_, k) => porDia.get(sumarDias(hoy, k - 29)) ?? 0);
      expect(serie.reduce((a, b) => a + b, 0)).toBe(44);
      expect(Math.max(...serie)).toBeLessThanOrEqual(4);
      expect(serie.filter((n) => n === 0).length).toBeLessThanOrEqual(3);
      expect(serie.some((n, k) => n === 0 && serie[k + 1] === 0)).toBe(false);
    }
    // A la hora de la referencia, la serie es la de la auditoría.
    const hoy = madrid(AHORA.getTime()).fecha;
    const porDia = (d: number) => leadsDe(AHORA).filter((l) => madrid(l.creadoEn).fecha === sumarDias(hoy, d)).length;
    expect(Array.from({ length: 30 }, (_, k) => porDia(k - 29))).toEqual([2, 1, 2, 1, 0, 1, 2, 2, 1, 1, 2, 1, 1, 2, 2, 1, 2, 1, 0, 1, 3, 2, 1, 2, 1, 1, 2, 2, 3, 1]);
  });

  it("visitas: las futuras en «Visita reservada», un 30-40 % de los activos, y las pasadas cerradas o de hace 1-3 días abiertos", () => {
    for (const ahora of TODOS) {
      const t = ahora.getTime();
      const hoy = madrid(t).fecha;
      const lista = leadsDe(ahora);
      const conVisita = lista.filter((l) => l.visita);
      for (const l of lista.filter((x) => x.estado === "visita")) expect(momentoHueco(l.visita?.id ?? "")).toBeGreaterThan(t);
      const activos = lista.filter((l) => l.estado !== "spam").length;
      expect(conVisita.length / activos).toBeGreaterThanOrEqual(0.3);
      expect(conVisita.length / activos).toBeLessThanOrEqual(0.4);
      for (const l of conVisita.filter((x) => momentoHueco(x.visita?.id ?? "") < t)) {
        if (l.cierre) continue;
        const dias = diasAbiertosHasta((l.visita?.id ?? "").slice(0, 10), hoy);
        expect(dias, `${l.nombre} ${ahora.toISOString()}`).toBeGreaterThanOrEqual(1);
        expect(dias).toBeLessThanOrEqual(3);
      }
    }
    const reservas = semilla(AHORA).reservas;
    expect(reservas.filter((r) => momentoHueco(r.huecoId) > AHORA.getTime())).toHaveLength(7);
    expect(reservas.filter((r) => momentoHueco(r.huecoId) < AHORA.getTime())).toHaveLength(8);
  });

  it("cierres: tres «Ha dicho que sí» con su señal, dos o tres «No sigue», del dueño y con su línea", () => {
    for (const ahora of TODOS) {
      const t = ahora.getTime();
      const lista = leadsDe(ahora);
      const si = lista.filter((l) => l.cierre === "si").sort((a, b) => a.nombre.localeCompare(b.nombre));
      expect(si.map((l) => [l.nombre, l.presupuesto, l.cobrado]), ahora.toISOString()).toEqual([
        ["Carmen Ortiz", 11_800, 8_260],
        ["Cristina Navarro", 18_640, 5_592],
        ["David Ribas", 10_460, 3_138],
      ]);
      const no = lista.filter((l) => l.cierre === "no");
      expect(no.length).toBeGreaterThanOrEqual(2);
      expect(no.length).toBeLessThanOrEqual(3);
      expect(no.map((l) => l.motivoCierre)).toEqual(expect.arrayContaining(["Precio", "Ha elegido a otro"]));
      for (const l of lista) {
        if (l.cierre !== "no") expect(l.motivoCierre).toBeUndefined();
        else expect(MOTIVOS_NO_SIGUE).toContain(l.motivoCierre);
        if (l.cierre !== "si") expect(l.cobrado).toBeUndefined();
        if (!l.cierre) continue;
        const cierreEn = l.cierreEn as number;
        expect(t - cierreEn).toBeLessThanOrEqual(30 * 86_400_000);
        expect(madrid(cierreEn).fecha < madrid(t).fecha).toBe(true);
        expect(enOficina(cierreEn), `${l.nombre} cierra en horario de oficina`).toBe(true);
        if (l.visita) expect(momentoHueco(l.visita.id)).toBeLessThan(cierreEn);
        const texto = l.cierre === "si" ? `Ha dicho que sí · ${formatoImporte(l.presupuesto as number, "EUR")}` : `No sigue · ${l.motivoCierre}`;
        expect(l.actividad).toContainEqual({ id: `cierre-${l.id}-${cierreEn}`, texto, ts: cierreEn });
      }
      expect(lista.reduce((s, l) => s + (l.cobrado ?? 0), 0)).toBe(16_990);
    }
  });

  it("lo del dueño, solo en sus ratos de oficina y nunca hoy; cada visita, de 2 a 7 días abiertos después de llegar", () => {
    const delDueno = /^(Ficha editada|Nota interna|Tarea añadida|Tarea hecha|Ha dicho que sí|No sigue|Devuelto a tu asistente|Pasado a persona: Lo llevas tú desde el panel|Lo añadiste tú)/;
    for (const ahora of TODOS) {
      const hoy = madrid(ahora.getTime()).fecha;
      for (const l of leadsDe(ahora)) {
        for (const a of l.actividad ?? []) {
          if (!delDueno.test(a.texto)) continue;
          expect(enOficina(a.ts), `${l.nombre}: «${a.texto}» a las ${madrid(a.ts).hora}`).toBe(true);
          expect(madrid(a.ts).fecha < hoy, `${l.nombre}: «${a.texto}» es de hoy`).toBe(true);
        }
        if (l.vueltaVistaEn !== undefined) expect(enOficina(l.vueltaVistaEn)).toBe(true);
      }
    }
    for (const l of leadsDe(AHORA).filter((x) => x.visita)) {
      const dias = diasAbiertosHasta(madrid(l.creadoEn).fecha, (l.visita?.id ?? "").slice(0, 10)) - (laborable(madrid(l.creadoEn).fecha) ? 1 : 0) + 1;
      expect(dias, l.nombre).toBeGreaterThanOrEqual(2);
      expect(dias, l.nombre).toBeLessThanOrEqual(7);
    }
  });

  it("«Te toca»: entre 4 y 7 filas a cualquier hora y cualquier día; 6 en la referencia", () => {
    for (const ahora of TODOS) {
      const filas = filasTeToca(semilla(ahora), ahora);
      expect(filas.length, ahora.toISOString()).toBeGreaterThanOrEqual(4);
      expect(filas.length).toBeLessThanOrEqual(7);
    }
    const nombres = filasTeToca(semilla(AHORA), AHORA).map((id) => semilla(AHORA).leads[id].nombre).sort();
    expect(nombres).toEqual(["Marc Roca", "Miquel Bosch", "Montse Ferrer Puig", "Teresa Molina", "Thomas Weber", "Xavier Gil"]);
  });

  it("un «No sigue» que ha vuelto a escribir", () => {
    for (const ahora of TODOS) {
      const vuelven = leadsDe(ahora).filter((l) => volvioAEscribir(l));
      expect(vuelven).toHaveLength(1);
      const [l] = vuelven;
      expect(l.cierre).toBe("no");
      const tras = l.mensajes.filter((m) => m.de === "cliente" && m.ts > (l.cierreEn as number));
      expect(l.actividad).toContainEqual({ id: `volvio-${l.id}-${l.cierreEn}`, texto: "Ha vuelto a escribir", ts: tras[0].ts });
      expect(l.vueltaVistaEn).toBeDefined();
      expect(l.vueltaVistaEn as number).toBeLessThan(tras[tras.length - 1].ts);
      const respuesta = l.mensajes.find((m) => m.manual && m.ts > (l.vueltaVistaEn as number));
      expect(respuesta).toBeDefined();
    }
  });

  it("uno añadido a mano y tres devueltos al asistente tras pasar a una persona", () => {
    const lista = leadsDe(AHORA);
    const manuales = lista.filter((l) => l.origen === "manual");
    expect(manuales).toHaveLength(1);
    const [m] = manuales;
    expect(m).toMatchObject({ estado: "nuevo", mensajes: [] });
    expect(m.zona ?? m.fuente ?? m.msPrimerWhatsApp).toBeUndefined();
    expect(m.actividad?.[0]).toMatchObject({ texto: "Lo añadiste tú", ts: m.creadoEn });
    expect(enOficina(m.creadoEn)).toBe(true);
    expect(Object.keys(m.datos)).toEqual(["tipo"]);
    expect(m.actividad?.some((a) => a.texto.startsWith("Te ha dado permiso"))).toBe(false);

    const devueltos = lista.filter((l) => l.actividad?.some((a) => a.texto === "Devuelto a tu asistente"));
    expect(devueltos.map((l) => l.nombre).sort()).toEqual(["Andrés Gómez", "Bea", "Rosa Camps"]);
    for (const l of devueltos) {
      const textos = (l.actividad ?? []).map((a) => a.texto);
      expect(textos.findIndex((x) => x.startsWith("Pasado a persona: "))).toBeLessThan(textos.indexOf("Devuelto a tu asistente"));
      expect(l.estado).toBe("conversacion");
      expect(l.motivoPersona).toBeUndefined();
    }
  });

  it("el historial usa los formatos que escribe el producto, con ids únicos", () => {
    const hueco = String.raw`(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} [a-z]{3} a las \d{2}:\d{2}`;
    const formatos = [
      /^Estado: (Nuevo|En conversación|Visita reservada)$/,
      new RegExp(`^Visita reservada: ${hueco}$`),
      new RegExp(`^Visita cambiada: de ${hueco} a ${hueco}$`),
      new RegExp(`^Visita anulada: ${hueco}$`),
      /^Pasado a persona: .+$/,
      /^Marcado como spam: .+$/,
      /^Nota interna: .{1,60}$/u,
      /^Tarea añadida: .+$/,
      /^Tarea hecha$/,
      /^Ficha editada: (nombre|email|zona|presupuesto|cobrado|etiquetas|tipo|metros|plazo)(, (nombre|email|zona|presupuesto|cobrado|etiquetas|tipo|metros|plazo))*$/,
      /^Ha pedido que no le escribamos$/,
      /^Ha pedido que le escribamos por WhatsApp desde tu web$/,
      /^Lo añadiste tú$/,
      /^Ha dicho que sí · \d{1,3}(\.\d{3})*\s€$/,
      new RegExp(`^No sigue · (${MOTIVOS_NO_SIGUE.join("|")})$`),
      /^Ha vuelto a escribir$/,
      /^Devuelto a tu asistente$/,
    ];
    const notas = new Set<string>();
    const tareas = new Set<string>();
    const lineas = new Set<string>();
    for (const ahora of TODOS) {
      for (const l of leadsDe(ahora)) {
        for (const a of l.actividad ?? []) expect(formatos.some((f) => f.test(a.texto)), a.texto).toBe(true);
        const ids = (l.actividad ?? []).map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (let k = 1; k < (l.actividad ?? []).length; k++) expect((l.actividad ?? [])[k].ts).toBeGreaterThanOrEqual((l.actividad ?? [])[k - 1].ts);
        if (ahora !== AHORA) continue;
        for (const id of ids) {
          expect(lineas.has(id)).toBe(false);
          lineas.add(id);
        }
        for (const n of l.notas ?? []) {
          expect(notas.has(n.id)).toBe(false);
          notas.add(n.id);
          expect(l.actividad).toContainEqual({ id: `nota-${n.id}`, texto: `Nota interna: ${recortar(n.texto, 60)}`, ts: n.ts });
        }
        for (const x of l.tareas ?? []) {
          expect(tareas.has(x.id)).toBe(false);
          tareas.add(x.id);
          expect(l.actividad).toContainEqual({ id: `tarea-${x.id}`, texto: `Tarea añadida: ${x.texto}`, ts: x.ts });
          if (x.hecha) expect(l.actividad?.some((a) => a.id === `hecha-${x.id}` && a.texto === "Tarea hecha")).toBe(true);
        }
      }
    }
  });

  it("ninguna promesa que el código no cumple, y el asistente dice que es un asistente virtual", () => {
    const literal = /d[ií]a antes|v[ií]spera|recordatorio|record[áa]rtelo|\d+\s*h(oras)? antes|antes de (la|tu) (visita|cita)|hoy mismo/i;
    const primeraPersona = /(?<!\bno\s)\b(te|le|os)\s+(llam(o|amos|ar[eé]|aremos)|escrib(imos|ir[eé]|iremos))(?![a-záéíóúüñ])|te digo algo|nos pondremos en contacto/i;
    const { PROMETE_RECORDATORIO } = controles();
    for (const [plantilla, laDice] of [
      [CUERPO_GENERAL, true],
      [CUERPO_POR_DEFECTO, false],
    ] as const) {
      const s = crearSemilla(NEGOCIO, AHORA, { plantilla });
      for (const l of Object.values(s.leads)) {
        for (const m of l.mensajes) {
          expect(PROMETE_RECORDATORIO.test(m.texto), m.texto).toBe(false);
          expect(literal.test(m.texto), m.texto).toBe(false);
          if (m.de === "agente" && !m.manual && !m.plantilla) expect(primeraPersona.test(m.texto), m.texto).toBe(false);
        }
        const libres = l.mensajes.filter((m) => m.de === "agente" && !m.manual && !m.plantilla);
        if (!libres.length) continue;
        expect(l.mensajes.some((m) => m.de === "agente" && m.texto.includes("asistente virtual")), l.nombre).toBe(true);
        const primero = libres[0].texto.includes("asistente virtual");
        if (l.origen === "formulario") expect(primero, `${l.nombre} con ${laDice ? "solicitud_general" : "solicitud_recibida"}`).toBe(!laDice);
        else expect(primero).toBe(true);
      }
    }
  });

  it("formularios con la plantilla y su permiso; WhatsApp empieza el cliente; tiempos del asistente y del dueño", () => {
    for (const ahora of MISMO_DIA) {
      for (const l of leadsDe(ahora)) {
        if (l.origen === "formulario") {
          expect(l.mensajes[0]).toMatchObject({ de: "agente", plantilla: true, nombrePlantilla: "solicitud_general", ts: l.creadoEn });
          expect(CUERPOS_CONOCIDOS[l.mensajes[0].nombrePlantilla as string]).toBe(CUERPO_GENERAL);
          expect(l.actividad).toContainEqual(expect.objectContaining({ texto: "Ha pedido que le escribamos por WhatsApp desde tu web", ts: l.creadoEn }));
        }
        if (l.origen === "whatsapp") expect(l.mensajes[0].de).toBe("cliente");
        for (const [k, m] of l.mensajes.entries()) {
          if (k > 0 && m.plantilla) throw new Error(`${l.nombre}: plantilla a mitad de conversación`);
          if (m.manual) {
            const cliente = l.mensajes.slice(0, k).filter((x) => x.de === "cliente").at(-1);
            expect(cliente, `${l.nombre}: mensaje a mano sin cliente antes`).toBeDefined();
            expect(m.ts - (cliente?.ts ?? 0)).toBeLessThanOrEqual(86_400_000);
            expect(enOficina(m.ts), `${l.nombre}: a mano fuera de horario`).toBe(true);
          }
          const previo = l.mensajes[k - 1];
          if (m.de === "agente" && !m.manual && !m.plantilla && previo?.de === "cliente") {
            expect(m.ts - previo.ts, `${l.nombre}: respuesta del asistente`).toBeGreaterThanOrEqual(5_000);
            expect(m.ts - previo.ts).toBeLessThanOrEqual(12_000);
          }
          if (m.de === "cliente" && !conPersona(l, m.ts) && !(l.estado === "spam" && !l.mensajes.some((x) => x.de === "agente"))) {
            const siguiente = l.mensajes[k + 1];
            expect(siguiente?.de === "agente" && !siguiente.manual, `${l.nombre}: «${m.texto}» sin respuesta del asistente`).toBe(true);
          }
          if (m.de === "agente" && !m.manual && !m.plantilla) expect(conPersona(l, m.ts - 1), `${l.nombre}: el asistente habla con una persona`).toBe(false);
        }
      }
    }
  });

  it("cada reserva sigue el patrón: dos huecos de la rejilla, el cliente elige y el asistente confirma ese", () => {
    for (const ahora of MISMO_DIA) {
      for (const l of leadsDe(ahora)) {
        const agente = l.mensajes.map((m, k) => ({ m, k })).filter(({ m }) => m.de === "agente" && !m.manual);
        for (const { m, k } of agente) {
          for (const id of huecosDe(m.texto)) {
            expect(id.startsWith("?"), `${l.nombre}: hueco fuera de la rejilla en «${m.texto}»`).toBe(false);
            expect(laborable(id.slice(0, 10))).toBe(true);
          }
          if (!/visita reservada/i.test(m.texto)) continue;
          const confirmados = huecosDe(m.texto);
          expect(confirmados).toHaveLength(1);
          const oferta = agente.filter((x) => x.k < k && huecosDe(x.m.texto).length === 2).at(-1);
          expect(oferta, `${l.nombre}: confirma sin haber ofrecido`).toBeDefined();
          const ofrecidos = huecosDe(oferta?.m.texto ?? "");
          expect(new Set(ofrecidos).size).toBe(2);
          expect(ofrecidos).toContain(confirmados[0]);
          expect(l.mensajes.slice((oferta?.k ?? 0) + 1, k).some((x) => x.de === "cliente")).toBe(true);
          expect(confirmados[0]).toBe(l.visita?.id);
        }
        if (l.visita) expect(agente.some(({ m }) => /visita reservada/i.test(m.texto) && m.texto.includes(textoHueco(l.visita?.id ?? ""))), l.nombre).toBe(true);
      }
    }
  });

  it("largo de las conversaciones según el tipo de lead", () => {
    const tipo = (l: Lead): [string, number, number] => {
      const textos = (l.actividad ?? []).map((a) => a.texto);
      if (l.origen === "manual") return ["a mano", 0, 0];
      if (l.estado === "spam") return ["publicidad", 1, 2];
      if (l.estado === "nuevo") return ["nuevo sin respuesta", 1, 1];
      if (textos.includes("Devuelto a tu asistente")) return ["devuelto", 6, 12];
      if (l.estado === "conversacion") return ["parado", 3, ["Laura Martínez", "Jordi Puig"].includes(l.nombre) ? 9 : 6];
      if (l.estado === "visita") return ["visita", 8, 11];
      if (l.visita) return volvioAEscribir(l) ? ["ha vuelto", 13, 19] : ["tras la visita", 11, 16];
      return ["pasado por el asistente", 5, 11];
    };
    for (const ahora of MISMO_DIA) {
      for (const l of leadsDe(ahora)) {
        const [nombre, min, max] = tipo(l);
        expect(l.mensajes.length, `${l.nombre} (${nombre})`).toBeGreaterThanOrEqual(min);
        expect(l.mensajes.length, `${l.nombre} (${nombre})`).toBeLessThanOrEqual(max);
      }
    }
  });

  it("el tiempo hasta el primer WhatsApp y la primera respuesta", () => {
    const lista = leadsDe(AHORA);
    const formularios = lista.filter((l) => l.origen === "formulario");
    const ms = formularios.map((l) => l.msPrimerWhatsApp as number).sort((a, b) => a - b);
    expect(ms.every((x) => x >= 1_100 && x <= 5_000)).toBe(true);
    expect(ms.filter((x) => x <= 2_800).length / ms.length).toBeGreaterThanOrEqual(0.9);
    const mediana = ms.length % 2 ? ms[(ms.length - 1) / 2] : (ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2;
    expect(mediana).toBeGreaterThanOrEqual(1_800);
    expect(mediana).toBeLessThanOrEqual(2_400);
    for (const l of lista.filter((x) => x.origen !== "formulario")) expect(l.msPrimerWhatsApp).toBeUndefined();

    for (const l of lista) {
      const agente = l.mensajes.find((m) => m.de === "agente" && !m.manual);
      if (l.origen !== "whatsapp" || !agente) {
        expect(l.msPrimeraRespuesta, l.nombre).toBeUndefined();
        continue;
      }
      const cliente = l.mensajes.find((m) => m.de === "cliente") as Lead["mensajes"][number];
      expect(l.msPrimeraRespuesta).toBe(agente.ts - cliente.ts);
      expect(l.msPrimeraRespuesta).toBeGreaterThanOrEqual(5_000);
      expect(l.msPrimeraRespuesta).toBeLessThanOrEqual(12_000);
    }
  });

  it("las visitas futuras dejan libres los primeros huecos, no se pisan y cuadran con los leads", () => {
    for (const ahora of TODOS) {
      const { leads, reservas } = semilla(ahora);
      const ids = reservas.map((r) => r.huecoId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(reservas.every((r) => r.prueba === true && r.perfilNombre === NEGOCIO)).toBe(true);
      expect(Object.values(leads).filter((l) => l.visita).map((l) => `${l.id}|${l.visita?.id}`).sort()).toEqual(reservas.map((r) => `${r.leadId}|${r.huecoId}`).sort());
      for (const r of reservas) {
        expect(REGLAS_POR_DEFECTO.horas).toContain(r.huecoId.slice(11));
        expect(laborable(r.huecoId.slice(0, 10))).toBe(true);
        expect(r.texto).toBe(textoHueco(r.huecoId));
        if (momentoHueco(r.huecoId) < ahora.getTime()) continue;
        const otras = reservas.filter((x) => x !== r);
        expect(huecosProtegidos(otras, ahora, REGLAS_POR_DEFECTO).has(r.huecoId), `${r.nombre} ocupa uno de los primeros huecos`).toBe(false);
      }
    }
    // Marta y Núria, en los días abiertos 1 y 2 a partir de mañana.
    expect(porNombre(AHORA, "Marta Soler").visita?.id).toBe("2026-11-13T12:30");
    expect(porNombre(AHORA, "Núria Vidal").visita?.id).toBe("2026-11-16T10:00");
    expect([...huecosProtegidos(semilla(AHORA).reservas, AHORA, REGLAS_POR_DEFECTO)].sort()).toEqual(["2026-11-12T10:00", "2026-11-12T12:30", "2026-11-13T17:00"]);

    const ocupados = ["2026-11-13T12:30", "2026-11-16T10:00", "2026-11-09T10:00", "2026-11-06T12:30"];
    const conOcupados = crearSemilla(NEGOCIO, AHORA, { ocupados });
    expect(conOcupados.reservas.some((r) => ocupados.includes(r.huecoId))).toBe(false);
    expect(conOcupados.reservas).toHaveLength(15);
  });

  it("datos, teléfonos y zonas como los guarda el producto", () => {
    const lista = leadsDe(AHORA);
    const claves = new Set(OPCIONES_POR_DEFECTO.campos.map((c) => c.clave));
    const telefonos = lista.map((l) => Number(l.telefono.slice(5)));
    expect(new Set(telefonos).size).toBe(lista.length);
    expect(telefonos.some((n) => telefonos.includes(n + 1))).toBe(false);
    for (const l of lista) {
      expect(l.telefono).toMatch(/^34600\d{6}$/);
      expect(Object.keys(l.datos).every((k) => claves.has(k)), JSON.stringify(l.datos)).toBe(true);
      if (l.datos.metros) {
        expect(l.datos.metros).toMatch(/^\d+ m²$/);
        const n = Number.parseInt(l.datos.metros, 10);
        if (n > 20) expect(n % 5).toBe(0);
      }
      if (l.origen !== "formulario") expect(l.zona).toBeUndefined();
      expect((l.etiquetas ?? []).every((e) => e === e.toLowerCase() && e.length <= 24)).toBe(true);
    }
    expect(JSON.stringify(semilla(AHORA))).not.toMatch(/"(asignado|autor|proyectos|equipo)":/);
    expect(lista.find((l) => l.nombre === "maria lopez")?.origen).toBe("formulario");
  });

  it("el origen: 60/25/15 en el formulario y 45 % de anuncios en WhatsApp", () => {
    const lista = leadsDe(AHORA).filter((l) => l.estado !== "spam");
    const formularios = lista.filter((l) => l.origen === "formulario");
    const meta = formularios.filter((l) => l.fuente?.tipo === "anuncio");
    expect(meta.length).toBe(Math.round(0.6 * formularios.length));
    expect(meta.every((l) => l.fuente?.plataforma === "Meta" && l.fuente.campana === "Reformas Barcelona")).toBe(true);
    expect(formularios.filter((l) => l.fuente?.tipo === "buscador" && l.fuente.plataforma === "Google").length).toBe(Math.round(0.25 * formularios.length));
    const whatsapp = lista.filter((l) => l.origen === "whatsapp");
    const anuncios = whatsapp.filter((l) => l.fuente);
    expect(anuncios.length).toBe(Math.round(0.45 * whatsapp.length));
    expect(anuncios.every((l) => l.fuente?.anuncio === "¿Reformas en casa? Pide tu visita sin compromiso")).toBe(true);
    expect(leadsDe(AHORA).filter((l) => l.origen === "manual" || l.estado === "spam").every((l) => !l.fuente)).toBe(true);
  });

  it("el dinero: sin importe antes de la visita, estimaciones redondas y la señal solo en los «sí»", () => {
    const lista = leadsDe(AHORA);
    for (const l of lista) {
      if (l.estado === "nuevo" || l.estado === "conversacion" || l.estado === "spam") expect(l.presupuesto, l.nombre).toBeUndefined();
      if (l.presupuesto === undefined) continue;
      const enviado = (l.etiquetas ?? []).some((e) => e.startsWith("presupuesto ")) || l.cierre === "si";
      if (enviado) expect(l.presupuesto % 10).toBe(0);
      else expect(l.presupuesto % (l.presupuesto < 20_000 ? 500 : 1_000), l.nombre).toBe(0);
    }
    const marta = porNombre(AHORA, "Marta Soler");
    expect(marta.cobrado).toBeUndefined();
    expect(marta.etiquetas).not.toContain("señal pagada");
    expect(marta.notas?.map((n) => n.texto)).toEqual(["Quiere mantener la distribución. Le gustaría tenerla antes de Navidad."]);
    const elena = porNombre(AHORA, "Elena Costa");
    expect(elena.notas?.map((n) => n.texto)).toContain("Presupuesto enviado el 2 nov");
    expect(porNombre(AHORA, "Paula Riera").notas?.map((n) => n.texto)).toContain(`Le pasamos ${formatoImporte(13_950)}: se le va de presupuesto.`);
  });

  it("tareas: 15 abiertas para los próximos días, 2 vencidas y las de más de 3 días, hechas", () => {
    for (const ahora of MISMO_DIA) {
      const hoy = madrid(ahora.getTime()).fecha;
      const tareas = leadsDe(ahora).flatMap((l) => (l.tareas ?? []).map((t) => ({ ...t, nombre: l.nombre })));
      const abiertas = tareas.filter((t) => !t.hecha);
      expect(abiertas.filter((t) => t.vence && t.vence >= hoy)).toHaveLength(15);
      const vencidas = abiertas.filter((t) => !t.vence || t.vence < hoy);
      expect(vencidas.map((t) => t.nombre).sort()).toEqual(["Montse Ferrer Puig", "Sergi Planas"]);
      for (const t of vencidas) {
        const dias = (Date.parse(hoy) - Date.parse(t.vence as string)) / 86_400_000;
        expect(dias).toBeGreaterThanOrEqual(1);
        expect(dias).toBeLessThanOrEqual(2);
      }
      for (const t of tareas) if (ahora.getTime() - t.ts > 3 * 86_400_000) expect(t.hecha, `${t.nombre}: ${t.texto}`).toBe(true);
      expect(tareas.every((t) => madrid(t.ts).fecha < hoy && enOficina(t.ts))).toBe(true);
    }
  });

  it("Óscar pidió que no le escribieran: silencio, la frase de baja y su línea", () => {
    const oscar = porNombre(AHORA, "Óscar");
    expect(oscar.estado).toBe("conversacion");
    const baja = oscar.mensajes.filter((m) => m.de === "cliente").at(-1);
    expect(pideBaja(baja?.texto ?? "")).toBe(true);
    expect(oscar.silenciadoEn).toBe(baja?.ts);
    expect(oscar.mensajes.at(-1)?.texto).toBe(FRASES_POR_DEFECTO.baja);
    expect(oscar.actividad).toContainEqual({ id: `silencio-${oscar.id}-${baja?.ts}`, texto: "Ha pedido que no le escribamos", ts: baja?.ts });
  });

  it("notas de voz: solo del cliente, y una de cada cinco de las de 12 palabras o más", () => {
    const mensajes = leadsDe(AHORA).flatMap((l) => l.mensajes);
    expect(mensajes.filter((m) => m.audio).every((m) => m.de === "cliente")).toBe(true);
    const largas = mensajes.filter((m) => m.de === "cliente" && m.texto.split(/\s+/).length >= 12);
    const parte = largas.filter((m) => m.audio).length / largas.length;
    expect(parte).toBeGreaterThanOrEqual(0.15);
    expect(parte).toBeLessThanOrEqual(0.25);
  });

  it("los vistos de lo que sale: leído si el cliente ha contestado", () => {
    for (const l of leadsDe(AHORA)) {
      for (const [k, m] of l.mensajes.entries()) {
        if (m.de !== "agente") {
          expect(m.entrega).toBeUndefined();
          continue;
        }
        if (l.mensajes.slice(k + 1).some((x) => x.de === "cliente")) expect(m.entrega).toBe("leido");
        else if (AHORA.getTime() - m.ts <= 30 * 60_000) expect(m.entrega).toBe("entregado");
        else expect(["leido", "entregado"]).toContain(m.entrega);
      }
    }
  });

  it("hoy, antes de las pruebas, solo ha llegado Pau Ferrer; a las 07:30 llega anoche a las 23:10", () => {
    const hoy = madrid(AHORA.getTime()).fecha;
    expect(leadsDe(AHORA).filter((l) => madrid(l.creadoEn).fecha === hoy).map((l) => l.nombre)).toEqual(["Pau Ferrer"]);
    expect(AHORA.getTime() - porNombre(AHORA, "Pau Ferrer").creadoEn).toBe(35 * 60_000);
    expect(madrid(porNombre(TEMPRANO, "Pau Ferrer").creadoEn)).toMatchObject({ fecha: sumarDias(hoy, -1), hora: "23:10" });
    // Lo de Laura y Núria de esta mañana pasa a anoche si aún no son las 08:13.
    const laura = porNombre(TEMPRANO, "Laura Martínez");
    expect(laura.mensajes).toHaveLength(7);
    expect(madrid(laura.mensajes[5].ts).fecha).toBe(sumarDias(hoy, -1));
  });
});

describe("motor genérico", () => {
  it("generadorDe da el de reformas y crearSemilla lo usa con las opciones por defecto", () => {
    // Los demás sectores tienen su propio generador desde W10 (lib/presets.test.ts).
    expect(generadorDe("reformas")).toBe(generarReformas);
    expect(OPCIONES_POR_DEFECTO).toMatchObject({ sector: "reformas", base: "reformas", negocio: NEGOCIO, plantilla: CUERPO_GENERAL, moneda: "EUR" });
    expect(OPCIONES_POR_DEFECTO.reglas).toEqual(REGLAS_POR_DEFECTO);
    expect(crearSemilla("Otro estudio", AHORA)).toEqual(generarReformas({ ...OPCIONES_POR_DEFECTO, negocio: "Otro estudio" }, AHORA));
    expect(crearSemilla(NEGOCIO, AHORA)).toEqual(generarSector(DATOS_REFORMAS, OPCIONES_POR_DEFECTO, AHORA));
  });

  it("generador y momentoEn", () => {
    const a = generador(7);
    const b = generador(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(momentoEn("2026-11-11", "10:00", ZONA)).toBe(AHORA.getTime());
    expect(momentoEn("2026-07-01", "10:00", ZONA)).toBe(Date.UTC(2026, 6, 1, 8));
    expect(momentoEn("2026-11-11", "10:00", "America/Mexico_City")).toBe(Date.UTC(2026, 10, 11, 16));
  });

  it("aguanta opciones extremas y escala los importes a la moneda", () => {
    const extremas = [
      { reglas: { ...REGLAS_POR_DEFECTO, horas: ["09:00"] } },
      { reglas: { ...REGLAS_POR_DEFECTO, diasAbiertos: [3] } },
      { reglas: { ...REGLAS_POR_DEFECTO, desdeDias: 0 } },
      { servicios: [] as string[] },
      { moneda: "MXN" as const },
      { reglas: { ...REGLAS_POR_DEFECTO, horas: ["09:00"], diasAbiertos: [3], desdeDias: 0, diasVista: 1 }, moneda: "MXN" as const, servicios: [] as string[] },
    ];
    for (const o of extremas) {
      for (const ahora of [AHORA, LUNES]) {
        const s = crearSemilla(NEGOCIO, ahora, o);
        expect(Object.keys(s.leads).length).toBeGreaterThan(0);
        const ids = s.reservas.map((r) => r.huecoId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
    expect(() => generarSector({ ...DATOS_REFORMAS, servicios: [] }, OPCIONES_POR_DEFECTO, AHORA)).not.toThrow();

    const mxn = crearSemilla(NEGOCIO, AHORA, { moneda: "MXN" });
    const { factorEjemplo, redondeo } = MONEDAS.MXN;
    const cristina = Object.values(mxn.leads).find((l) => l.nombre === "Cristina Navarro") as Lead;
    expect(cristina.presupuesto).toBe(Math.round((18_640 * factorEjemplo) / redondeo) * redondeo);
    expect(cristina.cobrado).toBe(Math.round((5_592 * factorEjemplo) / redondeo) * redondeo);
    expect(cristina.actividad?.some((a) => a.texto === `Ha dicho que sí · ${formatoImporte(cristina.presupuesto as number, "MXN")}`)).toBe(true);
    for (const l of Object.values(mxn.leads)) {
      if (l.presupuesto !== undefined) expect(l.presupuesto % redondeo).toBe(0);
      if (l.cobrado !== undefined) expect(l.cobrado % redondeo).toBe(0);
    }
  });

  it("con un DatosSemilla pequeño saca un «sí» con señal, un «no» y uno añadido a mano", () => {
    const plantilla = { de: "agente" as const, texto: "{plantilla}", plantilla: true };
    const reserva = (elige: 1 | 2, cierre: ConversacionSemilla["cierre"]): ConversacionSemilla => ({
      canal: "formulario",
      estado: "persona",
      tipo: "servicio",
      variante: elige,
      datos: { tipo: "Revisión" },
      etiquetas: ["servicio"],
      elige,
      cierre,
      mensajes: [
        plantilla,
        { de: "cliente", texto: "Hola, quería pedir cita" },
        { de: "agente", texto: "¡Hola! {presentacion}Te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?" },
        { de: "cliente", texto: elige === 1 ? "El primero" : "El segundo" },
        { de: "agente", texto: "Hecho, visita reservada para el {hueco}. Si prefieres hablar con una persona, dímelo por aquí." },
      ],
    });
    const datos: DatosSemilla = {
      semilla: 99,
      nombres: { formulario: ["Ana Prueba", "Luis Prueba", "Eva Prueba"], whatsapp: ["Toni"] },
      zonas: ["Centro"],
      servicios: [],
      conversaciones: [
        reserva(1, { accion: "si", importe: 3_000, cobrado: 900 }),
        reserva(2, { accion: "no", motivo: "Precio" }),
        { canal: "manual", estado: "nuevo", tipo: "servicio", variante: 1, datos: { tipo: "Revisión" }, mensajes: [] },
      ],
      cuotas: { nuevo: 1, conversacion: 0, visita: 0, persona: 2, spam: 0 },
      tareas: [{ texto: "Llamar para confirmar", dias: 1 }],
      notas: ["Prefiere por la tarde"],
    };
    for (const ahora of [AHORA, LUNES, VIERNES]) {
      const s = generarSector(datos, OPCIONES_POR_DEFECTO, ahora);
      const lista = Object.values(s.leads);
      expect(lista).toHaveLength(3);
      const si = lista.find((l) => l.cierre === "si");
      expect(si?.cobrado).toBe(900);
      expect(si?.presupuesto).toBe(3_000);
      expect(si?.actividad?.some((a) => a.texto === `Ha dicho que sí · ${formatoImporte(3_000)}`)).toBe(true);
      const no = lista.find((l) => l.cierre === "no");
      expect(no?.motivoCierre).toBe("Precio");
      expect(no?.cobrado).toBeUndefined();
      const manual = lista.find((l) => l.origen === "manual");
      expect(manual?.actividad?.map((a) => a.texto)).toContain("Lo añadiste tú");
      expect(manual?.mensajes).toEqual([]);
      for (const l of lista) {
        if (l.visita) expect(momentoHueco(l.visita.id)).toBeLessThan(l.cierreEn as number);
        for (const m of l.mensajes) expect(m.ts).toBeLessThanOrEqual(ahora.getTime());
      }
      expect(s.reservas).toHaveLength(2);
    }
  });
});
