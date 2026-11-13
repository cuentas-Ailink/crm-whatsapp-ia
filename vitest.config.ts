import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { env: { BD_LOCAL: "memoria" }, include: ["lib/**/*.test.ts"] },
});
