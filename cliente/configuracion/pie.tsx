"use client";

import { Download } from "lucide-react";
import { useState, type JSX } from "react";
import { confirmar } from "../confirmaciones";
import { borrarEjemplos, cargarEjemplos } from "../datos";
import { useFrases } from "../negocio";
import { BOTON, BOTON_PRINCIPAL, Dialogo, ENLACE, MARGEN_ANCLA } from "./controles";
import type { PropsBloque } from "./negocio";

// El pie de Ajustes, entre los bloques y «Avanzado»: los clientes de ejemplo y la descarga en CSV.

export function Pie({ datos, recargar, refrescar }: PropsBloque): JSX.Element {
  const frases = useFrases();
  const [ocupado, setOcupado] = useState<"cargar" | "borrar" | null>(null);
  const [preguntando, setPreguntando] = useState(false);
  const hayEjemplos = datos.ejemplos.ejemplo > 0;
  const clientes = frases.seccionClientes.toLowerCase();

  const cargar = async () => {
    setOcupado("cargar");
    const error = await cargarEjemplos();
    setOcupado(null);
    if (error) {
      confirmar(error, { tono: "error" });
      return;
    }
    confirmar("Ejemplos cargados");
    void refrescar();
    void recargar();
  };

  const borrar = async () => {
    setOcupado("borrar");
    const error = await borrarEjemplos();
    setOcupado(null);
    setPreguntando(false);
    if (error) {
      confirmar(error, { tono: "error" });
      return;
    }
    confirmar("Ejemplos borrados");
    void refrescar();
    void recargar();
  };

  return (
    <div className={`${MARGEN_ANCLA} flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[14px] border border-linea bg-white px-6 py-4 max-sm:px-4`}>
      <div className="flex items-center gap-3 max-lg:flex-wrap">
        <span className="text-[14px] leading-5 font-medium">{frases.seccionClientes} de ejemplo:</span>
        <button type="button" onClick={() => void cargar()} disabled={ocupado !== null} className={BOTON}>
          {ocupado === "cargar" ? "Cargando…" : "Cargar"}
        </button>
        <button type="button" onClick={() => setPreguntando(true)} disabled={ocupado !== null || !hayEjemplos} className={BOTON}>
          Borrar
        </button>
      </div>
      <a href="/api/exportar" download className={`inline-flex items-center gap-1.5 ${ENLACE}`}>
        <Download aria-hidden className="size-4" strokeWidth={1.75} />
        Descargar en Excel (CSV)
      </a>
      <Dialogo
        abierto={preguntando}
        cerrar={() => ocupado === null && setPreguntando(false)}
        titulo={`¿Borrar los ${clientes} de ejemplo?`}
        descripcion={`Se borran los ${clientes} de ejemplo. Tus ${clientes} reales se quedan.`}
        acciones={
          <>
            <button type="button" onClick={() => setPreguntando(false)} disabled={ocupado !== null} className={BOTON}>
              Cancelar
            </button>
            <button type="button" onClick={() => void borrar()} disabled={ocupado !== null} className={BOTON_PRINCIPAL}>
              {ocupado === "borrar" ? "Borrando…" : "Borrar"}
            </button>
          </>
        }
      />
    </div>
  );
}
