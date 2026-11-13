"use client";

import { Building2, Check, CheckCircle2, Copy, ExternalLink, Hammer, Sparkles, Stethoscope, X, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type KeyboardEvent as EventoTeclado,
  type ReactNode,
  type RefObject,
} from "react";
import type { EstadoApp, EstadoClave, EstadoPlantilla, PasoMeta, PasoPuesta, PeticionConectarMeta, Puesta } from "@/lib/api-tipos";
import { LIMITES, textoPlantilla, type SectorPreset } from "@/lib/configuracion";
import { PISTA_PUBLICAR, pasosMeta } from "@/lib/pasos-meta";
import type { Bd, Lead } from "@/lib/tipos";
import { conectarMeta, crearPlantillas, guardarClave, leerClaves, leerPlantillas } from "./api-sistema";
import { ATRIBUTOS_CLAVE, CampoClave, ClaveGuardada, ESTILOS, fraseDeError } from "./campo-clave";
import { ESTILOS_TOQUE } from "./configuracion/controles";
import { ChatDePrueba } from "./chat-de-prueba";
import { Estado, EstadoDeMensaje, PruebaWhatsApp } from "./configuracion/conexiones";
import { confirmar } from "./confirmaciones";
import { avisarCambioDeConfiguracion, useBd } from "./datos";
import { Cronometro, useLlegadas } from "./llegada";
import { claseTarjetaNegocio, ContenidoTarjetaNegocio } from "./tarjeta-negocio";
import { accionModoPrueba, pasarAOficial, TEXTO_AVISO_PRUEBA, useModoPrueba, VincularMovil } from "./modo-prueba";
import { irA } from "./navegacion";
import { useNegocio } from "./negocio";
import { useConexiones, useEstado } from "./sistema";

// La «Puesta en marcha»: a pantalla completa sobre el panel mientras la instalación no ha recibido
// nunca un WhatsApp de verdad. Lo que falta sale de la realidad (/api/estado → puesta), así que una
// instalación que ya funciona no la ve nunca. Bienvenida, cuatro pasos y una pantalla final.
// En local, la bienvenida ofrece también el «modo prueba» (WhatsApp por QR, no oficial): su aviso va
// antes del paso 1 y su paso 3 es el QR en vez de Meta.

// ─── Lo que se recuerda en esta pestaña ──────────────────────────────────────────────────────────

type Pantalla = "bienvenida" | "aviso-prueba" | PasoPuesta | "final";

interface Tienda {
  /** Abierta a mano (abrir) o porque se abrió sola y sigue abierta hasta que se cierre. */
  abierta: boolean;
  pantalla: Pantalla | null;
  /** Pasos terminados en esta pestaña: cuentan ya, sin esperar a /api/estado. */
  hechos: PasoPuesta[];
  /** «Lo dejo para luego» en este navegador. null = aún sin leer (se lee después de montar). */
  aplazada: boolean | null;
  /** Lo último que se sabe del mensaje de bienvenida en Meta (para la pantalla final). */
  bienvenida: EstadoPlantilla["estado"] | null;
}

const CLAVE_APLAZADA = "crm:puesta-luego";
const ORDEN: PasoPuesta[] = ["negocio", "claude", "whatsapp", "primer"];
const INICIAL: Tienda = Object.freeze({ abierta: false, pantalla: null, hechos: [], aplazada: null, bienvenida: null }) as Tienda;

let tienda: Tienda = INICIAL;
const oyentes = new Set<() => void>();

function cambiar(parcial: Partial<Tienda>): void {
  tienda = { ...tienda, ...parcial };
  for (const oyente of oyentes) oyente();
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => oyentes.delete(avisar);
}

function useTienda(): Tienda {
  return useSyncExternalStore(
    suscribir,
    () => tienda,
    () => INICIAL,
  );
}

function leerAplazada(): void {
  if (tienda.aplazada !== null) return;
  let aplazada = false;
  try {
    aplazada = localStorage.getItem(CLAVE_APLAZADA) === "1";
  } catch {
    // Sin almacenamiento: no se ha aplazado.
  }
  cambiar({ aplazada });
}

/** Si un paso está hecho según la realidad (las banderas de /api/estado). */
function hechoSegun(puesta: Puesta, paso: PasoPuesta): boolean {
  if (paso === "negocio") return puesta.negocio;
  if (paso === "claude") return puesta.claude;
  if (paso === "whatsapp") return puesta.whatsapp && puesta.mensajes;
  return puesta.primerMensaje;
}

function pendientesDe(estado: EstadoApp | null, hechos: PasoPuesta[]): PasoPuesta[] {
  if (!estado) return [];
  // Una instalación que ya ha recibido un mensaje de verdad está puesta en marcha: lo que se rompa
  // luego sale en la línea de estado y en Conexiones, nunca a pantalla completa.
  if (estado.puesta.primerMensaje) return [];
  return ORDEN.filter((p) => !hechoSegun(estado.puesta, p) && !hechos.includes(p));
}

function hecho(estado: EstadoApp, hechos: PasoPuesta[], paso: PasoPuesta): boolean {
  return hechos.includes(paso) || hechoSegun(estado.puesta, paso);
}

export function usePuesta(): { pendientes: PasoPuesta[]; aplazada: boolean; abrir(paso?: PasoPuesta): void; aplazar(): void } {
  const estado = useEstado();
  const t = useTienda();
  useEffect(leerAplazada, []);
  const pendientes = useMemo(() => pendientesDe(estado, t.hechos), [estado, t.hechos]);
  const primera = pendientes[0];
  const abrir = useCallback(
    (paso?: PasoPuesta) => {
      const destino = paso ?? primera;
      if (destino) cambiar({ abierta: true, pantalla: destino });
    },
    [primera],
  );
  const aplazar = useCallback(() => {
    try {
      localStorage.setItem(CLAVE_APLAZADA, "1");
    } catch {
      // Sin almacenamiento: se cierra igual.
    }
    cambiar({ aplazada: true, abierta: false, pantalla: null });
  }, []);
  const aplazada = t.aplazada === true;
  return useMemo(() => ({ pendientes, aplazada, abrir, aplazar }), [pendientes, aplazada, abrir, aplazar]);
}

/** Da un paso por hecho en esta pestaña. */
function marcarHecho(paso: PasoPuesta): void {
  if (!tienda.hechos.includes(paso)) cambiar({ hechos: [...tienda.hechos, paso] });
}

/** Al siguiente paso pendiente; si no queda ninguno, se cierra. */
function irAlSiguiente(estado: EstadoApp): void {
  const siguiente = pendientesDe(estado, tienda.hechos)[0];
  if (siguiente) cambiar({ pantalla: siguiente });
  else cambiar({ abierta: false, pantalla: null });
}

function cerrar(): void {
  cambiar({ abierta: false, pantalla: null });
}

// ─── Peticiones que no tienen envoltorio en W0/W6 ────────────────────────────────────────────────

const SIN_CONEXION = "Sin conexión con el servidor. Vuelve a intentarlo en un momento.";
type Datos = Record<string, unknown>;

async function pedir(url: string, cuerpo?: unknown): Promise<{ ok: true; datos: Datos } | { ok: false; error: string }> {
  let respuesta: Response;
  try {
    respuesta =
      cuerpo === undefined
        ? await fetch(url, { cache: "no-store" })
        : await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), cache: "no-store" });
  } catch {
    return { ok: false, error: SIN_CONEXION };
  }
  const leidos = (await respuesta.json().catch(() => null)) as unknown;
  const datos = typeof leidos === "object" && leidos !== null ? (leidos as Datos) : {};
  if (respuesta.status === 401 && datos.codigo === "sesion") {
    location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
  }
  if (!respuesta.ok || datos.ok === false) {
    return { ok: false, error: typeof datos.error === "string" ? datos.error : `El servidor respondió ${respuesta.status}` };
  }
  return { ok: true, datos };
}

// ─── Piezas comunes ──────────────────────────────────────────────────────────────────────────────

const ID_TITULO = "titulo-puesta";

const PASOS: Record<PasoPuesta, { numero: number; titulo: string }> = {
  negocio: { numero: 1, titulo: "¿Qué negocio es?" },
  claude: { numero: 2, titulo: "Conecta tu asistente" },
  whatsapp: { numero: 3, titulo: "Conecta tu WhatsApp" },
  primer: { numero: 4, titulo: "Tu primer WhatsApp" },
};
/** En el modo prueba, el paso 3 es el QR. */
const TITULO_QR = "Escanea el QR";

const enPrueba = (estado: EstadoApp | null): boolean => estado?.modoWhatsApp === "prueba";

