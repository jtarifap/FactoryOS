import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = path.join(ROOT, "projects");
const DATA = path.join(ROOT, "data");
const ZIPS = path.join(DATA, "zips");

function safeProjectPath(input: string): string | null {
  if (!input) return null;
  const dir = path.resolve(PROJECTS, path.basename(input));
  if (!dir.startsWith(PROJECTS + path.sep)) return null;
  try { if (!fs.statSync(dir).isDirectory()) return null; }
  catch { return null; }
  return dir;
}

function createZip(dir: string, outPath: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    const args = ["-a", "-cf", outPath, "-C", dir, "--exclude=node_modules", "--exclude=.git", "--exclude=.env", "--exclude=.env.*", "--exclude=.cache", "--exclude=*.log", "."];
    const proc = spawn("C:\\\\Windows\\\\System32\\\\tar.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", d => out += d.toString("utf8"));
    proc.stderr.on("data", d => out += d.toString("utf8"));
    proc.on("error", e => resolve({ ok: false, error: e.message }));
    proc.on("close", code => resolve({ ok: code === 0, error: code === 0 ? undefined : out.slice(-1000) }));
  });
}

async function readBody(req: http.IncomingMessage, limit = 3000): Promise<string | null> {
  let body = "";
  for await (const c of req) { body += c; if (body.length > limit) return null; }
  return body;
}

export async function handleZip(req: http.IncomingMessage, res: http.ServerResponse, u: URL): Promise<boolean> {
  const reply = (code: number, data: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  // GET /api/projects/zip?directory=<name> -> generate (if needed) and stream.
  if (u.pathname === "/api/projects/zip" && req.method === "GET") {
    const dir = safeProjectPath(String(u.searchParams.get("directory") || ""));
    if (!dir) { reply(400, { error: "Directorio inválido" }); return true; }
    fs.mkdirSync(ZIPS, { recursive: true });
    const out = path.join(ZIPS, `${path.basename(dir)}.zip`);
    const r = await createZip(dir, out);
    if (!r.ok) { reply(500, { error: `No se pudo crear el ZIP: ${r.error || "error desconocido"}` }); return true; }
    const stat = fs.statSync(out);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${path.basename(dir)}.zip"`,
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store"
    });
    const stream = fs.createReadStream(out);
    stream.pipe(res);
    stream.on("error", () => res.end());
    await new Promise<void>(resolve => stream.on("close", () => resolve()));
    return true;
  }
  return false;
}
