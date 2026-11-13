"use client";

import { Check, CheckCheck, CircleAlert, Mic } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { CUERPOS_CONOCIDOS } from "@/lib/configuracion";
import { agruparMensajes, asistenteCallado, esperaDesde, type Grupo } from "@/lib/hilo";
import type { Lead, Mensaje } from "@/lib/tipos";
import { useNegocio } from "./negocio";
import { haceCuanto } from "./piezas";

// La conversación con el cliente, como en WhatsApp: el cliente a la izquierda, lo que sale del
// negocio a la derecha, la hora dentro de cada burbuja con las marcas de entrega de Meta, los días
// separados y los mensajes seguidos agrupados. Un hilo corto se queda pegado abajo, junto a la caja.

/** El verde de la burbuja del asistente: el color de la marca, muy claro. */
const FONDO_ASISTENTE = "color-mix(in oklab, var(--color-marca) 14%, white)";

function Entrega({ m }: { m: Mensaje }) {
  switch (m.entrega) {
    case "enviado":
      return <Check role="img" aria-label="Enviado" className="size-3.5 text-secundario" strokeWidth={2} />;
    case "entregado":
      return <CheckCheck role="img" aria-label="Entregado" className="size-3.5 text-secundario" strokeWidth={2} />;
    case "leido":
      return <CheckCheck role="img" aria-label="Leído" className="size-3.5 text-[#53bdeb]" strokeWidth={2} />;
    default:
      return null;
  }
}

function Burbuja({ m, tipo, ultima }: { m: Mensaje; tipo: Grupo["tipo"]; ultima: boolean }) {
  const { formato } = useNegocio();
  const deCliente = tipo === "cliente";
  const fallido = !deCliente && m.entrega === "fallido";
  const conMarca = !deCliente && (m.entrega === "enviado" || m.entrega === "entregado" || m.entrega === "leido");
  const esquina = ultima ? (deCliente ? "rounded-bl-[4px]" : "rounded-br-[4px]") : "";
  const fondo = deCliente ? "bg-white" : tipo === "manual" ? "bg-fondo" : "";

  return (
    <div
      className={`relative max-w-[78%] rounded-[12px] px-3 pt-1.5 pb-1.5 text-[14px] leading-5 shadow-[0_1px_1px_rgba(20,20,20,0.05)] ${esquina} ${fondo} ${
        deCliente ? "self-start" : "self-end"
      }`}
      style={!deCliente && tipo !== "manual" ? { background: FONDO_ASISTENTE } : undefined}
    >
      {m.audio && (
        <span className="mb-0.5 flex items-center gap-1 text-[11px] leading-4 font-medium text-secundario">
          <Mic aria-hidden className="size-3" strokeWidth={2} />
          Nota de voz · transcrita
        </span>
      )}
      <p className="break-words whitespace-pre-wrap">
        {m.texto}
        {/* El hueco de la hora, para que no pise la última línea. */}
        {!fallido && <span aria-hidden className={`inline-block h-3 ${conMarca ? "w-[58px]" : "w-[42px]"}`} />}
      </p>
      {fallido ? (
        <span className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px] leading-4 tabular-nums">
          <span className="text-secundario">{formato.hora(m.ts)}</span>
          <span className="font-medium text-error-texto" title={m.fallo} aria-label={`No entregado: ${m.fallo ?? ""}`.trim()}>
            No entregado
          </span>
        </span>
      ) : (
        <span className="absolute right-2.5 bottom-1.5 flex items-center gap-1 text-[11px] leading-4 text-secundario tabular-nums">
          {formato.hora(m.ts)}
          {conMarca && <Entrega m={m} />}
        </span>
      )}
    </div>
  );
}

