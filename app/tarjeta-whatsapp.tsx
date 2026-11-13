import { MessageCircle } from "lucide-react";
import { qrDataUrl } from "@/lib/qr";

// La tarjeta de la primera pantalla cuando te escriben con el botón de WhatsApp (web.entrada = "whatsapp"):
// el cliente escribe primero, con el mensaje ya puesto, y el asistente le contesta con un mensaje normal.
// Sin número conectado no hay enlace roto: lo dice tal cual y la portada se vuelve a pintar cuando llega.

export function TarjetaWhatsApp(p: { enlace: string | null; mensaje: string; chips: readonly string[] }) {
  const { enlace, mensaje, chips } = p;
  return (
    <div id="tarjeta-whatsapp" className="cristal-formulario relative w-full max-w-[380px] p-6 lg:w-[380px] lg:shrink-0">
      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map((chip, i) => (
          <span key={i} className="rounded-full border border-white/40 px-3 py-1 text-[12px]">
            {chip}
          </span>
        ))}
      </div>

      <h2 className="text-[28px] leading-[1.1] font-light tracking-[-0.02em]">Escríbenos por WhatsApp</h2>
      <p className="mt-2 text-[15px] leading-[22px] opacity-85">Nuestro asistente te contesta al momento.</p>

      {enlace ? (
        <>
          <a
            href={enlace}
            target="_blank"
            rel="noopener noreferrer"
            data-boton-whatsapp=""
            className="mt-5 flex h-[56px] w-full items-center justify-center gap-2.5 rounded-full bg-[#15803d] text-[17px] font-semibold text-white transition-colors duration-200 ease-out hover:bg-[#166534] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <MessageCircle aria-hidden className="size-5" strokeWidth={2} />
            Abrir WhatsApp
          </a>
          <p className="mt-3 text-[12px] leading-4 opacity-75">Se abre con este mensaje ya escrito: «{mensaje}»</p>

          {/* En el ordenador, el mismo enlace en un QR: se escanea con el móvil y se escribe desde allí. */}
          <div className="mt-5 hidden items-center gap-4 border-t border-white/20 pt-5 lg:flex">
            <img
              src={qrDataUrl(enlace)}
              alt="Código QR que abre WhatsApp con el mensaje escrito"
              width={136}
              height={136}
              className="size-[136px] shrink-0 rounded-[12px] bg-white p-1.5"
            />
            <p className="text-[14px] leading-5 opacity-85">Escanéalo con tu móvil</p>
          </div>
        </>
      ) : (
        <p role="status" className="mt-5 rounded-[14px] border border-white/25 bg-white/10 px-4 py-3 text-[14px] leading-5">
          WhatsApp todavía no está conectado.
        </p>
      )}
    </div>
  );
}
