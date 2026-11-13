"use client";

import { useEffect, useState, type ReactNode } from "react";

// La barra de la portada al bajar: fija arriba, con su margen, en cuanto la cabecera de la primera
// pantalla deja de verse. Antes no hace falta (esa cabecera ya está a la vista) y no se pinta encima.
// Aparece sin animar, como todo al entrar.

export function BarraAlBajar({ className, children }: { className: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const cabecera = document.getElementById("cabecera-portada");
    if (!cabecera || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver(([entrada]) => setVisible(!entrada.isIntersecting));
    observador.observe(cabecera);
    return () => observador.disconnect();
  }, []);

  return (
    <header className={`${className} ${visible ? "" : "invisible"}`} inert={!visible} aria-hidden={!visible || undefined}>
      {children}
    </header>
  );
}
