// Adapta el CRM desde la terminal, hablando con el CRM en marcha (lo usa Claude Code). Nunca imprime
// una clave: solo lee PUERTO y APP_URL para saber dónde está el CRM.
//
//   node scripts/configurar.mjs --ver
//   node scripts/configurar.mjs --sector reformas|inmobiliaria|clinica [--ejemplos sustituir|borrar]
//   node scripts/configurar.mjs --comprobar negocios/x.json
//   node scripts/configurar.mjs --aplicar negocios/x.json [--ejemplos sustituir|borrar]
//   node scripts/configurar.mjs --exportar x.json
//   node scripts/configurar.mjs --restablecer [todo]
//
// Con --url http://localhost:8107 habla con otro CRM (sin --url: APP_URL o http://localhost:PUERTO).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });

const USO = [
  "Uso: node scripts/configurar.mjs [--url http://localhost:<puerto>] <acción>",
  "  --ver                                     cómo está configurado el CRM",
  "  --sector reformas|inmobiliaria|clinica     cambia de tipo de negocio [--ejemplos sustituir|borrar]",
  "  --comprobar negocios/x.json               revisa un archivo de negocio sin guardar nada",
  "  --aplicar negocios/x.json                 aplica un negocio propio [--ejemplos sustituir|borrar]",
  "  --exportar x.json                         guarda el negocio activo en un archivo",
  "  --restablecer [todo]                      vuelve a la configuración de partida",
];

const ESTADOS_PLANTILLA = {
  APROBADA: "aprobado",
  EN_REVISION: "en revisión",
  RECHAZADA: "rechazado",
  PAUSADA: "en pausa",
  NO_EXISTE: "no está en Meta",
  SIN_CLAVES: "faltan las claves de WhatsApp",
  ERROR: "no se ha podido comprobar",
};

function salir(lineas, codigo = 1) {
  for (const l of [].concat(lineas)) console.log(l);
  process.exit(codigo);
}

const args = process.argv.slice(2);

/** El valor que va detrás de una opción, o undefined. */
function valor(opcion) {
  const i = args.indexOf(opcion);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? null : v;
}

const urlArg = valor("--url");
if (urlArg === null) salir(USO);
const BASE = (urlArg ?? process.env.APP_URL ?? `http://localhost:${process.env.PUERTO || 8000}`).replace(/\/+$/, "");

async function pedir(ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
  } catch {
    salir(`El CRM no está en marcha en ${BASE}. Ábrelo primero (bash arrancar.sh o el icono «Abrir CRM»).`);
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    salir(datos && typeof datos.error === "string" ? datos.error : `El CRM ha respondido ${respuesta.status}`);
  }
  return datos;
}

function ejemplosArg() {
  const e = valor("--ejemplos");
  if (e === undefined) return {};
  if (e !== "sustituir" && e !== "borrar") salir("--ejemplos va con sustituir o borrar");
  return { ejemplos: e };
}

function leerArchivo(ruta) {
  try {
    return JSON.parse(readFileSync(path.resolve(ruta), "utf8"));
  } catch (e) {
    salir(e && e.code === "ENOENT" ? `No existe ${ruta}` : `${ruta} no es un JSON válido`);
  }
}

function etiquetaDe(datos) {
  const a = datos.activa;
  const fila = datos.sectores.find((s) => s.id === a.sector);
  if (fila) return fila.etiqueta;
  const base = datos.sectores.find((s) => s.id === a.base);
  return `propio, sobre ${base ? base.etiqueta : a.base}`;
}

/** Cómo te escriben desde la web: el botón de WhatsApp (lo normal) o el formulario. */
function textoWeb(a) {
  if (a.web?.entrada === "formulario") return "Tu web: formulario (necesita el mensaje de bienvenida aprobado por Meta)";
  const mensaje = String(a.web?.mensaje ?? "").split("{negocio}").join(a.negocio.nombre);
  return `Tu web: botón de WhatsApp, con «${mensaje}» (no hace falta ningún mensaje aprobado)`;
}

async function ver() {
  const d = await pedir("/api/configuracion");
  const a = d.activa;
  const de = d.ejemplos.de ? ` · de ${d.ejemplos.de}` : "";
  console.log(`CRM en ${BASE}`);
  console.log(`Tipo de negocio: ${etiquetaDe(d)} (${a.negocio.nombre})`);
  console.log(`Perfil: ${a.perfil.id}`);
  console.log(textoWeb(a));
  if (a.web?.entrada === "formulario") console.log(`Mensaje de bienvenida: ${a.plantilla.nombre} (${a.plantilla.idioma})`);
  console.log(`Clientes de ejemplo: ${d.ejemplos.ejemplo} · reales: ${d.ejemplos.reales}${de}`);
}

