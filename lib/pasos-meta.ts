// «Lo que tienes que hacer en Meta» (paso 3 de la puesta en marcha) y la pista de «¿No llega?» del
// paso 4. Son textos de la interfaz: viven aquí para que las pruebas los lean sin montar React.
// README.md e INSTALAR.md cuentan los mismos pasos: si cambias uno, cambia los tres.

export interface PasoMetaTexto {
  titulo: string;
  texto: string;
  /** Solo en local: en el modo servidor no hay túnel de ngrok. */
  soloLocal?: boolean;
}

export const PASOS_META: readonly PasoMetaTexto[] = [
  {
    titulo: "Crea la app.",
    texto: "En developers.facebook.com → Mis apps → Crear app, elige el caso de uso «Connect with customers through WhatsApp» y tu portfolio empresarial.",
  },
  {
    titulo: "Crea el usuario del sistema y su token.",
    texto:
      "En business.facebook.com → Configuración → Usuarios del sistema, crea uno, dale tu app y tu cuenta de WhatsApp y genera un token que no caduque con los permisos whatsapp_business_messaging y whatsapp_business_management. Pégalo en «Token permanente de Meta».",
  },
  { titulo: "Copia la clave secreta.", texto: "En tu app: Configuración de la app → Básica → Clave secreta de la app. Pégala en «Clave secreta de la app»." },
  {
    titulo: "Añade tu móvil a la lista de prueba.",
    texto: "En tu app: WhatsApp → Configuración de la API, añádelo a los destinatarios del número de prueba (hasta 5).",
  },
  // Meta no entrega los mensajes a una app en modo desarrollo aunque todo lo demás esté en verde.
  {
    titulo: "Publica la app:",
    texto: "en Meta for Developers, «Configuración de la app» → «Básica», pega la URL de tu política de privacidad, «Guardar cambios» y «Publicar».",
  },
  { titulo: "Para clientes de verdad:", texto: "añade el número de tu negocio y un método de pago." },
  {
    titulo: "El token de ngrok:",
    texto: "crea una cuenta gratis en ngrok.com y copia tu authtoken de dashboard.ngrok.com → Your Authtoken.",
    soloLocal: true,
  },
];

/** Lo primero que se mira cuando el «Hola» del paso 4 no llega. */
export const PISTA_PUBLICAR = "¿Has publicado la app en Meta?";

/** Los pasos que se enseñan: en el modo servidor, sin el de ngrok. */
export function pasosMeta(servidor: boolean): PasoMetaTexto[] {
  return PASOS_META.filter((paso) => !paso.soloLocal || !servidor);
}
