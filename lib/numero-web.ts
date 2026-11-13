// El número al que te escriben desde la web con el botón de WhatsApp: el del negocio en Meta o, en el
// modo prueba, el móvil de pruebas vinculado por QR (así el botón también se puede probar sin Meta).
// Nunca espera: lo del puente se pregunta detrás y la portada se vuelve a pintar cuando cambia.

import { numeroDelNegocio } from "./meta";
import { modoWhatsApp } from "./modo-prueba";
import { consultarPuente, ultimoEstadoPuente } from "./modo-prueba-puente";

/** Las cifras del número de la web; sin conectar (o sin saberlo aún), null. */
export function cifrasDeLaWeb(): string | null {
  try {
    if (modoWhatsApp() === "prueba") {
      void consultarPuente().catch(() => undefined);
      const puente = ultimoEstadoPuente();
      return puente.fase === "conectado" ? puente.numero : null;
    }
    return numeroDelNegocio()?.texto.replace(/\D/g, "") || null;
  } catch {
    return null;
  }
}
