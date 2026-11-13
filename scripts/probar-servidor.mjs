// Prueba el acceso del CRM por HTTP: la contraseña del panel, la superficie pública, el Host, el
// Origin de las escrituras, el límite de intentos y el freno del formulario. Hace falta tener en
// marcha el simulador y un servidor de pruebas:
//
//   node scripts/simulador.mjs
//   node scripts/servidor-pruebas.mjs --servidor crm.prueba.test
//
//   node scripts/probar-servidor.mjs            (modo servidor)
//
// Y el modo local de siempre (sin CRM_DOMINIO), contra un servidor de pruebas normal:
//
//   node scripts/servidor-pruebas.mjs
//
//   node scripts/probar-servidor.mjs --local
//
// Con otros puertos: PUERTO_PRUEBAS (o APP_URL) y PUERTO_SIMULADOR, los mismos que los de arriba.
// Las peticiones a la app van con node:http y no con fetch: fetch cambia la cabecera Host por la de
// la URL, y aquí el Host es justo lo que se prueba.

import { createHmac } from "node:crypto";
import http from "node:http";

const APP = process.env.APP_URL || `http://localhost:${process.env.PUERTO_PRUEBAS || 8000}`;
const SIMULADOR = `http://127.0.0.1:${process.env.PUERTO_SIMULADOR || 8099}`;
const LOCAL = process.argv.includes("--local");
const DOMINIO = "crm.prueba.test";
const ORIGEN = "https://crm.prueba.test";
const SECRETO = "secreto-de-prueba";
const CLAVE = "una-clave-de-prueba!"; // 20 caracteres
const CLAVE_2 = "otra-clave-de-prueba-2";
const CODIGO = "codigo-de-prueba";
const SIN_SESION = '{"ok":false,"error":"Tienes que entrar con tu contraseña","codigo":"sesion"}';
const TEXTO_ENTRAR = "Contraseña incorrecta o demasiados intentos. Espera unos minutos.";
const TEXTO_FRENO = "Hemos recibido muchas solicitudes. Inténtalo más tarde o escríbenos por WhatsApp.";

const url = new URL(APP);
if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
  console.error(`Solo se prueba un servidor de este ordenador (localhost o 127.0.0.1), no ${url.hostname}.`);
  process.exit(1);
}
const PUERTO = Number(url.port || 80);
const HOST_LOCAL = `localhost:${PUERTO}`;

let fallos = 0;

function comprobar(nombre, condicion, detalle = "") {
  console.log(`${condicion ? "  OK   " : "  ERROR"} ${nombre}${!condicion && detalle ? ` → ${detalle}` : ""}`);
  if (!condicion) fallos++;
}

function seccion(titulo) {
  console.log(`\n${titulo}`);
}

/**
 * Una petición a la app con las cabeceras exactas. `cuerpo` objeto → JSON (Content-Type JSON salvo
 * que `tipo` diga otra cosa; `tipo: null` no manda ninguno). Devuelve estado, cabeceras, texto y JSON.
 */
function pedir({ metodo = "GET", ruta, host = DOMINIO, ip, origen, cookie, tipo, cuerpo, cabeceras = {} }) {
  const datos = cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  const headers = { ...cabeceras };
  if (host !== null) headers.Host = host;
  if (ip) headers["X-Forwarded-For"] = ip;
  if (origen) headers.Origin = origen;
  if (cookie) headers.Cookie = `crm_sesion=${cookie}`;
  const tipoFinal = tipo === undefined ? (datos !== undefined ? "application/json" : null) : tipo;
  if (tipoFinal) headers["Content-Type"] = tipoFinal;
  if (datos !== undefined) headers["Content-Length"] = Buffer.byteLength(datos);
  return new Promise((resolver, rechazar) => {
    const peticion = http.request(
      { host: "127.0.0.1", port: PUERTO, method: metodo, path: ruta, headers, agent: false, setHost: false },
      (res) => {
        const trozos = [];
        res.on("data", (t) => trozos.push(t));
        res.on("end", () => {
          const texto = Buffer.concat(trozos).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(texto);
          } catch {
            json = null;
          }
          resolver({ status: res.statusCode, headers: res.headers, texto, json });
        });
        res.on("error", rechazar);
      },
    );
    peticion.setTimeout(30_000, () => peticion.destroy(new Error("sin respuesta en 30 s")));
    peticion.on("error", rechazar);
    if (datos !== undefined) peticion.write(datos);
    peticion.end();
  });
}

