import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// El único caso que no sale con datos reales mientras W0 ignora las reglas en verHuecos: sin huecos libres.
const estado = vi.hoisted(() => ({ sinHuecos: false }));
vi.mock("./agenda", async (importOriginal) => {
  const real = await importOriginal<typeof import("./agenda")>();
  return { ...real, verHuecos: (...a: Parameters<typeof real.verHuecos>) => (estado.sinHuecos ? [] : real.verHuecos(...a)) };
});

import {
  aplicarCambios,
  CUERPO_GENERAL,
  CUERPO_POR_DEFECTO,
  enlaceWhatsApp,
  firmaDePortada,
  FRASES_POR_DEFECTO,
  generarPistaDatos,
  GUARDADA_VACIA,
  LIMITES,
  mensajeWeb,
  MODELOS,
  NOMBRES_MODELO,
  normalizarGuardada,
  PISTA_DATOS_REFORMAS,
  PLANTILLA_GENERAL,
  revisarCambios,
  revisarInstrucciones,
  revisarPlantilla,
  revisarSistema,
  slugPerfil,
  textosDeEntrada,
  type ConfiguracionPerfil,
  type Plantilla,
  type ReglaPase,
  type ReglasAgente,
  type Web,
} from "./configuracion";
import { paseObligado } from "./guion";
import { leerTitulo } from "./negocio";
import { PERFILES_RESERVADOS, PRESETS } from "./presets";
import { normalizarTelefono, PAISES, type Moneda } from "./regional";
import { CAMPOS_REFORMAS, VOCABULARIO_REFORMAS, type Vocabulario } from "./vocabulario";

const AHORA = new Date("2026-11-12T10:00:00Z");
const revisar = (e: unknown) => revisarCambios(e, { ahora: AHORA });
const x = (n: number) => "x".repeat(n);

/** { a: { b: valor } } a partir de "a.b". */
function en(ruta: string, valor: unknown): Record<string, unknown> {
  return ruta
    .split(".")
    .reverse()
    .reduce<unknown>((acc, clave) => ({ [clave]: acc }), valor) as Record<string, unknown>;
}

function leer(objeto: unknown, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((acc, clave) => (acc as Record<string, unknown>)?.[clave], objeto);
}

const PASOS = [
  { titulo: "Envías la solicitud", detalle: "Con tu nombre basta." },
  { titulo: "Te escribimos", detalle: "Te proponemos {opciones}." },
  { titulo: "Reservas", detalle: "Sin salir de la conversación." },
];
const EJEMPLO = [
  { de: "cliente", texto: "Hola" },
  { de: "agente", texto: "El {dia1} a las {hora1} o el {dia2} a las {hora2}" },
];
const regla = (motivo: string, frases: string[] = ["urgencia"]) => ({ motivo, frases });
const campo = (clave: string, resumen = false) => ({ clave, etiqueta: cap(clave), ...(resumen ? { resumen } : {}) });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const TARJETA = { titulo: "Cocina", detalle: "", foto: 1, descripcion: "" };
const SERVICIO = { nombre: "Cocinas", detalle: "" };
const GALERIA = { titular: "Trabajos", nota: "", tarjetas: [TARJETA] };
const ESTUDIO = { titular: "El estudio", texto: "Somos dos.\nY un perro.", servicios: [SERVICIO] };

