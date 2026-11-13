// Las formas HTTP que comparten el servidor y el navegador. Solo tipos: se importa desde el navegador.

import type {
  ConfiguracionPerfil,
  ConfiguracionResuelta,
  ConfiguracionSistema,
  ParcialProfundo,
  Plantilla,
  RevisionPrompt,
  SectorId,
  SectorPreset,
  Web,
} from "./configuracion";
import type { CodigoError } from "./errores";
import type { Entorno } from "./presets";
import type { EstadoLead, Hueco, Lead, Mutacion, Reserva } from "./tipos";

// Event payloads live here (pure, importable from the browser); lib/eventos.ts imports them.
export type TipoCambio = "leads" | "configuracion" | "escribiendo" | "sistema";
export interface Cambio { tipo: TipoCambio; rev: number }
export interface Llegada { leadId: string /* idDeLead: se conoce antes de llamar a Meta */; nombre: string /* nombre de pila */; canal: "formulario" | "whatsapp" | "manual"; inicio: number /* ms, reloj del servidor */ }
export interface LlegadaFallida { leadId: string; nombre: string; codigo: CodigoError; texto: string /* título de errores.ts */ }
export type EventoPanel = { tipo: "cambio"; cambio: Cambio } | { tipo: "llegada"; llegada: Llegada } | { tipo: "llegada-fallida"; fallo: LlegadaFallida } | { tipo: "hora"; desfaseMs: number };
export interface EstadoLlegada { leadId: string; nombre: string; canal: Llegada["canal"]; inicio: number; fin: number | null; fallo: { codigo: CodigoError; texto: string } | null; enDirecto: boolean }

export type Puesta = { negocio: boolean; claude: boolean; whatsapp: boolean; mensajes: boolean; primerMensaje: boolean };
export type PasoPuesta = "negocio" | "claude" | "whatsapp" | "primer";
export interface EstadoApp {                     // GET /api/estado — "bd" stays the first key
  bd: { ok: boolean; leads?: number };
  perfil: { id: string; nombre: string } | null;
  pruebas: boolean;                              // Boolean(process.env.BD_LOCAL): the E2E guard
  modo: "local" | "servidor";                    // "servidor" iff CRM_DOMINIO
  modoWhatsApp: "oficial" | "prueba";            // "prueba": WhatsApp por QR (lib/modo-prueba.ts), solo en local
  puesta: Puesta;                                // only booleans, computed from reality (lib/sistema.ts)
  numero: { texto: string; enlace: string } | null;   // «+34 600 000 000», «https://wa.me/34600000000?text=Hola»
  configuracion: { sector: SectorId; base: SectorPreset; negocio: { nombre: string }; plantilla: Plantilla; web: Web; guardada: boolean; ejemplosDe: string | null; firma: string };
}
export interface RespuestaConfiguracion {        // GET /api/configuracion
  activa: ConfiguracionResuelta;
  guardada: { perfil: ConfiguracionPerfil; sistema: ParcialProfundo<ConfiguracionSistema>; rev: number };
  entorno: Entorno;                              // NOMBRE_NEGOCIO, PLANTILLA, PLANTILLA_IDIOMA: never a key
  prompt: { texto: string; hash: string; revision: RevisionPrompt; sistema: string /* vistaPreviaContexto */; versionNueva: boolean; informacion: string /* cuerpo de «Información que puedes dar tal cual» */ };
  sectores: { id: SectorPreset; etiqueta: string; descripcion: string; perfilId: string | null; plantilla: Plantilla }[];
  ejemplos: { ejemplo: number; reales: number; de: string | null; leadsPrueba: boolean };
  avisos: string[];
}
export type EstadoFila = "ok" | "atencion" | "error";
export interface FilaConexion {
  id: "claude" | "whatsapp" | "mensajes" | "datos" | "acceso";
  nombre: string;              // «Claude (tu asistente)», «WhatsApp», «Mensajes que llegan a este ordenador» (servidor: «… a tu servidor»), «Tus datos», «Acceso» (solo si falla)
  estado: EstadoFila; detalle: string;
  accion?: { texto: "Arreglar" | "Cambiar"; paso?: PasoPuesta; arreglar?: "webhook" | "suscripcion" | "tunel" };
}
export interface EstadoConexiones {
  comprobadoEn: number; resumen: EstadoFila; filas: FilaConexion[];
  numeroDePrueba: boolean;     // fila ámbar fija «Número de prueba de Meta…»
  comprobaciones?: { id: string; ok: boolean | null; texto: string; solucion?: string }[]; // solo con ?completo=1 (comprobar.mjs)
}
export type IdPlantillaApp = "bienvenida" | "aviso" | "retomar";
export interface EstadoPlantilla { id?: IdPlantillaApp; nombre: string; idioma: string; estado: "APROBADA" | "EN_REVISION" | "RECHAZADA" | "PAUSADA" | "NO_EXISTE" | "SIN_CLAVES" | "ERROR"; categoria?: string; motivo?: string; texto?: string }
export interface PlantillaAprobada { nombre: string; idioma: string; categoria: string; texto: string; variables: number[] }
export type NombreClave = "ANTHROPIC_API_KEY" | "WHATSAPP_TOKEN" | "META_APP_SECRET" | "NGROK_AUTHTOKEN" | "GEMINI_API_KEY" | "GROQ_API_KEY" | "OPENAI_API_KEY"
  | "WEBHOOK_VERIFY_TOKEN" | "WHATSAPP_PHONE_NUMBER_ID" | "WHATSAPP_BUSINESS_ACCOUNT_ID" | "SESION_SECRETO" | "CLAVE_PANEL_HASH" | "CODIGO_ALTA";
