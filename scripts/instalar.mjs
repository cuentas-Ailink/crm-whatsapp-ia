// Segunda parte de instalar.sh, ya con Node.js y las piezas instaladas. No escribe nada en pantalla
// salvo si falla: la terminal de la instalación solo enseña sus cuatro líneas.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, openSync } from "node:fs";

// .env y agente.md solo se crean si faltan: nunca se pisa lo que ya exista. Las claves se pegan en el CRM.
if (!existsSync(".env") && !existsSync(".env.local")) copyFileSync(".env.example", ".env");
if (!existsSync("agente.md")) copyFileSync("perfiles/reformas.md", "agente.md");

// La compilación escribe en el registro, que se va sumando entre instalaciones.
mkdirSync("logs", { recursive: true });
const registro = openSync("logs/instalacion.log", "a");
const compilacion = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  stdio: ["ignore", registro, registro],
});
if (compilacion.status !== 0) {
  console.log(
    "\x1b[31m✗ No se ha podido preparar la aplicación. El detalle está en logs/instalacion.log: pégaselo a Claude Code para que te ayude.\x1b[0m",
  );
  process.exit(1);
}
