"use client";

import { Download, Ellipsis, LoaderCircle, Lock, Pencil, Plus, Trash2, X, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fechaEn, momentoDeHueco, sumarDias, textoDia } from "@/lib/agenda";
import { textoFuente, vinoDeLaWeb } from "@/lib/fuente";
import { visitaSinCerrar } from "@/lib/hilo";
import { LARGO_FICHA, MAXIMO_DATOS, revisarCambiosFicha } from "@/lib/negocio";
import type { CambiosFicha, Lead, Tarea } from "@/lib/tipos";
import { etiquetaCampo, etiquetarActividad, resumenDatos, valorCampo } from "@/lib/vocabulario";
import { abrirCierre } from "./cierre";
import { confirmar } from "./confirmaciones";
import { anadirNota, anadirTarea, borrarCliente, borrarTarea, cambiarTarea, cerrarVisita, editarFicha, urlDatosCliente } from "./datos";
import { useNegocio } from "./negocio";
import { sinCorte } from "./piezas";
import { BOTON_PEQUENO, Telefono } from "./telefono";

// La ficha del cliente, a la derecha de la conversación: primero lo que hace falta para decidir
// (qué quiere, qué viene ahora y cuánto vale), luego cómo contactarle, sus datos, tus notas y el
// historial. Se corrige a mano con «Editar»; «⋯» descarga o borra sus datos (RGPD).

const ENTRADA =
  "h-9 w-full min-w-0 rounded-[8px] border border-linea bg-white px-3 text-[13px] leading-[18px] outline-none transition-colors duration-150 ease-out placeholder:text-secundario/70 focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10";

const AREA =
  "w-full min-w-0 resize-none rounded-[8px] border border-linea bg-white px-3 py-2 text-[13px] leading-[18px] outline-none transition-colors duration-150 ease-out placeholder:text-secundario/70 focus-visible:border-tinta/40 focus-visible:ring-2 focus-visible:ring-tinta/10";

const BOTON_SECUNDARIO =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-linea bg-white px-3.5 text-[13px] transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:text-secundario disabled:hover:bg-white";

const BOTON_PRINCIPAL =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-tinta px-3.5 text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:cursor-default disabled:bg-tinta/30";

const BOTON_ICONO =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-secundario transition-colors duration-150 ease-out hover:bg-lienzo hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta";

function Seccion({ titulo, extra, children, id }: { titulo: ReactNode; extra?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="border-t border-linea py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id={id} className="flex items-center gap-1.5 text-[13px] leading-[18px] font-medium">
          {titulo}
        </h4>
        {extra}
      </div>
      {children}
    </section>
  );
}

// ---- Un dato que cambia con la ficha abierta se ilumina un momento ----

