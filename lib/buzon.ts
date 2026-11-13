import { randomUUID } from "node:crypto";
import { registrarMensaje } from "./bd";
import { logError } from "./log";
import type { Entrante, Lote } from "./tipos";

// Junta los mensajes seguidos de un número y cancela lo que se estaba contestando si entra otro.
// Solo guarda lo pasajero: los datos están en la base de datos. Vive en globalThis porque Next puede
// cargar este módulo varias veces, una por cada ruta, y todas tienen que ver el mismo buzón.

const SILENCIO_MS = 1_500;
const MENSAJE_VIEJO_MS = 120_000;

export interface Ejecucion {
  controlador: AbortController;
  /** Ya se ha empezado a enviar: un mensaje nuevo no puede cancelarla. */
  enviando: boolean;
}

export type Procesador = (lote: Lote, ejecucion: Ejecucion) => Promise<void>;

interface Hilo {
  /** Mensajes de este número que aún no se han contestado. */
  acumulado: Entrante[];
  temporizador?: ReturnType<typeof setTimeout>;
  ejecucion?: Ejecucion;
}

class Buzon {
  hilos = new Map<string, Hilo>();
  /** De uno en uno: el agente decide con las reservas que ve al empezar, y dos a la vez podrían coger el mismo hueco. */
  cola: Promise<void> = Promise.resolve();
  /** Los mensajes entran de uno en uno: mientras se apunta uno en la base de datos, el siguiente espera. */
  entrada: Promise<unknown> = Promise.resolve();
  /** Cambia con cada reinicio: lo que estaba entrando en ese momento ya no cuenta. */
  generacion = 0;

  /** Devuelve false si es un duplicado o un reintento antiguo de Meta. */
  recibir(mensaje: Entrante, procesar: Procesador): Promise<boolean> {
    const generacion = this.generacion;
    const turno = this.entrada.then(() => this.admitir(mensaje, procesar, generacion));
    this.entrada = turno.catch(() => {});
    return turno;
  }

  private async admitir(mensaje: Entrante, procesar: Procesador, generacion: number): Promise<boolean> {
    if (!(await registrarMensaje(mensaje.wamid))) return false;
    if (generacion !== this.generacion) return false;
    if (Date.now() - mensaje.ts > MENSAJE_VIEJO_MS) return false;

    const { telefono } = mensaje;
    const hilo = this.hilos.get(telefono) ?? { acumulado: [] };
    this.hilos.set(telefono, hilo);
    hilo.acumulado.push(mensaje);

    // Si aún no se ha contestado, se cancela y se rehace con todos los mensajes juntos.
    if (hilo.ejecucion && !hilo.ejecucion.enviando) hilo.ejecucion.controlador.abort();

    clearTimeout(hilo.temporizador);
    hilo.temporizador = setTimeout(() => this.cerrarLote(telefono, procesar), SILENCIO_MS);
    return true;
  }

  private cerrarLote(telefono: string, procesar: Procesador): void {
    const hilo = this.hilos.get(telefono);
    if (!hilo || hilo.acumulado.length === 0) return;
    const lote: Lote = { loteId: randomUUID(), telefono, mensajes: [...hilo.acumulado] };
    const ejecucion: Ejecucion = { controlador: new AbortController(), enviando: false };
    hilo.ejecucion = ejecucion;
    this.cola = this.cola.then(() => procesar(lote, ejecucion)).catch((error) => logError("al procesar un lote", error));
  }

  /** Marca el punto sin retorno: lo que lleva este lote ya está contestado. */
  empezarEnvio(ejecucion: Ejecucion, lote: Lote): void {
    ejecucion.enviando = true;
    const hilo = this.hilos.get(lote.telefono);
    if (!hilo) return;
    const contestados = new Set(lote.mensajes.map((m) => m.wamid));
    hilo.acumulado = hilo.acumulado.filter((m) => !contestados.has(m.wamid));
  }

  /**
   * Alguien del equipo coge la conversación desde el panel. Si el asistente le estaba contestando y
   * aún no ha enviado nada, se cancela, y esos mensajes se vuelven a procesar: se guardan y, como ya
   * los lleva una persona, no se contestan.
   */
  tomarControl(telefono: string, procesar: Procesador): void {
    const hilo = this.hilos.get(telefono);
    if (!hilo?.ejecucion || hilo.ejecucion.enviando) return;
    hilo.ejecucion.controlador.abort();
    clearTimeout(hilo.temporizador);
    this.cerrarLote(telefono, procesar);
  }

  /**
   * Se borran los datos de un cliente (RGPD): lo que quedaba por contestar de ese número se tira
   * sin procesarlo, porque procesarlo volvería a crear el lead y a guardar sus mensajes. A
   * diferencia de tomarControl, no se cierra un lote nuevo. Lo que ya se está enviando no se puede
   * deshacer: se deja terminar, y lo que intente guardar después no encuentra el lead y no hace nada.
   * Los demás números no se tocan.
   */
  olvidar(telefono: string): void {
    const hilo = this.hilos.get(telefono);
    if (!hilo) return;
    clearTimeout(hilo.temporizador);
    if (hilo.ejecucion && !hilo.ejecucion.enviando) hilo.ejecucion.controlador.abort();
    this.hilos.delete(telefono);
  }

  reiniciar(): void {
    this.generacion++;
    for (const hilo of this.hilos.values()) {
      clearTimeout(hilo.temporizador);
      hilo.ejecucion?.controlador.abort();
    }
    this.hilos.clear();
  }
}

const global_ = globalThis as unknown as { __buzon?: Buzon };

export const buzon = (global_.__buzon ??= new Buzon());
