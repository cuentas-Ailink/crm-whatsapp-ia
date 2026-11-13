"use client";

import { ArrowRight, RotateCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type JSX } from "react";
import type { EstadoConexiones, EstadoFila, EstadoPlantilla, FilaConexion, IdPlantillaApp } from "@/lib/api-tipos";
import { NO_DISPONIBLE_EN_PRUEBA } from "@/lib/modo-prueba-reglas";
import { arreglar, crearPlantillas, enviarWhatsAppPrueba, leerPlantillas } from "../api-sistema";
import { desvincular, ListaPermitidos, pasarAOficial, useModoPrueba } from "../modo-prueba";
import { useNegocio } from "../negocio";
import { usePuesta } from "../puesta-en-marcha";
import { useConexiones, useEstado } from "../sistema";
import { ESTILOS_TOQUE } from "./controles";

// Ajustes → Conexiones: cómo está cada conexión y su arreglo, el número de prueba de Meta, los mensajes
// aprobados por WhatsApp y «Enviarme un WhatsApp de prueba». Sin título propio: lo pone Ajustes.
// Con el botón de WhatsApp en la web (lo normal) ningún mensaje aprobado hace falta: el de bienvenida
// solo sale con el formulario, y los demás son extras.
// En el modo prueba, la fila de WhatsApp va en ámbar con «Desvincular» y «Pasar a WhatsApp oficial»,
// sale la lista de números permitidos y lo que necesita mensajes aprobados dice que no está disponible.

const MINUTO = 60_000;
const ESPERA_COMPROBAR_MS = 10_000;
const RELEER_PLANTILLAS_MS = 60_000;
const TRAS_CREAR_MS = 3_000;
const CLAVE_TELEFONO = "crm:telefonoPrueba";

/** ok = hecho, atención = te toca, error = algo falla, gris = nada que hacer (I20). */
export type Tono = "ok" | "atencion" | "error" | "gris";

export const PUNTO: Record<Tono, string> = {
  ok: "bg-ok",
  atencion: "bg-atencion",
  error: "bg-error",
  gris: "bg-nuevo",
};

export const TEXTO_TONO: Record<Tono, string> = {
  ok: "text-ok-texto",
  atencion: "text-atencion-texto",
  error: "text-error-texto",
  gris: "text-secundario",
};

/** «hace un momento», «hace 5 min», «hace 2 h», como lo cuenta el servidor. */
export function hace(ts: number, ahora: number): string {
  const minutos = Math.floor(Math.max(0, ahora - ts) / MINUTO);
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

const CATEGORIAS: Record<string, string> = { UTILITY: "Utilidad", MARKETING: "Marketing", AUTHENTICATION: "Autenticación" };

export const NOMBRES_PLANTILLA: Record<IdPlantillaApp, string> = {
  bienvenida: "Mensaje de bienvenida",
  aviso: "Aviso al comercial",
  retomar: "Retomar la conversación",
};

/** Para qué sirve cada mensaje que no es imprescindible: así nadie lo toma por un fallo. */
const PARA_QUE: Partial<Record<IdPlantillaApp, string>> = {
  aviso: "Opcional. Sin este mensaje, los avisos solo te llegan si has escrito al número del negocio en las últimas 24 h.",
  retomar: "Opcional. Para volver a escribir a un cliente que lleva más de 24 h sin contestar.",
};

/** Cómo se cuenta el estado de un mensaje aprobado, con su color. NO_EXISTE lleva su botón aparte. */
export function textoPlantilla(p: Pick<EstadoPlantilla, "estado" | "motivo">): { texto: string; tono: Tono } | null {
  switch (p.estado) {
    case "APROBADA":
      return { texto: "Aprobado", tono: "ok" };
    case "EN_REVISION":
      return { texto: "En revisión en Meta", tono: "atencion" };
    case "RECHAZADA":
      return { texto: `Rechazado: ${p.motivo ?? "Meta no ha dicho por qué"}`, tono: "error" };
    case "PAUSADA":
      return { texto: `Pausado por Meta: ${p.motivo ?? "Meta no ha dicho por qué"}`, tono: "error" };
    case "SIN_CLAVES":
      return { texto: "Conecta antes tu WhatsApp", tono: "gris" };
    case "ERROR":
      return { texto: `No se ha podido consultar a Meta${p.motivo ? `: ${p.motivo}` : ""}`, tono: "error" };
    default:
      return null;
  }
}

/** «Categoría: Utilidad», si Meta la ha dicho. */
export function textoCategoria(categoria?: string): string | null {
  return categoria ? `Categoría: ${CATEGORIAS[categoria] ?? categoria}` : null;
}

/** Un punto de color con sus palabras: el color nunca va solo. */
export function Estado(p: { texto: string; tono: Tono; className?: string }): JSX.Element {
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] leading-[18px] ${TEXTO_TONO[p.tono]} ${p.className ?? ""}`}>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${PUNTO[p.tono]}`} />
      {p.texto}
    </span>
  );
}

