"use client";

import { BellOff, CalendarDays, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EstadoLlegada } from "@/lib/api-tipos";
import { momentoDeHueco } from "@/lib/agenda";
import { explicar } from "@/lib/errores";
import { textoFuente, vinoDeLaWeb } from "@/lib/fuente";
import { asistenteCallado, esperaDesde, sinResponder, ultimoMensaje } from "@/lib/hilo";
import { duracion } from "@/lib/inicio";
import { esEjemplo } from "@/lib/negocio";
import type { Bd, EstadoLead, Lead, Mensaje } from "@/lib/tipos";
import { cap, nombreDePila, resumenDatos } from "@/lib/vocabulario";
import { abrirAltaCliente } from "./alta-cliente";
import { abrirCierre } from "./cierre";
import { desfaseServidor } from "./datos";
import { ListaAparte } from "./lista-aparte";
import { Cronometro, descartarLlegada, fraseDeLlegada, useLlegadas } from "./llegada";
import { irA } from "./navegacion";
import { useNegocio, type ValorNegocio } from "./negocio";
import { Avatar, canalDe, ChipEjemplo, Ticks, etapaDe, sinCorte } from "./piezas";
import { usePuesta } from "./puesta-en-marcha";

// Clientes: un tablero de tres columnas en directo — con tu asistente, con cita y te toca — y, aparte,
// la publicidad y los cerrados. Cada tarjeta dice en su tercera línea lo que está pasando ahora.

const RESALTE_MS = 5_000;
const DESLIZAR_MS = 250;
const ENTRAR_MS = 320;

type Columna = "asistente" | "cita" | "toca";

function columnaDe(estado: EstadoLead): Columna | null {
  if (estado === "nuevo" || estado === "conversacion") return "asistente";
  if (estado === "visita") return "cita";
  if (estado === "persona") return "toca";
  return null;
}

/** El borde de una tarjeta que acaba de cambiar de columna, del color de la columna a la que llega. */
const COLOR_COLUMNA: Record<Columna, string> = {
  asistente: "var(--color-conversacion)",
  cita: "var(--color-ok)",
  toca: "var(--color-atencion)",
};

