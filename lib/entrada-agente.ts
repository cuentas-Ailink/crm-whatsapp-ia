// Lo que necesita el asistente para contestar, montado en un solo sitio a partir del perfil y de la
// configuración activa: así el servidor y «Probar tu asistente» le dan exactamente lo mismo.

import type { LanguageModel } from "ai";
import type { EntradaAgente, InfoIntento } from "./agente";
import { componerInstrucciones, configAgenteDe, modeloEfectivo, type ConfiguracionResuelta } from "./configuracion";
import type { Perfil } from "./perfil";
import type { Lead, Reserva } from "./tipos";

export interface ParamsEntrada {
  perfil: Perfil;
  config: ConfiguracionResuelta;
  lead: Lead;
  reservas: Reserva[];
  senal: AbortSignal;
  ahora?: Date;
  idModelo?: string;
  alIntento?: (i: InfoIntento) => void;
  modelo?: LanguageModel;
}

export function entradaParaAgente(p: ParamsEntrada): EntradaAgente {
  return {
    instrucciones: componerInstrucciones(p.perfil.instrucciones, p.config),
    lead: p.lead,
    reservas: p.reservas,
    ahora: p.ahora ?? new Date(),
    senal: p.senal,
    ...(p.modelo ? { modelo: p.modelo } : {}),
    config: configAgenteDe(p.config),
    idModelo: p.idModelo ?? modeloEfectivo(p.config.sistema, process.env.MODELO),
    ...(p.alIntento ? { alIntento: p.alIntento } : {}),
  };
}
