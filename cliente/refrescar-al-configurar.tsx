"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { alCambiarConfiguracion } from "./datos";

const CADA_MS = 3_000;

/**
 * Vuelve a pintar la portada cuando cambia la configuración: al instante si se guardó en otra pestaña
 * de este navegador, y en 3 s si cambió por otro camino (configurar, otro ordenador, un archivo copiado).
 * Solo pregunta por la firma, que sale de la caché; nunca abre el canal de eventos del panel (F27).
 */
export function RefrescarAlConfigurar({ firma }: { firma: string }) {
  const router = useRouter();
  const vista = useRef(firma);

  // Tras cada refresco llega la firma nueva: así un cambio refresca una sola vez.
  useEffect(() => {
    vista.current = firma;
  }, [firma]);

  useEffect(() => alCambiarConfiguracion(() => router.refresh()), [router]);

  useEffect(() => {
    let vivo = true;
    let pidiendo = false;
    let reloj: ReturnType<typeof setInterval> | undefined;

    const mirar = async () => {
      if (pidiendo || document.visibilityState !== "visible") return;
      pidiendo = true;
      try {
        const respuesta = await fetch("/api/estado?solo=firma", { cache: "no-store" });
        if (!respuesta.ok) return;
        const { firma: nueva } = (await respuesta.json()) as { firma?: unknown };
        if (!vivo || typeof nueva !== "string" || nueva === vista.current) return;
        vista.current = nueva;
        router.refresh();
      } catch {
        // Sin conexión: lo vuelve a intentar en el siguiente tic.
      } finally {
        pidiendo = false;
      }
    };

    const arrancar = () => {
      if (reloj === undefined) reloj = setInterval(mirar, CADA_MS);
    };
    const parar = () => {
      clearInterval(reloj);
      reloj = undefined;
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") {
        void mirar();
        arrancar();
      } else {
        parar();
      }
    };

    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => {
      vivo = false;
      parar();
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [router]);

  return null;
}
