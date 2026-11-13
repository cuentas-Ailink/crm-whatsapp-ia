// Copia a Supabase lo que hubiera en demo.db, la base de datos SQLite de antes. Se ejecuta una vez:
//
//   node scripts/pasar-a-supabase.mjs              copia demo.db
//   node scripts/pasar-a-supabase.mjs otra.db      copia otro archivo
//
// Antes hay que arrancar la demo una vez con SUPABASE_DB_URL en .env, para que cree las tablas.
// No borra nada en ninguno de los dos lados: lo que ya esté en Supabase se queda como está. Los
// leads «(prueba)» no se copian, porque Supabase ya tiene los suyos. No imprime ningún dato.

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const archivo = process.argv[2] || "demo.db";
const url = process.env.SUPABASE_DB_URL;

function fallar(texto, solucion) {
  console.log(`\x1b[31mERROR\x1b[0m  ${texto}`);
  if (solucion) console.log(`       → ${solucion}`);
  process.exit(1);
}

if (!existsSync(archivo)) fallar(`No existe ${archivo}`, "Ejecútalo en la carpeta de la demo, donde está demo.db");
if (!url) fallar("Falta SUPABASE_DB_URL en .env", "Supabase → tu proyecto → Connect → Session pooler");

const origen = new DatabaseSync(archivo, { readOnly: true });
const columnas = (tabla) => new Set(origen.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));
const tieneSpam = columnas("leads").has("motivo_spam");
const mensajesCon = columnas("mensajes");

const leads = origen.prepare("SELECT * FROM leads WHERE origen <> 'prueba' ORDER BY creado_en").all();
const ids = new Set(leads.map((l) => l.id));
const mensajes = origen.prepare("SELECT * FROM mensajes ORDER BY rowid").all().filter((m) => ids.has(m.lead_id));
const visitas = origen.prepare("SELECT * FROM visitas").all().filter((v) => ids.has(v.lead_id));
const procesados = origen.prepare("SELECT wamid FROM mensajes_procesados").all();
const ajustes = origen.prepare("SELECT leads_prueba FROM ajustes").get();

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require",
  onnotice: () => {},
});

try {
  const [tabla] = await sql.unsafe("SELECT to_regclass('public.leads') AS leads");
  if (!tabla.leads) fallar("Supabase aún no tiene las tablas", "Arranca la demo una vez con bash arrancar.sh y vuelve a ejecutar este script");

  const copiados = await sql.begin(async (tx) => {
    const cuenta = async (consultas) => (await Promise.all(consultas)).reduce((total, r) => total + r.count, 0);
    const nLeads = await cuenta(
      leads.map((l) =>
        tx.unsafe(
          `INSERT INTO leads (id, telefono, perfil_id, perfil_nombre, nombre, email, zona, origen, estado, datos,
             huecos_ofrecidos, motivo_persona, motivo_spam, ms_primer_whatsapp, creado_en, actualizado_en, cambio_estado_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text::jsonb, $11::text::jsonb, $12, $13, $14, $15, $16, $17)
           ON CONFLICT DO NOTHING`,
          [
            l.id,
            l.telefono,
            l.perfil_id,
            l.perfil_nombre,
            l.nombre,
            l.email,
            l.zona,
            l.origen,
            l.estado,
            l.datos,
            l.huecos_ofrecidos,
            l.motivo_persona,
            tieneSpam ? l.motivo_spam : null,
            l.ms_primer_whatsapp,
            l.creado_en,
            l.actualizado_en,
            l.cambio_estado_en,
          ],
        ),
      ),
    );
    // En el orden en que entraron: Supabase les da su número de orden al insertarlos.
    const nMensajes = await cuenta(
      mensajes.map((m) =>
        tx.unsafe(
          `INSERT INTO mensajes (lead_id, id, de, texto, ts, plantilla, audio, manual) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [m.lead_id, m.id, m.de, m.texto, m.ts, !!m.plantilla, mensajesCon.has("audio") && !!m.audio, mensajesCon.has("manual") && !!m.manual],
        ),
      ),
    );
    const nVisitas = await cuenta(
      visitas.map((v) =>
        tx.unsafe(
          "INSERT INTO visitas (hueco_id, lead_id, texto, nombre, perfil_nombre, prueba) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
          [v.hueco_id, v.lead_id, v.texto, v.nombre, v.perfil_nombre, !!v.prueba],
        ),
      ),
    );
    await cuenta(procesados.map((p) => tx.unsafe("INSERT INTO mensajes_procesados (wamid) VALUES ($1) ON CONFLICT DO NOTHING", [p.wamid])));
    if (ajustes) await tx.unsafe("UPDATE ajustes SET leads_prueba = $1", [ajustes.leads_prueba === 1]);
    return { nLeads, nMensajes, nVisitas };
  });

  const cuantos = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const yaEstaban = leads.length - copiados.nLeads;
  const resto = yaEstaban === 1 ? ". Un lead ya estaba y no se ha tocado" : yaEstaban ? `. ${yaEstaban} leads ya estaban y no se han tocado` : "";
  console.log(
    `\x1b[32mOK\x1b[0m     Copiado a Supabase: ${cuantos(copiados.nLeads, "lead", "leads")}, ` +
      `${cuantos(copiados.nMensajes, "mensaje", "mensajes")} y ${cuantos(copiados.nVisitas, "visita", "visitas")}${resto}`,
  );
  console.log(`       ${archivo} sigue igual. Cuando lo hayas comprobado en el panel, puedes borrarlo.`);
} catch (error) {
  fallar(`No se ha podido copiar: ${error.message}`, "No se ha guardado nada a medias. Revisa SUPABASE_DB_URL y la conexión a internet");
} finally {
  await sql.end({ timeout: 5 });
  origen.close();
}
