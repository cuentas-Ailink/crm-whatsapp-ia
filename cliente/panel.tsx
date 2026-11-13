"use client";

import { CalendarDays, ExternalLink, Menu, Search, SlidersHorizontal, Sun, Users, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as EventoTeclado } from "react";
import { citasDeHoy, teToca, type FilaTeToca } from "@/lib/inicio";
import { esEjemplo } from "@/lib/negocio";
import type { Bd } from "@/lib/tipos";
import type { Sustantivo } from "@/lib/vocabulario";
import { DialogoAltaCliente } from "./alta-cliente";
import { Avisos, type AvisoTeToca } from "./avisos";
import { DialogoCierre } from "./cierre";
import { confirmar, Confirmaciones } from "./confirmaciones";
import { guardarCampo } from "./configuracion/guardar";
import { Conversacion } from "./conversacion";
import { borrarEjemplos, desfaseServidor, useBd } from "./datos";
import { EnDirecto } from "./en-directo";
import { useLlegadas } from "./llegada";
import { LineaEstado, useTonoLinea } from "./linea-estado";
import { abrirCliente, cerrarCliente, irA, useUbicacion, type Vista } from "./navegacion";
import { ProveedorNegocio, useNegocio } from "./negocio";
import { Paleta, type SeccionPaleta } from "./paleta";
import { PuestaEnMarcha } from "./puesta-en-marcha";
import { ProveedorSistema } from "./sistema";
import { desbloquearSonido, sonar, useSilencio } from "./sonido";
import { VistaAgenda } from "./vista-agenda";
import { VistaConfiguracion } from "./vista-configuracion";
import { VistaHoy } from "./vista-hoy";
import { VistaLeads } from "./vista-leads";

// El marco del panel: la barra lateral con las cuatro secciones (una por pregunta del dueño: ¿qué me
// toca hoy?, ¿dónde está este cliente?, ¿qué citas tengo?, ¿cómo cambio algo?), la URL, el título de
// la pestaña, los sonidos y los avisos en directo.

const RELOJ_MS = 3_000;
/** La columna de contenido de Hoy, Agenda y Ajustes: el mismo ancho y centrada (la cabecera también). */
const COLUMNA = "mx-auto w-full max-w-[880px]";

export function Panel({ inicial }: { negocio?: string; inicial: Bd }) {
  const { bd, conectado, refrescar } = useBd(inicial);
  return (
    <ProveedorNegocio configuracion={bd.configuracion}>
      <ProveedorSistema>
        <MarcoPanel bd={bd} conectado={conectado} refrescar={refrescar} />
      </ProveedorSistema>
    </ProveedorNegocio>
  );
}

/** El último elemento con el que se ha tocado: la ficha devuelve el foco ahí al cerrarse. */
const INTERACTIVO = "button, a, [role=button], input, [tabindex]";

