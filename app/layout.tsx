import type { Metadata } from "next";
import { DM_Mono, Inter_Tight } from "next/font/google";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { colorTexto } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import "./globals.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--fuente-inter",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--fuente-mono",
});

const COLOR_VALIDO = /^#[0-9a-fA-F]{6}$/;

export async function generateMetadata(): Promise<Metadata> {
  // En ejecución, no al compilar: el nombre y el logo se cambian en Ajustes sin volver a compilar.
  await connection();
  const c = await configuracionParaPintar();
  const logo = c.negocio.logoUrl?.startsWith("/api/logo?") ? c.negocio.logoUrl : null;
  return {
    title: c.negocio.nombre,
    description: "Contesta a tus clientes por WhatsApp en segundos, les da cita y te avisa cuando te toca a ti.",
    applicationName: "CRM de WhatsApp con IA",
    icons: { icon: logo ?? "/icono.svg" },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const c = await configuracionParaPintar();
  // El color del negocio pinta los acentos de marca; cualquier otra cosa deja el verde clásico.
  const color = c.negocio.color;
  const estilo =
    color && COLOR_VALIDO.test(color) ? ({ "--color-marca": color, "--color-marca-texto": colorTexto(color) } as CSSProperties) : undefined;

  return (
    <html lang="es" className={`${interTight.variable} ${dmMono.variable}`} style={estilo}>
      <body>{children}</body>
    </html>
  );
}
