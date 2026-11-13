// La marca del negocio en las cabeceras de la portada: su logo si lo ha subido, si no su nombre.

export function MarcaNegocio(p: { nombre: string; logoUrl: string | null; fondo: "oscuro" | "claro" }) {
  // Solo el logo que sirve el propio CRM: cualquier otra dirección se ignora (I10).
  if (p.logoUrl?.startsWith("/api/logo?")) {
    const logo = <img src={p.logoUrl} alt={p.nombre} className="block h-7 max-w-[160px] object-contain" />;
    return p.fondo === "oscuro" ? <span className="inline-flex w-fit rounded-md bg-white px-2 py-1">{logo}</span> : logo;
  }
  // Un nombre largo pasa a dos líneas; nunca se corta con «…».
  return <span className="min-w-0 text-[15px] leading-5 font-medium text-balance break-words">{p.nombre}</span>;
}
