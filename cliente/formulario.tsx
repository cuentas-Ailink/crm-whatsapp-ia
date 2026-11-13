"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Portada } from "@/lib/configuracion";
import { type CodigoError, explicar } from "@/lib/errores";
import { formatoTelefono, normalizarTelefono } from "@/lib/regional";
import { alReiniciar } from "./datos";

const ESTILO_CAMPO =
  "campo-formulario block h-[52px] rounded-[14px] border border-white/25 bg-white/10 px-3.5 pt-[7px] transition-colors duration-200 ease-out focus-within:border-white/70";
const ESTILO_ETIQUETA = "block text-[10px] leading-3 font-medium tracking-[0.08em] text-white/70 uppercase";
const ESTILO_INPUT =
  "mt-0.5 block w-full appearance-none bg-transparent text-[15px] leading-5 text-white outline-none placeholder:text-white/45";

const FALTA_ACEPTAR = "Marca la casilla para que podamos escribirte por WhatsApp.";
const SIN_CONEXION = "No hemos podido enviarte el WhatsApp. Inténtalo de nuevo en un momento.";
const ENVIANDO = "Enviando tu WhatsApp…";
const PARAMETROS_FUENTE = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "gclid", "fbclid"] as const;

type Campo = "nombre" | "telefono" | "email" | "zona" | "consentimiento";
interface Aviso {
  texto: string;
  detalle?: string;
}
interface RespuestaLead {
  ok?: boolean;
  error?: string;
  codigo?: CodigoError;
  campo?: string;
  causa?: string;
}

const conNegocio = (texto: string, negocio: string) => texto.replaceAll("{negocio}", negocio);

/** De dónde viene la visita: los parámetros de la dirección, recortados. Sin ninguno, nada. */
function leerFuente(): Record<string, string> | undefined {
  const parametros = new URLSearchParams(window.location.search);
  const fuente: Record<string, string> = {};
  for (const clave of PARAMETROS_FUENTE) {
    const valor = parametros.get(clave)?.trim().slice(0, 100);
    if (valor) fuente[clave] = valor;
  }
  return Object.keys(fuente).length > 0 ? fuente : undefined;
}

/** El error de /lead, para quien rellena el formulario. En el ordenador del CRM llega la causa real. */
function avisoDe(datos: RespuestaLead): Aviso {
  if (datos.causa) {
    const conSolucion = datos.codigo && datos.codigo !== "meta.otro" && datos.codigo !== "desconocido";
    return { texto: datos.causa, ...(conSolucion ? { detalle: explicar(datos.codigo as CodigoError).solucion } : {}) };
  }
  return { texto: datos.error || SIN_CONEXION };
}

