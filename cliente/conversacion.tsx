"use client";

import { BellOff, ChevronDown, LoaderCircle, PowerOff, SendHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { vinoDeLaWeb } from "@/lib/fuente";
import { textoVentana, ventana24h, volvioAEscribir } from "@/lib/hilo";
import { esEjemplo } from "@/lib/negocio";
import type { Lead } from "@/lib/tipos";
import { confirmar } from "./confirmaciones";
import { cerrarVisita, desfaseServidor, permitirMensajes, responderAMano } from "./datos";
import { Ficha } from "./ficha";
import { Hilo } from "./hilo";
import { useNegocio } from "./negocio";
import { llevarloYo, PastillaEtapa } from "./pastilla-etapa";
import { Avatar } from "./piezas";
import { CajaRetomar } from "./retomar";

// La ficha de un cliente: la conversación primero (a la izquierda, ancha) y la ficha a la derecha.
// Se abre encima del panel como un diálogo; Escape la cierra (los menús y diálogos de dentro paran
// su propio Escape) y el tabulador no sale de ella. En el móvil (menos de 640 px) ocupa toda la
// pantalla: la cabecera arriba, la caja de escribir abajo y la ficha plegada bajo la conversación.

const LARGO_MAXIMO = 4_096;
const ALTO_MAXIMO_PX = 124;
const RELOJ_MS = 15_000;

const CON_EL_ASISTENTE = ["nuevo", "conversacion", "visita"];

const BOTON_SECUNDARIO =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-linea bg-white px-3.5 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-wait";

const ESTRECHA = "(max-width: 639.98px)";

function suscribirAncho(aviso: () => void): () => void {
  const consulta = window.matchMedia(ESTRECHA);
  consulta.addEventListener("change", aviso);
  return () => consulta.removeEventListener("change", aviso);
}

/** Si la pantalla es de móvil (por debajo de 640 px, el `sm` de Tailwind). En el servidor, no. */
function usePantallaEstrecha(): boolean {
  return useSyncExternalStore(
    suscribirAncho,
    () => window.matchMedia(ESTRECHA).matches,
    () => false,
  );
}

/** La hora del servidor, cada 15 s: «hace 3 min», la ventana de 24 h y los 2 minutos sin contestar. */
function useReloj(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now() + desfaseServidor());
  useEffect(() => {
    if (!activo) return;
    setAhora(Date.now() + desfaseServidor());
    const intervalo = setInterval(() => setAhora(Date.now() + desfaseServidor()), RELOJ_MS);
    return () => clearInterval(intervalo);
  }, [activo]);
  return ahora;
}

// ---- Cabecera ----

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] bg-fondo px-1.5 text-[11px] leading-4 font-medium text-tinta/75">
      {children}
    </span>
  );
}