// [ruta, valor válido en el límite, valor no válido en el límite, mensaje, campo si no es la ruta]
type Fila = [string, unknown, unknown, string, string?];
const FILAS: Fila[] = [
  ["negocio.nombre", x(60), x(61), "El nombre va en una sola línea, de 1 a 60 caracteres"],
  ["negocio.nombre", "A", "", "El nombre va en una sola línea, de 1 a 60 caracteres"],
  ["negocio.nombre", "Mi tienda", "Mi\ntienda", "El nombre va en una sola línea, de 1 a 60 caracteres"],
  ["negocio.nombre", "Mi tienda", "Mi {tienda}", "El nombre va en una sola línea, de 1 a 60 caracteres"],
  ["negocio.lema", x(60), x(61), "El lema no puede pasar de 60 caracteres"],
  ["negocio.lema", "", "a\tb", "El lema no puede pasar de 60 caracteres"],
  ["negocio.color", "#2f9e6e", "#2f9e6", "El color va como #2f9e6e"],
  ["regional.pais", "MX", "XX", "Ese país no está en la lista"],
  ["regional.moneda", "USD", "BTC", "Esa moneda no está en la lista"],
  ["regional.prefijo", "34", "+34", "El prefijo va sin +, de 1 a 3 cifras"],
  ["regional.prefijo", "34", "0034", "El prefijo va sin +, de 1 a 3 cifras"],
  ["calendario.zona", "America/Bogota", "Marte/Base", "Elige la zona horaria de la lista"],
  ["calendario.diasVista", 365, 0, "De 1 a 365 días"],
  ["calendario.horas", ["09:00"], [], "Pon al menos una hora de cita"],
  ["plantilla", PLANTILLA_GENERAL, { ...PLANTILLA_GENERAL, nombre: "Solicitud" }, "El nombre de la plantilla solo lleva minúsculas, números y _", "plantilla.nombre"],
  ["vocabulario.cita", { singular: "turno", plural: "turnos", genero: "m" }, { singular: "turno" }, "Cada palabra necesita singular, plural y género", "vocabulario.cita.plural"],
  ["vocabulario.cliente", { singular: "paciente", plural: "pacientes", genero: "m" }, { singular: "Paciente", plural: "pacientes", genero: "m" }, "Escríbelo en minúscula: la mayúscula se pone sola", "vocabulario.cliente.singular"],
  ["vocabulario.importe", { singular: "cuota", plural: "cuotas", genero: "f" }, { singular: "cuota", plural: "cuotas", genero: "x" }, "Elige masculino o femenino", "vocabulario.importe.genero"],
  ["vocabulario.catalogo", { singular: x(30), plural: "coches", genero: "m" }, { singular: x(31), plural: "coches", genero: "m" }, "De 1 a 30 caracteres", "vocabulario.catalogo.singular"],
  ["vocabulario.catalogo", { singular: "gafas", plural: "gafas", genero: "f", soloPlural: true }, { singular: "coche", genero: "m" }, "Cada palabra necesita singular, plural y género", "vocabulario.catalogo.plural"],
  ["vocabulario.zona", x(30), x(31), "La etiqueta de la zona, de 1 a 30 caracteres"],
  ["vocabulario.equipo", x(30), "", "De 1 a 30 caracteres"],
  ["vocabulario.ejemplos.etiquetas", x(60), x(61), "De 1 a 60 caracteres"],
  ["vocabulario.ejemplos.dato", x(30), x(31), "De 1 a 30 caracteres"],
  ["campos", Array.from({ length: 12 }, (_, i) => campo(`dato${i}`)), Array.from({ length: 13 }, (_, i) => campo(`dato${i}`)), "Caben 12 datos en la ficha"],
  ["campos", [campo("tipo"), campo("metros")], [campo("tipo"), campo("Tipo")], "La clave «tipo» está repetida", "campos.1.clave"],
  ["campos", [{ clave: "tipo", etiqueta: x(40) }], [{ clave: "tipo", etiqueta: "" }], "Cada dato necesita un nombre", "campos.0.etiqueta"],
  ["campos", [{ clave: x(40), etiqueta: "A" }], [{ clave: x(41), etiqueta: "A" }], "De 1 a 40 caracteres", "campos.0.clave"],
  ["campos", [{ clave: "metros", etiqueta: "Metros", unidad: x(8) }], [{ clave: "metros", etiqueta: "Metros", unidad: x(9) }], "Hasta 8 caracteres", "campos.0.unidad"],
  ["campos", [campo("a", true), campo("b", true), campo("c", true)], [campo("a", true), campo("b", true), campo("c", true), campo("d", true)], "Como mucho 3 datos en el resumen"],
  ["agente.catalogo", "si", "quizas", "Elige Automático, Sí o No"],
  ["agente.negociar", "auto", "siempre", "Elige Automático, Sí o No"],
  ["agente.trato", "usted", "vos", "Elige tú o usted"],
  ["agente.pasarSiempre", Array.from({ length: 5 }, (_, i) => regla(`Motivo ${i}`)), Array.from({ length: 6 }, (_, i) => regla(`Motivo ${i}`)), "Caben 5 reglas"],
  ["agente.pasarSiempre", [regla("A", ["abc", x(40)])], [regla("A"), regla("B", ["urgencia", "dolor", "sangra", "ab"])], "Cada frase, de 3 a 40 caracteres", "agente.pasarSiempre.1.frases.3"],
  ["agente.pasarSiempre", [regla("A", Array.from({ length: 20 }, (_, i) => `frase ${i}`))], [regla("A", Array.from({ length: 21 }, (_, i) => `frase ${i}`))], "Caben 20 frases por regla", "agente.pasarSiempre.0.frases"],
  ["agente.pasarSiempre", [regla(x(60))], [regla(x(61))], "El motivo, hasta 60 caracteres", "agente.pasarSiempre.0.motivo"],
  ["agente.pasarSiempre", [regla(""), regla("Urgencia")], [regla(""), regla("Urgencia"), regla("")], "Solo puede haber una lista sin motivo", "agente.pasarSiempre.2.motivo"],
  ["agente.pasarSiempre", [{ motivo: "A", frases: ["abc"], respuesta: x(200) }], [{ motivo: "A", frases: ["abc"], respuesta: "Hola {negocio}" }], "La respuesta va en una línea de hasta 200 caracteres, sin llaves", "agente.pasarSiempre.0.respuesta"],
  ["agente.pasarSiempre", [{ motivo: "A", frases: ["abc"], respuesta: "Llama al 112." }], [{ motivo: "A", frases: ["abc"], respuesta: x(201) }], "La respuesta va en una línea de hasta 200 caracteres, sin llaves", "agente.pasarSiempre.0.respuesta"],
  ["agente.excepciones", Array.from({ length: 20 }, (_, i) => `frase ${i}`), Array.from({ length: 21 }, (_, i) => `frase ${i}`), "Caben 20 frases que no cuentan"],
  ["agente.excepciones", ["abc", x(60)], ["no es urgente", "ab"], "Cada frase que no cuenta, de 3 a 60 caracteres", "agente.excepciones.1"],
  ["agente.frases.pase", x(200), x(201), "Cada frase va en una línea de 1 a 200 caracteres"],
  ["agente.frases.fallo", "Perdona.", "", "Cada frase va en una línea de 1 a 200 caracteres"],
  ["agente.frases.noTexto", "¿Me lo escribes?", "Uno\nDos", "Cada frase va en una línea de 1 a 200 caracteres"],
  ["agente.frases.audio", "No se oye.", "No se oye {negocio}.", "Cada frase va en una línea de 1 a 200 caracteres"],
  ["agente.frases.baja", "Hecho.", "Hecho {}.", "Cada frase va en una línea de 1 a 200 caracteres"],
  ["agente.frases.presentacion", "Soy el Asistente Virtual de {negocio}.", "Soy el asistente de {negocio}.", "La presentación tiene que decir que es un asistente virtual"],
  ["agente.frases.presentacion", "Soy el asistente virtual de {negocio}.", "Soy el asistente virtual de {empresa}.", "Cada frase va en una línea de 1 a 200 caracteres"],
  ["agente.frases.borrarDatos", "Se lo paso a {negocio}.", "Se lo paso a recepción.", "La frase tiene que nombrar al negocio: pon {negocio}"],
  ["spam.dominiosNormales", Array.from({ length: 30 }, (_, i) => `web${i}.es`), Array.from({ length: 31 }, (_, i) => `web${i}.es`), "Caben 30 dominios"],
  ["spam.dominiosNormales", ["doctoralia.es"], ["doctoralia"], "Ese dominio no es válido", "spam.dominiosNormales.0"],
  ["spam.ganchosQuitados", ["seo"], ["hola"], "Esa palabra no está en la lista de publicidad", "spam.ganchosQuitados.0"],
  ["portada.descripcion", x(160), x(161), "Hasta 160 caracteres"],
  ["portada.hero.antetitulo", x(24), x(25), "El antetítulo, de 1 a 24 caracteres"],
  ["portada.hero.antetitulo", "A", "", "El antetítulo, de 1 a 24 caracteres"],
  ["portada.hero.titular", x(40), x(41), "El titular, de 1 a 40 caracteres"],
  ["portada.hero.titular", "Pide cita.", "Pide\ncita.", "El titular, de 1 a 40 caracteres"],
  ["portada.hero.subtitulo", x(90), x(91), "El subtítulo, hasta 90 caracteres"],
  ["portada.hero.subtitulo", "", "a\nb", "El subtítulo, hasta 90 caracteres"],
  ["portada.hero.foto", "/fotos/panel.webp", "/fotos/otra.webp", "Elige una foto de la lista"],
  ["portada.proceso.foto", "/fotos/proyecto-6.webp", "/fotos/proyecto-7.webp", "Elige una foto de la lista"],
  ["portada.formulario.chips", [x(30), "B"], ["A", "B", "C"], "De 1 a 30 caracteres"],
  ["portada.formulario.chips", ["A", x(30)], ["A", x(31)], "De 1 a 30 caracteres", "portada.formulario.chips.1"],
  ["portada.formulario.zona", x(30), x(31), "La etiqueta de la zona, de 1 a 30 caracteres"],
  ["portada.formulario.consentimiento", "{negocio}x", "{negocio}", "De 10 a 200 caracteres"],
  ["portada.formulario.consentimiento", `{negocio}${x(191)}`, `{negocio}${x(192)}`, "De 10 a 200 caracteres"],
  ["portada.formulario.consentimiento", "Acepto que {negocio} me escriba.", "Acepto que me escribáis por WhatsApp.", "El texto de la casilla tiene que nombrar al negocio: pon {negocio}"],
  ["portada.formulario.urlPrivacidad", "https://ejemplo.es/privacidad", "http://ejemplo.es/privacidad", "La política de privacidad tiene que empezar por https://"],
  ["portada.formulario.urlPrivacidad", `https://ejemplo.es/${x(181)}`, `https://ejemplo.es/${x(182)}`, "La política de privacidad tiene que empezar por https://"],
  ["portada.formulario.urlPrivacidad", "https://ejemplo.es", "https://ana:clave@ejemplo.es", "La política de privacidad tiene que empezar por https://"],
  ["portada.formulario.marcado", true, "si", "Tiene que ser sí o no"],
  ["portada.formulario.boton", x(30), x(31), "De 1 a 30 caracteres"],
  ["portada.formulario.enviado", ["Hecho", "Busca a {negocio}"], ["Hecho"], "De 1 a 60 caracteres"],
  ["portada.formulario.enviado", ["Hecho", x(60)], ["Hecho", x(61)], "De 1 a 60 caracteres", "portada.formulario.enviado.1"],
  ["portada.formulario.enviado", ["Hecho", "Busca a {negocio}"], ["Hecho", "Busca a {nombre}"], "De 1 a 60 caracteres", "portada.formulario.enviado.1"],
  ["portada.proceso.titular", x(40), x(41), "El titular, de 1 a 40 caracteres"],
  ["portada.proceso.pasos", PASOS, PASOS.slice(0, 2), "Entre 3 y 6 pasos"],
  ["portada.proceso.pasos", [...PASOS, ...PASOS], [...PASOS, ...PASOS, PASOS[0]], "Entre 3 y 6 pasos"],
  ["portada.proceso.pasos", PASOS, [...PASOS.slice(0, 2), { titulo: "Ven", detalle: "El {dia1}" }], "Solo vale {opciones}", "portada.proceso.pasos.2.detalle"],
  ["portada.proceso.pasos", PASOS, [PASOS[0], PASOS[1], { titulo: x(41), detalle: "a" }], "De 1 a 40 caracteres", "portada.proceso.pasos.2.titulo"],
  ["portada.proceso.boton", x(30), "", "De 1 a 30 caracteres"],
  ["portada.proceso.ejemplo", EJEMPLO, EJEMPLO.slice(0, 1), "La conversación de ejemplo, de 2 a 8 mensajes"],
  ["portada.proceso.ejemplo", [...EJEMPLO, ...EJEMPLO, ...EJEMPLO, ...EJEMPLO], [...EJEMPLO, ...EJEMPLO, ...EJEMPLO, ...EJEMPLO, EJEMPLO[0]], "La conversación de ejemplo, de 2 a 8 mensajes"],
  ["portada.proceso.ejemplo", [EJEMPLO[0], { de: "agente", texto: "{opciones}" }], [EJEMPLO[0], { de: "agente", texto: "Hola {nombre}" }], "Solo valen {dia1}, {hora1}, {dia2}, {hora2} y {opciones}", "portada.proceso.ejemplo.1.texto"],
  ["portada.proceso.ejemplo", [EJEMPLO[0], { de: "agente", texto: x(200) }], [EJEMPLO[0], { de: "bot", texto: "Hola" }], "Cada mensaje es del cliente o del asistente", "portada.proceso.ejemplo.1.de"],
  ["portada.galeria", GALERIA, { ...GALERIA, titular: x(41) }, "El titular, de 1 a 40 caracteres", "portada.galeria.titular"],
  ["portada.galeria", { ...GALERIA, tarjetas: Array(9).fill(TARJETA) }, { ...GALERIA, tarjetas: Array(10).fill(TARJETA) }, "Caben 9 tarjetas", "portada.galeria.tarjetas"],
  ["portada.galeria", { ...GALERIA, tarjetas: [{ ...TARJETA, foto: 6 }, { ...TARJETA, foto: null }] }, { ...GALERIA, tarjetas: [{ ...TARJETA, foto: 7 }] }, "Elige una foto de la lista", "portada.galeria.tarjetas.0.foto"],
  ["portada.estudio", ESTUDIO, { ...ESTUDIO, titular: "" }, "El titular, de 1 a 40 caracteres", "portada.estudio.titular"],
  ["portada.estudio", { ...ESTUDIO, servicios: Array(6).fill(SERVICIO) }, { ...ESTUDIO, servicios: Array(7).fill(SERVICIO) }, "Caben 6 servicios", "portada.estudio.servicios"],
  ["portada.whatsapp.subtitulo", x(90), x(91), "El subtítulo, hasta 90 caracteres"],
  ["portada.whatsapp.pasos", PASOS, PASOS.slice(0, 2), "Entre 3 y 6 pasos"],
  ["web.entrada", "formulario", "correo", "Elige el botón de WhatsApp o el formulario"],
  ["web.entrada", "whatsapp", "", "Elige el botón de WhatsApp o el formulario"],
  ["web.mensaje", x(300), x(301), "El mensaje va en una línea de 1 a 300 caracteres"],
  ["web.mensaje", "Hola {negocio}, quiero cita", "", "El mensaje va en una línea de 1 a 300 caracteres"],
  ["web.mensaje", "Hola", "Hola\nquiero cita", "El mensaje va en una línea de 1 a 300 caracteres"],
  ["web.mensaje", "Hola, quiero cita", "Hola {nombre}", "En el mensaje solo vale {negocio}"],
];

