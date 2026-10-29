import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProjectFile } from "./project-security.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = path.join(ROOT, "projects");

type Runner = { port: number; url: string; proc: ChildProcess; logs: string[] };

const runners = new Map<string, Runner>();

function safeProjectPath(input: string): string | null {
  if (!input) return null;
  const dir = path.resolve(PROJECTS, path.basename(input));
  try {
    const projectsRoot = fs.realpathSync(PROJECTS);
    const realDir = fs.realpathSync(dir);
    const relative = path.relative(projectsRoot, realDir);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    if (!fs.statSync(realDir).isDirectory()) return null;
    return realDir;
  }
  catch { return null; }
}

function killTree(proc: ChildProcess) {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    try { spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
  }
  try { proc.kill(); } catch {}
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

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(700) });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 400));
    }
  }
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
      .filter(d => d.isDirectory())
      .map(d => {
        const dir = path.join(PROJECTS, d.name);
        return { name: d.name, path: dir, hasPackage: fs.existsSync(path.join(dir, "package.json")), hasIndex: fs.existsSync(path.join(dir, "index.html")) };
      });
    reply(200, list);
    return true;
  }

  // Start runner
  if (u.pathname === "/api/preview/start" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { reply(413, { error: "Solicitud demasiado grande" }); return true; }
    let input: any; try { input = JSON.parse(body); } catch { reply(400, { error: "JSON inválido" }); return true; }
    const dir = safeProjectPath(String(input?.directory || ""));
    if (!dir) { reply(400, { error: "Directorio inválido o inexistente dentro de projects/" }); return true; }
    const rel = path.basename(dir);
    // Static case: no package.json but index.html present → served by DevFactory (no spawn)
    if (!fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "index.html"))) {
      reply(200, { ok: true, mode: "static", url: `/preview-static/${rel}/`, port: 0 });
      return true;
    }
    if (runners.has(dir)) {
      const r = runners.get(dir)!;
      reply(200, { ok: true, mode: "dynamic", url: r.url, port: r.port, logs: r.logs.slice(-30) });
      return true;
    }
    let pkg: any; let scripts: Record<string, string> = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); scripts = pkg.scripts || {}; }
    catch { reply(400, { error: "package.json inválido" }); return true; }
    const chosen = scripts.start ? "start" : scripts.dev ? "dev" : scripts.preview ? "preview" : null;
    if (!chosen) { reply(422, { error: "No hay script start/dev/preview en package.json" }); return true; }
    const port = await pickFreePort();
    const logs: string[] = [];
    const runArgs = ["run", chosen];
    if (chosen !== "start") runArgs.push("--", "--port", String(port));
    const proc = spawn("npm", runArgs, { cwd: dir, env: { ...process.env, CI: "1", PORT: String(port), VITE_PORT: String(port) }, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout!.on("data", (d: Buffer) => { const t = d.toString("utf8"); for (const l of t.split(/\r?\n/).filter(Boolean)) logs.push(l); if (logs.length > 500) logs.splice(0, logs.length - 500); });
    proc.stderr!.on("data", (d: Buffer) => { const t = d.toString("utf8"); for (const l of t.split(/\r?\n/).filter(Boolean)) logs.push(l); if (logs.length > 500) logs.splice(0, logs.length - 500); });
    const url = `http://localhost:${port}/` ;
    const runner: Runner = { port, url, proc, logs };
    proc.on("exit", code => {
      logs.push(`[Process exited with code ${code}]`);
      runners.delete(dir);
    });
    runners.set(dir, runner);
    // Give the process a little time to bind the port
    await waitForPort(port, 12000);
    reply(200, { ok: true, mode: "dynamic", url, port, logs: logs.slice(-20) });
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
    if (r) { killTree(r.proc); runners.delete(dir); }
    reply(200, { ok: true });
    return true;
  }

  // Status
  if (u.pathname === "/api/preview/status" && req.method === "GET") {
    const dir = safeProjectPath(String(u.searchParams.get("directory") || ""));
    if (!dir) { reply(400, { error: "Directorio inválido" }); return true; }
    const r = runners.get(dir);
    reply(200, {
      running: !!r,
      url: r ? r.url : (fs.existsSync(path.join(dir, "index.html")) ? `/preview-static/${path.basename(dir)}/` : null),
      port: r ? r.port : 0,
      logs: r ? r.logs.slice(-50) : []
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
    const resolvedFile = resolveProjectFile(projectRoot, encodedRelativePath);
    if (!resolvedFile) { reply(404, { error: "No encontrado" }); return true; }
    const filePath = resolvedFile.absolutePath;
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".map": "application/json" };
      res.writeHead(200, { "Content-Type": mime[ext] || "text/plain; charset=utf-8" });
      res.end(data);
    } catch { reply(404, { error: "No encontrado" }); }
    return true;
  }

  return false;
}
