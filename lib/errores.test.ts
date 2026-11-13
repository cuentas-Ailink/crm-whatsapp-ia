import { describe, expect, it } from "vitest";
import { ErrorCrm, explicar, explicarBd, explicarClaude, explicarMeta, explicarNgrok, type CodigoError } from "./errores";

const OTRA_VEZ = "Vuelve a intentarlo en un momento.";

// Código, título, solución y paso, tal cual la tabla del contrato.
const TABLA: [CodigoError, string, string, string | undefined][] = [
  ["meta.token", "El token de Meta no vale o ha caducado", "Pega el token permanente del usuario del sistema, no el de la pantalla de inicio de Meta, que caduca en 24 h.", "whatsapp"],
  ["meta.lista", "Ese móvil no está en la lista de prueba de Meta", "Añádelo en tu app de Meta (WhatsApp → Configuración de la API) y vuelve a enviar.", "primer"],
  ["meta.variables", "El mensaje aprobado no recibe los datos que espera", "Revisa en Ajustes → Avanzado que el texto lleve {{1}} y {{2}}.", undefined],
  ["meta.bienvenida", "Meta aún no ha aprobado tu mensaje de bienvenida", "Mientras tanto tu asistente contesta a quien te escriba por WhatsApp. Míralo en Ajustes → Conexiones.", "primer"],
  ["meta.ventana", "Han pasado más de 24 h desde su último mensaje", "WhatsApp solo deja escribirle con un mensaje aprobado.", undefined],
  ["meta.numero", "Ese número no puede recibir WhatsApp", "Compruébalo con el cliente.", undefined],
  ["meta.calidad", "Meta no lo ha entregado para cuidar la calidad de tu número", "Espera un poco antes de volver a escribirle.", undefined],
  ["meta.firma", "Llegan avisos de Meta, pero la firma no coincide", "Vuelve a pegar la clave secreta de la app en Ajustes → Conexiones.", "whatsapp"],
  ["meta.permisos", "Tu token no tiene permiso para esto", "Dale al usuario del sistema los permisos de WhatsApp de tu app y vuelve a pegar el token.", "whatsapp"],
  ["meta.otro", "Meta ha rechazado el envío", OTRA_VEZ, undefined],
  ["claude.clave", "Esa clave no es válida", "Cópiala otra vez de platform.claude.com → API Keys.", "claude"],
  ["claude.saldo", "Tu cuenta de Anthropic no tiene saldo", "Añádelo en Billing y pulsa Reintentar.", "claude"],
  ["claude.modelo", "Tu clave no tiene acceso a ese modelo", "Elige el otro modelo en Ajustes → Avanzado.", undefined],
  ["claude.ocupado", "Claude está saturado ahora mismo", OTRA_VEZ, undefined],
  ["ngrok.token", "Esa clave de ngrok no vale", "Cópiala de dashboard.ngrok.com → Your Authtoken.", "whatsapp"],
  ["ngrok.ocupado", "Tu túnel ya está abierto en otro ordenador", "Ciérralo allí y vuelve a intentarlo.", "whatsapp"],
  ["ngrok.dominio", "Ese dominio de ngrok no es de tu cuenta", "Usa el de tu cuenta o pide ayuda a quien te lo instaló.", "whatsapp"],
  ["bd.ocupada", "Ya hay un CRM abierto con estos datos en este ordenador.", "Ciérralo antes de abrir otro.", undefined],
  ["bd.conexion", "El CRM no llega a tus datos", "Revisa la conexión a internet; si usas Supabase, que el proyecto no esté en pausa.", undefined],
  ["red", "Sin conexión con el servidor", OTRA_VEZ, undefined],
  ["sesion", "Tienes que entrar con tu contraseña", "", undefined],
  ["desconocido", "Algo ha fallado", OTRA_VEZ, undefined],
];

describe("explicar", () => {
  it("cada código tiene su título, su solución y su paso", () => {
    for (const [codigo, titulo, solucion, paso] of TABLA) {
      const e = explicar(codigo);
      expect(e).toEqual({ codigo, titulo, solucion, ...(paso ? { paso } : {}) });
      if (!paso) expect("paso" in e).toBe(false);
    }
  });

  it("en meta.otro la solución es el título de Meta", () => {
    expect(explicar("meta.otro", "Message failed to send").solucion).toBe("Message failed to send");
    expect(explicar("meta.otro", "").solucion).toBe(OTRA_VEZ);
  });

  it("ningún texto nombra un archivo o un comando", () => {
    for (const [codigo] of TABLA) {
      const { titulo, solucion } = explicar(codigo);
      for (const prohibido of [".env", "arrancar.sh", "comprobar.sh", "agente.md", "bash "]) {
        expect(`${titulo} ${solucion}`).not.toContain(prohibido);
      }
    }
  });
});

