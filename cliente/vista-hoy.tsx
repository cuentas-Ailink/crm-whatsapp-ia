"use client";

import { ExternalLink, MessageCircle, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { EstadoLlegada } from "@/lib/api-tipos";
import { explicar } from "@/lib/errores";
import { citasHoyYManana, duracion, pendientes, resumenMes, ultimaLlegada, type FilaTeToca } from "@/lib/inicio";
import { visitaSinCerrar } from "@/lib/hilo";
import type { Bd } from "@/lib/tipos";
import { formas } from "@/lib/vocabulario";
import { colorMotivo } from "./avisos";
import { abrirCierre } from "./cierre";
import { confirmar } from "./confirmaciones";
import { cambiarTarea } from "./datos";
import { Cronometro } from "./llegada";
import { abrirCliente, irA } from "./navegacion";
import { useNegocio } from "./negocio";
import { Avatar, sinCorte } from "./piezas";
import { usePuesta } from "./puesta-en-marcha";
import { useEstado } from "./sistema";

// «Hoy»: lo que te toca hoy, de un vistazo y en este orden. (0) los pasos que faltan si dejaste la
// puesta en marcha para luego, (1) la última llegada, en directo si está pasando, (2) quién te espera,
// (3) las citas de hoy y mañana, (4) lo pendiente y (5) una línea con el mes. Nada se anima al entrar.

const SEGUNDOS = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «2026-11-09» → «9 nov». */
function diaCorto(fecha: string): string {
  const [, mes, dia] = fecha.split("-").map(Number);
  return `${dia} ${MESES[mes - 1]}`;
}

function Ejemplo() {
  return <span className="shrink-0 rounded-[4px] bg-fondo px-1.5 text-[11px] leading-4 font-normal text-secundario">Ejemplo</span>;
}

/** Un bloque de la columna: su título y lo de dentro, en una hoja blanca sin sombra. */
function Bloque({ titulo, children, id }: { titulo: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h2 id={id} className="px-1 text-[15px] leading-5 font-medium">
        {titulo}
      </h2>
      <div className="rounded-[12px] border border-linea bg-white p-1.5">{children}</div>
    </section>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-3 py-3 text-[14px] leading-5 text-secundario">{children}</p>;
}

const FILA = "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta";

// ─── (1) La cabecera en directo ─────────────────────────────────────────────────────────────────────

function enDirecto(llegadas: { porLead: Record<string, EstadoLlegada>; provisionales: EstadoLlegada[] }): EstadoLlegada | null {
  let actual: EstadoLlegada | null = null;
  for (const e of [...Object.values(llegadas.porLead), ...llegadas.provisionales]) {
    if (!e.enDirecto || e.fin !== null) continue;
    if (actual === null || e.inicio > actual.inicio) actual = e;
  }
  return actual;
}

function Cabecera({ bd, ahora, llegadas }: { bd: Bd; ahora: Date; llegadas: { porLead: Record<string, EstadoLlegada>; provisionales: EstadoLlegada[] } }) {
  const { cfg } = useNegocio();
  const puesta = usePuesta();
  const viva = enDirecto(llegadas);

  if (viva?.fallo) {
    const paso = explicar(viva.fallo.codigo).paso;
    return (
      <div className="flex min-h-12 items-center gap-2 rounded-[12px] border border-linea bg-white px-4 py-3 text-[14px] leading-5 text-error-texto">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-error" />
        <span className="min-w-0 break-words">
          <span className="font-medium">{viva.nombre}</span> · No le ha llegado el WhatsApp: {viva.fallo.texto} ·{" "}
          <button
            type="button"
            onClick={() => (paso ? puesta.abrir(paso) : irA("configuracion", { bloque: "whatsapp" }))}
            className="cursor-pointer font-medium underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-lg:-my-3 max-lg:py-3"
          >
            Arreglar
          </button>
        </span>
      </div>
    );
  }

  if (viva) {
    const frase =
      viva.canal === "whatsapp"
        ? "te ha escrito por WhatsApp"
        : viva.canal === "manual"
          ? "lo añadiste tú"
          : cfg.base === "reformas"
            ? "pide presupuesto desde tu web"
            : `pide ${formas(cfg.vocabulario.cita).un} ${cfg.vocabulario.cita.singular} desde tu web`;
    return (
      <div className="flex min-h-12 items-center gap-2.5 rounded-[12px] border border-linea bg-white px-4 py-3 text-[14px] leading-5">
        <Zap aria-hidden className="size-4 shrink-0 text-marca" strokeWidth={2} />
        <span className="min-w-0 break-words">
          <span className="font-medium">{viva.nombre}</span> · {frase}
        </span>
        <span className="ml-auto shrink-0 font-medium tabular-nums">
          <Cronometro inicio={viva.inicio} fin={viva.fin} enDirecto={viva.enDirecto} />
        </span>
      </div>
    );
  }

  const ultima = ultimaLlegada(bd);
  if (!ultima) return null;
  const segundos = SEGUNDOS.format(ultima.ms / 1000);
  const texto =
    ultima.canal === "whatsapp"
      ? `Contestado a ${ultima.nombre} en ${segundos} s`
      : `WhatsApp enviado a ${ultima.nombre} en ${segundos} s`;
  const Icono = ultima.canal === "whatsapp" ? MessageCircle : Zap;
  return (
    <button
      type="button"
      onClick={() => abrirCliente(ultima.leadId)}
      className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-[12px] border border-linea bg-white px-4 py-3 text-left text-[14px] leading-5 transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
    >
      <Icono aria-hidden className="size-4 shrink-0 text-marca" strokeWidth={2} />
      <span className="min-w-0">
        <span className="font-medium">{sinCorte(texto)}</span>
        <span className="text-secundario"> · hace {sinCorte(duracion(ahora.getTime() - ultima.ts))}</span>
      </span>
      {ultima.ejemplo && <Ejemplo />}
    </button>
  );
}

// ─── (2) Te toca a ti ───────────────────────────────────────────────────────────────────────────────

/** «Sin contestar · 6 h» y «Ha vuelto a escribir · hace 24 h» traen el tiempo dentro: aquí va en su columna. */
const TIEMPO_EN_EL_TEXTO = new Set(["sinContestar", "volvio"]);

/** El motivo sin el tiempo: todas las filas lo enseñan igual, en la columna de la derecha. */
function motivoSinTiempo(fila: FilaTeToca): string {
  return TIEMPO_EN_EL_TEXTO.has(fila.motivo) ? fila.texto.split(" · ")[0] : fila.texto;
}

/**
 * Las columnas de cada fila: nombre (con «Ejemplo»), motivo, tiempo y acción. Iguales en todas. En una
 * pantalla estrecha, el nombre y el tiempo arriba, el motivo debajo y la acción bajo todo.
 */
const COLUMNAS_TE_TOCA =
  "grid min-w-0 flex-1 grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4.5rem] items-center gap-x-4 max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-x-3 max-lg:gap-y-0.5";
/** Un nombre de cliente en el móvil: hasta dos líneas, nunca cortado a media palabra. */
const NOMBRE_ESTRECHO = "max-lg:line-clamp-2 max-lg:whitespace-normal max-lg:break-words";
const ANCHO_ACCION = "w-[104px]";

function TeTocaATi({ bd, ahora, filas }: { bd: Bd; ahora: Date; filas: FilaTeToca[] }) {
  const { frases, zona } = useNegocio();
  const sinCerrarIds = new Set(
    filas.filter((f) => bd.leads[f.leadId] && visitaSinCerrar(bd.leads[f.leadId], ahora.getTime(), zona)).map((f) => f.leadId),
  );
  // Si alguna fila lleva «¿Cómo fue?», las demás guardan su sitio vacío: así el tiempo queda en columna.
  const conAccion = sinCerrarIds.size > 0;
  return (
    <Bloque titulo={frases.teTocaATi} id="hoy-te-toca">
      {filas.length === 0 ? (
        <Vacio>{frases.nadieTeEspera}</Vacio>
      ) : (
        <ul className="flex flex-col">
          {filas.map((fila) => {
            const lead = bd.leads[fila.leadId];
            const sinCerrar = !!lead && sinCerrarIds.has(fila.leadId);
            return (
              <li key={fila.leadId} className="flex items-center gap-1 max-lg:flex-wrap">
                <button type="button" onClick={() => abrirCliente(fila.leadId)} className={`${FILA} min-w-0 flex-1 max-lg:basis-full`}>
                  <Avatar nombre={fila.nombre} />
                  <span className={`${COLUMNAS_TE_TOCA} text-[14px] leading-5`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`min-w-0 truncate font-medium ${NOMBRE_ESTRECHO}`}>{fila.nombre}</span>
                      {fila.ejemplo && <Ejemplo />}
                    </span>
                    <span className={`min-w-0 truncate ${colorMotivo(fila.motivo)} max-lg:col-span-2 max-lg:row-start-2 max-lg:whitespace-normal max-lg:break-words`}>
                      {motivoSinTiempo(fila)}
                    </span>
                    <span className="text-right text-[13px] text-secundario tabular-nums whitespace-nowrap max-lg:col-start-2 max-lg:row-start-1">
                      hace {sinCorte(duracion(ahora.getTime() - fila.desde))}
                    </span>
                  </span>
                </button>
                {sinCerrar && lead ? (
                  <button
                    type="button"
                    onClick={() => abrirCierre(lead)}
                    className={`mr-1.5 h-8 ${ANCHO_ACCION} shrink-0 cursor-pointer rounded-[8px] border border-linea bg-white px-3 text-[13px] leading-5 font-medium whitespace-nowrap transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-lg:mb-1.5 max-lg:ml-[60px] max-lg:min-h-11 max-lg:w-auto max-lg:px-4`}
                  >
                    {frases.comoFueCorto}
                  </button>
                ) : (
                  conAccion && <span aria-hidden className={`mr-1.5 ${ANCHO_ACCION} shrink-0 max-lg:hidden`} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Bloque>
  );
}

// ─── (3) Citas de hoy y mañana ──────────────────────────────────────────────────────────────────────

function Citas({ bd, ahora }: { bd: Bd; ahora: Date }) {
  const { cfg, frases, zona } = useNegocio();
  const citas = citasHoyYManana(bd, ahora, zona);
  // Solo los días que tienen alguna; si ninguno tiene, una línea.
  const grupos = [
    { titulo: "Hoy", filas: citas.filter((c) => c.dia === "hoy") },
    { titulo: "Mañana", filas: citas.filter((c) => c.dia === "manana") },
  ].filter((g) => g.filas.length > 0);
  return (
    <Bloque titulo={frases.citasHoyYManana} id="hoy-citas">
      {grupos.length === 0 ? (
        <Vacio>Ni hoy ni mañana tienes {cfg.vocabulario.cita.plural}.</Vacio>
      ) : (
        grupos.map((g) => (
          <div key={g.titulo} className="flex flex-col [&+&]:mt-1 [&+&]:border-t [&+&]:border-linea [&+&]:pt-1">
            <h3 className="px-3 pt-2 pb-1 text-[12px] leading-4 font-medium text-secundario">{g.titulo}</h3>
            <ul className="flex flex-col">
              {g.filas.map((c) => (
                <li key={`${c.dia}-${c.hora}-${c.leadId}`}>
                  <button type="button" onClick={() => abrirCliente(c.leadId)} className={FILA}>
                    <span className="w-12 shrink-0 text-[14px] leading-5 font-medium tabular-nums">{c.hora}</span>
                    <span className={`min-w-0 truncate text-[14px] leading-5 ${NOMBRE_ESTRECHO}`}>{c.nombre}</span>
                    {c.ejemplo && <Ejemplo />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Bloque>
  );
}

// ─── (4) Pendientes ─────────────────────────────────────────────────────────────────────────────────

function Pendientes({ bd, ahora, refrescar }: { bd: Bd; ahora: Date; refrescar: () => Promise<void> }) {
  const { zona } = useNegocio();
  // Las que se acaban de marcar: se ven hechas mientras se guardan.
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set());
  const filas = pendientes(bd, ahora, zona);

  const hecho = async (leadId: string, tareaId: string) => {
    setMarcadas((s) => new Set(s).add(tareaId));
    const error = await cambiarTarea(leadId, tareaId, true);
    if (error) {
      setMarcadas((s) => {
        const otra = new Set(s);
        otra.delete(tareaId);
        return otra;
      });
      confirmar(error, { tono: "error" });
      return;
    }
    confirmar("Pendiente hecho");
    await refrescar();
  };

  return (
    <Bloque titulo="Pendientes" id="hoy-pendientes">
      {filas.length === 0 ? (
        <Vacio>Nada pendiente para hoy.</Vacio>
      ) : (
        <ul className="flex flex-col">
          {filas.map(({ leadId, nombre, tarea, atrasada }) => {
            const marcada = marcadas.has(tarea.id);
            return (
              <li key={`${leadId}-${tarea.id}`} className="flex min-h-11 items-center gap-3 rounded-[8px] px-3 py-1.5 max-lg:flex-wrap max-lg:gap-y-0">
                {/* La casilla es pequeña; en el móvil, su etiqueta le da el alto de un dedo. */}
                <label className="flex shrink-0 cursor-pointer items-center max-lg:-m-3.5 max-lg:p-3.5">
                  <input
                    type="checkbox"
                    checked={marcada}
                    disabled={marcada}
                    onChange={() => void hecho(leadId, tarea.id)}
                    aria-label={`Hecho: ${tarea.texto}`}
                    className="size-4 shrink-0 cursor-pointer accent-tinta disabled:cursor-default"
                  />
                </label>
                <span className={`min-w-0 flex-1 truncate text-[14px] leading-5 max-lg:whitespace-normal max-lg:break-words ${marcada ? "text-secundario line-through" : ""}`}>{tarea.texto}</span>
                <button
                  type="button"
                  onClick={() => abrirCliente(leadId)}
                  className="max-w-[40%] shrink-0 cursor-pointer truncate rounded-[4px] text-[14px] leading-5 text-secundario underline-offset-[3px] hover:text-tinta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta max-lg:order-last max-lg:min-h-11 max-lg:max-w-full max-lg:basis-full max-lg:pl-7 max-lg:text-left"
                >
                  {nombre}
                </button>
                <span className={`w-14 shrink-0 text-right text-[13px] leading-5 tabular-nums ${atrasada ? "text-error-texto" : "text-secundario"}`}>
                  {atrasada && tarea.vence ? diaCorto(tarea.vence) : "Hoy"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Bloque>
  );
}

// ─── (5) La línea del mes ───────────────────────────────────────────────────────────────────────────

function LineaMes({ bd, ahora }: { bd: Bd; ahora: Date }) {
  const { frases, zona, formato } = useNegocio();
  const r = resumenMes(bd, ahora, zona);
  const texto = frases.lineaMes({
    nuevos: r.nuevos,
    conCita: r.conCita,
    si: r.si,
    importeSi: formato.importe(r.importeSi),
    conversion: r.conversion,
    medianaSegundos: r.medianaPrimerWhatsAppMs === null ? null : SEGUNDOS.format(r.medianaPrimerWhatsAppMs / 1000),
  });
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
      <p className="text-[13px] leading-5 text-secundario">{texto}</p>
      {r.ejemplo && <span className="rounded-[4px] bg-fondo px-1.5 text-[11px] leading-4 text-secundario">Datos de ejemplo</span>}
    </div>
  );
}

// ─── El CRM vacío ───────────────────────────────────────────────────────────────────────────────────

function CrmVacio() {
  const numero = useEstado()?.numero ?? null;
  const conBoton = useNegocio().cfg.web.entrada === "whatsapp";
  return (
    <div className="flex flex-col items-center gap-3 rounded-[12px] border border-linea bg-white px-6 py-14 text-center max-lg:px-4 max-lg:py-10">
      <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-marca text-marca-texto">
        <MessageCircle className="size-5" strokeWidth={2} />
      </span>
      <h2 className="text-[18px] leading-6 font-medium">Tu asistente está listo</h2>
      {numero && (
        <p className="max-w-full text-[14px] leading-5 break-words text-secundario">
          Escríbele por WhatsApp:{" "}
          <a
            href={numero.enlace}
            target="_blank"
            rel="noopener"
            className="font-medium whitespace-nowrap text-tinta underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          >
            {numero.texto}
          </a>
        </p>
      )}
      <a
        href="/"
        target="_blank"
        rel="noopener"
        className="mt-2 inline-flex h-10 items-center gap-2 max-lg:min-h-11 rounded-[8px] bg-tinta px-4 text-[14px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
      >
        {conBoton ? "Abrir mi web" : "Abrir mi formulario"}
        <ExternalLink aria-hidden className="size-4" strokeWidth={1.75} />
        <span className="sr-only">(se abre en otra pestaña)</span>
      </a>
    </div>
  );
}

// ─── La vista ───────────────────────────────────────────────────────────────────────────────────────

function PasosPendientes() {
  const puesta = usePuesta();
  const n = puesta.pendientes.length;
  if (!puesta.aplazada || n === 0) return null;
  return (
    <p className="flex items-center gap-2 rounded-[12px] border border-atencion/30 bg-atencion/10 px-4 py-2.5 text-[14px] leading-5 text-atencion-texto">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-atencion" />
      <span className="min-w-0">
        {n === 1 ? "Falta 1 paso para recibir WhatsApp" : `Faltan ${n} pasos para recibir WhatsApp`} ·{" "}
        <button
          type="button"
          onClick={() => puesta.abrir()}
          className="cursor-pointer font-medium underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atencion-texto max-lg:-my-3 max-lg:py-3"
        >
          Seguir
        </button>
      </span>
    </p>
  );
}

export function VistaHoy(props: {
  bd: Bd;
  ahora: Date;
  filas: FilaTeToca[];
  llegadas: { porLead: Record<string, EstadoLlegada>; provisionales: EstadoLlegada[] };
  refrescar: () => Promise<void>;
}) {
  const { bd, ahora, filas, llegadas, refrescar } = props;
  const vacio = Object.keys(bd.leads).length === 0;
  return (
    <div className="flex w-full flex-col gap-7">
      <PasosPendientes />
      {vacio ? (
        <CrmVacio />
      ) : (
        <>
          <Cabecera bd={bd} ahora={ahora} llegadas={llegadas} />
          <TeTocaATi bd={bd} ahora={ahora} filas={filas} />
          <Citas bd={bd} ahora={ahora} />
          <Pendientes bd={bd} ahora={ahora} refrescar={refrescar} />
          <LineaMes bd={bd} ahora={ahora} />
        </>
      )}
    </div>
  );
}
