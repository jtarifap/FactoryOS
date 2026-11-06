import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readProjectFile, redactSecrets } from "./project-security.js";
import { buildPreviewCommand, choosePreviewScript, detectPreviewUrl, parsePackageJson, splitExtraArgs, validatePreviewArgs } from "./preview-plan.js";
import { isLegacyCheckpointName, resolveProjectDirectory } from "./project-paths.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = path.join(ROOT, "projects");

type Runner = { port: number; url: string; proc: ChildProcess; logs: string[] };

const runners = new Map<string, Runner>();

function safeProjectPath(input: string): string | null {
  const result = resolveProjectDirectory(PROJECTS, input);
  return result.ok ? result.directory : null;
}

const publicLogs = (logs: string[], count: number): string[] =>
  logs.slice(-count).map(redactSecrets);

export type SpawnTaskkill = (command: string, args: string[]) => ChildProcess;

const defaultSpawnTaskkill: SpawnTaskkill = (command, args) =>
  spawn(command, args, { windowsHide: true, stdio: "ignore" });

/**
 * Mata el proceso y toda su descendencia.
 *
 * En Windows `taskkill /T` recorre el arbol de procesos, pero solo puede
 * hacerlo mientras el envoltorio sigue vivo: si se señala antes el handle del
 * padre, los hijos quedan huerfanos y la app sigue escuchando. Por eso se
 * espera a que taskkill termine antes de tocar el padre.
 */
