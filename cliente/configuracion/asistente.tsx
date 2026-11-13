"use client";

import { useEffect, useId, useRef, useState, type JSX } from "react";
import type { EstadoPlantilla } from "@/lib/api-tipos";
import { LIMITES } from "@/lib/configuracion";
import { formatoTelefono } from "@/lib/regional";
import type { Bd } from "@/lib/tipos";
import { cambiarAsistente, enviarAvisoPrueba } from "../api-sistema";
import { ChatDePrueba } from "../chat-de-prueba";
import { confirmar } from "../confirmaciones";
import { useModoPrueba } from "../modo-prueba";
import { useEstado } from "../sistema";
import { guardarInformacion } from "./api";
import { guardarCampo } from "./guardar";
import {
  AREA,
  Ayuda,
  BOTON,
  BOTON_PRINCIPAL,
  CampoTexto,
  ErrorCampo,
  EstadoGuardado,
  Fila,
  Interruptor,
  LineaAtencion,
  Segmentado,
  cifra,
  useGuardado,
} from "./controles";
import type { PropsBloque } from "./negocio";

// Bloque 2 · «Tu asistente»: si contesta, lo que tiene que saber, el trato, el móvil de los avisos y
// el chat de prueba.

export function BloqueAsistente(
  p: PropsBloque & {
    bd: Bd;
    plantillas: EstadoPlantilla[] | null;
    releerPlantillas: () => Promise<void>;
    /** Lo que deja «Avanzado» al guardar las instrucciones completas: se pinta sin esperar a la recarga. */
    informacionNueva: { texto: string; vez: number } | null;
  },
): JSX.Element {
  return (
    <>
      <Contesta {...p} />
      <Informacion {...p} />
      <Trato {...p} />
      <Avisos {...p} />
      <div className="py-4">
        <span className="text-[14px] leading-5 font-medium">Probar tu asistente</span>
        <div className="mt-2.5">
          <ChatDePrueba />
        </div>
      </div>
    </>
  );
}

// ─── Contesta a los clientes ──────────────────────────────────────────────────────────────────────

function Contesta({ bd, datos, refrescar }: PropsBloque & { bd: Bd }): JSX.Element {
  const idEtiqueta = useId();
  const idAyuda = useId();
  const g = useGuardado();
  const real = bd.configuracion?.sistema.asistente.activo ?? datos.activa.sistema.asistente.activo;
  const [activo, setActivo] = useState(real);
  const enCurso = useRef(false);
  useEffect(() => {
    if (!enCurso.current) setActivo(real);
  }, [real]);

  return (
    <Fila etiqueta="Contesta a los clientes" idEtiqueta={idEtiqueta} ayuda="Si lo apagas, los mensajes se guardan y les contestas tú" idAyuda={idAyuda} g={g} en="linea">
      <Interruptor
        marcado={activo}
        idEtiqueta={idEtiqueta}
        describe={[idAyuda, g.error ? g.idError : ""].filter(Boolean).join(" ")}
        desactivado={g.estado === "guardando"}
        cambiar={async (v) => {
          const antes = activo;
          setActivo(v);
          enCurso.current = true;
          const bien = await g.ejecutar(async () => {
            const r = await cambiarAsistente(v);
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          });
          enCurso.current = false;
          if (!bien) setActivo(antes);
          else void refrescar();
        }}
      />
    </Fila>
  );
}

// ─── Lo que tiene que saber de tu negocio ─────────────────────────────────────────────────────────

