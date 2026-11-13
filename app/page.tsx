import type { Metadata } from "next";
import { connection } from "next/server";
import { MarcaNegocio } from "@/app/marca";
import { FondoMarca, fotoValida, MenuSecciones, Secciones } from "@/app/secciones";
import { TarjetaWhatsApp } from "@/app/tarjeta-whatsapp";
import { EnlaceFormulario } from "@/cliente/enlace-formulario";
import { Formulario } from "@/cliente/formulario";
import { RefrescarAlConfigurar } from "@/cliente/refrescar-al-configurar";
import { enlaceWhatsApp, firmaDePortada, mensajeWeb, textosDeEntrada } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { cifrasDeLaWeb } from "@/lib/numero-web";
import { PAISES } from "@/lib/regional";

// La portada del negocio: aquí su cliente le escribe por WhatsApp con el botón (lo normal) o rellena el
// formulario y recibe un WhatsApp en segundos. Todo sale de la configuración (marca, textos, entrada y
// agenda), y se vuelve a pintar sola cuando alguien la cambia o cuando se conecta el número.

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const c = await configuracionParaPintar();
  return { description: textosDeEntrada(c).descripcion };
}

export default async function Inicio() {
  await connection();
  const c = await configuracionParaPintar();
  const { hero, formulario } = c.portada;
  const { zona: etiquetaZona, ...textos } = formulario;
  const foto = fotoValida(hero.foto);
  const digitos = PAISES.find((p) => p.id === c.regional.pais)?.digitos ?? 0;
  const conBoton = c.web.entrada === "whatsapp";
  const numero = conBoton ? cifrasDeLaWeb() : null;
  const mensaje = mensajeWeb(c);
  const enlace = conBoton ? enlaceWhatsApp(numero, mensaje) : null;
  const { subtitulo } = textosDeEntrada(c);

  return (
    <main>
      <section id="contacto" className="relative min-h-screen w-full overflow-hidden text-white lg:h-screen lg:min-h-[720px]">
        {foto ? (
          <>
            <img src={foto} alt="" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black/50 lg:bg-transparent lg:bg-[linear-gradient(90deg,rgba(12,10,8,0.72)_0%,rgba(12,10,8,0.42)_45%,rgba(12,10,8,0.12)_100%)]" />
          </>
        ) : (
          <FondoMarca />
        )}

        <div className="relative flex min-h-screen flex-col px-5 py-5 lg:h-full lg:min-h-0 lg:px-12 lg:py-8">
          <header id="cabecera-portada" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <MarcaNegocio nombre={c.negocio.nombre} logoUrl={c.negocio.logoUrl} fondo="oscuro" />
            <MenuSecciones
              portada={c.portada}
              className="etiqueta-mono order-last col-span-full flex flex-wrap gap-x-5 gap-y-2 sm:gap-x-8 lg:order-none lg:col-span-1"
              enlace="opacity-85 transition-opacity duration-200 ease-out hover:opacity-100"
            />
            <EnlaceFormulario className="justify-self-end rounded-full border border-white/50 px-5 py-2 text-[13px] transition-colors duration-200 ease-out hover:bg-white/10">
              Contacto
            </EnlaceFormulario>
          </header>

          <div className="flex flex-1 flex-col justify-end gap-8 pt-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <div className="min-w-0 pb-2">
              <p className="etiqueta-mono opacity-85">01 / {hero.antetitulo}</p>
              <h1 className="my-4 text-[clamp(40px,9vw,96px)] leading-[0.95] font-light tracking-[-0.03em] text-balance uppercase hyphens-auto">
                {hero.titular}
              </h1>
              {subtitulo && <p className="max-w-[34rem] text-[17px] leading-6 opacity-85">{subtitulo}</p>}
            </div>
            {conBoton ? (
              <TarjetaWhatsApp enlace={enlace} mensaje={mensaje} chips={formulario.chips} />
            ) : (
              <Formulario
                key={`${c.perfil.id}:${formulario.marcado}`}
                textos={textos}
                negocio={c.negocio.nombre}
                prefijo={c.regional.prefijo}
                digitos={digitos}
                zona={c.vocabulario.zona === null ? null : etiquetaZona}
              />
            )}
          </div>
        </div>
      </section>

      <Secciones config={c} enlace={enlace} />
      <RefrescarAlConfigurar firma={firmaDePortada(c, numero)} />
    </main>
  );
}
