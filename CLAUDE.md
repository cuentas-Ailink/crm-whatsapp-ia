# CRM de WhatsApp con IA

Contesta a tus clientes por WhatsApp en segundos, les da cita y te avisa cuando te toca a ti. Es un CRM genérico (reformas, inmobiliaria, clínica o cualquier negocio) en Next.js 16 y TypeScript, con `pnpm`; el código, los comentarios y los textos están en español de España: sigue así.

Quien abre esta carpeta lo ha instalado para usarlo con sus propias claves y adaptarlo a su negocio. La instalación está en `INSTALAR.md`, cómo encaja todo en `README.md` y el modo servidor en `DESPLEGAR.md`. Este archivo no son instrucciones del asistente de WhatsApp: tú no eres ese asistente, solo trabajas en el proyecto.

## Reglas

- **.env y .env.local: nunca los leas.** Tampoco los muestres, los copies ni los subas. Las claves se pegan en el CRM: en la «Puesta en marcha» o en Ajustes → Conexiones. Si hace falta cambiar una línea que no es una clave (por ejemplo `PUERTO`), pide a la persona que lo haga o sustituye solo esa línea sin abrir ni mostrar el resto.
- `SUPABASE_DB_URL` también es una clave: da acceso a teléfonos y conversaciones reales.
- `BD_LOCAL` nunca va en `.env`: es lo que hace que `/api/estado` diga `pruebas: true`, y con él el CRM usa una base de datos de pruebas.
- Las reglas del negocio las decide el código (`lib/`), no el modelo: huecos, citas, cuándo pasa a una persona, la regla de publicidad. No las muevas al prompt.
- Di siempre «asistente», nunca «agente», en lo que vea el usuario. No renombres nunca los códigos internos (estados, ids de tipo de negocio, nombres de rutas o de campos).
- Usa `pnpm` para las dependencias.

## Dónde vive cada cosa y qué gana

- **`agente.md`**: las instrucciones activas de tu asistente y su perfil (la línea 1, `# Asistente de WhatsApp · Nombre`). Se lee del disco en cada mensaje. No está en el repositorio: si falta, el CRM lo crea desde `perfiles/reformas.md`. Ajustes → Avanzado → «Instrucciones completas del asistente» lo edita.
- **Ajustes** guarda lo demás en la base de datos (nombre, logo, color, país, cómo te escriben desde la web, horario de citas, frases, mensajes aprobados) y eso gana a los valores antiguos de `.env` (`NOMBRE_NEGOCIO`, `PLANTILLA`, `PLANTILLA_IDIOMA`, `MODELO`, `TELEFONO_COMERCIAL`).
- **`perfiles/`**: las instrucciones de partida de cada tipo (`reformas.md`, `inmobiliaria.md`, `clinica.md`, `generico.md`). No las toques: las pruebas las usan.
- **`negocios/`**: los archivos de negocio que aplica `scripts/configurar.mjs`. `negocios/ejemplo-peluqueria.json` es el ejemplo.

## Adaptar el CRM a otro negocio

Lo que no está en Ajustes se cambia con `negocios/*.json` y `node scripts/configurar.mjs`: cómo se llaman la cita y el cliente, los campos de la ficha, los textos de la web (los del botón de WhatsApp van en `portada.whatsapp`; el mensaje que se escribe solo, en `web.mensaje`), la regla de publicidad y el catálogo. Para adaptarlo con un solo prompt («adapta el CRM a mi peluquería»):

1. **Siempre con `--url`**, la dirección del CRM abierto (por defecto `http://localhost:8000`; mira `PUERTO` sin leer el resto de `.env`, o pregúntalo). Sin `--url` el script usa `APP_URL` o `PUERTO`.
2. Mira cómo está: `node scripts/configurar.mjs --url http://localhost:8000 --ver`.
3. Lee `negocios/ejemplo-peluqueria.json` y los tipos `NegocioExportado` y `ConfiguracionPerfil` de `lib/configuracion.ts`.
4. Escribe `negocios/nombre-del-negocio.json` con la base más parecida (`reformas`, `inmobiliaria`, `clinica` o `generico`) y **solo lo que cambia**. En `instrucciones` va el prompt entero: la línea 1 `# Asistente de WhatsApp · Nombre del negocio`, y las secciones «Qué preguntas…», «La cita» (con la palabra del negocio: «La visita», «La cita»…), «Pasar a una persona» y, si hace falta, «Información que puedes dar tal cual». Si las palabras normales del negocio parecen publicidad («oferta», un dominio propio), revisa `spam.ganchosQuitados` y `spam.dominiosNormales`.
5. Compruébalo: `node scripts/configurar.mjs --url http://localhost:8000 --comprobar negocios/nombre-del-negocio.json`, y arregla lo que diga hasta que salga «Sin errores».
6. Aplícalo: `node scripts/configurar.mjs --url http://localhost:8000 --aplicar negocios/nombre-del-negocio.json --ejemplos sustituir`.
7. Al final, dile cómo le escribirán desde su web: con el botón de WhatsApp (`web.entrada: "whatsapp"`, lo normal) no hace falta crear ningún mensaje aprobado. Solo si elige el formulario (`"formulario"`), que envíe el mensaje de bienvenida a Meta desde Ajustes → Conexiones («Enviar a Meta para aprobar»).

