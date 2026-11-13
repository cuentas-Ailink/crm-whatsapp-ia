// Lista de OK / AVISO / ERROR de tu CRM abierto. Cada ERROR dice qué hacer.
// Quien comprueba es el propio CRM (Ajustes → Conexiones): este script solo le pregunta y lo escribe.
// Nunca lee ni imprime una clave.
//
//   bash comprobar.sh                       comprueba el CRM de este ordenador, no cambia nada
//   bash comprobar.sh --arreglar            además pulsa «Arreglar» en lo que se puede arreglar solo
//   bash comprobar.sh --url <dirección>     comprueba el CRM de otra dirección

import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

const argumentos = process.argv.slice(2);
const arreglar = argumentos.includes("--arreglar");
const posicionUrl = argumentos.indexOf("--url");
let url = posicionUrl >= 0 ? argumentos[posicionUrl + 1] : undefined;
if (!url) {
  // Solo para saber el puerto: el CRM lee lo demás.
  nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
  url = `http://localhost:${process.env.PUERTO || "8000"}`;
}
url = url.replace(/\/+$/, "");
const TIEMPO_MS = 60_000;

let errores = 0;

function escribir(ok, texto, solucion) {
  if (ok === true) console.log(`\x1b[32mOK\x1b[0m     ${texto}`);
  else if (ok === null) console.log(`\x1b[33mAVISO\x1b[0m  ${texto}`);
  else {
    errores++;
    console.log(`\x1b[31mERROR\x1b[0m  ${texto}`);
  }
  if (solucion) console.log(`       → ${solucion}`);
}

/** La respuesta en JSON, o { status: 0 } si nadie contesta. */
async function pedir(ruta, opciones = {}) {
  try {
    const respuesta = await fetch(`${url}${ruta}`, { signal: AbortSignal.timeout(TIEMPO_MS), ...opciones });
    const datos = await respuesta.json().catch(() => null);
    return { status: respuesta.status, datos };
  } catch {
    return { status: 0, datos: null };
  }
}

/** Pide la lista completa y la escribe. Devuelve el estado, o null si no se ha podido leer. */
async function comprobarTodo() {
  const r = await pedir("/api/sistema?completo=1");
  if (r.status === 0) {
    escribir(false, `El CRM no está abierto en ${url}`, "Ábrelo con «Abrir CRM» (o bash arrancar.sh) y vuelve a probar");
    return null;
  }
  if (r.status !== 200 || !Array.isArray(r.datos?.comprobaciones)) {
    escribir(false, r.datos?.error ? `El CRM ha contestado: ${r.datos.error}` : `El CRM ha contestado ${r.status}`);
    return null;
  }
  for (const c of r.datos.comprobaciones) escribir(c.ok, c.texto, c.solucion);
  return r.datos;
}

console.log(`Comprobando tu CRM en ${url}…\n`);
let estado = await comprobarTodo();

// Una fila enseña un arreglo cada vez (primero escuchar la cuenta, luego apuntar el webhook): tras
// cada uno se mira la respuesta por si aparece otro. Ninguno se intenta dos veces.
if (arreglar && estado) {
  const hechos = new Set();
  let filas = estado.filas ?? [];
  for (;;) {
    const fila = filas.find((f) => f.accion?.arreglar && !hechos.has(f.accion.arreglar));
    if (!fila) break;
    hechos.add(fila.accion.arreglar);
    console.log(`\nArreglando: ${fila.nombre}…`);
    const r = await pedir("/api/sistema/arreglar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ que: fila.accion.arreglar }),
    });
    if (!Array.isArray(r.datos?.filas)) break;
    filas = r.datos.filas;
  }
  if (hechos.size > 0) {
    console.log("");
    errores = 0;
    estado = await comprobarTodo();
  }
}

// Solo en el Mac: si no está enchufado, puede dormirse con el CRM abierto.
if (process.platform === "darwin") {
  const bateria = spawnSync("pmset", ["-g", "batt"], { encoding: "utf8" });
  if (bateria.stdout?.includes("AC Power")) escribir(true, "El Mac está enchufado");
  else escribir(null, "El Mac no está enchufado: podría dormirse con el CRM en marcha", "Enchúfalo");
}

console.log(
  errores === 0
    ? "\n\x1b[32mTodo en OK\x1b[0m"
    : `\n\x1b[31m${errores} ERROR\x1b[0m: arréglalos en Ajustes → Conexiones y vuelve a ejecutar: bash comprobar.sh`,
);
process.exit(errores === 0 ? 0 : 1);