describe("explicarMeta", () => {
  it("cada código conocido", () => {
    const casos: [number, CodigoError][] = [
      [190, "meta.token"],
      [131030, "meta.lista"],
      [132000, "meta.variables"],
      [132001, "meta.bienvenida"],
      [131047, "meta.ventana"],
      [131026, "meta.numero"],
      [131049, "meta.calidad"],
      [10, "meta.permisos"],
      [200, "meta.permisos"],
      [299, "meta.permisos"],
    ];
    for (const [numero, codigo] of casos) expect(explicarMeta(numero, "Lo que diga Meta").codigo).toBe(codigo);
  });

  it("el 100 solo es de permisos si el título lo dice", () => {
    expect(explicarMeta(100, "(#100) Missing permission").codigo).toBe("meta.permisos");
    expect(explicarMeta(100, "(#100) Invalid parameter")).toEqual({ codigo: "meta.otro", titulo: "Meta ha rechazado el envío", solucion: "(#100) Invalid parameter" });
  });

  it("uno desconocido es meta.otro con el título de Meta", () => {
    expect(explicarMeta(131000, "Something went wrong")).toEqual({ codigo: "meta.otro", titulo: "Meta ha rechazado el envío", solucion: "Something went wrong" });
  });

  it("sin título, la solución genérica", () => {
    expect(explicarMeta(131000).solucion).toBe(OTRA_VEZ);
    expect(explicarMeta(undefined, "").solucion).toBe(OTRA_VEZ);
  });
});

describe("explicarClaude", () => {
  it("cada caso", () => {
    expect(explicarClaude(401).codigo).toBe("claude.clave");
    expect(explicarClaude(400, "Your credit balance is too low to access the Anthropic API.").codigo).toBe("claude.saldo");
    expect(explicarClaude(400, "messages: field required").codigo).toBe("desconocido");
    expect(explicarClaude(404).codigo).toBe("claude.modelo");
    expect(explicarClaude(429).codigo).toBe("claude.ocupado");
    expect(explicarClaude(529).codigo).toBe("claude.ocupado");
    expect(explicarClaude(500).codigo).toBe("desconocido");
  });

  it("sin estado, la red", () => {
    expect(explicarClaude(undefined).codigo).toBe("red");
  });
});

describe("explicarNgrok", () => {
  it("con un código de error", () => {
    expect(explicarNgrok({ errorCode: "ERR_NGROK_105" }).codigo).toBe("ngrok.token");
    expect(explicarNgrok({ code: "ERR_NGROK_4018" }).codigo).toBe("ngrok.token");
    expect(explicarNgrok({ errorCode: "ERR_NGROK_334" }).codigo).toBe("ngrok.ocupado");
    expect(explicarNgrok({ errorCode: "ERR_NGROK_15013" }).codigo).toBe("ngrok.dominio");
  });

  it("con un mensaje", () => {
    expect(explicarNgrok(new Error("failed to start tunnel: ERR_NGROK_107 authentication failed")).codigo).toBe("ngrok.token");
    expect(explicarNgrok(new Error("ERR_NGROK_320 domain is reserved")).codigo).toBe("ngrok.dominio");
  });

  it("con un texto suelto", () => {
    expect(explicarNgrok("ERR_NGROK_313").codigo).toBe("ngrok.dominio");
    expect(explicarNgrok("ERR_NGROK_1050").codigo).toBe("desconocido");
    expect(explicarNgrok("otra cosa").codigo).toBe("desconocido");
  });
});

describe("explicarBd", () => {
  it("la base de datos ocupada", () => {
    expect(explicarBd(new ErrorCrm("bd.ocupada")).codigo).toBe("bd.ocupada");
  });

  it("sin conexión", () => {
    expect(explicarBd(new Error("password authentication failed for user postgres")).codigo).toBe("bd.conexion");
    expect(explicarBd({ code: "ENOTFOUND", message: "getaddrinfo" }).codigo).toBe("bd.conexion");
    expect(explicarBd({ code: "ECONNREFUSED" }).codigo).toBe("bd.conexion");
    expect(explicarBd(new Error("connect ETIMEDOUT")).codigo).toBe("bd.conexion");
    expect(explicarBd(new Error("project is paused")).codigo).toBe("bd.conexion");
  });

  it("lo demás, desconocido", () => {
    expect(explicarBd(new Error("syntax error at or near")).codigo).toBe("desconocido");
    expect(explicarBd(new ErrorCrm("red")).codigo).toBe("desconocido");
    expect(explicarBd(undefined).codigo).toBe("desconocido");
  });
});

describe("ErrorCrm", () => {
  it("lleva el código, el nombre y el título como mensaje", () => {
    const e = new ErrorCrm("bd.ocupada");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ErrorCrm");
    expect(e.codigo).toBe("bd.ocupada");
    expect(e.message).toBe("Ya hay un CRM abierto con estos datos en este ordenador.");
  });

  it("con detalle, el detalle es el mensaje", () => {
    expect(new ErrorCrm("meta.otro", "Recipient phone number not valid").message).toBe("Recipient phone number not valid");
  });
});
