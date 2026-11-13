// Los errores que ve el dueño, explicados en español y con lo que puede hacer. Puro: ningún texto
// nombra un archivo ni un comando (I17) ni lleva una clave.

import type { PasoPuesta } from "./api-tipos";

export type CodigoError =
  | "meta.token" | "meta.lista" | "meta.variables" | "meta.bienvenida" | "meta.ventana" | "meta.numero" | "meta.calidad" | "meta.firma" | "meta.permisos" | "meta.otro"
  | "claude.clave" | "claude.saldo" | "claude.modelo" | "claude.ocupado"
  | "ngrok.token" | "ngrok.ocupado" | "ngrok.dominio"
  | "bd.ocupada" | "bd.conexion" | "red" | "sesion" | "desconocido";
export interface ErrorExplicado { codigo: CodigoError; titulo: string; solucion: string; paso?: PasoPuesta; enlace?: string }

const OTRA_VEZ = "Vuelve a intentarlo en un momento.";

const TABLA: Record<CodigoError, { titulo: string; solucion: string; paso?: PasoPuesta }> = {
  "meta.token": {
    titulo: "El token de Meta no vale o ha caducado",
    solucion: "Pega el token permanente del usuario del sistema, no el de la pantalla de inicio de Meta, que caduca en 24 h.",
    paso: "whatsapp",
  },
  "meta.lista": {
    titulo: "Ese móvil no está en la lista de prueba de Meta",
    solucion: "Añádelo en tu app de Meta (WhatsApp → Configuración de la API) y vuelve a enviar.",
    paso: "primer",
  },
  "meta.variables": {
    titulo: "El mensaje aprobado no recibe los datos que espera",
    solucion: "Revisa en Ajustes → Avanzado que el texto lleve {{1}} y {{2}}.",
  },
  "meta.bienvenida": {
    titulo: "Meta aún no ha aprobado tu mensaje de bienvenida",
    solucion: "Mientras tanto tu asistente contesta a quien te escriba por WhatsApp. Míralo en Ajustes → Conexiones.",
    paso: "primer",
  },
  "meta.ventana": {
    titulo: "Han pasado más de 24 h desde su último mensaje",
    solucion: "WhatsApp solo deja escribirle con un mensaje aprobado.",
  },
  "meta.numero": { titulo: "Ese número no puede recibir WhatsApp", solucion: "Compruébalo con el cliente." },
  "meta.calidad": {
    titulo: "Meta no lo ha entregado para cuidar la calidad de tu número",
    solucion: "Espera un poco antes de volver a escribirle.",
  },
  "meta.firma": {
    titulo: "Llegan avisos de Meta, pero la firma no coincide",
    solucion: "Vuelve a pegar la clave secreta de la app en Ajustes → Conexiones.",
    paso: "whatsapp",
  },
  "meta.permisos": {
    titulo: "Tu token no tiene permiso para esto",
    solucion: "Dale al usuario del sistema los permisos de WhatsApp de tu app y vuelve a pegar el token.",
    paso: "whatsapp",
  },
  "meta.otro": { titulo: "Meta ha rechazado el envío", solucion: OTRA_VEZ },
  "claude.clave": { titulo: "Esa clave no es válida", solucion: "Cópiala otra vez de platform.claude.com → API Keys.", paso: "claude" },
  "claude.saldo": { titulo: "Tu cuenta de Anthropic no tiene saldo", solucion: "Añádelo en Billing y pulsa Reintentar.", paso: "claude" },
  "claude.modelo": { titulo: "Tu clave no tiene acceso a ese modelo", solucion: "Elige el otro modelo en Ajustes → Avanzado." },
  "claude.ocupado": { titulo: "Claude está saturado ahora mismo", solucion: OTRA_VEZ },
  "ngrok.token": { titulo: "Esa clave de ngrok no vale", solucion: "Cópiala de dashboard.ngrok.com → Your Authtoken.", paso: "whatsapp" },
  "ngrok.ocupado": { titulo: "Tu túnel ya está abierto en otro ordenador", solucion: "Ciérralo allí y vuelve a intentarlo.", paso: "whatsapp" },
  "ngrok.dominio": {
    titulo: "Ese dominio de ngrok no es de tu cuenta",
    solucion: "Usa el de tu cuenta o pide ayuda a quien te lo instaló.",
    paso: "whatsapp",
  },
  "bd.ocupada": { titulo: "Ya hay un CRM abierto con estos datos en este ordenador.", solucion: "Ciérralo antes de abrir otro." },
  "bd.conexion": {
    titulo: "El CRM no llega a tus datos",
    solucion: "Revisa la conexión a internet; si usas Supabase, que el proyecto no esté en pausa.",
  },
  red: { titulo: "Sin conexión con el servidor", solucion: OTRA_VEZ },
  sesion: { titulo: "Tienes que entrar con tu contraseña", solucion: "" },
  desconocido: { titulo: "Algo ha fallado", solucion: OTRA_VEZ },
};

