// Invariantes del CRM comprobados leyendo el código fuente (vitest corre en Node). Es un test heurístico:
// cada comprobación es sencilla y sus excepciones van comentadas al lado. Todo fallo nombra archivo y línea.
// W23 lo amplía en la fase 7 con los mismos ayudantes de arriba: el recorrido de archivos y el extractor de
// literales y texto JSX.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decidirAcceso, RUTAS_PUBLICAS_SERVIDOR, type DecisionAcceso, type PeticionAcceso } from "./acceso";

// ─── Ayudantes compartidos ────────────────────────────────────────────────────────────────────────

const RAIZ = path.resolve(__dirname, "..");

/** Lee un archivo relativo a la raíz del proyecto. */
export function leer(rel: string): string {
  return readFileSync(path.join(RAIZ, rel), "utf8");
}

/**
 * Los archivos de código bajo `dirs` (rutas relativas a la raíz), recursivo. Se saltan las pruebas
 * (`*.test.ts`), `lib/__golden__/` y `node_modules`; `extensiones` filtra por final de nombre.
 */
export function recorrer(dirs: string[], extensiones: string[] = [".ts", ".tsx"]): string[] {
  const salida: string[] = [];
  const visitar = (rel: string) => {
    const abs = path.join(RAIZ, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      const base = path.basename(rel);
      if (rel === "lib/__golden__" || base === "node_modules" || base === ".next") return;
      for (const nombre of readdirSync(abs).sort()) visitar(`${rel}/${nombre}`);
      return;
    }
    if (/\.test\.tsx?$/.test(rel)) return;
    if (extensiones.some((e) => rel.endsWith(e))) salida.push(rel);
  };
  for (const d of dirs) visitar(d);
  return salida;
}

export interface Literal {
  linea: number;
  texto: string;
  tipo: "cadena" | "plantilla" | "jsx";
}

export interface Analisis {
  /** El código sin comentarios (los saltos de línea se conservan, así que las líneas cuadran). */
  sinComentarios: string;
  /** Además, el contenido de cadenas y plantillas cambiado por espacios. */
  sinTextos: string;
  /** Las cadenas y plantillas («${…}» se queda como «…») y el texto JSX, con la línea donde empiezan. */
  literales: Literal[];
}

