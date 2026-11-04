import type { ModelItem } from "./model-select";
import type { Job, ProjectItem, Settings } from "./api-types";
import type { TokenUsage } from "../shared/token-usage";

/**
 * Demo mode: the panel is published as a static site, so there is no local API.
 * Instead of leaving an empty dashboard and a console full of 404s, the app
 * detects the missing API and answers every request with sample data. Mutations
 * are rejected with a message that points to the local version.
 */

export const DEMO_MUTATION_ERROR =
  "Función no disponible en la demo. Para crear proyectos y ejecutar agentes, usa FactoryOS en local.";

export const DEMO_BANNER_TEXT =
  "Demo con datos de ejemplo. La ejecución de agentes, la vista previa y las descargas necesitan FactoryOS instalado en local.";

export const DEMO_ACTION_TITLE = "Disponible en la versión local de FactoryOS";

const usage = (input: number, output: number, cost: number): TokenUsage => ({
  input,
  output,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: input + output,
  cost,
});

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

export const DEMO_MODELS: ModelItem[] = [
  { id: "opencode/big-pickle", name: "Big Pickle", providerID: "opencode", status: "active" },
  { id: "opencode-go/kimi-k2.7-code", name: "Kimi K2.7 Code", providerID: "opencode-go", status: "active" },
];

export const DEMO_SETTINGS: Settings = {
  mode: "independent",
  commonModel: "opencode/big-pickle",
  agentModels: {
    "factory-manager": "opencode/big-pickle",
    developer: "opencode-go/kimi-k2.7-code",
    "qa-reviewer": "opencode/big-pickle",
    "delivery-manager": "opencode/big-pickle",
    disenador: "opencode/big-pickle",
    "auditoria-seguridad": "opencode/big-pickle",
  },
  autoApprove: false,
  modelStatus: {
    "opencode/big-pickle": "ok",
    "opencode-go/kimi-k2.7-code": "ok",
  },
  agentModelConfigVersion: 2,
};

export const DEMO_JOBS: Job[] = [
  {
    id: "7f3a1b2c",
    name: "crm-clientes",
    request: "Quiero un CRM para gestionar clientes, oportunidades y seguimiento de llamadas.",
    status: "running",
    phase: "Desarrollando la interfaz",
    createdAt: minutesAgo(34),
    updatedAt: minutesAgo(2),
    directory: "projects/crm-clientes-7f3a1b2c",
    tokens: usage(18_420, 6_120, 1.84),
    logs: [
      "[factory-manager] Plan aprobado: 6 tareas.",
      "[developer] Creando src/views/clientes.ts...",
      "[developer] Creando src/views/oportunidades.ts...",
      "[qa-reviewer] Revisando accesibilidad del formulario.",
    ],
  },
  {
    id: "91bc4d5e",
    name: "landing-taridev",
    request: "Una landing de una página para presentar el servicio de desarrollo a medida.",
    status: "validated",
    phase: "Validado (ver QA_REPORT.md y DELIVERY_REPORT.md)",
    createdAt: minutesAgo(160),
    updatedAt: minutesAgo(96),
    directory: "projects/landing-taridev-91bc4d5e",
    tokens: usage(31_800, 12_450, 3.12),
    logs: [
      "[delivery-manager] README.md generado.",
      "[delivery-manager] QA_REPORT.md y DELIVERY_REPORT.md actualizados.",
      "[qa-reviewer] npm run build: OK · npm test: 14/14 PASS.",
    ],
  },
  {
    id: "2d10f6a7",
    name: "api-inventario",
    request: "API REST en Node para controlar stock, entradas y salidas de almacén.",
    status: "failed",
    phase: "Con error",
    createdAt: minutesAgo(320),
    updatedAt: minutesAgo(280),
    directory: "projects/api-inventario-2d10f6a7",
    tokens: usage(9_240, 3_010, 0.96),
    lastError: "El build falló: 2 errores de tipos en src/server.ts.",
    logs: [
      "[developer] Implementando endpoints de stock.",
      "[qa-reviewer] npm run build terminó con código 1.",
    ],
  },
  {
    id: "5c8e9f01",
    name: "Consulta",
    request: "¿Qué stack me recomiendas para una app de reservas con pagos?",
    requestKind: "question",
    answer:
      "Para reservas con pagos te recomiendo Node.js + TypeScript, PostgreSQL y Stripe Checkout. Añade una cola para los recordatorios y empieza con un calendario propio antes de integrar terceros.",
    status: "done",
    phase: "Completado",
    createdAt: minutesAgo(420),
    updatedAt: minutesAgo(415),
    directory: "",
    tokens: usage(1_280, 640, 0.08),
    logs: ["[factory-manager] Consulta respondida."],
  },
];

export const DEMO_PROJECTS: ProjectItem[] = [
  {
    name: "crm-clientes-7f3a1b2c",
    path: "projects/crm-clientes-7f3a1b2c",
    hasPackage: true,
    hasIndex: false,
  },
  {
    name: "landing-taridev-91bc4d5e",
    path: "projects/landing-taridev-91bc4d5e",
    hasPackage: true,
    hasIndex: true,
  },
  {
    name: "api-inventario-2d10f6a7",
    path: "projects/api-inventario-2d10f6a7",
    hasPackage: true,
    hasIndex: false,
  },
];

/** Reads `?demo=1|0` so the demo can be forced on or off from the URL. */
export function forcedDemo(search: string): boolean | null {
  const value = new URLSearchParams(search).get("demo");
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

/** A forced URL flag wins; otherwise a missing API means demo. */
export function resolveDemo(forced: boolean | null, apiHealthy: boolean): boolean {
  return forced ?? !apiHealthy;
}

export type DemoBackend = (path: string, init?: RequestInit) => Response;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export function createDemoBackend(): DemoBackend {
  return (path, init) => {
    const endpoint = path.split("?")[0].replace(/\/+$/, "") || "/";
    const method = (init?.method || "GET").toUpperCase();

    if (method !== "GET") return json(501, { error: DEMO_MUTATION_ERROR });

    switch (endpoint) {
      case "/api/health":
        return json(200, { ok: true, mode: "demo", active: null });
      case "/api/settings":
        return json(200, DEMO_SETTINGS);
      case "/api/models":
        return json(200, { models: DEMO_MODELS });
      case "/api/models/providers":
        return json(200, {
          connected: [...new Set(DEMO_MODELS.map(model => model.providerID).filter(Boolean))],
          visible: [...new Set(DEMO_MODELS.map(model => model.providerID).filter(Boolean))],
          missing: [],
        });
      case "/api/jobs":
        return json(200, DEMO_JOBS);
      case "/api/projects":
        return json(200, DEMO_PROJECTS);
      default:
        return json(404, { error: "Ruta no encontrada" });
    }
  };
}

/**
 * Asks the local API whether it is alive. Any failure (404 from the static
 * host, a network error or a slow response) means demo mode.
 */
export async function probeApiHealth(fetchImpl: typeof fetch, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const probe = (async () => {
    try {
      const response = await fetchImpl("/api/health", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return false;
      const data = (await response.json()) as { ok?: unknown } | null;
      return data?.ok === true;
    } catch {
      return false;
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, timeoutMs);
  });

  try {
    return await Promise.race([probe, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
