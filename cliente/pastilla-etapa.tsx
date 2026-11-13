"use client";

import { ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { momentoDeHueco } from "@/lib/agenda";
import type { Lead } from "@/lib/tipos";
import { cap, concordar, formas, type Tono } from "@/lib/vocabulario";
import { abrirCierre } from "./cierre";
import { confirmar } from "./confirmaciones";
import { cambiarEtapa, cerrarVisita, desfaseServidor } from "./datos";
import { useNegocio } from "./negocio";
import { anularCita, SelectorCita } from "./selector-cita";

// La pastilla de la etapa, en la cabecera de la ficha, es el control: dice dónde está el cliente y,
// al pulsarla, qué se puede hacer con él. Lo que no envía nada al cliente se hace sin preguntar y se
// puede deshacer; lo que anula algo o le devuelve el control al asistente pregunta antes.

/** «Lo llevo yo»: el asistente deja de contestarle. Sin diálogo, porque no se le envía nada y se deshace. */
export async function llevarloYo(lead: Lead, refrescar?: () => Promise<void>): Promise<void> {
  const fallo = await cambiarEtapa(lead.id, "persona");
  if (fallo) {
    confirmar(fallo, { tono: "error" });
    return;
  }
  confirmar("Tu asistente ya no le contesta", {
    accion: {
      texto: "Deshacer",
      hacer: () => {
        void cambiarEtapa(lead.id, "asistente").then((otro) => {
          if (otro) confirmar(otro, { tono: "error" });
          else void refrescar?.();
        });
      },
    },
  });
  void refrescar?.();
}

const COLOR_TONO: Record<Tono, string> = {
  gris: "var(--color-conversacion)",
  ok: "var(--color-ok)",
  atencion: "var(--color-atencion)",
};

type Opcion = "dar" | "cambiar" | "anular" | "llevo" | "devolver" | "spam" | "no-spam" | "si" | "no" | "reabrir";
type Pregunta = "devolver" | "spam" | "anular" | null;

function citaFutura(lead: Lead, zona: string): boolean {
  return !!lead.visita && momentoDeHueco(lead.visita.id, zona) > Date.now() + desfaseServidor();
}

export function PastillaEtapa({ lead, refrescar }: { lead: Lead; refrescar?: () => Promise<void> }) {
  const { etapas, frases, zona, cfg } = useNegocio();
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const [pregunta, setPregunta] = useState<Pregunta>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selector, setSelector] = useState<"dar" | "cambiar" | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const cerrado = lead.cierre;
  const { nombre, tono }: { nombre: string; tono: Tono } = cerrado
    ? { nombre: cerrado === "si" ? frases.haDichoQueSi : frases.noSigue, tono: cerrado === "si" ? "ok" : "gris" }
    : etapas[lead.estado];
  const color = COLOR_TONO[tono];

  // La cita a mano va arriba: con una futura, cambiarla o anularla; sin ella (o con una ya pasada), darla.
  // «Con visita» nunca es un cambio de etapa suelto: se llega dando la cita.
  const opcionesCita: { id: Opcion; texto: string }[] = citaFutura(lead, zona)
    ? [
        { id: "cambiar", texto: "Cambiar cita" },
        { id: "anular", texto: "Anular cita" },
      ]
    : [{ id: "dar", texto: "Dar cita" }];

  const opciones: { id: Opcion; texto: string }[] = cerrado
    ? [{ id: "reabrir", texto: frases.reabrir }]
    : lead.estado === "spam"
      ? [{ id: "no-spam", texto: "No es publicidad" }]
      : lead.estado === "persona"
        ? [
            ...opcionesCita,
            { id: "devolver", texto: "Devolver a tu asistente" },
            { id: "si", texto: frases.haDichoQueSi },
            { id: "no", texto: frases.noSigue },
            { id: "spam", texto: "Es publicidad" },
          ]
        : [
            ...opcionesCita,
            { id: "llevo", texto: "Lo llevo yo" },
            { id: "spam", texto: "Es publicidad" },
            { id: "si", texto: frases.haDichoQueSi },
            { id: "no", texto: frases.noSigue },
          ];

  const cerrar = (devolverFoco = true) => {
    setAbierto(false);
    setPregunta(null);
    setError(null);
    if (devolverFoco) boton.current?.focus();
  };

  // Al abrir (o al pasar a una pregunta), el foco entra: en la primera opción o en el botón de confirmar.
  useEffect(() => {
    if (!abierto) return;
    const nodo = menu.current;
    nodo?.querySelector<HTMLElement>(pregunta ? "[data-confirmar]" : '[role="menuitem"]')?.focus();
  }, [abierto, pregunta]);

  // Un clic fuera lo cierra, sin robar el foco a lo que se haya pulsado.
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: PointerEvent) => {
      const objetivo = e.target as Node;
      if (menu.current?.contains(objetivo) || boton.current?.contains(objetivo)) return;
      setAbierto(false);
      setPregunta(null);
      setError(null);
    };
    document.addEventListener("pointerdown", alPulsar);
    return () => document.removeEventListener("pointerdown", alPulsar);
  }, [abierto]);

  // Si el cliente cambia de etapa mientras tanto (otro ordenador, el asistente), el menú ya no vale.
  const firma = `${lead.estado}|${lead.cierre ?? ""}`;
  const firmaAbierta = useRef(firma);
  useEffect(() => {
    if (firmaAbierta.current !== firma && abierto && !ocupado) cerrar(false);
    firmaAbierta.current = firma;
  }, [firma]);

  const hacer = async (peticion: Promise<string | null>, aviso: string) => {
    setOcupado(true);
    setError(null);
    const fallo = await peticion;
    setOcupado(false);
    if (fallo) {
      setError(fallo);
      return;
    }
    cerrar();
    confirmar(aviso);
    void refrescar?.();
  };

  const elegir = (o: Opcion) => {
    switch (o) {
      case "dar":
      case "cambiar":
        // El menú se cierra sin devolver el foco: lo coge el selector y vuelve a la pastilla al cerrarlo.
        cerrar(false);
        setSelector(o);
        return;
      case "anular":
        setPregunta("anular");
        return;
      case "llevo":
        cerrar();
        void llevarloYo(lead, refrescar);
        return;
      case "devolver":
        setPregunta("devolver");
        return;
      case "spam":
        if (citaFutura(lead, zona)) setPregunta("spam");
        else void hacer(cambiarEtapa(lead.id, "spam"), "Movido a Publicidad");
        return;
      case "no-spam":
        void hacer(cambiarEtapa(lead.id, "no-spam"), "Ya no está en Publicidad");
        return;
      case "si":
      case "no":
        // Primero se cierra el menú y el foco vuelve a la pastilla: el diálogo lo devuelve ahí al cerrar.
        cerrar();
        abrirCierre(lead, { accion: o });
        return;
      case "reabrir":
        void hacer(cerrarVisita(lead.id, { accion: "reabrir" }), "Reabierto");
        return;
    }
  };

  const alPulsarMenu = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      evento.preventDefault();
      cerrar();
      return;
    }
    if (evento.key === "Tab") {
      cerrar(false);
      return;
    }
    if (pregunta || (evento.key !== "ArrowDown" && evento.key !== "ArrowUp" && evento.key !== "Home" && evento.key !== "End")) return;
    evento.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const actual = items.indexOf(document.activeElement as HTMLElement);
    const siguiente =
      evento.key === "Home"
        ? 0
        : evento.key === "End"
          ? items.length - 1
          : (actual + (evento.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[siguiente]?.focus();
  };

  const sustantivo = cfg.vocabulario.cita;
  const cita = sustantivo.singular;
  const anulada = `${cap(cita)} ${concordar(sustantivo, "anulad")}`;

  return (
    <div className="relative">
      <button
        ref={boton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? `${id}-menu` : undefined}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !abierto) {
            e.preventDefault();
            setAbierto(true);
          }
        }}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full py-0 pr-2 pl-3 max-sm:h-11 max-sm:pr-3 max-sm:pl-3.5 text-[13px] leading-[18px] font-medium whitespace-nowrap transition-[filter] duration-150 ease-out hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        style={{ background: `color-mix(in srgb, ${color} 15%, white)` }}
      >
        <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
        {nombre}
        <ChevronDown aria-hidden className={`size-4 text-tinta/60 transition-transform duration-150 ${abierto ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </button>

      {abierto && (
        <div
          ref={menu}
          id={`${id}-menu`}
          onKeyDown={alPulsarMenu}
          className="absolute top-[calc(100%+6px)] right-0 z-10 w-[264px] max-w-[calc(100vw-2rem)] rounded-[12px] max-sm:right-auto max-sm:left-0 border border-linea bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
        >
          {pregunta ? (
            <div role="group" aria-labelledby={`${id}-pregunta`} className="p-2">
              <p id={`${id}-pregunta`} className="text-[13px] leading-[18px]">
                {pregunta === "devolver"
                  ? "Tu asistente volverá a contestarle."
                  : pregunta === "anular"
                    ? `¿Anular ${formas(sustantivo).el} ${cita} del ${lead.visita?.texto ?? ""}? El hueco queda libre.`
                    : `Se anula su ${cita} del ${lead.visita?.texto ?? ""} y el hueco queda libre.`}
              </p>
              {error && (
                <p role="alert" className="mt-2 text-[12px] leading-4 text-error-texto">
                  {error}
                </p>
              )}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPregunta(null)}
                  className="h-8 cursor-pointer rounded-[8px] border border-linea bg-white px-3 text-[13px] transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-sm:h-11 max-sm:px-4"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  data-confirmar
                  disabled={ocupado}
                  onClick={() =>
                    void (pregunta === "devolver"
                      ? hacer(cambiarEtapa(lead.id, "asistente"), "Devuelto a tu asistente")
                      : pregunta === "anular"
                        ? hacer(anularCita(lead.id), anulada)
                        : hacer(cambiarEtapa(lead.id, "spam"), "Movido a Publicidad"))
                  }
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] bg-tinta px-3 text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-wait max-sm:h-11 max-sm:px-4"
                >
                  {ocupado && <LoaderCircle aria-hidden className="size-3.5 animate-spin" strokeWidth={1.75} />}
                  {pregunta === "devolver" ? "Devolver" : pregunta === "anular" ? "Anular" : "Es publicidad"}
                </button>
              </div>
            </div>
          ) : (
            <div role="menu" aria-label={nombre} aria-busy={ocupado}>
              {opciones.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={ocupado}
                  onClick={() => elegir(o.id)}
                  className="flex h-9 w-full cursor-pointer items-center rounded-[8px] px-2.5 text-left max-sm:h-11 text-[13px] leading-[18px] outline-none transition-colors duration-100 ease-out hover:bg-lienzo focus-visible:bg-lienzo disabled:cursor-wait"
                >
                  {o.texto}
                </button>
              ))}
              {error && (
                <p role="alert" className="px-2.5 pt-1 pb-1.5 text-[12px] leading-4 text-error-texto">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {selector && (
        <SelectorCita
          lead={lead}
          accion={selector}
          refrescar={refrescar}
          cerrar={() => {
            setSelector(null);
            requestAnimationFrame(() => boton.current?.focus());
          }}
        />
      )}
    </div>
  );
}