const ANTES_DE_REGEX = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const PALABRAS_ANTES_DE_REGEX = /\b(return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

/**
 * Recorre el código carácter a carácter: quita comentarios, saca las cadenas ("…", '…', `…`) y salta las
 * expresiones regulares literales. Es un analizador pequeño, no un parser: basta para este código.
 */
export function analizar(codigo: string): Analisis {
  const n = codigo.length;
  let sinComentarios = "";
  let sinTextos = "";
  const literales: Literal[] = [];
  let linea = 1;
  let i = 0;
  // Cada nivel de plantilla abierta guarda cuántas llaves de su «${…}» siguen abiertas.
  const plantillas: { llaves: number; texto: string; linea: number }[] = [];
  let ultimo = ""; // el último carácter significativo fuera de cadenas y comentarios

  const poner = (c: string, enTexto: boolean) => {
    sinComentarios += c;
    sinTextos += enTexto && c !== "\n" ? " " : c;
    if (c === "\n") linea++;
  };

  const leerPlantilla = () => {
    // Dentro del texto de una plantilla, hasta «`» o «${».
    const actual = plantillas[plantillas.length - 1];
    while (i < n) {
      const c = codigo[i];
      if (c === "\\") {
        actual.texto += codigo.slice(i, i + 2);
        poner(codigo[i], true);
        if (i + 1 < n) poner(codigo[i + 1], true);
        i += 2;
        continue;
      }
      if (c === "`") {
        poner(c, false);
        i++;
        plantillas.pop();
        literales.push({ linea: actual.linea, texto: actual.texto, tipo: "plantilla" });
        ultimo = "`";
        return;
      }
      if (c === "$" && codigo[i + 1] === "{") {
        actual.texto += "…";
        poner("$", false);
        poner("{", false);
        i += 2;
        actual.llaves = 1;
        ultimo = "{";
        return;
      }
      actual.texto += c;
      poner(c, true);
      i++;
    }
  };

  while (i < n) {
    const c = codigo[i];
    const sig = codigo[i + 1];
    // Comentarios
    if (c === "/" && sig === "/") {
      while (i < n && codigo[i] !== "\n") {
        poner(" ", false);
        i++;
      }
      continue;
    }
    if (c === "/" && sig === "*") {
      i += 2;
      poner(" ", false);
      poner(" ", false);
      while (i < n && !(codigo[i] === "*" && codigo[i + 1] === "/")) {
        poner(codigo[i] === "\n" ? "\n" : " ", false);
        i++;
      }
      i += 2;
      poner(" ", false);
      poner(" ", false);
      continue;
    }
    // Cadenas
    if (c === '"' || c === "'") {
      const inicio = linea;
      let texto = "";
      poner(c, false);
      i++;
      while (i < n && codigo[i] !== c && codigo[i] !== "\n") {
        if (codigo[i] === "\\") {
          texto += codigo.slice(i, i + 2);
          poner(codigo[i], true);
          if (i + 1 < n) poner(codigo[i + 1], true);
          i += 2;
          continue;
        }
        texto += codigo[i];
        poner(codigo[i], true);
        i++;
      }
      if (codigo[i] === c) {
        poner(c, false);
        i++;
      }
      literales.push({ linea: inicio, texto, tipo: "cadena" });
      ultimo = c;
      continue;
    }
    if (c === "`") {
      poner(c, false);
      i++;
      plantillas.push({ llaves: 0, texto: "", linea });
      leerPlantilla();
      continue;
    }
    // Llaves de un «${…}»: al cerrar la última se vuelve al texto de la plantilla.
    if (plantillas.length > 0 && plantillas[plantillas.length - 1].llaves > 0) {
      const actual = plantillas[plantillas.length - 1];
      if (c === "{") actual.llaves++;
      if (c === "}") {
        actual.llaves--;
        if (actual.llaves === 0) {
          poner(c, false);
          i++;
          leerPlantilla();
          continue;
        }
      }
    }
    // Expresiones regulares literales
    if (c === "/") {
      const previo = sinComentarios.trimEnd();
      if (ANTES_DE_REGEX.has(ultimo) || PALABRAS_ANTES_DE_REGEX.test(previo)) {
        let enClase = false;
        poner(c, false);
        i++;
        while (i < n && codigo[i] !== "\n") {
          const d = codigo[i];
          if (d === "\\") {
            poner(d, true);
            if (i + 1 < n) poner(codigo[i + 1], true);
            i += 2;
            continue;
          }
          if (d === "[") enClase = true;
          else if (d === "]") enClase = false;
          else if (d === "/" && !enClase) break;
          poner(d, true);
          i++;
        }
        if (codigo[i] === "/") {
          poner("/", false);
          i++;
        }
        ultimo = "/regex";
        continue;
      }
    }
    poner(c, false);
    if (!/\s/.test(c)) ultimo = c;
    i++;
  }

  // Texto JSX: lo que va entre «>» o «}» y «<» o «{» fuera de cadenas, con alguna letra y sin pinta de código
  // (sobra algo de código suelto, como «else»: no importa, solo se buscan palabras concretas).
  const lineas = sinComentarios.split("\n");
  const inicioDe: number[] = [];
  let acumulado = 0;
  for (const l of lineas) {
    inicioDe.push(acumulado);
    acumulado += l.length + 1;
  }
  const lineaDe = (pos: number) => {
    let a = 0;
    let b = inicioDe.length - 1;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if (inicioDe[m] <= pos) a = m;
      else b = m - 1;
    }
    return a + 1;
  };
  for (const m of sinTextos.matchAll(/[>}]([^<>{}]*)(?=[<{])/g)) {
    const bruto = sinComentarios.slice(m.index + 1, m.index + 1 + m[1].length);
    const texto = bruto.replace(/\s+/g, " ").trim();
    if (!/\p{L}/u.test(texto) || /[=;()]|&&|\|\||=>/.test(texto)) continue;
    literales.push({ linea: lineaDe(m.index + 1 + (m[1].length - m[1].trimStart().length)), texto, tipo: "jsx" });
  }
  literales.sort((a, b) => a.linea - b.linea);
  return { sinComentarios, sinTextos, literales };
}

