import type { CSSProperties } from "react";
import { MarcaNegocio } from "@/app/marca";
import { BarraAlBajar } from "@/cliente/barra-portada";
import { ConversacionEjemplo, type MensajeEjemplo } from "@/cliente/conversacion-ejemplo";
import { EnlaceFormulario } from "@/cliente/enlace-formulario";
import { verHuecos } from "@/lib/agenda";
import { type ConfiguracionResuelta, FOTOS_PORTADA, type FotoPortada, mensajeWeb, type Portada, textoPlantilla, textosDeEntrada } from "@/lib/configuracion";
import type { Hueco } from "@/lib/tipos";

// Lo que hay debajo de la primera pantalla, pintado con la portada del negocio. La galería y el
// «Estudio» solo salen si el negocio los trae; «Cómo funciona» sale siempre. Ningún texto promete
// nada que el asistente no haga: ni precios, ni plazos, ni recordatorios.

export type IdSeccion = "galeria" | "estudio" | "proceso";

/** Las secciones que se pintan, en orden y numeradas desde «02 /» (la primera pantalla es «01 /»). */
export function seccionesVisibles(p: Portada): { id: IdSeccion; nombre: string; numero: string }[] {
  const visibles: { id: IdSeccion; nombre: string }[] = [];
  if (p.galeria && p.galeria.tarjetas.length > 0) visibles.push({ id: "galeria", nombre: "Galería" });
  if (p.estudio) visibles.push({ id: "estudio", nombre: "Estudio" });
  visibles.push({ id: "proceso", nombre: p.proceso.titular });
  return visibles.map((s, i) => ({ ...s, numero: `${String(i + 2).padStart(2, "0")} /` }));
}

/** Solo las fotos de la lista; cualquier otra ruta se ignora (I10). */
export function fotoValida(foto: string | null | undefined): FotoPortada | null {
  return foto && (FOTOS_PORTADA as readonly string[]).includes(foto) ? (foto as FotoPortada) : null;
}

/** Una dirección de privacidad solo si es http(s). */
export function urlPrivacidad(url: string | null | undefined): string | null {
  return url && /^https?:\/\//.test(url) ? url : null;
}

/** El fondo oscuro con el color de marca, para la primera pantalla y «Cómo funciona» sin foto. */
const DEGRADADO_MARCA: CSSProperties = {
  backgroundImage:
    "radial-gradient(ellipse 90% 75% at 85% 15%, color-mix(in oklab, var(--color-marca) 55%, transparent) 0%, transparent 70%)",
};

export function FondoMarca() {
  return (
    <div aria-hidden className="absolute inset-0 bg-[#141414]">
      <div className="absolute inset-0" style={DEGRADADO_MARCA} />
    </div>
  );
}

const ESTILO_SECCION = "px-5 py-20 lg:px-12 lg:py-28";
const ESTILO_TITULAR = "mt-4 text-[clamp(40px,5vw,72px)] leading-[0.95] font-light tracking-[-0.03em] text-balance uppercase hyphens-auto";

/** Los enlaces a las secciones que hay; «Contacto» va aparte, a la derecha. */
export function MenuSecciones({ portada, className, enlace }: { portada: Portada; className: string; enlace: string }) {
  return (
    <nav aria-label="Secciones" className={className}>
      {seccionesVisibles(portada).map(({ id, nombre }) => (
        <a key={id} href={`#${id}`} className={enlace}>
          {nombre}
        </a>
      ))}
    </nav>
  );
}

