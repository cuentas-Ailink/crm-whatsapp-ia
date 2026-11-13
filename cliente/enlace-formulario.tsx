"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * Sube al formulario y deja el cursor en el primer campo: en la primera pantalla, sin el cursor, el clic no
 * se notaría. Con el botón de WhatsApp en vez del formulario, sube y deja el foco en el botón.
 */
export function EnlaceFormulario({ className, children }: { className: string; children: ReactNode }) {
  const alPulsar = (evento: MouseEvent) => {
    const campo =
      document.querySelector<HTMLInputElement>('form:not([aria-hidden="true"]) input[name="demo-nombre"]') ??
      document.querySelector<HTMLAnchorElement>("a[data-boton-whatsapp]");
    if (!campo) return;
    // Un enlace normal perdería el foco al llegar al ancla.
    evento.preventDefault();
    window.scrollTo({ top: 0 });
    campo.focus({ preventScroll: true });
  };

  return (
    <a href="#contacto" onClick={alPulsar} className={className}>
      {children}
    </a>
  );
}
