import type { Metadata } from "next";
import { connection } from "next/server";
import { Panel } from "@/cliente/panel";
import { configuracionParaPintar, leerBdConConfiguracion } from "@/lib/configuracion-servidor";

export async function generateMetadata(): Promise<Metadata> {
  // En ejecución, no al compilar: el nombre del negocio se cambia en Ajustes sin volver a compilar.
  await connection();
  const c = await configuracionParaPintar();
  return {
    title: c.negocio.nombre,
    description: "Contesta a tus clientes por WhatsApp en segundos, les da cita y te avisa cuando te toca a ti.",
  };
}

export default async function PaginaPanel() {
  await connection();
  return <Panel inicial={await leerBdConConfiguracion()} />;
}