/** El estado de un mensaje aprobado y, si no existe, el botón para mandarlo a Meta. */
export function EstadoDeMensaje(p: { plantilla: EstadoPlantilla; crear: () => Promise<void> }): JSX.Element {
  const [creando, setCreando] = useState(false);
  const estado = textoPlantilla(p.plantilla);
  const categoria = textoCategoria(p.plantilla.categoria);
  if (p.plantilla.estado === "NO_EXISTE") {
    return (
      <button
        type="button"
        disabled={creando}
        onClick={async () => {
          setCreando(true);
          await p.crear();
          setCreando(false);
        }}
        className={ESTILOS_TOQUE.botonSecundario}
      >
        {creando ? "Enviando…" : "Enviar a Meta para aprobar"}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {estado && <Estado texto={estado.texto} tono={estado.tono} />}
      {categoria && <span className="text-[12px] leading-4 text-secundario">{categoria}</span>}
    </span>
  );
}

function leerTelefono(): string {
  try {
    return localStorage.getItem(CLAVE_TELEFONO) ?? "";
  } catch {
    return "";
  }
}

function recordarTelefono(telefono: string): void {
  try {
    localStorage.setItem(CLAVE_TELEFONO, telefono);
  } catch {
    // Sin almacenamiento, se vuelve a escribir la próxima vez.
  }
}

/** «Enviarme un WhatsApp de prueba»: el mismo en Conexiones y en el paso 4 de la puesta. */
export function PruebaWhatsApp(): JSX.Element {
  const conBoton = useNegocio().cfg.web.entrada === "whatsapp";
  const id = useId();
  const [telefono, setTelefono] = useState("");
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: true; nota?: string } | { ok: false; error: string } | null>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    setTelefono(leerTelefono());
    return () => {
      montado.current = false;
    };
  }, []);

  const enviar = async () => {
    const t = telefono.trim();
    if (!t || enviando) return;
    recordarTelefono(t);
    setEnviando(true);
    setResultado(null);
    const r = await enviarWhatsAppPrueba(t, nombre.trim() || undefined);
    if (!montado.current) return;
    setEnviando(false);
    setResultado(r.ok ? { ok: true, ...(r.nota ? { nota: r.nota } : {}) } : { ok: false, error: r.error });
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
      >
        <div className="flex w-[200px] flex-col gap-1.5 max-lg:w-full">
          <label htmlFor={`${id}-movil`} className={ESTILOS_TOQUE.etiqueta}>
            Tu móvil
          </label>
          <input
            id={`${id}-movil`}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={telefono}
            onChange={(evento) => setTelefono(evento.target.value)}
            placeholder="612 345 678"
            className={`${ESTILOS_TOQUE.campo} tabular-nums`}
          />
        </div>
        <div className="flex w-[200px] flex-col gap-1.5 max-lg:w-full">
          <label htmlFor={`${id}-nombre`} className={ESTILOS_TOQUE.etiqueta}>
            Tu nombre (opcional)
          </label>
          <input
            id={`${id}-nombre`}
            type="text"
            autoComplete="given-name"
            value={nombre}
            maxLength={60}
            onChange={(evento) => setNombre(evento.target.value)}
            className={ESTILOS_TOQUE.campo}
          />
        </div>
        <button type="submit" disabled={!telefono.trim() || enviando} className={ESTILOS_TOQUE.boton}>
          {enviando ? "Enviando…" : "Enviar"}
        </button>
      </form>
      {resultado?.ok === true && (
        <div aria-live="polite" className="flex flex-col gap-1">
          <Estado
            texto={conBoton ? "Enviado. Mira tu móvil." : "Enviado. Mira tu móvil: es el primer WhatsApp que recibe un cliente."}
            tono="ok"
            className="text-tinta"
          />
          {resultado.nota && <p className="pl-4 text-[13px] leading-[18px] text-secundario">{resultado.nota}</p>}
        </div>
      )}
      {resultado?.ok === false && (
        <p role="alert" className={ESTILOS_TOQUE.error}>
          {resultado.error}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        <p className={ESTILOS_TOQUE.ayuda}>No crea ningún cliente. Si contestas, tu asistente te responderá como a un cliente nuevo de WhatsApp.</p>
        <p className={ESTILOS_TOQUE.ayuda}>Meta puede cobrar cada mensaje aprobado que envías, según el país.</p>
      </div>
    </div>
  );
}

const TONO_FILA: Record<EstadoFila, Tono> = { ok: "ok", atencion: "atencion", error: "error" };

/** Una conexión: su punto, su nombre, su detalle y su arreglo. */
function Fila(p: { fila: FilaConexion; comprobar: (forzar?: boolean) => Promise<void>; prueba?: boolean }): JSX.Element {
  const { fila } = p;
  const prueba = !!p.prueba && fila.id === "whatsapp";
  const { abrir } = usePuesta();
  const [arreglando, setArreglando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accion = fila.accion;

  const hacer = async () => {
    if (!accion) return;
    if (accion.arreglar) {
      setArreglando(true);
      setError(null);
      const r = await arreglar(accion.arreglar);
      if ("error" in r) setError(r.error);
      await p.comprobar(true);
      setArreglando(false);
      return;
    }
    if (accion.paso) abrir(accion.paso);
  };

  return (
    <li className="flex items-start gap-3 py-3.5">
      <span aria-hidden className={`mt-[7px] size-2 shrink-0 rounded-full ${PUNTO[TONO_FILA[fila.estado]]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[14px] leading-5 font-medium text-tinta">
          {fila.nombre}
          <span className="sr-only">{fila.estado === "ok" ? ": funciona" : fila.estado === "atencion" ? ": te toca" : ": falla"}</span>
        </p>
        <p className={`text-[13px] leading-[18px] [overflow-wrap:anywhere] ${prueba ? "font-medium text-atencion-texto" : "text-secundario"}`}>{fila.detalle}</p>
        {prueba && <AccionesModoPrueba vinculado={fila.estado !== "error"} comprobar={p.comprobar} />}
        {error && (
          <p role="alert" className={`${ESTILOS_TOQUE.error} mt-1`}>
            {error}
          </p>
        )}
      </div>
      {accion && (accion.arreglar || accion.paso) && (
        <button type="button" onClick={() => void hacer()} disabled={arreglando} aria-label={`${accion.texto}: ${fila.nombre}`} className={`${ESTILOS_TOQUE.botonSecundario} h-8 px-3 text-[13px]`}>
          {arreglando ? "Arreglando…" : accion.texto}
        </button>
      )}
    </li>
  );
}

function FilaNumeroDePrueba(): JSX.Element {
  const { abrir } = usePuesta();
  const texto =
    "Número de prueba de Meta: solo escribe a los 5 móviles de su lista. Para clientes reales necesitas tu número, un método de pago y la app en modo Live";
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-atencion/30 bg-atencion/10 px-3.5 py-3">
      <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-atencion" />
      <p className="flex-1 text-[13px] leading-5 text-tinta">{texto}</p>
      <button
        type="button"
        onClick={() => abrir("whatsapp")}
        aria-label={`${texto} →`}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-atencion-texto transition-colors duration-200 ease-out hover:bg-atencion/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
      >
        <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}

function MensajesAprobados(): JSX.Element {
  const conBoton = useNegocio().cfg.web.entrada === "whatsapp";
  const [todas, setPlantillas] = useState<EstadoPlantilla[] | null>(null);
  // La bienvenida solo la usa el formulario: con el botón de WhatsApp el cliente escribe primero.
  const plantillas = todas && conBoton ? todas.filter((p) => p.id !== "bienvenida") : todas;
  const [error, setError] = useState<string | null>(null);
  const montado = useRef(true);

  const leer = useCallback(async () => {
    const leidas = await leerPlantillas();
    if (montado.current) setPlantillas(leidas.filter((p) => p.id !== undefined));
  }, []);

  useEffect(() => {
    montado.current = true;
    void leer();
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") void leer();
    }, RELEER_PLANTILLAS_MS);
    return () => {
      montado.current = false;
      clearInterval(intervalo);
    };
  }, [leer]);

  const crear = async (id: IdPlantillaApp) => {
    setError(null);
    const r = await crearPlantillas([id]);
    if (!montado.current) return;
    if ("error" in r) {
      setError(r.error);
      return;
    }
    const nuevas = r.filter((p) => p.id !== undefined);
    if (nuevas.length > 0) setPlantillas((actuales) => (actuales ?? []).map((p) => nuevas.find((n) => n.id === p.id) ?? p));
    setTimeout(() => void leer(), TRAS_CREAR_MS);
  };

  return (
    <section aria-labelledby="titulo-mensajes-aprobados" className="flex flex-col gap-1">
      <h3 id="titulo-mensajes-aprobados" className="text-[14px] leading-5 font-medium text-tinta">
        Mensajes aprobados por WhatsApp
      </h3>
      {conBoton && (
        <p className={ESTILOS_TOQUE.ayuda}>No hacen falta para empezar: tus clientes te escriben desde tu web y tu asistente les contesta.</p>
      )}
      {plantillas === null ? (
        <p className={`${ESTILOS_TOQUE.ayuda} py-3`}>Comprobando…</p>
      ) : plantillas.length === 0 ? (
        <p className="py-3">
          <Estado texto="Conecta antes tu WhatsApp" tono="gris" />
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea">
          {plantillas.map((p) => (
            <li key={p.id} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 max-lg:flex-col max-lg:items-start">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] leading-5 text-tinta">{NOMBRES_PLANTILLA[p.id as IdPlantillaApp] ?? p.nombre}</span>
                <span className="font-mono text-[12px] leading-4 text-secundario">{p.nombre}</span>
                {p.id !== undefined && PARA_QUE[p.id] && <span className="max-w-[440px] text-[12px] leading-4 text-secundario">{PARA_QUE[p.id]}</span>}
              </div>
              <EstadoDeMensaje plantilla={p} crear={() => crear(p.id as IdPlantillaApp)} />
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className={ESTILOS_TOQUE.error}>
          {error}
        </p>
      )}
    </section>
  );
}

/** «Desvincular» y «Pasar a WhatsApp oficial», debajo de la fila de WhatsApp en modo prueba. */
function AccionesModoPrueba(p: { vinculado: boolean; comprobar: (forzar?: boolean) => Promise<void> }): JSX.Element {
  const { abrir } = usePuesta();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {p.vinculado && (
        <button type="button" onClick={() => desvincular(() => void p.comprobar(true))} className={`${ESTILOS_TOQUE.botonSecundario} h-8 px-3 text-[13px]`}>
          Desvincular
        </button>
      )}
      <button type="button" onClick={() => pasarAOficial(() => abrir("whatsapp"))} className={`${ESTILOS_TOQUE.botonSecundario} h-8 px-3 text-[13px]`}>
        Pasar a WhatsApp oficial
      </button>
    </div>
  );
}

/** La lista de números permitidos del modo prueba, en Ajustes. */
function PermitidosModoPrueba(): JSX.Element | null {
  const { estado, poner } = useModoPrueba(false);
  const { prefijo } = useNegocio();
  if (!estado?.activo) return null;
  return (
    <section className="flex flex-col gap-3 border-t border-linea pt-5">
      <ListaPermitidos estado={estado} prefijo={prefijo} poner={poner} titulo={false} />
    </section>
  );
}

function NoDisponible(p: { titulo: string; id: string }): JSX.Element {
  return (
    <section aria-labelledby={p.id} className="flex flex-col gap-2 border-t border-linea pt-5">
      <h3 id={p.id} className="text-[14px] leading-5 font-medium text-tinta">
        {p.titulo}
      </h3>
      <Estado texto={NO_DISPONIBLE_EN_PRUEBA} tono="gris" />
    </section>
  );
}

export function Conexiones(): JSX.Element {
  const { estado, comprobar } = useConexiones();
  const prueba = useEstado()?.modoWhatsApp === "prueba";
  const [ahora, setAhora] = useState(() => Date.now());
  const [esperar, setEsperar] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (estado === null) void comprobar();
    // Solo al montar: luego lo mantiene al día ProveedorSistema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «Comprobado hace …» se mueve con el reloj.
  useEffect(() => {
    setAhora(Date.now());
    const intervalo = setInterval(() => setAhora(Date.now()), 15_000);
    return () => clearInterval(intervalo);
  }, [estado?.comprobadoEn]);

  useEffect(
    () => () => {
      if (temporizador.current !== null) clearTimeout(temporizador.current);
    },
    [],
  );

  const volverAComprobar = async () => {
    setEsperar(true);
    temporizador.current = setTimeout(() => setEsperar(false), ESPERA_COMPROBAR_MS);
    await comprobar(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-linea pb-2.5">
          <p className="text-[13px] leading-[18px] text-secundario" aria-live="polite">
            {estado ? `Comprobado ${hace(estado.comprobadoEn, ahora)}` : "Comprobando…"}
          </p>
          <button type="button" onClick={() => void volverAComprobar()} disabled={esperar || estado === null} className={`${ESTILOS_TOQUE.botonTexto} text-[13px] leading-[18px]`}>
            <RotateCw aria-hidden className="size-3.5" strokeWidth={2} />
            Volver a comprobar
          </button>
        </div>
        {estado === null ? <FilasCargando /> : <ListaFilas estado={estado} comprobar={comprobar} prueba={prueba} />}
      </div>

      {prueba ? (
        <>
          <PermitidosModoPrueba />
          <NoDisponible id="titulo-mensajes-aprobados" titulo="Mensajes aprobados por WhatsApp" />
          <NoDisponible id="titulo-whatsapp-prueba" titulo="Enviarme un WhatsApp de prueba" />
        </>
      ) : (
        <>
          {estado?.numeroDePrueba && <FilaNumeroDePrueba />}

          <MensajesAprobados />

          <section aria-labelledby="titulo-whatsapp-prueba" className="flex flex-col gap-3 border-t border-linea pt-5">
            <h3 id="titulo-whatsapp-prueba" className="text-[14px] leading-5 font-medium text-tinta">
              Enviarme un WhatsApp de prueba
            </h3>
            <PruebaWhatsApp />
          </section>
        </>
      )}
    </div>
  );
}

function ListaFilas(p: { estado: EstadoConexiones; comprobar: (forzar?: boolean) => Promise<void>; prueba: boolean }): JSX.Element {
  return (
    <ul className="flex flex-col divide-y divide-linea">
      {p.estado.filas.map((fila) => (
        <Fila key={fila.id} fila={fila} comprobar={p.comprobar} prueba={p.prueba} />
      ))}
    </ul>
  );
}

/** Mientras llega la primera comprobación: las cuatro filas en gris, con su altura, para que nada salte. */
function FilasCargando(): JSX.Element {
  return (
    <ul aria-hidden className="flex flex-col divide-y divide-linea">
      {[0, 1, 2, 3].map((n) => (
        <li key={n} className="flex items-start gap-3 py-3.5">
          <span className="mt-[7px] size-2 shrink-0 rounded-full bg-linea" />
          <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
            <span className="h-3.5 w-40 rounded-full bg-linea/70" />
            <span className="h-3 w-64 rounded-full bg-linea/50" />
          </div>
        </li>
      ))}
    </ul>
  );
}
