"use client";

import { useEffect, useRef, type CSSProperties } from "react";

export interface MensajeEjemplo {
  de: "agente" | "cliente";
  texto: string;
}

/** Aparece una sola vez, mensaje a mensaje, al llegar a ella. Sin JavaScript se ve entera. */
export function ConversacionEjemplo({ mensajes }: { mensajes: MensajeEjemplo[] }) {
  const lista = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const elemento = lista.current;
    if (!elemento) return;
    elemento.dataset.estado = "espera";
    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (!entrada.isIntersecting) return;
        elemento.dataset.estado = "visible";
        observador.disconnect();
      },
      { threshold: 0.4 },
    );
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  return (
    <ol ref={lista} aria-label="Conversación de ejemplo" className="burbujas flex flex-col gap-2.5 text-[14px] leading-5">
      {mensajes.map((mensaje, orden) => (
        <li
          key={orden}
          style={{ "--orden": orden } as CSSProperties}
          className={
            mensaje.de === "agente"
              ? "max-w-[88%] self-start rounded-[18px] rounded-bl-[6px] border border-white/25 bg-white/10 px-3.5 py-2.5"
              : "max-w-[88%] self-end rounded-[18px] rounded-br-[6px] bg-white px-3.5 py-2.5 text-[#111]"
          }
        >
          {mensaje.texto}
        </li>
      ))}
    </ol>
  );
}
