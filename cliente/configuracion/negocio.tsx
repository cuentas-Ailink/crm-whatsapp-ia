"use client";

import { Building2, Hammer, Sparkles, Stethoscope, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX } from "react";
import { lugarDeZona } from "@/lib/agenda";
import { colorAGuardar, muestraActiva } from "@/lib/ajustes";
import type { EstadoPlantilla, RespuestaConfiguracion } from "@/lib/api-tipos";
import { COLORES_MARCA, LIMITES } from "@/lib/configuracion";
import { MONEDAS, PAISES, simboloMoneda, type Moneda } from "@/lib/regional";
import { confirmar } from "../confirmaciones";
import { claseTarjetaNegocio, ContenidoTarjetaNegocio } from "../tarjeta-negocio";
import { cambiarDeNegocio, guardarCambiosPerfil, subirLogo, type DestinoAjustes } from "./api";
import { guardarCampo } from "./guardar";
import {
  Ayuda,
  BOTON,
  BOTON_PRINCIPAL,
  CampoTexto,
  Dialogo,
  ENLACE,
  ENTRADA,
  ErrorCampo,
  EstadoGuardado,
  Fila,
  FOCO,
  LineaAtencion,
  menosMovimiento,
  moverConFlechas,
  Muestras,
  SELECT,
  useGuardado,
} from "./controles";

// Bloque 1 · «Tu negocio»: el tipo de negocio, el nombre, el logo, el color y el país.

type IdTarjeta = "reformas" | "inmobiliaria" | "clinica" | "otro";

const TARJETAS: { id: IdTarjeta; preset: "reformas" | "inmobiliaria" | "clinica" | "generico"; Icono: LucideIcon }[] = [
  { id: "reformas", preset: "reformas", Icono: Hammer },
  { id: "inmobiliaria", preset: "inmobiliaria", Icono: Building2 },
  { id: "clinica", preset: "clinica", Icono: Stethoscope },
  { id: "otro", preset: "generico", Icono: Sparkles },
];

const VERDE_CLASICO = "#2f9e6e";
const NOTA_CLAUDE_CODE = "Para adaptarlo a fondo, abre Claude Code en la carpeta del CRM y pídeselo";
const SIN_APROBAR = "Hasta que Meta apruebe tu mensaje de bienvenida, tu formulario no podrá mandar el WhatsApp. Tu asistente sí contestará a quien te escriba por WhatsApp.";

export interface PropsBloque {
  datos: RespuestaConfiguracion;
  recargar: () => Promise<void>;
  refrescar: () => Promise<void>;
}

export function BloqueNegocio(p: PropsBloque & { plantillas: EstadoPlantilla[] | null }): JSX.Element {
  return (
    <>
      <TipoDeNegocio {...p} />
      <Nombre {...p} />
      <Logo {...p} />
      <Color {...p} />
      <Pais {...p} />
    </>
  );
}

// ─── ¿Qué negocio es? ─────────────────────────────────────────────────────────────────────────────

function TipoDeNegocio({ datos, recargar, refrescar, plantillas }: PropsBloque & { plantillas: EstadoPlantilla[] | null }): JSX.Element {
  const idEtiqueta = useId();
  const idNota = useId();
  const activa: IdTarjeta = datos.activa.sector === "personalizado" ? "otro" : datos.activa.sector;
  const [destino, setDestino] = useState<IdTarjeta | null>(null);

  return (
    <div className="py-4">
      <span id={idEtiqueta} className="text-[14px] leading-5 font-medium">
        ¿Qué negocio es?
      </span>
      <div role="radiogroup" aria-labelledby={idEtiqueta} aria-describedby={idNota} onKeyDown={(e) => moverConFlechas(e)} className="mt-2.5 grid grid-cols-4 gap-2.5 max-lg:grid-cols-2">
        {TARJETAS.map(({ id, preset, Icono }) => {
          const sector = datos.sectores.find((s) => s.id === preset);
          const elegida = id === activa;
          const detalle = elegida && id === "otro" ? datos.activa.negocio.nombre : (sector?.descripcion ?? "");
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={elegida}
              tabIndex={elegida ? 0 : -1}
              onClick={() => {
                if (!elegida) setDestino(id);
              }}
              className={`${claseTarjetaNegocio(elegida)} ${FOCO}`}
            >
              <ContenidoTarjetaNegocio Icono={Icono} titulo={sector?.etiqueta ?? id} detalle={detalle} elegida={elegida} />
            </button>
          );
        })}
      </div>
      <Ayuda id={idNota} className="mt-3">
        {NOTA_CLAUDE_CODE}
      </Ayuda>
      <DialogoCambio
        destino={destino}
        cerrar={() => setDestino(null)}
        datos={datos}
        plantillas={plantillas}
        recargar={recargar}
        refrescar={refrescar}
      />
    </div>
  );
}