function Cabecera({ lead, idTitulo, cerrar, refrescar }: { lead: Lead; idTitulo: string; cerrar: () => void; refrescar: () => Promise<void> }) {
  const { cfg, formato } = useNegocio();
  const fecha = formato.corta(lead.creadoEn);
  const zona = lead.zona && cfg.vocabulario.zona !== null ? ` · ${lead.zona}` : "";
  const linea =
    lead.origen === "formulario"
      ? `Llegó por tu web · ${fecha}${zona}`
      : vinoDeLaWeb(lead)
        ? `Te escribió desde tu web · ${fecha}${zona}`
        : lead.origen === "whatsapp"
        ? `Te escribió por WhatsApp · ${fecha}${zona}`
        : lead.origen === "manual"
          ? `Lo añadiste tú · ${fecha}`
          : `Ejemplo · ${fecha}`;
  const ejemplo = esEjemplo(lead);
  const otroNegocio = lead.perfilId !== cfg.perfil.id && !ejemplo;

  return (
    <header className="flex items-start justify-between gap-4 border-b border-linea px-5 py-4 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-2 max-sm:gap-y-2.5 max-sm:px-4 max-sm:py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar nombre={lead.nombre} grande />
        <div className="min-w-0 pt-0.5">
          <h2 id={idTitulo} tabIndex={-1} className="line-clamp-2 text-[18px] leading-6 font-medium break-words outline-none">
            {lead.nombre}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] leading-[18px] text-secundario tabular-nums">{linea}</p>
            {ejemplo && <Chip>Ejemplo</Chip>}
            {lead.silenciadoEn && (
              <Chip>
                <BellOff aria-hidden className="size-3" strokeWidth={2} />
                No quiere mensajes
              </Chip>
            )}
            {otroNegocio && <Chip title="Es de otro tipo de negocio">{lead.perfilNombre}</Chip>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1.5 max-sm:contents">
        <div className="max-sm:col-span-2 max-sm:row-start-2">
          <PastillaEtapa lead={lead} refrescar={refrescar} />
        </div>
        <button
          type="button"
          onClick={cerrar}
          aria-label="Cerrar"
          title="Cerrar"
          className="flex size-8 cursor-pointer items-center justify-center rounded-[8px] text-secundario transition-colors duration-150 ease-out hover:bg-lienzo hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-sm:col-start-2 max-sm:row-start-1 max-sm:-mt-1 max-sm:-mr-2 max-sm:size-11"
        >
          <X className="size-[18px]" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

// ---- Avisos encima del hilo ----

function Silenciado({ lead }: { lead: Lead }) {
  const { formato } = useNegocio();
  const [preguntando, setPreguntando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const permitir = async () => {
    setEnviando(true);
    setError(null);
    const fallo = await permitirMensajes(lead.id);
    setEnviando(false);
    if (fallo) return setError(fallo);
    setPreguntando(false);
    confirmar("Se le puede volver a escribir");
  };

  return (
    <div role="status" className="border-b border-linea bg-white px-5 py-3.5 text-[13px] leading-[18px]">
      <div className="flex gap-3">
        <BellOff aria-hidden className="mt-px size-4 shrink-0 text-secundario" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-medium">Ha pedido que no le escribamos · {formato.corta(lead.silenciadoEn ?? 0)}.</span>{" "}
            <span className="text-secundario">
              Tu asistente no le contesta y no se le puede escribir por WhatsApp. Si vuelve a escribir algo más que un «gracias», se le vuelve a atender.
            </span>
          </p>
          {!esEjemplo(lead) &&
            (preguntando ? (
              <div className="mt-3 rounded-[10px] border border-linea bg-lienzo px-3.5 py-3">
                <p>¿Te ha pedido que le volvamos a escribir? Hazlo solo si te lo ha dicho por teléfono o en persona.</p>
                <div className="mt-2.5 flex justify-end gap-2">
                  <button type="button" onClick={() => setPreguntando(false)} className={BOTON_SECUNDARIO}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => void permitir()}
                    disabled={enviando}
                    className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[8px] bg-tinta px-3.5 text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-wait"
                  >
                    {enviando && <LoaderCircle aria-hidden className="size-4 animate-spin" strokeWidth={1.75} />}
                    Permitir
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setPreguntando(true)} className={`${BOTON_SECUNDARIO} mt-2.5 h-8 px-3 font-normal`}>
                Volver a permitir mensajes
              </button>
            ))}
          {error && (
            <p role="alert" className="mt-2 text-[12px] leading-4 text-error-texto">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Abajo: la caja para escribir, o por qué no la hay ----

function Caja({ lead, ahora, refrescar, conLlevarloYo }: { lead: Lead; ahora: number; refrescar: () => Promise<void>; conLlevarloYo: boolean }) {
  const { zona } = useNegocio();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const ejemplo = esEjemplo(lead);

  // Crece con el texto hasta unas cinco líneas; a partir de ahí se desplaza.
  useLayoutEffect(() => {
    const nodo = campo.current;
    if (!nodo) return;
    nodo.style.height = "auto";
    // scrollHeight no cuenta el borde: sin sumarlo, sale una barra de desplazamiento con una línea.
    const borde = nodo.offsetHeight - nodo.clientHeight;
    nodo.style.height = `${Math.min(nodo.scrollHeight + borde, ALTO_MAXIMO_PX)}px`;
  }, [texto]);

  const enviar = async () => {
    const limpio = texto.trim();
    if (!limpio || enviando || ejemplo) return;
    setEnviando(true);
    setError(null);
    const fallo = await responderAMano(lead.id, limpio);
    setEnviando(false);
    if (fallo) {
      setError(fallo);
    } else {
      setTexto("");
      void refrescar();
    }
    campo.current?.focus();
  };

  const ventana = textoVentana(ventana24h(lead, ahora), ahora, zona);

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        void enviar();
      }}
      aria-busy={enviando}
      className="border-t border-linea bg-white px-5 pt-3 pb-3.5 max-sm:sticky max-sm:bottom-0 max-sm:z-[1] max-sm:px-4"
    >
      <div className="flex items-end gap-2">
        <label htmlFor="respuesta-manual" className="sr-only">
          Mensaje para {lead.nombre}
        </label>
        <textarea
          ref={campo}
          id="respuesta-manual"
          rows={1}
          value={texto}
          disabled={ejemplo}
          maxLength={LARGO_MAXIMO}
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={(evento) => {
            // Intro envía, como en WhatsApp Web. Mayús+Intro hace un salto de línea.
            if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
              evento.preventDefault();
              void enviar();
            }
          }}
          placeholder={`Escribe a ${lead.nombre}`}
          aria-describedby="respuesta-ayuda"
          aria-invalid={!!error}
          className="min-h-11 flex-1 resize-none rounded-[10px] border border-linea bg-white px-3.5 py-3 text-[14px] leading-5 outline-none placeholder:text-secundario focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10 disabled:cursor-not-allowed disabled:bg-lienzo"
        />
        <button
          type="submit"
          aria-label="Enviar por WhatsApp"
          disabled={ejemplo || !texto.trim() || enviando}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] bg-tinta text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:bg-tinta/25"
        >
          {enviando ? <LoaderCircle className="size-[18px] animate-spin" strokeWidth={1.75} /> : <SendHorizontal className="size-[18px]" strokeWidth={1.75} />}
        </button>
      </div>
      <div id="respuesta-ayuda" className="mt-2 flex items-start justify-between gap-3 px-1 text-[12px] leading-4">
        {ejemplo ? (
          <p className="text-secundario">Contacto de ejemplo: los mensajes no salen por WhatsApp</p>
        ) : error ? (
          <p role="alert" className="text-error-texto">
            {error}
          </p>
        ) : (
          <p className="text-secundario">
            {ventana && <span className="text-tinta/80">{ventana}. </span>}
            Sale por WhatsApp desde el número del negocio.
          </p>
        )}
        {conLlevarloYo && !ejemplo && (
          <button
            type="button"
            onClick={() => void llevarloYo(lead, refrescar)}
            className="shrink-0 cursor-pointer rounded-[4px] font-medium text-tinta underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          >
            Lo llevo yo
          </button>
        )}
      </div>
    </form>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60px] items-center justify-between gap-3 border-t border-linea bg-white px-5 py-3 text-[13px] leading-[18px] max-sm:sticky max-sm:bottom-0 max-sm:z-[1] max-sm:flex-wrap max-sm:px-4">
      {children}
    </div>
  );
}