function Escribiendo() {
  return (
    <div className="flex flex-col items-end gap-1" role="status">
      <div className="flex items-center gap-2 rounded-[12px] rounded-br-[4px] px-3 py-2 text-[13px] leading-[18px] text-tinta/70" style={{ background: FONDO_ASISTENTE }}>
        <span aria-hidden className="flex gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-[5px] rounded-full bg-tinta/60 motion-safe:animate-escribiendo"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
        Tu asistente está escribiendo…
      </div>
    </div>
  );
}

export function Hilo(p: { lead: Lead; escribiendo: boolean; ahora: number; contestarYo: () => void }) {
  const { lead, escribiendo, ahora } = p;
  const { zona, cfg } = useNegocio();
  const caja = useRef<HTMLDivElement>(null);

  const bienvenidas = useMemo(() => [cfg.plantilla.nombre, ...Object.keys(CUERPOS_CONOCIDOS)], [cfg.plantilla.nombre]);
  // «Hoy» y «Ayer» dependen del día, no del minuto: con el reloj, el hilo se reagrupa como mucho cada hora.
  const hora = Math.floor(ahora / 3_600_000);
  const items = useMemo(
    () => agruparMensajes(lead.mensajes, { zona, ahora, nombreCliente: lead.nombre, bienvenidas }),
    [lead.mensajes, zona, hora, lead.nombre, bienvenidas],
  );

  const asistente = cfg.sistema.asistente;
  const pausadoEn = asistente.activo ? null : (asistente.pausadoEn ?? ahora);
  const callado = asistenteCallado(lead, ahora, escribiendo, pausadoEn);
  const desde = esperaDesde(lead);

  // Al abrir, al llegar un mensaje y mientras escribe, se baja hasta el final.
  const total = lead.mensajes.length;
  useLayoutEffect(() => {
    const nodo = caja.current;
    if (nodo) nodo.scrollTop = nodo.scrollHeight;
  }, [lead.id, total, escribiendo, callado]);

  return (
    <div ref={caja} className="min-h-0 flex-1 overflow-y-auto bg-lienzo" aria-label="Mensajes" role="log">
      <div className="flex min-h-full flex-col justify-end gap-3 px-5 py-5">
        {total === 0 && <p className="m-auto text-[13px] leading-[18px] text-secundario">Aún no hay mensajes.</p>}

        {items.map((item, i) =>
          item.tipo === "dia" ? (
            <div key={`dia-${i}`} className="flex justify-center pt-1">
              <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[12px] leading-4 text-secundario shadow-[0_1px_1px_rgba(20,20,20,0.04)]">
                {item.texto}
              </span>
            </div>
          ) : (
            <div key={item.grupo.mensajes[0].id} className={`flex flex-col gap-0.5 ${item.grupo.tipo === "cliente" ? "items-start" : "items-end"}`}>
              {item.grupo.tipo !== "cliente" && (
                <span className="mb-0.5 px-1 text-[11px] leading-4 font-medium text-secundario">{item.grupo.remitente}</span>
              )}
              {item.grupo.mensajes.map((m, j) => (
                <Burbuja key={m.id} m={m} tipo={item.grupo.tipo} ultima={j === item.grupo.mensajes.length - 1} />
              ))}
            </div>
          ),
        )}

        {escribiendo && <Escribiendo />}

        {callado === "fallo" && desde !== null && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 pt-1 text-[13px] leading-[18px] text-error-texto">
            <span className="flex items-center gap-1.5">
              <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
              Tu asistente no ha contestado · {haceCuanto(desde, new Date(ahora))}
            </span>
            <button
              type="button"
              onClick={p.contestarYo}
              className="h-8 cursor-pointer rounded-[8px] border border-linea bg-white px-3 text-[13px] font-medium text-tinta transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
            >
              Contestar yo
            </button>
          </div>
        )}
        {callado === "pausa" && (
          <p className="flex items-center justify-center gap-1.5 pt-1 text-[13px] leading-[18px] text-atencion-texto">
            <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            Asistente apagado · espera respuesta
          </p>
        )}
      </div>
    </div>
  );
}
