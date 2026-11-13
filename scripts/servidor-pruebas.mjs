// Arranca la app con la configuración de .env.pruebas.example en vez de .env: las variables
// del entorno tienen prioridad sobre las de los archivos .env.
//
//   node scripts/servidor-pruebas.mjs         next start en el puerto 8000, como arrancar.sh
//   node scripts/servidor-pruebas.mjs dev     next dev en el puerto 8001, para retocar la interfaz
//   node scripts/servidor-pruebas.mjs claude  Claude y la transcripción reales, con las claves de .env, y Meta simulada
//   node scripts/servidor-pruebas.mjs claude --modelo=claude-sonnet-5-5   lo mismo con otro modelo
//   node scripts/servidor-pruebas.mjs nuevo   una instalación recién hecha: sin datos ni claves (bd-pruebas/nuevo)
//   node scripts/servidor-pruebas.mjs nuevo --conservar   lo mismo, sin borrar lo que ya había en bd-pruebas/nuevo
//   node scripts/servidor-pruebas.mjs --servidor crm.prueba.test   modo servidor (CRM_DOMINIO) con next start:
//       contraseña del panel, superficie pública y freno del formulario. Empieza siempre de cero
//       (borra bd-pruebas/servidor-dominio: sin contraseña ni clientes), con un SESION_SECRETO nuevo
//       en cada arranque y el código de alta «codigo-de-prueba». Sin CRM_URL_PUBLICA. Lo prueba
//       scripts/probar-servidor.mjs.
//
// Variables:
//   PUERTO_PRUEBAS       puerto del servidor (por defecto, PUERTO de .env.pruebas.example: 8000)
//   PUERTO_PRUEBAS_DEV   puerto del modo dev (por defecto, 8001)
//   PUERTO_SIMULADOR     puerto del simulador (por defecto, 8099): cambia 127.0.0.1:8099 en las *_BASE_URL
//
// Cada modo tiene su base de datos en bd-pruebas/<modo> y su archivo de claves en
// bd-pruebas/<modo>/claves.env (ARCHIVO_CLAVES): si existe, sus valores ganan a los del ejemplo.
// CRM_URL_PUBLICA apunta al propio servidor, así que nunca se abre un túnel.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

// --servidor <dominio>: el modo servidor. Va solo, sin dev, claude ni nuevo.
const posicionServidor = process.argv.indexOf("--servidor");
const dominio = posicionServidor >= 0 ? (process.argv[posicionServidor + 1] ?? "").trim().toLowerCase() : null;
const modo = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
if (dominio !== null) {
  if (modo === "dev") {
    console.error("--servidor solo funciona con next start");
    process.exit(1);
  }
  if (modo !== undefined) {
    console.error(`--servidor solo funciona con el modo normal (next start), no con «${modo}»`);
    process.exit(1);
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(dominio)) {
    console.error("Uso: node scripts/servidor-pruebas.mjs --servidor <dominio>, por ejemplo --servidor crm.prueba.test");
    process.exit(1);
  }
}
const SOLO_DE_ENV =
  modo === "claude"
    ? ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "MODELO", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "TRANSCRIPCION_BASE_URL", "TRANSCRIPCION_MODELO"]
    : [];

const entorno = { ...process.env };
for (const linea of readFileSync(".env.pruebas.example", "utf8").split(/\r?\n/)) {
  const coincidencia = linea.match(/^([A-Z_]+)=(.*)$/);
  if (coincidencia && !SOLO_DE_ENV.includes(coincidencia[1])) entorno[coincidencia[1]] = coincidencia[2];
}

// Modo nuevo: ninguna clave ni dato del negocio. Se dejan vacías, no se borran: Next solo da
// prioridad al entorno del proceso sobre los archivos .env en las variables que están definidas,
// así que con "" ni la terminal ni un .env de la carpeta pueden colar una clave.
if (modo === "nuevo") {
  for (const nombre of [
    "ANTHROPIC_API_KEY",
    "WHATSAPP_TOKEN",
    "META_APP_SECRET",
    "NGROK_AUTHTOKEN",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "OPENAI_API_KEY",
    "WEBHOOK_VERIFY_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_BUSINESS_ACCOUNT_ID",
    "SESION_SECRETO",
    "CLAVE_PANEL_HASH",
    "CODIGO_ALTA",
    "NOMBRE_NEGOCIO",
    "PLANTILLA",
    "PLANTILLA_IDIOMA",
    "TELEFONO_COMERCIAL",
  ]) {
    entorno[nombre] = "";
  }
}

// Siempre su propio Postgres embebido, nunca el Supabase de .env. Uno por modo: PGlite no admite dos
// procesos con la misma carpeta, y dev y el servidor pueden estar en marcha a la vez.
entorno.BD_LOCAL = `${entorno.BD_LOCAL || "bd-pruebas"}/${dominio ? "servidor-dominio" : modo === "dev" ? "dev" : modo === "nuevo" ? "nuevo" : "servidor"}`;