function Barra({ config }: { config: ConfiguracionResuelta }) {
  // Fija arriba (con su margen) y casi opaca: se lee igual sobre una foto oscura que sobre el fondo claro.
  return (
    <BarraAlBajar className="barra-portada fixed inset-x-3 top-3 z-30 flex min-h-14 items-center justify-between gap-2 px-3 py-2 text-tinta sm:gap-4 sm:px-5 lg:inset-x-12 lg:grid lg:grid-cols-[1fr_auto_1fr]">
      <span className="hidden min-w-0 sm:flex">
        <MarcaNegocio nombre={config.negocio.nombre} logoUrl={config.negocio.logoUrl} fondo="claro" />
      </span>
      <MenuSecciones
        portada={config.portada}
        className="etiqueta-mono enlaces-barra flex gap-8"
        enlace="opacity-75 transition-opacity duration-200 ease-out hover:opacity-100"
      />
      <EnlaceFormulario className="shrink-0 justify-self-end rounded-full border border-tinta/40 px-3 py-1.5 text-[13px] transition-colors duration-200 ease-out hover:bg-tinta/5 sm:px-4">
        Contacto
      </EnlaceFormulario>
    </BarraAlBajar>
  );
}

function Galeria({ galeria, numero }: { galeria: NonNullable<Portada["galeria"]>; numero: string }) {
  return (
    <section id="galeria" className={ESTILO_SECCION}>
      <div className="relative">
        <header className="mb-10 lg:absolute lg:top-0 lg:left-0 lg:mb-0 lg:w-[calc((100%-3rem)/3)]">
          <p className="etiqueta-mono text-tinta/70">{numero} Galería</p>
          <h2 className={ESTILO_TITULAR}>{galeria.titular}</h2>
        </header>

        <ul className="obras grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 lg:gap-y-12">
          {galeria.tarjetas.map((tarjeta, i) => {
            const n = tarjeta.foto;
            const conFoto = typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 6;
            return (
              <li key={i}>
                <figure>
                  {conFoto ? (
                    <img
                      src={`/fotos/proyecto-${n}.webp`}
                      alt={tarjeta.descripcion}
                      loading="lazy"
                      className="aspect-[3/2] w-full rounded-[20px] object-cover"
                    />
                  ) : (
                    <div
                      role="img"
                      aria-label={tarjeta.descripcion || tarjeta.titulo}
                      className="flex aspect-[3/2] w-full items-end rounded-[20px] bg-[color-mix(in_oklab,var(--color-marca)_14%,var(--color-fondo))] p-6"
                    >
                      <span className="text-[clamp(26px,2.4vw,34px)] leading-[1.05] font-light tracking-[-0.02em] text-balance">{tarjeta.titulo}</span>
                    </div>
                  )}
                  <figcaption className="mt-3 flex items-baseline justify-between gap-3 px-1">
                    <span className="text-[15px] font-medium">{tarjeta.titulo}</span>
                    <span className="etiqueta-mono text-right text-tinta/70">{tarjeta.detalle}</span>
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>

        {galeria.nota && (
          <p className="etiqueta-mono mt-10 px-1 text-tinta/70 lg:absolute lg:right-0 lg:bottom-0 lg:mt-0 lg:w-[calc((100%-3rem)/3)]">
            {galeria.nota}
          </p>
        )}
      </div>
    </section>
  );
}

function Estudio({ estudio, numero }: { estudio: NonNullable<Portada["estudio"]>; numero: string }) {
  return (
    <section id="estudio" className={ESTILO_SECCION}>
      <div className="grid gap-x-6 gap-y-10 lg:grid-cols-12">
        <header className="lg:col-span-5">
          <p className="etiqueta-mono text-tinta/70">{numero} Estudio</p>
          <h2 className={ESTILO_TITULAR}>{estudio.titular}</h2>
        </header>

        <div className="lg:col-span-7">
          <p className="text-[clamp(25px,2.65vw,38px)] leading-[1.18] font-light tracking-[-0.015em]">{estudio.texto}</p>

          {estudio.servicios.length > 0 && (
            <dl className="mt-12 border-b border-tinta/15 lg:mt-16">
              {estudio.servicios.map((servicio, i) => (
                <div key={i} className="grid gap-x-6 gap-y-1 border-t border-tinta/15 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <dt className="text-[17px] font-medium">{servicio.nombre}</dt>
                  <dd className="text-[15px] leading-[22px] text-tinta/70">{servicio.detalle}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── La conversación de ejemplo ───────────────────────────────────────────────────────────────────

/** Un instante fijo: el ejemplo nunca depende de la agenda de hoy. Con las reglas de siempre, martes 10:00 y miércoles 17:00. */
const INSTANTE_EJEMPLO = new Date("2026-11-02T09:00:00Z");

/** Lo que pone donde la portada dice {opciones}, según los huecos que ofrecería el asistente. */
export function textoOpciones(huecos: number): string {
  if (huecos >= 2) return "uno de los dos huecos que te ofrecemos";
  if (huecos === 1) return "el hueco que te ofrecemos";
  return "un hueco";
}

/** Quita «… o el {dia2} a las {hora2}»: desde « o » hasta justo después de {hora2} (o de {dia2} si no le sigue {hora2}). */
function sinSegundoHueco(linea: string): string {
  let texto = linea;
  for (;;) {
    const marcas = [texto.indexOf("{dia2}"), texto.indexOf("{hora2}")].filter((i) => i >= 0);
    if (marcas.length === 0) return texto;
    const inicio = texto.lastIndexOf(" o ", Math.min(...marcas));
    if (inicio < 0) return texto;
    const hora = texto.indexOf("{hora2}", inicio);
    const fin = hora >= 0 ? hora + "{hora2}".length : texto.indexOf("{dia2}", inicio) + "{dia2}".length;
    texto = texto.slice(0, inicio) + texto.slice(fin);
  }
}

function conHuecos(texto: string, huecos: Hueco[]): string {
  const dia = (h?: Hueco) => h?.texto.split(" ")[0] ?? "";
  const hora = (h?: Hueco) => h?.id.slice(11, 16) ?? "";
  return texto
    .replaceAll("{dia1}", dia(huecos[0]))
    .replaceAll("{hora1}", hora(huecos[0]))
    .replaceAll("{dia2}", dia(huecos[1]))
    .replaceAll("{hora2}", hora(huecos[1]))
    .replaceAll("{opciones}", textoOpciones(huecos.length));
}

/** Las líneas del ejemplo con los huecos que daría la agenda del negocio; sin huecos, se quitan las que los citan. */
export function lineasEjemplo(ejemplo: Portada["proceso"]["ejemplo"], huecos: Hueco[]): MensajeEjemplo[] {
  const salida: MensajeEjemplo[] = [];
  for (const linea of ejemplo) {
    let texto = linea.texto;
    if (huecos.length < 2) {
      const ofrecia = texto.includes("{dia2}") || texto.includes("{hora2}");
      texto = sinSegundoHueco(texto);
      if (texto.includes("{dia2}") || texto.includes("{hora2}")) continue;
      // Con un solo hueco no hay nada que elegir: «¿Cuál te viene mejor?» pasa a ser «¿Te va bien?».
      if (ofrecia) texto = texto.replace(/¿\s*Cu[aá]l\b[^?]*\?/u, "¿Te va bien?");
    }
    if (huecos.length === 0 && (texto.includes("{dia1}") || texto.includes("{hora1}"))) continue;
    salida.push({ de: linea.de, texto: conHuecos(texto, huecos) });
  }
  return salida;
}

/**
 * Cómo empieza la conversación de ejemplo. Con el formulario, la bienvenida de verdad (la que aprobó Meta).
 * Con el botón de WhatsApp escribe primero el cliente, con el mensaje del botón, y el asistente se
 * presenta y hace la misma pregunta que la bienvenida.
 */
export function inicioEjemplo(config: ConfiguracionResuelta): MensajeEjemplo[] {
  if (config.web.entrada !== "whatsapp") return [{ de: "agente", texto: textoPlantilla("Laura", config.negocio.nombre, config.plantilla.texto) }];
  const presentacion = config.agente.frases.presentacion.replaceAll("{negocio}", config.negocio.nombre);
  const pregunta = [...config.plantilla.texto.matchAll(/¿[^¿?]*\?/g)].at(-1)?.[0] ?? "¿En qué te puedo ayudar?";
  return [
    { de: "cliente", texto: mensajeWeb(config) },
    { de: "agente", texto: `¡Hola! ${presentacion} ${pregunta}` },
  ];
}

function Proceso({ config, numero, enlace }: { config: ConfiguracionResuelta; numero: string; enlace: string | null }) {
  const { proceso, formulario } = config.portada;
  const { pasos, boton } = textosDeEntrada(config);
  const huecos = verHuecos([], INSTANTE_EJEMPLO, config.calendario);
  // El principio (la bienvenida o el mensaje del botón) y luego el resto, con los huecos de su agenda.
  const conversacion: MensajeEjemplo[] = [...inicioEjemplo(config), ...lineasEjemplo(proceso.ejemplo, huecos)];
  const claseBoton =
    "mt-10 inline-flex h-[52px] items-center rounded-full bg-white px-8 text-[15px] font-semibold text-[#111] transition-colors duration-200 ease-out hover:bg-[#e4e2de]";
  const foto = fotoValida(proceso.foto);
  const privacidad = urlPrivacidad(formulario.urlPrivacidad);
  const lema = config.negocio.lema.trim();

  return (
    <section id="proceso" className={`${ESTILO_SECCION} relative overflow-hidden text-white`}>
      {foto ? (
        <>
          <img src={foto} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,10,8,0.84)_0%,rgba(12,10,8,0.7)_55%,rgba(12,10,8,0.46)_100%)]" />
        </>
      ) : (
        <FondoMarca />
      )}

      <div className="relative flex flex-col gap-12 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="etiqueta-mono opacity-85">{numero} Proceso</p>
          <h2 className={ESTILO_TITULAR}>{proceso.titular}</h2>

          <ol className="mt-10 border-b border-white/20 lg:mt-12">
            {pasos.map((paso, indice) => (
              <li key={indice} className="grid grid-cols-[1.75rem_1fr] gap-x-2 border-t border-white/20 py-3.5 lg:grid-cols-[2.25rem_15rem_1fr] lg:gap-x-4">
                <span className="etiqueta-mono pt-[3px] opacity-85">{indice + 1}</span>
                <h3 className="text-[17px] leading-6 font-medium">{paso.titulo}</h3>
                <p className="col-start-2 text-[15px] leading-[22px] text-white/75 lg:col-start-3">
                  {paso.detalle.replaceAll("{opciones}", textoOpciones(huecos.length))}
                </p>
              </li>
            ))}
          </ol>

          {enlace ? (
            <a href={enlace} target="_blank" rel="noopener noreferrer" className={claseBoton}>
              {boton}
            </a>
          ) : (
            <EnlaceFormulario className={claseBoton}>{boton}</EnlaceFormulario>
          )}
        </div>

        <div className="cristal-formulario w-full p-6 lg:w-[380px] lg:shrink-0">
          <p className="etiqueta-mono mb-4 opacity-85">Conversación de ejemplo</p>
          <ConversacionEjemplo mensajes={conversacion} />
        </div>
      </div>

      <footer className="relative mt-16 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-white/20 pt-6">
        <span className="text-[15px] font-medium break-words">{config.negocio.nombre}</span>
        <span className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {lema && <span className="etiqueta-mono opacity-85">{lema}</span>}
          {privacidad && (
            <a
              href={privacidad}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] underline decoration-white/40 underline-offset-4 opacity-85 transition-opacity duration-200 ease-out hover:opacity-100"
            >
              Política de privacidad
            </a>
          )}
        </span>
      </footer>
    </section>
  );
}

/** `enlace`: el de wa.me del botón de WhatsApp, si la portada lo usa y el número está conectado. */
export function Secciones({ config, enlace = null }: { config: ConfiguracionResuelta; enlace?: string | null }) {
  const numeros = Object.fromEntries(seccionesVisibles(config.portada).map((s) => [s.id, s.numero])) as Partial<Record<IdSeccion, string>>;
  const { galeria, estudio } = config.portada;
  return (
    <div>
      <Barra config={config} />
      {galeria && galeria.tarjetas.length > 0 && <Galeria galeria={galeria} numero={numeros.galeria ?? ""} />}
      {estudio && <Estudio estudio={estudio} numero={numeros.estudio ?? ""} />}
      <Proceso config={config} numero={numeros.proceso ?? ""} enlace={enlace} />
    </div>
  );
}