function poco(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Desliza las tarjetas que cambian de sitio (técnica FLIP): compara cada posición con la del
 * pintado anterior y anima la diferencia. Usa offsetLeft/offsetTop porque no cambian con las
 * animaciones en curso, así un refresco a mitad no las interrumpe. Las tarjetas comparten
 * offsetParent: ni las columnas ni nada entre ellas y `main` puede llevar `position`.
 * Una tarjeta nueva solo entra animada si es una llegada en directo; las demás aparecen sin más.
 */
function useDeslizar(contenedor: RefObject<HTMLElement | null>, enDirecto: RefObject<Set<string>>): void {
  const anteriores = useRef<Map<string, { x: number; y: number }> | null>(null);

  useLayoutEffect(() => {
    // Con una lista aparte no hay tablero: al volver, las tarjetas aparecen sin animar.
    if (!contenedor.current) {
      anteriores.current = null;
      return;
    }
    const previas = anteriores.current;
    const actuales = new Map<string, { x: number; y: number }>();
    const reducir = poco();

    contenedor.current.querySelectorAll<HTMLElement>("[data-lead]").forEach((nodo) => {
      const id = nodo.dataset.lead as string;
      const actual = { x: nodo.offsetLeft, y: nodo.offsetTop };
      actuales.set(id, actual);
      if (!previas || reducir) return;

      const previa = previas.get(id);
      if (!previa) {
        if (enDirecto.current.has(id)) {
          nodo.animate([{ opacity: 0, transform: "translateY(-12px) scale(.98)" }, { opacity: 1, transform: "none" }], {
            duration: ENTRAR_MS,
            easing: "cubic-bezier(.2,.8,.2,1)",
          });
        }
      } else if (previa.x !== actual.x || previa.y !== actual.y) {
        nodo.style.zIndex = "20";
        const desde = `translate(${previa.x - actual.x}px, ${previa.y - actual.y}px)`;
        nodo.animate([{ transform: desde }, { transform: "none" }], { duration: DESLIZAR_MS, easing: "ease-out" }).onfinish = () => {
          nodo.style.zIndex = "";
        };
      }
    });
    anteriores.current = actuales;
  });
}

/** Tarjetas reales que acaban de cambiar de columna: su borde, 5 s. Los ejemplos no cuentan. */
function useResaltados(leads: Lead[]): Map<string, Columna> {
  const anteriores = useRef<Map<string, Columna | null> | null>(null);
  const temporizadores = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [resaltados, setResaltados] = useState<Map<string, Columna>>(new Map());

  // Las listas se recrean en cada refresco: los temporizadores no pueden depender del efecto,
  // o el borde no se quitaría nunca.
  useEffect(() => {
    const previos = anteriores.current;
    anteriores.current = new Map(leads.map((l) => [l.id, columnaDe(l.estado)]));
    if (!previos) return;

    const cambiados = leads.flatMap((l) => {
      const ahora = columnaDe(l.estado);
      return !esEjemplo(l) && previos.has(l.id) && ahora !== null && previos.get(l.id) !== ahora ? [[l.id, ahora] as const] : [];
    });
    if (cambiados.length === 0) return;

    setResaltados((actual) => new Map([...actual, ...cambiados]));
    for (const [id] of cambiados) {
      clearTimeout(temporizadores.current.get(id));
      temporizadores.current.set(
        id,
        setTimeout(() => {
          setResaltados((actual) => {
            const siguiente = new Map(actual);
            siguiente.delete(id);
            return siguiente;
          });
        }, RESALTE_MS),
      );
    }
  }, [leads]);

  useEffect(() => {
    const activos = temporizadores.current;
    return () => {
      for (const temporizador of activos.values()) clearTimeout(temporizador);
    };
  }, []);

  return resaltados;
}

/** El primer WhatsApp de una llegada: la bienvenida (web y a mano) o la primera respuesta (WhatsApp). */
function primerSaliente(lead: Lead, canal: EstadoLlegada["canal"]): Mensaje | undefined {
  const salientes = lead.mensajes.filter((m) => m.de === "agente");
  return canal === "whatsapp" ? salientes[0] : (salientes.find((m) => m.plantilla) ?? salientes[0]);
}

/** Acabada y aún reciente: existe y el cliente no ha escrito después de su fin. */
function fresca(e: EstadoLlegada, lead: Lead): boolean {
  if (e.fin === null) return false;
  const fin = e.fin;
  const desfase = desfaseServidor();
  return !lead.mensajes.some((m) => m.de === "cliente" && m.ts - desfase > fin);
}

function enMarcha(e: EstadoLlegada | undefined): boolean {
  return !!e && e.fin === null && e.fallo === null && e.enDirecto;
}

/** El punto de la marca que acompaña al cronómetro mientras corre. */
function Pulso() {
  return (
    <span aria-hidden className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-marca opacity-50 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-marca" />
    </span>
  );
}

/** La línea viva se lee entera hasta en dos líneas; solo lo que pase de ahí acaba en «…». */
const DOS_LINEAS = "min-w-0 line-clamp-2 break-words";

const BOTON_LINEA =
  "relative z-10 shrink-0 cursor-pointer rounded-[6px] px-1.5 py-0.5 text-[13px] leading-[18px] font-medium transition-colors duration-150 ease-out max-lg:my-0 max-lg:min-h-11 max-lg:px-3";

/** «No le ha llegado el WhatsApp: …», «Arreglar» y «Quitar aviso». */
function LineaFallo({ entrada }: { entrada: EstadoLlegada }) {
  const puesta = usePuesta();
  const fallo = entrada.fallo;
  if (!fallo) return null;
  const arreglar = () => {
    const paso = explicar(fallo.codigo).paso;
    if (paso) puesta.abrir(paso);
    else irA("configuracion", { bloque: "whatsapp" });
  };
  return (
    <div className="flex items-start gap-2 max-lg:flex-wrap max-lg:items-center">
      <p className="min-w-0 flex-1 text-[13px] leading-[18px] break-words text-error-texto max-lg:basis-full">No le ha llegado el WhatsApp: {fallo.texto}</p>
      <button type="button" onClick={arreglar} className={`${BOTON_LINEA} -my-0.5 bg-error/10 text-error-texto hover:bg-error/15`}>
        Arreglar
      </button>
      <button
        type="button"
        onClick={() => descartarLlegada(entrada.leadId)}
        aria-label="Quitar aviso"
        title="Quitar aviso"
        className="relative z-10 -my-0.5 flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-secundario transition-colors duration-150 ease-out hover:bg-fondo hover:text-tinta max-lg:my-0 max-lg:size-11"
      >
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

/** La tercera línea: lo primero que se cumpla de la lista (§5.3). */
function LineaViva(p: {
  lead: Lead;
  entrada: EstadoLlegada | undefined;
  ahora: Date;
  escribiendo: boolean;
  pausadoEn: number | null;
  negocio: ValorNegocio;
}): ReactNode {
  const { lead, entrada, ahora, escribiendo, pausadoEn, negocio } = p;
  const { cfg, frases, formato, zona } = negocio;
  const t = ahora.getTime();
  const linea = "flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px]";

  // 1. La llegada ha fallado.
  if (entrada?.fallo) return <LineaFallo entrada={entrada} />;

  // 2. El asistente debería haber contestado y no lo ha hecho.
  const callado = asistenteCallado(lead, t, escribiendo, pausadoEn);
  if (callado === "fallo") {
    return <p className={`${linea} text-error-texto`}>Sin contestar · {sinCorte(duracion(t - (esperaDesde(lead) ?? t)))}</p>;
  }
  if (callado === "pausa") return <p className={`${linea} text-atencion-texto`}>Asistente apagado · espera respuesta</p>;

  // 3. Te toca: el motivo.
  if (lead.estado === "persona") {
    const espera = sinResponder(lead) > 0 ? esperaDesde(lead) : null;
    return (
      <p className={`${linea} text-atencion-texto`}>
        <span className={DOS_LINEAS}>
          {lead.motivoPersona || "Te ha pedido hablar contigo"}
          {espera !== null && sinCorte(` · Sin responder · ${duracion(t - espera)}`)}
        </span>
      </p>
    );
  }

  // 4. La llegada: corriendo, o el tiempo final mientras siga reciente.
  if (entrada && enMarcha(entrada)) {
    return (
      <p className={linea}>
        <span className="min-w-0 truncate">{cap(fraseDeLlegada(entrada.canal, cfg))}</span>
        <Pulso />
        <span className="font-medium text-marca-texto">
          <Cronometro inicio={entrada.inicio} fin={entrada.fin} enDirecto={entrada.enDirecto} />
        </span>
      </p>
    );
  }
  if (entrada && entrada.fin !== null && fresca(entrada, lead)) {
    const primero = primerSaliente(lead, entrada.canal);
    return (
      <p className={linea}>
        <span className="text-marca-texto">
          {entrada.canal === "whatsapp" ? "Contestado en " : "WhatsApp enviado en "}
          <span className="font-medium">
            <Cronometro inicio={entrada.inicio} fin={entrada.fin} enDirecto={entrada.enDirecto} />
          </span>
        </span>
        {primero && <Ticks mensaje={primero} />}
      </p>
    );
  }

  // 5. Escribiendo.
  if (escribiendo) {
    return (
      <p className={`${linea} text-secundario`}>
        <span aria-hidden className="flex items-center gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-[5px] rounded-full bg-marca animate-escribiendo motion-reduce:animate-none"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
        escribiendo…
      </p>
    );
  }

  // 6. La cita: próxima en verde; pasada y sin cerrar, en gris con «¿Cómo fue?».
  if (lead.visita) {
    const momento = momentoDeHueco(lead.visita.id, zona);
    const cuando = Number.isFinite(momento) ? formato.corta(momento) : lead.visita.texto;
    const Cita = cap(cfg.vocabulario.cita.singular);
    if (!(momento < t)) {
      return (
        <p className={`${linea} text-ok-texto`}>
          <CalendarDays className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate tabular-nums">
            {Cita} · {cuando}
          </span>
        </p>
      );
    }
    if (!lead.cierre) {
      return (
        <div className={`${linea} justify-between text-secundario`}>
          <span className="flex min-w-0 items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 truncate tabular-nums">
              {frases.citaPasada} · {cuando}
            </span>
          </span>
          <button type="button" onClick={() => abrirCierre(lead)} className={`${BOTON_LINEA} -my-0.5 bg-fondo text-tinta hover:bg-[#e2e1dd]`}>
            {frases.comoFueCorto}
          </button>
        </div>
      );
    }
  }

  // 7. El último mensaje.
  if (!lead.mensajes.some((m) => m.de === "cliente")) return <p className={`${linea} text-secundario`}>Aún no ha contestado</p>;
  const ultimo = ultimoMensaje(lead);
  if (!ultimo) return null;
  const quien =
    ultimo.de === "cliente" ? nombreDePila(lead.nombre) : ultimo.manual ? "Tú" : ultimo.plantilla ? "Mensaje de bienvenida" : "Tu asistente";
  return (
    <p className={`${linea} text-secundario`}>
      <span className={DOS_LINEAS}>
        <span className="text-tinta/75">{quien}:</span> {sinCorte(ultimo.texto)}
      </span>
    </p>
  );
}

function Tarjeta(p: {
  id: string;
  lead?: Lead;
  entrada?: EstadoLlegada;
  ahora: Date;
  resalte: string | null;
  escribiendo: boolean;
  pausadoEn: number | null;
  abrir: (id: string) => void;
  negocio: ValorNegocio;
}) {
  const { id, lead, entrada, ahora, resalte, escribiendo, pausadoEn, abrir, negocio } = p;
  const { cfg, formato } = negocio;
  const origen = lead?.origen ?? entrada?.canal ?? "formulario";
  const canal = canalDe(lead, origen);
  // Quien llegó con el botón de la web ya lo dice el canal: la fuente no se repite.
  const fuente = vinoDeLaWeb(lead) ? "" : textoFuente(lead?.fuente);
  const nombre = lead?.nombre ?? entrada?.nombre ?? "";
  const color = etapaDe(lead?.estado ?? "nuevo").color;
  const ejemplo = !!lead && esEjemplo(lead);

  const borde = entrada?.fallo
    ? "var(--color-error)"
    : entrada && (enMarcha(entrada) || (entrada.enDirecto && entrada.fin !== null && Date.now() - entrada.fin < RESALTE_MS))
      ? "var(--color-marca)"
      : resalte;

  return (
    <article
      data-lead={id}
      className={`relative rounded-[10px] border border-linea bg-white px-3 py-3 shadow-[0_1px_2px_rgba(20,20,20,0.04)] outline-2 -outline-offset-2 transition-[outline-color,border-color] duration-200 ease-out ${
        lead ? "hover:border-[#cfcdc8]" : ""
      }`}
      style={{ outlineColor: borde ?? "transparent" }}
    >
      <div className="flex items-start gap-2.5">
        <Avatar nombre={nombre} color={color} />
        <div className="min-w-0 flex-1">
          {/* El nombre y lo que quiere, a la izquierda; la hora y el canal, a su derecha. */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
            <h3 className="text-[15px] leading-5 font-medium">
              {lead ? (
                <button
                  type="button"
                  onClick={() => abrir(lead.id)}
                  className="cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[10px] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-tinta/50"
                >
                  <span className="line-clamp-2 break-words">{nombre}</span>
                </button>
              ) : (
                <span className="line-clamp-2 break-words">{nombre}</span>
              )}
            </h3>
            <p className="mt-0.5 truncate text-[13px] leading-[18px] text-secundario">
              {lead ? sinCorte(resumenDatos(lead, cfg.campos)) : entrada ? cap(fraseDeLlegada(entrada.canal, cfg)) : ""}
            </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
              <span className="text-[12px] leading-4 text-secundario tabular-nums">{lead ? formato.corta(lead.actualizadoEn) : "ahora"}</span>
              <span className="flex items-center gap-1.5 text-secundario">
                {ejemplo && <ChipEjemplo />}
                {lead?.silenciadoEn && (
                  <span title="No quiere mensajes" className="flex">
                    <BellOff aria-hidden className="size-3.5" strokeWidth={1.75} />
                    <span className="sr-only">No quiere mensajes</span>
                  </span>
                )}
                <span title={canal.frase + (fuente ? ` · ${fuente}` : "")} className="flex">
                  <canal.Icono aria-hidden className="size-3.5" strokeWidth={1.75} />
                  <span className="sr-only">
                    {canal.frase}
                    {fuente && ` · ${fuente}`}
                  </span>
                </span>
              </span>
            </div>
          </div>
          <div className="mt-1.5 min-h-[18px]">
            {lead ? (
              <LineaViva lead={lead} entrada={entrada} ahora={ahora} escribiendo={escribiendo} pausadoEn={pausadoEn} negocio={negocio} />
            ) : entrada?.fallo ? (
              <LineaFallo entrada={entrada} />
            ) : entrada && enMarcha(entrada) ? (
              <p className="flex items-center gap-1.5 text-[13px] leading-[18px] font-medium text-marca-texto">
                <Pulso />
                <Cronometro inicio={entrada.inicio} fin={entrada.fin} enDirecto={entrada.enDirecto} />
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * En una pantalla estrecha se apilan con «Te toca» arriba. Solo cambia el orden en pantalla: el del
 * DOM (y el del tabulador en el ordenador) sigue siendo el de las tres columnas.
 */
const COLUMNAS: { id: Columna; punto: string; orden: string }[] = [
  { id: "asistente", punto: "bg-conversacion", orden: "max-lg:order-2" },
  { id: "cita", punto: "bg-visita", orden: "max-lg:order-3" },
  { id: "toca", punto: "bg-persona", orden: "max-lg:order-1" },
];

export function VistaLeads(
  props: {
    bd: Bd;
    ahora: Date;
    abrir: (id: string) => void;
    /** La fila del título del panel: ahí van «Publicidad · Cerrados» y «+ Cliente». Sin ella, encima del tablero. */
    ranura?: HTMLElement | null;
  },
) {
  const { bd, ahora, abrir, ranura } = props;
  const negocio = useNegocio();
  const { cfg, frases } = negocio;
  const { porLead, provisionales } = useLlegadas(bd);
  const [aparte, setAparte] = useState<"publicidad" | "cerrados" | null>(null);

  const todos = Object.values(bd.leads);
  const enTablero = todos.filter((l) => l.estado !== "spam" && !l.cierre);
  const publicidad = todos.filter((l) => l.estado === "spam").length;
  const cerrados = todos.filter((l) => !!l.cierre && l.estado !== "spam").length;
  const resaltados = useResaltados(enTablero);
  const pausadoEn = cfg.sistema.asistente.pausadoEn;

  // Las llegadas en directo que pueden entrar animadas en este pintado.
  const vivas = useRef(new Set<string>());
  vivas.current = new Set(Object.values(porLead).filter((e) => e.enDirecto).map((e) => e.leadId));
  const seccion = useRef<HTMLElement>(null);
  useDeslizar(seccion, vivas);

  const nombres: Record<Columna, string> = { asistente: frases.conTuAsistente, cita: frases.conCita, toca: frases.teToca };
  const porColumna: Record<Columna, Lead[]> = { asistente: [], cita: [], toca: [] };
  for (const lead of enTablero) {
    const columna = columnaDe(lead.estado);
    if (columna) porColumna[columna].push(lead);
  }
  for (const lista of Object.values(porColumna)) lista.sort((a, b) => b.actualizadoEn - a.actualizadoEn);
  const vacio = enTablero.length === 0 && provisionales.length === 0;

  const tarjeta = (id: string, lead: Lead | undefined, entrada: EstadoLlegada | undefined) => {
    const columna = lead ? columnaDe(lead.estado) : null;
    return (
      <Tarjeta
        key={id}
        id={id}
        lead={lead}
        entrada={entrada}
        ahora={ahora}
        resalte={columna && resaltados.get(id) === columna ? COLOR_COLUMNA[columna] : null}
        escribiendo={!!lead && !!bd.escribiendo?.includes(id)}
        pausadoEn={pausadoEn}
        abrir={abrir}
        negocio={negocio}
      />
    );
  };

  const enlace =
    "cursor-pointer rounded-[4px] text-[13px] leading-[18px] text-secundario underline-offset-2 transition-colors duration-150 ease-out hover:text-tinta hover:underline tabular-nums max-lg:min-h-11";

  const acciones = (
    <>
      <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-secundario max-lg:flex-wrap">
        <button type="button" onClick={() => setAparte("publicidad")} aria-pressed={aparte === "publicidad"} className={enlace}>
          {frases.publicidad} ({publicidad})
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={() => setAparte("cerrados")} aria-pressed={aparte === "cerrados"} className={enlace}>
          {frases.cerrados} ({cerrados})
        </button>
      </p>
      <button
        type="button"
        onClick={() => abrirAltaCliente()}
        className="h-9 cursor-pointer rounded-[8px] bg-tinta px-3.5 text-[14px] font-medium text-white transition-opacity duration-150 ease-out hover:opacity-90 max-lg:min-h-11"
      >
        {frases.nuevoCliente}
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {ranura ? createPortal(acciones, ranura) : <div className="flex items-center justify-end gap-4 max-lg:flex-wrap">{acciones}</div>}

      {aparte ? (
        <ListaAparte tipo={aparte} bd={bd} ahora={ahora} abrir={abrir} volver={() => setAparte(null)} />
      ) : vacio ? (
        <section className="flex min-h-[max(320px,calc(100vh-292px))] flex-col items-center justify-center gap-2 rounded-[12px] bg-black/[0.035] px-6 text-center">
          <p className="text-[17px] leading-6 font-medium">Tu asistente está listo</p>
          <a
            href="/"
            target="_blank"
            rel="noopener"
            className="text-[14px] leading-5 text-secundario underline underline-offset-2 transition-colors duration-150 ease-out hover:text-tinta"
          >
            Abrir mi formulario
          </a>
        </section>
      ) : (
        <section ref={seccion} className="grid grid-cols-3 items-start gap-4 max-lg:grid-cols-1" aria-label={frases.seccionClientes}>
          {COLUMNAS.map(({ id, punto, orden }) => {
            const leads = porColumna[id];
            const provisionalesAqui = id === "asistente" ? provisionales : [];
            return (
              <div key={id} className={`flex min-w-0 flex-col gap-2 ${orden}`}>
                <h2 className="flex h-7 items-center gap-2 px-1.5 text-[13px] leading-[18px] font-medium">
                  <span aria-hidden className={`size-2 shrink-0 rounded-full ${punto}`} />
                  {nombres[id]}
                  <span className="font-normal text-secundario tabular-nums">{leads.length + provisionalesAqui.length}</span>
                </h2>
                {/* La bandeja acaba con su última tarjeta; vacía, guarda el alto de una. */}
                <div className="flex min-h-[88px] flex-col gap-2 rounded-[12px] bg-black/[0.035] p-1.5">
                  {/* Una sola lista: la tarjeta provisional y la real comparten clave, y el nodo se conserva. */}
                  {[...provisionalesAqui.map((e) => tarjeta(e.leadId, undefined, e)), ...leads.map((lead) => tarjeta(lead.id, lead, porLead[lead.id]))]}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
