# Instalar el CRM de WhatsApp

Esta guía deja el CRM funcionando en tu Mac con tus propias cuentas. Son tres bloques: un comando, la puesta en marcha dentro del CRM y lo que hay que hacer en Meta. No hace falta editar ningún archivo: las claves se pegan en el propio CRM.

Si te atascas, abre Claude Code en la carpeta del CRM y pídele ayuda: `CLAUDE.md` le explica el proyecto.

## 1. El comando

Abre la app **Terminal** y pega esto:

```bash
curl -fsSL https://raw.githubusercontent.com/cuentas-Ailink/crm-whatsapp-ia/main/instalar.sh | bash
```

Este comando necesita que el repositorio sea público. Con una copia privada, descarga la carpeta, entra en ella desde Terminal y ejecuta `bash instalar.sh`.

- **Si no tienes Node.js** (hace falta la versión 22.13 o superior), el instalador se para y te da el enlace: [nodejs.org/es/download](https://nodejs.org/es/download). Baja el instalador para Mac, instálalo y vuelve a pegar el comando.
- **Dónde se instala:** en la carpeta `crm-whatsapp` de tu usuario. No usa git, así que el Mac no te pide instalar nada más.
- **Lo que verás:** «✓ Descargado», «✓ Node.js listo», «✓ Aplicación preparada» y «Abriendo tu CRM en el navegador… Deja esta ventana abierta; para pararlo, Ctrl+C».
- **Los días siguientes:** doble clic en **«Abrir CRM»**, dentro de esa carpeta. Si ya estaba abierto, solo abre el navegador.
- **Para pararlo:** `Ctrl+C` en su ventana.
- **Para actualizar:** cierra el CRM y vuelve a pegar el mismo comando. Nunca toca tus claves (`.env`, `.env.local`), tus datos (`datos/`), tu asistente (`agente.md`), tus archivos de `negocios/` ni los registros (`logs/`).
- Probado en Mac.

## 2. La puesta en marcha, paso a paso

Al abrirse, el CRM te guía con cuatro pasos. Cada uno dice si ya está hecho, y cada error dice en el propio CRM qué hacer.

1. **¿Qué negocio es?** Elige el tipo (Reformas, Inmobiliaria, Clínica u Otro), escribe el nombre de tu negocio tal como lo verán tus clientes y, si quieres, sube tu logo (PNG, JPG o WebP).
2. **Conecta tu asistente.** Pega tu «Clave de Claude». La sacas en [platform.claude.com](https://platform.claude.com/settings/keys) → **API Keys**. Se paga por uso: añade saldo en **Billing**. El CRM la comprueba al momento.
3. **Conecta tu WhatsApp.** Tres valores:
   - «Token permanente de Meta»: el del usuario del sistema (bloque 3).
   - «Clave secreta de la app»: la de tu app de Meta (bloque 3).
   - «Token de ngrok»: crea una cuenta gratis en ngrok.com y copia tu authtoken en [dashboard.ngrok.com](https://dashboard.ngrok.com/get-started/your-authtoken) → **Your Authtoken**. Si ya usabas ngrok en este ordenador, puedes dejarlo vacío. No hace falta en el modo servidor ni si tienes tu propio túnel.

   Cada uno se guarda en cuanto lo pegas (sale «Guardada · termina en …» y no se vuelve a enseñar): si recargas o cierras la pestaña, no se pierde. Meta enseña el token permanente una sola vez.

   Pulsa «Conectar»: el CRM elige tu cuenta de WhatsApp y tu número, suscribe tu app, apunta Meta a tu CRM y comprueba la firma. Si Meta no devuelve la cuenta, te pide el «Identificador de la cuenta de WhatsApp» y te dice dónde está.
4. **Tu primer WhatsApp.** Escríbele «Hola» al número de tu negocio desde tu móvil y mira cómo contesta tu asistente. Eso es lo que harán tus clientes con el botón de WhatsApp de tu web: no hace falta ningún mensaje aprobado por Meta.

¿Te atascas? «Lo dejo para luego» y sigues otro día. Después, todo está en **Ajustes → Conexiones**.

## 3. Lo que tienes que hacer en Meta

1. **La app.** En [developers.facebook.com](https://developers.facebook.com/apps/) → Mis apps → Crear app, elige el caso de uso «Connect with customers through WhatsApp» y tu portfolio empresarial de Meta (créalo si no tienes).
2. **El usuario del sistema y su token permanente.** En business.facebook.com → Configuración → Usuarios del sistema, crea uno, asígnale tu app y tu cuenta de WhatsApp y genera un token que no caduque con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Pégalo en «Token permanente de Meta». No uses el token de la pantalla de inicio de la app: caduca en 24 h.
3. **La clave secreta.** En tu app: Configuración de la app → Básica → Clave secreta de la app. Pégala en «Clave secreta de la app»: con ella el CRM comprueba que cada mensaje viene de Meta.
4. **La lista de prueba.** En tu app: WhatsApp → Configuración de la API, añade tu móvil a los destinatarios del número de prueba (hasta 5). El número de prueba solo escribe a los móviles de esa lista.
5. **Publica la app:** en Meta for Developers, «Configuración de la app» → «Básica», pega la URL de tu política de privacidad, «Guardar cambios» y «Publicar». Meta no entrega los mensajes a una app en modo desarrollo, aunque todas las comprobaciones del CRM estén en verde.
6. **Para clientes de verdad:** añade el número de tu negocio y un método de pago. Sin método de pago, Meta no entrega los mensajes que se cobran.

No tienes que crear ningún mensaje aprobado (plantilla): tu web trae un botón de WhatsApp, tu cliente escribe primero y tu asistente le contesta. Los mensajes aprobados son un extra para escribir tú primero: el de bienvenida (solo si eliges el formulario en Ajustes → Tu web), el aviso a tu móvil cuando no le has escrito al número del negocio en las últimas 24 h y el de retomar una conversación. Si los quieres, los envía el CRM a Meta: Ajustes → Conexiones → «Enviar a Meta para aprobar». Meta tarda hasta 24 h en revisarlos.

De momento son pasos de texto: las capturas de las pantallas de Meta llegarán más adelante.

## Probar sin Meta (opcional)

Si solo quieres probarlo antes de pelearte con Meta, en la bienvenida de la puesta en marcha elige **«Modo prueba»**: vinculas un móvil de pruebas con un QR y tu asistente contesta solo a los números que pongas en la lista. No es la vía oficial y WhatsApp puede bloquear ese número: nunca uses el de tu negocio ni el tuyo personal. La primera vez descarga lo que necesita (hace falta internet). Cuando quieras clientes de verdad, «Pasar a WhatsApp oficial» en Ajustes → Conexiones. Más en el [README](README.md#probarlo-sin-meta-modo-prueba).

## Si algo no va

Ningún paso pide editar `.env`. Lo primero es **Ajustes → Conexiones**: cada línea dice qué falla y, si se puede arreglar solo, tiene un botón «Arreglar».

| Lo que pasa | Qué hacer |
|---|---|
| «Ya hay un CRM abierto con estos datos en este ordenador.» | Ya tienes otra ventana con el CRM abierto. Ciérrala (`Ctrl+C`) antes de abrir otro |
| «El puerto 8000 ya está en uso…» | Otro programa usa ese puerto. Ciérralo o cambia `PUERTO` en `.env` |
| «Tu CRM está abierto» al actualizar | Cierra el CRM (`Ctrl+C` en su ventana) y vuelve a pegar el comando |
| Todo en verde en Conexiones, pero tu «Hola» no llega al CRM | ¿Has publicado la app en Meta? Una app en modo desarrollo no recibe los mensajes: «Publica la app» en el bloque 3 |
| Acabas de conectar WhatsApp y Conexiones aún dice que tu app de Meta no escucha esta cuenta | Pulsa «Volver a comprobar», arriba en Conexiones: esa comprobación se guarda unos minutos |
| El formulario de tu web da error | En tu ordenador, el propio formulario dice la causa real y qué hacer |
| El asistente no contesta o algo falla sin explicación | Mira `logs/servidor.log` (y `logs/instalacion.log` si falló la instalación) y pégaselo a Claude Code |
| Quieres la lista completa desde la terminal | Con el CRM abierto, `bash comprobar.sh` (opcional): una línea OK, AVISO o ERROR por cada cosa, sin enseñar ninguna clave |

## Si ya lo tenías instalado

Notas para quien tenía la versión anterior (con `git clone`):

- **Antes de `git pull`, copia tu `agente.md`** a otro sitio. Ya no está en el repositorio, así que `git pull` lo borra. El CRM lo vuelve a crear desde `perfiles/reformas.md`: pon tu copia en su sitio.
- **Tu token de ngrok** se lee de la configuración de ngrok (`ngrok.yml`). Si no lo encuentra, pégalo una vez en Ajustes → Conexiones.
- **Con `SUPABASE_DB_URL` en `.env`,** tus datos siguen en Supabase. Las instalaciones nuevas los guardan en `datos/`.
- **`NOMBRE_NEGOCIO`, `PLANTILLA`, `PLANTILLA_IDIOMA`, `MODELO` y `TELEFONO_COMERCIAL` en `.env`** siguen funcionando como valores de partida; lo que guardes en Ajustes tiene prioridad.
- **Para pasar de `solicitud_recibida` a `solicitud_general`** (solo si usas el formulario): quita `PLANTILLA` y `PLANTILLA_IDIOMA` de `.env` y envía el mensaje de bienvenida a Meta desde Ajustes → Conexiones.
- **Instrucciones antiguas que prometen «el día antes» o «hoy mismo»:** al abrir el CRM sale un aviso en rojo, Ajustes → Avanzado → Comprobaciones también avisa, y si nunca tocaste el texto de tu tipo de negocio verás «Hay una versión nueva…» con «Actualizar». Mientras tanto, el CRM descarta las respuestas que prometen eso.
- **`scripts/audios/`** ya no está en el repositorio.
