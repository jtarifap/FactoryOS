export type RequestSecurityInput = {
  method: string;
  pathname: string;
  host: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
  contentType: string | undefined;
};

export type RequestSecurityDecision =
  | { ok: true }
  | { ok: false; status: 403 | 415; error: string };

/** The panel is served by Vite on 5173; the API listens on 4177. */
const ALLOWED_HOSTS = new Set([
  "127.0.0.1:4177",
  "localhost:4177",
  "127.0.0.1:5173",
  "localhost:5173",
]);

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:4177",
  "http://localhost:4177",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

const JSON_BODY_ROUTES = new Set([
  "POST /api/jobs",
  "PUT /api/settings",
  "POST /api/models/test",
  "POST /api/preview/start",
  "POST /api/preview/stop",
]);

export function isAllowedHost(host: string | undefined): boolean {
  if (typeof host !== "string") return false;
  return ALLOWED_HOSTS.has(host.trim().toLowerCase());
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (typeof origin !== "string") return false;
  let parsed: URL;
  try { parsed = new URL(origin); }
  catch { return false; }
  if (parsed.protocol !== "http:") return false;
  // Reject origins with a path, credentials or a trailing slash. Browsers
  // send a bare origin; anything else is not something we accept.
  if (parsed.origin !== origin) return false;
  return ALLOWED_ORIGINS.has(parsed.origin);
}

export function isJsonContentType(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

export function requiresJsonBody(method: string, pathname: string): boolean {
  return JSON_BODY_ROUTES.has(`${method.toUpperCase()} ${pathname}`);
}

/**
 * Local-only API guard.
 *
 * - `Host` must be the documented loopback host:port. This defeats DNS
 *   rebinding, where a remote name resolves to 127.0.0.1 but keeps its own
 *   Host header.
 * - Mutating requests with an `Origin` must come from the panel or the API
 *   itself. Requests without `Origin` (PowerShell, curl, native clients) are
 *   accepted; a browser cannot omit it on a cross-origin POST.
 * - Cross-site `Sec-Fetch-Site` is rejected on the API. Preview files are not
 *   restricted because the panel may be served from `localhost` and the
 *   preview from `127.0.0.1`.
 * - Endpoints that parse JSON reject form-safe content types, which closes
 *   the classic simple-request CSRF path. CORS is deliberately not used as a
 *   defence and no `Access-Control-Allow-Origin` header is returned.
 */
export function authorizeRequest(input: RequestSecurityInput): RequestSecurityDecision {
  if (!isAllowedHost(input.host)) {
    return { ok: false, status: 403, error: "Host no permitido para la API local." };
  }

  const method = input.method.toUpperCase();
  if (method === "OPTIONS") {
    return { ok: false, status: 403, error: "Las peticiones CORS no están permitidas." };
  }

  if (input.pathname.startsWith("/api") && input.secFetchSite?.toLowerCase() === "cross-site") {
    return { ok: false, status: 403, error: "Petición entre sitios rechazada." };
  }

  if (method !== "GET" && method !== "HEAD") {
    if (input.origin !== undefined && !isAllowedOrigin(input.origin)) {
      return { ok: false, status: 403, error: "Origen no permitido." };
    }
    if (requiresJsonBody(method, input.pathname)) {
      if (input.contentType !== undefined && !isJsonContentType(input.contentType)) {
        return { ok: false, status: 415, error: "La API solo acepta JSON en este endpoint." };
      }
    }
  }

  return { ok: true };
}