export function Formulario(p: { textos: Omit<Portada["formulario"], "zona">; negocio: string; prefijo: string; digitos: number; zona: string | null }) {
  const { textos, negocio, prefijo, digitos, zona: etiquetaZona } = p;
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [zona, setZona] = useState("");
  // La trampa para robots: nadie la ve ni llega a ella con el teclado. Si llega rellena, no se envía nada.
  const [trampa, setTrampa] = useState("");
  // Empieza como diga la portada, que es «sin marcar» en todos los sectores: el consentimiento solo vale si lo marca la persona.
  const [acepta, setAcepta] = useState(textos.marcado);
  const [estado, setEstado] = useState<"editando" | "enviando" | "enviado">("editando");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fuente = useRef<Record<string, string> | undefined>(undefined);
  const marcado = useRef(textos.marcado);
  const campos = {
    nombre: useRef<HTMLInputElement>(null),
    telefono: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    zona: useRef<HTMLInputElement>(null),
    consentimiento: useRef<HTMLInputElement>(null),
  } satisfies Record<Campo, unknown>;
  const idCifras = useId();

  useEffect(() => {
    marcado.current = textos.marcado;
  }, [textos.marcado]);

  useEffect(() => {
    fuente.current = leerFuente();
  }, []);

  // El reinicio limpia también esta pestaña, para que la siguiente prueba empiece de cero.
  useEffect(
    () =>
      alReiniciar(() => {
        setNombre("");
        setTelefono("");
        setEmail("");
        setZona("");
        setTrampa("");
        setAcepta(marcado.current);
        setAviso(null);
        setEstado("editando");
        history.replaceState(null, "", "/");
        window.scrollTo({ top: 0, behavior: "instant" });
      }),
    [],
  );

  // Mientras se escribe, tal cual (no pelea con el autocompletado); al salir, con el formato de su país.
  const alSalirDelTelefono = () => {
    const numero = normalizarTelefono(telefono, prefijo);
    if (numero) setTelefono(formatoTelefono(`+${numero}`, prefijo));
  };

  const alMarcar = (evento: ChangeEvent<HTMLInputElement>) => {
    setAcepta(evento.target.checked);
    if (evento.target.checked && aviso?.texto === FALTA_ACEPTAR) setAviso(null);
  };

  // Sin la casilla marcada, el navegador no envía. En vez de su globo, que sale en el idioma del
  // navegador, el aviso va al recuadro de error, como los demás.
  const alFaltarConsentimiento = (evento: FormEvent<HTMLInputElement>) => {
    evento.preventDefault();
    evento.currentTarget.focus();
    setAviso({ texto: FALTA_ACEPTAR });
  };

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (estado !== "editando") return;
    setAviso(null);
    setEstado("enviando");
    let datos: RespuestaLead;
    let correcta = false;
    try {
      const respuesta = await fetch("/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          telefono,
          email,
          zona,
          consentimiento: acepta,
          web: trampa,
          ...(fuente.current ? { fuente: fuente.current } : {}),
        }),
      });
      correcta = respuesta.ok;
      datos = (await respuesta.json()) as RespuestaLead;
    } catch {
      setAviso({ texto: SIN_CONEXION });
      setEstado("editando");
      return;
    }
    if (correcta && datos.ok) {
      setEstado("enviado");
      return;
    }
    setAviso(avisoDe(datos));
    setEstado("editando");
    const campo = datos.campo && Object.hasOwn(campos, datos.campo) ? campos[datos.campo as Campo].current : null;
    campo?.focus();
  };

  const enviado = estado === "enviado";
  const enviando = estado === "enviando";
  const privacidad = textos.urlPrivacidad && /^https?:\/\//.test(textos.urlPrivacidad) ? textos.urlPrivacidad : null;
  const pistaCifras = digitos > 0 ? `${digitos} cifras. De otro país: con + y su prefijo.` : undefined;

  return (
    <div className="cristal-formulario relative w-full max-w-[380px] p-6 lg:w-[380px] lg:shrink-0">
      <form
        onSubmit={enviar}
        aria-hidden={enviado}
        className={`flex flex-col gap-3 transition-opacity duration-300 ease-out ${enviado ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        <div className="mb-1 flex flex-wrap gap-2">
          {textos.chips.map((chip, i) => (
            <span key={i} className="rounded-full border border-white/40 px-3 py-1 text-[12px]">
              {chip}
            </span>
          ))}
        </div>

        <label className={ESTILO_CAMPO}>
          <span className={ESTILO_ETIQUETA}>Nombre</span>
          <input
            ref={campos.nombre}
            required
            name="demo-nombre"
            autoComplete="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={ESTILO_INPUT}
          />
        </label>

        <label className={ESTILO_CAMPO}>
          <span className={ESTILO_ETIQUETA}>Teléfono (WhatsApp)</span>
          <input
            ref={campos.telefono}
            required
            type="tel"
            name="demo-movil"
            inputMode="tel"
            autoComplete="tel"
            placeholder={`+${prefijo} …`}
            title={pistaCifras}
            aria-describedby={pistaCifras ? idCifras : undefined}
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            onBlur={alSalirDelTelefono}
            className={`${ESTILO_INPUT} tabular-nums`}
          />
          {pistaCifras && (
            <span id={idCifras} className="sr-only">
              {pistaCifras}
            </span>
          )}
        </label>

        <label className={ESTILO_CAMPO}>
          <span className={ESTILO_ETIQUETA}>Email (opcional)</span>
          <input
            ref={campos.email}
            type="email"
            name="demo-correo"
            autoComplete="email"
            maxLength={120}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={ESTILO_INPUT}
          />
        </label>

        {etiquetaZona !== null && (
          <label className={ESTILO_CAMPO}>
            <span className={ESTILO_ETIQUETA}>{etiquetaZona} (opcional)</span>
            <input
              ref={campos.zona}
              name="demo-zona"
              autoComplete="off"
              maxLength={60}
              value={zona}
              onChange={(e) => setZona(e.target.value)}
              className={ESTILO_INPUT}
            />
          </label>
        )}

        {/* Fuera de la pantalla y fuera del tabulador. Su nombre no es ninguno que el navegador autocomplete. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <input type="text" name="demo-trampa" tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} />
        </div>

        <label className="flex cursor-pointer items-start gap-2 pt-1 text-[12px] leading-4 text-white/85">
          <input
            ref={campos.consentimiento}
            type="checkbox"
            required
            checked={acepta}
            onChange={alMarcar}
            onInvalid={alFaltarConsentimiento}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="mt-px flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-white/60 transition-colors duration-200 ease-out peer-checked:bg-white peer-focus-visible:outline-2 peer-focus-visible:outline-white"
          >
            {acepta && <Check className="size-3 text-[#111]" strokeWidth={2.5} />}
          </span>
          <span>
            {conNegocio(textos.consentimiento, negocio)}
            {privacidad && (
              <>
                {" "}
                {/* Un enlace dentro de la etiqueta abre la política sin marcar la casilla. */}
                <a
                  href={privacidad}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="whitespace-nowrap underline decoration-white/50 underline-offset-2 transition-colors duration-200 ease-out hover:decoration-white"
                >
                  Política de privacidad
                </a>
              </>
            )}
          </span>
        </label>

        {aviso && (
          <div role="alert" className="rounded-xl bg-error/90 px-3 py-2 text-[13px] leading-[18px]">
            <p>{aviso.texto}</p>
            {aviso.detalle && <p className="mt-1 text-[12px] leading-4 opacity-90">{aviso.detalle}</p>}
          </div>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="mt-1 flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-[#111] transition-colors duration-200 ease-out hover:bg-[#e4e2de] disabled:cursor-wait"
        >
          {enviando ? (
            <>
              <LoaderCircle aria-hidden className="size-5 animate-spin" strokeWidth={1.5} />
              {ENVIANDO}
            </>
          ) : (
            textos.boton
          )}
        </button>
      </form>

      <div
        role="status"
        aria-hidden={!enviado}
        className={`absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center transition-opacity duration-300 ease-out ${enviado ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <span className="mb-2 flex size-14 items-center justify-center rounded-full bg-white text-[#111]">
          <Check className="size-6" strokeWidth={1.5} />
        </span>
        <p className="text-[32px] leading-[1.1] font-light tracking-[-0.02em]">{conNegocio(textos.enviado[0], negocio)}</p>
        <p className="max-w-[260px] text-[15px] leading-[22px] text-balance opacity-85">{conNegocio(textos.enviado[1], negocio)}</p>
      </div>
    </div>
  );
}