function DialogoCambio(p: PropsBloque & { destino: IdTarjeta | null; cerrar: () => void; plantillas: EstadoPlantilla[] | null }): JSX.Element | null {
  const { destino, datos } = p;
  const [nombre, setNombre] = useState("");
  const [ejemplos, setEjemplos] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const campoNombre = useRef<HTMLInputElement>(null);
  const idNombre = useId();
  const idCasilla = useId();
  const idErrorNombre = useId();

  // Al abrir: la casilla marcada si había ejemplos cargados, y sin errores de antes.
  useEffect(() => {
    if (!destino) return;
    setNombre("");
    setEjemplos(datos.ejemplos.ejemplo > 0);
    setError(null);
    setErrorNombre(null);
    setCambiando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino]);

  if (!destino) return null;
  const tarjeta = TARJETAS.find((t) => t.id === destino)!;
  const sector = datos.sectores.find((s) => s.id === tarjeta.preset);
  const esOtro = destino === "otro";
  const nombreLimpio = nombre.trim();
  const tipo = esOtro ? nombreLimpio || "tu negocio" : (sector?.etiqueta ?? destino);
  // Solo importa con el formulario: con el botón de WhatsApp el cliente escribe primero y no hace falta.
  const sinAprobar =
    datos.activa.web.entrada === "formulario" &&
    !!sector &&
    !!p.plantillas?.some((e) => e.nombre === sector.plantilla.nombre && e.idioma === sector.plantilla.idioma && e.estado !== "APROBADA");

  const cerrar = () => {
    if (!cambiando) p.cerrar();
  };

  const cambiar = async () => {
    if (esOtro && (nombreLimpio.length < 1 || nombreLimpio.length > LIMITES.nombreNegocio)) {
      setErrorNombre(`Ponle un nombre, de 1 a ${LIMITES.nombreNegocio} caracteres`);
      campoNombre.current?.focus();
      return;
    }
    setCambiando(true);
    setError(null);
    const d: DestinoAjustes = esOtro ? { nuevo: { nombre: nombreLimpio, base: "generico", sustituir: true } } : { sector: destino as "reformas" | "inmobiliaria" | "clinica" };
    const r = await cambiarDeNegocio(d, ejemplos ? "sustituir" : "borrar");
    if (!r.ok) {
      setCambiando(false);
      setError(r.error);
      return;
    }
    const conTransicion = document as Document & { startViewTransition?: (f: () => Promise<void>) => unknown };
    if (!menosMovimiento() && typeof conTransicion.startViewTransition === "function") {
      try {
        conTransicion.startViewTransition(() => p.refrescar());
      } catch {
        void p.refrescar();
      }
    } else void p.refrescar();
    confirmar(`Listo: ahora el CRM es de ${esOtro ? nombreLimpio : (sector?.etiqueta ?? destino)}`);
    for (const aviso of r.avisos) confirmar(aviso, { ms: 6_000 });
    setCambiando(false);
    p.cerrar();
    void p.recargar();
  };

  return (
    <Dialogo
      abierto
      cerrar={cerrar}
      titulo={`¿Pasar a ${tipo}?`}
      descripcion="Cambian el asistente, el horario y las palabras del panel. Tus clientes reales no se tocan."
      focoInicial={esOtro ? campoNombre : undefined}
      acciones={
        <>
          <button type="button" onClick={cerrar} disabled={cambiando} className={BOTON}>
            Cancelar
          </button>
          <button type="button" onClick={() => void cambiar()} disabled={cambiando} className={BOTON_PRINCIPAL}>
            {cambiando ? "Cambiando…" : "Cambiar"}
          </button>
        </>
      }
    >
      {esOtro && (
        <div className="mt-5">
          <label htmlFor={idNombre} className="text-[14px] leading-5 font-medium">
            ¿Cómo se llama tu negocio?
          </label>
          <input
            ref={campoNombre}
            id={idNombre}
            value={nombre}
            required
            maxLength={LIMITES.nombreNegocio}
            autoComplete="off"
            aria-invalid={errorNombre ? true : undefined}
            aria-describedby={errorNombre ? idErrorNombre : undefined}
            onChange={(e) => {
              setNombre(e.target.value);
              setErrorNombre(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void cambiar();
              }
            }}
            className={`${ENTRADA} mt-2 w-full`}
          />
          <ErrorCampo id={idErrorNombre} error={errorNombre} />
        </div>
      )}
      <label htmlFor={idCasilla} className="mt-5 flex cursor-pointer items-start gap-2.5 text-[14px] leading-5">
        <input
          id={idCasilla}
          type="checkbox"
          checked={ejemplos}
          onChange={(e) => setEjemplos(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-tinta"
        />
        <span>Cargar clientes de ejemplo de {tipo}</span>
      </label>
      {sinAprobar && <LineaAtencion className="mt-4">{SIN_APROBAR}</LineaAtencion>}
      <ErrorCampo error={error} />
    </Dialogo>
  );
}

// ─── Nombre ───────────────────────────────────────────────────────────────────────────────────────

function Nombre({ datos, recargar }: PropsBloque): JSX.Element {
  const id = useId();
  const idAyuda = useId();
  const g = useGuardado();
  return (
    <Fila etiqueta="Nombre" para={id} ayuda="Sale en tu web, en el panel y en el primer WhatsApp" idAyuda={idAyuda} g={g}>
      <CampoTexto
        id={id}
        idAyuda={idAyuda}
        valor={datos.activa.negocio.nombre}
        max={LIMITES.nombreNegocio}
        g={g}
        className="max-w-[420px]"
        guardar={async (t) => {
          const bien = await g.ejecutar(() => guardarCampo("negocio.nombre", t));
          if (bien) void recargar();
          return bien;
        }}
      />
    </Fila>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────────────────────────────

const TIPOS_LOGO = new Set(["image/png", "image/jpeg", "image/webp"]);
const LOGO_PESADO = "El logo pesa demasiado: prueba con uno más pequeño";

/** Bytes de un data URL en base64 (aproximado: largo × 3 / 4). */
function pesoDe(dataUrl: string): number {
  return (dataUrl.length * 3) / 4;
}

async function prepararLogo(archivo: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!TIPOS_LOGO.has(archivo.type)) return { ok: false, error: "Súbelo en PNG, JPG o WebP" };
  if (typeof createImageBitmap !== "function") return { ok: false, error: "Este navegador no puede preparar el logo: prueba con otro" };
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    return { ok: false, error: "No se ha podido leer la imagen: prueba con otra" };
  }
  const dibujar = (lado: number): string | null => {
    const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(imagen.width * escala));
    lienzo.height = Math.max(1, Math.round(imagen.height * escala));
    const ctx = lienzo.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    const webp = lienzo.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : lienzo.toDataURL("image/png");
  };
  try {
    let dataUrl = dibujar(LIMITES.logoLado);
    if (dataUrl === null) return { ok: false, error: "Este navegador no puede preparar el logo: prueba con otro" };
    if (pesoDe(dataUrl) > LIMITES.logoBytes) dataUrl = dibujar(384);
    if (dataUrl === null || pesoDe(dataUrl) > LIMITES.logoBytes) return { ok: false, error: LOGO_PESADO };
    return { ok: true, dataUrl };
  } finally {
    imagen.close();
  }
}

/** Solo se pinta una URL del propio logo (I10). */
function urlLogoSegura(url: string | null): string | null {
  return url && /^\/api\/logo\?perfil=[a-z0-9-]+&v=[A-Za-z0-9._-]+$/.test(url) ? url : null;
}

function Logo({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const idAyuda = useId();
  const archivo = useRef<HTMLInputElement>(null);
  const g = useGuardado();
  const url = urlLogoSegura(datos.activa.negocio.logoUrl);
  const ocupado = g.estado === "guardando";

  const elegir = async (f: File | undefined) => {
    if (!f) return;
    const preparado = await prepararLogo(f);
    if (!preparado.ok) {
      g.fallar(preparado.error);
      return;
    }
    const bien = await g.ejecutar(() => subirLogo(preparado.dataUrl));
    if (bien) void recargar();
  };

  const quitar = async () => {
    const bien = await g.ejecutar(() => subirLogo(null));
    if (bien) void recargar();
  };

  return (
    <Fila etiqueta="Logo" idEtiqueta={idEtiqueta} g={g}>
      <div className="flex flex-wrap items-center gap-3">
        {url && (
          <div className="flex items-center gap-2" aria-label="Vista previa del logo" role="group">
            <span className="flex h-14 w-[104px] items-center justify-center rounded-[10px] bg-tinta px-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Tu logo sobre fondo oscuro" className="max-h-9 max-w-full object-contain" />
            </span>
            <span className="flex h-14 w-[104px] items-center justify-center rounded-[10px] border border-linea bg-white px-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Tu logo sobre fondo claro" className="max-h-9 max-w-full object-contain" />
            </span>
          </div>
        )}
        <input
          ref={archivo}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void elegir(f);
          }}
        />
        <button type="button" onClick={() => archivo.current?.click()} disabled={ocupado} aria-describedby={[idAyuda, g.error ? g.idError : ""].filter(Boolean).join(" ")} className={BOTON}>
          {url ? "Cambiar logo" : "Subir logo"}
        </button>
        {url && (
          <button type="button" onClick={() => void quitar()} disabled={ocupado} className={`${ENLACE} ml-1`}>
            Quitar
          </button>
        )}
        {!url && <Ayuda id={idAyuda}>PNG, JPG o WebP</Ayuda>}
      </div>
    </Fila>
  );
}

