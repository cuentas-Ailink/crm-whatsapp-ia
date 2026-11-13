// Abre el CRM y lo deja en marcha hasta Ctrl+C. El túnel lo abre la propia app al arrancar
// (instrumentation.ts), y su línea «Túnel activo: …/webhook» sale aquí como las demás.
// La terminal solo enseña líneas `HH:MM:SS  mensaje`, porque puede verse si compartes pantalla.
// Lo demás va a logs/. No se hace `source .env`: `NOMBRE_NEGOCIO=Estudio de reformas` ejecutaría `de`.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import nextEnv from "@next/env";

// Sin .env se copia el de ejemplo y se sigue: las claves se pegan en el CRM.
if (!existsSync(".env") && !existsSync(".env.local") && existsSync(".env.example")) copyFileSync(".env.example", ".env");
if (!existsSync("agente.md")) copyFileSync("perfiles/reformas.md", "agente.md");

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const PUERTO = process.env.PUERTO || "8000";
const LOCAL = `http://localhost:${PUERTO}`;
const PANEL = `${LOCAL}/panel`;
const ESPERA_CIERRE_MS = 1_500;
// Para probar este script sin que se abran ventanas.
const SIN_NAVEGADOR = process.env.SIN_NAVEGADOR === "1";

// La hora de este ordenador, como lib/log.ts.
function hora() {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
}
const log = (texto) => console.log(`${hora()}  ${texto}`);
const logRojo = (texto) => console.log(`\x1b[31m${hora()}  ${texto}\x1b[0m`);

function abrirEnNavegador(url) {
  if (SIN_NAVEGADOR) return;
  if (process.platform === "darwin") {
    const conChrome = spawnSync("open", ["-a", "Google Chrome", url]);
    if (conChrome.status !== 0) spawnSync("open", [url]);
  } else if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", url]);
  } else {
    spawnSync("xdg-open", [url]);
  }
}

// ---- ¿Ya estaba abierto? ----

/** «crm» si en el puerto contesta este CRM, «otro» si contesta otra cosa, «libre» si no contesta nadie. */
async function quienContesta() {
  try {
    const respuesta = await fetch(`http://127.0.0.1:${PUERTO}/api/estado`, { signal: AbortSignal.timeout(5_000) });
    const datos = await respuesta.json().catch(() => null);
    const esCrm =
      datos !== null && typeof datos === "object" && !Array.isArray(datos) && Object.keys(datos)[0] === "bd" && typeof datos.pruebas === "boolean";
    return esCrm ? "crm" : "otro";
  } catch (error) {
    return error?.cause?.code === "ECONNREFUSED" ? "libre" : "otro";
  }
}

const enElPuerto = await quienContesta();
if (enElPuerto === "crm") {
  log("Ya estaba abierto");
  abrirEnNavegador(PANEL);
  process.exit(0);
}
if (enElPuerto === "otro") {
  logRojo(`El puerto ${PUERTO} ya está en uso por otro programa: ciérralo o cambia PUERTO en .env.`);
  process.exit(1);
}

// ---- Compilación, si falta o el código es más nuevo ----

mkdirSync("logs", { recursive: true });

const CARPETAS_CODIGO = ["app", "lib", "cliente", "perfiles"];
const ARCHIVOS_CODIGO = ["proxy.ts", "instrumentation.ts", "next.config.ts", "package.json"];

function masNuevo(ruta, limite) {
  let info;
  try {
    info = statSync(ruta);
  } catch {
    return false;
  }
  if (!info.isDirectory()) return info.mtimeMs > limite;
  return readdirSync(ruta).some((nombre) => masNuevo(path.join(ruta, nombre), limite));
}

function hayQueCompilar() {
  if (!existsSync(".next/BUILD_ID")) return true;
  const compilado = statSync(".next/BUILD_ID").mtimeMs;
  return [...CARPETAS_CODIGO, ...ARCHIVOS_CODIGO].some((ruta) => masNuevo(ruta, compilado));
}