function Abajo({ lead, ahora, refrescar }: { lead: Lead; ahora: number; refrescar: () => Promise<void> }) {
  const { cfg } = useNegocio();
  const activo = cfg.sistema.asistente.activo;

  if (esEjemplo(lead)) return <Caja lead={lead} ahora={ahora} refrescar={refrescar} conLlevarloYo={false} />;
  if (lead.silenciadoEn) return null;
  if (lead.estado === "spam") {
    return (
      <Nota>
        <p className="text-secundario">Es publicidad: tu asistente no le contesta.</p>
      </Nota>
    );
  }

  const escribible = lead.estado === "persona" || (!activo && CON_EL_ASISTENTE.includes(lead.estado));
  const ventana = ventana24h(lead, ahora);
  if (escribible && ventana.abierta) {
    return <Caja lead={lead} ahora={ahora} refrescar={refrescar} conLlevarloYo={lead.estado !== "persona"} />;
  }
  // Ventana cerrada: si le escribes tú o si el cliente escribió hace más de 24 h (tampoco el asistente
  // puede contestarle ya), solo queda un mensaje aprobado o llamarle.
  if (!ventana.abierta && (escribible || ventana.hasta !== null)) return <CajaRetomar lead={lead} refrescar={refrescar} />;

  return (
    <Nota>
      <p className="text-secundario">Le contesta tu asistente.</p>
      <button type="button" onClick={() => void llevarloYo(lead, refrescar)} className={BOTON_SECUNDARIO}>
        Lo llevo yo
      </button>
    </Nota>
  );
}

// ---- El cajón ----

function Contenido({ lead, escribiendo, cerrar, refrescar, idTitulo }: {
  lead: Lead;
  escribiendo: boolean;
  cerrar: () => void;
  refrescar: () => Promise<void>;
  idTitulo: string;
}) {
  const { cfg } = useNegocio();
  const ahora = useReloj(true);
  const estrecha = usePantallaEstrecha();
  const apagado = !cfg.sistema.asistente.activo && CON_EL_ASISTENTE.includes(lead.estado) && !lead.silenciadoEn;
  const ficha = <Ficha key={lead.id} lead={lead} ahora={ahora} refrescar={refrescar} cerrar={cerrar} />;

  return (
    <>
      <Cabecera lead={lead} idTitulo={idTitulo} cerrar={cerrar} refrescar={refrescar} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden">
        <section aria-label="Conversación" className="flex min-h-[60vh] flex-col bg-lienzo md:min-h-0 max-sm:h-full max-sm:shrink-0">
          {lead.silenciadoEn && <Silenciado lead={lead} />}
          {apagado && (
            <p role="status" className="flex items-center gap-2 border-b border-linea bg-white px-5 py-3 text-[13px] leading-[18px]">
              <PowerOff aria-hidden className="size-4 shrink-0 text-atencion-texto" strokeWidth={1.75} />
              Tu asistente está apagado: le contestas tú.
            </p>
          )}
          <Hilo lead={lead} escribiendo={escribiendo} ahora={ahora} contestarYo={() => void llevarloYo(lead, refrescar)} />
          <Abajo lead={lead} ahora={ahora} refrescar={refrescar} />
        </section>
        {estrecha ? (
          <details aria-label="Ficha" className="group shrink-0 border-t border-linea bg-white">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[14px] leading-5 font-medium outline-none focus-visible:bg-lienzo [&::-webkit-details-marker]:hidden">
              Ficha
              <ChevronDown aria-hidden className="size-4 text-secundario transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" strokeWidth={1.75} />
            </summary>
            {ficha}
          </details>
        ) : (
          <section aria-label="Ficha" className="border-t border-linea bg-white md:min-h-0 md:overflow-y-auto md:border-t-0 md:border-l">
            {ficha}
          </section>
        )}
      </div>
    </>
  );
}