export interface EstadoClave { nombre: NombreClave; guardada: boolean; terminaEn: string | null }
export type PasoMeta = "claves" | "cuenta" | "numero" | "tunel" | "suscripcion" | "webhook" | "firma";
export interface PeticionConectarMeta { paso: PasoMeta; token?: string; secreto?: string; ngrok?: string; waba?: string; numero?: string }
export interface ResultadoPasoMeta {
  paso: PasoMeta; ok: boolean; texto: string;                     // texto en verde: «Cuenta de WhatsApp de {nombre verificado}», «{número} · {nombre}», «Túnel abierto: los mensajes llegan a este ordenador», «Tu app escucha esta cuenta», «Meta avisa a este ordenador», «Firma comprobada»
  error?: { titulo: string; solucion: string; codigo: CodigoError };
  opciones?: { id: string; texto: string }[];                     // cuentas o números para elegir cuando hay varios
  siguiente: PasoMeta | null;
}
export interface PeticionPrueba {
  prueba: { origen: "formulario" | "whatsapp"; nombre: string; estado: EstadoLead;
            mensajes: { de: "cliente" | "agente"; texto: string; ts: number; plantilla?: boolean }[];
            datos: Record<string, string>; huecosOfrecidos: Hueco[]; visita?: Hueco; silenciadoEn?: number };
}
export interface ResultadoPrueba {
  decision: "contesta" | "silencio" | "spam" | "baja" | "persona";
  texto: string | null; mutaciones: Mutacion[]; eventos: string[]; persona?: string; descartes: string[]; fallo?: string;
  uso: { entrada: number; cacheLeida: number; salida: number }; costeUsd: number; ms: number; modelo: string; notas: string[];
}
export interface DatosDeCliente { formato: "crm-whatsapp/cliente@1"; exportadoEn: string; negocio: string; cliente: Lead; citas: Reserva[] }
export interface ErrorApi { ok: false; error: string; codigo?: CodigoError; campo?: string; causa?: string }
// En modo servidor, sin sesión: 401 { ok: false, error: "Tienes que entrar con tu contraseña", codigo: "sesion" }
