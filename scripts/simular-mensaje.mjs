// Manda al webhook un mensaje firmado, como si llegara de Meta. Para probar a mano sin móvil.
//
//   node scripts/simular-mensaje.mjs 34612345678 "Quiero reformar un baño"
//   node scripts/simular-mensaje.mjs 34612345678 --audio "Quiero reformar un baño"   nota de voz que «dice» eso
//   node scripts/simular-mensaje.mjs 34612345678 "Hola" --referral "Reforma tu baño"     llega desde un anuncio con ese titular
//
// APP_URL (o PUERTO_PRUEBAS) dice a qué servidor se manda: por defecto, http://localhost:8000.
//
// Usa el secreto de .env.pruebas.example: es para el servidor de pruebas, no para el real.

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const APP = process.env.APP_URL || `http://localhost:${process.env.PUERTO_PRUEBAS || 8000}`;

const argumentos = process.argv.slice(2);
const audio = argumentos.includes("--audio");
const posicionReferral = argumentos.indexOf("--referral");
const titular = posicionReferral >= 0 ? argumentos[posicionReferral + 1] : undefined;
const sueltos = argumentos.filter((a, i) => a !== "--audio" && i !== posicionReferral && (posicionReferral < 0 || i !== posicionReferral + 1));
const [telefono, texto, nombre = "Raquel"] = sueltos;
if (!telefono || !texto || (posicionReferral >= 0 && !titular)) {
  console.log('Uso: node scripts/simular-mensaje.mjs <teléfono> "<texto>" [nombre] [--audio] [--referral "<titular del anuncio>"]');
  process.exit(1);
}

const secreto = readFileSync(".env.pruebas.example", "utf8").match(/^META_APP_SECRET=(.*)$/m)?.[1]?.trim();
const contenido = audio
  ? { type: "audio", audio: { id: `sim-${Buffer.from(texto).toString("base64url")}`, mime_type: "audio/ogg; codecs=opus", voice: true } }
  : { type: "text", text: { body: texto } };
const cuerpo = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ wa_id: telefono, profile: { name: nombre } }],
            messages: [
              {
                from: telefono,
                id: `wamid.${randomUUID()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                ...contenido,
                ...(titular ? { referral: { source_type: "ad", source_id: "sim-anuncio", headline: titular, body: "" } } : {}),
              },
            ],
          },
        },
      ],
    },
  ],
});

const respuesta = await fetch(`${APP}/webhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Hub-Signature-256": `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`,
  },
  body: cuerpo,
});
console.log(`Webhook: ${respuesta.status}`);
