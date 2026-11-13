// La búsqueda de clientes del panel: el campo de la barra lateral y ⌘K. Sin tildes ni mayúsculas;
// por nombre, zona, email, etiquetas y datos, y por teléfono a partir de tres cifras. Puro (I3).

import type { Lead } from "./tipos";
import { normalizar, valorCampo, type CampoLead } from "./vocabulario";

const MAXIMO = 20;
const LETRA = /\p{L}/u;

/** Los textos de un cliente en los que se busca, ya normalizados. */
function textosDe(lead: Lead, campos?: CampoLead[]): string[] {
  const datos = Object.entries(lead.datos ?? {}).flatMap(([clave, valor]) =>
    campos ? [valor, valorCampo(clave, valor, campos)] : [valor],
  );
  return [lead.nombre, lead.zona, lead.email, ...(lead.etiquetas ?? []), ...datos]
    .filter((t): t is string => typeof t === "string" && t !== "")
    .map(normalizar);
}

/**
 * Los clientes que encajan con la consulta: cada palabra tiene que aparecer en alguno de sus textos.
 * Una consulta sin letras y con al menos tres cifras busca además en el teléfono («612», «+34 612»).
 * Del que se movió hace menos al que más; como mucho `max` (20).
 */
export function buscar(leads: Lead[], consulta: string, o?: { campos?: CampoLead[]; max?: number }): Lead[] {
  const q = normalizar(consulta);
  if (q === "") return [];
  const palabras = q.split(" ");
  const cifras = LETRA.test(q) ? "" : q.replace(/\D/g, "");
  const porTelefono = cifras.length >= 3;
  return leads
    .filter((lead) => {
      if (porTelefono && lead.telefono.includes(cifras)) return true;
      const textos = textosDe(lead, o?.campos);
      return palabras.every((p) => textos.some((t) => t.includes(p)));
    })
    .sort((a, b) => b.actualizadoEn - a.actualizadoEn)
    .slice(0, o?.max ?? MAXIMO);
}