const REGISTRO = /\b(log|logError|logRojo|logAviso)\(|console\./;

/** Si la línea es un `import … from "…"`, un `export … from "…"` o un `import("…")`: su cadena no es texto. */
function esImportacion(linea: string): boolean {
  return /^\s*(import|export)\b.*\bfrom\s*["']/.test(linea) || /^\s*import\s*["']/.test(linea) || /^\s*\}\s*from\s*["']/.test(linea) || /\b(import|require)\(\s*["']/.test(linea);
}

/** El texto de la interfaz de un archivo: cadenas, plantillas y texto JSX, sin registros ni importaciones. */
export function textosDeInterfaz(rel: string): (Literal & { archivo: string })[] {
  const codigo = leer(rel);
  const { literales, sinComentarios } = analizar(codigo);
  const lineas = sinComentarios.split("\n");
  return literales
    .filter((l) => {
      const linea = lineas[l.linea - 1] ?? "";
      return !REGISTRO.test(linea) && !(l.tipo === "cadena" && esImportacion(linea)) && !/^\s*["']use (client|server)["'];?\s*$/.test(linea);
    })
    .map((l) => ({ ...l, archivo: rel }));
}

/** Los archivos con texto de la interfaz (I17): cliente/, app/ y los módulos de textos de lib/. */
export function archivosDeInterfaz(): string[] {
  return [...recorrer(["cliente", "app"]), "lib/vocabulario.ts", "lib/errores.ts", "lib/prueba.ts"];
}

/** Las importaciones de un archivo: el módulo, si es solo de tipos y la línea. */
export function importaciones(codigo: string): { modulo: string; soloTipos: boolean; nombres: string[]; linea: number }[] {
  const { sinComentarios } = analizar(codigo);
  const salida: { modulo: string; soloTipos: boolean; nombres: string[]; linea: number }[] = [];
  const lineaDe = (pos: number) => sinComentarios.slice(0, pos).split("\n").length;
  for (const m of sinComentarios.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g)) {
    const [, palabra, tipo, cuerpo, modulo] = m;
    if (palabra === "export" && !/^[{*]/.test(cuerpo.trim())) continue;
    const llaves = cuerpo.match(/\{([\s\S]*)\}/);
    const especificadores = llaves ? llaves[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
    const fuera = cuerpo.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
    const soloTipos = Boolean(tipo) || (fuera === "" && especificadores.length > 0 && especificadores.every((s) => /^type\s/.test(s)));
    const nombres = [...especificadores.map((s) => s.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim()), ...(fuera ? fuera.split(/\s+/).filter((p) => p !== "*" && p !== "as") : [])];
    salida.push({ modulo, soloTipos, nombres, linea: lineaDe(m.index + (m[0].startsWith("\n") ? 1 : 0)) });
  }
  for (const m of sinComentarios.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) salida.push({ modulo: m[1], soloTipos: false, nombres: [], linea: lineaDe(m.index + 1) });
  for (const m of sinComentarios.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) salida.push({ modulo: m[1], soloTipos: false, nombres: [], linea: lineaDe(m.index) });
  return salida;
}

/** Recorre las líneas de un código (ya sin comentarios) y devuelve «archivo:línea: texto» de las que cumplen. */
function lineasQue(rel: string, codigo: string, cumple: (linea: string) => boolean): string[] {
  return codigo.split("\n").flatMap((l, i) => (cumple(l) ? [`${rel}:${i + 1}: ${l.trim()}`] : []));
}

// ─── I3 ───────────────────────────────────────────────────────────────────────────────────────────

const PUROS = ["tipos", "vocabulario", "agenda", "regional", "guion", "negocio", "configuracion", "api-tipos", "presets/*", "semillas/*", "semilla", "hilo", "asistente", "errores", "plantillas", "prueba", "precios", "fuente", "inicio", "buscar", "llegadas", "ajustes", "cita", "retomar", "qr"];
const DEL_SERVIDOR = new Set(["bd", "conexion", "perfil", "eventos", "claves", "meta", "tunel"]);
const NATIVOS = new Set(builtinModules);

function archivosPuros(): string[] {
  return PUROS.flatMap((p) => {
    if (p.endsWith("/*")) return recorrer([`lib/${p.slice(0, -2)}`], [".ts"]);
    // Un archivo que no existe se salta; «cita» y «retomar» (fase 6) tienen su propia comprobación abajo.
    return existsSync(path.join(RAIZ, `lib/${p}.ts`)) ? [`lib/${p}.ts`] : [];
  });
}

/** El módulo de lib/ al que apunta una importación («./bd», «../bd», «@/lib/bd»), o null si no es de lib/. */
function moduloDeLib(desde: string, modulo: string): string | null {
  if (modulo.startsWith("@/lib/")) return modulo.slice("@/lib/".length);
  if (!modulo.startsWith(".")) return null;
  const abs = path.posix.normalize(path.posix.join(path.posix.dirname(desde), modulo));
  return abs.startsWith("lib/") ? abs.slice(4) : null;
}

describe("I3: módulos puros", () => {
  it("ningún módulo puro importa servidor ni lee process.env", () => {
    const archivos = archivosPuros();
    expect(archivos.length).toBeGreaterThan(20);
    const fallos: string[] = [];
    for (const rel of archivos) {
      const codigo = leer(rel);
      for (const imp of importaciones(codigo)) {
        if (imp.soloTipos) continue; // se borra al compilar
        const nativo = imp.modulo.startsWith("node:") || NATIVOS.has(imp.modulo);
        const deLib = moduloDeLib(rel, imp.modulo);
        if (nativo || (deLib !== null && DEL_SERVIDOR.has(deLib))) fallos.push(`${rel}:${imp.linea}: importa ${imp.modulo}`);
      }
      fallos.push(...lineasQue(rel, analizar(codigo).sinTextos, (l) => /\bprocess\.env\b/.test(l)));
    }
    expect(fallos).toEqual([]);
  });

  it("I3: cita y retomar son puros (existen y entran en la comprobación de arriba)", () => {
    const archivos = archivosPuros();
    for (const rel of ["lib/cita.ts", "lib/retomar.ts"]) {
      expect(existsSync(path.join(RAIZ, rel)), `${rel} no existe`).toBe(true);
      expect(archivos, `${rel} no está en la lista de módulos puros`).toContain(rel);
    }
  });
});

// ─── I10 ──────────────────────────────────────────────────────────────────────────────────────────

describe("I10: sin HTML crudo", () => {
  it("no hay dangerouslySetInnerHTML", () => {
    const fallos = recorrer(["app", "cliente", "lib"]).flatMap((rel) => lineasQue(rel, leer(rel), (l) => l.includes("dangerouslySetInnerHTML")));
    expect(fallos).toEqual([]);
  });
});

// ─── I13 ──────────────────────────────────────────────────────────────────────────────────────────

describe("I13: la prueba del asistente no envía ni guarda", () => {
  it("lib/probar.ts no importa envíos, guardado ni buzón", () => {
    const prohibidos = new Set(["guardarMutaciones", "enviarTexto", "enviarPlantilla", "enviarPlantillaConVariables", "marcarLeido", "avisarComercial"]);
    const codigo = leer("lib/probar.ts");
    const fallos: string[] = [];
    for (const imp of importaciones(codigo)) {
      if (moduloDeLib("lib/probar.ts", imp.modulo) === "buzon") fallos.push(`lib/probar.ts:${imp.linea}: importa ${imp.modulo}`);
      for (const nombre of imp.nombres) if (prohibidos.has(nombre)) fallos.push(`lib/probar.ts:${imp.linea}: importa ${nombre} de ${imp.modulo}`);
    }
    // Y tampoco los nombra en el código (por si llegaran por otro camino).
    fallos.push(...lineasQue("lib/probar.ts", analizar(codigo).sinTextos, (l) => [...prohibidos].some((p) => new RegExp(`\\b${p}\\b`).test(l))));
    expect([...new Set(fallos)]).toEqual([]);
  });
});

// ─── I16 ──────────────────────────────────────────────────────────────────────────────────────────

const CLAVES = ["ANTHROPIC_API_KEY", "WHATSAPP_TOKEN", "META_APP_SECRET", "NGROK_AUTHTOKEN", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "WEBHOOK_VERIFY_TOKEN", "SESION_SECRETO", "CLAVE_PANEL_HASH", "CODIGO_ALTA", "SUPABASE_DB_URL"];
const SALIDA = /\b(log|logError|logRojo)\(|console\.|Response\.json\(|NextResponse\.json\(|JSON\.stringify\(/;
const LEE_CLAVE = new RegExp(`process\\.env\\.(${CLAVES.join("|")})\\b`);

/** Los archivos del servidor que pueden registrar o responder: lib/, app/ y, si existe, instrumentation.ts. */
function archivosDelServidor(): string[] {
  return [...recorrer(["lib", "app"]), ...(existsSync(path.join(RAIZ, "instrumentation.ts")) ? ["instrumentation.ts"] : [])];
}

describe("I16: ninguna clave sale", () => {
  it("ningún registro ni respuesta lleva una clave", () => {
    const fallos: string[] = [];
    for (const rel of archivosDelServidor()) {
      const { sinComentarios } = analizar(leer(rel));
      fallos.push(
        ...lineasQue(rel, sinComentarios, (l) => {
          // La única excepción (I16, G5): en instrumentation.ts, la línea que imprime una vez el código de alta
          // del panel en modo servidor. Se salta solo esa línea de ese archivo; cualquier otra que registre una
          // clave falla.
          if (rel === "instrumentation.ts" && l.includes("Código de alta del panel")) return false;
          return SALIDA.test(l) && LEE_CLAVE.test(l);
        }),
      );
    }
    expect(fallos).toEqual([]);
  });

  it("solo lib/claves.ts escribe .env", () => {
    const fallos: string[] = [];
    for (const rel of archivosDelServidor()) {
      if (rel === "lib/claves.ts") continue;
      const { sinComentarios } = analizar(leer(rel));
      fallos.push(...lineasQue(rel, sinComentarios, (l) => /\b(writeFile|writeFileSync|rename|renameSync|appendFile|appendFileSync|copyFile|copyFileSync)\b/.test(l) && /\.env\b/.test(l)));
    }
    expect(fallos).toEqual([]);
  });
});

// ─── I17 ──────────────────────────────────────────────────────────────────────────────────────────

const NOMBRA_ARCHIVO = /\.env\b|arrancar\.sh|comprobar\.sh|agente\.md|bash |pnpm |node scripts/;

describe("I17: la interfaz no nombra archivos ni comandos", () => {
  it("ningún texto de la interfaz nombra archivos ni comandos", () => {
    const textos = archivosDeInterfaz().flatMap(textosDeInterfaz);
    // Si el extractor dejara de ver los textos, el test pasaría sin mirar nada.
    expect(textos.filter((l) => l.tipo === "jsx").length).toBeGreaterThan(300);
    expect(textos.some((l) => l.texto === "Ajustes")).toBe(true);
    const fallos = textos
      .filter((l) => NOMBRA_ARCHIVO.test(l.texto))
      .map((l) => `${l.archivo}:${l.linea}: ${l.texto}`);
    expect(fallos).toEqual([]);
  });
});

// ─── B8 ───────────────────────────────────────────────────────────────────────────────────────────

const QUITADOS = ["asignado", "MiembroEquipo", "recibePases", "vista-proyectos", "seccionProyectos", "filasAgendaEjemplo", "vista-informes", "PastillaAsistente", "CajonPrueba", "PuntoEstado", "Como:", "Cargar leads de prueba", "Asistente IA"];

describe("B8: lo quitado no deja rastro", () => {
  it("sin equipo, proyectos, informes ni piezas quitadas", () => {
    const fallos = recorrer(["lib", "cliente", "app", "scripts"], [".ts", ".tsx", ".mjs", ".js", ".sh"]).flatMap((rel) =>
      lineasQue(rel, leer(rel), (l) => QUITADOS.some((q) => l.includes(q))),
    );
    expect(fallos).toEqual([]);
  });

  it("la interfaz dice tu asistente, nunca agente", () => {
    const fallos = archivosDeInterfaz()
      .flatMap(textosDeInterfaz)
      // El código congelado `Mensaje.de === "agente"` no es texto. Tampoco lo son las rutas de la configuración
      // («agente.pasarSiempre», «agente.frases.…»: códigos internos con puntos y sin espacios, I2) ni las rutas
      // de la API («/api/configuracion/agente»).
      .filter((l) => l.texto !== "agente" && !/^[\w-]+(\.[\w…-]+)+$/.test(l.texto) && !/^\/api\/[\w/-]+$/.test(l.texto) && /(?<![\p{L}\p{N}_])agente(?![\p{L}\p{N}_])/iu.test(l.texto))
      .map((l) => `${l.archivo}:${l.linea}: ${l.texto}`);
    expect(fallos).toEqual([]);
  });

  it("sin modo lista ni compatibilidad pendiente", () => {
    const fallos: string[] = [];
    if (existsSync(path.join(RAIZ, "cliente/vista-proyectos.tsx"))) fallos.push("cliente/vista-proyectos.tsx existe");
    for (const rel of recorrer(["app", "cliente", "lib", "scripts"], [".ts", ".tsx", ".mjs", ".js", ".sh"])) {
      // La marca se compone aquí para que `grep -rn` de la marca en lib/ no encuentre este mismo test.
      fallos.push(...lineasQue(rel, leer(rel), (l) => l.includes(`COMPAT-${"W18"}`)));
    }
    for (const rel of recorrer(["cliente", "app"])) {
      const { sinTextos, literales } = analizar(leer(rel));
      fallos.push(...lineasQue(rel, sinTextos, (l) => /\b(SIN_FILTRO|PropsAntiguas|REJILLA)\b/.test(l)));
      for (const l of literales) if (l.tipo !== "jsx" && l.texto === "lista") fallos.push(`${rel}:${l.linea}: "lista"`);
    }
    expect(fallos).toEqual([]);
  });
});

// ─── F50 ──────────────────────────────────────────────────────────────────────────────────────────

describe("F50: puertos detrás de su variable", () => {
  it("los scripts no fijan 8000, 8001 ni 8099", () => {
    // Número entero: «18000» ms o «80000» no son puertos.
    const fallos = recorrer(["scripts"], [".mjs"])
      .filter((rel) => path.posix.dirname(rel) === "scripts")
      .flatMap((rel) => lineasQue(rel, analizar(leer(rel)).sinComentarios, (l) => /\b(8000|8001|8099)\b/.test(l) && !l.includes("process.env.")));
    expect(fallos).toEqual([]);
  });
});

// ─── I21 ──────────────────────────────────────────────────────────────────────────────────────────

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

interface RutaDeLaApp {
  metodo: string;
  ruta: string;
  /** «pagina» para un page.tsx; «ruta» para un route.ts. */
  tipo: "pagina" | "ruta";
  archivo: string;
}

/** La URL de un archivo de app/: sin «app», sin los grupos «(…)» y con «[x]» → «x-de-prueba». */
function urlDe(rel: string): string {
  const partes = path.posix
    .dirname(rel)
    .split("/")
    .slice(1)
    .filter((p) => !/^\(.*\)$/.test(p))
    .map((p) => p.replace(/^\[+\.{0,3}([^\]]+)\]+$/, "$1-de-prueba"));
  return "/" + partes.join("/");
}

/** Los métodos que exporta un route.ts: funciones, constantes y reexportaciones («export { GET, POST } from …»). */
function metodosDe(codigo: string): string[] {
  const { sinComentarios } = analizar(codigo);
  const encontrados = new Set<string>();
  for (const m of sinComentarios.matchAll(/export\s+(?:async\s+)?function\s+([A-Z]+)\b/g)) encontrados.add(m[1]);
  for (const m of sinComentarios.matchAll(/export\s+const\s+([A-Z]+)\s*=/g)) encontrados.add(m[1]);
  for (const m of sinComentarios.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const nombre of m[1].split(",")) {
      const exportado = nombre.trim().split(/\s+as\s+/).pop()?.trim();
      if (exportado) encontrados.add(exportado);
    }
  }
  return METODOS.filter((metodo) => encontrados.has(metodo));
}

/** Todas las (método, ruta) que contesta la app: cada route.ts con sus métodos y cada page.tsx con GET y HEAD. */
function rutasDeLaApp(): RutaDeLaApp[] {
  const salida: RutaDeLaApp[] = [];
  for (const rel of recorrer(["app"], [".ts", ".tsx"])) {
    const nombre = path.posix.basename(rel);
    if (nombre === "page.tsx") {
      for (const metodo of ["GET", "HEAD"]) salida.push({ metodo, ruta: urlDe(rel), tipo: "pagina", archivo: rel });
    } else if (nombre === "route.ts") {
      const metodos = metodosDe(leer(rel));
      // Un route.ts del que no se lee ningún método no se puede clasificar: que falle con su nombre.
      if (!metodos.length) salida.push({ metodo: "¿?", ruta: urlDe(rel), tipo: "ruta", archivo: rel });
      for (const metodo of metodos) salida.push({ metodo, ruta: urlDe(rel), tipo: "ruta", archivo: rel });
    }
  }
  return salida;
}

const DOMINIO_PRUEBA = "crm.prueba.test";

/** La petición de un navegador del propio dominio, sin cookie: Origin solo en las escrituras. */
function peticionServidor(metodo: string, ruta: string, consulta = ""): PeticionAcceso {
  const escritura = metodo !== "GET" && metodo !== "HEAD";
  return {
    ruta,
    consulta,
    metodo,
    host: DOMINIO_PRUEBA,
    reenviado: null,
    sitio: "same-origin",
    origen: escritura ? `https://${DOMINIO_PRUEBA}` : null,
    tipo: "application/json",
    cookie: null,
  };
}

/** Lo único que pasa sin sesión entre las rutas de app/ (I21): método y ruta; «*» es cualquier método. */
const PUBLICAS_DE_LA_APP = new Set(["GET /", "HEAD /", "GET /entrar", "HEAD /entrar", "POST /lead", "* /webhook", "* /api/whatsapp/webhook", "GET /api/logo", "POST /api/sesion"]);

const esPublicaDeLaApp = (r: { metodo: string; ruta: string }) => PUBLICAS_DE_LA_APP.has(`${r.metodo} ${r.ruta}`) || PUBLICAS_DE_LA_APP.has(`* ${r.ruta}`);

const RESPUESTA_SIN_SESION: DecisionAcceso = {
  tipo: "respuesta",
  status: 401,
  cuerpo: '{"ok":false,"error":"Tienes que entrar con tu contraseña","codigo":"sesion"}',
  json: true,
};

/**
 * Lo que tiene que decidir el modo servidor sin sesión. Una ruta que no es pública, ni página, ni de /api/
 * no tiene regla: devuelve null y el test la nombra para que alguien la clasifique.
 */
function esperadoSinSesion(r: RutaDeLaApp): DecisionAcceso | null {
  if (esPublicaDeLaApp(r)) return { tipo: "pasa" };
  if (r.tipo === "pagina") return { tipo: "redirige", a: "/entrar?volver=" + encodeURIComponent(r.ruta) };
  if (r.ruta.startsWith("/api/") || r.ruta === "/lead") return RESPUESTA_SIN_SESION;
  return null;
}

describe("I21: en modo servidor solo pasa sin sesión la superficie pública", () => {
  const rutas = rutasDeLaApp();
  const servidor = (sesion: boolean) => ({ dominio: DOMINIO_PRUEBA, sesionValida: () => sesion });

  it("el recorrido ve todas las rutas de la app", () => {
    // Si el recorrido dejara de ver rutas, el resto pasaría sin mirar nada.
    expect(rutas.length).toBeGreaterThan(50);
    for (const visto of ["GET /", "GET /panel", "GET /entrar", "POST /lead", "POST /webhook", "GET /api/whatsapp/webhook", "POST /api/cita", "POST /api/retomar", "PUT /api/sesion"]) {
      expect(rutas.map((r) => `${r.metodo} ${r.ruta}`)).toContain(visto);
    }
  });

  it("cada ruta, sin sesión, decide lo acordado", () => {
    const fallos: string[] = [];
    for (const r of rutas) {
      const esperado = esperadoSinSesion(r);
      if (r.metodo === "¿?" || !esperado) {
        fallos.push(`${r.archivo}: ${r.metodo} ${r.ruta} sin clasificar (añádela a la superficie pública o a /api/)`);
        continue;
      }
      const decision = decidirAcceso(peticionServidor(r.metodo, r.ruta), servidor(false));
      if (JSON.stringify(decision) !== JSON.stringify(esperado)) fallos.push(`${r.archivo}: ${r.metodo} ${r.ruta} → ${JSON.stringify(decision)}, se esperaba ${JSON.stringify(esperado)}`);
    }
    expect(fallos).toEqual([]);
  });

  it("lo público fuera de app/: la firma del estado, los recursos y una ruta inventada", () => {
    const sinSesion = (metodo: string, ruta: string, consulta = "") => decidirAcceso(peticionServidor(metodo, ruta, consulta), servidor(false));
    expect(sinSesion("GET", "/api/estado", "?solo=firma")).toEqual({ tipo: "pasa" });
    expect(sinSesion("GET", "/api/estado")).toEqual(RESPUESTA_SIN_SESION);
    for (const recurso of ["/_next/static/chunks/x.js", "/fotos/formulario.webp", "/icono.svg", "/favicon.ico"]) {
      expect(sinSesion("GET", recurso), recurso).toEqual({ tipo: "pasa" });
    }
    expect(sinSesion("GET", "/cualquier-cosa")).toEqual({ tipo: "redirige", a: "/entrar?volver=%2Fcualquier-cosa" });
  });

  it("con sesión pasa todo lo de la app: la sesión no bloquea nada por error", () => {
    const fallos = rutas
      .filter((r) => r.metodo !== "¿?")
      .filter((r) => decidirAcceso(peticionServidor(r.metodo, r.ruta), servidor(true)).tipo !== "pasa")
      .map((r) => `${r.archivo}: ${r.metodo} ${r.ruta}`);
    expect(fallos).toEqual([]);
  });
});

describe("I21: la lista pública es exactamente la acordada", () => {
  it("RUTAS_PUBLICAS_SERVIDOR", () => {
    expect(RUTAS_PUBLICAS_SERVIDOR).toEqual([
      "GET /",
      "GET /_next/*",
      "GET /fotos/*",
      "GET /icono.svg",
      "GET /favicon.ico",
      "GET /api/logo",
      "POST /lead",
      "* /webhook",
      "* /api/whatsapp/webhook",
      "GET /api/estado?solo=firma",
      "GET /entrar",
      "POST /api/sesion",
    ]);
  });
});

describe("I21: en local nunca se mira la sesión", () => {
  it("ninguna ruta llama a sesionValida y la cookie no cambia ninguna decisión", () => {
    const espia = vi.fn(() => true);
    const fallos: string[] = [];
    for (const r of rutasDeLaApp().filter((x) => x.metodo !== "¿?")) {
      const escritura = r.metodo !== "GET" && r.metodo !== "HEAD";
      const base: PeticionAcceso = {
        ruta: r.ruta,
        consulta: "",
        metodo: r.metodo,
        host: "localhost:8123",
        reenviado: null,
        sitio: "same-origin",
        origen: escritura ? "http://localhost:8123" : null,
        tipo: "application/json",
        cookie: null,
      };
      const sinCookie = decidirAcceso(base, { dominio: undefined, sesionValida: espia });
      for (const cookie of ["crm_sesion=lo-que-sea", "crm_sesion=", "otra=1"]) {
        const conCookie = decidirAcceso({ ...base, cookie }, { dominio: undefined, sesionValida: espia });
        if (JSON.stringify(conCookie) !== JSON.stringify(sinCookie)) fallos.push(`${r.metodo} ${r.ruta} con «${cookie}»: ${JSON.stringify(conCookie)}`);
      }
    }
    expect(espia).not.toHaveBeenCalled();
    expect(fallos).toEqual([]);
  });
});

// ─── I15 ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los archivos que llaman a los envíos de WhatsApp, revisados uno a uno. Quien escribe a un cliente mira
 * `silenciadoEn` antes de enviar; quien escribe al dueño, no hace falta.
 */
const ENVIAN_AL_DUENO = [
  "app/api/avisos/prueba/route.ts", // el aviso de prueba al móvil del comercial
  "app/api/whatsapp/prueba/route.ts", // el mensaje de prueba a tu propio número
  "lib/aviso.ts", // el aviso al comercial cuando un cliente pasa a persona
];
const ENVIAN_AL_CLIENTE = [
  "app/api/cita/route.ts", // el aviso de la cita dada, cambiada o anulada a mano (409 o sin envío si está silenciado)
  "app/api/responder/route.ts", // la respuesta escrita a mano (409 si está silenciado)
  "app/api/retomar/route.ts", // el mensaje aprobado para retomar (409 si está silenciado)
  "lib/alta.ts", // la bienvenida de un formulario nuevo: un formulario nuevo es consentimiento y levanta el silencio (F7)
  "lib/proceso.ts", // las respuestas del asistente y la única confirmación de la baja
];
/** Excepción de I15: un formulario nuevo es un consentimiento nuevo y quita el silencio. */
const SIN_MIRAR_SILENCIO = new Set(["lib/alta.ts"]);

describe("I15: quien envía WhatsApp a un cliente mira si ha pedido que no le escribamos", () => {
  it("los que llaman a los envíos son exactamente los revisados", () => {
    const llaman = recorrer(["app", "lib"])
      .filter((rel) => rel !== "lib/whatsapp.ts") // los define
      .filter((rel) => /\b(enviarTexto|enviarPlantilla|enviarPlantillaConVariables)\(/.test(analizar(leer(rel)).sinTextos))
      .sort();
    expect(llaman).toEqual([...ENVIAN_AL_DUENO, ...ENVIAN_AL_CLIENTE].sort());
  });

  it("los que escriben a un cliente miran silenciadoEn", () => {
    const fallos = ENVIAN_AL_CLIENTE.filter((rel) => !SIN_MIRAR_SILENCIO.has(rel)).filter((rel) => !/\bsilenciadoEn\b/.test(analizar(leer(rel)).sinTextos));
    expect(fallos).toEqual([]);
  });
});

// ─── I16 del modo servidor ────────────────────────────────────────────────────────────────────────

const CLAVES_DEL_SERVIDOR = /\b(SESION_SECRETO|CLAVE_PANEL_HASH|CODIGO_ALTA)\b/;
const REGISTRA_O_RESPONDE = /\b(log|logAviso|logError)\(|console\.|\bResponse\.json\(|\bNextResponse\.json\(/;
const LINEA_DEL_CODIGO_DE_ALTA = "Código de alta del panel: ";

describe("I16: las claves del modo servidor no salen en registros ni respuestas", () => {
  const archivos = () => [...recorrer(["app", "lib", "cliente"]), "proxy.ts", "instrumentation.ts"];

  it("ninguna línea que registra o responde nombra SESION_SECRETO, CLAVE_PANEL_HASH ni CODIGO_ALTA", () => {
    const fallos: string[] = [];
    for (const rel of archivos()) {
      const { sinComentarios } = analizar(leer(rel));
      fallos.push(
        ...lineasQue(rel, sinComentarios, (l) => {
          // La única excepción (I16, G5): la línea de arranque que escribe una vez el código de alta.
          if (rel === "instrumentation.ts" && l.includes(LINEA_DEL_CODIGO_DE_ALTA)) return false;
          return REGISTRA_O_RESPONDE.test(l) && CLAVES_DEL_SERVIDOR.test(l);
        }),
      );
    }
    expect(fallos).toEqual([]);
  });

  it("el código de alta se escribe en una sola línea de instrumentation.ts", () => {
    const lineas = archivos().flatMap((rel) => lineasQue(rel, analizar(leer(rel)).sinComentarios, (l) => l.includes(LINEA_DEL_CODIGO_DE_ALTA)));
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatch(/^instrumentation\.ts:\d+: console\.log\(/);
  });

  it("GET /api/claves no lista ninguna de las tres", async () => {
    const { CLAVES_DESDE_EL_PANEL } = await import("./claves");
    expect(CLAVES_DESDE_EL_PANEL.filter((c) => CLAVES_DEL_SERVIDOR.test(c))).toEqual([]);
  });
});

// ─── I22 ──────────────────────────────────────────────────────────────────────────────────────────

const SOLO_EN_ENV = ["PUERTO", "BD_LOCAL", "SUPABASE_DB_URL", "ANTHROPIC_BASE_URL", "GRAPH_BASE_URL", "TRANSCRIPCION_BASE_URL", "TRANSCRIPCION_MODELO", "NGROK_DOMAIN", "CRM_DOMINIO", "CRM_URL_PUBLICA", "ARCHIVO_CLAVES"];

describe("I22: lo que solo va en .env no se escribe desde el navegador", () => {
  it("NombreClave no incluye ninguna", () => {
    const union = leer("lib/api-tipos.ts").match(/export type NombreClave\s*=([^;]*);/);
    expect(union, "no encuentro NombreClave en lib/api-tipos.ts").not.toBeNull();
    const nombres = [...(union?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(nombres.length).toBeGreaterThan(10);
    expect(nombres.filter((n) => SOLO_EN_ENV.includes(n))).toEqual([]);
  });

  it("ningún archivo de la app las asigna en process.env", () => {
    const asigna = new RegExp(`process\\.env(?:\\.(${SOLO_EN_ENV.join("|")})\\b|\\[\\s*["'](${SOLO_EN_ENV.join("|")})["']\\s*\\])\\s*(?:=(?!=)|\\?\\?=|\\|\\|=)`);
    const fallos = [...recorrer(["app", "lib", "cliente"]), "proxy.ts", "instrumentation.ts"].flatMap((rel) => lineasQue(rel, analizar(leer(rel)).sinComentarios, (l) => asigna.test(l)));
    expect(fallos).toEqual([]);
  });

  it("guardarClave las rechaza y no toca el archivo de claves", async () => {
    const { guardarClave } = await import("./claves");
    const carpeta = mkdtempSync(path.join(os.tmpdir(), "invariantes-i22-"));
    const archivo = path.join(carpeta, "claves.env");
    const contenido = 'WHATSAPP_TOKEN="token-de-prueba"\n';
    writeFileSync(archivo, contenido);
    const antes = process.env.ARCHIVO_CLAVES;
    process.env.ARCHIVO_CLAVES = archivo;
    try {
      for (const nombre of SOLO_EN_ENV) {
        const r = await guardarClave(nombre as never, "x");
        expect(r.ok, nombre).toBe(false);
        expect(readFileSync(archivo, "utf8"), nombre).toBe(contenido);
      }
    } finally {
      if (antes === undefined) delete process.env.ARCHIVO_CLAVES;
      else process.env.ARCHIVO_CLAVES = antes;
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});

// ─── El propio analizador ─────────────────────────────────────────────────────────────────────────

describe("ayudantes", () => {
  it("el analizador separa comentarios, cadenas, plantillas, regex y texto JSX", () => {
    const codigo = [
      'const a = "uno // no es comentario"; // comentario',
      "const r = /[\"'`]/g; /* bloque",
      "sigue */ const t = `dos ${a + `tres`} cuatro`;",
      "return <p className=\"x\">Texto visible {a}</p>;",
    ].join("\n");
    const { literales, sinComentarios } = analizar(codigo);
    expect(sinComentarios).not.toContain("comentario\n");
    expect(sinComentarios.split("\n")).toHaveLength(4);
    expect(literales.map((l) => [l.linea, l.tipo, l.texto])).toEqual([
      [1, "cadena", "uno // no es comentario"],
      [3, "plantilla", "tres"],
      [3, "plantilla", "dos … cuatro"],
      [4, "cadena", "x"],
      [4, "jsx", "Texto visible"],
    ]);
  });

  it("las importaciones de tipos se distinguen de las de valores", () => {
    const imps = importaciones('import type { A } from "./bd";\nimport { type B, type C } from "node:fs";\nimport { leer, type D } from "./conexion";\nexport { x } from "./meta";');
    expect(imps.map((i) => [i.modulo, i.soloTipos, i.linea])).toEqual([
      ["./bd", true, 1],
      ["node:fs", true, 2],
      ["./conexion", false, 3],
      ["./meta", false, 4],
    ]);
  });
});