/** Un error con su código. El mensaje es el detalle o, sin él, el título. */
export class ErrorCrm extends Error {
  constructor(
    readonly codigo: CodigoError,
    detalle?: string,
  ) {
    super(detalle ?? TABLA[codigo]?.titulo ?? TABLA.desconocido.titulo);
    this.name = "ErrorCrm";
  }
}

/** El título, la solución y el paso de la puesta en marcha. En `meta.otro`, el detalle es el título de Meta. */
export function explicar(codigo: CodigoError, detalle?: string): ErrorExplicado {
  const fila = TABLA[codigo] ?? TABLA.desconocido;
  const real = TABLA[codigo] ? codigo : "desconocido";
  const solucion = real === "meta.otro" ? detalle?.trim() || OTRA_VEZ : fila.solucion;
  return { codigo: real, titulo: fila.titulo, solucion, ...(fila.paso ? { paso: fila.paso } : {}) };
}

/** Los códigos de error de la API de Meta. */
export function explicarMeta(codigo?: number, titulo?: string): ErrorExplicado {
  const fijos: Record<number, CodigoError> = {
    190: "meta.token",
    131030: "meta.lista",
    132000: "meta.variables",
    132001: "meta.bienvenida",
    131047: "meta.ventana",
    131026: "meta.numero",
    131049: "meta.calidad",
  };
  if (codigo !== undefined && fijos[codigo]) return explicar(fijos[codigo]);
  if (codigo === 10 || (codigo !== undefined && codigo >= 200 && codigo <= 299)) return explicar("meta.permisos");
  // El 100 también es «Invalid parameter»: solo es de permisos si el título lo dice.
  if (codigo === 100 && /permis/i.test(titulo ?? "")) return explicar("meta.permisos");
  return explicar("meta.otro", titulo);
}

/** Las respuestas de error de la API de Claude. Sin estado, no hubo respuesta: la red. */
export function explicarClaude(status?: number, mensaje?: string): ErrorExplicado {
  if (status === undefined) return explicar("red");
  if (status === 401) return explicar("claude.clave");
  if (status === 400 && /credit balance/i.test(mensaje ?? "")) return explicar("claude.saldo");
  if (status === 404) return explicar("claude.modelo");
  if (status === 429 || status === 529) return explicar("claude.ocupado");
  return explicar("desconocido");
}

function campo(e: unknown, clave: string): unknown {
  return typeof e === "object" && e !== null ? (e as Record<string, unknown>)[clave] : undefined;
}

/** Los errores de ngrok llevan un código ERR_NGROK_<n>. */
export function explicarNgrok(e: unknown): ErrorExplicado {
  let numero: number | null = null;
  for (const fuente of [campo(e, "errorCode"), campo(e, "code"), campo(e, "message"), String(e)]) {
    if (typeof fuente !== "string") continue;
    const m = fuente.match(/ERR_NGROK_(\d+)/);
    if (m) {
      numero = Number(m[1]);
      break;
    }
  }
  if (numero === 105 || numero === 107 || numero === 4018) return explicar("ngrok.token");
  if (numero === 334) return explicar("ngrok.ocupado");
  if (numero === 313 || numero === 320 || numero === 15013) return explicar("ngrok.dominio");
  return explicar("desconocido");
}

/** Los errores de la base de datos: ocupada por otro CRM o inalcanzable. */
export function explicarBd(e: unknown): ErrorExplicado {
  if (e instanceof ErrorCrm && e.codigo === "bd.ocupada") return explicar("bd.ocupada");
  const textos = [campo(e, "message"), campo(e, "code"), typeof e === "string" ? e : undefined].filter((t): t is string => typeof t === "string");
  if (textos.some((t) => /password|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|paused/i.test(t))) return explicar("bd.conexion");
  return explicar("desconocido");
}