describe("revisarCambios: cada campo en sus límites", () => {
  it.each(FILAS)("%s", (ruta, valido, invalido, mensaje, campo) => {
    const bien = revisar(en(ruta, valido));
    expect(bien).not.toHaveProperty("error");
    expect(revisar(en(ruta, invalido))).toEqual({ error: mensaje, campo: campo ?? ruta });
  });
});

describe("revisarCambios: normaliza y devuelve lo normalizado", () => {
  it("recorta, junta espacios y pone el color en minúsculas", () => {
    expect(revisar({ negocio: { nombre: "  Mi   tienda ", lema: " Desde 1990 ", color: " #2F9E6E " } })).toEqual({
      cambios: { negocio: { nombre: "Mi tienda", lema: "Desde 1990", color: "#2f9e6e" } },
    });
  });

  it("las claves de la ficha se normalizan", () => {
    const r = revisar({ campos: [{ clave: "Tipo de Obra", etiqueta: " Tipo de obra ", unidad: "", resumen: true }] });
    expect(r).toEqual({ cambios: { campos: [{ clave: "tipo_de_obra", etiqueta: "Tipo de obra", resumen: true }] } });
  });

  it("las frases de una regla se guardan como se escribieron y no se repiten sin mayúsculas ni acentos", () => {
    const r = revisar({ agente: { pasarSiempre: [{ motivo: " Urgencia ", frases: [" Me DUELE ", "me duele", "Sangrá", "sangra"], respuesta: "" }] } });
    expect(r).toEqual({ cambios: { agente: { pasarSiempre: [{ motivo: "Urgencia", frases: ["Me DUELE", "Sangrá"] }] } } });
  });

  it("una frase con acento se guarda con su acento", () => {
    const r = revisar({ agente: { pasarSiempre: [{ motivo: "", frases: ["  reclamación  ", "RECLAMACION", "baja   médica"] }] } });
    expect(r).toEqual({ cambios: { agente: { pasarSiempre: [{ motivo: "", frases: ["reclamación", "baja médica"] }] } } });
  });

  it("la frase guardada coincide sin acentos y el motivo la muestra como se escribió", () => {
    const r = revisar({ agente: { pasarSiempre: [{ motivo: "", frases: ["reclamación"] }] } });
    const pasarSiempre = (r as { cambios: { agente: { pasarSiempre: ReglaPase[] } } }).cambios.agente.pasarSiempre;
    expect(paseObligado("quiero poner una RECLAMACION", "", { pasarSiempre })).toEqual({ motivo: "Ha escrito «reclamación»" });
    expect(paseObligado("quiero poner una reclamación", "", { pasarSiempre })).toEqual({ motivo: "Ha escrito «reclamación»" });
    expect(paseObligado("quiero un presupuesto", "", { pasarSiempre })).toBeNull();
  });

  it("una regla sin motivo es la lista «Pásamelo siempre si escribe…»", () => {
    const r = revisar({ agente: { pasarSiempre: [{ frases: ["factura"] }] } });
    expect(r).toEqual({ cambios: { agente: { pasarSiempre: [{ motivo: "", frases: ["factura"] }] } } });
  });

  it("dominios en minúsculas y ganchos como en la lista", () => {
    expect(revisar({ spam: { dominiosNormales: [" Doctoralia.ES "], ganchosQuitados: ["Diseño web", "diseno web"] } })).toEqual({
      cambios: { spam: { dominiosNormales: ["doctoralia.es"], ganchosQuitados: ["diseno web"] } },
    });
  });

  it("una política de privacidad vacía es ninguna", () => {
    expect(revisar({ portada: { formulario: { urlPrivacidad: "  " } } })).toEqual({ cambios: { portada: { formulario: { urlPrivacidad: null } } } });
  });

  it("del calendario solo vuelven los campos que traía el PATCH", () => {
    expect(revisar({ calendario: { diasVista: 30, zona: " America/Lima " } })).toEqual({ cambios: { calendario: { diasVista: 30, zona: "America/Lima" } } });
  });
});

