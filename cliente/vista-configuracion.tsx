"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { EstadoPlantilla } from "@/lib/api-tipos";
import { SECCIONES_CONFIGURACION, type IdSeccionConfiguracion } from "@/lib/configuracion";
import type { Bd } from "@/lib/tipos";
import { leerPlantillas } from "./api-sistema";
import { confirmar } from "./confirmaciones";
import { BloqueAgenda } from "./configuracion/agenda";
import { useConfiguracion } from "./configuracion/api";
import { BloqueAsistente } from "./configuracion/asistente";
import { Avanzado } from "./configuracion/avanzado";
import { Conexiones } from "./configuracion/conexiones";
import { Bloque, BOTON, menosMovimiento } from "./configuracion/controles";
import { BloqueNegocio } from "./configuracion/negocio";
import { BloqueWeb } from "./configuracion/web";
import { Pie } from "./configuracion/pie";
import { irA } from "./navegacion";

// Ajustes: una página con cinco bloques («Tu negocio», «Tu web», «Tu asistente», «Horario de citas» y
// «Conexiones»), el pie con los clientes de ejemplo y el CSV, y «Avanzado», cerrado. Cada control se
// guarda al cambiarlo y dice «Guardado» a su lado. Lo que no está aquí se adapta con Claude Code.

const SECCION = Object.fromEntries(SECCIONES_CONFIGURACION.map((s) => [s.id, s])) as Record<IdSeccionConfiguracion, (typeof SECCIONES_CONFIGURACION)[number]>;

export function VistaConfiguracion(p: { bd: Bd; refrescar: () => Promise<void>; bloque: IdSeccionConfiguracion | null }): JSX.Element {
  const { bd, refrescar, bloque } = p;
  const { datos, error, recargar } = useConfiguracion(bd.configuracion?.firma);
  const [plantillas, setPlantillas] = useState<EstadoPlantilla[] | null>(null);
  const [informacionNueva, setInformacionNueva] = useState<{ texto: string; vez: number } | null>(null);
  const titulos = useRef<Partial<Record<IdSeccionConfiguracion, HTMLHeadingElement | null>>>({});
  const cargado = datos !== null;

  // Los estados de los mensajes aprobados: una vez al montar (y otra tras el aviso de prueba).
  const releerPlantillas = useCallback(async () => {
    setPlantillas(await leerPlantillas());
  }, []);
  useEffect(() => {
    void releerPlantillas();
  }, [releerPlantillas]);

  // Los avisos del servidor, una vez cada uno.
  const vistos = useRef(new Set<string>());
  useEffect(() => {
    for (const aviso of datos?.avisos ?? []) {
      if (vistos.current.has(aviso)) continue;
      vistos.current.add(aviso);
      confirmar(aviso, { ms: 6_000 });
    }
  }, [datos?.avisos]);

  // Al pedir un bloque (#ajustes-horario…), se lleva a la vista y su título se lleva el foco.
  const llevarA = useCallback((id: IdSeccionConfiguracion) => {
    const seccion = document.getElementById(SECCION[id].ancla);
    seccion?.scrollIntoView({ block: "start", behavior: menosMovimiento() ? "auto" : "smooth" });
    titulos.current[id]?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (bloque && cargado) llevarA(bloque);
  }, [bloque, cargado, llevarA]);

  const irABloque = useCallback(
    (id: IdSeccionConfiguracion) => {
      irA("configuracion", { bloque: id });
      llevarA(id);
    },
    [llevarA],
  );

  if (!datos) {
    return (
      <div className="w-full">
        {error ? (
          <div role="alert" className="flex items-center justify-between gap-4 rounded-[14px] border border-linea bg-white px-6 py-5">
            <p className="text-[14px] leading-5">No se han podido cargar los ajustes.</p>
            <button type="button" onClick={() => void recargar()} className={BOTON}>
              Reintentar
            </button>
          </div>
        ) : (
          <p aria-live="polite" className="px-1 py-5 text-[14px] leading-5 text-secundario">
            Cargando ajustes…
          </p>
        )}
      </div>
    );
  }

  const comun = { datos, recargar, refrescar };
  const refTitulo = (id: IdSeccionConfiguracion) => (el: HTMLHeadingElement | null) => {
    titulos.current[id] = el;
  };

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <Bloque id={SECCION.negocio.ancla} titulo={SECCION.negocio.nombre} tituloRef={refTitulo("negocio")}>
        <BloqueNegocio {...comun} plantillas={plantillas} />
      </Bloque>
      <Bloque id={SECCION.web.ancla} titulo={SECCION.web.nombre} tituloRef={refTitulo("web")}>
        <BloqueWeb {...comun} />
      </Bloque>
      <Bloque id={SECCION.asistente.ancla} titulo={SECCION.asistente.nombre} tituloRef={refTitulo("asistente")}>
        <BloqueAsistente {...comun} bd={bd} plantillas={plantillas} releerPlantillas={releerPlantillas} informacionNueva={informacionNueva} />
      </Bloque>
      <Bloque id={SECCION.agenda.ancla} titulo={SECCION.agenda.nombre} tituloRef={refTitulo("agenda")}>
        <BloqueAgenda {...comun} bd={bd} />
      </Bloque>
      <Bloque id={SECCION.whatsapp.ancla} titulo={SECCION.whatsapp.nombre} tituloRef={refTitulo("whatsapp")}>
        <div className="pt-3 pb-4">
          <Conexiones />
        </div>
      </Bloque>
      <Pie {...comun} />
      <Avanzado
        {...comun}
        irABloque={irABloque}
        alGuardarInstrucciones={(texto) => setInformacionNueva((antes) => ({ texto, vez: (antes?.vez ?? 0) + 1 }))}
      />
    </div>
  );
}