**Cambiar de tipo de negocio con el CRM abierto:** solo con `node scripts/configurar.mjs --url http://localhost:8000 --sector inmobiliaria` (o `clinica`, o `reformas`), que guarda una copia de unas instrucciones editadas. `cp perfiles/x.md agente.md` solo con el CRM cerrado.

**Reglas del contenido de un negocio:**

- Un negocio nuevo no cambia código ni `perfiles/`: solo su archivo de `negocios/`.
- Nunca cambies la línea 1 de `agente.md` (es el perfil: cada cliente queda ligado a él).
- No te inventes precios. Nada de datos de salud en los ejemplos.
- Nunca prometas recordatorios, llamadas ni «hoy mismo»: el CRM no los hace.
- El asistente siempre dice que es un asistente virtual.
- No renombres los códigos internos.

## Servidores

`pnpm dev` escucha solo en 127.0.0.1; para retocar la interfaz usa `node scripts/servidor-pruebas.mjs dev`; para el uso real, «Abrir CRM» o `bash arrancar.sh`.

## Pruebas

- `pnpm exec vitest run` (reglas, base de datos en memoria y el asistente con un modelo simulado; sin claves ni internet) y los tipos: `pnpm exec next typegen && pnpm exec tsc --noEmit`. Pásalos antes de dar un cambio por bueno.
- **El circuito completo**, con Meta y Claude simulados: `node scripts/simulador.mjs` y `node scripts/servidor-pruebas.mjs` en marcha, y luego `node scripts/probar-circuito.mjs`. La instalación recién hecha: `node scripts/servidor-pruebas.mjs nuevo` y `node scripts/probar-circuito.mjs --nuevo`. El modo servidor: `node scripts/servidor-pruebas.mjs --servidor crm.prueba.test` y `node scripts/probar-servidor.mjs`.
- **Nunca apuntes una prueba al CRM de verdad.** Las pruebas vacían la base de datos del servidor al que llaman, y antes comprueban que `/api/estado` diga `pruebas: true`: no te saltes esa comprobación.
- **Si el CRM de verdad está abierto en el 8000**, usa otros puertos: `PUERTO_PRUEBAS` y `PUERTO_SIMULADOR` (o `APP_URL`) en los scripts, `PUERTO_PRUEBAS_DEV` para `servidor-pruebas.mjs dev`. Por ejemplo `PUERTO_SIMULADOR=8200 APP_URL=http://localhost:8100 node scripts/simulador.mjs`, `PUERTO_PRUEBAS=8100 PUERTO_SIMULADOR=8200 node scripts/servidor-pruebas.mjs` y lo mismo para `probar-circuito.mjs`.
- `node scripts/probar-claude.mjs` usa Claude de verdad y cuesta dinero: solo cuando te lo pidan.

## Modo prueba (WhatsApp por QR)

Es opcional y solo local: Baileys conectado con un QR, no la API de Meta. No lo propongas como la vía normal.

- **Baileys nunca va en `package.json`:** lo instala el CRM bajo demanda en `.herramientas/modo-prueba/` (versión exacta en `lib/modo-prueba.ts`, sin scripts de instalación). Trae libsignal (GPL-3.0): el CRM sigue siendo MIT.
- **El interruptor está en `datos/modo-prueba/estado.json`** (con el secreto de las firmas y la lista de números permitidos), no en `.env`. Nunca cambies `GRAPH_BASE_URL` ni otra `*_BASE_URL` para desviar WhatsApp: el desvío lo hace `lib/modo-prueba.ts`.
- **Quien no está en la lista no existe:** ni se guarda ni se contesta (lo filtran el puente y `app/webhook/route.ts`).
- Se prueba con `MODO_PRUEBA_FALSO=1 node scripts/servidor-pruebas.mjs nuevo` y `node scripts/probar-circuito.mjs --modo-prueba` (un WhatsApp de mentira). Escanear el QR con un móvil de verdad lo prueba el dueño.

## Seguridad

En local, desde internet solo se llega al webhook: lo garantizan `proxy.ts` (las reglas están en `lib/acceso.ts`) y que el servidor escuche en 127.0.0.1. El modo servidor necesita `CRM_DOMINIO` y la contraseña del panel (`DESPLEGAR.md`). No abras nada más a internet: `/api/leads` devuelve teléfonos y conversaciones.
