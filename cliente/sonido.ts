"use client";

import { useSyncExternalStore } from "react";

// Los dos sonidos del panel, hechos con Web Audio (sin archivos): «llegada» cuando sale el primer
// WhatsApp a un cliente nuevo y «turno» cuando alguien empieza a esperarte. El navegador no deja sonar
// nada hasta el primer clic o tecla: desbloquearSonido() se llama entonces. Silenciado, no suena.

const CLAVE = "crm:sonido";

type Ventana = Window & { webkitAudioContext?: typeof AudioContext };

let contexto: AudioContext | null = null;
let silencio = leerSilencio();
const oyentes = new Set<() => void>();

function leerSilencio(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLAVE) === "no";
  } catch {
    return false;
  }
}

/** Crea el contexto de audio con el primer gesto del usuario (la política de reproducción automática). */
export function desbloquearSonido(): void {
  if (typeof window === "undefined") return;
  try {
    if (!contexto) {
      const Constructor = window.AudioContext ?? (window as Ventana).webkitAudioContext;
      if (!Constructor) return;
      contexto = new Constructor();
    }
    if (contexto.state === "suspended") void contexto.resume().catch(() => undefined);
  } catch {
    contexto = null;
  }
}

// Los números son los de F49: el mismo envolvente para las cuatro notas.
const ATAQUE_S = 0.01;
const CAIDA_S = 0.3;
const VOLUMEN = 0.08;

/** Una nota sinusoidal: sube en 10 ms hasta 0,08 y se apaga en 300 ms. */
function nota(ctx: AudioContext, frecuencia: number, empieza: number): void {
  const oscilador = ctx.createOscillator();
  const ganancia = ctx.createGain();
  oscilador.type = "sine";
  oscilador.frequency.setValueAtTime(frecuencia, empieza);
  ganancia.gain.setValueAtTime(0.0001, empieza);
  ganancia.gain.exponentialRampToValueAtTime(VOLUMEN, empieza + ATAQUE_S);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, empieza + ATAQUE_S + CAIDA_S);
  oscilador.connect(ganancia).connect(ctx.destination);
  oscilador.start(empieza);
  oscilador.stop(empieza + ATAQUE_S + CAIDA_S + 0.02);
}

/** No hace nada si está silenciado o si el navegador aún no deja sonar. Nunca lanza. */
export function sonar(tipo: "llegada" | "turno"): void {
  if (silencio || !contexto || contexto.state !== "running") return;
  try {
    const t = contexto.currentTime + 0.01;
    if (tipo === "llegada") {
      // Dos notas que suben, 659 Hz y 988 Hz con 120 ms entre ellas: algo ha salido bien.
      nota(contexto, 659, t);
      nota(contexto, 988, t + 0.12);
    } else {
      // Dos golpes iguales de 440 Hz con 160 ms entre ellos: te toca a ti.
      nota(contexto, 440, t);
      nota(contexto, 440, t + 0.16);
    }
  } catch {
    // Sin audio no pasa nada: el aviso visual sigue ahí.
  }
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => {
    oyentes.delete(avisar);
  };
}

const leer = () => silencio;
const leerServidor = () => false;

/** [silenciado, cambiar]. Se recuerda en este navegador; si no se puede guardar, dura hasta recargar. */
export function useSilencio(): [boolean, (silencio: boolean) => void] {
  const valor = useSyncExternalStore(suscribir, leer, leerServidor);
  const cambiar = (nuevo: boolean) => {
    silencio = nuevo;
    try {
      if (nuevo) window.localStorage.setItem(CLAVE, "no");
      else window.localStorage.removeItem(CLAVE);
    } catch {
      // Navegación privada: no se guarda.
    }
    for (const oyente of oyentes) oyente();
  };
  return [valor, cambiar];
}
