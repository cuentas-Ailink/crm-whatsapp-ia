import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FormularioEntrar } from "@/cliente/configuracion/acceso";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { REGLA_CLAVE_PANEL } from "@/lib/sesion";
import { modoServidor } from "@/lib/tunel";

// Entrar al panel en modo servidor (o crear la contraseña la primera vez). En local no hay
// contraseña: se va directo al panel. Solo se leen sí o no del entorno, nunca un valor.

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Entrar({ searchParams }: PageProps<"/entrar">) {
  if (!modoServidor()) redirect("/panel");
  const parametros = await searchParams;
  const crudo = parametros.volver;
  const volver = typeof crudo === "string" ? crudo : null;
  const c = await configuracionParaPintar();
  const situacion = process.env.CLAVE_PANEL_HASH ? "entrar" : process.env.CODIGO_ALTA ? "crear" : "sin-codigo";
  const logoUrl = c.negocio.logoUrl?.startsWith("/api/logo?") ? c.negocio.logoUrl : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-fondo px-4 py-10">
      <FormularioEntrar situacion={situacion} negocio={c.negocio.nombre} logoUrl={logoUrl} volver={volver} minimo={REGLA_CLAVE_PANEL.minimo} />
    </main>
  );
}