// ─── Color ────────────────────────────────────────────────────────────────────────────────────────

function Color({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const g = useGuardado();
  const guardado = muestraActiva(datos.activa.negocio.color);
  const [elegido, setElegido] = useState<string | null>(guardado);
  const [enCurso, setEnCurso] = useState(false);

  useEffect(() => {
    if (!enCurso) setElegido(guardado);
  }, [guardado, enCurso]);

  const opciones = COLORES_MARCA.map((c) => ({ valor: c.color, nombre: c.nombre, color: c.color ?? VERDE_CLASICO }));

  return (
    <Fila etiqueta="Color" idEtiqueta={idEtiqueta} g={g} en="linea">
      <Muestras
        opciones={opciones}
        valor={elegido}
        idEtiqueta={idEtiqueta}
        describe={g.error ? g.idError : undefined}
        cambiar={async (v) => {
          const antes = elegido;
          setElegido(v);
          setEnCurso(true);
          const bien = await g.ejecutar(() => guardarCampo("negocio.color", colorAGuardar(v)));
          if (!bien) setElegido(antes);
          setEnCurso(false);
          if (bien) void recargar();
        }}
      />
    </Fila>
  );
}

// ─── País ─────────────────────────────────────────────────────────────────────────────────────────

const MONEDAS_LISTA = Object.keys(MONEDAS) as Moneda[];

function Pais({ datos, recargar }: PropsBloque): JSX.Element {
  const id = useId();
  const idLinea = useId();
  const g = useGuardado();
  const { regional, calendario } = datos.activa;
  const [pais, setPais] = useState(regional.pais);
  useEffect(() => setPais(regional.pais), [regional.pais]);

  const elegir = async (nuevo: string) => {
    const destino = PAISES.find((x) => x.id === nuevo);
    if (!destino) return;
    const antes = pais;
    setPais(nuevo);
    // «Otro»: la moneda, el prefijo y la hora se quedan como están y se eligen a mano debajo.
    const cambios =
      destino.id === "OTRO"
        ? { regional: { pais: destino.id } }
        : { regional: { pais: destino.id, moneda: destino.moneda, prefijo: destino.prefijo }, calendario: { zona: destino.zona } };
    const bien = await g.ejecutar(() => guardarCambiosPerfil(cambios));
    if (!bien) setPais(antes);
    else void recargar();
  };

  return (
    <>
      <Fila etiqueta="País" para={id} g={g} idAyuda={idLinea}>
        <select id={id} value={pais} onChange={(e) => void elegir(e.target.value)} aria-describedby={[idLinea, g.error ? g.idError : ""].filter(Boolean).join(" ")} className={`${SELECT} w-full max-w-[420px]`}>
          {PAISES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nombre}
            </option>
          ))}
        </select>
        <p id={idLinea} className="mt-2 text-[13px] leading-[18px] text-secundario">
          Hora: {lugarDeZona(calendario.zona)} · Moneda: {simboloMoneda(regional.moneda)} · Prefijo: +{regional.prefijo}
        </p>
      </Fila>
      {pais === "OTRO" && <MonedaYPrefijo datos={datos} recargar={recargar} />}
    </>
  );
}