describe("revisarCambios: lista blanca, null y casos raros", () => {
  it("lo que no es un objeto no trae cambios", () => {
    for (const e of [null, undefined, "hola", 3, [], true]) expect(revisar(e)).toEqual({ error: "No hay cambios que guardar", campo: "" });
  });

  it("una clave desconocida a cualquier profundidad", () => {
    expect(revisar({ sector: "personalizado" })).toEqual({ error: "No se puede cambiar «sector» desde aquí", campo: "sector" });
    expect(revisar({ base: "clinica" })).toEqual({ error: "No se puede cambiar «base» desde aquí", campo: "base" });
    expect(revisar({ negocio: { logo: "x" } })).toEqual({ error: "No se puede cambiar «negocio.logo» desde aquí", campo: "negocio.logo" });
    expect(revisar({ portada: { hero: { boton: "x" } } })).toEqual({ error: "No se puede cambiar «portada.hero.boton» desde aquí", campo: "portada.hero.boton" });
    expect(revisar({ calendario: { festivos: [] } })).toEqual({ error: "No se puede cambiar «calendario.festivos» desde aquí", campo: "calendario.festivos" });
    expect(revisar({ campos: [{ clave: "a", etiqueta: "A", color: "rojo" }] })).toEqual({ error: "No se puede cambiar «campos.0.color» desde aquí", campo: "campos.0.color" });
  });

  it("el logo tiene su propio botón", () => {
    expect(revisar({ negocio: { logoVersion: "0123456789ab" } })).toEqual({ error: "El logo se cambia con su botón", campo: "negocio.logoVersion" });
    expect(revisar({ negocio: { logoVersion: null } })).toEqual({ error: "El logo se cambia con su botón", campo: "negocio.logoVersion" });
  });

  it("null borra lo guardado y vale en cualquier nivel", () => {
    const rutas = [
      "negocio", "negocio.nombre", "negocio.color", "plantilla", "calendario", "calendario.horas", "regional.prefijo", "vocabulario.cita",
      "vocabulario.zona", "vocabulario.ejemplos.dato", "campos", "agente", "agente.frases.pase", "agente.pasarSiempre", "spam.ganchosQuitados",
      "portada", "portada.hero.titular", "portada.formulario.urlPrivacidad", "portada.galeria", "portada.estudio.servicios",
    ];
    for (const ruta of rutas) {
      const r = revisar(en(ruta, null));
      expect(r, ruta).toEqual({ cambios: en(ruta, null) });
    }
  });

  it("una palabra a medias no se acepta: «cita» con «visitas»", () => {
    expect(revisar({ vocabulario: { cita: { singular: "cita" } } })).toEqual({ error: "Cada palabra necesita singular, plural y género", campo: "vocabulario.cita.plural" });
    expect(revisar({ vocabulario: { cita: { singular: "cita", plural: "citas" } } })).toEqual({
      error: "Cada palabra necesita singular, plural y género",
      campo: "vocabulario.cita.genero",
    });
    expect(revisar({ vocabulario: { cita: "cita" } })).toEqual({ error: "Cada palabra necesita singular, plural y género", campo: "vocabulario.cita" });
  });

  it("el prefijo tiene que ser el del país, salvo «Otro»", () => {
    const espana = PAISES.find((p) => p.id === "ES")!.nombre;
    const mexico = PAISES.find((p) => p.id === "MX")!.nombre;
    expect(revisar({ regional: { pais: "MX", prefijo: "34" } })).toEqual({ error: `Ese prefijo no es el de ${mexico}`, campo: "regional.prefijo" });
    expect(revisar({ regional: { prefijo: "52" } })).toEqual({ error: `Ese prefijo no es el de ${espana}`, campo: "regional.prefijo" });
    expect(revisar({ regional: { pais: "MX", moneda: "MXN", prefijo: "52" } })).toEqual({ cambios: { regional: { pais: "MX", moneda: "MXN", prefijo: "52" } } });
    expect(revisar({ regional: { pais: "OTRO", prefijo: "999" } })).toEqual({ cambios: { regional: { pais: "OTRO", prefijo: "999" } } });
    expect(revisarCambios({ regional: { prefijo: "52" } }, { ahora: AHORA, regional: { pais: "MX", moneda: "MXN", prefijo: "52" } })).toEqual({
      cambios: { regional: { prefijo: "52" } },
    });
  });

  it("el calendario pasa por revisarReglas con lo actual debajo", () => {
    const actual = { ...PRESETS.clinica.calendario };
    expect(revisarCambios({ calendario: { diasVista: 0 } }, { ahora: AHORA, calendario: actual })).toEqual({ error: "De 1 a 365 días", campo: "calendario.diasVista" });
    expect(revisarCambios({ calendario: { horas: [] } }, { ahora: AHORA, calendario: actual })).toEqual({
      error: "Pon al menos una hora de cita",
      campo: "calendario.horas",
    });
    expect(revisarCambios({ calendario: { diasVista: 20 } }, { ahora: AHORA, calendario: actual })).toEqual({ cambios: { calendario: { diasVista: 20 } } });
  });

  describe("sin huecos libres", () => {
    afterEach(() => {
      estado.sinHuecos = false;
    });

    it("avisa con los días que mira", () => {
      estado.sinHuecos = true;
      expect(revisar({ calendario: { diasVista: 5 } })).toEqual({ error: "Con estas reglas no hay ningún hueco libre en los próximos 5 días", campo: "calendario" });
      expect(revisar({ calendario: { horas: ["10:00"] } })).toEqual({
        error: "Con estas reglas no hay ningún hueco libre en los próximos 60 días",
        campo: "calendario",
      });
    });

    it("borrar un campo del calendario no mira los huecos", () => {
      estado.sinHuecos = true;
      expect(revisar({ calendario: { diasVista: null } })).toEqual({ cambios: { calendario: { diasVista: null } } });
    });
  });

  it("un PATCH demasiado grande", () => {
    expect(revisar({ portada: { descripcion: x(LIMITES.guardadaBytes) } })).toEqual({ error: "La configuración es demasiado grande", campo: "" });
  });

  it("la basura nunca lanza", () => {
    const basura: unknown[] = [null, undefined, 0, -1, NaN, "", "x", [], [null], [1, "a"], {}, { a: { b: { c: [] } } }, true, () => 1];
    for (const valor of basura) {
      for (const ruta of ["negocio", "negocio.nombre", "plantilla", "calendario", "calendario.horas", "regional", "regional.pais", "vocabulario.cita", "campos", "agente.pasarSiempre", "agente.frases", "spam", "portada.proceso.pasos", "portada.galeria.tarjetas"]) {
        expect(() => revisar(en(ruta, valor))).not.toThrow();
      }
      expect(() => revisarSistema(valor)).not.toThrow();
      expect(() => revisarPlantilla(valor)).not.toThrow();
      expect(() => normalizarGuardada({ perfiles: { a: { portada: valor, agente: { frases: valor } } }, sistema: valor })).not.toThrow();
    }
  });

  it("lo revisado alimenta aplicarCambios: objetos se fusionan, arrays se sustituyen y null borra", () => {
    const actual: ConfiguracionPerfil = {
      negocio: { nombre: "Antes", lema: "Lema" },
      agente: { excepciones: ["no es urgente", "otra vez"], frases: { pase: "Te paso.", fallo: "Perdona." } },
      portada: { hero: { titular: "Antes." } },
    };
    const r = revisar({ negocio: { nombre: " Después " }, agente: { excepciones: ["solo una"], frases: { fallo: null } }, portada: null });
    if ("error" in r) throw new Error(r.error);
    expect(aplicarCambios(actual, r.cambios)).toEqual({
      negocio: { nombre: "Después", lema: "Lema" },
      agente: { excepciones: ["solo una"], frases: { pase: "Te paso." } },
    });
  });
});

