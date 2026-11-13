"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

// Avisos breves de «guardado», abajo en el centro. Cualquier parte del panel los lanza con confirmar().
// El aviso de «Te toca» va aparte, abajo a la derecha (avisos.tsx).

const EVENTO = "crm:confirmacion";
const DURACION_MS = 2_400;
const DURACION_CON_ACCION_MS = 6_000;

interface Accion {
  texto: string;
  hacer: () => void;
}

interface Detalle {
  texto: string;
  accion?: Accion;
  ms: number;
  tono: "normal" | "error";
}

export function confirmar(texto: string, o?: { accion?: { texto: string; hacer: () => void }; ms?: number; tono?: "normal" | "error" }): void {
  const detalle: Detalle = {
    texto,
    accion: o?.accion,
    ms: o?.ms ?? (o?.accion ? DURACION_CON_ACCION_MS : DURACION_MS),
    tono: o?.tono ?? "normal",
  };
  window.dispatchEvent(new CustomEvent<Detalle>(EVENTO, { detail: detalle }));
}

export function Confirmaciones() {
  const [avisos, setAvisos] = useState<(Detalle & { id: number; cerrar: () => void })[]>([]);

  useEffect(() => {
    let siguiente = 0;
    const temporizadores = new Set<ReturnType<typeof setTimeout>>();
    const alRecibir = (evento: Event) => {
      const id = siguiente++;
      const detalle = (evento as CustomEvent<Detalle>).detail;
      const quitar = () => setAvisos((lista) => lista.filter((a) => a.id !== id));
      const temporizador = setTimeout(() => {
        quitar();
        temporizadores.delete(temporizador);
      }, detalle.ms);
      temporizadores.add(temporizador);
      const cerrar = () => {
        clearTimeout(temporizador);
        temporizadores.delete(temporizador);
        quitar();
      };
      // Como mucho tres a la vez: si se encadenan cambios, los viejos se van antes.
      setAvisos((lista) => [...lista.slice(-2), { ...detalle, id, cerrar }]);
    };
    window.addEventListener(EVENTO, alRecibir);
    return () => {
      window.removeEventListener(EVENTO, alRecibir);
      temporizadores.forEach(clearTimeout);
    };
  }, []);

  return (
    // Por encima de todo: los diálogos (z-65), la paleta (z-55) y la ficha (z-50). Con left-1/2 el ancho
    // disponible sería media pantalla y en el móvil el aviso se partía en dos líneas: w-max lo evita.
    <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
      {avisos.map((a) => (
        <div
          key={a.id}
          role={a.tono === "error" ? "alert" : undefined}
          className={`confirmacion flex max-w-[min(560px,calc(100vw-32px))] items-center gap-2.5 rounded-full bg-tinta py-2 pl-2.5 text-[13px] leading-[18px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${
            a.accion ? "pointer-events-auto pr-3" : "pr-4"
          }`}
        >
          {a.tono === "error" ? (
            <span aria-hidden className="mx-1.5 size-2 shrink-0 rounded-full bg-error" />
          ) : (
            <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ok">
              <Check className="size-3.5" strokeWidth={2.5} />
            </span>
          )}
          <span className="min-w-0">{a.texto}</span>
          {a.accion && (
            <button
              type="button"
              onClick={() => {
                a.accion?.hacer();
                a.cerrar();
              }}
              className="ml-1 shrink-0 cursor-pointer rounded-[4px] text-[13px] leading-[18px] font-medium text-white underline decoration-white/50 underline-offset-[3px] transition-colors duration-150 ease-out hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {a.accion.texto}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
