"use client";

import { Inter_Tight } from "next/font/google";
import { useEffect } from "react";
import "./globals.css";

const interTight = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "600"], variable: "--fuente-inter" });

// Lo que se ve si falla el diseño raíz: sustituye a app/layout.tsx, así que trae su propio documento,
// sus estilos y su título. Nunca enseña el mensaje técnico: queda en la consola.

export default function ErrorGlobal({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es" className={interTight.variable}>
      <body>
        <title>Algo ha fallado</title>
        <main className="flex min-h-screen flex-col items-center justify-center bg-fondo px-5 text-center text-tinta">
          <h1 className="text-[clamp(36px,6vw,56px)] leading-[1] font-light tracking-[-0.03em] uppercase">Algo ha fallado</h1>
          <p className="mt-4 text-[17px] leading-6 text-secundario">Vuelve a intentarlo.</p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-8 inline-flex h-[52px] cursor-pointer items-center rounded-full bg-tinta px-8 text-[15px] font-semibold text-white transition-colors duration-200 ease-out hover:bg-[#2b2b2b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
