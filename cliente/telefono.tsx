"use client";

import { Copy, Phone } from "lucide-react";
import { esEjemplo } from "@/lib/negocio";
import type { Lead } from "@/lib/tipos";
import { confirmar } from "./confirmaciones";
import { useNegocio } from "./negocio";

// El teléfono entero, para llamarle o copiarlo. Un contacto de ejemplo no tiene número de verdad.

export const BOTON_PEQUENO =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border border-linea bg-white px-2.5 text-[13px] leading-[18px] transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta";

async function copiar(texto: string): Promise<void> {
  try {
    // Sin contexto seguro (o sin permiso) no hay portapapeles: el número sigue ahí para seleccionarlo.
    if (!navigator.clipboard) throw new Error("Sin portapapeles");
    await navigator.clipboard.writeText(texto);
    confirmar("Copiado");
  } catch {
    confirmar("No se ha podido copiar", { tono: "error" });
  }
}

export function Telefono({ lead }: { lead: Lead }) {
  const { formato, frases } = useNegocio();

  if (esEjemplo(lead)) {
    return <p className="text-[13px] leading-[18px] text-secundario">{frases.contactoEjemplo}</p>;
  }

  const numero = formato.telefono(lead.telefono);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <span className="text-[15px] leading-5 font-medium tabular-nums select-text">{numero}</span>
      <span className="flex gap-1.5">
        <a href={`tel:+${lead.telefono}`} className={BOTON_PEQUENO}>
          <Phone aria-hidden className="size-3.5" strokeWidth={1.75} />
          Llamar
        </a>
        <button type="button" onClick={() => void copiar(numero)} className={BOTON_PEQUENO}>
          <Copy aria-hidden className="size-3.5" strokeWidth={1.75} />
          Copiar
        </button>
      </span>
    </div>
  );
}