/** La ficha y la conversación de un cliente. Se queda montada para poder animar también la salida. */
export function Conversacion(props: { lead?: Lead; negocio?: string; escribiendo?: boolean; cerrar: () => void; refrescar: () => Promise<void> }) {
  const { lead, cerrar, refrescar } = props;
  const [ultimo, setUltimo] = useState(lead);
  const abierto = !!lead;
  const cajon = useRef<HTMLElement>(null);
  const marcadoVisto = useRef<string | null>(null);
  const idTitulo = "titulo-cliente";

  useEffect(() => {
    if (lead) setUltimo(lead);
  }, [lead]);

  // Escape cierra la ficha. Lo que se abre encima (menús, diálogos, el formulario de editar, el
  // buscador) para su propio Escape antes de que llegue aquí.
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === "Escape" && !evento.defaultPrevented) cerrar();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [abierto, cerrar]);

  // Al abrir (o al cambiar de cliente), el foco entra en la ficha.
  const leadId = lead?.id;
  useEffect(() => {
    if (!leadId) return;
    const t = requestAnimationFrame(() => {
      // En el nombre (tabIndex -1, sin anillo): el lector de pantalla lo lee y el tabulador sigue desde ahí.
      if (cajon.current && !cajon.current.contains(document.activeElement)) document.getElementById(idTitulo)?.focus();
    });
    return () => cancelAnimationFrame(t);
  }, [leadId]);

  // «Ha vuelto a escribir» se apaga al abrir su ficha: una vez por apertura.
  useEffect(() => {
    if (!lead) {
      marcadoVisto.current = null;
      return;
    }
    if (marcadoVisto.current === lead.id || !volvioAEscribir(lead)) return;
    marcadoVisto.current = lead.id;
    void cerrarVisita(lead.id, { accion: "visto" });
  }, [lead]);

  // El tabulador da la vuelta dentro de la ficha, sin robar el foco a lo que se abra encima.
  const alTabular = useCallback((evento: KeyboardEvent<HTMLElement>) => {
    if (evento.key !== "Tab" || !cajon.current) return;
    const enfocables = [
      ...cajon.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((n) => n.getClientRects().length > 0 && !n.closest("[inert]"));
    if (enfocables.length === 0) return;
    const primero = enfocables[0];
    const ultimoNodo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;
    if (evento.shiftKey && (activo === primero || activo === cajon.current || activo?.id === idTitulo)) {
      evento.preventDefault();
      ultimoNodo.focus();
    } else if (!evento.shiftKey && activo === ultimoNodo) {
      evento.preventDefault();
      primero.focus();
    }
  }, []);

  const mostrado = lead ?? ultimo;

  return (
    <>
      <div
        aria-hidden
        onClick={cerrar}
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ease-out motion-reduce:transition-none ${abierto ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        ref={cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-hidden={!abierto}
        inert={!abierto}
        onKeyDown={alTabular}
        className={`fixed inset-y-0 right-0 z-50 flex w-[min(920px,100vw)] flex-col bg-white max-sm:left-0 max-sm:h-[100dvh] max-sm:w-full shadow-[0_8px_40px_rgba(0,0,0,0.16)] transition-[transform,opacity] duration-[250ms] ease-out motion-reduce:transition-none ${
          abierto ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-12 opacity-0"
        }`}
      >
        {mostrado && (
          <Contenido
            key={mostrado.id}
            lead={mostrado}
            escribiendo={abierto && !!props.escribiendo}
            cerrar={cerrar}
            refrescar={refrescar}
            idTitulo={idTitulo}
          />
        )}
      </aside>
    </>
  );
}
