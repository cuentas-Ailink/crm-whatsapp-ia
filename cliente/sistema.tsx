"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import type { EstadoApp, EstadoConexiones } from "@/lib/api-tipos";
import { alPedirRefrescoConexiones, crearRefrescoConexiones, motivoDeEvento, type RefrescoConexiones } from "@/lib/refresco-conexiones";
import { alCambiarConfiguracion, escucharEventos } from "./datos";

// El estado de la aplicación (GET /api/estado) y el de las conexiones (GET /api/sistema) para todo el panel.
// /api/estado: al montar, cada 30 s con la pestaña visible, al volver a ella y cuando cambia el sistema o la
// configuración. /api/sistema: solo mientras algún componente usa useConexiones(): al empezar, cada 5 min
// y al momento cuando algo lo cambia (lib/refresco-conexiones.ts): el fin de la puesta en marcha,
// «Conectar», una clave guardada, el modo prueba o un cambio «sistema» del servidor.

const ESTADO_MS = 30_000;

/** Sin sesión en modo servidor: a la pantalla de entrar, volviendo luego a donde estaba. */
function irAEntrar(): void {
  location.assign("/entrar?volver=" + encodeURIComponent(location.pathname + location.search + location.hash));
}

/** Lo que responde el servidor, sin revisar la forma; undefined si no hay nada que guardar. */
async function pedir<T>(url: string): Promise<T | undefined> {
  try {
    const respuesta = await fetch(url, { cache: "no-store" });
    const datos = (await respuesta.json().catch(() => undefined)) as unknown;
    if (respuesta.status === 401 && (datos as { codigo?: unknown } | undefined)?.codigo === "sesion") {
      irAEntrar();
      return undefined;
    }
    if (!respuesta.ok || datos === undefined) return undefined;
    return datos as T;
  } catch {
    return undefined; // Sin conexión: se queda lo último que había.
  }
}

interface ValorSistema {
  estado: EstadoApp | null;
  conexiones: EstadoConexiones | null;
  suscribir: () => () => void;
  comprobar: (forzar?: boolean) => Promise<void>;
}

const Contexto = createContext<ValorSistema | null>(null);

export function ProveedorSistema(p: { children: ReactNode }): JSX.Element {
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [conexiones, setConexiones] = useState<EstadoConexiones | null>(null);
  const ultimoEstado = useRef(0);
  const ultimaConexion = useRef(0);

  const cargarEstado = useCallback(async () => {
    const peticion = ++ultimoEstado.current;
    const datos = await pedir<EstadoApp>("/api/estado");
    // Si mientras tanto se ha pedido otra vez, esta respuesta ya está vieja.
    if (datos !== undefined && peticion === ultimoEstado.current) setEstado(datos);
  }, []);

  const comprobar = useCallback(async (forzar?: boolean) => {
    const peticion = ++ultimaConexion.current;
    const datos = await pedir<EstadoConexiones>(forzar ? "/api/sistema?forzar=1" : "/api/sistema");
    if (datos !== undefined && peticion === ultimaConexion.current) setConexiones(datos);
  }, []);

  useEffect(() => {
    void cargarEstado();
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") void cargarEstado();
    }, ESTADO_MS);
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") void cargarEstado();
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    const dejarEventos = escucharEventos((e) => {
      if (e.tipo === "cambio" && (e.cambio.tipo === "sistema" || e.cambio.tipo === "configuracion")) void cargarEstado();
    });
    const dejarConfiguracion = alCambiarConfiguracion(() => void cargarEstado());
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      dejarEventos();
      dejarConfiguracion();
    };
  }, [cargarEstado]);

  // /api/sistema solo se pide mientras alguien lo mira: la primera vez con el primer suscriptor, de
  // fondo cada 5 min y, al momento, con cada aviso de esta pestaña o del servidor (juntos si llegan seguidos).
  const [refresco] = useState<RefrescoConexiones>(() =>
    crearRefrescoConexiones({ comprobar, visible: () => document.visibilityState === "visible" }),
  );
  const suscribir = refresco.suscribir;

  useEffect(() => {
    const dejarAvisos = alPedirRefrescoConexiones((motivo) => refresco.pedir(motivo));
    const dejarEventos = escucharEventos((e) => {
      const motivo = motivoDeEvento(e);
      if (motivo) refresco.pedir(motivo);
    });
    return () => {
      dejarAvisos();
      dejarEventos();
      refresco.parar();
    };
  }, [refresco]);

  const valor = useMemo(() => ({ estado, conexiones, suscribir, comprobar }), [estado, conexiones, suscribir, comprobar]);
  return <Contexto.Provider value={valor}>{p.children}</Contexto.Provider>;
}

export function useEstado(): EstadoApp | null {
  return useContext(Contexto)?.estado ?? null;
}

const SIN_PROVEEDOR: { estado: EstadoConexiones | null; comprobar(forzar?: boolean): Promise<void> } = {
  estado: null,
  comprobar: async () => {},
};

export function useConexiones(): { estado: EstadoConexiones | null; comprobar(forzar?: boolean): Promise<void> } {
  const contexto = useContext(Contexto);
  const suscribir = contexto?.suscribir;
  useEffect(() => suscribir?.(), [suscribir]);
  const conexiones = contexto?.conexiones ?? null;
  const comprobar = contexto?.comprobar;
  return useMemo(() => (comprobar ? { estado: conexiones, comprobar } : SIN_PROVEEDOR), [conexiones, comprobar]);
}
