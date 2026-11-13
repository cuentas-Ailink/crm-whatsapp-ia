"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useId, useState, type JSX } from "react";
import { LIMITES, mensajeWeb, type EntradaWeb } from "@/lib/configuracion";
import { NO_DISPONIBLE_EN_PRUEBA } from "@/lib/modo-prueba-reglas";
import { irA } from "../navegacion";
import { useEstado } from "../sistema";
import { guardarCampo } from "./guardar";
import { Ayuda, CampoTexto, ENLACE, ErrorCampo, FOCO, Fila, useGuardado } from "./controles";
import type { PropsBloque } from "./negocio";

// Bloque «Tu web»: cómo te escriben tus clientes desde la portada. Con el botón de WhatsApp (lo
// recomendado) escribe primero el cliente, con un mensaje ya puesto, y no hace falta ningún mensaje
// aprobado por Meta; con el formulario escribes tú primero y sí hace falta.

const OPCIONES: { valor: EntradaWeb; texto: string }[] = [
  { valor: "whatsapp", texto: "Botón de WhatsApp (recomendado)" },
  { valor: "formulario", texto: "Formulario" },
];

export function BloqueWeb(p: PropsBloque): JSX.Element {
  return (
    <>
      <Entrada {...p} />
      {p.datos.activa.web.entrada === "whatsapp" && <Mensaje {...p} />}
      <div className="py-4">
        <a href="/" target="_blank" rel="noopener noreferrer" className={`${ENLACE} inline-flex items-center gap-1.5`}>
          Ver tu web
          <ExternalLink aria-hidden className="size-3.5" strokeWidth={2} />
        </a>
      </div>
    </>
  );
}

function Entrada({ datos, recargar }: PropsBloque): JSX.Element {
  const idEtiqueta = useId();
  const nombre = useId();
  const g = useGuardado();
  const prueba = useEstado()?.modoWhatsApp === "prueba";
  const guardada = datos.activa.web.entrada;
  // Se marca al momento; si no se puede guardar, vuelve a lo que había.
  const [elegida, setElegida] = useState<EntradaWeb>(guardada);
  useEffect(() => setElegida(guardada), [guardada]);

  const cambiar = async (valor: EntradaWeb) => {
    if (valor === elegida) return;
    const antes = elegida;
    setElegida(valor);
    const bien = await g.ejecutar(() => guardarCampo("web.entrada", valor));
    if (bien) void recargar();
    else setElegida(antes);
  };

  return (
    <Fila etiqueta="Cómo te escriben desde tu web" idEtiqueta={idEtiqueta} g={g}>
      <div role="radiogroup" aria-labelledby={idEtiqueta} className="flex flex-col gap-1">
        {OPCIONES.map((o) => (
          <label key={o.valor} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[14px] leading-5 text-tinta max-lg:min-h-11">
            <input
              type="radio"
              name={nombre}
              value={o.valor}
              checked={elegida === o.valor}
              onChange={() => void cambiar(o.valor)}
              className={`size-4 cursor-pointer accent-tinta ${FOCO}`}
            />
            {o.texto}
          </label>
        ))}
      </div>
      {elegida === "formulario" && prueba && (
        <Ayuda className="mt-2">{NO_DISPONIBLE_EN_PRUEBA}: el formulario necesita WhatsApp oficial. En modo prueba usa el botón de WhatsApp.</Ayuda>
      )}
      {elegida === "formulario" && !prueba && (
        <Ayuda className="mt-2">
          El formulario necesita un mensaje aprobado por Meta para escribir tú primero.{" "}
          <button type="button" onClick={() => irA("configuracion", { bloque: "whatsapp" })} className={ENLACE}>
            Ir a Conexiones
          </button>
        </Ayuda>
      )}
    </Fila>
  );
}

function Mensaje({ datos, recargar }: PropsBloque): JSX.Element {
  const id = useId();
  const idAyuda = useId();
  const g = useGuardado();
  const guardado = datos.activa.web.mensaje;
  const [texto, setTexto] = useState(guardado);
  useEffect(() => setTexto(guardado), [guardado]);
  const vista = mensajeWeb({ web: { entrada: "whatsapp", mensaje: texto.trim() || guardado }, negocio: datos.activa.negocio });

  return (
    <Fila etiqueta="Mensaje que se escribe solo" para={id} g={g} sinError>
      <CampoTexto
        id={id}
        idAyuda={idAyuda}
        valor={guardado}
        g={g}
        max={LIMITES.mensajeWeb}
        alCambiar={setTexto}
        guardar={async (t) => {
          const bien = await g.ejecutar(() => guardarCampo("web.mensaje", t));
          if (bien) void recargar();
          return bien;
        }}
      />
      <ErrorCampo id={g.idError} error={g.error} />
      <Ayuda id={idAyuda} className="mt-2">
        Al pulsar el botón se abre WhatsApp con: «{vista}»
      </Ayuda>
      <Ayuda className="mt-1">Puedes poner {"{negocio}"} y se cambia por el nombre de tu negocio.</Ayuda>
    </Fila>
  );
}

