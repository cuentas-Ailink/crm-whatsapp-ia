"use client";

import type { CSSProperties } from "react";
import { diasDeAgenda, fechaEn, lunesDe, momentoDeHueco, sumarDias, textoDia, textoDiasCabecera } from "@/lib/agenda";
import type { Bd, Reserva } from "@/lib/tipos";
import { cap, nombreDePila } from "@/lib/vocabulario";
import { abrirCliente } from "./navegacion";
import { useNegocio } from "./negocio";

// La Agenda: solo las citas, apiladas por día durante dos semanas, una semana por fila. Las pasadas en
// gris, las de ejemplo con borde discontinuo. Nada se esconde y nada sobra: cada semana mide lo que
// miden sus citas. En una pantalla estrecha, las mismas citas en una columna: hoy y los días que
// vienen con alguna, cada uno con su cabecera.

/**
 * Los días de la columna estrecha: hoy siempre (aunque no tenga citas) y, después, cada día del tramo
 * que tenga alguna. Los de esta semana anteriores a hoy solo salen en la cuadrícula.
 */
function diasEnColumna(porDia: Map<string, Reserva[]>, hoy: string): { dia: string; reservas: Reserva[] }[] {
  const despues = [...porDia].filter(([dia, reservas]) => dia > hoy && reservas.length > 0);
  return [{ dia: hoy, reservas: porDia.get(hoy) ?? [] }, ...despues.map(([dia, reservas]) => ({ dia, reservas }))];
}