if (hayQueCompilar()) {
  log("Preparando la aplicación, tarda menos de un minuto…");
  const registro = openSync("logs/instalacion.log", "a");
  const compilacion = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { stdio: ["ignore", registro, registro] });
  if (compilacion.status !== 0) {
    logRojo("No se ha podido preparar la aplicación. El detalle está en logs/instalacion.log: pégaselo a Claude Code para que te ayude.");
    process.exit(1);
  }
}

// ---- Servidor ----

const hijos = new Set();
let cerrando = false;

function cerrar(codigo = 0) {
  if (cerrando) return;
  cerrando = true;
  for (const hijo of hijos) hijo.kill("SIGTERM");
  log("CRM parado");
  // Next espera a las peticiones en curso: si alguna se alarga, se cierra igualmente.
  setTimeout(() => {
    for (const hijo of hijos) hijo.kill("SIGKILL");
    process.exit(codigo);
  }, ESPERA_CIERRE_MS);
}
process.on("SIGINT", () => cerrar());
process.on("SIGTERM", () => cerrar());

const registroServidor = createWriteStream("logs/servidor.log", { flags: "a" });
const servidor = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", PUERTO, "-H", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
});
hijos.add(servidor);

createInterface({ input: servidor.stdout }).on("line", (linea) => {
  registroServidor.write(`${linea}\n`);
  // Las líneas de lib/log.ts empiezan por la hora, con o sin color.
  if (/^(\x1b\[\d+m)?\d\d:\d\d:\d\d {2}/.test(linea)) console.log(linea);
});
createInterface({ input: servidor.stderr }).on("line", (linea) => {
  registroServidor.write(`${linea}\n`);
  if (/address already in use|EADDRINUSE/i.test(linea)) {
    logRojo(`El puerto ${PUERTO} ya está en uso: cierra la otra copia del CRM o cambia PUERTO en .env.`);
    cerrar(1);
  }
});
servidor.on("exit", (codigo) => {
  hijos.delete(servidor);
  if (!cerrando) {
    logRojo(`El servidor se ha parado (código ${codigo}). Detalle en logs/servidor.log`);
    cerrar(1);
  }
});

async function esperarServidor() {
  for (let intento = 0; intento < 120; intento++) {
    if (cerrando) return null;
    try {
      const r = await fetch(`${LOCAL}/api/estado`, { signal: AbortSignal.timeout(5_000) });
      if (r.ok) return await r.json();
    } catch {
      // Aún arrancando.
    }
    await new Promise((resolver) => setTimeout(resolver, 500));
  }
  return null;
}

const TIPOS = { reformas: "Reformas", inmobiliaria: "Inmobiliaria", clinica: "Clínica" };

const estado = await esperarServidor();
if (estado) {
  log(`Tu CRM está abierto: ${PANEL}`);
  const configuracion = estado.configuracion;
  if (configuracion) log(`Tipo de negocio: ${TIPOS[configuracion.sector] ?? "Otro"} (${configuracion.negocio?.nombre ?? ""})`);
  // Promesas de plazos que el CRM no cumple solo. Se busca con espacios flexibles.
  const instrucciones = existsSync("agente.md") ? readFileSync("agente.md", "utf8") : "";
  if (/día\s+antes|hoy\s+mismo/i.test(instrucciones)) {
    logRojo("Tu agente.md promete avisos o plazos que nadie cumple: actualízalo en Ajustes → Avanzado → Instrucciones completas del asistente");
  }
  abrirEnNavegador(PANEL);

  // Que el Mac no se duerma mientras el CRM esté en marcha.
  if (process.platform === "darwin") {
    spawn("caffeinate", ["-dims", "-w", String(process.pid)], { stdio: "ignore" }).on("error", () => {});
  }
} else if (!cerrando) {
  logRojo("El servidor no responde. Detalle en logs/servidor.log");
  cerrar(1);
}
