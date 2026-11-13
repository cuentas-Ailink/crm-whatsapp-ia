"use client";

import { ChevronRight, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from "react";
import { lugarDeZona, ZONAS_HORARIAS } from "@/lib/agenda";
import { conListaPaseSiempre, diasASemanas, informacionDe, listaPaseSiempre, semanasADias } from "@/lib/ajustes";
import type { EstadoPlantilla } from "@/lib/api-tipos";
import { LIMITES, MODELOS, NOMBRES_MODELO, revisarInstrucciones, type FrasesFijas, type IdModelo, type RevisionPrompt } from "@/lib/configuracion";
import { comprobarModelo, leerPlantillas } from "../api-sistema";
import { CampoClave } from "../campo-clave";
import { confirmar } from "../confirmaciones";
import { borrarTodo } from "../datos";
import { Acceso } from "./acceso";
import { guardarCambiosPerfil, guardarInstrucciones, restaurarInstrucciones } from "./api";
import { guardarCampo } from "./guardar";
import {
  AREA,
  Ayuda,
  BOTON,
  BOTON_PRINCIPAL,
  CampoTexto,
  Chips,
  Dialogo,
  ENLACE,
  ENTRADA,
  ENTRADA_PEQ,
  ErrorCampo,
  EstadoGuardado,
  Fila,
  FOCO,
  LineaAtencion,
  MARGEN_ANCLA,
  menosMovimiento,
  SELECT,
  Segmentado,
  cifra,
  useGuardado,
} from "./controles";
import type { PropsBloque } from "./negocio";

// «Avanzado», cerrado: las instrucciones completas, la lista de pase, las frases fijas, el modelo, la
// clave de las notas de voz, la agenda fina, el mensaje de bienvenida, el lema, la privacidad y
// «Borrar todo».

export function Avanzado(p: PropsBloque & { alGuardarInstrucciones: (texto: string) => void; irABloque: (id: "whatsapp") => void }): JSX.Element {
  return (
    <details
      className={`group ${MARGEN_ANCLA} rounded-[14px] border border-linea bg-white`}
      onToggle={(evento) => {
        // Al abrirlo, su título nunca queda debajo de la barra de arriba.
        const detalles = evento.currentTarget;
        if (!detalles.open) return;
        const barra = document.querySelector("main > header")?.getBoundingClientRect().bottom ?? 0;
        if (detalles.getBoundingClientRect().top < barra) detalles.scrollIntoView({ block: "start", behavior: menosMovimiento() ? "auto" : "smooth" });
      }}
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-[14px] px-6 py-4 max-lg:min-h-11 max-sm:px-4 text-[17px] leading-6 font-medium tracking-[-0.01em] select-none [&::-webkit-details-marker]:hidden ${FOCO}`}
      >
        <ChevronRight aria-hidden className="size-[18px] text-secundario transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none" strokeWidth={2} />
        Avanzado
      </summary>
      <div className="divide-y divide-linea border-t border-linea px-6 pb-2 max-sm:px-4">
        <Seccion titulo="Instrucciones completas del asistente">
          <Instrucciones {...p} />
        </Seccion>
        <PaseSiempre {...p} />
        <Seccion titulo="Frases fijas">
          <Frases {...p} />
        </Seccion>
        <Modelo {...p} />
        <div className="py-4">
          <CampoClave nombre="GEMINI_API_KEY" etiqueta="Notas de voz" />
        </div>
        <Seccion titulo="Agenda">
          <AgendaFina {...p} />
        </Seccion>
        <Seccion titulo="Mensajes aprobados">
          <MensajeBienvenida {...p} />
        </Seccion>
        <Web {...p} />
        <BorrarTodo {...p} />
        <Acceso />
      </div>
    </details>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }): JSX.Element {
  return (
    <div className={`${MARGEN_ANCLA} py-5`}>
      <h3 className="text-[15px] leading-5 font-medium">{titulo}</h3>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Una fila dentro de una sección de «Avanzado»: sin raya, con menos aire. */
function Sub(p: { etiqueta: string; para?: string; idEtiqueta?: string; g?: ReturnType<typeof useGuardado>; ayuda?: ReactNode; idAyuda?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="pt-3">
      <div className="flex items-center justify-between gap-4">
        {p.para ? (
          <label htmlFor={p.para} id={p.idEtiqueta} className="text-[13px] leading-[18px] font-medium">
            {p.etiqueta}
          </label>
        ) : (
          <span id={p.idEtiqueta} className="text-[13px] leading-[18px] font-medium">
            {p.etiqueta}
          </span>
        )}
        {p.g && <EstadoGuardado g={p.g} />}
      </div>
      <div className="mt-1.5">{p.children}</div>
      {p.ayuda && (
        <Ayuda id={p.idAyuda} className="mt-1.5">
          {p.ayuda}
        </Ayuda>
      )}
      {p.g && <ErrorCampo id={p.g.idError} error={p.g.error} />}
    </div>
  );
}

// ─── Instrucciones completas ──────────────────────────────────────────────────────────────────────

const PERDER = "Al recargar se pierde lo que has escrito aquí.";

/** La línea 1 (bloqueada), las líneas en blanco que la siguen (se conservan al guardar) y el resto. */
function partir(texto: string): { linea1: string; separador: string; resto: string } {
  const t = texto.replace(/\r\n/g, "\n");
  const i = t.indexOf("\n");
  if (i < 0) return { linea1: t, separador: "", resto: "" };
  const despues = t.slice(i + 1);
  const separador = despues.match(/^\n*/)?.[0] ?? "";
  return { linea1: t.slice(0, i), separador, resto: despues.slice(separador.length) };
}

function Instrucciones({ datos, recargar, alGuardarInstrucciones }: PropsBloque & { alGuardarInstrucciones: (texto: string) => void }): JSX.Element {
  const id = useId();
  const idContador = useId();
  const idCandado = useId();
  const g = useGuardado();
  const { activa } = datos;
  const tipo = datos.sectores.find((s) => s.id === activa.base)?.etiqueta ?? "tu negocio";
  const { linea1, separador, resto: restoGuardado } = partir(datos.prompt.texto);
  const [resto, setResto] = useState(restoGuardado);
  const base = useRef(restoGuardado);
  const [conflicto, setConflicto] = useState(false);
  const [preguntar, setPreguntar] = useState<"actualizar" | "restaurar" | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const soltar = useRef(false);

  useEffect(() => {
    if (soltar.current) {
      soltar.current = false;
      base.current = restoGuardado;
      setResto(restoGuardado);
      return;
    }
    if (restoGuardado === base.current) return;
    const sinGuardar = resto !== base.current;
    base.current = restoGuardado;
    if (!sinGuardar) setResto(restoGuardado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos]);

  const completo = `${linea1}\n${separador}${resto}`;
  const contexto = {
    perfilId: activa.perfil.id,
    vocabulario: activa.vocabulario,
    agente: activa.agente,
    moneda: activa.regional.moneda,
    negocio: activa.negocio.nombre,
    plantilla: activa.plantilla,
  };

  // Comprobaciones en vivo, 300 ms después de dejar de escribir.
  const [revision, setRevision] = useState<RevisionPrompt>(() => revisarInstrucciones(completo, contexto));
  useEffect(() => {
    const t = setTimeout(() => setRevision(revisarInstrucciones(completo, contexto)), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completo, activa.perfil.id, activa.agente, activa.vocabulario]);

  const cambiado = resto !== base.current;
  const largo = completo.length;

  const guardar = async () => {
    if (revisarInstrucciones(completo, contexto).error) return;
    setConflicto(false);
    const enviado = completo;
    const enviadoResto = resto;
    const bien = await g.ejecutar(async () => {
      const r = await guardarInstrucciones(enviado, datos.prompt.hash);
      if (!r.ok && r.conflicto) setConflicto(true);
      return r.ok ? { ok: true } : { ok: false, error: r.ok ? "" : r.conflicto ? `${r.error} ${PERDER}` : r.error };
    });
    if (bien) {
      base.current = enviadoResto;
      alGuardarInstrucciones(informacionDe(enviado));
      void recargar();
    }
  };

  const recargarYSoltar = async () => {
    setConflicto(false);
    g.limpiar();
    soltar.current = true;
    await recargar();
  };

  const restaurar = async () => {
    setRestaurando(true);
    const bien = await g.ejecutar(async () => {
      const r = await restaurarInstrucciones();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
    setRestaurando(false);
    setPreguntar(null);
    if (bien) {
      setConflicto(false);
      soltar.current = true;
      void recargar();
    }
  };

  const nadaQueDecir = !revision.error && revision.avisos.length === 0 && revision.info.length === 0;

  return (
    <div>
      {datos.prompt.versionNueva && (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-[10px] border border-atencion/40 bg-atencion/[0.06] px-4 py-2.5 max-lg:flex-wrap max-lg:gap-y-2">
          <LineaAtencion>Hay una versión nueva del texto de {tipo}.</LineaAtencion>
          <button type="button" onClick={() => setPreguntar("actualizar")} className={BOTON}>
            Actualizar
          </button>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-[13px] leading-[18px] font-medium">
          El texto que sigue tu asistente
        </label>
        <EstadoGuardado g={g} />
      </div>
      <div className="mt-1.5">
        <div
          title="Identifica el perfil: si cambia, las conversaciones empiezan de cero"
          className="flex items-center gap-2 rounded-t-[8px] border border-b-0 border-linea bg-lienzo px-3 py-2 font-mono text-[13px] leading-5 text-secundario"
        >
          <Lock aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="min-w-0 break-all">{linea1}</span>
          <span id={idCandado} className="sr-only">
            La primera línea no se puede cambiar: identifica el perfil y, si cambia, las conversaciones empiezan de cero.
          </span>
        </div>
        <textarea
          id={id}
          value={resto}
          spellCheck={false}
          rows={16}
          aria-describedby={[idCandado, idContador, g.error ? g.idError : ""].filter(Boolean).join(" ")}
          aria-invalid={revision.error ? true : undefined}
          onChange={(e) => setResto(e.target.value)}
          className={`${AREA} min-h-[280px] resize-y rounded-t-none font-mono text-[13px] leading-5`}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 max-lg:flex-wrap max-lg:gap-y-2">
        <span id={idContador} className={`text-[12px] leading-4 tabular-nums ${largo > LIMITES.promptAviso ? "text-atencion-texto" : "text-secundario"}`}>
          {cifra(largo)} / {cifra(LIMITES.promptMax)}
        </span>
        <div className="flex items-center gap-3 max-lg:flex-wrap">
          <button type="button" onClick={() => setPreguntar("restaurar")} className={ENLACE}>
            Restaurar el texto original
          </button>
          {conflicto && (
            <button type="button" onClick={() => void recargarYSoltar()} className={BOTON}>
              Recargar
            </button>
          )}
          <button type="button" onClick={() => void guardar()} disabled={!cambiado || !!revision.error || g.estado === "guardando"} className={BOTON_PRINCIPAL}>
            Guardar
          </button>
        </div>
      </div>
      <ErrorCampo id={g.idError} error={g.error} />

      <div className="mt-4 rounded-[10px] bg-lienzo px-4 py-3">
        <p className="text-[13px] leading-[18px] font-medium">Comprobaciones</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-[13px] leading-[18px]">
          {revision.error && (
            <li role="alert" className="text-error-texto">
              {revision.error}
            </li>
          )}
          {revision.avisos.map((a) => (
            <li key={a} className="text-atencion-texto">
              {a}
            </li>
          ))}
          {revision.info.map((a) => (
            <li key={a} className="text-secundario">
              {a}
            </li>
          ))}
          {nadaQueDecir && <li className="text-secundario">Todo en orden.</li>}
        </ul>
      </div>

      <Dialogo
        abierto={preguntar !== null}
        cerrar={() => !restaurando && setPreguntar(null)}
        titulo={preguntar === "actualizar" ? "¿Actualizar las instrucciones?" : "¿Restaurar el texto original?"}
        descripcion={
          preguntar === "actualizar"
            ? `Se cambian las instrucciones por el texto nuevo de ${tipo}. Lo que hayas cambiado a mano en ellas se pierde.`
            : `Se vuelve al texto original de ${tipo}. Lo que hayas cambiado a mano se pierde.`
        }
        acciones={
          <>
            <button type="button" onClick={() => setPreguntar(null)} disabled={restaurando} className={BOTON}>
              Cancelar
            </button>
            <button type="button" onClick={() => void restaurar()} disabled={restaurando} className={BOTON_PRINCIPAL}>
              {preguntar === "actualizar" ? "Actualizar" : "Restaurar"}
            </button>
          </>
        }
      />
    </div>
  );
}

// ─── Pásamelo siempre si escribe… ─────────────────────────────────────────────────────────────────

function PaseSiempre({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const idNueva = useId();
  const idAyuda = useId();
  const g = useGuardado();
  const { agente } = datos.activa;
  const frases = listaPaseSiempre(agente);
  const [nueva, setNueva] = useState("");
  const ocupado = g.estado === "guardando";

  const guardar = async (lista: string[]) => {
    const bien = await g.ejecutar(() => guardarCampo("agente.pasarSiempre", conListaPaseSiempre(agente, lista)));
    if (bien) void recargar();
    return bien;
  };

  const anadir = async () => {
    const t = nueva.trim();
    if (!t) return;
    if (await guardar([...frases, t])) setNueva("");
  };

  return (
    <Fila etiqueta="Pásamelo siempre si escribe…" idEtiqueta={idEtiqueta} g={g} ayuda="Si un cliente escribe una de estas frases, tu asistente te lo pasa." idAyuda={idAyuda}>
      <div role="group" aria-labelledby={idEtiqueta} aria-describedby={idAyuda}>
        <Chips items={frases.map((f) => ({ clave: f, texto: f }))} desactivado={ocupado} quitar={(f) => void guardar(frases.filter((x) => x !== f))} vacio="Ninguna frase todavía." />
      </div>
      <div className="mt-2.5 flex items-center gap-2 max-lg:flex-wrap">
        <label htmlFor={idNueva} className="sr-only">
          Añadir frase
        </label>
        <input
          id={idNueva}
          value={nueva}
          maxLength={LIMITES.fraseReglaMax + 10}
          placeholder="Añadir frase"
          autoComplete="off"
          aria-describedby={g.error ? g.idError : undefined}
          onChange={(e) => setNueva(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void anadir();
            }
          }}
          className={`${ENTRADA_PEQ} w-full max-w-[320px]`}
        />
        <button type="button" onClick={() => void anadir()} disabled={ocupado || !nueva.trim()} className={BOTON}>
          Añadir
        </button>
      </div>
    </Fila>
  );
}

// ─── Frases fijas ─────────────────────────────────────────────────────────────────────────────────

const FRASES: { clave: keyof FrasesFijas; etiqueta: string; ayuda?: string }[] = [
  { clave: "pase", etiqueta: "Cuando te lo pasa" },
  { clave: "fallo", etiqueta: "Si algo falla" },
  { clave: "noTexto", etiqueta: "Si no es texto" },
  { clave: "audio", etiqueta: "Si no se entiende una nota de voz" },
  { clave: "baja", etiqueta: "Si pide que no le escriban" },
  { clave: "presentacion", etiqueta: "Cómo se presenta", ayuda: "Tiene que decir que es un asistente virtual. {negocio} es el nombre de tu negocio." },
  { clave: "borrarDatos", etiqueta: "Si pide que borres sus datos", ayuda: "Pon {negocio} donde va el nombre de tu negocio." },
];

function Frases(p: PropsBloque): JSX.Element {
  return (
    <div>
      {FRASES.map((f) => (
        <Frase key={f.clave} {...p} clave={f.clave} etiqueta={f.etiqueta} ayuda={f.ayuda} />
      ))}
    </div>
  );
}

function Frase({ datos, recargar, clave, etiqueta, ayuda }: PropsBloque & { clave: keyof FrasesFijas; etiqueta: string; ayuda?: string }): JSX.Element {
  const id = useId();
  const idAyuda = useId();
  const g = useGuardado();
  return (
    <Sub etiqueta={etiqueta} para={id} g={g} ayuda={ayuda} idAyuda={ayuda ? idAyuda : undefined}>
      <CampoTexto
        id={id}
        idAyuda={ayuda ? idAyuda : undefined}
        valor={datos.activa.agente.frases[clave]}
        g={g}
        max={LIMITES.fraseFija}
        guardar={async (t) => {
          // Vacío = la frase del tipo de negocio (o la de «usted»).
          const valor = t.trim() === "" ? null : t;
          const bien = await g.ejecutar(() => guardarCampo(`agente.frases.${clave}`, valor));
          if (bien) void recargar();
          return bien;
        }}
      />
    </Sub>
  );
}

// ─── Modelo ───────────────────────────────────────────────────────────────────────────────────────

function Modelo({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const g = useGuardado();
  const guardado: IdModelo = datos.activa.sistema.asistente.modelo ?? "claude-haiku-5-5";
  const [modelo, setModelo] = useState<IdModelo>(guardado);
  const enCurso = useRef(false);
  useEffect(() => {
    if (!enCurso.current) setModelo(guardado);
  }, [guardado]);

  return (
    <Fila etiqueta="Modelo" idEtiqueta={idEtiqueta} g={g} en="linea">
      <Segmentado
        opciones={MODELOS.map((m) => ({ valor: m, texto: NOMBRES_MODELO[m], detalle: m }))}
        valor={modelo}
        idEtiqueta={idEtiqueta}
        describe={g.error ? g.idError : undefined}
        desactivado={g.estado === "guardando"}
        cambiar={async (m) => {
          const antes = modelo;
          setModelo(m);
          enCurso.current = true;
          const bien = await g.ejecutar(async () => {
            const error = await comprobarModelo(m);
            if (error !== null) return { ok: false, error };
            return guardarCampo("sistema.asistente.modelo", m);
          });
          enCurso.current = false;
          if (!bien) setModelo(antes);
          else void recargar();
        }}
      />
    </Fila>
  );
}

// ─── Agenda fina ──────────────────────────────────────────────────────────────────────────────────

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «2026-12-24» → «24 dic»; de otro año, «3 ene 2027». */
function textoCerrado(fecha: string, anoActual: string): string {
  const [ano, mes, dia] = fecha.split("-");
  return `${Number(dia)} ${MESES[Number(mes) - 1] ?? mes}${ano !== anoActual ? ` ${ano}` : ""}`;
}

function AgendaFina({ datos, recargar }: PropsBloque): JSX.Element {
  const { calendario } = datos.activa;
  const idAntelacion = useId();
  const idHoras = useId();
  const idSemanas = useId();
  const idZona = useId();
  const idCerrado = useId();
  const idEtiquetaCerrados = useId();
  const gAntelacion = useGuardado();
  const gSemanas = useGuardado();
  const gZona = useGuardado();
  const gCerrados = useGuardado();

  const [desde, setDesde] = useState<"1" | "0">(calendario.desdeDias === 0 ? "0" : "1");
  const [horas, setHoras] = useState(String(Math.round(calendario.antelacionMinutos / 60)));
  const [zona, setZona] = useState(calendario.zona);
  const [zonaCambiada, setZonaCambiada] = useState(false);
  const [cerrado, setCerrado] = useState("");
  const enCurso = useRef(false);

  useEffect(() => {
    if (enCurso.current) return;
    setDesde(calendario.desdeDias === 0 ? "0" : "1");
    setZona(calendario.zona);
  }, [calendario.desdeDias, calendario.zona]);
  useEffect(() => {
    if (document.activeElement?.id !== idHoras) setHoras(String(Math.round(calendario.antelacionMinutos / 60)));
  }, [calendario.antelacionMinutos, idHoras]);

  const guardarAntelacion = async (d: "1" | "0", h: string) => {
    const n = Number(h);
    if (!Number.isInteger(n) || n < 0 || n > 168) {
      gAntelacion.fallar("La antelación va de 0 a 168 horas");
      return;
    }
    const antes = desde;
    setDesde(d);
    enCurso.current = true;
    const bien = await gAntelacion.ejecutar(() => guardarCambiosPerfil({ calendario: { desdeDias: d === "1" ? 1 : 0, antelacionMinutos: n * 60 } }));
    enCurso.current = false;
    if (!bien) setDesde(antes);
    else void recargar();
  };

  const semanas = diasASemanas(calendario.diasVista, calendario.diasAbiertos);
  const hoy = new Date().toISOString().slice(0, 4);

  const anadirCerrado = async () => {
    if (!cerrado) return;
    const bien = await gCerrados.ejecutar(() => guardarCampo("calendario.cerrados", [...calendario.cerrados, cerrado]));
    if (bien) {
      setCerrado("");
      void recargar();
    }
  };

  return (
    <div>
      <Sub etiqueta="Antelación" idEtiqueta={idAntelacion} g={gAntelacion}>
        <div className="flex flex-wrap items-center gap-3">
          <Segmentado
            opciones={[
              { valor: "1", texto: "Desde mañana" },
              { valor: "0", texto: "El mismo día" },
            ]}
            valor={desde}
            idEtiqueta={idAntelacion}
            cambiar={(v) => void guardarAntelacion(v, horas)}
          />
          {desde === "0" && (
            <span className="flex items-center gap-2 text-[13px] text-secundario max-lg:flex-wrap">
              <label htmlFor={idHoras}>con al menos</label>
              <input
                id={idHoras}
                type="number"
                min={0}
                max={168}
                value={horas}
                onChange={(e) => setHoras(e.target.value)}
                onBlur={() => {
                  if (Number(horas) * 60 !== calendario.antelacionMinutos) void guardarAntelacion("0", horas);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (Number(horas) * 60 !== calendario.antelacionMinutos) void guardarAntelacion("0", horas);
                  }
                }}
                className={`${ENTRADA_PEQ} w-[72px] tabular-nums`}
              />
              <span>h de antelación</span>
            </span>
          )}
        </div>
      </Sub>

      <Sub etiqueta="Hasta cuándo ofrece citas" para={idSemanas} g={gSemanas}>
        <span className="flex items-center gap-2 text-[13px] text-secundario">
          <span>Hasta</span>
          <CampoNumero
            id={idSemanas}
            valor={semanas}
            min={1}
            max={52}
            g={gSemanas}
            guardar={async (n) => {
              const bien = await gSemanas.ejecutar(() => guardarCampo("calendario.diasVista", semanasADias(n, calendario.diasAbiertos)));
              if (bien) void recargar();
              return bien;
            }}
          />
          <span>semanas</span>
        </span>
      </Sub>

      <Sub etiqueta="Zona horaria" para={idZona} g={gZona}>
        <select
          id={idZona}
          value={zona}
          aria-describedby={gZona.error ? gZona.idError : undefined}
          onChange={async (e) => {
            const antes = zona;
            const nueva = e.target.value;
            setZona(nueva);
            enCurso.current = true;
            const bien = await gZona.ejecutar(() => guardarCampo("calendario.zona", nueva));
            enCurso.current = false;
            if (!bien) setZona(antes);
            else {
              setZonaCambiada(true);
              void recargar();
            }
          }}
          className={`${SELECT} w-full max-w-[320px]`}
        >
          {!ZONAS_HORARIAS.some((z) => z.id === zona) && <option value={zona}>{lugarDeZona(zona)}</option>}
          {ZONAS_HORARIAS.map((z) => (
            <option key={z.id} value={z.id}>
              {lugarDeZona(z.id)}
            </option>
          ))}
        </select>
        {zonaCambiada && <LineaAtencion className="mt-2">Las citas ya reservadas se leerán en la zona nueva.</LineaAtencion>}
      </Sub>

      <Sub etiqueta="Festivos y cierres" idEtiqueta={idEtiquetaCerrados} g={gCerrados}>
        <div role="group" aria-labelledby={idEtiquetaCerrados}>
          <Chips
            items={calendario.cerrados.map((f) => ({ clave: f, texto: textoCerrado(f, hoy) }))}
            desactivado={gCerrados.estado === "guardando"}
            vacio="Ningún día cerrado."
            quitar={async (f) => {
              const bien = await gCerrados.ejecutar(() => guardarCampo("calendario.cerrados", calendario.cerrados.filter((x) => x !== f)));
              if (bien) void recargar();
            }}
          />
        </div>
        <div className="mt-2.5 flex items-center gap-2 max-lg:flex-wrap">
          <label htmlFor={idCerrado} className="text-[13px] text-secundario">
            Añadir un día cerrado
          </label>
          <input
            id={idCerrado}
            type="date"
            value={cerrado}
            onChange={(e) => setCerrado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void anadirCerrado();
              }
            }}
            className={`${ENTRADA_PEQ} w-[160px] tabular-nums`}
          />
          <button type="button" onClick={() => void anadirCerrado()} disabled={!cerrado || gCerrados.estado === "guardando"} className={BOTON}>
            Añadir
          </button>
        </div>
      </Sub>
    </div>
  );
}

/** Un número entero que se guarda al salir o con Enter. */
function CampoNumero(p: { id: string; valor: number; min: number; max: number; g: ReturnType<typeof useGuardado>; guardar: (n: number) => Promise<boolean> }): JSX.Element {
  const [texto, setTexto] = useState(String(p.valor));
  const enfocado = useRef(false);
  useEffect(() => {
    if (!enfocado.current) setTexto(String(p.valor));
  }, [p.valor]);
  const confirmarNumero = async () => {
    const n = Number(texto);
    if (n === p.valor) return;
    if (!Number.isInteger(n) || n < p.min || n > p.max) {
      p.g.fallar(`De ${p.min} a ${p.max} semanas`);
      return;
    }
    await p.guardar(n);
  };
  return (
    <input
      id={p.id}
      type="number"
      min={p.min}
      max={p.max}
      value={texto}
      aria-describedby={p.g.error ? p.g.idError : undefined}
      onFocus={() => {
        enfocado.current = true;
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        enfocado.current = false;
        void confirmarNumero();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void confirmarNumero();
        }
      }}
      className={`${ENTRADA_PEQ} w-[72px] tabular-nums`}
    />
  );
}

// ─── Mensaje de bienvenida ────────────────────────────────────────────────────────────────────────

const IDIOMAS = ["es_ES", "es_MX", "es_AR", "es"];

type Comprobacion = { tono: "ok" | "atencion" | "error" | "gris"; texto: string; enlace?: boolean; meta?: EstadoPlantilla } | null;

function textoComprobacion(e: EstadoPlantilla | undefined): Comprobacion {
  if (!e) return { tono: "gris", texto: "No se ha podido comprobar: inténtalo en un momento", enlace: true };
  switch (e.estado) {
    case "APROBADA":
      return { tono: "ok", texto: "● Aprobado en Meta", meta: e };
    case "EN_REVISION":
      return { tono: "atencion", texto: "● En revisión en Meta" };
    case "RECHAZADA":
    case "PAUSADA":
      return { tono: "error", texto: `Rechazado: ${e.motivo ?? "Meta no ha dado el motivo"}` };
    case "NO_EXISTE":
      return { tono: "gris", texto: "Aún no está en Meta: envíalo a aprobar en Conexiones", enlace: true };
    case "SIN_CLAVES":
      return { tono: "gris", texto: "Conecta tu WhatsApp para comprobarlo", enlace: true };
    default:
      return { tono: "gris", texto: `No se ha podido comprobar: ${e.motivo ?? "inténtalo en un momento"}`, enlace: true };
  }
}

const COLOR_TONO = { ok: "text-ok-texto", atencion: "text-atencion-texto", error: "text-error-texto", gris: "text-secundario" } as const;

/** El texto con {{1}} y {{2}} como chips, para la burbuja de vista previa. */
function ConVariables({ texto }: { texto: string }): JSX.Element {
  const partes = texto.split(/(\{\{[12]\}\})/g);
  return (
    <>
      {partes.map((parte, i) =>
        parte === "{{1}}" || parte === "{{2}}" ? (
          <span key={i} className="inline-flex rounded-[5px] bg-ok/15 px-1.5 text-[12px] leading-[18px] font-medium text-ok-texto">
            {parte === "{{1}}" ? "Nombre del cliente" : "Nombre del negocio"}
          </span>
        ) : (
          <span key={i}>{parte}</span>
        ),
      )}
    </>
  );
}

function MensajeBienvenida({ datos, recargar, irABloque }: PropsBloque & { irABloque: (id: "whatsapp") => void }): JSX.Element {
  const idNombre = useId();
  const idIdioma = useId();
  const idTexto = useId();
  const idContador = useId();
  const g = useGuardado();
  const guardada = datos.activa.plantilla;
  const [nombre, setNombre] = useState(guardada.nombre);
  const [idioma, setIdioma] = useState(guardada.idioma);
  const [texto, setTexto] = useState(guardada.texto);
  const base = useRef(guardada);
  const enfocado = useRef(false);
  const [comprobando, setComprobando] = useState(false);
  const [comprobacion, setComprobacion] = useState<Comprobacion>(null);

  useEffect(() => {
    const antes = base.current;
    if (antes.nombre === guardada.nombre && antes.idioma === guardada.idioma && antes.texto === guardada.texto) return;
    const sinGuardar = nombre !== antes.nombre || idioma !== antes.idioma || texto !== antes.texto;
    base.current = guardada;
    if (!enfocado.current && !sinGuardar) {
      setNombre(guardada.nombre);
      setIdioma(guardada.idioma);
      setTexto(guardada.texto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardada.nombre, guardada.idioma, guardada.texto]);

  const guardar = async (unidad: { nombre: string; idioma: string; texto: string }) => {
    const b = base.current;
    if (unidad.nombre === b.nombre && unidad.idioma === b.idioma && unidad.texto === b.texto) return;
    const bien = await g.ejecutar(() => guardarCampo("plantilla", unidad));
    if (bien) {
      base.current = unidad;
      void recargar();
    }
  };
  const salir = () => {
    enfocado.current = false;
    void guardar({ nombre, idioma, texto });
  };
  const entrar = () => {
    enfocado.current = true;
  };

  const comprobar = async () => {
    setComprobando(true);
    const estados = await leerPlantillas();
    setComprobando(false);
    setComprobacion(textoComprobacion(estados.find((e) => e.id === "bienvenida")));
  };

  const errorDe = (campo: string) => (g.campo === `plantilla.${campo}` || (campo === "texto" && g.error && !g.campo?.startsWith("plantilla.")) ? g.error : null);
  const idiomas = IDIOMAS.includes(idioma) ? IDIOMAS : [...IDIOMAS, idioma];
  const metaDistinto = comprobacion?.meta?.texto !== undefined && comprobacion.meta.texto.trim() !== texto.trim();

  return (
    <div>
      <div className="flex items-center justify-between gap-4 pt-3">
        <span className="text-[13px] leading-[18px] font-medium text-secundario">Mensaje de bienvenida</span>
        <EstadoGuardado g={g} />
      </div>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_160px] gap-4 max-sm:grid-cols-1">
        <div>
          <label htmlFor={idNombre} className="text-[13px] leading-[18px] font-medium">
            Nombre en Meta
          </label>
          <input
            id={idNombre}
            value={nombre}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={errorDe("nombre") ? true : undefined}
            aria-describedby={errorDe("nombre") ? g.idError : undefined}
            onFocus={entrar}
            onChange={(e) => setNombre(e.target.value)}
            onBlur={salir}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void guardar({ nombre, idioma, texto });
              }
            }}
            className={`${ENTRADA} mt-1.5 w-full font-mono text-[13px]`}
          />
          <ErrorCampo id={g.idError} error={errorDe("nombre")} />
        </div>
        <div>
          <label htmlFor={idIdioma} className="text-[13px] leading-[18px] font-medium">
            Idioma
          </label>
          <select
            id={idIdioma}
            value={idioma}
            aria-invalid={errorDe("idioma") ? true : undefined}
            aria-describedby={errorDe("idioma") ? g.idError : undefined}
            onChange={(e) => {
              setIdioma(e.target.value);
              void guardar({ nombre, idioma: e.target.value, texto });
            }}
            className={`${SELECT} mt-1.5 w-full font-mono text-[13px]`}
          >
            {idiomas.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <ErrorCampo id={g.idError} error={errorDe("idioma")} />
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor={idTexto} className="text-[13px] leading-[18px] font-medium">
          Texto
        </label>
        <textarea
          id={idTexto}
          value={texto}
          rows={3}
          maxLength={LIMITES.plantillaTexto}
          aria-invalid={errorDe("texto") ? true : undefined}
          aria-describedby={[idContador, errorDe("texto") ? g.idError : ""].filter(Boolean).join(" ")}
          onFocus={entrar}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={salir}
          className={`${AREA} mt-1.5 resize-y`}
        />
        <span id={idContador} className="mt-1 block text-[12px] leading-4 text-secundario tabular-nums">
          {cifra(texto.length)} / {cifra(LIMITES.plantillaTexto)}
        </span>
        <ErrorCampo id={g.idError} error={errorDe("texto")} />
      </div>

      <div className="mt-3 rounded-[12px] bg-[#e9e4dc] px-4 py-4" aria-label="Así lo verá el cliente" role="figure">
        <div className="max-w-[440px] rounded-[10px] rounded-tl-[2px] bg-white px-3 py-2 text-[14px] leading-[22px] whitespace-pre-wrap text-tinta shadow-[0_1px_1px_rgba(0,0,0,0.08)]">
          <ConVariables texto={texto} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void comprobar()} disabled={comprobando} className={BOTON}>
          {comprobando ? "Comprobando…" : "Comprobar en Meta"}
        </button>
        {comprobacion && (
          <p aria-live="polite" className={`text-[13px] leading-[18px] ${COLOR_TONO[comprobacion.tono]}`}>
            {comprobacion.texto}
            {comprobacion.enlace && (
              <>
                {" "}
                <button type="button" onClick={() => irABloque("whatsapp")} className={ENLACE}>
                  Ir a Conexiones
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {metaDistinto && comprobacion?.meta?.texto && (
        <div className="mt-2 flex items-center gap-3 max-lg:flex-wrap">
          <LineaAtencion>El texto aprobado en Meta es distinto.</LineaAtencion>
          <button
            type="button"
            onClick={() => {
              const t = comprobacion.meta!.texto!;
              setTexto(t);
              void guardar({ nombre, idioma, texto: t });
            }}
            className={BOTON}
          >
            Usar el de Meta
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Lema y privacidad ────────────────────────────────────────────────────────────────────────────

function Web({ datos, recargar }: PropsBloque): JSX.Element {
  const idLema = useId();
  const idUrl = useId();
  const idAyuda = useId();
  const gLema = useGuardado();
  const gUrl = useGuardado();
  return (
    <div className="py-5">
      <div className="grid grid-cols-2 gap-6 max-sm:grid-cols-1 max-sm:gap-4">
        <div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor={idLema} className="text-[13px] leading-[18px] font-medium">
              Lema
            </label>
            <EstadoGuardado g={gLema} />
          </div>
          <CampoTexto
            id={idLema}
            idAyuda={idAyuda}
            valor={datos.activa.negocio.lema}
            g={gLema}
            max={LIMITES.lema}
            className="mt-1.5"
            guardar={async (t) => {
              const bien = await gLema.ejecutar(() => guardarCampo("negocio.lema", t));
              if (bien) void recargar();
              return bien;
            }}
          />
          <ErrorCampo id={gLema.idError} error={gLema.error} />
        </div>
        <div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor={idUrl} className="text-[13px] leading-[18px] font-medium">
              Enlace a tu política de privacidad
            </label>
            <EstadoGuardado g={gUrl} />
          </div>
          <CampoTexto
            id={idUrl}
            idAyuda={idAyuda}
            valor={datos.activa.portada.formulario.urlPrivacidad ?? ""}
            g={gUrl}
            tipo="url"
            inputMode="url"
            max={LIMITES.urlPrivacidad}
            placeholder="https://…"
            className="mt-1.5"
            guardar={async (t) => {
              const limpio = t.trim();
              const bien = await gUrl.ejecutar(() => guardarCampo("portada.formulario.urlPrivacidad", limpio === "" ? null : limpio));
              if (bien) void recargar();
              return bien;
            }}
          />
          <ErrorCampo id={gUrl.idError} error={gUrl.error} />
        </div>
      </div>
      <Ayuda id={idAyuda} className="mt-2">
        Salen en tu web.
      </Ayuda>
    </div>
  );
}

// ─── Borrar todo ──────────────────────────────────────────────────────────────────────────────────

function BorrarTodo({ recargar, refrescar }: PropsBloque): JSX.Element {
  const [preguntando, setPreguntando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const borrar = async () => {
    setBorrando(true);
    setError(null);
    const fallo = await borrarTodo();
    setBorrando(false);
    if (fallo) {
      setError(fallo);
      return;
    }
    setPreguntando(false);
    confirmar("Todo borrado");
    void refrescar();
    void recargar();
  };

  return (
    <div className="py-5">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setPreguntando(true);
        }}
        className={`inline-flex h-9 cursor-pointer items-center rounded-[8px] border border-error-texto/50 bg-white px-3.5 text-[13px] font-medium text-error-texto transition-colors duration-150 ease-out hover:bg-error/[0.06] ${FOCO}`}
      >
        Borrar todo, también tus clientes reales
      </button>
      <Dialogo
        abierto={preguntando}
        rol="alertdialog"
        cerrar={() => !borrando && setPreguntando(false)}
        titulo="¿Borrar todo?"
        descripcion="Se borran todos tus clientes, también los reales, sus conversaciones y sus citas. La configuración no cambia. No se puede deshacer."
        acciones={
          <>
            <button type="button" onClick={() => setPreguntando(false)} disabled={borrando} className={BOTON}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void borrar()}
              disabled={borrando}
              className={`inline-flex h-9 cursor-pointer items-center rounded-[8px] bg-error px-3.5 text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:bg-error-texto disabled:cursor-default ${FOCO}`}
            >
              {borrando ? "Borrando…" : "Borrar todo"}
            </button>
          </>
        }
      >
        <ErrorCampo error={error} />
      </Dialogo>
    </div>
  );
}
