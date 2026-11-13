import { Check, type LucideIcon } from "lucide-react";
import type { JSX } from "react";

// La tarjeta de «¿Qué negocio es?», igual en la puesta en marcha y en Ajustes: blanca, con el borde
// oscuro y la marca ✓ en la elegida. El que la usa pone el control (un radio o un botón con role=radio).

/** El marco: siempre el mismo grosor de borde, así elegir no mueve nada. */
export function claseTarjetaNegocio(elegida: boolean): string {
  return `relative flex h-full min-h-[124px] flex-col items-start gap-3 rounded-[12px] border-[1.5px] bg-white p-4 text-left text-tinta transition-colors duration-150 ease-out ${
    elegida ? "cursor-default border-tinta" : "cursor-pointer border-linea hover:border-tinta/30"
  }`;
}

/** Lo de dentro: el icono, la marca si está elegida, el nombre y la línea que lo explica. */
export function ContenidoTarjetaNegocio(p: { Icono: LucideIcon; titulo: string; detalle?: string; elegida: boolean }): JSX.Element {
  const { Icono } = p;
  return (
    <>
      <span aria-hidden className="flex size-9 items-center justify-center rounded-[9px] bg-lienzo text-tinta">
        <Icono className="size-[18px]" strokeWidth={1.75} />
      </span>
      {p.elegida && (
        <span aria-hidden className="absolute top-3.5 right-3.5 flex size-5 items-center justify-center rounded-full bg-tinta text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      <span className="flex flex-col gap-1">
        <span className="text-[15px] leading-5 font-medium">{p.titulo}</span>
        {p.detalle && <span className="text-[13px] leading-[18px] break-words text-secundario">{p.detalle}</span>}
      </span>
    </>
  );
}
