"use client";

import { useEffect, useId, useRef, useState, type JSX } from "react";
import { encaja, fechaEn, generarHoras } from "@/lib/agenda";
import { vistaPreviaHuecos } from "@/lib/ajustes";
import type { Bd } from "@/lib/tipos";
import { concordar } from "@/lib/vocabulario";
import { guardarCampo } from "./guardar";
import { BOTON, Chips, ENTRADA_PEQ, ErrorCampo, EstadoGuardado, FOCO, LineaAtencion, useGuardado } from "./controles";
import type { PropsBloque } from "./negocio";

// Bloque 3 · «Horario de citas»: los días, las horas, la vista previa de lo que ofrecería el asistente
// y las citas que se han quedado fuera del horario.

const DIAS: { dia: number; letra: string; nombre: string }[] = [
  { dia: 1, letra: "L", nombre: "lunes" },
  { dia: 2, letra: "M", nombre: "martes" },
  { dia: 3, letra: "X", nombre: "miércoles" },
  { dia: 4, letra: "J", nombre: "jueves" },
  { dia: 5, letra: "V", nombre: "viernes" },
  { dia: 6, letra: "S", nombre: "sábado" },
  { dia: 0, letra: "D", nombre: "domingo" },
];

/** Los días en el orden que guarda el servidor (0 = domingo … 6 = sábado). */
const ordenar = (dias: number[]) => [...new Set(dias)].sort((a, b) => a - b);

export function BloqueAgenda(p: PropsBloque & { bd: Bd }): JSX.Element {
  const { datos, bd } = p;
  const calendario = datos.activa.calendario;
  // Se recalcula en cada pintado: después de cada guardado y con cada cambio de las reservas.
  const ahora = new Date();
  const vista = vistaPreviaHuecos(bd.reservas, ahora, calendario);

  // Citas que siguen en pie y ya no encajan en el horario.
  const { fecha, hora } = fechaEn(ahora, calendario.zona);
  const ahoraId = `${fecha}T${hora}`;
  const fuera = bd.reservas.filter((r) => r.huecoId > ahoraId && !encaja(r.huecoId, calendario)).length;
  const cita = bd.configuracion?.vocabulario.cita ?? datos.activa.vocabulario.cita;

  return (
    <>
      <Dias {...p} />
      <Horas {...p} />
      <div className="py-4">
        <p className="rounded-[10px] bg-lienzo px-4 py-3 text-[14px] leading-5 text-tinta" aria-live="polite">
          {vista}
        </p>
        {fuera > 0 && (
          <LineaAtencion className="mt-3">
            {fuera === 1
              ? `Hay 1 ${cita.singular} ${concordar(cita, "reservad")} fuera del horario: se queda como está.`
              : `Hay ${fuera} ${cita.plural} ${concordar(cita, "reservad", true)} fuera del horario: se quedan como están.`}
          </LineaAtencion>
        )}
      </div>
    </>
  );
}

// ─── Días ─────────────────────────────────────────────────────────────────────────────────────────

