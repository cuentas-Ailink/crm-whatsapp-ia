// Al arrancar el servidor: abre el túnel (si hace falta) y avisa a Meta de dónde está el CRM.
// register() tiene que acabar antes de que el servidor conteste, y Meta comprueba el webhook
// llamando a este mismo servidor: nada que dependa de la red se espera aquí.
// En modo servidor (CRM_DOMINIO) no hay túnel: escribe el código de alta mientras no haya contraseña
// del panel y programa las copias diarias de los datos.

type ModuloTunel = typeof import("./lib/tunel");
type ModuloMeta = typeof import("./lib/meta");
type Pedir = typeof import("node:http").request;

const ESPERA_MS = 500;
const MAXIMO_MS = 60_000;

/** Un aviso rojo en la terminal, con el mismo aspecto que lib/log.ts. */
function avisoRojo(mensaje: string): void {
  console.log(`\x1b[31m${mensaje}\x1b[0m`);
}

/**
 * En modo servidor el CRM solo contesta a su dominio: la pregunta de «¿ya estás?» lleva ese Host.
 * Con node:http, porque el fetch de Node no deja cambiar la cabecera Host.
 */
function estadoConHost(pedir: Pedir, url: string, host: string): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const peticion = pedir(url, { method: "GET", headers: { Host: host }, timeout: ESPERA_MS * 4 }, (respuesta) => {
      respuesta.resume();
      resolver(respuesta.statusCode ?? 0);
    });
    peticion.on("timeout", () => peticion.destroy(new Error("sin respuesta")));
    peticion.on("error", rechazar);
    peticion.end();
  });
}

/** Espera a que el servidor conteste (cada 500 ms, hasta 60 s). En modo servidor, con el Host del dominio. */
async function servidorListo(url: string, dominio?: { host: string; pedir: Pedir }): Promise<boolean> {
  const limite = Date.now() + MAXIMO_MS;
  while (Date.now() < limite) {
    try {
      if (dominio) {
        if ((await estadoConHost(dominio.pedir, url, dominio.host)) === 200) return true;
      } else {
        const r = await fetch(url, { signal: AbortSignal.timeout(ESPERA_MS * 4) });
        if (r.status === 200) return true;
      }
    } catch {
      // Aún arrancando.
    }
    await new Promise((resolver) => setTimeout(resolver, ESPERA_MS));
  }
  return false;
}

async function arrancarConexiones(tunel: ModuloTunel, meta: ModuloMeta, dominio?: { host: string; pedir: Pedir }): Promise<void> {
  try {
    const puerto = process.env.PUERTO || "8000";
    if (!(await servidorListo(`http://127.0.0.1:${puerto}/api/estado?solo=firma`, dominio))) return;
    if (tunel.modoServidor() || process.env.CRM_URL_PUBLICA?.trim()) {
      const e = process.env;
      const publica = tunel.urlPublica();
      if (publica && e.WHATSAPP_TOKEN && e.META_APP_SECRET && e.WHATSAPP_BUSINESS_ACCOUNT_ID) await meta.alAbrirTunel(publica);
      tunel.estadoAcceso();
    } else if (tunel.tokenNgrok()) {
      // Al abrirse avisa a Meta y comprueba el acceso. Un segundo register() no abre otro: el estado
      // del túnel vive en globalThis.
      await tunel.abrirTunel();
    }
    meta.numeroDelNegocio();
  } catch (error) {
    avisoRojo(`No se han podido preparar las conexiones al arrancar: ${error instanceof Error ? error.name : "error"}`);
  }
}

/** El código de alta, mientras no haya contraseña del panel. Nunca impide que el servidor arranque. */
function escribirCodigoDeAlta(dominio: string): void {
  try {
    // La contraseña del panel se crea en /entrar con el código de alta, que es de un solo uso. Esta es
    // la única línea del registro que lleva el valor de una clave (I16, G5): el código se lee en su
    // propia línea y se escribe tal cual con console.log, no con lib/log.
    const codigo = process.env.CODIGO_ALTA?.trim();
    const hayContrasena = !!process.env.CLAVE_PANEL_HASH?.trim();
    if (!hayContrasena && codigo) {
      console.log(`Código de alta del panel: ${codigo} (abre https://${dominio}/entrar)`);
    }
  } catch {
    // Nada que hacer: el instalador ya lo ha escrito en pantalla.
  }
}

export async function register() {
  // Solo en Node, con el patrón de la documentación de Next: los import dinámicos van dentro de esta rama.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dominio = process.env.CRM_DOMINIO?.trim();
    // Modo servidor, antes de la salida de las pruebas: el servidor de pruebas también escribe el código.
    if (dominio) {
      escribirCodigoDeAlta(dominio);
      // Las copias diarias son de la carpeta datos/ de verdad: con BD_LOCAL (pruebas) no se copia.
      if (!process.env.BD_LOCAL) {
        try {
          const { programarCopias } = await import("./lib/copias");
          programarCopias();
        } catch (error) {
          const { logError } = await import("./lib/log");
          logError("al programar las copias de tus datos", error);
        }
      }
    }
    if (process.env.BD_LOCAL) return; // pruebas: nada
    // Modo prueba (WhatsApp por QR, solo en local): si está elegido y preparado, su puente vuelve a
    // arrancar con el CRM. Nunca impide que el servidor arranque.
    if (!dominio) {
      try {
        const [modoPrueba, puente] = await Promise.all([import("./lib/modo-prueba"), import("./lib/modo-prueba-puente")]);
        if (modoPrueba.modoWhatsApp() === "prueba" && puente.herramientaLista()) void puente.arrancarPuente().catch(() => undefined);
      } catch (error) {
        avisoRojo(`No se ha podido arrancar el modo prueba: ${error instanceof Error ? error.name : "error"}`);
      }
    }
    const [tunel, meta, http] = await Promise.all([import("./lib/tunel"), import("./lib/meta"), import("node:http")]);
    // En modo servidor, la pregunta de «¿ya estás?» va con el Host del dominio (lo exige proxy.ts).
    const conHost = dominio && tunel.modoServidor() ? { host: dominio, pedir: http.request } : undefined;
    void arrancarConexiones(tunel, meta, conHost); // nunca se espera: register() tiene que acabar antes de que el servidor conteste
  }
}