function MarcoPanel({ bd, conectado, refrescar }: { bd: Bd; conectado: boolean; refrescar: () => Promise<void> }) {
  const { cfg, frases, zona } = useNegocio();
  const nombre = cfg.negocio.nombre;
  const ubicacion = useUbicacion();
  const vista = ubicacion.vista;
  const [ahora, setAhora] = useState<Date | null>(null);
  const [paleta, setPaleta] = useState<{ inicial: string } | null>(null);
  const [aviso, setAviso] = useState<AvisoTeToca | null>(null);
  const [esMac, setEsMac] = useState<boolean | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);

  // La hora: null al pintar en el servidor y después de montar, cada 3 s. Lo que depende de ella espera.
  // Es la del servidor (como en la ficha): los tiempos de espera salen iguales en todas partes.
  useEffect(() => {
    const leer = () => new Date(Date.now() + desfaseServidor());
    setAhora(leer());
    const intervalo = setInterval(() => setAhora(leer()), RELOJ_MS);
    return () => clearInterval(intervalo);
  }, []);
  const lista = ahora !== null;
  const momento = ahora ?? new Date(0);

  const pausadoEn = bd.configuracion?.sistema.asistente.pausadoEn ?? null;
  const filas = useMemo<FilaTeToca[]>(
    () => (ahora ? teToca(bd, ahora, { pausadoEn, zona, frases }) : []),
    [bd, ahora, pausadoEn, zona, frases],
  );
  const esperan = filas.length;
  const citasHoy = ahora ? citasDeHoy(bd, ahora, zona) : 0;
  const llegadas = useLlegadas(bd);

  // ─── Título de la pestaña: «(2) Estudio de reformas» mientras esperan dos. ───
  // Next pone el suyo cuando llegan los metadatos (después de hidratar): si lo cambia, se vuelve a poner.
  const tituloPestana = esperan > 0 ? `(${esperan}) ${nombre}` : nombre;
  useEffect(() => {
    const aplicar = () => {
      if (document.title !== tituloPestana) document.title = tituloPestana;
    };
    aplicar();
    const observador = new MutationObserver(aplicar);
    observador.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observador.disconnect();
  }, [tituloPestana]);

  // ─── Sonido: el navegador solo deja sonar después del primer gesto. ───
  useEffect(() => {
    window.addEventListener("pointerdown", desbloquearSonido, { once: true });
    window.addEventListener("keydown", desbloquearSonido, { once: true });
    return () => {
      window.removeEventListener("pointerdown", desbloquearSonido);
      window.removeEventListener("keydown", desbloquearSonido);
    };
  }, []);

  // «llegada»: una llegada en directo termina (sale el WhatsApp o la primera respuesta). Nunca al cargar.
  const llegadasAntes = useRef<typeof llegadas.porLead | null>(null);
  useEffect(() => {
    const antes = llegadasAntes.current;
    llegadasAntes.current = llegadas.porLead;
    if (!antes) return;
    const termina = Object.values(llegadas.porLead).some((e) => e.enDirecto && e.fin !== null && antes[e.leadId]?.fin === null);
    if (termina) sonar("llegada");
  }, [llegadas.porLead]);

  // «turno» y el aviso: alguien de verdad empieza a esperarte. Los ejemplos nunca (al cargarlos
  // entrarían muchos a la vez), ni el cliente que tienes abierto (lo acabas de mover tú).
  const esperabanAntes = useRef<Set<string> | null>(null);
  const contadorAvisos = useRef(0);
  useEffect(() => {
    if (!lista) return;
    const ahoraEsperan = new Set(filas.map((f) => f.leadId));
    const antes = esperabanAntes.current;
    esperabanAntes.current = ahoraEsperan;
    if (!antes) return;
    const nuevas = filas.filter((f) => !antes.has(f.leadId) && !f.ejemplo && f.leadId !== ubicacion.cliente);
    if (nuevas.length === 0) return;
    sonar("turno");
    const masReciente = nuevas.reduce((a, b) => (b.desde > a.desde ? b : a));
    contadorAvisos.current += 1;
    setAviso({ fila: masReciente, n: contadorAvisos.current });
  }, [filas, lista, ubicacion.cliente]);

  // ─── «Sin conexión · reintentando…» y, al volver, «Conectado de nuevo». ───
  const estuvoSinConexion = useRef(false);
  useEffect(() => {
    if (!conectado) estuvoSinConexion.current = true;
    else if (estuvoSinConexion.current) {
      estuvoSinConexion.current = false;
      confirmar("Conectado de nuevo");
    }
  }, [conectado]);

  // ─── ⌘K o Ctrl K abre y cierra el buscador desde cualquier parte, también sobre la ficha. ───
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === "k") {
        evento.preventDefault();
        setPaleta((abierta) => (abierta ? null : { inicial: "" }));
      }
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setEsMac(/mac/i.test(nav.userAgentData?.platform ?? nav.platform ?? ""));
  }, []);

  // ─── El foco vuelve a lo que abrió la ficha (una tarjeta, una fila de Hoy, la Agenda, un aviso…). ───
  const ultimoTocado = useRef<Element | null>(null);
  const abridor = useRef<Element | null>(null);
  useEffect(() => {
    const apuntar = (evento: Event) => {
      const elemento = (evento.target as Element | null)?.closest?.(INTERACTIVO);
      if (elemento) ultimoTocado.current = elemento;
    };
    document.addEventListener("pointerdown", apuntar, true);
    document.addEventListener("keydown", apuntar, true);
    return () => {
      document.removeEventListener("pointerdown", apuntar, true);
      document.removeEventListener("keydown", apuntar, true);
    };
  }, []);
  const clienteAntes = useRef<string | null>(null);
  useEffect(() => {
    const antes = clienteAntes.current;
    clienteAntes.current = ubicacion.cliente;
    if (antes === null && ubicacion.cliente !== null) abridor.current = ultimoTocado.current;
    if (antes !== null && ubicacion.cliente === null) {
      const destino = abridor.current;
      abridor.current = null;
      requestAnimationFrame(() => {
        if (destino instanceof HTMLElement && destino.isConnected) destino.focus();
        else titulo.current?.focus();
      });
    }
  }, [ubicacion.cliente]);

  // ─── ?cliente= de alguien que no está (borrado o un enlace mal copiado): se limpia la URL. ───
  // Al cargar, en cuanto hay hora; al abrir uno nuevo, tras la siguiente lectura de los datos (el
  // cliente recién añadido puede tardar un momento en llegar).
  const comprobado = useRef<{ id: string; bd: Bd } | null>(null);
  const primeraComprobacion = useRef(true);
  useEffect(() => {
    if (!lista) return;
    const primera = primeraComprobacion.current;
    primeraComprobacion.current = false;
    const id = ubicacion.cliente;
    if (id === null) {
      comprobado.current = null;
      return;
    }
    if (bd.leads[id]) {
      comprobado.current = { id, bd };
      return;
    }
    if (primera || (comprobado.current?.id === id && comprobado.current.bd !== bd)) {
      comprobado.current = null;
      cerrarCliente();
      return;
    }
    if (comprobado.current?.id !== id) comprobado.current = { id, bd };
  }, [lista, ubicacion.cliente, bd]);

  // ─── «Ha llegado tu primer cliente de verdad»: una sola vez. ───
  const [primerOculto, setPrimerOculto] = useState(false);
  const leads = Object.values(bd.leads);
  const mostrarPrimero =
    !primerOculto &&
    bd.configuracion?.sistema.primerCliente.contestado === false &&
    leads.some(esEjemplo) &&
    leads.some((l) => !esEjemplo(l) && (l.origen === "formulario" || l.origen === "whatsapp"));

  const contestarPrimero = async (quitar: boolean) => {
    setPrimerOculto(true);
    if (quitar) {
      const error = await borrarEjemplos();
      if (error) {
        confirmar(error, { tono: "error" });
        setPrimerOculto(false);
        return;
      }
      confirmar("Ejemplos quitados");
    }
    const r = await guardarCampo("sistema.primerCliente.contestado", true);
    if (!r.ok) {
      confirmar(r.error, { tono: "error" });
      setPrimerOculto(false);
      return;
    }
    await refrescar();
  };

  // ─── La navegación ───
  const secciones: (SeccionPaleta & { Icono: typeof Users })[] = [
    { id: "hoy", nombre: "Hoy", Icono: Sun },
    { id: "clientes", nombre: frases.seccionClientes, Icono: Users },
    { id: "agenda", nombre: "Agenda", Icono: CalendarDays },
    { id: "configuracion", nombre: "Ajustes", Icono: SlidersHorizontal },
  ];
  const tituloVista = secciones.find((s) => s.id === vista)?.nombre ?? "Hoy";
  const cita = cfg.vocabulario.cita;

  const contador = (id: Vista) => {
    if (!lista) return null;
    if (id === "clientes" && esperan > 0) {
      return (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-atencion/15 px-1.5 text-[12px] leading-4 font-medium text-atencion-texto tabular-nums">
          <span aria-hidden>{esperan}</span>
          <span className="sr-only">{esperan === 1 ? "1 te espera" : `${esperan} te esperan`}</span>
        </span>
      );
    }
    if (id === "agenda" && citasHoy > 0) {
      return (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-white/10 px-1.5 text-[12px] leading-4 font-medium text-white/70 tabular-nums">
          <span aria-hidden>{citasHoy}</span>
          <span className="sr-only">{citasHoy === 1 ? `1 ${cita.singular} hoy` : `${citasHoy} ${cita.plural} hoy`}</span>
        </span>
      );
    }
    return null;
  };

  // Las mismas filas en la barra lateral y en el menú del móvil (allí más altas, para el dedo).
  const itemsNavegacion = (enMenu: boolean) =>
    secciones.map(({ id, nombre: nombreSeccion, Icono }) => {
      const activa = vista === id;
      return (
        <button
          key={id}
          type="button"
          onClick={() => {
            irA(id);
            if (enMenu) cerrarMenu();
          }}
          aria-current={activa ? "page" : undefined}
          className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 leading-5 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70 ${
            enMenu ? "h-12 text-[15px]" : "h-9 text-[14px]"
          } ${activa ? "bg-white/10 font-medium text-white" : "text-white/65 hover:bg-white/5 hover:text-white"}`}
        >
          <Icono aria-hidden className="size-[17px] shrink-0" strokeWidth={1.75} />
          <span className="text-left">{nombreSeccion}</span>
          {contador(id)}
        </button>
      );
    });

  const itemsOscuros = itemsNavegacion(false);

  // ─── El menú del móvil: debajo de la barra de arriba; Escape, tocar fuera o elegir lo cierran. ───
  const [menu, setMenu] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const hojaMenu = useRef<HTMLDivElement>(null);
  const idMenu = useId();
  const cerrarMenu = () => setMenu(false);
  const menuAntes = useRef(false);
  useEffect(() => {
    const antes = menuAntes.current;
    menuAntes.current = menu;
    if (menu) {
      hojaMenu.current?.querySelector<HTMLElement>("button, a")?.focus();
      const alPulsar = (evento: KeyboardEvent) => {
        if (evento.key !== "Escape") return;
        evento.preventDefault();
        setMenu(false);
      };
      document.addEventListener("keydown", alPulsar);
      return () => document.removeEventListener("keydown", alPulsar);
    }
    // Al cerrarlo, el foco vuelve al botón (salvo que otra cosa ya se lo haya llevado, como el buscador).
    if (antes) {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || document.activeElement === null) botonMenu.current?.focus();
      });
    }
  }, [menu]);
  // En una pantalla ancha no hay menú: si se ensancha con él abierto, se cierra.
  useEffect(() => {
    if (!menu) return;
    const ancho = matchMedia("(min-width: 1024px)");
    const alCambiar = () => ancho.matches && setMenu(false);
    ancho.addEventListener("change", alCambiar);
    return () => ancho.removeEventListener("change", alCambiar);
  }, [menu]);
  const linea = useTonoLinea(bd);
  const idSenales = useId();

  // El campo de la barra lateral no busca él: abre el buscador con lo escrito y se vacía.
  const [campo, setCampo] = useState("");
  const abrirPaleta = (inicial: string) => {
    setCampo("");
    setPaleta({ inicial });
  };

  const [silencio, setSilencio] = useSilencio();
  // Hoy, Agenda y Ajustes comparten una columna centrada; Clientes usa todo el ancho para el tablero.
  const columna = vista === "clientes" ? "" : COLUMNA;
  const [ranura, setRanura] = useState<HTMLDivElement | null>(null);
  const logo = cfg.negocio.logoUrl;

  const vistaDeLeads = lista && vista === "clientes" && (
    <VistaLeads
      ranura={ranura}
      bd={bd}
      ahora={momento}
      abrir={abrirCliente}
    />
  );

  const lead = ubicacion.cliente ? bd.leads[ubicacion.cliente] : undefined;

  return (
    <div className="min-h-screen bg-lienzo lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col self-start bg-[#151515] px-3 pt-4 pb-3 text-white lg:flex">
        <div className="flex items-start gap-2.5 px-1.5">
          {logo ? (
            <span className="flex h-10 max-w-[88px] shrink-0 items-center justify-center rounded-[8px] bg-white px-1.5">
              <img src={logo} alt="" className="max-h-8 w-auto object-contain" />
            </span>
          ) : (
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-marca text-[15px] font-semibold text-marca-texto">
              {nombre.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-0.5 pt-px">
            <span className="text-[14px] leading-[18px] font-medium break-words">{nombre}</span>
            <a
              href="/"
              target="_blank"
              rel="noopener"
              aria-label="Ver tu web (se abre en otra pestaña)"
              className="inline-flex w-fit items-center gap-1 rounded-[4px] text-[12px] leading-4 text-white/55 transition-colors duration-150 ease-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              Ver tu web
              <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
            </a>
          </span>
        </div>

        <div className="relative mt-5">
          <label htmlFor="buscar-barra" className="sr-only">
            {frases.buscarPlaceholder}
          </label>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-white/45" strokeWidth={1.75} />
          <input
            id="buscar-barra"
            type="search"
            autoComplete="off"
            value={campo}
            placeholder={frases.buscarPlaceholder}
            onChange={(evento) => abrirPaleta(evento.target.value)}
            onClick={() => abrirPaleta(campo)}
            onKeyDown={(evento: EventoTeclado<HTMLInputElement>) => {
              if (evento.key === "Enter") {
                evento.preventDefault();
                abrirPaleta(campo);
              }
            }}
            className={`h-9 w-full cursor-pointer rounded-[8px] border border-white/10 bg-white/5 pl-[29px] text-[12.5px] text-white ${esMac === false ? "pr-[42px]" : "pr-[36px]"} transition-colors duration-150 ease-out placeholder:text-white/45 hover:bg-white/10 focus-visible:border-white/30 focus-visible:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70 [&::-webkit-search-cancel-button]:hidden`}
          />
          {esMac !== null && (
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[5px] border border-white/15 px-1 font-sans text-[11px] leading-[18px] text-white/45">
              {esMac ? "⌘K" : "Ctrl K"}
            </kbd>
          )}
        </div>

        <nav aria-label="Secciones del panel" className="mt-4 flex flex-1 flex-col gap-0.5">
          {itemsOscuros.slice(0, 3)}
          <div className="mt-auto pt-3">{itemsOscuros[3]}</div>
        </nav>

        <div className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
          <LineaEstado bd={bd} />
          <button
            type="button"
            onClick={() => setSilencio(!silencio)}
            aria-pressed={!silencio}
            className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] leading-5 text-white/65 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70"
          >
            {silencio ? (
              <VolumeX aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            ) : (
              <Volume2 aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            )}
            Sonido de avisos
            <span aria-hidden className="ml-auto text-[12px] text-white/40">
              {silencio ? "No" : "Sí"}
            </span>
          </button>
        </div>
      </aside>

      {/* Por debajo de 1024 px, la barra lateral se queda en esta barra de arriba con un menú. */}
      <div className="sticky top-0 z-30 lg:hidden">
        <div className="flex h-14 items-center gap-1 bg-[#151515] pr-1.5 pl-4 text-white">
          {logo ? (
            <span className="flex h-9 max-w-[72px] shrink-0 items-center justify-center rounded-[8px] bg-white px-1.5">
              <img src={logo} alt="" className="max-h-7 w-auto object-contain" />
            </span>
          ) : (
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-marca text-[14px] font-semibold text-marca-texto">
              {nombre.charAt(0).toUpperCase()}
            </span>
          )}
          {/* El único sitio donde un nombre se corta: la barra tiene una línea. */}
          <span className="ml-1.5 min-w-0 flex-1 truncate text-[15px] leading-5 font-medium">{nombre}</span>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              abrirPaleta("");
            }}
            aria-label={frases.buscarPlaceholder}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/80 transition-colors duration-150 ease-out hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70"
          >
            <Search aria-hidden className="size-5" strokeWidth={1.75} />
          </button>
          <button
            ref={botonMenu}
            type="button"
            onClick={() => setMenu((abierto) => !abierto)}
            aria-label={menu ? "Cerrar el menú" : "Abrir el menú"}
            aria-expanded={menu}
            aria-controls={idMenu}
            aria-describedby={lista && (esperan > 0 || linea.tono === "error") ? idSenales : undefined}
            className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/80 transition-colors duration-150 ease-out hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70"
          >
            {menu ? <X aria-hidden className="size-5" strokeWidth={1.75} /> : <Menu aria-hidden className="size-5" strokeWidth={1.75} />}
            {/* Las dos señales que la barra lateral siempre enseña: quién te espera y si algo falla. */}
            <span id={idSenales} className="contents">
              {lista && esperan > 0 && (
                <span className="absolute top-1 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-atencion px-1 text-[11px] leading-none font-semibold text-tinta tabular-nums">
                  <span aria-hidden>{esperan}</span>
                  <span className="sr-only">{esperan === 1 ? "1 te espera" : `${esperan} te esperan`}</span>
                </span>
              )}
              {linea.tono === "error" && (
                <span className="absolute bottom-2 left-2 size-2.5 rounded-full bg-error ring-2 ring-[#151515]">
                  <span className="sr-only">{linea.texto}</span>
                </span>
              )}
            </span>
          </button>
        </div>

        {menu && (
          <>
            <div aria-hidden className="fixed inset-x-0 top-14 bottom-0 bg-black/30" onPointerDown={cerrarMenu} />
            <div
              ref={hojaMenu}
              id={idMenu}
              className="menu-movil absolute inset-x-0 top-14 flex max-h-[calc(100dvh-56px)] flex-col overflow-y-auto border-t border-white/10 bg-[#151515] px-3 pt-2 pb-3 text-white shadow-[0_16px_32px_rgba(0,0,0,0.25)]"
            >
              <nav aria-label="Secciones del panel" className="flex flex-col gap-0.5">
                {itemsNavegacion(true)}
              </nav>
              <div className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
                <a
                  href="/"
                  target="_blank"
                  rel="noopener"
                  aria-label="Ver tu web (se abre en otra pestaña)"
                  className="flex h-12 items-center gap-2.5 rounded-[8px] px-2.5 text-[15px] leading-5 text-white/65 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70"
                >
                  <ExternalLink aria-hidden className="size-[17px] shrink-0" strokeWidth={1.75} />
                  Ver tu web
                </a>
                <LineaEstado bd={bd} />
                <button
                  type="button"
                  onClick={() => setSilencio(!silencio)}
                  aria-pressed={!silencio}
                  className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-[15px] leading-5 text-white/65 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70"
                >
                  {silencio ? (
                    <VolumeX aria-hidden className="size-[17px] shrink-0" strokeWidth={1.75} />
                  ) : (
                    <Volume2 aria-hidden className="size-[17px] shrink-0" strokeWidth={1.75} />
                  )}
                  Sonido de avisos
                  <span aria-hidden className="ml-auto text-[13px] text-white/40">
                    {silencio ? "No" : "Sí"}
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sin `position`: las tarjetas del tablero miden su sitio respecto a este `main`. */}
      <main className="min-w-0">
        {/* Opaca, del color de la página: lo que pasa por debajo no se transparenta. En el móvil, bajo la barra. */}
        <header className="sticky top-0 z-20 border-b border-linea bg-lienzo max-lg:top-14">
          <div className="px-4 sm:px-6">
            <div className={`flex h-16 items-center gap-4 max-lg:h-auto max-lg:min-h-16 max-lg:flex-wrap max-lg:gap-y-2 max-lg:py-3 ${columna}`}>
              <h1 ref={titulo} tabIndex={-1} className="text-[20px] leading-6 font-medium tracking-[-0.01em] outline-none">
                {tituloVista}
              </h1>
              {/* Las acciones de la vista (en Clientes, «Publicidad · Cerrados» y «+ Cliente») van en esta fila. */}
              <div ref={setRanura} className="ml-auto flex items-center gap-4 empty:hidden max-lg:flex-wrap max-lg:justify-end max-lg:gap-y-2" />
            </div>
          </div>
        </header>

        <div className="px-4 py-6 sm:px-6">
          <div className={`flex flex-col gap-5 ${columna}`}>
            {mostrarPrimero && <PrimerCliente contestar={contestarPrimero} cliente={cfg.vocabulario.cliente} />}
            {lista && vista === "hoy" && <VistaHoy bd={bd} ahora={momento} filas={filas} llegadas={llegadas} refrescar={refrescar} />}
            {vistaDeLeads}
            {lista && vista === "agenda" && <VistaAgenda bd={bd} ahora={momento} />}
            {vista === "configuracion" && <VistaConfiguracion bd={bd} refrescar={refrescar} bloque={ubicacion.bloque} />}
          </div>
        </div>
      </main>

      {!conectado && (
        <p
          role="status"
          className="fixed top-4 left-1/2 z-[70] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-white py-2 pr-4 pl-3 text-[13px] leading-[18px] font-medium shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
        >
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-error" />
          Sin conexión · reintentando…
        </p>
      )}

      <Avisos aviso={aviso} abrir={abrirCliente} cerrar={() => setAviso(null)} />
      {lista && <EnDirecto bd={bd} activo={vista === "agenda" || vista === "configuracion"} abrir={abrirCliente} />}
      <Conversacion
        lead={lead}
        escribiendo={!!lead && !!bd.escribiendo?.includes(lead.id)}
        cerrar={cerrarCliente}
        refrescar={refrescar}
      />
      <Paleta
        abierta={paleta !== null}
        inicial={paleta?.inicial ?? ""}
        cerrar={() => setPaleta(null)}
        leads={leads}
        secciones={secciones.map(({ id, nombre: n }) => ({ id, nombre: n }))}
      />
      <Confirmaciones />
      <PuestaEnMarcha />
      <DialogoAltaCliente />
      <DialogoCierre />
    </div>
  );
}

/** «Tu primer cliente», «tu primer paciente», «tu primera clienta»: con la palabra del negocio. */
function primerDe(cliente: Sustantivo): string {
  return `${cliente.genero === "f" ? "primera" : "primer"} ${cliente.singular}`;
}

/** «Ha llegado tu primer cliente de verdad»: arriba del contenido, del mismo ancho, sin tapar nada. */
function PrimerCliente({ contestar, cliente }: { contestar: (quitar: boolean) => Promise<void>; cliente: Sustantivo }) {
  const primero = primerDe(cliente);
  return (
    <section
      aria-label={`${primero.charAt(0).toUpperCase()}${primero.slice(1)} de verdad`}
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[12px] border border-linea bg-white py-3 pr-3 pl-4"
    >
      <p className="min-w-0 text-[14px] leading-5 break-words">Ha llegado tu {primero} de verdad. ¿Quito los de ejemplo?</p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void contestar(true)}
          className="h-9 cursor-pointer max-lg:min-h-11 rounded-[8px] bg-tinta px-3.5 text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        >
          Quitar los ejemplos
        </button>
        <button
          type="button"
          onClick={() => void contestar(false)}
          className="h-9 cursor-pointer max-lg:min-h-11 rounded-[8px] border border-linea bg-white px-3.5 text-[13px] font-medium transition-colors duration-150 ease-out hover:bg-lienzo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        >
          Ahora no
        </button>
      </div>
    </section>
  );
}
