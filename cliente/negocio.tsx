"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type JSX, type ReactNode } from "react";
import { fechaCorta, fechaEn, textoDia } from "@/lib/agenda";
import { colorTexto, publica, type ConfiguracionPublica } from "@/lib/configuracion";
import { configuracionPorDefecto } from "@/lib/presets";
import { formatoImporte, formatoTelefono, MONEDAS, simboloMoneda, type Moneda } from "@/lib/regional";
import type { EstadoLead } from "@/lib/tipos";
import { frases as frasesDe, nombresEtapa, type Frases, type Tono } from "@/lib/vocabulario";
import { avisarCambioDeConfiguracion } from "./datos";

// Las palabras, la moneda, la zona y los formatos del negocio activo, para todo el panel.
// El proveedor de fuera, además, pone el color de marca en <html>, el favicon y avisa a las demás
// pestañas cuando la configuración cambia. El título de la pestaña lo pone el panel, que sabe cuántos esperan.

export interface ValorNegocio {
  cfg: ConfiguracionPublica;
  frases: Frases;
  etapas: Record<EstadoLead, { nombre: string; tono: Tono }>;
  zona: string;
  moneda: Moneda;
  prefijo: string;
  formato: {
    importe(n: number): string;
    numero(n: number): string;
    fechaHora(ts: number): string;
    hora(ts: number): string;
    dia(ts: number): string;
    /** fechaCorta: depende de la hora actual, así que se pinta después de montar. */
    corta(ts: number): string;
    telefono(t: string): string;
  };
}

function valorDe(cfg: ConfiguracionPublica): ValorNegocio {
  const moneda = cfg.regional.moneda;
  const zona = cfg.calendario.zona;
  const prefijo = cfg.regional.prefijo;
  const numero = new Intl.NumberFormat(MONEDAS[moneda].locale, { useGrouping: "always" });
  const fechaHora = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zona,
  });
  const hora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zona });
  return {
    cfg,
    frases: frasesDe(cfg.vocabulario, { simbolo: simboloMoneda(moneda), nombre: MONEDAS[moneda].nombre }),
    etapas: nombresEtapa(cfg.vocabulario),
    zona,
    moneda,
    prefijo,
    formato: {
      importe: (n) => formatoImporte(n, moneda),
      numero: (n) => numero.format(n),
      fechaHora: (ts) => fechaHora.format(ts),
      hora: (ts) => hora.format(ts),
      dia: (ts) => textoDia(fechaEn(new Date(ts), zona).fecha),
      corta: (ts) => fechaCorta(ts, new Date(), zona),
      telefono: (t) => formatoTelefono(t, prefijo),
    },
  };
}

// Sin proveedor: reformas, sin nada guardado. Se calcula la primera vez que hace falta.
let porDefecto: ValorNegocio | null = null;
function valorPorDefecto(): ValorNegocio {
  porDefecto ??= valorDe(publica(configuracionPorDefecto()));
  return porDefecto;
}

const Contexto = createContext<ValorNegocio | null>(null);

/**
 * Los efectos de la marca, solo en el proveedor de más fuera: el diálogo, la paleta y los avisos son
 * portales a <body>, así que el color va en <html>.
 */
function useEfectosDeMarca(cfg: ConfiguracionPublica, activo: boolean): void {
  const color = cfg.negocio.color;
  const logo = cfg.negocio.logoUrl;
  const firma = cfg.firma;

  useEffect(() => {
    if (!activo) return;
    const raiz = document.documentElement.style;
    if (color) {
      raiz.setProperty("--color-marca", color);
      raiz.setProperty("--color-marca-texto", colorTexto(color));
    } else {
      // Sin color propio manda el CSS: el verde clásico.
      raiz.removeProperty("--color-marca");
      raiz.removeProperty("--color-marca-texto");
    }
  }, [activo, color]);

  useEffect(() => {
    if (!activo) return;
    let enlace = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!enlace) {
      enlace = document.createElement("link");
      enlace.rel = "icon";
      document.head.appendChild(enlace);
    }
    enlace.href = logo ?? "/icono.svg";
  }, [activo, logo]);

  // Si la configuración cambia (desde Ajustes, desde Claude Code o desde otro ordenador), la web abierta
  // en otra pestaña se entera. Al montar no: no ha cambiado nada.
  const firmaAnterior = useRef(firma);
  useEffect(() => {
    if (!activo || firmaAnterior.current === firma) return;
    firmaAnterior.current = firma;
    avisarCambioDeConfiguracion();
  }, [activo, firma]);
}

/** El valor solo se recalcula cuando cambia la firma de la configuración. */
export function ProveedorNegocio(p: { configuracion?: ConfiguracionPublica; children: ReactNode }): JSX.Element {
  const { configuracion } = p;
  const firma = configuracion?.firma;
  const padre = useContext(Contexto);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const valor = useMemo(() => (configuracion ? valorDe(configuracion) : valorPorDefecto()), [firma]);
  useEfectosDeMarca(valor.cfg, padre === null);
  return <Contexto.Provider value={valor}>{p.children}</Contexto.Provider>;
}

export function useNegocio(): ValorNegocio {
  return useContext(Contexto) ?? valorPorDefecto();
}

export function useFrases(): Frases {
  return useNegocio().frases;
}

export function useEtapas(): ValorNegocio["etapas"] {
  return useNegocio().etapas;
}
