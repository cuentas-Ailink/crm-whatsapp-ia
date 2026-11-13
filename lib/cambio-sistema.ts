// Cuando algo cambia de verdad las conexiones (una clave guardada o borrada, «Conectar», el móvil de
// pruebas que se vincula o se desvincula, «Arreglar»): se olvida lo guardado de /api/sistema
// (lib/sistema.ts) y se avisa al panel con un cambio «sistema». Así la línea de estado no se queda en
// rojo con lo de antes: la siguiente petición vuelve a mirar. Solo en el servidor.

import { avisarCambio } from "./eventos";

type Global = { __sistemaConexiones?: unknown; __sistemaComprobaciones?: unknown };

/** Lo guardado de las conexiones se olvida: lo siguiente que pida /api/sistema mira todo otra vez. */
export function olvidarConexiones(): void {
  const g = globalThis as unknown as Global;
  delete g.__sistemaConexiones;
  delete g.__sistemaComprobaciones;
}

/** Olvida lo guardado y avisa al panel (que vuelve a pedir /api/sistema al momento). */
export function cambioDeSistema(): void {
  olvidarConexiones();
  avisarCambio("sistema");
}