describe("revisarPlantilla", () => {
  const p = (cambios: Partial<Plantilla>) => revisarPlantilla({ ...PLANTILLA_GENERAL, ...cambios });

  it("acepta las conocidas y la normaliza", () => {
    expect(revisarPlantilla(PLANTILLA_GENERAL)).toEqual({ plantilla: PLANTILLA_GENERAL });
    expect(p({ nombre: " solicitud_recibida ", texto: ` ${CUERPO_POR_DEFECTO} ` })).toEqual({
      plantilla: { nombre: "solicitud_recibida", idioma: "es_ES", texto: CUERPO_POR_DEFECTO },
    });
    expect(p({ idioma: "es" })).not.toHaveProperty("error");
  });

  it("cada mensaje, con su campo", () => {
    const NOMBRE = { error: "El nombre de la plantilla solo lleva minúsculas, números y _", campo: "nombre" };
    const IDIOMA = { error: "El idioma va como es_ES", campo: "idioma" };
    const VARIABLES = { error: "El texto necesita {{1}} (el nombre) y {{2}} (el negocio), una vez cada uno", campo: "texto" };
    expect(p({ nombre: "Solicitud-General" })).toEqual(NOMBRE);
    expect(p({ nombre: "" })).toEqual(NOMBRE);
    expect(revisarPlantilla({ idioma: "es_ES", texto: CUERPO_GENERAL })).toEqual(NOMBRE);
    expect(revisarPlantilla("hola")).toEqual(NOMBRE);
    expect(p({ idioma: "español" })).toEqual(IDIOMA);
    expect(p({ idioma: "es_es" })).toEqual(IDIOMA);
    expect(p({ texto: "Hola {{1}}, gracias." })).toEqual(VARIABLES);
    expect(p({ texto: "Hola {{1}} de {{2}} y {{3}}." })).toEqual(VARIABLES);
    expect(p({ texto: "Hola {{1}} y {{1}} de {{2}}." })).toEqual(VARIABLES);
    expect(revisarPlantilla({ nombre: "a", idioma: "es_ES" })).toEqual(VARIABLES);
    expect(p({ texto: "{{1}}, soy de {{2}}." })).toEqual({ error: "Meta no deja empezar ni acabar con una variable", campo: "texto" });
    expect(p({ texto: "Hola {{1}}, soy de {{2}}" })).toEqual({ error: "Meta no deja empezar ni acabar con una variable", campo: "texto" });
    expect(p({ texto: "Hola {{1}} {{2}}." })).toEqual({ error: "Pon texto entre {{1}} y {{2}}", campo: "texto" });
    expect(p({ texto: `Hola {{1}} de {{2}}. ${x(LIMITES.plantillaTexto)}` })).toEqual({ error: "De 1 a 1024 caracteres", campo: "texto" });
  });
});

describe("revisarSistema", () => {
  it("los campos en vivo se descartan sin decir nada", () => {
    expect(revisarSistema({ asistente: { activo: false, pausadoEn: 1700000000000 } })).toEqual({ cambios: {} });
    expect(revisarSistema({ asistente: { activo: "x", modelo: "claude-sonnet-5-5" } })).toEqual({ cambios: { asistente: { modelo: "claude-sonnet-5-5" } } });
  });

  it("el modelo: uno de la lista o null", () => {
    expect(revisarSistema({ asistente: { modelo: null } })).toEqual({ cambios: { asistente: { modelo: null } } });
    expect(revisarSistema({ asistente: { modelo: MODELOS[0] } })).toEqual({ cambios: { asistente: { modelo: MODELOS[0] } } });
    expect(revisarSistema({ asistente: { modelo: "gpt" } })).toEqual({
      error: `Elige «${NOMBRES_MODELO[MODELOS[0]]}» o «${NOMBRES_MODELO[MODELOS[1]]}»`,
      campo: "sistema.asistente.modelo",
    });
    expect(revisarSistema({ asistente: { modelo: "gpt" } })).toEqual({ error: "Elige «Rápido (recomendado)» o «Más cuidadoso, más caro»", campo: "sistema.asistente.modelo" });
  });

  it("el móvil del aviso en sus tres estados", () => {
    const tel = (telefono: unknown) => revisarSistema({ avisos: { comercial: { telefono } } });
    expect(tel(null)).toEqual({ cambios: { avisos: { comercial: { telefono: null } } } });
    expect(tel("  ")).toEqual({ cambios: { avisos: { comercial: { telefono: "" } } } });
    expect(tel("+34 612 345 678")).toEqual({ cambios: { avisos: { comercial: { telefono: "34612345678" } } } });
    expect(revisarSistema({ avisos: { comercial: { telefono: "612345678" } } }, { prefijo: "34" })).toEqual({ cambios: { avisos: { comercial: { telefono: "34612345678" } } } });
    // Sin prefijo o de otro país: lo que diga normalizarTelefono (W4 lo hace consciente del prefijo).
    expect(tel("612345678")).toEqual({ cambios: { avisos: { comercial: { telefono: normalizarTelefono("612345678") } } } });
    expect(tel("+52 55 1234 5678")).toEqual({ cambios: { avisos: { comercial: { telefono: normalizarTelefono("+52 55 1234 5678") } } } });
    expect(normalizarTelefono("+52 55 1234 5678")).toMatch(/^52\d+$/);
    const MOVIL = { error: "Revisa el móvil: con prefijo, como +34 612 345 678", campo: "sistema.avisos.comercial.telefono" };
    expect(tel("12")).toEqual(MOVIL);
    expect(tel(612345678)).toEqual(MOVIL);
    // Con «+» y más de 15 cifras: no se podría leer después, así que no se acepta.
    expect(tel("+34 612 345 678 901 234 567")).toEqual(MOVIL);
  });

  it("detalle, primer cliente y claves desconocidas", () => {
    expect(revisarSistema({ avisos: { comercial: { detalle: "minimo" } } })).toEqual({ cambios: { avisos: { comercial: { detalle: "minimo" } } } });
    expect(revisarSistema({ avisos: { comercial: { detalle: "todo" } } })).toEqual({ error: "Elige completo o mínimo", campo: "sistema.avisos.comercial.detalle" });
    expect(revisarSistema({ primerCliente: { contestado: true } })).toEqual({ cambios: { primerCliente: { contestado: true } } });
    expect(revisarSistema({ primerCliente: { contestado: "si" } })).toEqual({ error: "Tiene que ser sí o no", campo: "sistema.primerCliente.contestado" });
    expect(revisarSistema({ tema: "oscuro" })).toEqual({ error: "No se puede cambiar «sistema.tema» desde aquí", campo: "sistema.tema" });
    expect(revisarSistema({ asistente: { voz: "x" } })).toEqual({ error: "No se puede cambiar «sistema.asistente.voz» desde aquí", campo: "sistema.asistente.voz" });
    expect(revisarSistema({ avisos: { comercial: { activo: true } } })).toEqual({
      error: "No se puede cambiar «sistema.avisos.comercial.activo» desde aquí",
      campo: "sistema.avisos.comercial.activo",
    });
    expect(revisarSistema("x")).toEqual({ error: "No hay cambios que guardar", campo: "sistema" });
  });

  it("todo junto", () => {
    expect(
      revisarSistema({ asistente: { modelo: null, activo: true }, avisos: { comercial: { telefono: "", detalle: "completo" } }, primerCliente: { contestado: false } }),
    ).toEqual({ cambios: { asistente: { modelo: null }, avisos: { comercial: { telefono: "", detalle: "completo" } }, primerCliente: { contestado: false } } });
  });
});