/** El valor de crm_sesion de una respuesta, o null. */
function cookieDe(r) {
  const lista = r.headers["set-cookie"] ?? [];
  for (const linea of lista) {
    const m = linea.match(/^crm_sesion=([^;]*)/);
    if (m) return { valor: m[1], linea };
  }
  return null;
}

const resumen = (r) => `${r.status} ${r.texto.slice(0, 160)}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Las plantillas que ha recibido el simulador para ese teléfono. */
async function plantillasA(telefono) {
  const registro = await fetch(`${SIMULADOR}/registro`).then((r) => r.json());
  return (registro.plantillas ?? []).filter((p) => p.to === telefono).length;
}

/** El webhook firmado como lo firma Meta. */
const firmar = (cuerpo) => `sha256=${createHmac("sha256", SECRETO).update(cuerpo).digest("hex")}`;

// ─── Modo servidor ────────────────────────────────────────────────────────────────────────────────

async function modoServidor() {
  seccion("Arranque");
  let firma;
  try {
    firma = await pedir({ ruta: "/api/estado?solo=firma" });
  } catch {
    firma = null;
  }
  if (!firma || firma.status !== 200 || !firma.json || JSON.stringify(Object.keys(firma.json)) !== '["firma"]') {
    console.error(`No responde un servidor en modo servidor en ${APP}. Arranca node scripts/servidor-pruebas.mjs --servidor ${DOMINIO}`);
    process.exit(1);
  }
  comprobar("/api/estado?solo=firma es pública y solo da la firma", true);
  const entrarPrimera = await pedir({ ruta: "/entrar" });
  comprobar("/entrar pide crear la contraseña", entrarPrimera.status === 200 && entrarPrimera.texto.includes("Crea la contraseña del panel"), String(entrarPrimera.status));

  seccion("Crear la contraseña");
  const codigoMalo = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: "198.51.100.3", origen: ORIGEN, cuerpo: { codigo: "otro-codigo", clave: CLAVE } });
  comprobar("un código de alta equivocado da 401", codigoMalo.status === 401, resumen(codigoMalo));
  const corta = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: "198.51.100.3", origen: ORIGEN, cuerpo: { codigo: CODIGO, clave: "corta" } });
  comprobar(
    "una contraseña corta da 400 y no gasta el código",
    corta.status === 400 && corta.json?.error === "La contraseña necesita al menos 10 caracteres" && corta.json?.campo === "clave",
    resumen(corta),
  );
  const creada = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: "198.51.100.4", origen: ORIGEN, cuerpo: { codigo: CODIGO, clave: CLAVE } });
  const c1 = cookieDe(creada);
  comprobar("con el código y una contraseña buena se crea y entra", creada.status === 200 && creada.json?.ok === true && !!c1, resumen(creada));
  const linea = c1?.linea ?? "";
  comprobar(
    "la cookie es HttpOnly, Secure, SameSite=Strict, Path=/ y dura 30 días",
    ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=2592000"].every((parte) => linea.includes(parte)),
    linea.replace(/^crm_sesion=[^;]*/, "crm_sesion=…"),
  );
  comprobar("ninguna respuesta lleva el código de alta", ![codigoMalo, corta, creada].some((r) => r.texto.includes(CODIGO)));
  if (!c1) {
    console.error("Sin la cookie de la contraseña no se puede seguir.");
    process.exit(1);
  }
  const C1 = c1.valor;

  // La guarda: solo se sigue contra un servidor de pruebas en modo servidor.
  const estado = await pedir({ ruta: "/api/estado", cookie: C1 });
  if (estado.status !== 200 || estado.json?.pruebas !== true || estado.json?.modo !== "servidor") {
    console.error(`${APP} no es un servidor de pruebas en modo servidor: no sigo`);
    process.exit(1);
  }
  comprobar("es un servidor de pruebas en modo servidor", true);
  const panel = await pedir({ ruta: "/panel", cookie: C1 });
  comprobar("la cookie recién creada abre /panel al momento (proxy.ts ve la contraseña nueva)", panel.status === 200, String(panel.status));

  const otraVez = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: "198.51.100.5", origen: ORIGEN, cuerpo: { codigo: CODIGO, clave: CLAVE } });
  comprobar("el código ya no sirve: 409", otraVez.status === 409, resumen(otraVez));
  const entrarDespues = await pedir({ ruta: "/entrar" });
  comprobar(
    "/entrar pide ya la contraseña",
    entrarDespues.status === 200 && entrarDespues.texto.includes("Entrar") && !entrarDespues.texto.includes("Crea la contraseña del panel"),
    String(entrarDespues.status),
  );

  seccion("Lo público, sin cookie");
  const portada = await pedir({ ruta: "/" });
  comprobar("GET / 200", portada.status === 200, String(portada.status));
  const cabeza = await pedir({ metodo: "HEAD", ruta: "/" });
  comprobar("HEAD / 200", cabeza.status === 200, String(cabeza.status));
  const icono = await pedir({ ruta: "/icono.svg" });
  comprobar("GET /icono.svg 200", icono.status === 200, String(icono.status));
  const estatico = portada.texto.match(/\/_next\/static\/[^"'\s)]+/)?.[0];
  const recurso = estatico ? await pedir({ ruta: estatico }) : null;
  comprobar(`GET ${estatico ?? "/_next/static/…"} 200`, recurso?.status === 200, recurso ? String(recurso.status) : "sin ruta en el HTML");
  const foto = await pedir({ ruta: "/fotos/formulario.webp" });
  comprobar("GET /fotos/formulario.webp 200", foto.status === 200, String(foto.status));
  const logo = await pedir({ ruta: "/api/logo?perfil=no-existe&v=1" });
  comprobar("GET /api/logo lo contesta la ruta (ni 401 ni 307)", logo.status !== 401 && logo.status !== 307, String(logo.status));
  const verificar = await pedir({ ruta: "/webhook?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=1" });
  comprobar("GET /webhook con un token malo: 403 «Token incorrecto» de la ruta", verificar.status === 403 && verificar.texto === "Token incorrecto", resumen(verificar));
  const vacio = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const malFirmado = await pedir({ metodo: "POST", ruta: "/webhook", cuerpo: vacio, tipo: "application/json", cabeceras: { "X-Hub-Signature-256": "sha256=00" } });
  comprobar("POST /webhook con la firma mal: 401 «Firma no válida» de la ruta", malFirmado.status === 401 && malFirmado.texto === "Firma no válida", resumen(malFirmado));
  const firmado = await pedir({ metodo: "POST", ruta: "/webhook", cuerpo: vacio, tipo: "application/json", cabeceras: { "X-Hub-Signature-256": firmar(vacio) } });
  comprobar("POST /webhook bien firmado: 200", firmado.status === 200, resumen(firmado));
  const firmadoFuera = await pedir({ metodo: "POST", ruta: "/webhook", host: "otro.prueba.test", cuerpo: vacio, tipo: "application/json", cabeceras: { "X-Hub-Signature-256": firmar(vacio) } });
  comprobar("POST /webhook bien firmado con otro Host: 200", firmadoFuera.status === 200, resumen(firmadoFuera));

  seccion("Lo privado, sin cookie");
  const aEntrar = await pedir({ ruta: "/panel" });
  comprobar("GET /panel → 307 a /entrar?volver=%2Fpanel", aEntrar.status === 307 && aEntrar.headers.location === "/entrar?volver=%2Fpanel", `${aEntrar.status} ${aEntrar.headers.location}`);
  const aEntrarCliente = await pedir({ ruta: "/panel?cliente=x" });
  comprobar(
    "GET /panel?cliente=x → volver con la consulta",
    aEntrarCliente.status === 307 && aEntrarCliente.headers.location === "/entrar?volver=%2Fpanel%3Fcliente%3Dx",
    `${aEntrarCliente.status} ${aEntrarCliente.headers.location}`,
  );
  for (const ruta of ["/api/leads", "/api/estado", "/api/eventos", "/api/exportar", "/api/sesion"]) {
    const r = await pedir({ ruta });
    comprobar(`GET ${ruta} → 401 sesion en JSON`, r.status === 401 && r.texto === SIN_SESION && String(r.headers["content-type"]).includes("application/json"), resumen(r));
  }
  for (const [metodo, ruta] of [["POST", "/api/reset"], ["PUT", "/api/sesion"], ["DELETE", "/api/sesion"]]) {
    const r = await pedir({ metodo, ruta, origen: ORIGEN, cuerpo: {} });
    comprobar(`${metodo} ${ruta} → 401`, r.status === 401 && r.texto === SIN_SESION, resumen(r));
  }

  seccion("Host");
  const otroHost = await pedir({ ruta: "/", host: "otro.prueba.test" });
  comprobar("otro Host: 404 «No encontrado»", otroHost.status === 404 && otroHost.texto === "No encontrado", resumen(otroHost));
  const hostLocal = await pedir({ ruta: "/", host: HOST_LOCAL });
  comprobar(`Host ${HOST_LOCAL}: 404`, hostLocal.status === 404, resumen(hostLocal));
  const reenviado = await pedir({ ruta: "/", cabeceras: { "X-Forwarded-Host": "otro.prueba.test" } });
  comprobar("X-Forwarded-Host de otro sitio: 404", reenviado.status === 404, resumen(reenviado));
  const mayusculas = await pedir({ ruta: "/", host: "CRM.Prueba.Test" });
  comprobar("Host en mayúsculas: 200", mayusculas.status === 200, String(mayusculas.status));

  seccion("Con la sesión");
  const leads = await pedir({ ruta: "/api/leads", cookie: C1 });
  comprobar("GET /api/leads 200 con leads", leads.status === 200 && typeof leads.json?.leads === "object", String(leads.status));
  const sesion = await pedir({ ruta: "/api/sesion", cookie: C1 });
  comprobar("GET /api/sesion 200", sesion.status === 200 && sesion.json?.ok === true, resumen(sesion));
  const borrar = (origen, tipo) => pedir({ metodo: "POST", ruta: "/api/borrar-cliente", cookie: C1, origen, tipo, cuerpo: { leadId: "no-existe" } });
  const bien = await borrar(ORIGEN);
  comprobar("con el Origin del dominio la escritura llega a la ruta: 404 «Ese cliente ya no existe»", bien.status === 404 && bien.json?.error === "Ese cliente ya no existe", resumen(bien));
  for (const origen of ["https://otro.prueba.test", "http://crm.prueba.test", undefined]) {
    const r = await borrar(origen);
    comprobar(`Origin ${origen ?? "ausente"}: 403 «Prohibido»`, r.status === 403 && r.texto === "Prohibido", resumen(r));
  }
  const textoPlano = await borrar(ORIGEN, "text/plain");
  comprobar("sin JSON: 415 «Se esperaba JSON»", textoPlano.status === 415 && textoPlano.texto === "Se esperaba JSON", resumen(textoPlano));
  const otraWeb = await pedir({ ruta: "/api/leads", cookie: C1, cabeceras: { "Sec-Fetch-Site": "cross-site" } });
  comprobar("Sec-Fetch-Site: cross-site → 403", otraWeb.status === 403, resumen(otraWeb));

  seccion("Límite de intentos");
  const ipLimite = "198.51.100.10";
  let malas = 0;
  for (let i = 0; i < 5; i++) {
    const r = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: ipLimite, origen: ORIGEN, cuerpo: { clave: "mal" } });
    if (r.status === 401 && r.json?.error === TEXTO_ENTRAR) malas++;
  }
  comprobar("cinco contraseñas malas: 401 con el texto genérico", malas === 5, `${malas} de 5`);
  const sexta = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: ipLimite, origen: ORIGEN, cuerpo: { clave: CLAVE } });
  comprobar("la sexta, aunque sea la buena: 429 con el mismo texto", sexta.status === 429 && sexta.json?.error === TEXTO_ENTRAR, resumen(sexta));
  const otraIp = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: "198.51.100.11", origen: ORIGEN, cuerpo: { clave: CLAVE } });
  const c2 = cookieDe(otraIp);
  comprobar("la buena desde otra IP: 200 con cookie", otraIp.status === 200 && !!c2, resumen(otraIp));
  const C2 = c2?.valor ?? "";

  seccion("Cerrar sesión");
  const salir = await pedir({ metodo: "DELETE", ruta: "/api/sesion", cookie: C2, origen: ORIGEN, cuerpo: {} });
  comprobar("DELETE /api/sesion 200 y la cookie caduca", salir.status === 200 && (cookieDe(salir)?.linea ?? "").includes("Max-Age=0"), resumen(salir));

  seccion("Cambiar la contraseña");
  const actualMala = await pedir({ metodo: "PUT", ruta: "/api/sesion", ip: "198.51.100.12", cookie: C1, origen: ORIGEN, cuerpo: { actual: "mal-mal-mal-mal", nueva: CLAVE_2 } });
  comprobar("con la actual mal: 401 «La contraseña actual no es correcta»", actualMala.status === 401 && actualMala.json?.error === "La contraseña actual no es correcta" && actualMala.json?.codigo === undefined, resumen(actualMala));
  const cambio = await pedir({ metodo: "PUT", ruta: "/api/sesion", ip: "198.51.100.12", cookie: C1, origen: ORIGEN, cuerpo: { actual: CLAVE, nueva: CLAVE_2 } });
  const c3 = cookieDe(cambio);
  comprobar("con la actual bien: 200 y una cookie nueva", cambio.status === 200 && !!c3, resumen(cambio));
  const C3 = c3?.valor ?? "";
  const conC1 = await pedir({ ruta: "/api/leads", cookie: C1 });
  comprobar("la cookie de antes del cambio ya no vale", conC1.status === 401, String(conC1.status));
  const conC2 = await pedir({ ruta: "/api/leads", cookie: C2 });
  comprobar("la de otro dispositivo tampoco", conC2.status === 401, String(conC2.status));
  const conC3 = await pedir({ ruta: "/api/leads", cookie: C3 });
  comprobar("la nueva sí", conC3.status === 200, String(conC3.status));
  const vieja = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: "198.51.100.13", origen: ORIGEN, cuerpo: { clave: CLAVE } });
  comprobar("entrar con la contraseña vieja: 401", vieja.status === 401, resumen(vieja));
  const nueva = await pedir({ metodo: "POST", ruta: "/api/sesion", ip: "198.51.100.13", origen: ORIGEN, cuerpo: { clave: CLAVE_2 } });
  comprobar("entrar con la nueva: 200", nueva.status === 200 && !!cookieDe(nueva), resumen(nueva));

  seccion("Freno del formulario");
  const lead = (ip, cuerpo, origen = ORIGEN) => pedir({ metodo: "POST", ruta: "/lead", ip, origen, cuerpo: { nombre: "Laura", consentimiento: true, ...cuerpo } });
  const trampa = await lead("198.51.100.20", { telefono: "34611100001", web: "http://spam.example" });
  await esperar(300);
  comprobar("con el campo trampa: 200 {ok:true} y ningún WhatsApp", trampa.status === 200 && trampa.texto === '{"ok":true}' && (await plantillasA("34611100001")) === 0, resumen(trampa));
  const primera = await lead("198.51.100.21", { telefono: "34611100002" });
  comprobar("una solicitud normal: 200 y una bienvenida", primera.status === 200 && (await plantillasA("34611100002")) === 1, resumen(primera));
  const repetida = await lead("198.51.100.22", { telefono: "34611100002" });
  comprobar("el mismo teléfono otra vez, desde otra IP: 429", repetida.status === 429 && repetida.json?.error === TEXTO_FRENO, resumen(repetida));
  comprobar("y sigue habiendo una sola bienvenida", (await plantillasA("34611100002")) === 1);
  let aceptadas = 0;
  for (let i = 0; i < 5; i++) {
    const r = await lead("198.51.100.23", { telefono: `3461110001${i}` });
    if (r.status === 200) aceptadas++;
  }
  comprobar("cinco teléfonos desde una IP: cinco 200", aceptadas === 5, `${aceptadas} de 5`);
  const sextaIp = await lead("198.51.100.23", { telefono: "34611100019" });
  comprobar("el sexto desde la misma IP: 429", sextaIp.status === 429 && sextaIp.json?.error === TEXTO_FRENO, resumen(sextaIp));
  const largo = await lead("198.51.100.24", { telefono: "34611100020", email: `${"a".repeat(109)}@example.com` });
  comprobar("un email de 121 caracteres: 400 «Revisa el formulario»", largo.status === 400 && largo.json?.error === "Revisa el formulario", resumen(largo));
  const fuera = await lead("198.51.100.25", { telefono: "34611100021" }, "https://otro.prueba.test");
  comprobar("desde otra web: 403", fuera.status === 403, resumen(fuera));

  seccion("Webhook en el dominio");
  const tunel = await pedir({ metodo: "POST", ruta: "/api/meta/conectar", cookie: C3, origen: ORIGEN, cuerpo: { paso: "tunel" } });
  comprobar(
    "el paso del túnel dice que los mensajes llegan a https://crm.prueba.test",
    tunel.status === 200 && tunel.json?.ok === true && String(tunel.json?.texto).includes("https://crm.prueba.test"),
    resumen(tunel),
  );
}

// ─── Modo local ───────────────────────────────────────────────────────────────────────────────────

async function modoLocal() {
  seccion("Arranque");
  let estado;
  try {
    estado = await pedir({ ruta: "/api/estado", host: HOST_LOCAL });
  } catch {
    estado = null;
  }
  if (!estado || estado.status !== 200 || estado.json?.pruebas !== true || estado.json?.modo !== "local") {
    console.error(`${APP} no es un servidor de pruebas en modo local: no sigo. Arranca node scripts/servidor-pruebas.mjs`);
    process.exit(1);
  }
  comprobar("es un servidor de pruebas en modo local", true);

  seccion("Enrutado local");
  for (const host of [HOST_LOCAL, `127.0.0.1:${PUERTO}`]) {
    const r = await pedir({ ruta: "/panel", host });
    comprobar(`GET /panel con Host ${host}: 200`, r.status === 200, String(r.status));
  }
  const fuera = await pedir({ ruta: "/panel", host: "otro.prueba.test" });
  comprobar("GET /panel con otro Host: 404", fuera.status === 404 && fuera.texto === "No encontrado", resumen(fuera));
  const tunel = await pedir({ ruta: "/panel", host: HOST_LOCAL, cabeceras: { "X-Forwarded-Host": "demo.ngrok-free.app" } });
  comprobar("GET /panel por el túnel (X-Forwarded-Host): 404", tunel.status === 404, resumen(tunel));
  const webhook = await pedir({ ruta: "/webhook?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=1", host: "otro.prueba.test" });
  comprobar("GET /webhook desde fuera llega a la ruta: 403 «Token incorrecto»", webhook.status === 403 && webhook.texto === "Token incorrecto", resumen(webhook));
  const otraWeb = await pedir({ ruta: "/api/leads", host: HOST_LOCAL, cabeceras: { "Sec-Fetch-Site": "cross-site" } });
  comprobar("GET /api/leads desde otra web: 403", otraWeb.status === 403, resumen(otraWeb));
  const borrar = (o) => pedir({ metodo: "POST", ruta: "/api/borrar-cliente", host: HOST_LOCAL, cuerpo: { leadId: "no-existe" }, ...o });
  const origenAjeno = await borrar({ origen: "http://otro.prueba.test" });
  comprobar("escritura con Origin de otro sitio: 403", origenAjeno.status === 403 && origenAjeno.texto === "Prohibido", resumen(origenAjeno));
  const sinTipo = await borrar({ tipo: null });
  comprobar("escritura sin Content-Type: 415", sinTipo.status === 415 && sinTipo.texto === "Se esperaba JSON", resumen(sinTipo));
  const bien = await borrar({ origen: `http://${HOST_LOCAL}` });
  comprobar("escritura bien hecha: llega a la ruta (404 «Ese cliente ya no existe»)", bien.status === 404 && bien.json?.error === "Ese cliente ya no existe", resumen(bien));

  seccion("Sin contraseña en local");
  const entrar = await pedir({ ruta: "/entrar", host: HOST_LOCAL });
  comprobar("/entrar lleva al panel", entrar.status >= 300 && entrar.status < 400 && /\/panel$/.test(String(entrar.headers.location)), `${entrar.status} ${entrar.headers.location}`);
  const sesion = await pedir({ metodo: "POST", ruta: "/api/sesion", host: HOST_LOCAL, cuerpo: {} });
  comprobar("POST /api/sesion: 404", sesion.status === 404, resumen(sesion));
  const conCookiePanel = await pedir({ ruta: "/panel", host: HOST_LOCAL, cookie: "basura" });
  const conCookieLeads = await pedir({ ruta: "/api/leads", host: HOST_LOCAL, cookie: "basura" });
  const conCookieFuera = await pedir({ ruta: "/panel", host: "otro.prueba.test", cookie: "basura" });
  comprobar(
    "una cookie crm_sesion no cambia nada",
    conCookiePanel.status === 200 && conCookieLeads.status === 200 && conCookieFuera.status === 404,
    `${conCookiePanel.status} ${conCookieLeads.status} ${conCookieFuera.status}`,
  );

  seccion("Freno del formulario en local");
  const lead = (telefono, extra = {}) =>
    pedir({ metodo: "POST", ruta: "/lead", host: HOST_LOCAL, cuerpo: { nombre: "Laura", telefono, consentimiento: true, ...extra } });
  const trampa = await lead("34611100091", { web: "http://spam.example" });
  await esperar(300);
  comprobar("con el campo trampa: {ok:true} y ningún WhatsApp", trampa.status === 200 && trampa.json?.ok === true && (await plantillasA("34611100091")) === 0, resumen(trampa));
  const una = await lead("34611100092");
  const dos = await lead("34611100092");
  comprobar("el mismo teléfono dos veces en 60 s: una bienvenida y ningún 429", una.status === 200 && dos.status === 200 && (await plantillasA("34611100092")) === 1, `${resumen(una)} · ${resumen(dos)}`);
}

try {
  if (LOCAL) await modoLocal();
  else await modoServidor();
} catch (error) {
  comprobar("la prueba ha terminado sin errores", false, error instanceof Error ? error.message : String(error));
}

console.log(fallos === 0 ? "\nTodo bien." : `\n${fallos} comprobación(es) con ERROR.`);
process.exit(fallos === 0 ? 0 : 1);