async function sector(id) {
  if (!["reformas", "inmobiliaria", "clinica"].includes(id)) salir("--sector va con reformas, inmobiliaria o clinica");
  const r = await pedir("/api/configuracion/sector", { destino: { sector: id }, ...ejemplosArg() });
  const etiqueta = { reformas: "Reformas", inmobiliaria: "Inmobiliaria", clinica: "Clínica" }[id];
  console.log(`Listo: ahora el CRM es de ${etiqueta}`);
  for (const aviso of r.avisos ?? []) console.log(aviso);
}

async function comprobar(ruta) {
  const r = await pedir("/api/configuracion", { comprobar: leerArchivo(ruta) });
  if (r.errores.length === 0) console.log("Sin errores");
  for (const e of r.errores) console.log(`${e.campo}: ${e.error}`);
  for (const aviso of r.avisos) console.log(`Aviso: ${aviso}`);
  if (r.errores.length > 0) process.exit(1);
}

async function aplicar(ruta) {
  const archivo = leerArchivo(ruta);
  const nuevo = {
    nombre: archivo.nombre,
    base: archivo.base,
    sustituir: true,
    ...(archivo.configuracion !== undefined ? { configuracion: archivo.configuracion } : {}),
    ...(archivo.instrucciones !== undefined ? { instrucciones: archivo.instrucciones } : {}),
  };
  const r = await pedir("/api/configuracion/sector", { destino: { nuevo }, ...ejemplosArg() });
  console.log(`Listo: ahora el CRM es de ${r.activa.negocio.nombre}`);
  for (const aviso of r.avisos ?? []) console.log(aviso);
  console.log(textoWeb(r.activa));
  // Con el botón de WhatsApp el cliente escribe primero: la bienvenida no hace falta.
  if (r.activa.web?.entrada !== "formulario") return;

  const p = r.activa.plantilla;
  let fila = null;
  try {
    const respuesta = await fetch(`${BASE}/api/meta/plantillas`);
    const datos = await respuesta.json().catch(() => null);
    fila = Array.isArray(datos?.plantillas) ? (datos.plantillas.find((x) => x.id === "bienvenida") ?? null) : null;
  } catch {
    fila = null;
  }
  const estado = fila ? (ESTADOS_PLANTILLA[fila.estado] ?? fila.estado) : ESTADOS_PLANTILLA.ERROR;
  console.log(`Mensaje de bienvenida: ${fila?.nombre ?? p.nombre} (${fila?.idioma ?? p.idioma}) · ${estado}`);
  console.log(fila?.texto ?? p.texto);
  if (fila?.estado !== "APROBADA") console.log("Si no está aprobado: Ajustes → Conexiones → «Enviar a Meta para aprobar»");
}

async function exportar(ruta) {
  let respuesta;
  try {
    respuesta = await fetch(`${BASE}/api/configuracion/exportar`);
  } catch {
    salir(`El CRM no está en marcha en ${BASE}. Ábrelo primero (bash arrancar.sh o el icono «Abrir CRM»).`);
  }
  const texto = await respuesta.text();
  if (!respuesta.ok) {
    let error = `El CRM ha respondido ${respuesta.status}`;
    try {
      error = JSON.parse(texto).error ?? error;
    } catch {}
    salir(error);
  }
  const destino = path.resolve(ruta);
  writeFileSync(destino, texto);
  console.log(`Guardado en ${destino}`);
}

async function restablecer(todo) {
  await pedir("/api/configuracion", { restablecer: todo ? "todo" : "perfil" });
  console.log(todo ? "Configuración restablecida de todos los negocios; tus clientes no se tocan" : "Configuración restablecida");
}

if (args.includes("--ver")) await ver();
else if (valor("--sector") !== undefined) {
  const id = valor("--sector");
  if (!id) salir(USO);
  await sector(id);
} else if (valor("--comprobar") !== undefined) {
  const ruta = valor("--comprobar");
  if (!ruta) salir(USO);
  await comprobar(ruta);
} else if (valor("--aplicar") !== undefined) {
  const ruta = valor("--aplicar");
  if (!ruta) salir(USO);
  await aplicar(ruta);
} else if (valor("--exportar") !== undefined) {
  const ruta = valor("--exportar");
  if (!ruta) salir(USO);
  await exportar(ruta);
} else if (args.includes("--restablecer")) await restablecer(valor("--restablecer") === "todo");
else salir(USO);