describe("slugPerfil", () => {
  it("el id sale del título y vuelve igual por leerTitulo", () => {
    for (const nombre of ["Peluquería Lola", "  Taller   Pepe ", "Café · Bar", "Óptica\nCentral", "Ñandú & Co.", "x".repeat(80)]) {
      const { id, titulo } = slugPerfil(nombre, new Set());
      expect(titulo.startsWith("# Asistente de WhatsApp · ")).toBe(true);
      expect(leerTitulo(titulo).id).toBe(id);
      expect(id).toMatch(/^[a-z0-9-]{1,80}$/);
      expect(leerTitulo(titulo).nombre.length).toBeLessThanOrEqual(60);
    }
    expect(slugPerfil("Peluquería Lola", new Set())).toEqual({ id: "peluqueria-lola", titulo: "# Asistente de WhatsApp · Peluquería Lola" });
    expect(slugPerfil("Café · Bar", new Set()).titulo).toBe("# Asistente de WhatsApp · Café Bar");
  });

  it("los reservados y los ocupados pasan a «(2)», «(3)»…", () => {
    for (const reservado of PERFILES_RESERVADOS) {
      const titulo = `# Asistente de WhatsApp · ${reservado}`;
      expect(slugPerfil(leerTitulo(titulo).nombre, new Set()).id).not.toBe(reservado);
    }
    expect(slugPerfil("Clínica", new Set())).toEqual({ id: "clinica-2", titulo: "# Asistente de WhatsApp · Clínica (2)" });
    expect(slugPerfil("Estudio de reformas", new Set()).id).toBe("estudio-de-reformas-2");
    expect(slugPerfil("Ejemplo", new Set()).id).toBe("ejemplo-2");
    expect(slugPerfil("Lola", new Set(["lola", "lola-2"]))).toEqual({ id: "lola-3", titulo: "# Asistente de WhatsApp · Lola (3)" });
    const largo = slugPerfil("y".repeat(60), new Set(["y".repeat(60)]));
    expect(leerTitulo(largo.titulo)).toEqual({ id: largo.id, nombre: `${"y".repeat(56)} (2)` });
  });

  it("sin nombre, «negocio»", () => {
    expect(slugPerfil("", new Set())).toEqual({ id: "negocio", titulo: "# Asistente de WhatsApp · Negocio" });
    expect(slugPerfil(" · ", new Set()).id).toBe("negocio");
    expect(slugPerfil("!!!", new Set(["negocio"])).id).toBe("negocio-2");
  });
});

describe("normalizarGuardada", () => {
  it("la basura es lo vacío y nunca lanza", () => {
    for (const raw of [null, undefined, 1, "x", [], true, { perfiles: "x", sistema: 3, rev: -2 }, { version: 7, rev: 1.5 }]) {
      expect(normalizarGuardada(raw)).toEqual({ version: 1, rev: 0, perfiles: {}, sistema: {} });
    }
    expect(normalizarGuardada(null)).not.toBe(GUARDADA_VACIA);
  });

  it("una sección mala se descarta y se avisa; el resto se queda", () => {
    const descartadas: string[] = [];
    const g = normalizarGuardada(
      {
        version: 1,
        rev: 4,
        perfiles: {
          clinica: {
            negocio: { nombre: "Clínica Sol", logoVersion: "0123456789ab" },
            portada: { hero: { titular: x(41) } },
            agente: { trato: "usted", frases: { pase: "Le paso con recepción." } },
            calendario: { diasAbiertos: [1, 2, 3] },
          },
          "Mal Id": { negocio: { nombre: "x" } },
          roto: "x",
          propio: { sector: "personalizado", base: "nada", vocabulario: { cita: { singular: "turno" } }, regional: { pais: "MX", prefijo: "52" }, extra: 1 },
        },
      },
      (ruta) => descartadas.push(ruta),
    );
    expect(g).toEqual({
      version: 1,
      rev: 4,
      perfiles: {
        clinica: {
          negocio: { nombre: "Clínica Sol", logoVersion: "0123456789ab" },
          agente: { trato: "usted", frases: { pase: "Le paso con recepción." } },
          calendario: { diasAbiertos: [1, 2, 3] },
        },
        propio: { sector: "personalizado", regional: { pais: "MX", prefijo: "52" } },
      },
      sistema: {},
    });
    expect(descartadas).toEqual([
      "perfiles.clinica.portada",
      "perfiles.Mal Id",
      "perfiles.roto",
      "perfiles.propio.base",
      "perfiles.propio.vocabulario",
      "perfiles.propio.extra",
    ]);
  });

  it("el calendario guardado se revisa sin mirar los huecos", () => {
    const descartadas: string[] = [];
    const g = normalizarGuardada({ perfiles: { a: { calendario: { horas: [] } }, b: { calendario: { diasVista: 9 } } } }, (r) => descartadas.push(r));
    expect(g.perfiles).toEqual({ a: {}, b: { calendario: { diasVista: 9 } } });
    expect(descartadas).toEqual(["perfiles.a.calendario"]);
  });

  it("un logo mal guardado se descarta solo", () => {
    const descartadas: string[] = [];
    const g = normalizarGuardada({ perfiles: { a: { negocio: { nombre: "Ana", logoVersion: "../../etc" } } } }, (r) => descartadas.push(r));
    expect(g.perfiles.a).toEqual({ negocio: { nombre: "Ana" } });
    expect(descartadas).toEqual(["perfiles.a.negocio.logoVersion"]);
  });

  it("el sistema guarda también los campos en vivo: pausado sigue pausado", () => {
    const sistema = {
      asistente: { activo: false, pausadoEn: 1700000000000, modelo: "claude-sonnet-5-5" },
      avisos: { comercial: { telefono: "34612345678", detalle: "minimo" } },
      primerCliente: { contestado: true },
    };
    expect(normalizarGuardada({ sistema }).sistema).toEqual(sistema);
    expect(normalizarGuardada({ sistema: { avisos: { comercial: { telefono: "" } } } }).sistema).toEqual({ avisos: { comercial: { telefono: "" } } });
    expect(normalizarGuardada({ sistema: { avisos: { comercial: { telefono: null } } } }).sistema).toEqual({ avisos: { comercial: { telefono: null } } });
  });

  it("el sistema descarta campo a campo y avisa", () => {
    const descartadas: string[] = [];
    const g = normalizarGuardada(
      { sistema: { asistente: { activo: "no", pausadoEn: null, modelo: "gpt" }, avisos: { comercial: { telefono: "+34 6", detalle: "x" } }, tema: 1 } },
      (r) => descartadas.push(r),
    );
    expect(g.sistema).toEqual({ asistente: { pausadoEn: null } });
    expect(descartadas).toEqual([
      "sistema.asistente.activo",
      "sistema.asistente.modelo",
      "sistema.avisos.comercial.telefono",
      "sistema.avisos.comercial.detalle",
      "sistema.tema",
    ]);
  });

  it("si quien escucha lanza, no pasa nada", () => {
    expect(() =>
      normalizarGuardada({ perfiles: { "X X": {} } }, () => {
        throw new Error("no");
      }),
    ).not.toThrow();
  });
});

describe("generarPistaDatos", () => {
  it("reformas: los campos de siempre", () => {
    expect(generarPistaDatos(CAMPOS_REFORMAS, VOCABULARIO_REFORMAS)).toEqual({
      descripcion: "Guarda un dato útil del cliente: tipo, metros, plazo…",
      campo: PISTA_DATOS_REFORMAS.campo,
    });
  });

  it("un cliente en femenino", () => {
    const v: Vocabulario = { ...VOCABULARIO_REFORMAS, cliente: { singular: "clienta", plural: "clientas", genero: "f" } };
    expect(generarPistaDatos([{ clave: "talla", etiqueta: "Talla" }, { clave: "color_favorito", etiqueta: "Color favorito" }], v)).toEqual({
      descripcion: "Guarda un dato útil de la clienta: talla, color favorito…",
      campo: "Nombre corto del dato, en minúsculas: talla, color_favorito…",
    });
  });
});

// ---- Comprobaciones de las instrucciones ----

const RAIZ = path.resolve(__dirname, "..");

