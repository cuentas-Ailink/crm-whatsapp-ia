// Cuándo vuelve a pedir el panel el estado de las conexiones (GET /api/sistema). Sin React ni DOM:
// cliente/sistema.tsx lo usa y lib/refresco-conexiones.test.ts lo prueba con relojes falsos.
//
// - Al momento (con un pequeño margen que junta los avisos seguidos en una sola petición) cuando algo
//   acaba de cambiar la realidad: termina la puesta en marcha, «Conectar» sale bien, se guarda una
//   clave, el modo prueba vincula o desvincula el móvil, o el servidor avisa de un cambio «sistema».
// - Si lo pide una acción de esta pestaña, con ?forzar=1: la caché del servidor se salta.
// - Y, de fondo, cada 5 minutos mientras la pestaña se ve, como siempre.

/** Por qué se vuelve a mirar. */
export type MotivoRefresco = "puesta-terminada" | "conectar" | "clave" | "modo-prueba" | "sistema";

/** Los motivos en los que una acción de esta pestaña acaba de cambiar la realidad: se fuerza la caché. */
const FORZADOS: ReadonlySet<MotivoRefresco> = new Set(["puesta-terminada", "conectar", "clave", "modo-prueba"]);

/** Los avisos que llegan dentro de este margen salen en una sola petición. */
export const MARGEN_REFRESCO_MS = 250;
/** La comprobación de fondo, mientras alguien mira las conexiones. */
export const FONDO_CONEXIONES_MS = 5 * 60_000;

export function debeForzar(motivo: MotivoRefresco): boolean {
  return FORZADOS.has(motivo);
}

/** El motivo de un evento del servidor (/api/eventos), o null si no toca a las conexiones. */
export function motivoDeEvento(e: { tipo: string; cambio?: { tipo: string } }): MotivoRefresco | null {
  return e.tipo === "cambio" && e.cambio?.tipo === "sistema" ? "sistema" : null;
}

// ---- Los avisos de esta pestaña («acabo de cambiar algo»): los oye ProveedorSistema ----

const oyentes = new Set<(motivo: MotivoRefresco) => void>();

/** Pide que el panel vuelva a mirar las conexiones. Sin nadie escuchando no hace nada. */
export function pedirRefrescoConexiones(motivo: MotivoRefresco): void {
  for (const oyente of [...oyentes]) {
    try {
      oyente(motivo);
    } catch {
      // Un oyente que falla no impide que les llegue a los demás.
    }
  }
}

export function alPedirRefrescoConexiones(f: (motivo: MotivoRefresco) => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

// ---- El programador ----

export interface RelojRefresco {
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(f: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const RELOJ: RelojRefresco = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export interface RefrescoConexiones {
  /** Alguien empieza a mirar las conexiones; devuelve cómo dejar de mirar. */
  suscribir(): () => void;
  /** Vuelve a mirar en cuanto pase el margen, juntando los avisos que lleguen mientras tanto. */
  pedir(motivo: MotivoRefresco): void;
  /** Olvida el aviso pendiente (al desmontar el proveedor). La comprobación de fondo la llevan las suscripciones. */
  parar(): void;
}

export function crearRefrescoConexiones(o: {
  comprobar: (forzar: boolean) => unknown;
  /** Si la pestaña se ve: la comprobación de fondo solo va con la pestaña a la vista. */
  visible: () => boolean;
  margenMs?: number;
  fondoMs?: number;
  reloj?: RelojRefresco;
}): RefrescoConexiones {
  const reloj = o.reloj ?? RELOJ;
  const margen = o.margenMs ?? MARGEN_REFRESCO_MS;
  const fondo = o.fondoMs ?? FONDO_CONEXIONES_MS;
  let suscriptores = 0;
  let fondoId: unknown = null;
  let margenId: unknown = null;
  let forzarPendiente = false;
  /** Un aviso que llegó sin nadie mirando: se cobra con el primer suscriptor. */
  let deuda: { forzar: boolean } | null = null;

  const lanzar = (forzar: boolean) => {
    try {
      void o.comprobar(forzar);
    } catch {
      // Lo que falle al pedir lo resuelve la siguiente vuelta.
    }
  };

  const disparar = () => {
    margenId = null;
    const forzar = forzarPendiente;
    forzarPendiente = false;
    if (suscriptores > 0) lanzar(forzar);
    else deuda = { forzar: forzar || (deuda?.forzar ?? false) };
  };

  return {
    suscribir() {
      suscriptores++;
      if (suscriptores === 1) {
        // Si ya hay uno a punto de salir, ese basta; si no, se mira ahora (forzando si se debía).
        if (margenId === null) lanzar(deuda?.forzar ?? false);
        else if (deuda?.forzar) forzarPendiente = true;
        deuda = null;
        fondoId = reloj.setInterval(() => {
          if (o.visible()) lanzar(false);
        }, fondo);
      }
      let suelto = false;
      return () => {
        if (suelto) return;
        suelto = true;
        suscriptores--;
        if (suscriptores === 0 && fondoId !== null) {
          reloj.clearInterval(fondoId);
          fondoId = null;
        }
      };
    },
    pedir(motivo) {
      if (debeForzar(motivo)) forzarPendiente = true;
      if (margenId === null) margenId = reloj.setTimeout(disparar, margen);
    },
    parar() {
      if (margenId !== null) reloj.clearTimeout(margenId);
      margenId = null;
      forzarPendiente = false;
      deuda = null;
    },
  };
}
