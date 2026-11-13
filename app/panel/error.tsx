"use client";

import { useEffect } from "react";

// Si el panel no puede leer los datos (la base de datos no responde), esto en vez de la página de
// error de Next. «Reintentar» vuelve a pedir los datos al servidor.

export default function ErrorDelPanel({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-lienzo px-4">
      <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
        <span aria-hidden className="size-2.5 rounded-full bg-error" />
        <h1 className="text-[20px] leading-7 font-medium tracking-[-0.01em]">No se han podido cargar tus clientes</h1>
        <p className="text-[14px] leading-5 text-secundario">El panel no consigue leer la base de datos.</p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-3 h-10 cursor-pointer rounded-[8px] bg-tinta px-5 text-[14px] font-medium text-white transition-colors duration-150 ease-out hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        >
          Reintentar
        </button>
      </div>
    </main>
  );
}
