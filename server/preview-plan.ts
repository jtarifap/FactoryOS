/**
 * Plan de arranque de la vista previa.
 *
 * Una app generada puede ser estatica, un servidor de desarrollo (vite, next)
 * o un servidor de produccion (`node dist/server.js`). Este modulo decide que
 * script ejecutar, que argumentos pasar y en que puerto queda la app.
 */

export type PackageJson = { scripts?: Record<string, string> };

/** Scripts candidatos, por orden de preferencia. */
export const PREVIEW_SCRIPT_ORDER = ["dev", "start", "preview", "serve", "watch"];

/** Scripts de desarrollo que aceptan `--port`. */
const PORT_FLAG_SCRIPTS = new Set(["dev", "preview", "serve", "watch"]);

/**
 * Lee un package.json tolerando la marca BOM de Windows: sin ella el JSON no
 * se puede parsear y la vista previa se negaba a arrancar.
 */
export function parsePackageJson(raw: string): PackageJson | null {
  if (!raw) return null;
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as PackageJson;
  } catch {
    return null;
  }
}

/** Elige el script que puede arrancar la app. */
export function choosePreviewScript(scripts: Record<string, string> | undefined): string | null {
  if (!scripts || typeof scripts !== "object") return null;
  for (const name of PREVIEW_SCRIPT_ORDER) {
    if (typeof scripts[name] === "string" && scripts[name].trim()) return name;
  }
  return null;
}

/** Divide los argumentos extra escritos por el usuario respetando comillas. */
export function splitExtraArgs(input: string): string[] {
  const text = String(input || "").trim();
  if (!text) return [];
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (value) args.push(value);
  }
  return args;
}

const MAX_PREVIEW_ARGS = 32;
const MAX_PREVIEW_ARG_LENGTH = 200;
// Arguments are joined by Node when `shell: true` is used, so shell
// metacharacters would become command injection. Normal flags, hosts, ports,
// paths and quoted titles do not need any of these characters.
const UNSAFE_PREVIEW_ARG = /[&|<>^()%!;"'`$*?{}\[\]\r\n\0]/;

export function isSafePreviewArg(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!value || value.length > MAX_PREVIEW_ARG_LENGTH) return false;
  return !UNSAFE_PREVIEW_ARG.test(value);
}

export function validatePreviewArgs(args: string[]): string | null {
  if (args.length > MAX_PREVIEW_ARGS) return "La vista previa no admite más de 32 argumentos extra.";
  if (args.some(arg => !isSafePreviewArg(arg))) {
    return "Los argumentos extra contienen caracteres no permitidos.";
  }
  return null;
}

const hasPortArgument = (args: string[]): boolean =>
  args.some(arg => arg === "--port" || arg === "-p" || arg.startsWith("--port="));

/**
 * Argumentos de `npm run` para arrancar la app.
 *
 * El puerto solo se inyecta en los scripts de desarrollo: un `start` puede ser
 * `node dist/server.js`, que no entiende `--port` y fallaria.
 */
export function buildPreviewCommand(script: string, extraArgs: string[], port: number): string[] {
  const args = ["run", script];
  const userArgs = [...extraArgs];
  if (PORT_FLAG_SCRIPTS.has(script) && !hasPortArgument(userArgs)) {
    userArgs.push("--port", String(port));
  }
  if (userArgs.length) args.push("--", ...userArgs);
  return args;
}

/** Localiza el puerto real que anuncia la app en su salida. */
export function detectPreviewUrl(logs: string[], fallbackPort: number): string {
  const pattern = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/gi;
  for (const line of logs) {
    const match = pattern.exec(line);
    if (match) {
      const port = Number(match[1]);
      if (port > 0 && port < 65536) return `http://127.0.0.1:${port}/`;
    }
    pattern.lastIndex = 0;
  }
  return `http://127.0.0.1:${fallbackPort}/`;
}
