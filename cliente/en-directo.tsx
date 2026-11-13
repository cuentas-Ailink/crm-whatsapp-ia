"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { esEjemplo } from "@/lib/negocio";
import type { Bd } from "@/lib/tipos";
import { nombreDePila } from "@/lib/vocabulario";
import { escucharEventos } from "./datos";
import { useFrases } from "./negocio";

// «Nuevo cliente: Laura», arriba a la derecha, solo donde la llegada no se ve: en Agenda y en Ajustes
// (en Hoy lo cuenta la cabecera y en Clientes su tarjeta). Una tarjeta a la vez, 6,5 s. Salta con la
// llegada en directo y, si el directo está caído, con un cliente de verdad que aparece en los datos.
// Los ejemplos nunca avisan.

const DURACION_MS = 6_500;

interface Noticia {
  leadId: string;
  nombre: string;
  n: number;
}

export function EnDirecto({ bd, activo, abrir }: { bd: Bd; activo: boolean; abrir: (id: string) => void }) {
  const frases = useFrases();
  const [noticia, setNoticia] = useState<Noticia | null>(null);
  // Cada cliente avisa una vez, lo diga el directo o los datos. Se apunta también fuera de Agenda y
  // Ajustes, para no avisar tarde de algo que ya se vio en Hoy o en Clientes.
  const vistos = useRef<Set<string> | null>(null);
  const activoAhora = useRef(activo);
  const contador = useRef(0);
  const nodo = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    activoAhora.current = activo;
  });

  // Fuera de Agenda y Ajustes no se enseña nada.
  useEffect(() => {
    if (!activo) setNoticia(null);
  }, [activo]);

  useEffect(() => {
    const ver = (leadId: string, nombre: string) => {
      if (!vistos.current || vistos.current.has(leadId)) return;
      vistos.current.add(leadId);
      if (!activoAhora.current) return;
      contador.current += 1;
      setNoticia({ leadId, nombre, n: contador.current });
    };
    return escucharEventos((e) => {
      if (e.tipo === "llegada") ver(e.llegada.leadId, e.llegada.nombre);
    });
  }, []);

  // Los clientes que ya estaban al cargar no avisan.
  useEffect(() => {
    const reales = Object.values(bd.leads).filter((l) => !esEjemplo(l));
    if (vistos.current === null) {
      vistos.current = new Set(reales.map((l) => l.id));
      return;
    }
    for (const lead of reales) {
      if (vistos.current.has(lead.id)) continue;
      vistos.current.add(lead.id);
      if (!activoAhora.current) continue;
      contador.current += 1;
      setNoticia({ leadId: lead.id, nombre: nombreDePila(lead.nombre), n: contador.current });
    }
  }, [bd.leads]);

  const n = noticia?.n;
  useEffect(() => {
    if (n === undefined) return;
    const temporizador = setTimeout(() => setNoticia(null), DURACION_MS);
    return () => clearTimeout(temporizador);
  }, [n]);

  useLayoutEffect(() => {
    if (n === undefined || !nodo.current) return;
    if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    nodo.current.animate(
      [
        { opacity: 0, transform: "translateY(-8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 200, easing: "cubic-bezier(0, 0, 0.2, 1)" },
    );
  }, [n]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed top-6 right-6 z-[45] flex w-[min(360px,calc(100vw-3rem))] justify-end">
      {noticia && (
        <button
          ref={nodo}
          type="button"
          onClick={() => {
            setNoticia(null);
            abrir(noticia.leadId);
          }}
          className="pointer-events-auto flex max-w-full cursor-pointer items-center gap-3 rounded-[12px] border border-linea bg-white px-4 py-3 text-left text-[14px] leading-5 shadow-[0_12px_32px_rgba(0,0,0,0.14)] transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-tinta"
        >
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-marca" />
          <span className="min-w-0">
            {frases.tituloNuevoCliente}: <span className="font-medium">{noticia.nombre}</span>
          </span>
        </button>
      )}
    </div>
  );
}