/** 0 = lunes … 6 = domingo. */
function posicionEnSemana(fecha: string): number {
  return (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function VistaAgenda({ bd, ahora, abrir }: { bd: Bd; ahora: Date; abrir?: (id: string) => void }) {
  const { cfg, frases, zona } = useNegocio();
  const abiertos = diasDeAgenda(ahora, cfg.calendario);
  const desde = abiertos.length > 0 ? lunesDe(abiertos[0]) : null;
  const hasta = desde ? sumarDias(desde, 13) : null;
  const dentro = (dia: string) => desde !== null && hasta !== null && dia >= desde && dia <= hasta;

  const reservas = bd.reservas.filter((r) => dentro(r.huecoId.split("T")[0]));
  // Un día cerrado después de reservar sigue enseñando sus citas.
  const dias = [...new Set([...abiertos, ...reservas.map((r) => r.huecoId.split("T")[0])])].sort();
  const porDia = new Map<string, Reserva[]>(dias.map((d) => [d, []]));
  for (const r of [...reservas].sort((a, b) => a.huecoId.localeCompare(b.huecoId))) porDia.get(r.huecoId.split("T")[0])?.push(r);

  // Las columnas son los días de la semana que salen en alguna de las dos: así cada día cae bajo el suyo.
  const posiciones = [...new Set(dias.map(posicionEnSemana))].sort((a, b) => a - b);
  const semanas = [...new Set(dias.map(lunesDe))].sort();
  const columnas: CSSProperties = { gridTemplateColumns: `repeat(${Math.max(posiciones.length, 1)}, minmax(0, 1fr))` };

  const hoy = fechaEn(ahora, zona).fecha;
  const t = ahora.getTime();
  const ir = abrir ?? abrirCliente;
  const cita = cfg.vocabulario.cita;

  return (
    <section className="flex flex-col gap-3" aria-label="Agenda">
      <p className="px-1 text-[13px] leading-[18px] text-secundario">{textoDiasCabecera(cfg.calendario.diasAbiertos)}, dos semanas</p>

      {reservas.length === 0 ? (
        <p className="rounded-[12px] border border-linea bg-white px-6 py-10 text-center text-[14px] leading-5 text-secundario">{frases.citasAparecenAqui}</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-[12px] border border-linea bg-white max-lg:hidden">
            {semanas.map((lunes) => {
              const delaSemana = posiciones.map((p) => sumarDias(lunes, p));
              const conCitas = delaSemana.some((d) => (porDia.get(d)?.length ?? 0) > 0);
              return (
                <div key={lunes} className="border-linea [&+&]:border-t">
                  <div className="grid gap-1 border-b border-linea bg-lienzo px-2 py-2" style={columnas}>
                    {delaSemana.map((dia) => {
                      const [nombre, numero, mes] = textoDia(dia).split(" ");
                      const esHoy = dia === hoy;
                      const abierto = porDia.has(dia);
                      return (
                        <div
                          key={dia}
                          aria-current={esHoy ? "date" : undefined}
                          className={`rounded-[8px] py-1 text-center text-[12px] leading-4 tabular-nums ${
                            esHoy ? "bg-tinta font-medium text-white" : abierto ? "text-secundario" : "text-secundario/50"
                          }`}
                        >
                          {cap(nombre.slice(0, 3))} {numero} {mes}
                        </div>
                      );
                    })}
                  </div>
                  {conCitas ? (
                    <div className="grid gap-1 px-2 py-2" style={columnas}>
                      {delaSemana.map((dia) => (
                        <ul key={dia} aria-label={textoDia(dia)} className="flex min-w-0 flex-col gap-1">
                          {(porDia.get(dia) ?? []).map((r) => {
                            const pasada = momentoDeHueco(r.huecoId, zona) < t;
                            return (
                              <li key={r.huecoId}>
                                <button
                                  type="button"
                                  onClick={() => ir(r.leadId)}
                                  title={`${r.nombre}: ${r.texto}`}
                                  className={`flex w-full cursor-pointer items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] leading-[18px] transition-[filter] duration-150 ease-out hover:brightness-[0.97] ${
                                    pasada ? "bg-fondo text-secundario" : "bg-ok/12 text-ok-texto"
                                  } ${r.prueba ? `border border-dashed ${pasada ? "border-secundario/40" : "border-ok/50"}` : ""}`}
                                >
                                  <span className="shrink-0 font-medium tabular-nums">{r.huecoId.split("T")[1]}</span>
                                  <span className="min-w-0 truncate">{nombreDePila(r.nombre)}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-2.5 text-[13px] leading-[18px] text-secundario">Sin {cita.plural} esta semana</p>
                  )}
                </div>
              );
            })}
          </div>

          <ol className="flex flex-col gap-4 lg:hidden">
            {diasEnColumna(porDia, hoy).map(({ dia, reservas: delDia }) => {
              const prefijo = dia === hoy ? "Hoy · " : dia === sumarDias(hoy, 1) ? "Mañana · " : "";
              return (
                <li key={dia} className="flex flex-col gap-1.5">
                  <h2 className="px-1 text-[13px] leading-[18px] font-medium text-secundario">
                    {prefijo}
                    {textoDia(dia)}
                  </h2>
                  {delDia.length === 0 ? (
                    <p className="rounded-[12px] border border-linea bg-white px-4 py-3 text-[14px] leading-5 text-secundario">{frases.sinCitasHoy}</p>
                  ) : (
                    <ul className="flex flex-col gap-1 rounded-[12px] border border-linea bg-white p-1.5">
                      {delDia.map((r) => {
                        const pasada = momentoDeHueco(r.huecoId, zona) < t;
                        const sinCerrar = pasada && !!bd.leads[r.leadId] && !bd.leads[r.leadId].cierre;
                        return (
                          <li key={r.huecoId}>
                            <button
                              type="button"
                              onClick={() => ir(r.leadId)}
                              className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-left text-[14px] leading-5 ${
                                pasada ? "bg-fondo text-secundario" : "bg-ok/12 text-ok-texto"
                              } ${r.prueba ? `border border-dashed ${pasada ? "border-secundario/40" : "border-ok/50"}` : ""}`}
                            >
                              <span className="w-12 shrink-0 font-medium tabular-nums">{r.huecoId.split("T")[1]}</span>
                              <span className="min-w-0 flex-1 line-clamp-2 break-words">{r.nombre}</span>
                              {sinCerrar && <span className="shrink-0 text-[13px] leading-[18px] font-medium text-tinta">{frases.comoFueCorto}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
