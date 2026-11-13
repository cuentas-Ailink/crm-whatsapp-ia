"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type JSX, type ReactNode, type Ref } from "react";
import { destinoSeguro } from "@/lib/acceso";
import { explicar } from "@/lib/errores";
import { confirmar } from "../confirmaciones";
import { useEstado } from "../sistema";
import { Ayuda, BOTON, BOTON_PRINCIPAL, ENTRADA, ErrorCampo } from "./controles";

// La contraseña del panel en modo servidor: la pantalla de entrar (o de crearla la primera vez) y,
// en Ajustes → Avanzado, cambiarla y cerrar la sesión. En local no se pinta nada.

const SIN_CONEXION = "Sin conexión con el servidor. Vuelve a intentarlo en un momento.";
const NO_COINCIDEN = "Las dos contraseñas no coinciden";
const DESCONOCIDO = (() => {
  const e = explicar("desconocido");
  return e.solucion ? `${e.titulo}. ${e.solucion}` : e.titulo;
})();

type Respuesta = { ok: true } | { ok: false; error: string; campo?: string };

/** Sin sesión: a entrar, volviendo luego aquí (como los envoltorios de cliente/datos.ts). */
function irAEntrar(): void {
  location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
}

/** Una petición a /api/sesion, siempre en JSON (proxy.ts exige JSON en toda escritura). */
async function pedirSesion(metodo: "POST" | "PUT" | "DELETE", cuerpo: Record<string, string>, o?: { sinRedirigir?: boolean }): Promise<Respuesta> {
  let respuesta: Response;
  try {
    respuesta = await fetch("/api/sesion", { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  } catch {
    return { ok: false, error: SIN_CONEXION };
  }
  const datos = (await respuesta.json().catch(() => null)) as { ok?: unknown; error?: unknown; codigo?: unknown; campo?: unknown } | null;
  if (respuesta.status === 401 && datos?.codigo === "sesion" && !o?.sinRedirigir) {
    irAEntrar();
    return { ok: false, error: typeof datos.error === "string" ? datos.error : DESCONOCIDO };
  }
  if (respuesta.ok && datos?.ok === true) return { ok: true };
  return {
    ok: false,
    error: typeof datos?.error === "string" ? datos.error : DESCONOCIDO,
    ...(typeof datos?.campo === "string" ? { campo: datos.campo } : {}),
  };
}

const ETIQUETA = "block text-[13px] leading-[18px] font-medium";

/** Una etiqueta, su campo de contraseña (o de código) y, si hace falta, una ayuda debajo. */
function CampoSecreto(p: {
  etiqueta: string;
  valor: string;
  cambiar: (v: string) => void;
  autoComplete: string;
  tipo?: "password" | "text";
  ayuda?: ReactNode;
  invalido?: boolean;
  enfocar?: boolean;
  campoRef?: Ref<HTMLInputElement>;
}): JSX.Element {
  const id = useId();
  const idAyuda = useId();
  return (
    <div>
      <label htmlFor={id} className={ETIQUETA}>
        {p.etiqueta}
      </label>
      <input
        id={id}
        ref={p.campoRef}
        type={p.tipo ?? "password"}
        value={p.valor}
        onChange={(e) => p.cambiar(e.target.value)}
        autoComplete={p.autoComplete}
        autoFocus={p.enfocar}
        spellCheck={false}
        autoCapitalize="off"
        aria-invalid={p.invalido || undefined}
        aria-describedby={p.ayuda ? idAyuda : undefined}
        className={`${ENTRADA} mt-1.5 w-full`}
      />
      {p.ayuda && (
        <Ayuda id={idAyuda} className="mt-1.5">
          {p.ayuda}
        </Ayuda>
      )}
    </div>
  );
}

// ─── La pantalla de entrar ────────────────────────────────────────────────────────────────────────

export function FormularioEntrar(p: {
  situacion: "entrar" | "crear" | "sin-codigo";
  negocio: string;
  logoUrl: string | null;
  volver: string | null;
  minimo: number;
}): JSX.Element {
  const [codigo, setCodigo] = useState("");
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{ texto: string; campo?: string } | null>(null);
  const refClave = useRef<HTMLInputElement>(null);
  const refRepetida = useRef<HTMLInputElement>(null);
  const crear = p.situacion === "crear";

  // Con la cookie ya puesta (un enlace desde otra web llega sin ella), al sitio de antes.
  useEffect(() => {
    let vivo = true;
    fetch("/api/sesion", { cache: "no-store" })
      .then((r) => {
        if (vivo && r.status === 200) location.replace(destinoSeguro(p.volver));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [p.volver]);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (enviando) return;
    if (crear && clave !== repetida) {
      setError({ texto: NO_COINCIDEN, campo: "repetida" });
      refRepetida.current?.focus();
      return;
    }
    setError(null);
    setEnviando(true);
    const r = await pedirSesion("POST", crear ? { codigo, clave } : { clave }, { sinRedirigir: true });
    if (r.ok) {
      location.replace(destinoSeguro(p.volver));
      return;
    }
    setEnviando(false);
    setError({ texto: r.error, campo: r.campo });
    if (r.campo === "clave" || !crear) refClave.current?.focus();
  };

  const titulo = p.situacion === "entrar" ? "Entrar" : "Crea la contraseña del panel";

  return (
    <div className="w-full max-w-[380px] rounded-[14px] border border-linea bg-white p-6 sm:p-8">
      <div className="mb-5">
        {p.logoUrl ? (
          <img src={p.logoUrl} alt={p.negocio} className="block h-8 max-w-[180px] object-contain" />
        ) : (
          <p className="text-[15px] leading-5 font-medium break-words text-secundario">{p.negocio}</p>
        )}
        <h1 className="mt-3 text-[22px] leading-7 font-medium tracking-[-0.01em] text-balance">{titulo}</h1>
      </div>

      {p.situacion === "sin-codigo" ? (
        <p className="text-[14px] leading-[21px] text-tinta">Pide el código de alta a quien instaló el CRM</p>
      ) : (
        <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
          {crear && (
            <CampoSecreto
              etiqueta="Código de alta"
              tipo="text"
              valor={codigo}
              cambiar={setCodigo}
              autoComplete="one-time-code"
              ayuda="Lo ha escrito el instalador en la terminal"
              enfocar
            />
          )}
          <CampoSecreto
            etiqueta="Contraseña"
            valor={clave}
            cambiar={setClave}
            autoComplete={crear ? "new-password" : "current-password"}
            ayuda={crear ? `Al menos ${p.minimo} caracteres` : undefined}
            invalido={error?.campo === "clave"}
            enfocar={!crear}
            campoRef={refClave}
          />
          {crear && (
            <CampoSecreto
              etiqueta="Repite la contraseña"
              valor={repetida}
              cambiar={setRepetida}
              autoComplete="new-password"
              invalido={error?.campo === "repetida"}
              campoRef={refRepetida}
            />
          )}
          {error && (
            <p role="alert" className="text-[13px] leading-[18px] text-error-texto">
              {error.texto}
            </p>
          )}
          <button type="submit" disabled={enviando} className={`${BOTON_PRINCIPAL} h-10 w-full text-[14px]`}>
            {enviando && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />}
            {enviando ? (crear ? "Creando…" : "Entrando…") : crear ? "Crear y entrar" : "Entrar"}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Ajustes → Avanzado ───────────────────────────────────────────────────────────────────────────

export function Acceso(): JSX.Element | null {
  const estado = useEstado();
  if (estado?.modo !== "servidor") return null;
  return <ContrasenaDelPanel />;
}

function ContrasenaDelPanel(): JSX.Element {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState<{ texto: string; campo?: string } | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const [errorSalir, setErrorSalir] = useState<string | null>(null);
  const refActual = useRef<HTMLInputElement>(null);
  const refNueva = useRef<HTMLInputElement>(null);
  const refRepetida = useRef<HTMLInputElement>(null);

  const cambiar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (cambiando) return;
    if (nueva !== repetida) {
      setError({ texto: NO_COINCIDEN, campo: "repetida" });
      refRepetida.current?.focus();
      return;
    }
    setError(null);
    setCambiando(true);
    const r = await pedirSesion("PUT", { actual, nueva });
    setCambiando(false);
    if (!r.ok) {
      const campo = r.campo === "nueva" ? "nueva" : r.error === "La contraseña actual no es correcta" ? "actual" : undefined;
      setError({ texto: r.error, campo });
      (campo === "nueva" ? refNueva : refActual).current?.focus();
      return;
    }
    setActual("");
    setNueva("");
    setRepetida("");
    confirmar("Contraseña cambiada");
  };

  const salir = async () => {
    setSaliendo(true);
    setErrorSalir(null);
    const r = await pedirSesion("DELETE", {});
    if (r.ok) {
      location.assign("/entrar");
      return;
    }
    setSaliendo(false);
    setErrorSalir(r.error);
  };

  return (
    <div className="py-5">
      <h3 className="text-[15px] leading-5 font-medium">Contraseña del panel</h3>
      <form onSubmit={cambiar} noValidate className="mt-3 flex max-w-[420px] flex-col gap-3">
        <h4 className="text-[13px] leading-[18px] font-medium text-secundario">Cambiar la contraseña</h4>
        <CampoSecreto etiqueta="Contraseña actual" valor={actual} cambiar={setActual} autoComplete="current-password" invalido={error?.campo === "actual"} campoRef={refActual} />
        <CampoSecreto etiqueta="Contraseña nueva" valor={nueva} cambiar={setNueva} autoComplete="new-password" invalido={error?.campo === "nueva"} campoRef={refNueva} />
        <CampoSecreto
          etiqueta="Repite la contraseña nueva"
          valor={repetida}
          cambiar={setRepetida}
          autoComplete="new-password"
          invalido={error?.campo === "repetida"}
          campoRef={refRepetida}
        />
        <Ayuda>Al cambiarla se cierra la sesión en los demás dispositivos.</Ayuda>
        {error && (
          <p role="alert" className="text-[13px] leading-[18px] text-error-texto">
            {error.texto}
          </p>
        )}
        <div>
          <button type="submit" disabled={cambiando} className={BOTON_PRINCIPAL}>
            {cambiando ? "Cambiando…" : "Cambiar la contraseña"}
          </button>
        </div>
      </form>
      <div className="mt-5">
        <button type="button" onClick={() => void salir()} disabled={saliendo} className={BOTON}>
          {saliendo ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
        <ErrorCampo error={errorSalir} />
      </div>
    </div>
  );
}
