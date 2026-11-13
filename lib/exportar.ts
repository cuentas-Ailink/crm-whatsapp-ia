import { ZONA } from "./agenda";
import { vinoDeLaWeb } from "./fuente";
import { esEjemplo } from "./negocio";
import { MONEDAS, simboloMoneda, type Moneda } from "./regional";
import type { Lead, OrigenLead } from "./tipos";
import { cap, frases, nombresEtapa, VOCABULARIO_REFORMAS, type Vocabulario } from "./vocabulario";

// La hoja que se descarga desde Ajustes («Descargar en Excel (CSV)»). Separada por punto y coma, que
// es la que abre Excel en español, y con BOM para que las tildes no salgan rotas. Las 15 primeras
// columnas no cambian de sitio (hay hojas hechas sobre ellas); lo nuevo va al final. Puro.

const LLEGO_POR: Record<OrigenLead, string> = {
  formulario: "Tu web",
  whatsapp: "WhatsApp",
  manual: "Añadido a mano",
  prueba: "Ejemplo",
};

/** Un valor en su celda: entre comillas si lleva el separador, comillas o saltos de línea. */
export function celda(valor: string | number | undefined): string {
  const texto = valor === undefined ? "" : String(valor);
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function csvDeLeads(leads: Lead[], o?: { vocabulario?: Vocabulario; zona?: string; moneda?: Moneda }): string {
  const vocabulario = o?.vocabulario ?? VOCABULARIO_REFORMAS;
  const zona = o?.zona ?? ZONA;
  const moneda = o?.moneda ?? "EUR";
  const f = frases(vocabulario, { simbolo: simboloMoneda(moneda), nombre: MONEDAS[moneda].nombre });
  const etapas = nombresEtapa(vocabulario);
  const fechaHora = new Intl.DateTimeFormat("es-ES", {
    timeZone: zona,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const cabecera = [
    "Creado",
    "Nombre",
    "Teléfono",
    "Perfil",
    "Llegó por",
    "Etapa",
    vocabulario.zona ?? "Zona",
    "Email",
    f.importeConSimbolo,
    f.cobradoConSimbolo,
    cap(vocabulario.cita.singular),
    "Pendientes",
    "Notas",
    "Datos",
    "Etiquetas",
    "Resultado",
    "Importe final",
    "Motivo",
  ];
  const filas = [...leads]
    .sort((a, b) => a.creadoEn - b.creadoEn)
    .map((l) => [
      fechaHora.format(l.creadoEn),
      l.nombre,
      esEjemplo(l) ? "(ejemplo)" : `+${l.telefono}`,
      l.perfilNombre,
      vinoDeLaWeb(l) ? "Tu web, por WhatsApp" : (LLEGO_POR[l.origen] ?? l.origen),
      etapas[l.estado].nombre + (l.silenciadoEn ? " · no quiere mensajes" : ""),
      l.zona,
      l.email,
      l.presupuesto,
      l.cobrado,
      l.visita?.texto,
      (l.tareas ?? []).filter((t) => !t.hecha).length,
      (l.notas ?? []).map((n) => n.texto).join(" | "),
      Object.entries(l.datos)
        .map(([campo, valor]) => `${campo}: ${valor}`)
        .join(" · "),
      (l.etiquetas ?? []).join(", "),
      l.cierre === "si" ? f.haDichoQueSi : l.cierre === "no" ? f.noSigue : undefined,
      l.cierre === "si" ? l.presupuesto : undefined,
      l.cierre === "no" ? l.motivoCierre : undefined,
    ]);
  return ["﻿" + cabecera.map(celda).join(";"), ...filas.map((fila) => fila.map(celda).join(";"))].join("\r\n") + "\r\n";
}