function Marcas(p: { estado: EstadoApp; hechos: PasoPuesta[]; actual: PasoPuesta }): JSX.Element {
  return (
    <ol className="flex items-center" aria-label="Pasos">
      {ORDEN.map((paso, i) => {
        const ahora = paso === p.actual;
        const listo = !ahora && hecho(p.estado, p.hechos, paso);
        const palabra = ahora ? "Ahora" : listo ? "Hecho" : "Pendiente";
        return (
          <li key={paso} className="flex items-center">
            {i > 0 && <span aria-hidden className={`h-px w-8 ${listo || ahora ? "bg-tinta/25" : "bg-linea"}`} />}
            <span
              aria-hidden
              className={`flex size-6 items-center justify-center rounded-full text-[12px] leading-4 font-medium tabular-nums ${
                ahora ? "bg-tinta text-white" : listo ? "bg-ok/15 text-ok-texto" : "border border-linea bg-white text-secundario"
              }`}
            >
              {listo ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="sr-only">{`Paso ${i + 1}: ${palabra}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** El título de cada pantalla, con su línea de encima («Paso 2 de 4»): todos empiezan a la misma altura. */
function Titulo(p: { paso?: PasoPuesta; prueba?: boolean; children?: ReactNode }): JSX.Element {
  return (
    <h1 id={ID_TITULO} tabIndex={-1} className="outline-none">
      <span className="block text-[14px] leading-5 font-medium text-secundario">
        {p.paso ? `Paso ${PASOS[p.paso].numero} de 4` : "Puesta en marcha"}
        <span className="sr-only"> · </span>
      </span>
      <span className="mt-1 block text-[30px] leading-[38px] font-medium tracking-[-0.02em] text-tinta text-balance">
        {p.paso ? (p.prueba && p.paso === "whatsapp" ? TITULO_QR : PASOS[p.paso].titulo) : p.children}
      </span>
    </h1>
  );
}

function Cabecera(p: { estado: EstadoApp; hechos: PasoPuesta[]; paso: PasoPuesta; children?: ReactNode }): JSX.Element {
  return (
    <header className="flex flex-col gap-4">
      <Titulo paso={p.paso} prueba={enPrueba(p.estado)} />
      <Marcas estado={p.estado} hechos={p.hechos} actual={p.paso} />
      {p.children}
    </header>
  );
}

function LuegoBoton(p: { aplazar: () => void }): JSX.Element {
  return (
    <div className="mt-10 flex">
      <button type="button" onClick={p.aplazar} className={`${ESTILOS_TOQUE.botonTexto} font-normal text-secundario hover:text-tinta`}>
        Lo dejo para luego
      </button>
    </div>
  );
}

function Tarjeta(p: { titulo?: string; idTitulo?: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section aria-labelledby={p.idTitulo} className={`min-w-0 rounded-[14px] border border-linea bg-white px-6 py-5 max-sm:px-4 ${p.className ?? ""}`}>
      {p.titulo && (
        <h2 id={p.idTitulo} className="mb-4 text-[16px] leading-6 font-medium text-tinta">
          {p.titulo}
        </h2>
      )}
      {p.children}
    </section>
  );
}

// ─── El diálogo ──────────────────────────────────────────────────────────────────────────────────

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PuestaEnMarcha(): JSX.Element | null {
  const estado = useEstado();
  const t = useTienda();
  const { pendientes, aplazar } = usePuesta();
  const dialogo = useRef<HTMLDivElement>(null);
  const anterior = useRef<HTMLElement | null>(null);

  // Se abre sola: con el estado leído, algo pendiente y sin «Lo dejo para luego» en este navegador.
  const auto = estado !== null && t.aplazada === false && pendientes.length > 0;
  const visible = estado !== null && (t.abierta || auto);
  const pantalla: Pantalla | null = !visible
    ? null
    : (t.pantalla ?? (pendientes.length === ORDEN.length ? "bienvenida" : (pendientes[0] ?? "final")));

  // Una vez abierta sola, se queda abierta hasta que se cierra, aunque lleguen las banderas.
  useEffect(() => {
    if (auto && !t.abierta) cambiar({ abierta: true, pantalla: pantalla });
  }, [auto, t.abierta, pantalla]);

  // Al abrir: el fondo no se mueve y el foco vuelve luego adonde estaba.
  useEffect(() => {
    if (!visible) return;
    anterior.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const desbordamiento = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = desbordamiento;
      // Si se abrió sola (al cargar no había foco) o lo que la abrió ya no está, el foco va al título de
      // la vista del panel: nunca se queda en el body.
      const destino = anterior.current;
      if (destino?.isConnected && destino !== document.body) destino.focus();
      else requestAnimationFrame(() => document.querySelector<HTMLElement>("main h1")?.focus());
    };
  }, [visible]);

  // El foco, en el título de cada pantalla.
  useEffect(() => {
    if (!pantalla) return;
    if (dialogo.current) dialogo.current.scrollTop = 0;
    document.getElementById(ID_TITULO)?.focus({ preventScroll: true });
  }, [pantalla]);

  if (!visible || !estado || !pantalla) return null;

  const salir = () => (auto ? aplazar() : cerrar());

  const alPulsar = (evento: EventoTeclado<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.preventDefault();
      salir();
      return;
    }
    if (evento.key !== "Tab" || !dialogo.current) return;
    const enfocables = Array.from(dialogo.current.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((e) => e.offsetParent !== null || e === document.activeElement);
    const primero = enfocables[0];
    const ultimo = enfocables.at(-1);
    if (!primero || !ultimo) return;
    const activo = document.activeElement;
    if (evento.shiftKey && (activo === primero || activo === dialogo.current || activo?.id === ID_TITULO)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  };

  const ancho = pantalla === "whatsapp" && !enPrueba(estado) ? "max-w-[720px] lg:max-w-[1080px]" : "max-w-[720px]";

  return (
    <div
      ref={dialogo}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ID_TITULO}
      onKeyDown={alPulsar}
      className="fixed inset-0 z-[58] overflow-y-auto overscroll-contain bg-lienzo"
    >
      {!auto && (
        <button
          type="button"
          onClick={cerrar}
          aria-label="Cerrar"
          className="fixed top-5 right-5 z-10 flex size-10 cursor-pointer max-lg:top-3 max-lg:right-3 max-lg:size-11 items-center justify-center rounded-full text-secundario transition-colors duration-200 ease-out hover:bg-white hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        >
          <X aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
      )}
      {/* Todas las pantallas empiezan a la misma altura: de la bienvenida al paso 1 nada salta ni se funde. */}
      <div key={pantalla} className={`mx-auto flex min-h-full w-full flex-col px-6 py-14 max-sm:px-4 max-sm:py-12 ${ancho}`}>
        {pantalla === "bienvenida" && (
          <Bienvenida
            empezar={() => cambiar({ pantalla: pendientes[0] ?? "negocio" })}
            probar={estado.modo === "local" && !enPrueba(estado) ? () => cambiar({ pantalla: "aviso-prueba" }) : null}
            prueba={enPrueba(estado)}
            aplazar={aplazar}
          />
        )}
        {pantalla === "aviso-prueba" && (
          <AvisoPrueba
            seguir={() => cambiar({ pantalla: pendientes[0] ?? "negocio" })}
            volver={() => cambiar({ pantalla: "bienvenida" })}
            aplazar={aplazar}
          />
        )}
        {pantalla === "negocio" && <PasoNegocio estado={estado} hechos={t.hechos} aplazar={aplazar} />}
        {pantalla === "claude" && <PasoClaude estado={estado} hechos={t.hechos} aplazar={aplazar} />}
        {pantalla === "whatsapp" &&
          (enPrueba(estado) ? <PasoQr estado={estado} hechos={t.hechos} aplazar={aplazar} /> : <PasoWhatsApp estado={estado} hechos={t.hechos} aplazar={aplazar} />)}
        {pantalla === "primer" && <PasoPrimer estado={estado} hechos={t.hechos} aplazar={aplazar} />}
        {pantalla === "final" && (
          <Final bienvenida={t.bienvenida} conFormulario={estado?.configuracion.web?.entrada === "formulario"} prueba={enPrueba(estado)} />
        )}
      </div>
    </div>
  );
}

// ─── Bienvenida ──────────────────────────────────────────────────────────────────────────────────

function Bienvenida(p: { empezar: () => void; probar: (() => void) | null; prueba: boolean; aplazar: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-start">
      <Titulo>Vamos a dejar tu CRM listo</Titulo>
      <p className="mt-4 max-w-[480px] text-[16px] leading-6 text-secundario text-pretty">
        {p.prueba
          ? "4 pasos, en modo prueba: tu WhatsApp se conecta con un QR, no por la vía oficial."
          : "4 pasos. Lo que más tarda es Meta: si te atascas, lo dejas y sigues luego."}
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={p.empezar} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
          Empezar
        </button>
        {!p.prueba && <span className="text-[13px] leading-[18px] text-secundario">Con WhatsApp oficial, lo recomendado</span>}
      </div>
      {p.probar && (
        <div className="mt-8 flex max-w-[480px] flex-col items-start gap-2 border-t border-linea pt-6">
          <button type="button" onClick={p.probar} className={`${ESTILOS_TOQUE.botonSecundario} h-10 px-4 text-[14px]`}>
            Modo prueba
          </button>
          <p className={ESTILOS.ayuda}>Sin Meta: conectas un móvil de pruebas escaneando un QR. No es la vía oficial.</p>
        </div>
      )}
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

// ─── Aviso del modo prueba ───────────────────────────────────────────────────────────────────────

function AvisoPrueba(p: { seguir: () => void; volver: () => void; aplazar: () => void }): JSX.Element {
  const id = useId();
  const [acepto, setAcepto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seguir = async () => {
    if (!acepto || enviando) return;
    setEnviando(true);
    setError(null);
    const r = await accionModoPrueba("activar", { acepto: true });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    p.seguir();
  };

  return (
    <div className="flex flex-col items-start">
      <Titulo>Modo prueba</Titulo>
      <div className="mt-6 flex max-w-[560px] items-start gap-3 rounded-[12px] border border-atencion/30 bg-atencion/10 px-4 py-3.5">
        <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-atencion" />
        <p className="text-[15px] leading-6 text-tinta text-pretty">{TEXTO_AVISO_PRUEBA}</p>
      </div>
      <form
        className="mt-6 flex flex-col items-start gap-5"
        onSubmit={(evento) => {
          evento.preventDefault();
          void seguir();
        }}
      >
        <label htmlFor={`${id}-acepto`} className="flex w-fit cursor-pointer items-center gap-2.5 text-[15px] leading-5 text-tinta max-lg:min-h-11">
          <input
            id={`${id}-acepto`}
            type="checkbox"
            checked={acepto}
            onChange={(evento) => setAcepto(evento.target.checked)}
            className="size-4 cursor-pointer accent-[#141414]"
          />
          Entiendo que es solo para probar
        </label>
        {error && (
          <p role="alert" className={ESTILOS.error}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={!acepto || enviando} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
            {enviando ? "Un momento…" : "Seguir"}
          </button>
          <button type="button" onClick={p.volver} className={`${ESTILOS_TOQUE.botonTexto} font-normal text-secundario hover:text-tinta`}>
            Volver
          </button>
        </div>
      </form>
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

// ─── Paso 1 · ¿Qué negocio es? ───────────────────────────────────────────────────────────────────

const TIPOS: { id: SectorPreset; nombre: string; Icono: LucideIcon }[] = [
  { id: "reformas", nombre: "Reformas", Icono: Hammer },
  { id: "inmobiliaria", nombre: "Inmobiliaria", Icono: Building2 },
  { id: "clinica", nombre: "Clínica", Icono: Stethoscope },
  { id: "generico", nombre: "Otro", Icono: Sparkles },
];

const TIPOS_LOGO = new Set(["image/png", "image/jpeg", "image/webp"]);
const NO_ES_IMAGEN = "Súbelo en PNG, JPG o WebP";
const PESA_DEMASIADO = "El logo pesa demasiado: prueba con uno más pequeño";

/** El logo, como en Ajustes: a lo sumo 512 px, en WebP (o PNG si el navegador no sabe) y hasta 300 KB. */
async function procesarLogo(archivo: File): Promise<{ dataUrl: string } | { error: string }> {
  if (!TIPOS_LOGO.has(archivo.type)) return { error: NO_ES_IMAGEN };
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    return { error: NO_ES_IMAGEN };
  }
  const dibujar = (lado: number): string | null => {
    const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(imagen.width * escala));
    lienzo.height = Math.max(1, Math.round(imagen.height * escala));
    const contexto = lienzo.getContext("2d");
    if (!contexto) return null;
    contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    const webp = lienzo.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : lienzo.toDataURL("image/png");
  };
  const bytes = (url: string) => (url.length * 3) / 4;
  try {
    let url = dibujar(512);
    if (url && bytes(url) > LIMITES.logoBytes) url = dibujar(384);
    if (!url) return { error: NO_ES_IMAGEN };
    if (bytes(url) > LIMITES.logoBytes) return { error: PESA_DEMASIADO };
    return { dataUrl: url };
  } finally {
    imagen.close();
  }
}

/** Solo imágenes que ha hecho este navegador (I10). */
function esLogoSeguro(url: string): boolean {
  return /^data:image\/(webp|png);base64,[A-Za-z0-9+/]+=*$/.test(url);
}

function PasoNegocio(p: { estado: EstadoApp; hechos: PasoPuesta[]; aplazar: () => void }): JSX.Element {
  const { estado } = p;
  const id = useId();
  const config = estado.configuracion;
  const [tipo, setTipo] = useState<SectorPreset>(config.sector === "personalizado" ? "generico" : config.sector);
  const [nombre, setNombre] = useState(config.guardada ? config.negocio.nombre : "");
  const [descripciones, setDescripciones] = useState<Partial<Record<SectorPreset, string>> | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [ejemplos, setEjemplos] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<{ texto: string; campo?: "nombre" | "logo" } | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const campoNombre = useRef<HTMLInputElement>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    void pedir("/api/configuracion").then((r) => {
      if (!montado.current || !r.ok || !Array.isArray(r.datos.sectores)) return;
      const lista = r.datos.sectores as { id: SectorPreset; descripcion?: unknown }[];
      setDescripciones(Object.fromEntries(lista.filter((s) => typeof s.descripcion === "string").map((s) => [s.id, s.descripcion as string])));
    });
    return () => {
      montado.current = false;
    };
  }, []);

  const elegirLogo = async (f: File | undefined) => {
    if (!f) return;
    const r = await procesarLogo(f);
    if (!montado.current) return;
    if ("error" in r) {
      setError({ texto: r.error, campo: "logo" });
      return;
    }
    setLogo(r.dataUrl);
    if (error?.campo === "logo") setError(null);
  };

  const seguir = async () => {
    if (guardando) return;
    const limpio = nombre.trim();
    if (!limpio) {
      setError({ texto: "Escribe el nombre de tu negocio", campo: "nombre" });
      campoNombre.current?.focus();
      return;
    }
    if (limpio.length > LIMITES.nombreNegocio) {
      setError({ texto: "El nombre, hasta 60 caracteres", campo: "nombre" });
      campoNombre.current?.focus();
      return;
    }
    setGuardando(true);
    setError(null);
    const modoEjemplos = ejemplos ? "sustituir" : "borrar";
    const cuerpo =
      tipo === "generico"
        ? { destino: { nuevo: { nombre: limpio, base: "generico", sustituir: true } }, ejemplos: modoEjemplos }
        : { destino: { sector: tipo }, ejemplos: modoEjemplos, nombre: limpio };
    const r = await pedir("/api/configuracion/sector", cuerpo);
    if (!montado.current) return;
    if (!r.ok) {
      setGuardando(false);
      setError({ texto: r.error });
      return;
    }
    if (logo) {
      const conLogo = await pedir("/api/logo", { dataUrl: logo });
      if (!montado.current) return;
      if (!conLogo.ok) {
        setGuardando(false);
        setError({ texto: conLogo.error, campo: "logo" });
        avisarCambioDeConfiguracion();
        return;
      }
    }
    avisarCambioDeConfiguracion();
    const avisos = Array.isArray(r.datos.avisos) ? r.datos.avisos.filter((a): a is string => typeof a === "string") : [];
    for (const aviso of avisos) confirmar(aviso);
    marcarHecho("negocio");
    irAlSiguiente(estado);
  };

  return (
    <div className="flex flex-col">
      <Cabecera estado={estado} hechos={p.hechos} paso="negocio" />
      <form
        className="mt-10 flex flex-col gap-8"
        noValidate
        onSubmit={(evento) => {
          evento.preventDefault();
          void seguir();
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Tipo de negocio</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TIPOS.map(({ id: tipoId, nombre: etiqueta, Icono }) => (
              <label key={tipoId} className={`${claseTarjetaNegocio(tipo === tipoId)} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-tinta`}>
                <input
                  type="radio"
                  name={`${id}-tipo`}
                  value={tipoId}
                  checked={tipo === tipoId}
                  onChange={() => setTipo(tipoId)}
                  className="sr-only"
                />
                <ContenidoTarjetaNegocio Icono={Icono} titulo={etiqueta} detalle={descripciones?.[tipoId]} elegida={tipo === tipoId} />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-nombre`} className={ESTILOS.etiqueta}>
            ¿Cómo se llama?
          </label>
          <input
            ref={campoNombre}
            id={`${id}-nombre`}
            type="text"
            required
            value={nombre}
            onChange={(evento) => {
              setNombre(evento.target.value);
              if (error?.campo === "nombre") setError(null);
            }}
            placeholder="El nombre que verán tus clientes"
            autoComplete="organization"
            aria-invalid={error?.campo === "nombre"}
            aria-describedby={error?.campo === "nombre" ? `${id}-error` : undefined}
            className={`${ESTILOS_TOQUE.campo} max-w-[420px] h-11 text-[15px]`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p id={`${id}-logo`} className={ESTILOS.etiqueta}>
            Logo (opcional)
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {logo && esLogoSeguro(logo) ? (
              <div className="flex gap-2" aria-label="Así se ve tu logo" role="group">
                <span className="flex size-16 items-center justify-center rounded-[10px] bg-[#151515] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo} alt="Tu logo sobre fondo oscuro" className="max-h-full max-w-full object-contain" />
                </span>
                <span className="flex size-16 items-center justify-center rounded-[10px] border border-linea bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo} alt="Tu logo sobre fondo claro" className="max-h-full max-w-full object-contain" />
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <input
                ref={archivo}
                id={`${id}-archivo`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-labelledby={`${id}-logo`}
                onChange={(evento) => {
                  void elegirLogo(evento.target.files?.[0]);
                  evento.target.value = "";
                }}
                className="peer sr-only"
              />
              <label
                htmlFor={`${id}-archivo`}
                className={`${ESTILOS_TOQUE.botonSecundario} peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-tinta`}
              >
                {logo ? "Cambiar imagen" : "Elegir imagen"}
              </label>
              {logo && (
                <button type="button" onClick={() => setLogo(null)} className={ESTILOS_TOQUE.botonTexto}>
                  Quitar
                </button>
              )}
              {!logo && <span className={ESTILOS.ayuda}>PNG, JPG o WebP</span>}
            </div>
          </div>
        </div>

        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-[14px] leading-5 text-tinta">
          <input type="checkbox" checked={ejemplos} onChange={(evento) => setEjemplos(evento.target.checked)} className="size-4 cursor-pointer accent-[#141414]" />
          Cargar clientes de ejemplo para ver cómo queda
        </label>

        <div className="flex flex-col gap-3">
          {error && (
            <p id={`${id}-error`} role="alert" className={ESTILOS.error}>
              {error.texto}
            </p>
          )}
          <div>
            <button type="submit" disabled={guardando} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
              {guardando ? "Guardando…" : "Seguir"}
            </button>
          </div>
        </div>
      </form>
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

// ─── Paso 2 · Conecta tu asistente ───────────────────────────────────────────────────────────────

function PasoClaude(p: { estado: EstadoApp; hechos: PasoPuesta[]; aplazar: () => void }): JSX.Element {
  const { estado } = p;
  const [aceptada, setAceptada] = useState(false);
  const lista = aceptada || estado.puesta.claude || p.hechos.includes("claude");
  return (
    <div className="flex flex-col">
      <Cabecera estado={estado} hechos={p.hechos} paso="claude" />
      <div className="mt-10 flex flex-col gap-10">
        <Tarjeta>
          <CampoClave
            nombre="ANTHROPIC_API_KEY"
            etiqueta="Clave de Claude"
            ayuda="La sacas de platform.claude.com → API Keys. Se paga por uso: añade saldo en Billing."
            alGuardar={() => {
              setAceptada(true);
              marcarHecho("claude");
            }}
          />
        </Tarjeta>
        {lista && (
          <section aria-labelledby="titulo-habla" className="flex flex-col gap-4">
            <h2 id="titulo-habla" className="text-[20px] leading-7 font-medium tracking-[-0.01em] text-tinta">
              Habla con tu asistente
            </h2>
            <ChatDePrueba origen="whatsapp" />
            <div>
              <button type="button" onClick={() => irAlSiguiente(estado)} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
                Seguir
              </button>
            </div>
          </section>
        )}
      </div>
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

// ─── Paso 3 · Conecta tu WhatsApp ────────────────────────────────────────────────────────────────

type PasoComprobado = Exclude<PasoMeta, "claves">;
const COMPROBACIONES: PasoComprobado[] = ["cuenta", "numero", "tunel", "suscripcion", "webhook", "firma"];

function etiquetaComprobacion(paso: PasoMeta, servidor: boolean): string {
  switch (paso) {
    case "claves":
      return "Tus claves";
    case "cuenta":
      return "Cuenta de WhatsApp";
    case "numero":
      return "Número del negocio";
    case "tunel":
      return servidor ? "Tu servidor" : "Túnel para recibir mensajes";
    case "suscripcion":
      return "Tu app escucha esta cuenta";
    case "webhook":
      return servidor ? "Meta avisa a tu servidor" : "Meta avisa a este ordenador";
    case "firma":
      return "Firma de los mensajes";
  }
}

// Rutas de public/meta/paso-N.webp: se añaden aquí cuando el dueño ponga las capturas de Meta.
const IMAGENES_META: Partial<Record<number, string>> = {};

type Linea = { estado: "gris" | "ok" | "error"; texto?: string };
type CampoMeta = "token" | "secreto" | "ngrok";

const NOMBRE_CLAVE: Record<CampoMeta, EstadoClave["nombre"]> = { token: "WHATSAPP_TOKEN", secreto: "META_APP_SECRET", ngrok: "NGROK_AUTHTOKEN" };

/** Lo que dice un campo de Meta debajo: un error al guardar o, ya guardado, una nota o un aviso. */
type EstadoCampo = { enviando: boolean; error: string | null; nota: string | null };
const CAMPO_LIMPIO: EstadoCampo = { enviando: false, error: null, nota: null };

/**
 * Un código de Meta: se guarda en cuanto se pega (o con «Guardar»), como la clave de Claude, y luego
 * solo se ve cómo termina. Así un token que Meta enseña una sola vez no se pierde al recargar.
 */
function CampoDeMeta(p: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  guardada: string | null;
  abierto: boolean;
  abrir: () => void;
  valor: string;
  cambiar: (v: string) => void;
  guardar: (pegado?: string) => void;
  estado: EstadoCampo;
  entrada: RefObject<HTMLInputElement | null>;
  deshabilitado: boolean;
}): JSX.Element {
  const idAyuda = `${p.id}-ayuda`;
  const idError = `${p.id}-error`;
  const mostrarGuardada = p.guardada !== null && !p.abierto;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={p.id} className={ESTILOS.etiqueta}>
        {p.etiqueta}
      </label>
      {p.ayuda && (
        <p id={idAyuda} className={ESTILOS.ayuda}>
          {p.ayuda}
        </p>
      )}
      {mostrarGuardada ? (
        <ClaveGuardada terminaEn={p.guardada!} etiqueta={p.etiqueta} cambiar={p.abrir} />
      ) : (
        <div className="mt-0.5 flex w-full gap-2">
          <input
            ref={p.entrada}
            id={p.id}
            {...ATRIBUTOS_CLAVE}
            value={p.valor}
            disabled={p.deshabilitado || p.estado.enviando}
            onChange={(evento) => p.cambiar(evento.target.value)}
            onPaste={(evento) => {
              // Pegar el código entero es «Guardar»: si ya había algo escrito y no está todo seleccionado, se pega sin más.
              const pegado = evento.clipboardData.getData("text").trim();
              const campo = evento.currentTarget;
              const todo = !p.valor || (campo.selectionStart === 0 && campo.selectionEnd === p.valor.length);
              if (!pegado || !todo) return;
              evento.preventDefault();
              p.cambiar(pegado);
              p.guardar(pegado);
            }}
            onKeyDown={(evento) => {
              if (evento.key !== "Enter") return;
              // Enter guarda este campo, no envía «Conectar».
              evento.preventDefault();
              p.guardar();
            }}
            placeholder="Pega aquí tu clave"
            aria-invalid={p.estado.error !== null}
            aria-describedby={[p.ayuda ? idAyuda : null, p.estado.error ? idError : null].filter(Boolean).join(" ") || undefined}
            className={`${ESTILOS_TOQUE.campo} min-w-0 flex-1 font-mono placeholder:font-sans`}
          />
          <button type="button" onClick={() => p.guardar()} disabled={!p.valor.trim() || p.estado.enviando || p.deshabilitado} className={ESTILOS_TOQUE.boton}>
            {p.estado.enviando ? "Comprobando…" : "Guardar"}
          </button>
        </div>
      )}
      {p.estado.error && (
        <p id={idError} role="alert" className={ESTILOS.error}>
          {p.estado.error}
        </p>
      )}
      {p.estado.nota && mostrarGuardada && !p.estado.error && <p className={ESTILOS.ayuda}>{p.estado.nota}</p>}
    </div>
  );
}

function PasoWhatsApp(p: { estado: EstadoApp; hechos: PasoPuesta[]; aplazar: () => void }): JSX.Element {
  const { estado } = p;
  const id = useId();
  const servidor = estado.modo === "servidor";
  const campos: CampoMeta[] = servidor ? ["token", "secreto"] : ["token", "secreto", "ngrok"];

  const [guardadas, setGuardadas] = useState<Record<CampoMeta, string | null>>({ token: null, secreto: null, ngrok: null });
  const [leidas, setLeidas] = useState(false);
  const [abiertos, setAbiertos] = useState<Record<CampoMeta, boolean>>({ token: false, secreto: false, ngrok: false });
  const [valores, setValores] = useState<Record<CampoMeta, string>>({ token: "", secreto: "", ngrok: "" });
  const [campo, setCampo] = useState<Record<CampoMeta, EstadoCampo>>({ token: CAMPO_LIMPIO, secreto: CAMPO_LIMPIO, ngrok: CAMPO_LIMPIO });
  const [lineas, setLineas] = useState<Partial<Record<PasoMeta, Linea>>>({});
  const [enCurso, setEnCurso] = useState<PasoMeta | null>(null);
  const [fallo, setFallo] = useState<PeticionConectarMeta | null>(null);
  const [eleccion, setEleccion] = useState<{ paso: "cuenta" | "numero"; texto: string; opciones: { id: string; texto: string }[] } | null>(null);
  const [elegida, setElegida] = useState<string>("");
  const [pideCuenta, setPideCuenta] = useState(false);
  const [waba, setWaba] = useState("");
  const [errorWaba, setErrorWaba] = useState<string | null>(null);
  const [conectado, setConectado] = useState(false);
  const control = useRef<AbortController | null>(null);
  const montado = useRef(true);
  const entradas = {
    token: useRef<HTMLInputElement>(null),
    secreto: useRef<HTMLInputElement>(null),
    ngrok: useRef<HTMLInputElement>(null),
  };

  const releerClaves = useCallback(async () => {
    const claves = await leerClaves();
    if (control.current?.signal.aborted) return;
    const de = (c: CampoMeta) => claves.find((x) => x.nombre === NOMBRE_CLAVE[c] && x.guardada)?.terminaEn ?? null;
    setGuardadas({ token: de("token"), secreto: de("secreto"), ngrok: de("ngrok") });
    setLeidas(true);
  }, []);

  useEffect(() => {
    montado.current = true;
    void releerClaves();
    // Al cerrar la puesta a mitad: la máquina se para y no se manda el paso siguiente.
    return () => {
      montado.current = false;
      control.current?.abort();
    };
  }, [releerClaves]);

  const abrirCampo = (c: CampoMeta) => {
    if (servidor && c === "ngrok") return;
    setAbiertos((a) => ({ ...a, [c]: true }));
    requestAnimationFrame(() => entradas[c].current?.focus());
  };

  /**
   * Guarda un código en cuanto se pega, por la ruta de las claves, con lo que se puede comprobar de él
   * solo. true si queda guardado (también con un aviso, como un token bueno con la clave secreta de
   * otra app); false si no se ha guardado y el campo sigue abierto con su error.
   */
  const guardarCampo = async (c: CampoMeta, pegado?: string): Promise<boolean> => {
    const limpio = (pegado ?? valores[c]).trim();
    if (!limpio) return true;
    if (servidor && c === "ngrok") return true;
    setCampo((x) => ({ ...x, [c]: { enviando: true, error: null, nota: null } }));
    const r = await guardarClave(NOMBRE_CLAVE[c], limpio);
    if (!montado.current) return false;
    if (!r.ok && !r.guardada) {
      setCampo((x) => ({ ...x, [c]: { enviando: false, error: r.error, nota: null } }));
      requestAnimationFrame(() => entradas[c].current?.focus());
      return false;
    }
    setValores((v) => ({ ...v, [c]: "" }));
    setAbiertos((a) => ({ ...a, [c]: false }));
    if (r.ok) {
      setGuardadas((g) => ({ ...g, [c]: r.terminaEn }));
      // Con este ya bien, se van los avisos que los otros guardados tenían por culpa de él.
      setCampo((x) => {
        const siguiente = { ...x, [c]: { enviando: false, error: null, nota: r.nota ?? null } };
        for (const otro of campos) if (otro !== c && guardadas[otro] !== null && !abiertos[otro]) siguiente[otro] = { ...x[otro], error: null };
        return siguiente;
      });
      return true;
    }
    // Guardado, pero con un aviso: se dice debajo y, si la culpa es del otro código, se abre ese.
    void releerClaves();
    setCampo((x) => ({ ...x, [c]: { enviando: false, error: r.error, nota: null } }));
    if (r.codigo === "meta.firma" && c !== "secreto") abrirCampo("secreto");
    else if (r.codigo === "meta.token" && c !== "token") abrirCampo("token");
    return true;
  };

  const correr = async (primera: PeticionConectarMeta) => {
    control.current?.abort();
    const c = new AbortController();
    control.current = c;
    setFallo(null);
    setEleccion(null);
    setPideCuenta(false);
    setErrorWaba(null);
    let peticion: PeticionConectarMeta = primera;
    for (let vuelta = 0; vuelta < 16; vuelta++) {
      setEnCurso(peticion.paso);
      const r = await conectarMeta(peticion);
      if (c.signal.aborted) return;
      // Sin respuesta del servidor ({ error }); un paso que falla es un ResultadoPasoMeta con su error dentro.
      if (!("paso" in r)) {
        setLineas((l) => ({ ...l, [peticion.paso]: { estado: "error", texto: r.error } }));
        setFallo(peticion);
        break;
      }
      if (r.ok) {
        setLineas((l) => ({ ...l, [r.paso]: { estado: "ok", texto: r.texto } }));
        if (r.paso === "claves") {
          setValores({ token: "", secreto: "", ngrok: "" });
          setAbiertos({ token: false, secreto: false, ngrok: false });
          setLineas((l) => {
            const { claves: _claves, ...resto } = l;
            return resto;
          });
          void releerClaves();
        }
        if (r.siguiente === null) {
          setConectado(true);
          marcarHecho("whatsapp");
          break;
        }
        peticion = { paso: r.siguiente };
        continue;
      }
      if (r.opciones && r.opciones.length > 0 && (r.paso === "cuenta" || r.paso === "numero")) {
        setLineas((l) => ({ ...l, [r.paso]: { estado: "gris" } }));
        setEleccion({ paso: r.paso, texto: r.texto, opciones: r.opciones });
        setElegida(r.opciones[0]?.id ?? "");
        break;
      }
      if (r.paso === "cuenta" && r.error?.codigo === "meta.permisos") {
        setLineas((l) => ({ ...l, cuenta: { estado: "error", texto: r.texto || fraseDeError(r.error!) } }));
        setPideCuenta(true);
        break;
      }
      const frase = r.error ? fraseDeError(r.error) : r.texto;
      setLineas((l) => ({ ...l, [r.paso]: { estado: "error", texto: frase } }));
      setFallo(peticion);
      const codigo = r.error?.codigo;
      if (codigo === "meta.token" || codigo === "meta.permisos") abrirCampo("token");
      else if (codigo === "meta.firma") abrirCampo("secreto");
      else if (codigo?.startsWith("ngrok.")) abrirCampo("ngrok");
      break;
    }
    if (!c.signal.aborted) setEnCurso(null);
  };

  /**
   * «Conectar» con lo guardado: lo escrito sin guardar se guarda antes, campo a campo; luego se
   * comprueban juntos el token y la clave secreta y se hace el resto (cuenta, número, suscripción,
   * webhook y firma).
   */
  const conectar = async () => {
    for (const c of campos) {
      if (valores[c].trim() && !(await guardarCampo(c))) return;
    }
    if (!montado.current) return;
    setLineas({});
    setConectado(false);
    void correr({ paso: "claves" });
  };

  const reintentar = () => {
    if (!fallo) return;
    if (fallo.paso === "claves") {
      void conectar();
      return;
    }
    void correr(fallo);
  };

  const corriendo = enCurso !== null;
  const guardando = campos.some((c) => campo[c].enviando);
  const listo = conectado || p.hechos.includes("whatsapp") || hechoSegun(estado.puesta, "whatsapp");
  const visibles: PasoMeta[] = [...(lineas.claves?.estado === "error" ? (["claves"] as PasoMeta[]) : []), ...COMPROBACIONES];

  return (
    <div className="flex flex-col">
      <Cabecera estado={estado} hechos={p.hechos} paso="whatsapp" />
      <div className="mt-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-6">
          <Tarjeta>
            <form
              className="flex flex-col gap-5"
              onSubmit={(evento) => {
                evento.preventDefault();
                if (!corriendo && !guardando) void conectar();
              }}
            >
              <p className={ESTILOS.ayuda}>Cada código se guarda en cuanto lo pegas: si cierras esta pestaña, no se pierde.</p>
              <CampoDeMeta
                id={`${id}-token`}
                etiqueta="Token permanente de Meta"
                ayuda="Es el del usuario del sistema, no el de la pantalla de inicio de Meta, que caduca en 24 h"
                guardada={guardadas.token}
                abierto={abiertos.token}
                abrir={() => abrirCampo("token")}
                valor={valores.token}
                cambiar={(v) => setValores((x) => ({ ...x, token: v }))}
                guardar={(pegado) => void guardarCampo("token", pegado)}
                estado={campo.token}
                entrada={entradas.token}
                deshabilitado={!leidas || corriendo}
              />
              <CampoDeMeta
                id={`${id}-secreto`}
                etiqueta="Clave secreta de la app"
                guardada={guardadas.secreto}
                abierto={abiertos.secreto}
                abrir={() => abrirCampo("secreto")}
                valor={valores.secreto}
                cambiar={(v) => setValores((x) => ({ ...x, secreto: v }))}
                guardar={(pegado) => void guardarCampo("secreto", pegado)}
                estado={campo.secreto}
                entrada={entradas.secreto}
                deshabilitado={!leidas || corriendo}
              />
              {!servidor && (
                <CampoDeMeta
                  id={`${id}-ngrok`}
                  etiqueta="Token de ngrok"
                  ayuda="Si ya usabas ngrok en este ordenador, puedes dejarlo vacío."
                  guardada={guardadas.ngrok}
                  abierto={abiertos.ngrok}
                  abrir={() => abrirCampo("ngrok")}
                  valor={valores.ngrok}
                  cambiar={(v) => setValores((x) => ({ ...x, ngrok: v }))}
                  guardar={(pegado) => void guardarCampo("ngrok", pegado)}
                  estado={campo.ngrok}
                  entrada={entradas.ngrok}
                  deshabilitado={!leidas || corriendo}
                />
              )}
              <div>
                <button type="submit" disabled={corriendo || guardando || !leidas} className={`${listo && !corriendo ? ESTILOS_TOQUE.botonSecundario : ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
                  {corriendo ? "Conectando…" : "Conectar"}
                </button>
              </div>
            </form>
          </Tarjeta>

          <Tarjeta>
            <ul className="flex flex-col gap-3" aria-label="Comprobaciones" aria-live="polite">
              {visibles.map((paso) => {
                const linea = lineas[paso] ?? { estado: "gris" };
                const ahora = enCurso === paso;
                return (
                  <li key={paso} className="flex items-start gap-3">
                    <MarcaComprobacion estado={ahora ? "en-curso" : linea.estado} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        className={`text-[14px] leading-5 ${
                          linea.estado === "ok" ? "text-ok-texto" : linea.estado === "error" ? "font-medium text-error-texto" : ahora ? "text-tinta" : "text-secundario"
                        }`}
                      >
                        {linea.estado === "ok" ? linea.texto : etiquetaComprobacion(paso, servidor)}
                        <span className="sr-only">{linea.estado === "ok" ? ": hecho" : linea.estado === "error" ? ": falla" : ahora ? ": comprobando" : ": pendiente"}</span>
                      </span>
                      {linea.estado === "error" && linea.texto && (
                        <span role="alert" className="text-[13px] leading-[18px] text-error-texto">
                          {linea.texto}
                        </span>
                      )}
                      {linea.estado === "error" && fallo?.paso === paso && !corriendo && (
                        <div className="mt-1">
                          <button type="button" onClick={reintentar} className={`${ESTILOS_TOQUE.botonSecundario} h-8 px-3 text-[13px]`}>
                            Reintentar
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {eleccion && (
              <form
                className="mt-5 flex flex-col gap-3 border-t border-linea pt-5"
                onSubmit={(evento) => {
                  evento.preventDefault();
                  if (!elegida) return;
                  void correr(eleccion.paso === "cuenta" ? { paso: "cuenta", waba: elegida } : { paso: "numero", numero: elegida });
                }}
              >
                <fieldset className="flex flex-col gap-2">
                  <legend className={`${ESTILOS.etiqueta} mb-1`}>{eleccion.texto}</legend>
                  {eleccion.opciones.map((o) => (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-linea px-3.5 py-2.5 text-[14px] leading-5 transition-colors duration-200 ease-out hover:bg-lienzo has-[:checked]:border-tinta"
                    >
                      <input
                        type="radio"
                        name={`${id}-eleccion`}
                        value={o.id}
                        checked={elegida === o.id}
                        onChange={() => setElegida(o.id)}
                        className="size-4 cursor-pointer accent-[#141414]"
                      />
                      {o.texto}
                    </label>
                  ))}
                </fieldset>
                <div>
                  <button type="submit" disabled={corriendo || !elegida} className={ESTILOS_TOQUE.boton}>
                    Seguir
                  </button>
                </div>
              </form>
            )}

            {pideCuenta && (
              <form
                className="mt-5 flex flex-col gap-1.5 border-t border-linea pt-5"
                noValidate
                onSubmit={(evento) => {
                  evento.preventDefault();
                  const limpio = waba.trim();
                  if (!/^\d+$/.test(limpio)) {
                    setErrorWaba("Son solo cifras");
                    return;
                  }
                  void correr({ paso: "cuenta", waba: limpio });
                }}
              >
                <label htmlFor={`${id}-waba`} className={ESTILOS.etiqueta}>
                  Identificador de la cuenta de WhatsApp
                </label>
                <p id={`${id}-waba-ayuda`} className={ESTILOS.ayuda}>
                  Está en tu app de Meta: WhatsApp → Configuración de la API, «Identificador de la cuenta de WhatsApp Business».
                </p>
                <div className="mt-0.5 flex gap-2">
                  <input
                    id={`${id}-waba`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={waba}
                    onChange={(evento) => {
                      setWaba(evento.target.value);
                      setErrorWaba(null);
                    }}
                    aria-invalid={errorWaba !== null}
                    aria-describedby={`${id}-waba-ayuda${errorWaba ? ` ${id}-waba-error` : ""}`}
                    className={`${ESTILOS_TOQUE.campo} font-mono tabular-nums`}
                  />
                  <button type="submit" disabled={corriendo || !waba.trim()} className={ESTILOS_TOQUE.boton}>
                    Seguir
                  </button>
                </div>
                {errorWaba && (
                  <p id={`${id}-waba-error`} role="alert" className={ESTILOS.error}>
                    {errorWaba}
                  </p>
                )}
              </form>
            )}
          </Tarjeta>

          {listo && (
            <div>
              <button type="button" onClick={() => irAlSiguiente(estado)} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
                Seguir
              </button>
            </div>
          )}
        </div>

        <aside aria-labelledby={`${id}-meta`} className="min-w-0 rounded-[14px] border border-linea bg-white px-6 py-5 max-sm:px-4 lg:sticky lg:top-8">
          <h2 id={`${id}-meta`} className="text-[16px] leading-6 font-medium text-tinta">
            Lo que tienes que hacer en Meta
          </h2>
          <ol className="mt-4 flex flex-col gap-4">
            {pasosMeta(servidor).map((paso, i) => {
              const imagen = IMAGENES_META[i + 1];
              return (
                <li key={paso.titulo} className="flex gap-3">
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-lienzo text-[12px] leading-4 font-medium text-tinta tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="text-[14px] leading-[21px] text-secundario [overflow-wrap:anywhere]">
                      <span className="sr-only">{`${i + 1}. `}</span>
                      <span className="font-medium text-tinta">{paso.titulo}</span> {paso.texto}
                    </p>
                    {imagen && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imagen} alt="" className="h-auto max-w-full rounded-[8px] border border-linea" />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

function MarcaComprobacion(p: { estado: Linea["estado"] | "en-curso" }): JSX.Element {
  if (p.estado === "ok") {
    return (
      <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-ok text-white">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (p.estado === "error") {
    return (
      <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-error text-white">
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (p.estado === "en-curso") {
    return <span aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-linea border-t-tinta motion-reduce:animate-none" />;
  }
  return <span aria-hidden className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-linea" />;
}

// ─── Paso 3 en modo prueba · Escanea el QR ───────────────────────────────────────────────────────

function PasoQr(p: { estado: EstadoApp; hechos: PasoPuesta[]; aplazar: () => void }): JSX.Element {
  const { estado } = p;
  const { prefijo } = useNegocio();
  const [listoAqui, setListoAqui] = useState(false);
  const alListo = useCallback((listo: boolean) => {
    setListoAqui(listo);
    if (listo) marcarHecho("whatsapp");
  }, []);
  const listo = listoAqui || hechoSegun(estado.puesta, "whatsapp");

  return (
    <div className="flex flex-col">
      <Cabecera estado={estado} hechos={p.hechos} paso="whatsapp" />
      <div className="mt-10 flex flex-col gap-6">
        <VincularMovil prefijo={prefijo} alListo={alListo} />
        {listo && (
          <div>
            <button type="button" onClick={() => irAlSiguiente(estado)} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
              Seguir
            </button>
          </div>
        )}
        <p className="text-[13px] leading-[18px] text-secundario">
          ¿Mejor por la vía oficial?{" "}
          <button
            type="button"
            onClick={() => pasarAOficial(() => cambiar({ pantalla: "whatsapp" }))}
            className="cursor-pointer font-medium text-tinta underline decoration-tinta/30 underline-offset-4 hover:decoration-tinta"
          >
            Pasar a WhatsApp oficial
          </button>
        </p>
      </div>
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

// ─── Paso 4 · Tu primer WhatsApp ─────────────────────────────────────────────────────────────────

const BD_VACIA: Bd = { leads: {}, reservas: [], ajustes: { leadsPrueba: false }, proyectos: [] };
const SEGUNDOS = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ESPERA_PISTA_MS = 60_000;
const RELEER_NUMERO_MS = 5_000;
const MAXIMO_NUMERO_MS = 60_000;
const RELEER_PLANTILLA_MS = 60_000;
const TRAS_CREAR_MS = 3_000;

type Fase = { fase: "esperando" } | { fase: "llegado"; lead: Lead; texto: string } | { fase: "contestado"; lead: Lead; texto: string; respuesta: string; ms: number | null };

/** Tu «Hola»: el cliente de verdad más reciente que ha escrito (mejor por WhatsApp) y su respuesta. */
function faseDe(bd: Bd): Fase {
  const reales = Object.values(bd.leads).filter((l) => !l.ejemplo && l.origen !== "prueba" && l.mensajes.some((m) => m.de === "cliente"));
  const porWhatsApp = reales.filter((l) => l.origen === "whatsapp");
  const lead = (porWhatsApp.length > 0 ? porWhatsApp : reales).sort((a, b) => b.creadoEn - a.creadoEn)[0];
  if (!lead) return { fase: "esperando" };
  const i = lead.mensajes.findIndex((m) => m.de === "cliente");
  const suyo = lead.mensajes[i];
  const texto = Array.from(suyo.texto.trim()).length > 40 ? `${Array.from(suyo.texto.trim()).slice(0, 40).join("").trimEnd()}…` : suyo.texto.trim();
  const respuesta = lead.mensajes.slice(i + 1).find((m) => m.de === "agente");
  if (!respuesta) return { fase: "llegado", lead, texto };
  const ms = lead.msPrimeraRespuesta ?? (respuesta.ts > suyo.ts ? respuesta.ts - suyo.ts : null);
  return { fase: "contestado", lead, texto, respuesta: respuesta.texto, ms };
}

/** Solo mientras se ve el paso 4: los datos del panel (cada 3 s y con cada cambio) y las llegadas. */
function HolaEnDirecto(p: { alCambiar: (f: Fase["fase"]) => void; pista: ReactNode }): JSX.Element {
  const { alCambiar } = p;
  const { bd, refrescar } = useBd(BD_VACIA);
  const llegadas = useLlegadas(bd);
  const fase = faseDe(bd);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  useEffect(() => {
    alCambiar(fase.fase);
  }, [fase.fase, alCambiar]);

  if (fase.fase === "esperando") {
    return (
      <div className="flex min-h-[104px] flex-col justify-center gap-3">
        <p className="flex items-center gap-2.5 text-[14px] leading-5 text-secundario">
          <span aria-hidden className="size-2 rounded-full bg-nuevo" />
          Esperando tu mensaje…
        </p>
        {p.pista}
      </div>
    );
  }

  const llegada = llegadas.porLead[fase.lead.id];
  return (
    <div className="flex min-h-[104px] flex-col justify-center gap-3">
      <div className="flex flex-col items-end gap-1">
        <span className="px-1 text-[12px] leading-4 text-secundario">Tú</span>
        <p className="max-w-[80%] rounded-[14px] rounded-tr-[4px] bg-tinta px-3.5 py-2.5 text-[14px] leading-5 text-white [overflow-wrap:anywhere]">{fase.texto}</p>
      </div>
      {fase.fase === "llegado" ? (
        <p className="flex items-center gap-2.5 text-[14px] leading-5 text-tinta">
          <span aria-hidden className="flex gap-1">
            {[0, 1, 2].map((n) => (
              <span
                key={n}
                className="size-1.5 animate-escribiendo rounded-full bg-marca motion-reduce:animate-none"
                style={{ animationDelay: `${n * 160}ms` }}
              />
            ))}
          </span>
          {`Ha llegado tu «${fase.texto}». Tu asistente está escribiendo…`}
        </p>
      ) : (
        <>
          <div className="flex flex-col items-start gap-1">
            <span className="px-1 text-[12px] leading-4 text-secundario">Tu asistente</span>
            <p className="max-w-[80%] rounded-[14px] rounded-tl-[4px] border border-marca/25 bg-marca/10 px-3.5 py-2.5 text-[14px] leading-5 whitespace-pre-wrap text-tinta [overflow-wrap:anywhere]">
              {fase.respuesta}
            </p>
          </div>
          <p className="flex items-center gap-2 text-[14px] leading-5 font-medium text-ok-texto">
            <CheckCircle2 aria-hidden className="size-4" strokeWidth={2} />
            <span className="tabular-nums">
              {"Contestado en "}
              {llegada ? (
                <Cronometro inicio={llegada.inicio} fin={llegada.fin} enDirecto={llegada.enDirecto} />
              ) : fase.ms !== null ? (
                `${SEGUNDOS.format(fase.ms / 1000)} s`
              ) : (
                "unos segundos"
              )}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

function PasoPrimer(p: { estado: EstadoApp; hechos: PasoPuesta[]; aplazar: () => void }): JSX.Element {
  if (enPrueba(p.estado)) return <PasoPrimerPrueba {...p} />;
  return <PasoPrimerOficial {...p} />;
}

/** El paso 4 en modo prueba: «Hola» al móvil vinculado desde un número de la lista. Sin mensajes aprobados. */
function PasoPrimerPrueba(p: { estado: EstadoApp; hechos: PasoPuesta[]; aplazar: () => void }): JSX.Element {
  const { estado } = p;
  const { estado: prueba } = useModoPrueba(false);
  const { formato } = useNegocio();
  const [fase, setFase] = useState<Fase["fase"]>("esperando");
  const [pista, setPista] = useState(false);

  useEffect(() => {
    if (fase !== "esperando") return;
    const temporizador = setTimeout(() => setPista(true), ESPERA_PISTA_MS);
    return () => clearTimeout(temporizador);
  }, [fase]);

  const alCambiar = useCallback((f: Fase["fase"]) => {
    setFase(f);
    if (f === "contestado") marcarHecho("primer");
  }, []);

  const seguir = () => {
    const falta = (["negocio", "claude", "whatsapp"] as PasoPuesta[]).find((x) => !hecho(estado, tienda.hechos, x));
    cambiar({ abierta: true, pantalla: falta ?? "final" });
  };

  const vinculado = prueba?.puente.numero ?? null;
  const permitidos = prueba?.permitidos.map((n) => formato.telefono(n)) ?? [];
  const pistaNodo = pista ? (
    <p className="text-[13px] leading-[18px] text-secundario">
      ¿No llega? Escribe desde uno de los números de la lista, al móvil vinculado. Los demás chats no se leen.
    </p>
  ) : null;

  return (
    <div className="flex flex-col">
      <Cabecera estado={estado} hechos={p.hechos} paso="primer" />
      <div className="mt-10 flex flex-col gap-5">
        <Tarjeta titulo="Tu «Hola»" idTitulo="titulo-hola">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[32px] leading-10 font-medium tracking-[-0.01em] break-words text-tinta tabular-nums">{vinculado ?? "Móvil de pruebas"}</p>
            <p className="text-[14px] leading-5 text-secundario">
              {permitidos.length > 0 ? `Escríbele «Hola» desde ${permitidos.length === 1 ? permitidos[0] : "uno de tus números permitidos"}` : "Escríbele «Hola» desde un número de la lista"}
            </p>
          </div>
          <div className="mt-5 border-t border-linea pt-4" aria-live="polite">
            <HolaEnDirecto alCambiar={alCambiar} pista={pistaNodo} />
          </div>
        </Tarjeta>

        {/* Con el botón de WhatsApp en la web no hace falta bienvenida: solo se avisa con el formulario. */}
        {estado.configuracion.web?.entrada === "formulario" && (
          <Tarjeta titulo="Tu mensaje de bienvenida" idTitulo="titulo-bienvenida">
            <Estado texto="No disponible en modo prueba: los mensajes aprobados son de WhatsApp oficial" tono="gris" />
          </Tarjeta>
        )}

        <div>
          <button type="button" onClick={seguir} disabled={fase !== "contestado"} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
            Seguir
          </button>
        </div>
      </div>
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

function PasoPrimerOficial(p: { estado: EstadoApp; hechos: PasoPuesta[]; aplazar: () => void }): JSX.Element {
  const { estado } = p;
  const config = estado.configuracion;
  // Con el botón de WhatsApp en la web (lo normal) el cliente escribe primero: no hace falta la bienvenida.
  const conFormulario = config.web?.entrada === "formulario";
  const { estado: conexiones } = useConexiones();
  const [numero, setNumero] = useState(estado.numero);
  const [copiado, setCopiado] = useState(false);
  const [fase, setFase] = useState<Fase["fase"]>("esperando");
  const [pista, setPista] = useState(false);
  const [bienvenida, setBienvenida] = useState<EstadoPlantilla | null>(null);
  const [leidaBienvenida, setLeidaBienvenida] = useState(false);
  const [errorPlantilla, setErrorPlantilla] = useState<string | null>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    if (estado.numero) setNumero(estado.numero);
  }, [estado.numero]);

  // Sin número aún: se pregunta cada 5 s, como mucho un minuto.
  useEffect(() => {
    if (numero) return;
    const inicio = Date.now();
    const intervalo = setInterval(async () => {
      if (Date.now() - inicio > MAXIMO_NUMERO_MS) {
        clearInterval(intervalo);
        return;
      }
      const r = await pedir("/api/estado");
      const leido = r.ok ? (r.datos.numero as EstadoApp["numero"] | undefined) : undefined;
      if (leido && montado.current) {
        setNumero(leido);
        clearInterval(intervalo);
      }
    }, RELEER_NUMERO_MS);
    return () => clearInterval(intervalo);
  }, [numero]);

  // La pista de «¿No llega?» tras un minuto sin mensaje.
  useEffect(() => {
    if (fase !== "esperando") return;
    const temporizador = setTimeout(() => setPista(true), ESPERA_PISTA_MS);
    return () => clearTimeout(temporizador);
  }, [fase]);

  const alCambiar = useCallback((f: Fase["fase"]) => {
    setFase(f);
    if (f === "contestado") marcarHecho("primer");
  }, []);

  const leerBienvenida = useCallback(async () => {
    const lista = await leerPlantillas();
    if (!montado.current) return;
    const b = lista.find((x) => x.id === "bienvenida") ?? null;
    setBienvenida(b);
    setLeidaBienvenida(true);
    cambiar({ bienvenida: b?.estado ?? null });
  }, []);

  useEffect(() => {
    if (!conFormulario) {
      cambiar({ bienvenida: null });
      return;
    }
    void leerBienvenida();
    const intervalo = setInterval(() => void leerBienvenida(), RELEER_PLANTILLA_MS);
    return () => clearInterval(intervalo);
  }, [leerBienvenida, conFormulario]);

  const crear = async () => {
    setErrorPlantilla(null);
    const r = await crearPlantillas(["bienvenida", "aviso"]);
    if (!montado.current) return;
    if ("error" in r) {
      setErrorPlantilla(r.error);
      return;
    }
    const b = r.find((x) => x.id === "bienvenida");
    if (b) {
      setBienvenida(b);
      cambiar({ bienvenida: b.estado });
    }
    setTimeout(() => void leerBienvenida(), TRAS_CREAR_MS);
  };

  const copiar = async () => {
    if (!numero) return;
    try {
      await navigator.clipboard.writeText(numero.texto);
      setCopiado(true);
      setTimeout(() => {
        if (montado.current) setCopiado(false);
      }, 2_000);
    } catch {
      // Sin portapapeles: el número sigue a la vista.
    }
  };

  const enlace = numero && /^https:\/\/wa\.me\/\d+/.test(numero.enlace) ? numero.enlace : null;
  const digitos = numero?.texto.replace(/\D/g, "") ?? "";

  const seguir = () => {
    const falta = (["negocio", "claude", "whatsapp"] as PasoPuesta[]).find((x) => !hecho(estado, tienda.hechos, x));
    cambiar({ abierta: true, pantalla: falta ?? "final" });
  };

  const numeroDePrueba = conexiones?.numeroDePrueba !== false;
  const pistaNodo = pista ? (
    <p className="text-[13px] leading-[18px] text-secundario">
      {numeroDePrueba ? (
        <>
          ¿No llega? {PISTA_PUBLICAR} Con el número de prueba de Meta, tu móvil tiene que estar en su lista (hasta 5).{" "}
          <a
            href="https://developers.facebook.com/apps/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-tinta underline decoration-tinta/30 underline-offset-4 hover:decoration-tinta"
          >
            Añádelo aquí →
          </a>
        </>
      ) : (
        <>
          ¿No llega? {PISTA_PUBLICAR} Revisa también{" "}
          <button
            type="button"
            onClick={() => {
              cerrar();
              irA("configuracion", { bloque: "whatsapp" });
            }}
            className="cursor-pointer font-medium text-tinta underline decoration-tinta/30 underline-offset-4 hover:decoration-tinta"
          >
            Ajustes → Conexiones
          </button>
          .
        </>
      )}
    </p>
  ) : null;

  return (
    <div className="flex flex-col">
      <Cabecera estado={estado} hechos={p.hechos} paso="primer" />
      <div className="mt-10 flex flex-col gap-5">
        <Tarjeta titulo="Tu «Hola»" idTitulo="titulo-hola">
          {numero ? (
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[32px] leading-10 font-medium tracking-[-0.01em] break-words text-tinta tabular-nums">{numero.texto}</p>
                <p className="text-[14px] leading-5 text-secundario">Escríbele «Hola» desde tu móvil</p>
              </div>
              {/* En el móvil, «Copiar» a todo el ancho y el enlace debajo. */}
              <div className="flex items-center gap-4 max-sm:w-full max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
                <button type="button" onClick={() => void copiar()} className={`${ESTILOS_TOQUE.botonSecundario} min-w-[112px] max-sm:w-full`}>
                  {copiado ? <Check aria-hidden className="size-4 text-ok-texto" strokeWidth={2.25} /> : <Copy aria-hidden className="size-4" strokeWidth={1.75} />}
                  {copiado ? "Copiado" : "Copiar"}
                </button>
                {enlace && (
                  <a href={enlace} target="_blank" rel="noopener noreferrer" className={ESTILOS_TOQUE.botonTexto}>
                    {`wa.me/${digitos}`}
                    <ExternalLink aria-hidden className="size-3.5" strokeWidth={2} />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[15px] leading-6 text-tinta">Escríbele «Hola» al número de tu negocio desde tu móvil.</p>
          )}
          <div className="mt-5 border-t border-linea pt-4" aria-live="polite">
            <HolaEnDirecto alCambiar={alCambiar} pista={pistaNodo} />
          </div>
        </Tarjeta>

        {/* Solo con el formulario, y como nota: con él escribes tú primero y Meta pide un mensaje aprobado. */}
        {conFormulario && (
          <section aria-labelledby="titulo-bienvenida" className="flex flex-col gap-2 px-1">
            <p id="titulo-bienvenida" className={ESTILOS.ayuda}>
              Tu web usa el formulario: para escribir tú primero, Meta pide tu mensaje de bienvenida aprobado («
              {textoPlantilla("Laura", config.negocio.nombre, config.plantilla.texto)}»). Es opcional: quien te escriba por WhatsApp ya recibe respuesta.
            </p>
            <div className="flex min-h-8 flex-col items-start justify-center gap-1.5">
              {!leidaBienvenida && <span className={ESTILOS.ayuda}>Comprobando…</span>}
              {leidaBienvenida && !bienvenida && <Estado texto="Conecta antes tu WhatsApp" tono="gris" />}
              {bienvenida && <EstadoDeMensaje plantilla={bienvenida} crear={crear} />}
              {errorPlantilla && (
                <p role="alert" className={ESTILOS.error}>
                  {errorPlantilla}
                </p>
              )}
            </div>
          </section>
        )}

        <Tarjeta titulo="Enviarme un WhatsApp de prueba" idTitulo="titulo-prueba-whatsapp">
          <PruebaWhatsApp />
        </Tarjeta>

        <div>
          <button type="button" onClick={seguir} disabled={fase !== "contestado"} className={`${ESTILOS_TOQUE.boton} h-11 px-6 text-[15px]`}>
            Seguir
          </button>
        </div>
      </div>
      <LuegoBoton aplazar={p.aplazar} />
    </div>
  );
}

// ─── Pantalla final ──────────────────────────────────────────────────────────────────────────────

function Final(p: { bienvenida: EstadoPlantilla["estado"] | null; conFormulario: boolean; prueba: boolean }): JSX.Element {
  const aprobada = p.bienvenida === "APROBADA";
  const texto = p.prueba
    ? "En modo prueba, tu asistente contesta a los números de tu lista. Para clientes de verdad, pasa a WhatsApp oficial desde Ajustes → Conexiones."
    : !p.conFormulario
    ? "Tu asistente ya contesta a quien te escriba por WhatsApp."
    : aprobada
      ? "Tu asistente ya contesta a quien te escriba por WhatsApp y a quien rellene tu formulario."
      : "Tu asistente ya contesta a quien te escriba por WhatsApp. Cuando Meta apruebe tu mensaje de bienvenida, también a quien rellene tu formulario.";
  return (
    <div className="flex flex-col items-start">
      <Titulo>
        <span className="inline-flex items-center gap-3">
          <CheckCircle2 aria-hidden className="size-8 shrink-0 text-ok" strokeWidth={1.75} />
          Todo funciona.
        </span>
      </Titulo>
      <p className="mt-4 max-w-[520px] text-[16px] leading-6 text-secundario text-pretty">
        {texto}
      </p>
      <button
        type="button"
        onClick={() => {
          cerrar();
          irA("hoy");
        }}
        className={`${ESTILOS_TOQUE.boton} mt-8 h-11 px-6 text-[15px]`}
      >
        Abrir mi CRM
      </button>
    </div>
  );
}
