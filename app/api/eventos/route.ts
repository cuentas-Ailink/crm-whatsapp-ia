import { escucharServidor, type EventoServidor } from "@/lib/eventos";

// El flujo de eventos del panel (Server-Sent Events): qué ha cambiado, quién acaba de llegar y la hora
// del servidor. Cada evento se escribe campo a campo: lo que un aviso traiga de más (un teléfono, una
// clave) nunca sale por aquí (I5).

export const dynamic = "force-dynamic";

const LATIDO_MS = 20_000;
const HORA_MS = 60_000;

function evento(nombre: string, datos: unknown): string {
  return `event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`;
}

function hora(): string {
  return evento("hora", { ahora: Date.now() });
}

/** Solo los campos del contrato, en este orden. */
function serializar(e: EventoServidor): string | null {
  switch (e.tipo) {
    case "cambio":
      return evento("cambio", { tipo: e.cambio.tipo, rev: e.cambio.rev });
    case "llegada":
      return evento("llegada", { leadId: e.llegada.leadId, nombre: e.llegada.nombre, canal: e.llegada.canal, inicio: e.llegada.inicio });
    case "llegada-fallida":
      return evento("llegada-fallida", { leadId: e.fallo.leadId, nombre: e.fallo.nombre, codigo: e.fallo.codigo, texto: e.fallo.texto });
    default:
      return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const codificador = new TextEncoder();
  let limpiar: () => void = () => {};

  const flujo = new ReadableStream<Uint8Array>({
    start(controlador) {
      let cerrado = false;
      let latido: ReturnType<typeof setInterval> | undefined;
      let reloj: ReturnType<typeof setInterval> | undefined;
      let dejar: () => void = () => {};

      // Se puede llamar varias veces (corte, cancel, error al escribir): solo la primera hace algo.
      limpiar = () => {
        if (cerrado) return;
        cerrado = true;
        clearInterval(latido);
        clearInterval(reloj);
        dejar();
        request.signal.removeEventListener("abort", limpiar);
        try {
          controlador.close();
        } catch {
          // Ya estaba cerrado.
        }
      };

      const escribir = (texto: string) => {
        if (cerrado) return;
        try {
          controlador.enqueue(codificador.encode(texto));
        } catch {
          limpiar();
        }
      };

      if (request.signal.aborted) {
        limpiar();
        return;
      }
      request.signal.addEventListener("abort", limpiar);

      escribir("retry: 3000\n\n");
      escribir(hora());
      if (cerrado) return;
      // Solo escucharServidor: ya trae los cambios; escuchar también escucharCambios los mandaría dos veces.
      dejar = escucharServidor((e) => {
        try {
          const texto = serializar(e);
          if (texto) escribir(texto);
        } catch {
          // Un oyente del bus nunca lanza: le haría daño a quien avisa.
        }
      });
      latido = setInterval(() => escribir(": latido\n\n"), LATIDO_MS);
      reloj = setInterval(() => escribir(hora()), HORA_MS);
    },
    cancel() {
      limpiar();
    },
  });

  return new Response(flujo, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: que ni la compresión de Next ni un proxy retengan el flujo.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