// El modo servidor también empieza de cero: sin contraseña del panel y sin clientes. Solo esa carpeta.
if (dominio) {
  const carpeta = path.resolve(entorno.BD_LOCAL);
  if (carpeta !== path.join(process.cwd(), "bd-pruebas", "servidor-dominio")) {
    console.error(`Modo servidor: no se borra ${carpeta}. Solo se borra bd-pruebas/servidor-dominio dentro de esta carpeta.`);
    process.exit(1);
  }
  rmSync(carpeta, { recursive: true, force: true });
  console.log(`Modo servidor para ${dominio}: se empieza sin contraseña del panel ni clientes (bd-pruebas/servidor-dominio).`);
}

// El modo nuevo empieza de cero: borra su carpeta (base de datos y claves), y solo esa.
if (modo === "nuevo" && !process.argv.includes("--conservar")) {
  const carpeta = path.resolve(entorno.BD_LOCAL);
  if (carpeta !== path.join(process.cwd(), "bd-pruebas", "nuevo")) {
    console.error(`Modo nuevo: no se borra ${carpeta}. Solo se borra bd-pruebas/nuevo dentro de esta carpeta.`);
    process.exit(1);
  }
  rmSync(carpeta, { recursive: true, force: true });
  console.log("Modo nuevo: se empieza sin datos ni claves (bd-pruebas/nuevo).");
}

// Las claves que se pegan desde el panel. Se leen igual que @next/env lee las líneas que escribe
// lib/claves.ts, y ganan a las del ejemplo. Nunca se escribe un valor en la terminal.
entorno.ARCHIVO_CLAVES = path.resolve(entorno.BD_LOCAL, "claves.env");
if (existsSync(entorno.ARCHIVO_CLAVES)) {
  for (const linea of readFileSync(entorno.ARCHIVO_CLAVES, "utf8").split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith("#")) continue;
    const coincidencia = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!coincidencia) continue;
    const crudo = coincidencia[2];
    const entreComillas = crudo.match(/^"(.*)"\s*(?:#.*)?$/);
    entorno[coincidencia[1]] = entreComillas ? entreComillas[1].replace(/\\\$/g, "$") : crudo.replace(/\s+#.*$/, "").trim();
  }
}

// Con otro puerto para el simulador, las URL que apuntan a él cambian con él.
if (process.env.PUERTO_SIMULADOR) {
  for (const nombre of ["ANTHROPIC_BASE_URL", "GRAPH_BASE_URL", "TRANSCRIPCION_BASE_URL"]) {
    if (entorno[nombre]) entorno[nombre] = entorno[nombre].replace("127.0.0.1:8099", `127.0.0.1:${process.env.PUERTO_SIMULADOR}`);
  }
}

const puerto = modo === "dev" ? process.env.PUERTO_PRUEBAS_DEV || "8001" : process.env.PUERTO_PRUEBAS || entorno.PUERTO || "8000";
entorno.PUERTO = puerto;
if (dominio) {
  // Modo servidor: con CRM_DOMINIO no hay túnel y la URL pública es https://<dominio>. El secreto
  // de la sesión es nuevo en cada arranque y la contraseña se crea con el código de alta de prueba.
  // CLAVE_PANEL_HASH vacía, no borrada: así no la cuela un .env de la carpeta.
  entorno.CRM_DOMINIO = dominio;
  entorno.SESION_SECRETO = randomBytes(32).toString("base64url");
  entorno.CODIGO_ALTA = "codigo-de-prueba";
  entorno.CLAVE_PANEL_HASH = "";
  delete entorno.CRM_URL_PUBLICA;
} else {
  // Una URL pública propia: la app no abre ningún túnel y el webhook apunta aquí.
  entorno.CRM_URL_PUBLICA = `http://127.0.0.1:${puerto}`;
}

// --modelo=claude-sonnet-5-5 prueba otro modelo sin tocar .env.
const modelo = process.argv.find((a) => a.startsWith("--modelo="))?.split("=")[1];
if (modelo) entorno.MODELO = modelo;

// Sin agente.md (una carpeta recién clonada), las instrucciones de reformas.
if (!existsSync("agente.md")) {
  copyFileSync("perfiles/reformas.md", "agente.md");
  console.log("No había agente.md: se crea con las instrucciones de reformas (perfiles/reformas.md).");
}

const argumentos = [modo === "dev" ? "dev" : "start", "-p", puerto, "-H", "127.0.0.1"];
const hijo = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...argumentos], { env: entorno, stdio: "inherit" });
hijo.on("exit", (codigo) => process.exit(codigo ?? 0));

// Al parar este proceso se para también Next. «next start» espera a que se cierren las conexiones
// abiertas (un panel deja abierto /api/eventos) y mientras tanto sigue con la base de datos
// bloqueada: si en 3 s no ha acabado, se le obliga. Una segunda señal lo para al momento.
const ESPERA_PARADA_MS = 3_000;
let parando = false;
const sigueVivo = () => hijo.exitCode === null && hijo.signalCode === null;
function parar(senal) {
  if (!sigueVivo()) process.exit(0);
  if (parando) {
    hijo.kill("SIGKILL");
    return;
  }
  parando = true;
  hijo.kill(senal);
  setTimeout(() => {
    if (sigueVivo()) hijo.kill("SIGKILL");
  }, ESPERA_PARADA_MS);
}
for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => parar(senal));
process.on("exit", () => {
  if (sigueVivo()) hijo.kill("SIGKILL");
});