function MonedaYPrefijo({ datos, recargar }: Pick<PropsBloque, "datos" | "recargar">): JSX.Element {
  const idMoneda = useId();
  const idPrefijo = useId();
  const gMoneda = useGuardado();
  const gPrefijo = useGuardado();
  const { regional } = datos.activa;
  const [moneda, setMoneda] = useState<Moneda>(regional.moneda);
  useEffect(() => setMoneda(regional.moneda), [regional.moneda]);

  return (
    <div className="grid grid-cols-2 gap-6 py-4 max-sm:grid-cols-1 max-sm:gap-4">
      <div>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={idMoneda} className="text-[14px] leading-5 font-medium">
            Moneda
          </label>
          <EstadoGuardado g={gMoneda} />
        </div>
        <select
          id={idMoneda}
          value={moneda}
          aria-describedby={gMoneda.error ? gMoneda.idError : undefined}
          onChange={async (e) => {
            const antes = moneda;
            const nueva = e.target.value as Moneda;
            setMoneda(nueva);
            const bien = await gMoneda.ejecutar(() => guardarCampo("regional.moneda", nueva));
            if (!bien) setMoneda(antes);
            else void recargar();
          }}
          className={`${SELECT} mt-2 w-full`}
        >
          {MONEDAS_LISTA.map((m) => (
            <option key={m} value={m}>
              {simboloMoneda(m)} · {MONEDAS[m].nombre} ({m})
            </option>
          ))}
        </select>
        <ErrorCampo id={gMoneda.idError} error={gMoneda.error} />
      </div>
      <div>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={idPrefijo} className="text-[14px] leading-5 font-medium">
            Prefijo
          </label>
          <EstadoGuardado g={gPrefijo} />
        </div>
        <div className="relative mt-2">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-secundario">
            +
          </span>
          <CampoTexto
            id={idPrefijo}
            valor={regional.prefijo}
            g={gPrefijo}
            max={3}
            inputMode="numeric"
            className="pl-6 tabular-nums"
            guardar={async (t) => {
              const bien = await gPrefijo.ejecutar(() => guardarCampo("regional.prefijo", t.replace(/\D/g, "")));
              if (bien) void recargar();
              return bien;
            }}
          />
        </div>
        <ErrorCampo id={gPrefijo.idError} error={gPrefijo.error} />
      </div>
    </div>
  );
}
