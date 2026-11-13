import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CLAUDE.md describe el proyecto para Claude Code: Next no debe añadir ni tocar archivos de agentes.
  agentRules: false,
  logging: { incomingRequests: false },
  images: { unoptimized: true },
  // Los dos motores de la base de datos se cargan tal cual desde node_modules: PGlite trae su
  // propio Postgres en WebAssembly y no se puede empaquetar. El túnel de ngrok es un módulo
  // nativo y también se carga tal cual.
  serverExternalPackages: ["postgres", "@electric-sql/pglite", "@ngrok/ngrok"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