function Dias({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const g = useGuardado();
  const guardados = datos.activa.calendario.diasAbiertos;
  const [dias, setDias] = useState<number[]>(guardados);
  const enCurso = useRef(false);
  const clave = guardados.join(",");
  useEffect(() => {
    if (!enCurso.current) setDias(guardados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const cambiar = async (dia: number) => {
    const antes = dias;
    const nuevos = ordenar(dias.includes(dia) ? dias.filter((d) => d !== dia) : [...dias, dia]);
    setDias(nuevos);
    enCurso.current = true;
    const bien = await g.ejecutar(() => guardarCampo("calendario.diasAbiertos", nuevos));
    enCurso.current = false;
    if (!bien) setDias(antes);
    else void recargar();
  };

  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-4">
        <span id={idEtiqueta} className="text-[14px] leading-5 font-medium">
          Días
        </span>
        <EstadoGuardado g={g} />
      </div>
      <div role="group" aria-labelledby={idEtiqueta} aria-describedby={g.error ? g.idError : undefined} className="mt-2 flex gap-1.5">
        {DIAS.map((d) => {
          const abierto = dias.includes(d.dia);
          return (
            <button
              key={d.dia}
              type="button"
              aria-pressed={abierto}
              aria-label={d.nombre}
              title={d.nombre}
              onClick={() => void cambiar(d.dia)}
              className={`flex size-10 cursor-pointer items-center justify-center rounded-[9px] border text-[14px] font-medium transition-colors duration-150 ease-out ${FOCO} ${
                abierto ? "border-tinta bg-tinta text-white hover:bg-black" : "border-linea bg-white text-secundario hover:border-tinta/25 hover:text-tinta"
              }`}
            >
              {d.letra}
            </button>
          );
        })}
      </div>
      <ErrorCampo id={g.idError} error={g.error} />
    </div>
  );
}

// ─── Horas ────────────────────────────────────────────────────────────────────────────────────────

function Horas({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const idAnadir = useId();
  const idAyuda = useId();
  const idDesde = useId();
  const idHasta = useId();
  const idCada = useId();
  const g = useGuardado();
  const horas = datos.activa.calendario.horas;
  const [nueva, setNueva] = useState("");
  const [desde, setDesde] = useState("09:00");
  const [hasta, setHasta] = useState("13:30");
  const [cada, setCada] = useState("30");
  const ocupado = g.estado === "guardando";

  const guardar = async (lista: string[]): Promise<boolean> => {
    const bien = await g.ejecutar(() => guardarCampo("calendario.horas", lista));
    if (bien) void recargar();
    return bien;
  };

  const anadir = async () => {
    const t = nueva.trim();
    if (!t) return;
    if (await guardar([...horas, t])) setNueva("");
  };

  const tramo = async (sustituir: boolean) => {
    const generadas = generarHoras(desde, hasta, Number(cada));
    if (generadas.length === 0) {
      g.fallar("Revisa el tramo: la primera hora va antes que la última y cada cuánto, en minutos");
      return;
    }
    await guardar(sustituir ? generadas : [...horas, ...generadas]);
  };

  const descripcion = [idAyuda, g.error ? g.idError : ""].filter(Boolean).join(" ");

  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-4">
        <span id={idEtiqueta} className="text-[14px] leading-5 font-medium">
          Horas
          <span className="ml-2 text-[12px] font-normal text-secundario">
            {horas.length} {horas.length === 1 ? "hora" : "horas"} al día
          </span>
        </span>
        <EstadoGuardado g={g} />
      </div>
      <div role="group" aria-labelledby={idEtiqueta} aria-describedby={descripcion} className="mt-2.5">
        <Chips items={horas.map((h) => ({ clave: h, texto: h }))} desactivado={ocupado} quitar={(h) => void guardar(horas.filter((x) => x !== h))} />
      </div>
      <p id={idAyuda} className="mt-2.5 text-[13px] leading-[18px] text-secundario">
        Una cita por hueco: si atendéis a varias personas a la vez, de momento pon horas distintas.
      </p>
      <ErrorCampo id={g.idError} error={g.error} />

      {/* En el móvil, cada etiqueta encima de sus campos. */}
      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 rounded-[10px] border border-linea px-4 py-3.5 max-lg:grid-cols-1 max-lg:gap-y-2 max-sm:px-3">
        <label htmlFor={idAnadir} className="text-[13px] leading-[18px] font-medium">
          Añadir hora
        </label>
        <div className="flex items-center gap-2">
          <input
            id={idAnadir}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void anadir();
              }
            }}
            placeholder="9:30"
            autoComplete="off"
            inputMode="numeric"
            className={`${ENTRADA_PEQ} w-[96px] tabular-nums`}
          />
          <button type="button" onClick={() => void anadir()} disabled={ocupado || !nueva.trim()} className={BOTON}>
            Añadir
          </button>
        </div>

        <span className="text-[13px] leading-[18px] font-medium max-lg:mt-2">Generar</span>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-secundario">
          <label htmlFor={idDesde}>de</label>
          <input id={idDesde} type="time" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${ENTRADA_PEQ} w-[104px] tabular-nums`} />
          <label htmlFor={idHasta}>a</label>
          <input id={idHasta} type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${ENTRADA_PEQ} w-[104px] tabular-nums`} />
          <label htmlFor={idCada}>cada</label>
          <input
            id={idCada}
            type="number"
            min={5}
            max={240}
            step={5}
            value={cada}
            onChange={(e) => setCada(e.target.value)}
            className={`${ENTRADA_PEQ} w-[68px] tabular-nums`}
          />
          <span>min</span>
          <span className="ml-auto flex gap-2 max-lg:ml-0 max-lg:flex-wrap">
            <button type="button" onClick={() => void tramo(false)} disabled={ocupado} className={BOTON}>
              Añadir tramo
            </button>
            <button type="button" onClick={() => void tramo(true)} disabled={ocupado} className={BOTON}>
              Sustituir
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
