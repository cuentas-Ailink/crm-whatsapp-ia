# Tu CRM en tu propio dominio

Esta guía pone el CRM en un servidor tuyo, con una dirección como `https://crm.tunegocio.com`, encendido las 24 horas. No hace falta saber programar: son unos pocos comandos que se copian y se pegan.

El instalador del servidor se ha probado con `--simular`, que enseña cada paso sin ejecutarlo. La prueba en un servidor de verdad con Ubuntu 24.04 la hace el dueño del proyecto antes de publicarlo.

## 1. Qué es el modo servidor

- Tu CRM vive en `https://crm.tunegocio.com`, con HTTPS.
- La portada es pública: cualquiera puede verla y escribirte con su botón de WhatsApp (o, si eliges el formulario en Ajustes → Tu web, dejar sus datos).
- El panel pide contraseña. Solo entra quien la sepa.
- Los mensajes de WhatsApp llegan directos al servidor: no hace falta ngrok ni dejar tu ordenador encendido.

## 2. Lo que necesitas

1. **Un servidor pequeño (VPS)** con Ubuntu 24.04 y al menos 2 GB de memoria.
2. **Un dominio** tuyo, por ejemplo `tunegocio.com`. Usarás una parte, como `crm.tunegocio.com`.
3. **Entrar al servidor por SSH** desde la Terminal de tu Mac: `ssh root@IP` (tu proveedor te da la IP y la contraseña o la llave).

**Un ejemplo real:** en Hetzner, el plan **CX23** (2 procesadores, 4 GB de memoria, 40 GB de disco, en Alemania o Finlandia) cuesta unos **6 € al mes** (5,99 € sin IVA; consultado el 13-nov-2026, ese día salía como no disponible). Al crearlo, elige la imagen **Ubuntu 24.04**. Mira el precio actual en la [página del proveedor](https://www.hetzner.com/cloud/cost-optimized/). Si ese plan no está disponible, vale cualquier otro con Ubuntu 24.04 y 2 GB o más.

## 3. Apunta tu dominio al servidor

1. Entra en el sitio donde compraste el dominio (o en Cloudflare, si lo usas).
2. Crea un **registro A**: nombre `crm`, valor la **IP de tu servidor**.
3. Si usas Cloudflare, deja la **nube en gris** («solo DNS»). Con la nube naranja el certificado HTTPS no llega.
4. Espera unos minutos: el cambio tarda un poco en verse.

## 4. Un comando

1. Entra en el servidor:

   ```bash
   ssh root@IP
   ```

2. Pega esto, con tu dominio:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/cuentas-Ailink/crm-whatsapp-ia/main/instalar.sh | bash -s -- --servidor crm.tunegocio.com
   ```

   Si entras con un usuario que no es `root`, pon `sudo` delante de `bash`:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/cuentas-Ailink/crm-whatsapp-ia/main/instalar.sh | sudo bash -s -- --servidor crm.tunegocio.com
   ```

Lo que hace:

1. Comprueba el servidor y que tu dominio apunta a él.
2. Crea un usuario propio para el CRM (`crm`) y lo instala en `/opt/crm-whatsapp`.
3. Descarga Node.js de su web oficial y comprueba que la descarga es la buena.
4. Prepara la aplicación y escribe su configuración con un código de alta nuevo.
5. Pone HTTPS con Caddy (el certificado se pide y se renueva solo) y arranca el CRM, que vuelve a arrancar solo si se cae o reinicias el servidor.
6. Cierra el cortafuegos: solo quedan abiertos SSH, 80 y 443.

La última línea es la importante:

```text
Listo: abre https://crm.tunegocio.com/entrar y usa el código de alta ABCD2345
```

Apunta ese código: lo necesitas en el paso siguiente.

¿Quieres ver antes lo que haría, sin tocar nada? Añade `--simular` al final del comando.

## 5. La primera vez

1. Abre `https://crm.tunegocio.com/entrar`.
2. Escribe el **código de alta** y elige tu **contraseña** (al menos 10 caracteres). El código sirve una sola vez.
3. Ya dentro, la **Puesta en marcha** te guía: tu negocio, Claude y WhatsApp. No te pedirá ngrok: el paso de WhatsApp le dice a Meta que los mensajes van a `https://crm.tunegocio.com/webhook`, él solo.

¿Has perdido el código de alta? Míralo en el registro del CRM:

```bash
sudo journalctl -u crm-whatsapp | grep "Código de alta"
```

## 6. Actualizar

Pega **el mismo comando** del paso 4. Descarga la versión nueva y vuelve a arrancar el CRM.

Nunca toca: tu configuración (`.env`), tus datos (`datos/`), tu asistente (`agente.md`), tus copias (`copias/`) ni los registros (`logs/`). Tampoco vuelve a sacar un código de alta: tu contraseña sigue igual.

El CRM se para un par de minutos mientras se actualiza. Los mensajes de WhatsApp que lleguen en ese rato no se pierden: Meta los vuelve a enviar.

## 7. Copias de seguridad

- Cada día el CRM guarda una copia de tus datos en `/opt/crm-whatsapp/copias/`, con la fecha en el nombre (`datos-AAAA-MM-DD.tar.gz`). Se quedan las **14 últimas**.
- Para traerte una a tu ordenador, desde la Terminal de tu Mac (no dentro del servidor):

  ```bash
  scp root@IP:/opt/crm-whatsapp/copias/datos-AAAA-MM-DD.tar.gz .
  ```

- Si guardas los datos en **Supabase**, aquí no hay copias: Supabase guarda las suyas.
- Para **recuperar** una copia, abre Claude Code en la carpeta del CRM y pídeselo. No hay un comando para eso.

## 8. Si olvidas la contraseña

Dentro del servidor, pega estos cuatro comandos, uno detrás de otro:

```bash
sudo sed -i '/^CLAVE_PANEL_HASH=/d; /^CODIGO_ALTA=/d' /opt/crm-whatsapp/.env
printf 'CODIGO_ALTA="%s"\n' "$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' | cut -c1-8)" | sudo tee -a /opt/crm-whatsapp/.env >/dev/null
sudo systemctl restart crm-whatsapp
sudo journalctl -u crm-whatsapp | grep "Código de alta" | tail -n 1
```

El último te enseña el código nuevo. Después, vuelve al paso 5.

## 9. Ver qué pasa

- Lo que va haciendo el CRM, en directo (para salir, `Ctrl+C`):

  ```bash
  sudo journalctl -u crm-whatsapp -f
  ```

- Reiniciarlo:

  ```bash
  sudo systemctl restart crm-whatsapp
  ```

- Lo que pasó en la última instalación: `/opt/crm-whatsapp/logs/instalacion.log`.

## 10. Lo que cuesta al mes

- **El servidor:** el del ejemplo, unos 6 € al mes (5,99 € sin IVA; consultado el 13-nov-2026).
- **El dominio:** lo que cobre tu proveedor de dominios al año.
- **WhatsApp:** Meta cobra cada mensaje que se entrega, según su categoría y el país del móvil que lo recibe. Sus precios: [página de Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing).
- **Claude:** se paga por uso. «Probar tu asistente» te enseña lo que cuesta cada prueba.

## 11. Lo que no hace

- Hay **una contraseña** para el panel. No hay usuarios ni permisos distintos.
- Está pensado para **Ubuntu 24.04**. En otros sistemas avisa y puede fallar algún paso.

El instalador del servidor se ha probado con `--simular`; la prueba en un servidor de verdad la hace el dueño.
