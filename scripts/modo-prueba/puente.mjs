// El puente del modo prueba, un proceso aparte que arranca y para el propio CRM (lib/modo-prueba-puente.ts).
// Escucha solo en 127.0.0.1 y nunca se arranca a mano. Todo lo recibe del CRM por el entorno:
//
//   PUERTO_PUENTE                  su puerto (sale de PUERTO del CRM)
//   URL_WEBHOOK_MODO_PRUEBA        el webhook del CRM, en 127.0.0.1
//   ARCHIVO_MODO_PRUEBA            el archivo con el secreto de las firmas y la lista de números permitidos
//   DIR_SESION_MODO_PRUEBA         la sesión de WhatsApp (en la carpeta de datos; se borra al desvincular)
//   DIR_HERRAMIENTA_MODO_PRUEBA    donde el CRM instaló Baileys
//   PID_APP                        el CRM: si se cierra, el puente se cierra con él
//   MODO_PRUEBA_FALSO=1            el WhatsApp de mentira de las pruebas (solo con el servidor de pruebas)

import { readFileSync } from "node:fs";
import { crearConexionBaileys } from "./baileys.mjs";
import { crearConexionFalsa } from "./falso.mjs";
import { arrancarNucleo } from "./nucleo.mjs";

const VIGILAR_MS = 2_000;
const e = process.env;
const log = (texto) => {
  const hora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
  console.log(`\x1b[33m${hora}  [modo prueba] ${texto}\x1b[0m`);
};

const puerto = Number(e.PUERTO_PUENTE);
const pidApp = Number(e.PID_APP);
if (!Number.isInteger(puerto) || puerto <= 0 || !e.ARCHIVO_MODO_PRUEBA || !e.URL_WEBHOOK_MODO_PRUEBA || !e.DIR_SESION_MODO_PRUEBA) {
  log("Falta la configuración del puente: lo arranca el CRM, no se arranca a mano.");
  process.exit(1);
}

/** El secreto y la lista, leídos cada vez: el CRM los cambia sin reiniciar el puente. */
function leerConfig() {
  try {
    const datos = JSON.parse(readFileSync(e.ARCHIVO_MODO_PRUEBA, "utf8"));
    if (datos?.modo !== "prueba" || typeof datos.secreto !== "string") return null;
    return { secreto: datos.secreto, permitidos: Array.isArray(datos.permitidos) ? datos.permitidos.filter((p) => typeof p === "string") : [] };
  } catch {
    return null;
  }
}

let nucleo = null;
let saliendo = false;
async function salir(codigo = 0) {
  if (saliendo) return;
  saliendo = true;
  await nucleo?.cerrar().catch(() => undefined);
  process.exit(codigo);
}

try {
  nucleo = await arrancarNucleo({
    puerto,
    urlWebhook: e.URL_WEBHOOK_MODO_PRUEBA,
    leerConfig,
    log,
    alParar: () => void salir(0),
    crearConexion: (eventos) =>
      e.MODO_PRUEBA_FALSO === "1"
        ? crearConexionFalsa(eventos)
        : crearConexionBaileys(eventos, { carpeta: e.DIR_HERRAMIENTA_MODO_PRUEBA ?? "", sesion: e.DIR_SESION_MODO_PRUEBA, log }),
  });
} catch (error) {
  log(error?.code === "EADDRINUSE" ? `El puerto ${puerto} está ocupado: cierra lo que lo use y vuelve a abrir el CRM.` : `No se ha podido arrancar: ${error?.message ?? error}`);
  process.exit(1);
}

// Si el CRM se cierra (aunque sea de golpe), el puente se cierra con él.
setInterval(() => {
  if (!Number.isInteger(pidApp) || pidApp <= 0) return;
  try {
    process.kill(pidApp, 0);
  } catch (error) {
    if (error?.code !== "EPERM") void salir(0);
  }
}, VIGILAR_MS);

for (const senal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(senal, () => void salir(0));