function sinMovimiento(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Las claves de los datos que han aparecido o cambiado desde la última vez (nunca al abrir). */
function useCambiados(valores: Record<string, string>): Set<string> {
  const vistos = useRef<Record<string, string> | null>(null);
  const [cambiados, setCambiados] = useState<Set<string>>(() => new Set());
  const firma = JSON.stringify(valores);
  useEffect(() => {
    const antes = vistos.current;
    vistos.current = valores;
    if (!antes || sinMovimiento()) return;
    const nuevos = Object.keys(valores).filter((k) => antes[k] !== valores[k]);
    if (nuevos.length === 0) return;
    setCambiados(new Set(nuevos));
    const t = setTimeout(() => setCambiados(new Set()), 1_600);
    return () => clearTimeout(t);
  }, [firma]);
  return cambiados;
}

function Propiedad({ etiqueta, children, destello = false }: { etiqueta: string; children: ReactNode; destello?: boolean }) {
  const [encendido, setEncendido] = useState(false);
  useEffect(() => {
    if (!destello) return;
    setEncendido(true);
    const t = setTimeout(() => setEncendido(false), 40);
    return () => clearTimeout(t);
  }, [destello]);
  return (
    <div
      className={`-mx-2 grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-3 rounded-[6px] px-2 py-1.5 text-[13px] leading-[18px] ${
        encendido ? "bg-marca/15" : "bg-transparent transition-colors duration-[1500ms] ease-out"
      }`}
    >
      <dt className="text-secundario first-letter:uppercase">{etiqueta}</dt>
      <dd className="min-w-0 break-words">{typeof children === "string" ? sinCorte(children) : children}</dd>
    </div>
  );
}

// ---- Resumen ----

function Resumen({ lead, ahora }: { lead: Lead; ahora: number }) {
  const { cfg, frases, formato, zona } = useNegocio();
  const quiere = resumenDatos(lead, cfg.campos);

  let siguiente: { texto: string; clase: string } | null = null;
  if (lead.estado === "spam") {
    siguiente = { texto: `No se le contesta${lead.motivoSpam ? ` · ${lead.motivoSpam}` : ""}`, clase: "text-secundario" };
  } else if (lead.cierre) {
    siguiente = null;
  } else if (lead.estado === "persona") {
    // Con «Te toca», el motivo va primero aunque haya pedido que no le escribamos (p. ej., que borres sus datos).
    siguiente = { texto: lead.motivoPersona || "Te ha pedido hablar contigo", clase: "text-atencion-texto" };
  } else if (lead.silenciadoEn) {
    siguiente = { texto: "Ha pedido que no le escribamos", clase: "text-secundario" };
  } else if (lead.visita) {
    const momento = momentoDeHueco(lead.visita.id, zona);
    siguiente =
      momento > ahora
        ? { texto: `${frases.cita} · ${formato.corta(momento)}`, clase: "text-ok-texto" }
        : { texto: `${frases.citaPasada} · ${formato.corta(momento)}`, clase: "text-secundario" };
  } else if (lead.estado === "conversacion") {
    siguiente = { texto: "Hablando con tu asistente", clase: "" };
  } else {
    siguiente = { texto: "Esperando su respuesta", clase: "" };
  }

  const fila = (etiqueta: string, valor: ReactNode, clase = "") => (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-3 py-1">
      <dt className="text-[12px] leading-5 text-secundario">{etiqueta}</dt>
      <dd className={`min-w-0 text-[15px] leading-5 break-words ${clase}`}>{typeof valor === "string" ? sinCorte(valor) : valor}</dd>
    </div>
  );

  return (
    <dl className="flex flex-col py-1">
      {fila("Quiere", quiere)}
      {siguiente && fila("Siguiente", siguiente.texto, siguiente.clase)}
      {lead.presupuesto !== undefined &&
        fila(
          "Importe",
          <span className="tabular-nums">
            <span className="font-medium">{sinCorte(formato.importe(lead.presupuesto))}</span>
            {(lead.cobrado ?? 0) > 0 && <span className="text-secundario"> · cobrado {sinCorte(formato.importe(lead.cobrado ?? 0))}</span>}
          </span>,
        )}
    </dl>
  );
}

/** «¿Cómo fue la visita?» cuando ya pasó y aún no se ha dicho; o cómo acabó, con «Reabrir». */
function Cierre({ lead, ahora, refrescar }: { lead: Lead; ahora: number; refrescar: () => Promise<void> }) {
  const { frases, formato, zona } = useNegocio();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lead.cierre) {
    const reabrir = async () => {
      setOcupado(true);
      setError(null);
      const fallo = await cerrarVisita(lead.id, { accion: "reabrir" });
      setOcupado(false);
      if (fallo) return setError(fallo);
      confirmar("Reabierto");
      void refrescar();
    };
    const cuando = lead.cierreEn ? formato.corta(lead.cierreEn) : "";
    return (
      <div className="mb-3 flex flex-col items-start gap-2.5 rounded-[10px] border border-linea px-3.5 py-3">
        {/* Cada parte entera en su línea si no cabe: nunca «Se lo ha / pensado». */}
        <p className={`text-[13px] leading-[18px] font-medium ${lead.cierre === "si" ? "text-ok-texto" : "text-secundario"}`}>
          {(lead.cierre === "si"
            ? [frases.haDichoQueSi, formato.importe(lead.presupuesto ?? 0)]
            : [frases.noSigue, lead.motivoCierre ?? "Otro"]
          )
            .concat(cuando ? [cuando] : [])
            .map((parte, i) => (
              <span key={i} className="whitespace-nowrap">
                {i > 0 ? ` · ${parte}` : parte}
              </span>
            ))}
        </p>
        <button type="button" onClick={() => void reabrir()} disabled={ocupado} className={`${BOTON_PEQUENO} disabled:cursor-wait`}>
          {frases.reabrir}
        </button>
        {error && (
          <p role="alert" className="text-[12px] leading-4 text-error-texto">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!visitaSinCerrar(lead, ahora, zona)) return null;
  return (
    <div className="mb-3 rounded-[10px] border border-atencion/40 bg-atencion/[0.06] px-3.5 py-3">
      <p className="text-[13px] leading-[18px] font-medium">{frases.comoFue}</p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => abrirCierre(lead, { accion: "si" })} className={`${BOTON_SECUNDARIO} flex-auto px-3 whitespace-nowrap`}>
          {frases.haDichoQueSi}
        </button>
        <button type="button" onClick={() => abrirCierre(lead, { accion: "no" })} className={`${BOTON_SECUNDARIO} flex-auto px-3 whitespace-nowrap`}>
          {frases.noSigue}
        </button>
      </div>
    </div>
  );
}

// ---- Edición ----

interface FilaDato {
  /** Para React: el nombre original, o uno inventado si el dato es nuevo. */
  clave: string;
  campo: string;
  valor: string;
  nuevo: boolean;
}

interface Borrador {
  nombre: string;
  email: string;
  zona: string;
  presupuesto: string;
  cobrado: string;
  etiquetas: string;
  datos: FilaDato[];
}

function borradorDe(lead: Lead): Borrador {
  return {
    nombre: lead.nombre,
    email: lead.email ?? "",
    zona: lead.zona ?? "",
    presupuesto: lead.presupuesto?.toString() ?? "",
    cobrado: lead.cobrado?.toString() ?? "",
    etiquetas: (lead.etiquetas ?? []).join(", "),
    datos: Object.entries(lead.datos).map(([campo, valor]) => ({ clave: campo, campo, valor, nuevo: false })),
  };
}

/** Lo que ha cambiado, en bruto: un campo vacío se borra. Lo revisa revisarCambiosFicha, como el servidor. */
function cambiosDe(lead: Lead, b: Borrador, conZona: boolean): Record<string, unknown> | string {
  const cambios: Record<string, unknown> = {};
  if (b.nombre.trim() !== lead.nombre) cambios.nombre = b.nombre;
  if ((b.email.trim() || null) !== (lead.email ?? null)) cambios.email = b.email.trim() || null;
  if (conZona && (b.zona.trim() || null) !== (lead.zona ?? null)) cambios.zona = b.zona.trim() || null;

  for (const campo of ["presupuesto", "cobrado"] as const) {
    const crudo = b[campo].trim();
    // Lo que no es un número entero va tal cual: revisarCambiosFicha da el mensaje de siempre.
    const valor = crudo === "" ? null : /^\d+$/.test(crudo) ? Number(crudo) : crudo;
    if (valor !== (lead[campo] ?? null)) cambios[campo] = valor;
  }

  const etiquetas = b.etiquetas
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (etiquetas.join("\n") !== (lead.etiquetas ?? []).join("\n")) cambios.etiquetas = etiquetas;

  const datos = new Map<string, string | null>();
  const siguen = new Set(b.datos.filter((d) => !d.nuevo).map((d) => d.campo));
  for (const campo of Object.keys(lead.datos)) if (!siguen.has(campo)) datos.set(campo, null);
  for (const d of b.datos) {
    const valor = d.valor.trim();
    if (!d.nuevo) {
      if (valor !== lead.datos[d.campo]) datos.set(d.campo, valor || null);
      continue;
    }
    const campo = d.campo.trim();
    if (!campo && !valor) continue;
    if (!campo) return "Ponle nombre al dato nuevo";
    if (valor) datos.set(campo, valor);
  }
  if (datos.size) cambios.datos = Object.fromEntries(datos);
  return cambios;
}

function Campo({ id, etiqueta, children }: { id: string; etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] leading-4 text-secundario first-letter:uppercase">
        {etiqueta}
      </label>
      {children}
    </div>
  );
}

function Quitar({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={etiqueta} title={etiqueta} className={`${BOTON_ICONO} size-9`}>
      <X className="size-4" strokeWidth={1.75} />
    </button>
  );
}

function Editar({ lead, salir, refrescar }: { lead: Lead; salir: () => void; refrescar: () => Promise<void> }) {
  const { cfg, frases, moneda } = useNegocio();
  const [borrador, setBorrador] = useState(() => borradorDe(lead));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nuevos = useRef(0);
  const id = useId();
  const etiquetaZona = cfg.vocabulario.zona;

  const cambiar = (parcial: Partial<Borrador>) => setBorrador((b) => ({ ...b, ...parcial }));
  const cambiarDato = (clave: string, parcial: Partial<FilaDato>) =>
    setBorrador((b) => ({ ...b, datos: b.datos.map((d) => (d.clave === clave ? { ...d, ...parcial } : d)) }));
  const quitarDato = (clave: string) => setBorrador((b) => ({ ...b, datos: b.datos.filter((d) => d.clave !== clave) }));
  const anadirDato = () =>
    setBorrador((b) => ({ ...b, datos: [...b.datos, { clave: `nuevo-${nuevos.current++}`, campo: "", valor: "", nuevo: true }] }));

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (guardando) return;
    const bruto = cambiosDe(lead, borrador, etiquetaZona !== null);
    if (typeof bruto === "string") return setError(bruto);
    // La misma revisión que hace el servidor, con las mismas opciones: el error sale antes de enviar.
    const revision = revisarCambiosFicha(lead, bruto, { vocabulario: cfg.vocabulario, moneda });
    if ("error" in revision) return setError(revision.error);
    const cambios: CambiosFicha = revision.cambios;
    if (Object.keys(cambios).length === 0) return salir();
    setGuardando(true);
    setError(null);
    const fallo = await editarFicha(lead.id, cambios);
    if (fallo) {
      setError(fallo);
      setGuardando(false);
      return;
    }
    await refrescar();
    confirmar("Ficha guardada");
    salir();
  };

  // Escape deja de editar sin cerrar la ficha: lo escucha la ventana, y aquí no llega.
  const alPulsar = (evento: KeyboardEvent) => {
    if (evento.key !== "Escape") return;
    evento.stopPropagation();
    salir();
  };

  return (
    <form onSubmit={guardar} onKeyDown={alPulsar} aria-busy={guardando} className="flex flex-col gap-3 pt-1 pb-4">
      <Campo id={`${id}-nombre`} etiqueta="Nombre">
        <input
          id={`${id}-nombre`}
          value={borrador.nombre}
          onChange={(e) => cambiar({ nombre: e.target.value })}
          required
          maxLength={LARGO_FICHA.nombre}
          autoComplete="off"
          autoFocus
          className={ENTRADA}
        />
      </Campo>
      <Campo id={`${id}-email`} etiqueta="Email">
        <input
          id={`${id}-email`}
          type="email"
          value={borrador.email}
          onChange={(e) => cambiar({ email: e.target.value })}
          maxLength={LARGO_FICHA.email}
          autoComplete="off"
          className={ENTRADA}
        />
      </Campo>
      {etiquetaZona !== null && (
        <Campo id={`${id}-zona`} etiqueta={etiquetaZona}>
          <input
            id={`${id}-zona`}
            value={borrador.zona}
            onChange={(e) => cambiar({ zona: e.target.value })}
            maxLength={LARGO_FICHA.zona}
            autoComplete="off"
            className={ENTRADA}
          />
        </Campo>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo id={`${id}-presupuesto`} etiqueta={frases.importeConSimbolo}>
          <input
            id={`${id}-presupuesto`}
            value={borrador.presupuesto}
            onChange={(e) => cambiar({ presupuesto: e.target.value })}
            inputMode="numeric"
            autoComplete="off"
            className={`${ENTRADA} tabular-nums`}
          />
        </Campo>
        <Campo id={`${id}-cobrado`} etiqueta={frases.cobradoConSimbolo}>
          <input
            id={`${id}-cobrado`}
            value={borrador.cobrado}
            onChange={(e) => cambiar({ cobrado: e.target.value })}
            inputMode="numeric"
            autoComplete="off"
            className={`${ENTRADA} tabular-nums`}
          />
        </Campo>
      </div>

      <Campo id={`${id}-etiquetas`} etiqueta="Etiquetas">
        {/* Dos líneas: así el ejemplo del marcador se lee entero en una columna estrecha. Intro guarda, como en un campo. */}
        <textarea
          id={`${id}-etiquetas`}
          rows={2}
          value={borrador.etiquetas}
          onChange={(e) => cambiar({ etiquetas: e.target.value.replace(/\n/g, " ") })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={frases.etiquetasPlaceholder}
          autoComplete="off"
          className={AREA}
        />
      </Campo>

      {borrador.datos.map((d, indice) =>
        d.nuevo ? (
          <fieldset key={d.clave} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[12px] leading-4 text-secundario">Dato nuevo</legend>
            <div className="flex gap-1.5">
              <input
                aria-label="Nombre del dato"
                placeholder={frases.datoPlaceholder}
                value={d.campo}
                onChange={(e) => cambiarDato(d.clave, { campo: e.target.value })}
                maxLength={LARGO_FICHA.campo}
                autoComplete="off"
                autoFocus={indice === borrador.datos.length - 1}
                className={ENTRADA}
              />
              <Quitar etiqueta="Quitar el dato nuevo" onClick={() => quitarDato(d.clave)} />
            </div>
            <div className="flex gap-1.5">
              <input
                aria-label={d.campo.trim() ? `Valor de ${d.campo.trim()}` : "Valor del dato nuevo"}
                placeholder="Valor"
                value={d.valor}
                onChange={(e) => cambiarDato(d.clave, { valor: e.target.value })}
                maxLength={LARGO_FICHA.valor}
                autoComplete="off"
                className={ENTRADA}
              />
              {/* El hueco del botón de quitar, para que los dos campos acaben a la misma altura. */}
              <span aria-hidden className="w-9 shrink-0" />
            </div>
          </fieldset>
        ) : (
          <Campo key={d.clave} id={`${id}-dato-${indice}`} etiqueta={etiquetaCampo(d.campo, cfg.campos)}>
            <div className="flex gap-1.5">
              <input
                id={`${id}-dato-${indice}`}
                value={d.valor}
                onChange={(e) => cambiarDato(d.clave, { valor: e.target.value })}
                maxLength={LARGO_FICHA.valor}
                autoComplete="off"
                className={ENTRADA}
              />
              <Quitar etiqueta={`Quitar ${etiquetaCampo(d.campo, cfg.campos)}`} onClick={() => quitarDato(d.clave)} />
            </div>
          </Campo>
        ),
      )}

      {borrador.datos.length < MAXIMO_DATOS && (
        <button
          type="button"
          onClick={anadirDato}
          className="-ml-2 flex h-8 cursor-pointer items-center gap-1.5 self-start rounded-[8px] px-2 text-[13px] text-secundario transition-colors duration-150 ease-out hover:bg-lienzo hover:text-tinta"
        >
          <Plus className="size-4" strokeWidth={1.75} />
          Añadir dato
        </button>
      )}

      {error && (
        <p role="alert" className="text-[12px] leading-4 text-error-texto">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-linea pt-3">
        <button type="button" onClick={salir} className={BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className={`${BOTON_PRINCIPAL} disabled:cursor-wait`}>
          {guardando && <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />}
          Guardar cambios
        </button>
      </div>
    </form>
  );
}

// ---- Datos ----

function Datos({ lead }: { lead: Lead }) {
  const { cfg } = useNegocio();
  const etiquetaZona = cfg.vocabulario.zona;
  const conZona = etiquetaZona !== null && !!lead.zona && !Object.hasOwn(lead.datos, "zona");
  const fuente = textoFuente(lead.fuente);

  const valores: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(lead.datos)) valores[`dato:${clave}`] = valor;
  if (conZona) valores.zona = lead.zona ?? "";
  if (lead.email) valores.email = lead.email;
  const cambiados = useCambiados(valores);

  const etiquetas = lead.etiquetas ?? [];
  if (Object.keys(valores).length === 0 && etiquetas.length === 0 && !fuente) return null;

  return (
    <dl className="flex flex-col border-t border-linea py-3">
      {fuente && <Propiedad etiqueta="Te encontró">{fuente}</Propiedad>}
      {Object.entries(lead.datos).map(([clave, valor]) => (
        <Propiedad key={clave} etiqueta={etiquetaCampo(clave, cfg.campos)} destello={cambiados.has(`dato:${clave}`)}>
          {valorCampo(clave, valor, cfg.campos)}
        </Propiedad>
      ))}
      {conZona && etiquetaZona !== null && (
        <Propiedad etiqueta={etiquetaZona} destello={cambiados.has("zona")}>
          {lead.zona}
        </Propiedad>
      )}
      {lead.email && (
        <Propiedad etiqueta="Email" destello={cambiados.has("email")}>
          {lead.email}
        </Propiedad>
      )}
      {etiquetas.length > 0 && (
        <Propiedad etiqueta="Etiquetas">
          <span className="flex flex-wrap gap-1">
            {etiquetas.map((e) => (
              <span key={e} className="rounded-[6px] bg-fondo px-1.5 py-0.5 text-[12px] leading-4">
                {e}
              </span>
            ))}
          </span>
        </Propiedad>
      )}
    </dl>
  );
}

/** «Primer WhatsApp: 4,2 s» (formulario y «+ Cliente») o «Contestado en 3,1 s» (WhatsApp). */
function PrimerWhatsApp({ lead }: { lead: Lead }) {
  const segundos = (ms: number) => (ms / 1000).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let texto: string | null = null;
  if ((lead.origen === "formulario" || lead.origen === "manual") && lead.msPrimerWhatsApp !== undefined) {
    texto = `Primer WhatsApp: ${segundos(lead.msPrimerWhatsApp)} s`;
  } else if (lead.origen === "whatsapp" && lead.msPrimeraRespuesta !== undefined) {
    texto = `Contestado en ${segundos(lead.msPrimeraRespuesta)} s`;
  }
  if (!texto) return null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[12px] leading-4 text-secundario tabular-nums">
      <Zap aria-hidden className="size-3.5 text-marca" strokeWidth={2} />
      {sinCorte(texto)}
    </p>
  );
}

// ---- Notas ----

type Cuando = "hoy" | "manana" | "otra" | null;

function Notas({ lead, ahora, refrescar }: { lead: Lead; ahora: number; refrescar: () => Promise<void> }) {
  const { frases, formato, zona } = useNegocio();
  const [texto, setTexto] = useState("");
  const [cuando, setCuando] = useState<Cuando>(null);
  const [fecha, setFecha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const hoy = fechaEn(new Date(ahora), zona).fecha;
  const manana = sumarDias(hoy, 1);
  const tareas = lead.tareas ?? [];
  const pendientes = tareas
    .filter((t) => !t.hecha)
    .sort((a, b) => (a.vence ?? "9999").localeCompare(b.vence ?? "9999") || a.ts - b.ts);
  const hechas = tareas.filter((t) => t.hecha).sort((a, b) => b.ts - a.ts);
  const notas = [...(lead.notas ?? [])].sort((a, b) => b.ts - a.ts);

  const operar = async (peticion: Promise<string | null>, aviso: string) => {
    const fallo = await peticion;
    if (fallo) return setError(fallo);
    setError(null);
    confirmar(aviso);
    await refrescar();
  };

  const vence = cuando === "hoy" ? hoy : cuando === "manana" ? manana : cuando === "otra" ? fecha : "";

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    const limpio = texto.trim();
    if (!limpio || enviando || (cuando === "otra" && !fecha)) return;
    if (vence && limpio.length > 200) return setError("Con fecha, la nota puede tener hasta 200 caracteres");
    setEnviando(true);
    const fallo = vence ? await anadirTarea(lead.id, limpio, vence) : await anadirNota(lead.id, limpio);
    setEnviando(false);
    if (fallo) return setError(fallo);
    setTexto("");
    setCuando(null);
    setFecha("");
    setError(null);
    confirmar("Nota guardada");
    await refrescar();
  };

  const textoFecha = (f: string) => (f === hoy ? "Hoy" : f === manana ? "Mañana" : textoDia(f).split(" ").slice(1).join(" "));

  const filaTarea = (t: Tarea) => (
    <li key={t.id} className="flex items-start gap-2.5 py-1.5">
      <input
        type="checkbox"
        checked={t.hecha}
        onChange={() => void operar(cambiarTarea(lead.id, t.id, !t.hecha), t.hecha ? "Pendiente reabierto" : "Pendiente hecho")}
        aria-label={`Hecho: ${t.texto}`}
        className="mt-px size-4 shrink-0 cursor-pointer accent-[#141414]"
      />
      <span className={`min-w-0 flex-1 text-[13px] leading-[18px] break-words ${t.hecha ? "text-secundario line-through" : ""}`}>{t.texto}</span>
      {t.vence && !t.hecha && (
        <span className={`shrink-0 text-[12px] leading-[18px] tabular-nums ${t.vence < hoy ? "font-medium text-error-texto" : "text-secundario"}`}>
          {textoFecha(t.vence)}
        </span>
      )}
      <button
        type="button"
        onClick={() => void operar(borrarTarea(lead.id, t.id), "Pendiente borrado")}
        aria-label={`Borrar «${t.texto}»`}
        title="Borrar"
        className={`${BOTON_ICONO} -my-1.5 size-7`}
      >
        <Trash2 className="size-3.5" strokeWidth={1.75} />
      </button>
    </li>
  );

  const chips: { id: Exclude<Cuando, null>; texto: string }[] = [
    { id: "hoy", texto: "Hoy" },
    { id: "manana", texto: "Mañana" },
    { id: "otra", texto: "Otra fecha" },
  ];

  return (
    <Seccion
      id={`${id}-titulo`}
      titulo={
        <>
          <Lock aria-hidden className="size-3.5 text-secundario" strokeWidth={2} />
          Notas
        </>
      }
      extra={pendientes.length > 0 ? <span className="text-[12px] leading-4 font-medium text-atencion-texto tabular-nums">{frases.pendientes(pendientes.length)}</span> : undefined}
    >
      <p className="mt-0.5 text-[12px] leading-4 text-secundario">{frases.notasAyuda}</p>

      {(pendientes.length > 0 || notas.length > 0 || hechas.length > 0) && (
        <ul className="mt-2 flex flex-col">
          {pendientes.map(filaTarea)}
          {notas.map((n) => (
            <li key={n.id} className="my-1 rounded-[8px] bg-lienzo px-3 py-2">
              <span className="block text-[13px] leading-[18px] break-words whitespace-pre-wrap">{n.texto}</span>
              <span className="mt-1 block text-[11px] leading-3 text-secundario tabular-nums">{formato.corta(n.ts)}</span>
            </li>
          ))}
          {hechas.map(filaTarea)}
        </ul>
      )}

      <form onSubmit={guardar} className="mt-3 flex flex-col gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={frases.notaPlaceholder}
          aria-label="Nueva nota"
          className={AREA}
        />
        <div role="group" aria-labelledby={`${id}-cuando`} className="flex flex-col gap-1.5">
          <span id={`${id}-cuando`} className="text-[12px] leading-4 text-secundario">
            ¿Para cuándo?
          </span>
          <div className="flex gap-1.5">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={cuando === c.id}
                onClick={() => setCuando((actual) => (actual === c.id ? null : c.id))}
                className={`h-7 cursor-pointer rounded-full border px-2.5 text-[12px] leading-4 whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta ${
                  cuando === c.id ? "border-tinta bg-tinta text-white" : "border-linea bg-white hover:bg-lienzo"
                }`}
              >
                {c.texto}
              </button>
            ))}
          </div>
        </div>
        {cuando === "otra" && (
          <input
            type="date"
            value={fecha}
            min={hoy}
            onChange={(e) => setFecha(e.target.value)}
            aria-label="Fecha"
            className={ENTRADA}
          />
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={enviando || !texto.trim() || (cuando === "otra" && !fecha)} className={BOTON_SECUNDARIO}>
            {enviando && <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />}
            Guardar
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-[12px] leading-4 text-error-texto">
          {error}
        </p>
      )}
    </Seccion>
  );
}

// ---- Historial ----

function Historial({ lead }: { lead: Lead }) {
  const { frases, formato } = useNegocio();
  const eventos = [...(lead.actividad ?? [])].sort((a, b) => b.ts - a.ts);
  const llegada =
    lead.origen === "formulario"
      ? "Llegó por tu web"
      : vinoDeLaWeb(lead)
        ? "Te escribió desde tu web"
        : lead.origen === "whatsapp"
          ? "Te escribió por WhatsApp"
          : lead.origen === "prueba"
            ? "Ejemplo"
            : null;
  const total = eventos.length + (llegada ? 1 : 0);

  const fila = (clave: string, ts: number, texto: string, tenue = false) => (
    <li key={clave} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 py-1.5 text-[13px] leading-[18px]">
      <span className="text-[12px] leading-[18px] text-secundario tabular-nums">{formato.corta(ts)}</span>
      <span className={`min-w-0 break-words ${tenue ? "text-secundario" : ""}`}>{texto}</span>
    </li>
  );

  return (
    <details className="group border-t border-linea py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[6px] text-[13px] leading-[18px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta [&::-webkit-details-marker]:hidden">
        Historial ({total})
        <span aria-hidden className="text-secundario transition-transform duration-150 group-open:rotate-90">
          ›
        </span>
      </summary>
      <ol className="mt-2 flex flex-col">
        {eventos.map((e) => fila(e.id, e.ts, etiquetarActividad(e.texto, frases)))}
        {llegada && fila("llegada", lead.creadoEn, llegada, true)}
      </ol>
    </details>
  );
}

// ---- «⋯»: descargar y borrar sus datos ----

function BorrarDatos({ lead, cancelar, borrado }: { lead: Lead; cancelar: () => void; borrado: () => void }) {
  const id = useId();
  const [seguro, setSeguro] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const primero = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primero.current?.focus();
  }, []);

  const borrar = async () => {
    if (!seguro) return setSeguro(true);
    setBorrando(true);
    setError(null);
    const fallo = await borrarCliente(lead.id);
    setBorrando(false);
    if (fallo) return setError(fallo);
    borrado();
  };

  const alPulsar = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      evento.preventDefault();
      cancelar();
      return;
    }
    if (evento.key !== "Tab" || !caja.current) return;
    const botones = [...caja.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
    const [a, z] = [botones[0], botones[botones.length - 1]];
    if (evento.shiftKey && document.activeElement === a) {
      evento.preventDefault();
      z?.focus();
    } else if (!evento.shiftKey && document.activeElement === z) {
      evento.preventDefault();
      a?.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
      <div aria-hidden className="absolute inset-0 bg-black/25" onClick={cancelar} />
      <div
        ref={caja}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-texto`}
        onKeyDown={alPulsar}
        className="relative max-h-[calc(100dvh-2rem)] w-[min(400px,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-[14px] bg-white p-6 shadow-[0_16px_48px_rgba(0,0,0,0.18)] max-sm:p-5"
      >
        <h2 id={`${id}-titulo`} className="text-[17px] leading-6 font-medium">
          Borrar sus datos
        </h2>
        <p id={`${id}-texto`} className="mt-2 text-[14px] leading-5 text-secundario">
          Se borrarán {lead.nombre}, su teléfono, la conversación, las notas, el historial y su cita. No se puede deshacer.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[12px] leading-4 text-error-texto">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={primero} type="button" onClick={cancelar} className={`${BOTON_SECUNDARIO} h-10 px-4 text-[14px] max-sm:h-11`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void borrar()}
            disabled={borrando}
            className="inline-flex h-10 min-w-[104px] cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-error px-4 max-sm:h-11 text-[14px] font-medium text-white transition-[filter] duration-150 ease-out hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-texto disabled:cursor-wait"
          >
            {borrando && <LoaderCircle aria-hidden className="size-4 animate-spin" strokeWidth={1.75} />}
            {seguro ? "Sí, borrar" : "Borrar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MasAcciones({ lead, cerrar }: { lead: Lead; cerrar: () => void }) {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !boton.current?.contains(t)) setAbierto(false);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto]);

  const cerrarMenu = (foco = true) => {
    setAbierto(false);
    if (foco) boton.current?.focus();
  };

  const alPulsar = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      evento.preventDefault();
      cerrarMenu();
    } else if (evento.key === "Tab") {
      cerrarMenu(false);
    } else if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (evento.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };

  const ITEM =
    "flex h-9 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] leading-[18px] outline-none transition-colors duration-100 ease-out hover:bg-lienzo focus-visible:bg-lienzo";

  return (
    <div className="relative">
      <button
        ref={boton}
        type="button"
        aria-label="Más acciones"
        title="Más acciones"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? `${id}-menu` : undefined}
        onClick={() => (abierto ? cerrarMenu() : setAbierto(true))}
        className={BOTON_ICONO}
      >
        <Ellipsis className="size-4" strokeWidth={1.75} />
      </button>
      {abierto && (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label="Más acciones"
          onKeyDown={alPulsar}
          className="absolute top-[calc(100%+4px)] right-0 z-10 w-[208px] rounded-[12px] border border-linea bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
        >
          <a role="menuitem" tabIndex={-1} href={urlDatosCliente(lead.id)} download onClick={() => cerrarMenu()} className={ITEM}>
            <Download aria-hidden className="size-4 text-secundario" strokeWidth={1.75} />
            Descargar sus datos
          </a>
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            onClick={() => {
              setAbierto(false);
              setBorrando(true);
            }}
            className={`${ITEM} text-error-texto`}
          >
            <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
            Borrar sus datos
          </button>
        </div>
      )}
      {borrando && (
        <BorrarDatos
          lead={lead}
          cancelar={() => {
            setBorrando(false);
            requestAnimationFrame(() => boton.current?.focus());
          }}
          borrado={() => {
            setBorrando(false);
            cerrar();
            confirmar("Datos borrados");
          }}
        />
      )}
    </div>
  );
}

// ---- La ficha ----

export function Ficha({ lead, ahora, refrescar, cerrar }: { lead: Lead; ahora: number; refrescar: () => Promise<void>; cerrar: () => void }) {
  const [editando, setEditando] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const id = useId();

  const salir = () => {
    setEditando(false);
    requestAnimationFrame(() => boton.current?.focus());
  };

  return (
    <div className="px-5">
      <div className={`flex h-12 items-center justify-between gap-3 ${editando ? "" : "max-sm:justify-end"}`}>
        <h3 id={`${id}-ficha`} className={`text-[13px] leading-[18px] font-medium ${editando ? "" : "max-sm:sr-only"}`}>
          {editando ? "Editar ficha" : "Ficha"}
        </h3>
        {!editando && (
          <div className="-mr-1.5 flex items-center gap-0.5">
            <button
              ref={boton}
              type="button"
              onClick={() => setEditando(true)}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-secundario transition-colors duration-150 ease-out hover:bg-lienzo hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
            >
              <Pencil aria-hidden className="size-3.5" strokeWidth={1.75} />
              Editar
            </button>
            <MasAcciones lead={lead} cerrar={cerrar} />
          </div>
        )}
      </div>

      {editando ? (
        <Editar lead={lead} salir={salir} refrescar={refrescar} />
      ) : (
        <>
          <Resumen lead={lead} ahora={ahora} />
          <div className="pt-2">
            <Cierre lead={lead} ahora={ahora} refrescar={refrescar} />
          </div>
          <div className="border-t border-linea py-4">
            <Telefono lead={lead} />
            <PrimerWhatsApp lead={lead} />
          </div>
          <Datos lead={lead} />
          <Notas lead={lead} ahora={ahora} refrescar={refrescar} />
          <Historial lead={lead} />
        </>
      )}
    </div>
  );
}
