"use client";

import { ArrowRight, Search, UserPlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { buscar } from "@/lib/buscar";
import { esEjemplo } from "@/lib/negocio";
import type { Lead } from "@/lib/tipos";
import { normalizar, resumenDatos } from "@/lib/vocabulario";
import { abrirAltaCliente } from "./alta-cliente";
import { abrirCliente, irA, type Vista } from "./navegacion";
import { useEtapas, useFrases, useNegocio } from "./negocio";
import { Avatar } from "./piezas";

// Buscar (⌘K o Ctrl K, o el campo de la barra lateral): clientes y las cuatro secciones por su nombre.
// Solo busca: si nadie encaja, ofrece añadir lo escrito como cliente.

export interface SeccionPaleta {
  id: Vista;
  nombre: string;
}

const RECIENTES = 6;
const MAXIMO = 8;
const LETRA = /\p{L}/u;

const PUNTO_TONO = { gris: "bg-nuevo", ok: "bg-ok", atencion: "bg-atencion" } as const;

type Resultado = { tipo: "lead"; lead: Lead } | { tipo: "seccion"; seccion: SeccionPaleta } | { tipo: "alta"; texto: string };

interface Props {
  abierta: boolean;
  /** Lo que ya se había escrito en el campo de la barra lateral. */
  inicial: string;
  cerrar: () => void;
  leads: Lead[];
  secciones: SeccionPaleta[];
}

export function Paleta(props: Props) {
  if (!props.abierta) return null;
  return createPortal(<Contenido {...props} />, document.body);
}

function Contenido({ inicial, cerrar, leads, secciones }: Props) {
  const { cfg } = useNegocio();
  const frases = useFrases();
  const etapas = useEtapas();
  const [consulta, setConsulta] = useState(inicial);
  const [activo, setActivo] = useState(0);
  const id = useId();
  const entrada = useRef<HTMLInputElement>(null);

  // Al cerrar sin elegir nada (Escape, clic fuera o ⌘K otra vez), el foco vuelve a donde estaba.
  const previo = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const eligio = useRef(false);
  useEffect(() => {
    const anterior = previo.current;
    return () => {
      if (!eligio.current && anterior instanceof HTMLElement && anterior.isConnected) requestAnimationFrame(() => anterior.focus());
    };
  }, []);

  // Lo que venía escrito de la barra lateral: se sigue escribiendo detrás.
  useEffect(() => {
    const e = entrada.current;
    if (!e) return;
    e.focus();
    e.setSelectionRange(e.value.length, e.value.length);
  }, []);

  const texto = consulta.trim();
  const q = normalizar(texto);
  const clientes = q
    ? buscar(leads, texto, { campos: cfg.campos, max: MAXIMO })
    : [...leads].sort((a, b) => b.actualizadoEn - a.actualizadoEn).slice(0, RECIENTES);
  const deSecciones = q ? secciones.filter((s) => normalizar(s.nombre).includes(q)) : [];
  const resultados: Resultado[] = [
    ...clientes.map((lead): Resultado => ({ tipo: "lead", lead })),
    ...(q && clientes.length === 0 ? [{ tipo: "alta", texto } as const] : []),
    ...deSecciones.map((seccion): Resultado => ({ tipo: "seccion", seccion })),
  ];
  const seleccionado = Math.min(activo, Math.max(resultados.length - 1, 0));

  const elegir = (r: Resultado) => {
    eligio.current = true;
    cerrar();
    if (r.tipo === "lead") abrirCliente(r.lead.id);
    else if (r.tipo === "seccion") irA(r.seccion.id);
    else if (!LETRA.test(r.texto) && r.texto.replace(/\D/g, "").length >= 3) abrirAltaCliente({ telefono: r.texto });
    else abrirAltaCliente({ nombre: r.texto });
  };

  // Escape cierra solo el buscador: no llega a la ventana, donde lo escucha la ficha.
  const alPulsar = (evento: KeyboardEvent) => {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setActivo(Math.min(seleccionado + 1, resultados.length - 1));
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setActivo(Math.max(seleccionado - 1, 0));
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      const r = resultados[seleccionado];
      if (r) elegir(r);
    } else if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      cerrar();
    }
  };

  const claseFila = (marcado: boolean) =>
    `flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left max-lg:min-h-12 ${marcado ? "bg-lienzo" : ""}`;

  const fila = (r: Resultado, indice: number) => {
    const marcado = indice === seleccionado;
    const comun = {
      id: `${id}-${indice}`,
      role: "option" as const,
      "aria-selected": marcado,
      onClick: () => elegir(r),
      onMouseMove: () => setActivo(indice),
      className: claseFila(marcado),
    };
    if (r.tipo === "lead") {
      const etapa = etapas[r.lead.estado];
      const detalle = [r.lead.zona, resumenDatos(r.lead, cfg.campos)].filter(Boolean).join(" · ");
      return (
        <li key={r.lead.id} {...comun}>
          <Avatar nombre={r.lead.nombre} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[14px] leading-5 font-medium">{r.lead.nombre}</span>
              {esEjemplo(r.lead) && (
                <span className="shrink-0 rounded-[4px] bg-fondo px-1.5 text-[11px] leading-4 text-secundario">Ejemplo</span>
              )}
            </span>
            <span className="block truncate text-[12px] leading-4 text-secundario">{detalle}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] leading-4 text-secundario">
            <span aria-hidden className={`size-1.5 rounded-full ${PUNTO_TONO[etapa.tono]}`} />
            {etapa.nombre}
          </span>
        </li>
      );
    }
    if (r.tipo === "alta") {
      return (
        <li key="alta" {...comun}>
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fondo">
            <UserPlus className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 truncate text-[14px] leading-5">
            Añadir «{r.texto}» como {frases.cliente.toLowerCase()}
          </span>
        </li>
      );
    }
    return (
      <li key={r.seccion.id} {...comun}>
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fondo">
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </span>
        <span className="text-[14px] leading-5">Ir a {r.seccion.nombre}</span>
      </li>
    );
  };

  const titulo = (texto: string) => (
    <li role="presentation" className="px-3 pt-2 pb-1 text-[12px] leading-4 text-secundario">
      {texto}
    </li>
  );

  const nClientes = clientes.length + (q && clientes.length === 0 ? 1 : 0);

  return (
    // En una pantalla estrecha ocupa toda la pantalla: el campo arriba y los resultados debajo.
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/30 px-4 pt-[14vh] max-lg:p-0" onMouseDown={cerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar"
        onMouseDown={(evento) => evento.stopPropagation()}
        className="w-full max-w-[600px] overflow-hidden rounded-[16px] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.22)] max-lg:flex max-lg:h-[100dvh] max-lg:max-w-none max-lg:flex-col max-lg:rounded-none"
      >
        <div className="flex items-center gap-3 border-b border-linea px-4 max-lg:shrink-0 max-lg:pr-1.5">
          <Search aria-hidden className="size-[18px] shrink-0 text-secundario" strokeWidth={1.75} />
          <input
            ref={entrada}
            autoFocus
            value={consulta}
            onChange={(evento) => {
              setConsulta(evento.target.value);
              setActivo(0);
            }}
            onKeyDown={alPulsar}
            placeholder={frases.buscarPlaceholder}
            aria-label={frases.buscarPlaceholder}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={`${id}-lista`}
            aria-activedescendant={resultados.length ? `${id}-${seleccionado}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-secundario"
          />
          <kbd className="shrink-0 rounded-[6px] border border-linea px-1.5 py-0.5 font-mono text-[11px] text-secundario max-lg:hidden">Esc</kbd>
          {/* Sin teclado no hay Escape: en el móvil, una ✕ para cerrar. */}
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-secundario hover:bg-lienzo hover:text-tinta focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta lg:hidden"
          >
            <X aria-hidden className="size-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2 max-lg:max-h-none max-lg:min-h-0 max-lg:flex-1">
          {resultados.length === 0 ? (
            <p className="px-3 py-6 text-center text-[14px] text-secundario">Aún no tienes {frases.seccionClientes.toLowerCase()}.</p>
          ) : (
            <ul id={`${id}-lista`} role="listbox" aria-label="Resultados" className="flex flex-col">
              {nClientes > 0 && titulo(q ? frases.seccionClientes : "Recientes")}
              {resultados.slice(0, nClientes).map((r, i) => fila(r, i))}
              {deSecciones.length > 0 && titulo("Secciones")}
              {resultados.slice(nClientes).map((r, i) => fila(r, nClientes + i))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-linea px-4 py-2.5 text-[12px] leading-4 text-secundario max-lg:hidden">
          <span>↑ ↓ para moverte</span>
          <span>Enter para abrir</span>
        </div>
      </div>
    </div>
  );
}