describe("revisarInstrucciones con los cuatro perfiles", () => {
  it.each(["reformas", "inmobiliaria", "clinica", "generico"] as const)("%s: sin errores", (sector) => {
    const p = PRESETS[sector];
    const texto = readFileSync(path.join(RAIZ, p.archivo), "utf8");
    const r = revisarInstrucciones(texto, {
      perfilId: leerTitulo(texto).id,
      vocabulario: p.vocabulario,
      agente: p.agente,
      moneda: p.regional.moneda,
      negocio: p.negocio.nombre,
      plantilla: p.plantilla,
    });
    expect(r.error).toBeUndefined();
    if (sector === "inmobiliaria") {
      expect(r.info).toContain("Catálogo activo · 3 referencias, 2 disponibles");
      expect(r.info).toContain("Negociar el precio pasa a una persona: sí");
      expect(r.catalogo).toEqual({ activo: true, refs: 3, disponibles: 2 });
      expect(r.negociarAPersona).toBe(true);
    }
  });

  it("CRLF cuenta como LF", () => {
    const texto = readFileSync(path.join(RAIZ, PRESETS.clinica.archivo), "utf8");
    const p = PRESETS.clinica;
    const ctx = { perfilId: "clinica", vocabulario: p.vocabulario, agente: p.agente, moneda: p.regional.moneda, negocio: p.negocio.nombre };
    expect(revisarInstrucciones(texto.replace(/\n/g, "\r\n"), ctx)).toEqual(revisarInstrucciones(texto, ctx));
  });
});

describe("revisarInstrucciones: cada comprobación", () => {
  const BASE = [
    "# Asistente de WhatsApp · Prueba",
    "",
    "Eres el asistente virtual de {{negocio}}. Escribes en español de España.",
    "",
    "## Qué preguntas, en este orden",
    "1. Qué necesita, en una frase.",
    "2. Para cuándo.",
    "",
    "## La visita",
    "Cuando sepas qué necesita, usa ver_huecos y ofrece los dos huecos.",
    "",
    "## Pasar a una persona",
    "Si pide hablar con alguien, usa pasar_a_persona.",
    "",
    "## Información que puedes dar tal cual",
    "- Abrimos de 10:00 a 14:00.",
    "",
  ].join("\n");
  const AGENTE: ReglasAgente = { ...PRESETS.reformas.agente };
  const ctx = {
    perfilId: "prueba",
    vocabulario: VOCABULARIO_REFORMAS,
    agente: AGENTE,
    moneda: "EUR" as Moneda,
    negocio: "Estudio Prueba",
    plantilla: PLANTILLA_GENERAL,
  };
  const con = (de: string, a: string) => {
    expect(BASE).toContain(de);
    return BASE.replace(de, a);
  };
  const avisos = (texto: string, cambios: Partial<typeof ctx> = {}) => {
    const r = revisarInstrucciones(texto, { ...ctx, ...cambios });
    expect(r.error).toBeUndefined();
    return r.avisos;
  };

  it("la base no tiene avisos y da su información", () => {
    const r = revisarInstrucciones(BASE, ctx);
    expect(r).toEqual({
      avisos: [],
      info: ["Sin catálogo", "Negociar el precio pasa a una persona: no", "{{negocio}} → Estudio Prueba", `Unos ${Math.round(BASE.length / 3.5)} tokens por mensaje`],
      catalogo: { activo: false, refs: 0, disponibles: 0 },
      negociarAPersona: false,
    });
  });

  it("errores: tamaño, primera línea y perfil", () => {
    const TAMANO = "Las instrucciones necesitan entre 50 y 12.000 caracteres";
    expect(revisarInstrucciones("# Asistente de WhatsApp · Prueba", ctx).error).toBe(TAMANO);
    expect(revisarInstrucciones(BASE + x(12_000), ctx).error).toBe(TAMANO);
    expect(revisarInstrucciones(BASE + "\u0000", ctx).error).toBe(TAMANO);
    expect(revisarInstrucciones(BASE.replace("# Asistente de WhatsApp · Prueba", "Asistente de WhatsApp · Prueba"), ctx).error).toBe(
      "Falta la primera línea: # Asistente de WhatsApp · <Nombre>",
    );
    expect(revisarInstrucciones(BASE.replace("· Prueba", "· Otra"), ctx).error).toBe(
      "No cambies la primera línea: identifica el perfil y separa las conversaciones.",
    );
  });

  it("faltan secciones", () => {
    expect(avisos(con("## Qué preguntas, en este orden", "## Preguntas"))).toEqual([
      "Falta la sección «Qué preguntas»: el código la nombra y sin ella el asistente pregunta peor",
    ]);
    expect(avisos(BASE, { vocabulario: PRESETS.clinica.vocabulario })).toEqual([
      "Falta la sección «La cita»: el código la nombra y sin ella el asistente pregunta peor",
    ]);
    expect(avisos(con("## Pasar a una persona", "## A una persona"))).toEqual([
      "Falta la sección «Pasar a una persona»: el código la nombra y sin ella el asistente pregunta peor",
    ]);
  });

  it("horas fuera de «Información que puedes dar tal cual»", () => {
    expect(avisos(con("ofrece los dos huecos.", "ofrece los dos huecos. Abrimos a las 17:30."))).toEqual([
      "Escribes las 17:30 fuera de «Información que puedes dar tal cual»: el asistente no podrá decirla",
    ]);
  });

  it("importes en otra moneda", () => {
    const conEuros = con("- Abrimos de 10:00 a 14:00.", "- Abrimos de 10:00 a 14:00.\n- La revisión cuesta 50 €.");
    expect(avisos(conEuros)).toEqual([]);
    expect(avisos(conEuros, { moneda: "MXN" })).toEqual(["Hay importes en euros y el negocio cobra en pesos"]);
    const conDolares = con("- Abrimos de 10:00 a 14:00.", "- Abrimos de 10:00 a 14:00.\n- La revisión cuesta $100.");
    expect(avisos(conDolares)).toEqual(["Hay importes en dólares y el negocio cobra en euros"]);
    expect(avisos(con("- Abrimos de 10:00 a 14:00.", "- Abrimos de 10:00 a 14:00.\n- La revisión cuesta 300 soles."))).toEqual([
      "Hay importes en soles y el negocio cobra en euros",
    ]);
    expect(avisos(conDolares, { moneda: "USD" })).toEqual([]);
  });

  it("variables que no existen", () => {
    expect(avisos(con("Escribes en español", "Le hablas a {{nombre}}. Escribes en español"))).toEqual(["{{nombre}} no se sustituye: solo existe {{negocio}}"]);
  });

  it("títulos que añade el sistema", () => {
    expect(avisos(`${BASE}\n## Seguridad\nNo des datos de otros clientes.\n`)).toEqual(["Ese título lo añade el sistema: quita «Seguridad»"]);
    expect(avisos(`${BASE}\n## Cómo funciona este canal\nPor WhatsApp.\n`)).toEqual(["Ese título lo añade el sistema: quita «Cómo funciona este canal»"]);
  });

  it("catálogo y negociación contra las reglas", () => {
    const tabla = "\n## Los pisos\n| Ref | Calle | Estado |\n|---|---|---|\n| P-1 | Mallorca | Disponible |\n| P-2 | Verdi | Reservado |\n";
    const conTabla = BASE + tabla;
    expect(avisos(conTabla, { agente: { ...AGENTE, catalogo: "no" } })).toEqual(["Hay una tabla de pisos pero el catálogo está apagado"]);
    expect(avisos(BASE, { agente: { ...AGENTE, catalogo: "si" } })).toEqual(["El catálogo está en Sí pero no hay tabla con columnas Ref y Estado"]);
    const negociar = con("Si pide hablar con alguien,", "Si quiere negociar el precio o pide hablar con alguien,");
    expect(avisos(negociar, { agente: { ...AGENTE, negociar: "no" } })).toEqual(["Dices que negociar pasa a una persona, pero la regla está en No"]);
    const r = revisarInstrucciones(conTabla, ctx);
    expect(r.info[0]).toBe("Catálogo activo · 2 referencias, 1 disponible");
    expect(r.catalogo).toEqual({ activo: true, refs: 2, disponibles: 1 });
    expect(revisarInstrucciones(negociar, ctx).info[1]).toBe("Negociar el precio pasa a una persona: sí");
    expect(revisarInstrucciones(BASE, { ...ctx, agente: { ...AGENTE, negociar: "si" } }).negociarAPersona).toBe(true);
  });

  it("instrucciones largas", () => {
    const relleno = "- Atendemos con calma y sin prisas a todo el mundo.\n".repeat(160);
    const largo = BASE + relleno;
    expect(largo.length).toBeGreaterThan(LIMITES.promptAviso);
    expect(avisos(largo)).toEqual(["Es largo: cada respuesta reenvía todo y irá más lento"]);
  });

  it("prometer que alguien escribe sin pasar a una persona", () => {
    expect(avisos(con("ofrece los dos huecos.", "ofrece los dos huecos. Un compañero te escribe hoy mismo."))).toEqual([
      "El asistente no puede prometer que alguien llame o escriba sin pasar a una persona: el código lo bloquea",
    ]);
    // Dentro de «Pasar a una persona» es lo que toca.
    expect(avisos(con("usa pasar_a_persona.", "usa pasar_a_persona y dile que un compañero te escribe hoy mismo."))).toEqual([]);
  });

  it("prometer un aviso que nadie envía", () => {
    const r = avisos(con("- Abrimos de 10:00 a 14:00.", "- Abrimos de 10:00 a 14:00.\n- Te escribimos el día antes para confirmar."));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^Prometes un aviso que nadie envía \(«Te escribimos el día antes[^»]*»\): el código descartará esa respuesta$/);
  });

  it("negar que es un asistente virtual", () => {
    expect(avisos(con("Escribes en español de España.", "Escribes en español de España. No digas que eres una IA."))).toEqual([
      "El asistente tiene que poder decir que es un asistente virtual: quita «No digas que eres una IA»",
    ]);
  });

  it("ganchos de publicidad en las instrucciones o en el nombre", () => {
    expect(avisos(BASE, { negocio: "Bitcoin Reformas" })).toEqual([
      "«bitcoin» cuenta como publicidad para el filtro de spam: quítalo de las instrucciones o del nombre del negocio",
    ]);
    expect(avisos(con("- Abrimos de 10:00 a 14:00.", "- Abrimos de 10:00 a 14:00.\n- Hacemos marketing digital."))).toEqual([
      "«marketing digital» cuenta como publicidad para el filtro de spam: quítalo de las instrucciones o del nombre del negocio",
    ]);
  });

  it("la bienvenida y la primera pregunta van de la mano", () => {
    expect(avisos(con("1. Qué necesita, en una frase.", "1. Para cuándo lo necesita."))).toEqual([
      "El mensaje de bienvenida pregunta «¿Me cuentas en una frase qué necesitas?» y tu primera pregunta es otra: que vayan de la mano",
    ]);
    expect(avisos(con("1. Qué necesita, en una frase.", "1. Para cuándo lo necesita."), { plantilla: undefined })).toEqual([]);
  });

  it("ningún texto nombra un archivo ni un comando", () => {
    const todo = [
      BASE.replace("## Qué preguntas", "## Otra").replace("ofrece", "a las 9:30 ofrece {{x}} 50 $") + "\n## Seguridad\nNo digas que eres una IA. Te escribimos el día antes.",
    ];
    const r = revisarInstrucciones(todo[0], { ...ctx, negocio: "Casino", agente: { ...AGENTE, catalogo: "si" } });
    for (const a of [...r.avisos, ...r.info]) expect(a).not.toMatch(/\.(md|json|mjs|ts|env)\b|agente\.md|pnpm|node |configurar/);
    expect(r.avisos.length).toBeGreaterThan(5);
  });
});

