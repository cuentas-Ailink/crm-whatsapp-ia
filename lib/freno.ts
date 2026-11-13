// El freno del formulario de la web contra el abuso. En los dos modos, el campo trampa: un robot que
// lo rellena recibe un «ok» y no se le escribe a nadie. En modo servidor, además: una bienvenida por
// teléfono cada 24 h, 5 peticiones por IP y hora y 50 bienvenidas en 24 h para todo el servidor.
// Ventanas móviles (nada de días del calendario: no depende de la zona horaria), en memoria.

const UNA_HORA_MS = 60 * 60 * 1000;
const UN_DIA_MS = 24 * UNA_HORA_MS;
const PETICIONES_POR_IP_Y_HORA = 5;
const BIENVENIDAS_POR_DIA = 50;

export const TEXTO_DEMASIADAS = "Hemos recibido muchas solicitudes. Inténtalo más tarde o escríbenos por WhatsApp.";

interface EstadoFreno {
  /** Cuándo salió la última bienvenida a cada teléfono. */
  telefonos: Map<string, number>;
  /** Cuándo salió cada bienvenida, para el tope del servidor. */
  bienvenidas: number[];
  /** Las peticiones de cada IP. */
  ips: Map<string, number[]>;
}

function estado(): EstadoFreno {
  const g = globalThis as unknown as { __crmFreno?: EstadoFreno };
  g.__crmFreno ??= { telefonos: new Map(), bienvenidas: [], ips: new Map() };
  return g.__crmFreno;
}

/** Quita lo que ya ha salido de su ventana. */
function podar(e: EstadoFreno, ahora: number): void {
  for (const [telefono, ts] of e.telefonos) if (ahora - ts >= UN_DIA_MS) e.telefonos.delete(telefono);
  e.bienvenidas = e.bienvenidas.filter((ts) => ahora - ts < UN_DIA_MS);
  for (const [ip, lista] of e.ips) {
    const vivas = lista.filter((ts) => ahora - ts < UNA_HORA_MS);
    if (vivas.length === 0) e.ips.delete(ip);
    else if (vivas.length !== lista.length) e.ips.set(ip, vivas);
  }
}

const DEMASIADAS = { ok: false, status: 429, error: TEXTO_DEMASIADAS } as const;

export function frenar(
  p: { ip: string | null; telefono: string; web?: string },
  ahora: number,
  modoServidor: boolean,
): { ok: true } | { ok: false; status: 429; error: string } | { ok: false; trampa: true } {
  if (typeof p.web === "string" && p.web.trim() !== "") return { ok: false, trampa: true };
  if (!modoServidor) return { ok: true };

  const e = estado();
  podar(e, ahora);
  if (e.telefonos.has(p.telefono)) return DEMASIADAS;
  if (p.ip !== null && (e.ips.get(p.ip)?.length ?? 0) >= PETICIONES_POR_IP_Y_HORA) return DEMASIADAS;
  if (e.bienvenidas.length >= BIENVENIDAS_POR_DIA) return DEMASIADAS;
  if (p.ip !== null) e.ips.set(p.ip, [...(e.ips.get(p.ip) ?? []), ahora]);
  return { ok: true };
}

/** Una bienvenida que ha salido de verdad: solo entonces cuenta para ese teléfono y para el día. */
export function anotarBienvenida(telefono: string, ahora: number): void {
  const e = estado();
  podar(e, ahora);
  e.telefonos.set(telefono, ahora);
  e.bienvenidas.push(ahora);
}

/** La IP del visitante: la última entrada de X-Forwarded-For, la que añade Caddy. */
export function ipDeCabecera(xff: string | null): string | null {
  if (!xff) return null;
  const ultima = xff.split(",").at(-1)?.trim();
  return ultima ? ultima : null;
}
