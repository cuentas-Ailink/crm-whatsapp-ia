"use client";

import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { volvioAEscribir } from "@/lib/hilo";
import { esEjemplo } from "@/lib/negocio";
import type { Bd, Lead } from "@/lib/tipos";
import { confirmar } from "./confirmaciones";
import { cambiarEtapa, cerrarVisita } from "./datos";
import { useNegocio } from "./negocio";
import { Avatar, ChipEjemplo, etapaDe } from "./piezas";

// Fuera del tablero: la publicidad (a la que el asistente no contesta) y los clientes cerrados.
// Dos listas sencillas que se abren desde «Publicidad (n) · Cerrados (n)».

export function ListaAparte(p: { tipo: "publicidad" | "cerrados"; bd: Bd; ahora: Date; abrir: (id: string) => void; volver: () => void }) {
  const { tipo, bd, abrir, volver } = p;
  const { frases, formato } = useNegocio();
  const todos = Object.values(bd.leads);
  const filas =
    tipo === "publicidad"
      ? todos.filter((l) => l.estado === "spam").sort((a, b) => b.cambioEstadoEn - a.cambioEstadoEn)
      : todos
          .filter((l) => !!l.cierre && l.estado !== "spam")
          .sort((a, b) => Number(volvioAEscribir(b)) - Number(volvioAEscribir(a)) || (b.cierreEn ?? 0) - (a.cierreEn ?? 0));
  const titulo = tipo === "publicidad" ? frases.publicidad : frases.cerrados;
  const vacio =
    tipo === "publicidad"
      ? "Aquí saldrán los mensajes de publicidad. Tu asistente no les contesta."
      : "Aquí saldrán los clientes que te digan que sí o que no sigan.";

  return (
    <section aria-labelledby="lista-aparte-titulo" className="flex flex-col gap-3">
      <div className="flex items-center gap-3 max-lg:flex-wrap max-lg:gap-y-1">
        <button
          type="button"
          onClick={volver}
          className="inline-flex h-8 cursor-pointer max-lg:min-h-11 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-secundario transition-colors duration-150 ease-out hover:bg-white hover:text-tinta"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Volver al tablero
        </button>
        <h2 id="lista-aparte-titulo" className="text-[15px] leading-5 font-medium">
          {titulo} <span className="font-normal text-secundario tabular-nums">{filas.length}</span>
        </h2>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-linea bg-white">
        {filas.length === 0 ? (
          <p className="px-5 py-8 text-center text-[14px] leading-5 text-secundario">{vacio}</p>
        ) : (
          <ul>
            {filas.map((lead) => (
              <Fila key={lead.id} lead={lead} tipo={tipo} abrir={abrir} frases={frases} formato={formato} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Fila(p: {
  lead: Lead;
  tipo: "publicidad" | "cerrados";
  abrir: (id: string) => void;
  frases: ReturnType<typeof useNegocio>["frases"];
  formato: ReturnType<typeof useNegocio>["formato"];
}) {
  const { lead, tipo, abrir, frases, formato } = p;
  const [ocupado, setOcupado] = useState(false);
  const vuelve = tipo === "cerrados" && volvioAEscribir(lead);

  const actuar = async () => {
    setOcupado(true);
    const error =
      tipo === "publicidad" ? await cambiarEtapa(lead.id, "no-spam") : await cerrarVisita(lead.id, { accion: "reabrir" });
    setOcupado(false);
    if (error) confirmar(error, { tono: "error" });
    else confirmar(tipo === "publicidad" ? "Ya no está en Publicidad" : "Reabierto");
  };

  // Las partes de la segunda línea, separadas por « · ».
  const partes: { clave: string; texto: string; clase: string }[] =
    tipo === "publicidad"
      ? [
          ...(lead.motivoSpam ? [{ clave: "motivo", texto: lead.motivoSpam, clase: "text-secundario" }] : []),
          { clave: "fecha", texto: formato.corta(lead.cambioEstadoEn), clase: "text-secundario tabular-nums" },
        ]
      : [
          lead.cierre === "si"
            ? {
                clave: "cierre",
                texto: frases.haDichoQueSi + (lead.presupuesto !== undefined ? ` · ${formato.importe(lead.presupuesto)}` : ""),
                clase: "text-ok-texto",
              }
            : { clave: "cierre", texto: frases.noSigue + (lead.motivoCierre ? ` · ${lead.motivoCierre}` : ""), clase: "text-secundario" },
          ...(lead.cierreEn !== undefined ? [{ clave: "fecha", texto: formato.corta(lead.cierreEn), clase: "text-secundario tabular-nums" }] : []),
          ...(vuelve ? [{ clave: "vuelve", texto: "Ha vuelto a escribir", clase: "font-medium text-atencion-texto" }] : []),
        ];
  const detalle = partes.map((parte, i) => (
    <span key={parte.clave} className={`min-w-0 ${parte.clase}`}>
      {i > 0 && <span className="text-secundario"> · </span>}
      {parte.texto}
    </span>
  ));

  return (
    <li className="flex items-center gap-3 border-b border-linea px-4 py-3 last:border-b-0 max-lg:flex-wrap max-lg:gap-y-2">
      <Avatar nombre={lead.nombre} color={etapaDe(lead.estado).color} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => abrir(lead.id)}
            className="min-w-0 cursor-pointer text-left text-[14px] leading-5 font-medium break-words hover:underline hover:underline-offset-2 max-lg:-my-3 max-lg:py-3"
          >
            {lead.nombre}
          </button>
          {esEjemplo(lead) && <ChipEjemplo />}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center text-[13px] leading-[18px] whitespace-pre-wrap">{detalle}</div>
      </div>
      {/* En el móvil, la acción va debajo del texto, alineada con él. */}
      <div className="flex shrink-0 max-lg:basis-full max-lg:pl-12">
        <button
          type="button"
          onClick={actuar}
          disabled={ocupado}
          className="h-8 shrink-0 cursor-pointer rounded-[8px] border border-linea bg-white px-3 text-[13px] transition-colors duration-150 ease-out hover:bg-lienzo disabled:cursor-default disabled:opacity-60 max-lg:min-h-11"
        >
          {tipo === "publicidad" ? "No es publicidad" : frases.reabrir}
        </button>
      </div>
    </li>
  );
}