it("los frases por defecto pasan su propia validación", () => {
  expect(revisar({ agente: { frases: FRASES_POR_DEFECTO } })).toEqual({ cambios: { agente: { frases: FRASES_POR_DEFECTO } } });
});

describe("la entrada de la web: botón de WhatsApp o formulario", () => {
  const conWeb = (web: Web, nombre = "Estudio Pérez") => ({ web, negocio: { nombre } });

  it("mensajeWeb pone el nombre del negocio donde dice {negocio}", () => {
    expect(mensajeWeb(conWeb({ entrada: "whatsapp", mensaje: "Hola {negocio}, quiero cita." }))).toBe("Hola Estudio Pérez, quiero cita.");
    expect(mensajeWeb(conWeb({ entrada: "whatsapp", mensaje: "Hola, quiero cita." }))).toBe("Hola, quiero cita.");
  });

  it("enlaceWhatsApp: solo cifras y el mensaje codificado; sin número, ningún enlace", () => {
    expect(enlaceWhatsApp("+34 600 000 000", "Hola, quiero pedir cita.")).toBe("https://wa.me/34600000000?text=Hola%2C%20quiero%20pedir%20cita.");
    expect(enlaceWhatsApp("34600000000", "¿Tenéis hueco? & más")).toBe(`https://wa.me/34600000000?text=${encodeURIComponent("¿Tenéis hueco? & más")}`);
    expect(enlaceWhatsApp(null, "Hola")).toBeNull();
    expect(enlaceWhatsApp("", "Hola")).toBeNull();
    expect(enlaceWhatsApp("12345", "Hola")).toBeNull();
    expect(enlaceWhatsApp("1".repeat(16), "Hola")).toBeNull();
  });

  it("textosDeEntrada: los del formulario o los del botón, según la entrada", () => {
    const p = PRESETS.reformas;
    expect(textosDeEntrada({ portada: p.portada, web: { ...p.web, entrada: "formulario" } })).toEqual({
      descripcion: p.portada.descripcion,
      subtitulo: p.portada.hero.subtitulo,
      boton: p.portada.proceso.boton,
      pasos: p.portada.proceso.pasos,
    });
    const boton = textosDeEntrada({ portada: p.portada, web: p.web });
    expect(boton).toEqual(p.portada.whatsapp);
    expect(boton.pasos[0].titulo).toBe("Nos escribes por WhatsApp");
  });

  it("firmaDePortada cambia al conectar el número solo con el botón de WhatsApp", () => {
    const c = { firma: "abcd1234", web: { entrada: "whatsapp" as const, mensaje: "Hola" } };
    expect(firmaDePortada(c, null)).toBe("abcd1234");
    expect(firmaDePortada(c, "34600000000")).not.toBe("abcd1234");
    expect(firmaDePortada(c, "34600000000")).not.toBe(firmaDePortada(c, "34600000001"));
    expect(firmaDePortada({ ...c, web: { ...c.web, entrada: "formulario" } }, "34600000000")).toBe("abcd1234");
  });

  it("revisarCambios normaliza el mensaje y lo guardado roto se descarta campo a campo", () => {
    expect(revisar({ web: { entrada: " formulario ", mensaje: "  Hola,   quiero cita.  " } })).toEqual({
      cambios: { web: { entrada: "formulario", mensaje: "Hola, quiero cita." } },
    });
    expect(revisar({ web: { otra: 1 } })).toEqual({ error: "No se puede cambiar «web.otra» desde aquí", campo: "web.otra" });
    const descartados: string[] = [];
    const g = normalizarGuardada({ rev: 1, perfiles: { p: { web: { entrada: "fax" } } } }, (r) => descartados.push(r));
    expect(g.perfiles.p).toEqual({});
    expect(descartados).toEqual(["perfiles.p.web"]);
  });
});