export function killTree(
  proc: ChildProcess,
  platform: string = process.platform,
  spawnTaskkill: SpawnTaskkill = defaultSpawnTaskkill
): Promise<void> {
  if (!proc.pid) return Promise.resolve();
  if (platform !== "win32") {
    try { proc.kill(); } catch {}
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    let parentKillSent = false;
    const killParent = () => {
      if (parentKillSent) return;
      parentKillSent = true;
      try { proc.kill(); } catch {}
      resolve();
    };
    try {
      const killer = spawnTaskkill("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
      killer.once("close", killParent);
      killer.once("error", killParent);
    } catch {
      killParent();
    }
  });
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as { port?: number } | null;
      const port = addr?.port || 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Indica si hay algo escuchando en la url. */
async function probe(url: string, timeoutMs = 900): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/** Puertos habituales de un servidor de desarrollo, usados solo como respaldo. */
const FALLBACK_PORTS = [3000, 5173, 8080];

/**
 * Descubre el puerto real en el que quedo la app.
 *
 * El puerto asignado puede no ser el que usa la app: `vite` ignora la variable
 * `PORT` y solo acepta `--port`, y un `node dist/server.js` puede fijar el
 * suyo. Por eso se lee el puerto de la salida del proceso y, si la app es
 * silenciosa, se comprueban los puertos habituales.
 */
async function resolvePreviewUrl(
  logs: string[],
  requestedPort: number,
  allowFallbacks: boolean
): Promise<{ url: string; port: number } | null> {
  const detected = detectPreviewUrl(logs, requestedPort);
  const detectedPort = Number(new URL(detected).port);
  const candidates = [detectedPort, requestedPort];
  if (allowFallbacks) candidates.push(...FALLBACK_PORTS);

  for (const candidate of [...new Set(candidates)]) {
    const url = `http://127.0.0.1:${candidate}/`;
    if (await probe(url)) return { url, port: candidate };
  }
  return null;
}

/** Instala las dependencias que faltan para poder arrancar la app. */
async function installDependencies(dir: string, logs: string[], timeoutMs = 300_000): Promise<boolean> {
  logs.push("[FactoryOS] Instalando dependencias (npm install)...");
  const proc = spawn("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: dir,
    env: { ...process.env },
    shell: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (data: Buffer) => {
    for (const line of data.toString("utf8").split(/\r?\n/).filter(Boolean)) logs.push(line);
    if (logs.length > 500) logs.splice(0, logs.length - 500);
  };
  proc.stdout?.on("data", collect);
  proc.stderr?.on("data", collect);
  const code = await Promise.race<number | null>([
    new Promise<number | null>(resolve => proc.on("exit", c => resolve(c))),
    (async () => { await delay(timeoutMs); return null; })(),
  ]);
  if (code === null) {
    await killTree(proc);
    logs.push("[FactoryOS] La instalacion de dependencias supero el tiempo maximo.");
    return false;
  }
  if (code !== 0) logs.push(`[FactoryOS] npm install termino con codigo ${code}.`);
  return code === 0;
}

async function readBody(req: http.IncomingMessage, limit = 2000): Promise<string | null> {
  let body = "";
  for await (const c of req) { body += c; if (body.length > limit) return null; }
  return body;
}

export async function handlePreview(req: http.IncomingMessage, res: http.ServerResponse, u: URL): Promise<boolean> {
  const mimeByExt: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };

  const reply = (code: number, data: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  const replyText = (code: number, text: string, type = "text/plain; charset=utf-8") => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(text);
  };

  // List projects
  if (u.pathname === "/api/projects" && req.method === "GET") {
    const list = fs.readdirSync(PROJECTS, { withFileTypes: true })
      // A junction is reported as a directory by some Windows versions. Listing
      // it would expose a folder outside projects/, so it is resolved first.
      .filter(d => d.isDirectory() && !isLegacyCheckpointName(d.name) && resolveProjectDirectory(PROJECTS, d.name).ok)
      .map(d => {
        const dir = path.join(PROJECTS, d.name);
        return { name: d.name, path: dir, hasPackage: fs.existsSync(path.join(dir, "package.json")), hasIndex: fs.existsSync(path.join(dir, "index.html")) };
      });
    reply(200, list);
    return true;
  }

  // Start runner
  if (u.pathname === "/api/preview/start" && req.method === "POST") {
    const body = await readBody(req, 4000);
    if (body === null) { reply(413, { error: "Solicitud demasiado grande" }); return true; }
    let input: any; try { input = JSON.parse(body); } catch { reply(400, { error: "JSON inválido" }); return true; }
    const dir = safeProjectPath(String(input?.directory || ""));
    if (!dir) { reply(400, { error: "Directorio inválido o inexistente dentro de projects/" }); return true; }
    const rel = path.basename(dir);
    const apiOrigin = `http://127.0.0.1:${req.socket.localPort || 4177}`;
    // Static case: no package.json but index.html present → served by DevFactory (no spawn)
    if (!fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "index.html"))) {
      // The url is absolute so it always reaches this server, even when the panel is served by Vite.
      reply(200, { ok: true, mode: "static", url: `${apiOrigin}/preview-static/${encodeURIComponent(rel)}/`, port: 0 });
      return true;
    }
    if (runners.has(dir)) {
      const r = runners.get(dir)!;
      reply(200, { ok: true, mode: "dynamic", url: r.url, port: r.port, logs: publicLogs(r.logs, 30) });
      return true;
    }
    const pkg = parsePackageJson(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (!pkg) { reply(400, { error: "package.json inválido" }); return true; }
    const script = choosePreviewScript(pkg.scripts);
    if (!script) {
      reply(422, { error: "El package.json no tiene ningún script dev, start, preview, serve o watch para arrancar la app." });
      return true;
    }
    const logs: string[] = [];
    const extraArgs = splitExtraArgs(String(input?.args || ""));
    const argsError = validatePreviewArgs(extraArgs);
    if (argsError) { reply(400, { error: argsError }); return true; }
    const install = input?.install !== false;

    if (install && !fs.existsSync(path.join(dir, "node_modules"))) {
      const installed = await installDependencies(dir, logs);
      if (!installed) {
        reply(422, { error: "Faltan las dependencias y `npm install` no pudo completarse. Revisa los logs.", logs: publicLogs(logs, 30) });
        return true;
      }
    }

    const port = await pickFreePort();
    const runArgs = buildPreviewCommand(script, extraArgs, port);
    const proc = spawn("npm", runArgs, { cwd: dir, env: { ...process.env, PORT: String(port), VITE_PORT: String(port), HOST: "127.0.0.1" }, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (data: Buffer) => { for (const l of data.toString("utf8").split(/\r?\n/).filter(Boolean)) logs.push(l); if (logs.length > 500) logs.splice(0, logs.length - 500); };
    proc.stdout!.on("data", collect);
    proc.stderr!.on("data", collect);

    let exited = false;
    let exitCode: number | null = null;
    proc.on("exit", code => {
      exited = true;
      exitCode = code;
      logs.push(`[Process exited with code ${code}]`);
      runners.delete(dir);
    });

    // Wait until the app answers or the process dies.
    // The app may ignore the requested port and announce its own, so the log is
    // checked on every turn to detect it as soon as it appears.
    const deadline = Date.now() + 60_000;
    let answered = false;
    while (Date.now() < deadline) {
      if (exited) break;
      if (await probe(`http://127.0.0.1:${port}/`, 700)) { answered = true; break; }
      const announced = Number(new URL(detectPreviewUrl(logs, port)).port);
      if (announced !== port && await probe(`http://127.0.0.1:${announced}/`, 700)) { answered = true; break; }
      await delay(400);
    }

    if (exited && !answered) {
      reply(422, { error: `La app se detuvo antes de arrancar (codigo ${exitCode}). Revisa los logs.`, logs: publicLogs(logs, 40), script });
      return true;
    }

    const resolved = await resolvePreviewUrl(logs, port, !exited);
    if (!resolved) {
      if (!exited) await killTree(proc);
      reply(422, { error: "La app arranco pero no responde en ningun puerto. Revisa los logs o indica el puerto en los argumentos extra.", logs: publicLogs(logs, 40), script });
      return true;
    }

    const runner: Runner = { port: resolved.port, url: resolved.url, proc, logs };
    runners.set(dir, runner);
    reply(200, { ok: true, mode: "dynamic", url: resolved.url, port: resolved.port, script, logs: publicLogs(logs, 30) });
    return true;
  }

  // Stop runner
  if (u.pathname === "/api/preview/stop" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { reply(413, { error: "Solicitud demasiado grande" }); return true; }
    let input: any; try { input = JSON.parse(body); } catch { reply(400, { error: "JSON inválido" }); return true; }
    const dir = safeProjectPath(String(input?.directory || ""));
    if (!dir) { reply(400, { error: "Directorio inválido" }); return true; }
    const r = runners.get(dir);
    if (r) { await killTree(r.proc); runners.delete(dir); }
    reply(200, { ok: true });
    return true;
  }

  // Status
  if (u.pathname === "/api/preview/status" && req.method === "GET") {
    const dir = safeProjectPath(String(u.searchParams.get("directory") || ""));
    if (!dir) { reply(400, { error: "Directorio inválido" }); return true; }
    const r = runners.get(dir);
    const apiOrigin = `http://127.0.0.1:${req.socket.localPort || 4177}`;
    reply(200, {
      running: !!r,
      url: r ? r.url : (fs.existsSync(path.join(dir, "index.html")) ? `${apiOrigin}/preview-static/${encodeURIComponent(path.basename(dir))}/` : null),
      port: r ? r.port : 0,
      logs: r ? publicLogs(r.logs, 50) : []
    });
    return true;
  }

  // Static project file serving
  if (u.pathname.startsWith("/preview-static/")) {
    const parts = u.pathname.split("/").filter(Boolean);
    let projectName: string;
    try { projectName = parts.length > 1 ? decodeURIComponent(parts[1]) : ""; }
    catch { reply(404, { error: "No encontrado" }); return true; }
    if (!projectName || /[\\/\0]/.test(projectName)) { reply(404, { error: "No encontrado" }); return true; }
    const projectRoot = safeProjectPath(projectName);
    if (!projectRoot) { reply(404, { error: "No encontrado" }); return true; }
    const encodedRelativePath = parts.slice(2).join("/") || "index.html";
    const resolvedFile = readProjectFile(projectRoot, encodedRelativePath);
    if (!resolvedFile) { reply(404, { error: "No encontrado" }); return true; }
    const ext = path.extname(resolvedFile.relativePath).toLowerCase();
    const mime: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".map": "application/json" };
    const headers: Record<string, string> = {
      "Content-Type": mime[ext] || "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      // The preview is meant to be framed by the local panel only.
      "Content-Security-Policy": "frame-ancestors http://127.0.0.1:5173 http://localhost:5173 http://127.0.0.1:4177 http://localhost:4177",
    };
    res.writeHead(200, headers);
    res.end(resolvedFile.data);
    return true;
  }

  return false;
}
