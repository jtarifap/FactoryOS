export type ModificationScope = "quick" | "full";

/** A request longer than this is treated as a functional change, never a tweak. */
export const QUICK_SCOPE_MAX_CHARS = 600;

/**
 * Terms that imply new behaviour, structure or dependencies. Their presence
 * means the change must go through the full pipeline, even when it is short.
 */
const FUNCTIONAL_TERMS = [
  "anad", "agreg", "crear", "nuev", "seccion", "pantalla", "pagin", "formulari",
  "api", "backend", "frontend", "base de datos", "database", "login", "iniciar sesion",
  "autentic", "registro", "usuario", "pago", "checkout", "subir", "upload",
  "integr", "endpoint", "componente", "component", "ruta", "router", "navegacion",
  "instal", "dependenc", "migr", "refactor", "script", "funcion", "logica",
  "validacion", "test", "prueba unitaria", "websocket", "sse", "cron", "webhook",
  "pdf", "excel", "csv", "grafic", "chart", "buscador", "buscador", "filtro",
  "carrito", "notificacion", "correo", "email", "smtp", "sitemap", "seo",
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Deterministic scope for a modification request. The server uses it so the
 * cost of a one-line tweak never depends on the model's judgement.
 */
export function classifyModification(request: unknown): ModificationScope {
  if (typeof request !== "string") return "full";
  const text = request.trim();
  if (!text) return "full";
  if (text.length > QUICK_SCOPE_MAX_CHARS) return "full";

  const normalized = normalize(text);
  for (const term of FUNCTIONAL_TERMS) {
    if (normalized.includes(term)) return "full";
  }
  return "quick";
}