function Informacion({ datos, recargar, informacionNueva }: PropsBloque & { informacionNueva: { texto: string; vez: number } | null }): JSX.Element {
  const id = useId();
  const idContador = useId();
  const g = useGuardado();
  const [texto, setTexto] = useState(datos.prompt.informacion);
  const base = useRef(datos.prompt.informacion);
  const [conflicto, setConflicto] = useState(false);

  // Una recarga trae otro texto: se pinta si no hay nada sin guardar.
  useEffect(() => {
    const nuevo = datos.prompt.informacion;
    if (nuevo === base.current) return;
    const sinGuardar = texto !== base.current;
    base.current = nuevo;
    if (!sinGuardar) setTexto(nuevo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.prompt.informacion]);

  // Se acaban de guardar las instrucciones completas: su sección manda.
  useEffect(() => {
    if (!informacionNueva) return;
    base.current = informacionNueva.texto;
    setTexto(informacionNueva.texto);
    setConflicto(false);
    g.limpiar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [informacionNueva?.vez]);

  const cambiado = texto !== base.current;
  const largo = texto.length;

  const guardar = async () => {
    setConflicto(false);
    const enviado = texto;
    const bien = await g.ejecutar(async () => {
      const r = await guardarInformacion(enviado, datos.prompt.hash);
      if (!r.ok && r.conflicto) setConflicto(true);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    });
    if (bien) {
      base.current = enviado;
      void recargar();
    }
  };

  // «Recargar» tras un conflicto: se deja lo escrito y se pinta lo que hay ahora en el servidor.
  const soltar = useRef(false);
  useEffect(() => {
    if (!soltar.current) return;
    soltar.current = false;
    base.current = datos.prompt.informacion;
    setTexto(datos.prompt.informacion);
  }, [datos]);
  const recargarYSoltar = async () => {
    setConflicto(false);
    g.limpiar();
    soltar.current = true;
    await recargar();
  };

  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-[14px] leading-5 font-medium">
          Lo que tiene que saber de tu negocio
        </label>
        <EstadoGuardado g={g} />
      </div>
      <textarea
        id={id}
        value={texto}
        rows={5}
        maxLength={LIMITES.informacion}
        placeholder="Precios orientativos, horario, dirección, qué haces y qué no…"
        aria-describedby={[idContador, g.error ? g.idError : ""].filter(Boolean).join(" ")}
        aria-invalid={g.error ? true : undefined}
        onChange={(e) => setTexto(e.target.value)}
        className={`${AREA} mt-2 min-h-[132px] resize-y`}
      />
      <div className="mt-2 flex items-center justify-between gap-4 max-lg:flex-wrap max-lg:gap-y-2">
        <span id={idContador} className={`text-[12px] leading-4 tabular-nums ${largo > LIMITES.informacion * 0.9 ? "text-atencion-texto" : "text-secundario"}`}>
          {cifra(largo)} / {cifra(LIMITES.informacion)}
        </span>
        <div className="flex items-center gap-2 max-lg:flex-wrap">
          {conflicto && (
            <button type="button" onClick={() => void recargarYSoltar()} className={BOTON}>
              Recargar
            </button>
          )}
          <button type="button" onClick={() => void guardar()} disabled={!cambiado || g.estado === "guardando"} className={BOTON_PRINCIPAL}>
            Guardar
          </button>
        </div>
      </div>
      <ErrorCampo id={g.idError} error={g.error} />
    </div>
  );
}

// ─── Trato ────────────────────────────────────────────────────────────────────────────────────────

function Trato({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const g = useGuardado();
  const guardado = datos.activa.agente.trato;
  const [trato, setTrato] = useState<"tu" | "usted">(guardado);
  const enCurso = useRef(false);
  useEffect(() => {
    if (!enCurso.current) setTrato(guardado);
  }, [guardado]);

  return (
    <Fila etiqueta="Trata a los clientes de:" idEtiqueta={idEtiqueta} g={g} en="linea">
      <Segmentado
        opciones={[
          { valor: "tu", texto: "tú" },
          { valor: "usted", texto: "usted" },
        ]}
        valor={trato}
        idEtiqueta={idEtiqueta}
        describe={g.error ? g.idError : undefined}
        cambiar={async (v) => {
          const antes = trato;
          setTrato(v);
          enCurso.current = true;
          const bien = await g.ejecutar(() => guardarCampo("agente.trato", v));
          enCurso.current = false;
          if (!bien) setTrato(antes);
          else void recargar();
        }}
      />
    </Fila>
  );
}

// ─── El móvil de los avisos ───────────────────────────────────────────────────────────────────────

/** En el modo prueba el aviso es un mensaje normal desde el móvil vinculado, y solo a un número de la lista. */
function AvisoEnModoPrueba(p: { guardado: string | null }): JSX.Element | null {
  const { estado, releer } = useModoPrueba(false);
  useEffect(() => {
    void releer();
  }, [p.guardado, releer]);
  if (!estado) return null;
  if (estado.avisoPermitido === false) {
    return <LineaAtencion className="mt-3">Modo prueba: este móvil no está en la lista de números permitidos, así que no le llegan los avisos. Añádelo en Ajustes → Conexiones.</LineaAtencion>;
  }
  if (estado.avisoPermitido === true) {
    return <LineaAtencion className="mt-3">Modo prueba: el aviso te llega como un mensaje normal desde el móvil de pruebas</LineaAtencion>;
  }
  return null;
}

function Avisos({ datos, recargar, plantillas, releerPlantillas }: PropsBloque & { plantillas: EstadoPlantilla[] | null; releerPlantillas: () => Promise<void> }): JSX.Element {
  const id = useId();
  const idAyuda = useId();
  const g = useGuardado();
  const gPrueba = useGuardado();
  const [probando, setProbando] = useState(false);
  const guardado = datos.guardada.sistema.avisos?.comercial?.telefono;
  const prefijo = datos.activa.regional.prefijo;
  // Se enseña como lo lee una persona («+34 612 345 678»); el servidor lo guarda normalizado.
  const valor = typeof guardado === "string" && guardado !== "" ? formatoTelefono(guardado, prefijo) : "";
  const sinGuardar = guardado === null || guardado === undefined;
  const aviso = plantillas?.find((e) => e.id === "aviso");
  const prueba = useEstado()?.modoWhatsApp === "prueba";
  const sinAprobar = !prueba && !!aviso && aviso.estado !== "APROBADA" && aviso.estado !== "SIN_CLAVES";

  const probar = async () => {
    setProbando(true);
    gPrueba.limpiar();
    const error = await enviarAvisoPrueba();
    setProbando(false);
    if (error === null) confirmar("Aviso enviado: míralo en tu móvil");
    else gPrueba.fallar(error);
    void releerPlantillas();
  };

  return (
    <Fila
      etiqueta="Cuando te toque, avísame por WhatsApp a:"
      para={id}
      g={g}
      extra={
        <>
          <div className="mt-3 flex items-center gap-3 max-lg:flex-wrap">
            <button type="button" onClick={() => void probar()} disabled={probando} aria-describedby={gPrueba.error ? gPrueba.idError : undefined} className={BOTON}>
              {probando ? "Enviando…" : "Enviarme un aviso de prueba"}
            </button>
          </div>
          <ErrorCampo id={gPrueba.idError} error={gPrueba.error} />
          {sinAprobar && <LineaAtencion className="mt-3">Para que te lleguen los avisos, escribe «hola» al número del negocio una vez al día</LineaAtencion>}
          {prueba && <AvisoEnModoPrueba guardado={guardado ?? null} />}
        </>
      }
    >
      <CampoTexto
        id={id}
        idAyuda={sinGuardar ? idAyuda : undefined}
        valor={valor}
        g={g}
        tipo="tel"
        inputMode="tel"
        placeholder={prefijo === "34" ? "+34 612 345 678" : `+${prefijo} …`}
        className="max-w-[260px] tabular-nums max-lg:max-w-none"
        // Vacío sin nada guardado: se sigue usando el móvil de la instalación, si lo hay.
        ignorar={(t) => t.trim() === "" && sinGuardar}
        guardar={async (t) => {
          const limpio = t.trim();
          const bien = await g.ejecutar(() => guardarCampo("sistema.avisos.comercial.telefono", limpio));
          if (bien) {
            // El error de la prueba anterior («Pon antes tu móvil») ya no vale con el móvil nuevo.
            gPrueba.limpiar();
            void recargar();
          }
          return bien;
        }}
      />
      {sinGuardar && (
        <Ayuda id={idAyuda} className="mt-2">
          Si lo dejas vacío, se usa el móvil que se puso al instalar, si hay uno.
        </Ayuda>
      )}
    </Fila>
  );
}
