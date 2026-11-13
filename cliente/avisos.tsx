"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { FilaTeToca, MotivoTeToca } from "@/lib/inicio";

// El aviso de «Te toca»: uno solo, abajo a la derecha, 6 s. Si llega otro, lo sustituye. Al pulsarlo se
// abre la ficha del cliente. Lo decide el panel (solo clientes de verdad que empiezan a esperarte).

const DURACION_MS = 6_000;

/** El color del motivo, el mismo en «Hoy» y aquí: rojo si algo ha fallado, ámbar si te toca, gris si no corre prisa. */
export function colorMotivo(motivo: MotivoTeToca): string {
  if (motivo === "sinContestar") return "text-error-texto";
  if (motivo === "visitaPasada") return "text-secundario";
  return "text-atencion-texto";
}

export interface AvisoTeToca {
  fila: FilaTeToca;
  /** Cambia con cada aviso nuevo, aunque sea del mismo cliente: reinicia los 6 s. */
  n: number;
}

export function Avisos({ aviso, abrir, cerrar }: { aviso: AvisoTeToca | null; abrir: (id: string) => void; cerrar: () => void }) {
  const nodo = useRef<HTMLDivElement>(null);
  const cerrarActual = useRef(cerrar);
  useLayoutEffect(() => {
    cerrarActual.current = cerrar;
  });

  const n = aviso?.n;
  useEffect(() => {
    if (n === undefined) return;
    const temporizador = setTimeout(() => cerrarActual.current(), DURACION_MS);
    return () => clearTimeout(temporizador);
  }, [n]);

  // Entra con un fundido corto: es algo que pasa en directo, así que puede moverse.
  useLayoutEffect(() => {
    if (n === undefined || !nodo.current) return;
    if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    nodo.current.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 200, easing: "cubic-bezier(0, 0, 0.2, 1)" },
    );
  }, [n]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-6 bottom-6 z-[45] w-[360px] max-lg:inset-x-4 max-lg:bottom-4 max-lg:w-auto">
      {aviso && (
        <div
          ref={nodo}
          className="pointer-events-auto relative overflow-hidden rounded-[12px] border border-linea bg-white shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
        >
          <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-atencion" />
          <button
            type="button"
            onClick={() => {
              cerrar();
              abrir(aviso.fila.leadId);
            }}
            className="block w-full cursor-pointer py-3.5 pr-12 pl-5 text-left text-[14px] leading-5 break-words max-lg:pr-14 transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
          >
            <span className="font-medium">Te toca: {aviso.fila.nombre}</span>
            <span className="text-secundario"> · </span>
            <span className={colorMotivo(aviso.fila.motivo)}>{aviso.fila.texto}</span>
          </button>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar aviso"
            className="absolute top-2.5 right-2.5 flex size-8 cursor-pointer max-lg:top-1 max-lg:right-1 max-lg:size-11 items-center justify-center rounded-[8px] text-secundario transition-colors duration-150 ease-out hover:bg-lienzo hover:text-tinta focus-visible:outline-2 focus-visible:outline-tinta"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      )}
    </div>
  );
}
