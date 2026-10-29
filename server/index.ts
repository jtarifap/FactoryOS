import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { handlePreview } from "./runner.js";
import { handleZip } from "./zip.js";
import { JobProcessRegistry, terminateChildTree, WorkerLease } from "./job-coordinator.js";
import { appendVerificationEvidence, getProjectVerification, runProjectChecks, type VerificationCheck } from "./project-verification.js";
import { captureDeliveryReportState, validateDeliveryCompletion, wasDeliveryReportUpdatedSince } from "./delivery-report.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.OPENCODE_DB = ":memory:";
const DATA = path.join(ROOT, "data");
const PROJECTS = path.join(ROOT, "projects");
const DB = path.join(DATA, "jobs.json");
const SETTINGS_FILE = path.join(DATA, "settings.json");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(PROJECTS, { recursive: true });

type Status = "queued" | "running" | "done" | "failed" | "cancelled" | "needs_intervention" | "validated";
type ModelMeta = {
  id: string;
  name: string;
  providerID: string;
  status?: string;
  capabilities?: { reasoning: boolean; input: { text: boolean; image: boolean; audio: boolean; pdf: boolean; video: boolean } };
  limit?: { context: number; output: number };
  cost?: { input: number; output: number };
};
type AgentId = "factory-manager" | "developer" | "qa-reviewer" | "delivery-manager";
type ModelSettings = {
  mode: "independent" | "common";
  commonModel: string;
  agentModels: Record<AgentId, string>;
  modelStatus: Record<string, "ok" | "no-results">;
  autoApprove: boolean;
};
type Job = { id: string; name: string; request: string; status: Status; phase: string; createdAt: string; updatedAt: string; directory: string; logs: string[]; lastError?: string };

const DEFAULT_SETTINGS: ModelSettings = {
  mode: "independent",
  commonModel: "opencode/big-pickle",
  agentModels: {
    "factory-manager": "opencode/big-pickle",
    developer: "opencode-go/kimi-k2.7-code",
    "qa-reviewer": "opencode/big-pickle",
    "delivery-manager": "opencode/big-pickle"
  },
  modelStatus: {},
  autoApprove: false
};
let settings: ModelSettings = structuredClone(DEFAULT_SETTINGS);
try {
  const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  settings = {
    mode: saved.mode === "common" ? "common" : "independent",
    commonModel: typeof saved.commonModel === "string" ? saved.commonModel : DEFAULT_SETTINGS.commonModel,
    agentModels: {
      "factory-manager": typeof saved.agentModels?.["factory-manager"] === "string" ? saved.agentModels["factory-manager"] : DEFAULT_SETTINGS.agentModels["factory-manager"],
      developer: typeof saved.agentModels?.developer === "string" ? saved.agentModels.developer : DEFAULT_SETTINGS.agentModels.developer,
      "qa-reviewer": typeof saved.agentModels?.["qa-reviewer"] === "string" ? saved.agentModels["qa-reviewer"] : DEFAULT_SETTINGS.agentModels["qa-reviewer"],
      "delivery-manager": typeof saved.agentModels?.["delivery-manager"] === "string" ? saved.agentModels["delivery-manager"] : DEFAULT_SETTINGS.agentModels["delivery-manager"]
    },
    modelStatus: typeof saved.modelStatus === "object" && saved.modelStatus ? saved.modelStatus : {},
    autoApprove: saved.autoApprove === true
  };
} catch {}
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
saveSettings();

let jobs: Job[] = [];
try { jobs = JSON.parse(fs.readFileSync(DB, "utf8")); } catch {}
/** Recovers a failure reason from logs of jobs that failed before lastError existed. */
function reasonFromLogs(j: Job): string | null {
  const lines = j.logs.map(line => line.replace(/^\[[^\]]+\]\s*/, "").replace(/\u001b\[[0-9;]*m/g, ""));
  const errorLine = [...lines].reverse().find(line => /Error:|error\.error=|auto-rejecting|Validación de modelos fallida|Motivo del fallo/i.test(line));
  if (!errorLine) return null;
  if (/auto-rejecting|permission requested/i.test(errorLine)) return "OpenCode rechazó automáticamente los permisos de herramientas. Activa \"Permitir herramientas sin preguntar\" en la configuración.";
  for (const { test, message } of KNOWN_MODEL_ERRORS) if (test.test(errorLine)) return message;
  return errorLine.replace(/^.*?(Error:|fallida:|fallo:)\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
}

for (const j of jobs) if (j.status === "running") {
  j.status = "failed"; j.phase = "Interrumpido al reiniciar";
  j.lastError = "El servidor se reinició mientras el trabajo estaba en ejecución.";
  j.logs.push("Proceso interrumpido: revisa los archivos antes de reintentar.");
}
const save = () => fs.writeFileSync(DB, JSON.stringify(jobs, null, 2));
save();
let active: { id: string; child: ChildProcessByStdio<null, Readable, Readable> } | null = null;
const workerLease = new WorkerLease();
const jobProcesses = new JobProcessRegistry(killTree);
const stamp = () => new Date().toISOString();
function log(j: Job, s: string) {
  j.logs.push(...s.split(/\r?\n/).filter(Boolean).map(x => `[${stamp()}] ${x.slice(0, 3000)}`));
  if (j.logs.length > 600) j.logs = j.logs.slice(-600);
  j.updatedAt = stamp(); save();
}
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "proyecto";

/**
 * On Windows the `opencode` command is an npm shim (opencode.cmd) that spawns cmd.exe.
 * Killing that shell leaves the real opencode.exe orphaned, which keeps locks and makes
 * every later run hang. Prefer the real executable so signals reach the actual process.
 */
const OPENCODE_BIN = (() => {
  if (process.platform !== "win32") return "opencode";
  const appData = process.env.APPDATA;
  const candidates = [
    appData ? path.join(appData, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "pnpm", "global", "5", "node_modules", "opencode-ai", "bin", "opencode.exe") : ""
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return "opencode.cmd";
})();

function killTree(child: ChildProcess) {
  terminateChildTree(child, process.platform, (command, args) =>
    spawn(command, args, { windowsHide: true, stdio: "ignore" })
  );
}

function effectiveModel(agent: AgentId): string {
  if (settings.mode === "common") return settings.commonModel;
  return settings.agentModels[agent].trim() || settings.commonModel;
}
function normalizeSettings(input: any): ModelSettings | null {
  if (!input || !["independent", "common"].includes(input.mode)) return null;
  const commonModel = String(input.commonModel ?? "").trim();
  const agentModels = input.agentModels ?? {};
  const values = [commonModel, agentModels["factory-manager"], agentModels.developer, agentModels["qa-reviewer"], agentModels["delivery-manager"]];
  // OpenCode model IDs are provider/model. Restrict input before using it in command arguments.
  if (values.some(v => typeof v !== "string" || !String(v).trim() || String(v).length > 160 || !/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(String(v).trim()))) return null;
  return {
    mode: input.mode,
    commonModel,
    agentModels: {
      "factory-manager": String(agentModels["factory-manager"]).trim(),
      developer: String(agentModels.developer).trim(),
      "qa-reviewer": String(agentModels["qa-reviewer"]).trim(),
      "delivery-manager": String(agentModels["delivery-manager"]).trim()
    },
    modelStatus: typeof settings?.modelStatus === "object" && settings.modelStatus ? settings.modelStatus : {},
    autoApprove: input.autoApprove === true
  };
}

function listOpenCodeModels(jobId?: string): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise(resolve => {
    const child = spawn(OPENCODE_BIN, ["models"], { cwd: ROOT, env: { ...process.env, CI: "1", NO_COLOR: "1" }, shell: OPENCODE_BIN.endsWith(".cmd") || OPENCODE_BIN.endsWith(".bat"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (jobId) jobProcesses.add(jobId, child);
    let output = "";
    let settled = false;
    let timedOut = false;
    const finish = (result: { ok: boolean; output: string; error?: string }) => {
      if (settled) return; settled = true; clearTimeout(timer); resolve(result);
    };
    const timer = setTimeout(() => { if (settled) return; timedOut = true; killTree(child); }, 15000);
    child.stdout.on("data", (d: Buffer) => { output += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { output += d.toString("utf8"); });
    child.on("error", e => finish({ ok: false, output, error: `No se pudo ejecutar OpenCode: ${e.message}. Comprueba que opencode está instalado y en PATH.` }));
    child.on("close", code => finish(timedOut
      ? { ok: false, output, error: "La consulta `opencode models` ha superado 15 segundos." }
      : { ok: code === 0, output, ...(code === 0 ? {} : { error: `opencode models terminó con código ${code}.` }) }));
  });
}
async function validateConfiguredModels(jobId?: string): Promise<{ ok: boolean; models: string[]; message: string; output?: string }> {
  const required = [...new Set([effectiveModel("factory-manager"), effectiveModel("developer"), effectiveModel("qa-reviewer")])];
  const result = await listOpenCodeModels(jobId);
  if (!result.ok) return { ok: false, models: required, message: result.error || "No se pudo consultar OpenCode.", output: result.output.slice(-5000) };
  const clean = result.output.replace(/\u001b\[[0-9;]*m/g, "");
  const missing = required.filter(model => !clean.includes(model));
  if (missing.length) return { ok: false, models: required, message: `No aparecen en \`opencode models\`: ${missing.join(", ")}. Comprueba el ID exacto y la disponibilidad del proveedor.`, output: clean.slice(-5000) };
  return { ok: true, models: required, message: "Todos los modelos configurados aparecen en `opencode models`." };
}

function parseModelBlocks(output: string): ModelMeta[] {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/);
  const blocks: { id: string; json: string }[] = [];
  let currentId = "";
  let currentJson = "";
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
    if (match && !trimmed.startsWith("{") && !trimmed.startsWith('"')) {
      if (currentId && currentJson) blocks.push({ id: currentId, json: currentJson });
      currentId = trimmed;
      currentJson = "";
    } else if (currentId) {
      currentJson += line + "\n";
    }
  }
  if (currentId && currentJson) blocks.push({ id: currentId, json: currentJson });
  const result: ModelMeta[] = [];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b.json.trim());
      result.push({
        id: b.id,
        name: typeof data.name === "string" ? data.name : b.id,
        providerID: typeof data.providerID === "string" ? data.providerID : b.id.split("/")[0],
        status: typeof data.status === "string" ? data.status : undefined,
        capabilities: data.capabilities ? {
          reasoning: !!data.capabilities.reasoning,
          input: {
            text: !!data.capabilities.input?.text,
            image: !!data.capabilities.input?.image,
            audio: !!data.capabilities.input?.audio,
            pdf: !!data.capabilities.input?.pdf,
            video: !!data.capabilities.input?.video
          }
        } : undefined,
        limit: data.limit ? { context: Number(data.limit.context) || 0, output: Number(data.limit.output) || 0 } : undefined,
        cost: data.cost ? { input: Number(data.cost.input) || 0, output: Number(data.cost.output) || 0 } : undefined
      });
    } catch {}
  }
  return result;
}

function listOpenCodeModelsVerbose(): Promise<{ ok: boolean; models: ModelMeta[]; error?: string }> {
  const bin = OPENCODE_BIN;
  const commandErrorWrapped = new Promise<{ ok: boolean; models: ModelMeta[]; error?: string }>(resolve => {
    const child = spawn(bin, ["models", "--verbose"], { cwd: ROOT, env: { ...process.env, CI: "1", NO_COLOR: "1" }, shell: bin.endsWith(".cmd") || bin.endsWith(".bat"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    const finish = (result: { ok: boolean; models: ModelMeta[]; error?: string }) => {
      if (settled) return; settled = true; clearTimeout(timer); resolve(result);
    };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, models: [], error: "La consulta `opencode models --verbose` ha superado 30 segundos." }); }, 30000);
    child.stdout.on("data", (d: Buffer) => { output += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { output += d.toString("utf8"); });
    child.on("error", e => finish({ ok: false, models: [], error: `No se pudo ejecutar OpenCode: ${e.message}. Comprueba que opencode está instalado y en el PATH.` }));
    child.on("close", code => {
      const models = parseModelBlocks(output);
      if (code === 0 && models.length) finish({ ok: true, models });
      else finish({ ok: false, models, error: code === 0 ? "No se pudieron parsear modelos." : `opencode models --verbose terminó con código ${code}.` });
    });
  });

  return (async () => {
    const result = await commandErrorWrapped;
    if (result.ok) return result;
    const cachePath = path.join(os.homedir(), ".cache", "opencode", "models.json");
    if (!fs.existsSync(cachePath)) return result;
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      const flat: ModelMeta[] = [];
      for (const provider of Object.values(cache || {})) {
        const providerID = typeof (provider as any)?.id === "string" ? (provider as any).id : "";
        const models = (provider as any)?.models;
        if (!models || typeof models !== "object") continue;
        for (const [modelId, info] of Object.entries(models)) {
          const id = typeof (info as any)?.id === "string" ? (info as any).id : (typeof (info as any)?.canonical_model_id === "string" ? (info as any).canonical_model_id : modelId);
          if (!id || !id.includes("/")) continue;
          flat.push({
            id,
            name: typeof (info as any)?.name === "string" ? (info as any).name : id,
            providerID: typeof (info as any)?.providerID === "string" ? (info as any).providerID : (providerID || id.split("/")[0]),
            status: typeof (info as any)?.status === "string" ? (info as any).status : undefined,
            capabilities: (info as any)?.capabilities ? {
              reasoning: !!(info as any).capabilities.reasoning,
              input: {
                text: !!(info as any).capabilities.input?.text,
                image: !!(info as any).capabilities.input?.image,
                audio: !!(info as any).capabilities.input?.audio,
                pdf: !!(info as any).capabilities.input?.pdf,
                video: !!(info as any).capabilities.input?.video
              }
            } : undefined,
            limit: (info as any)?.limit ? { context: Number((info as any).limit.context) || 0, output: Number((info as any).limit.output) || 0 } : undefined,
            cost: (info as any)?.cost ? { input: Number((info as any).cost.input) || 0, output: Number((info as any).cost.output) || 0 } : undefined
          });
        }
      }
      return { ok: true, models: flat };
    } catch {
      return result;
    }
  })();
}

const KNOWN_MODEL_ERRORS: { test: RegExp; message: string }[] = [
  { test: /free usage limit reached/i, message: "Límite de uso gratuito del proveedor alcanzado. Usa un modelo con cuota disponible o revisa tu plan." },
  { test: /exceeded your current quota|quota exceeded/i, message: "Cuota del proveedor agotada (free tier). Revisa tu plan o espera al reset." },
  { test: /invalid credential|invalid_credential|invalid api key|unauthorized|401\b/i, message: "Credenciales del proveedor no válidas. Revisa la API key de ese proveedor." },
  { test: /rate limit|429\b|too many requests/i, message: "Límite de peticiones del proveedor alcanzado." },
  { test: /model .* not (found|supported)|does not exist/i, message: "El modelo no existe o no está disponible en el proveedor." },
  { test: /insufficient (credit|balance)|payment required|402\b/i, message: "Sin saldo o crédito en el proveedor." }
];

const ERROR_LINE = /level=ERROR|AI_APICallError|RetryError|error\.error=|^\s*Error:/;

function errorLinesOf(output: string): string[] {
  return output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter(line => ERROR_LINE.test(line));
}

function detectModelError(output: string): string | null {
  // Only inspect lines that are actually error logs, so model output cannot trigger false positives.
  const errorLines = errorLinesOf(output);
  if (!errorLines.length) return null;
  const haystack = errorLines.join("\n");
  for (const { test, message } of KNOWN_MODEL_ERRORS) if (test.test(haystack)) return message;
  return null;
}

/** Short human-readable reason extracted from OpenCode output, used when no known pattern matches. */
function summarizeOutputError(output: string): string | null {
  const lines = errorLinesOf(output);
  if (!lines.length) return null;
  const line = lines[lines.length - 1]
    .replace(/^.*?error\.error=/, "")
    .replace(/^.*?message=/, "")
    .replace(/^.*?Error:\s*/, "")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^"|"$/g, "")
    .trim();
  return line ? line.slice(0, 300) : null;
}

function testOpenCodeModel(model: string, _agent: AgentId): Promise<{ ok: boolean; error?: string; duration: number }> {
  return new Promise(resolve => {
    const start = Date.now();
    const bin = OPENCODE_BIN;
    // --print-logs is required: without it provider failures (quota, auth, rate limit) are swallowed
    // and the run looks like a silent hang until the timeout.
    // Test the provider, not the factory agent's planning/development instructions.
    const args = ["run", "--model", model, "--agent", "build", "--format", "json", "--print-logs", "--log-level", "ERROR", "Prueba de conexión al modelo. Responde únicamente OK. No uses herramientas, skills ni archivos. No planifiques ni ejecutes tareas del proyecto."];
    const child = spawn(bin, args, { cwd: ROOT, env: { ...process.env, CI: "1", NO_COLOR: "1" }, shell: bin.endsWith(".cmd") || bin.endsWith(".bat"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let stdout = "";
    let finished = false;
    const cleanup = () => { clearTimeout(timer); killTree(child); };
    const timer = setTimeout(() => {
      if (finished) return; finished = true; cleanup();
      const summarized = summarizeOutputError(output);
      resolve({ ok: false, error: summarized ? `El modelo falló: ${summarized}` : "Timeout (90s): el modelo no respondió.", duration: Date.now() - start });
    }, 90000);
    const onData = (d: Buffer) => {
      output += d.toString("utf8");
      const known = detectModelError(output);
      // OpenCode retries provider failures with backoff; abort as soon as the real reason appears.
      if (known && !finished) {
        finished = true; cleanup();
        resolve({ ok: false, error: known, duration: Date.now() - start });
      }
    };
    child.stdout!.on("data", (d: Buffer) => { stdout += d.toString("utf8"); onData(d); });
    child.stderr!.on("data", onData);
    child.on("error", e => {
      if (finished) return; finished = true; clearTimeout(timer);
      resolve({ ok: false, error: `No se pudo ejecutar OpenCode: ${e.message}`, duration: Date.now() - start });
    });
    child.on("close", code => {
      if (finished) return; finished = true; clearTimeout(timer);
      const known = detectModelError(output);
      if (known) return resolve({ ok: false, error: known, duration: Date.now() - start });
      if (code === 0) {
        const hasText = stdout.split(/\r?\n/).some(line => {
          try { const event = JSON.parse(line); return event.type === "text" && typeof event.part?.text === "string" && event.part.text.trim().length > 0; }
          catch { return false; }
        });
        return resolve({ ok: hasText, ...(hasText ? {} : { error: "OpenCode terminó sin respuesta de texto del modelo." }), duration: Date.now() - start });
      }
      const summarized = summarizeOutputError(output);
      const tail = summarized || output.replace(/\u001b\[[0-9;]*m/g, "").slice(-600).replace(/\s+/g, " ").trim();
      resolve({ ok: false, error: `Salida ${code}: ${tail || "sin salida"}`, duration: Date.now() - start });
    });
  });
}

function runAgent(j: Job, agent: AgentId, prompt: string): Promise<boolean> {
  return new Promise(resolve => {
    if (j.status === "cancelled") return resolve(false);
    const model = effectiveModel(agent);
    j.phase = `${agent} · ${model}`; save();
    const args = ["run", "--model", model, "--agent", agent];
    if (settings.autoApprove) args.push("--auto");
    args.push(prompt);
    const child = spawn(OPENCODE_BIN, args, { cwd: j.directory, env: { ...process.env, CI: "1" }, shell: OPENCODE_BIN.endsWith(".cmd") || OPENCODE_BIN.endsWith(".bat"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    jobProcesses.add(j.id, child);
    active = { id: j.id, child };
    let finished = false;
    let tailOutput = "";
    const timer = setTimeout(() => { log(j, "Tiempo máximo de fase agotado (20 min)."); killTree(child); }, 20 * 60 * 1000);
    const onData = (d: Buffer) => {
      const text = d.toString("utf8");
      tailOutput = (tailOutput + text).slice(-20000);
      log(j, text);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("error", e => log(j, "Error al iniciar OpenCode: " + e.message));
    child.on("close", code => {
      if (finished) return; finished = true; clearTimeout(timer); active = null;
      log(j, `Agente ${agent} · modelo ${model}: salida ${code}`);
      if (code === 0 && j.status !== "cancelled") return resolve(true);
      if (j.status === "cancelled") return resolve(false);
      // Persist the real reason so the UI does not just say "Falló <agent>".
      const reason = detectModelError(tailOutput) || summarizeOutputError(tailOutput);
      if (reason) {
        j.lastError = `${agent}: ${reason}`;
        log(j, `Motivo del fallo: ${reason}`);
      } else {
        const autoRejected = /auto-rejecting|permission requested/i.test(tailOutput);
        j.lastError = autoRejected
          ? `${agent}: OpenCode rechazó automáticamente los permisos de herramientas. Activa "Permitir herramientas sin preguntar" en la configuración o revisa los permisos del agente.`
          : `${agent}: el proceso terminó con código ${code} sin mensaje de error reconocible.`;
        log(j, `Motivo del fallo: ${j.lastError}`);
      }
      save();
      resolve(false);
    });
  });
}

/** Lightweight agent run used by the "brain" phase to classify job complexity. */
function runLightAgent(j: Job, prompt: string): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    if (j.status === "cancelled") return resolve({ ok: false, output: "" });
    const model = effectiveModel("developer");
    j.phase = `brain · ${model}`; save();
    const child = spawn(OPENCODE_BIN, ["run", "--model", model, "--agent", "build", prompt], { cwd: j.directory, env: { ...process.env, CI: "1" }, shell: OPENCODE_BIN.endsWith(".cmd") || OPENCODE_BIN.endsWith(".bat"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    jobProcesses.add(j.id, child);
    let output = "";
    let done = false;
    let timedOut = false;
    const timer = setTimeout(() => { if (done) return; timedOut = true; killTree(child); }, 20 * 60 * 1000);
    const onData = (d: Buffer) => { output += d.toString("utf8"); log(j, d.toString("utf8")); };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("error", e => { if (done) return; done = true; clearTimeout(timer); log(j, "Error al iniciar OpenCode: " + e.message); resolve({ ok: false, output }); });
    child.on("close", code => {
      if (done) return; done = true; clearTimeout(timer);
      if (code === 0 && !timedOut && j.status !== "cancelled") return resolve({ ok: true, output });
      resolve({ ok: false, output });
    });
  });
}

function execInProject(j: Job, command: string, args: string[], timeout = 180000): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const proc = spawn(command, args, { cwd: j.directory, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    jobProcesses.add(j.id, proc);
    let output = "";
    let finished = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (finished) return; timedOut = true; try { killTree(proc); } catch {}
    }, timeout);
    const onData = (d: Buffer) => { output += d.toString("utf8"); log(j, d.toString("utf8")); };
    proc.stdout!.on("data", onData);
    proc.stderr!.on("data", onData);
    proc.on("error", e => {
      if (finished) return; finished = true; clearTimeout(timer);
      resolve({ ok: false, output: `${output}\n[ERROR: ${e.message}]` });
    });
    proc.on("close", code => {
      if (finished) return; finished = true; clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, output: timedOut ? `${output}\n[TIMEOUT: ${timeout}ms exceeded]` : output });
    });
  });
}

async function verifyProject(j: Job): Promise<{ ok: boolean; summary: string }> {
  const verification = getProjectVerification(j.directory);
  if (verification.kind === "static") return { ok: true, summary: "Verificación superficial: index.html presente (proyecto estático)." };
  if (verification.kind === "invalid") {
    const summary = verification.error || "El proyecto no tiene verificaciones válidas.";
    appendVerificationEvidence(j.directory, [], false);
    return { ok: false, summary };
  }
  let installSummary = "";
  const installCheck: VerificationCheck[] = [];
  // Install dependencies only if missing.
  if (!fs.existsSync(path.join(j.directory, "node_modules"))) {
    const install = await execInProject(j, "npm", ["install"], 240000);
    installSummary = `npm install: ${install.ok ? "OK" : "FAIL"}`;
    installCheck.push({ command: "npm install", ok: install.ok });
    if (!install.ok) {
      const summary = `${installSummary}\n${install.output.slice(-3000)}`;
      appendVerificationEvidence(j.directory, installCheck, false);
      return { ok: false, summary };
    }
  }
  const checks = await runProjectChecks(j.directory, verification.scripts, async (directory, script) =>
    execInProject(j, "npm", script === "build" ? ["run", "build"] : ["test"], 240000)
  );
  const verificationChecks = [...installCheck, ...checks.checks];
  const summary = [installSummary, checks.summary, checks.output].filter(Boolean).join("\n");
  appendVerificationEvidence(j.directory, verificationChecks, checks.ok);
  return { ok: checks.ok, summary: summary || "Verificación técnica OK." };
}

async function worker() {
  const releaseWorker = workerLease.tryAcquire();
  if (!releaseWorker) return;
  const j = jobs.find(x => x.status === "queued");
  if (!j) { releaseWorker(); return; }
  j.status = "running"; j.updatedAt = stamp(); save();
  try {
    log(j, "Validando los modelos configurados con `opencode models` antes de ejecutar...");
    const validation = await validateConfiguredModels(j.id);
    if ((j.status as Status) === "cancelled") return;
    if (!validation.ok) {
      log(j, "Validación de modelos fallida: " + validation.message);
      if (validation.output) log(j, validation.output);
      j.status = "failed"; j.phase = "Modelos no válidos o no disponibles";
      j.lastError = validation.message;
    } else {
      log(j, validation.message);
      // Brain phase: decide whether the job needs the full pipeline (plan → code → QA) or just a focused implementation.
      log(j, "Fase brain: evaluando la complejidad de la solicitud antes de delegar el trabajo.");
      const brain = await runLightAgent(j, `Evalúa la naturaleza de esta solicitud y responde SOLO con una palabra en mayúsculas: STATIC si basta HTML/CSS estático sin lógica/backend/build, SIMPLE si es un ejemplo mínimo con poco código, COMPLEJA si requiere arquitectura, backend, frontend o varias funcionalidades. Solicitud: ${j.request}`);
      if ((j.status as Status) === "cancelled") { j.phase = "Cancelado"; return; }
      const brainText = brain.ok ? brain.output.toUpperCase() : "";
      const isStatic = brain.ok && /\bSTATIC\b/.test(brainText) && !/\bSIMPLE\b/.test(brainText) && !/\bCOMPLEJA\b/.test(brainText);
      const isSimple = brain.ok && /\bSIMPLE\b/.test(brainText) && !/\bCOMPLEJA\b/.test(brainText) && !/\bSTATIC\b/.test(brainText);
      let tasks: [AgentId, string][];
      if (isStatic) {
        log(j, "Solicitud estática detectada por el brain: se omite planificación y QA.");
        tasks = [
          ["developer", `Implementa la aplicación solicitada como una página HTML/CSS estática mínima, sin lógica, backend ni build. Genera obligatoriamente un archivo index.html (landing page) y los estilos necesarios, además de README.md. Solicitud: ${j.request}. No despliegues, no hagas push ni uses secretos.`]
        ];
      } else if (isSimple) {
        log(j, "Solicitud simple detectada por el brain: se omite la fase de planificación.");
        tasks = [
          ["developer", `Implementa la aplicación solicitada de forma mínima y funcional. Genera README.md, scripts build/test y pruebas. Solicitud: ${j.request}. No uses arquitectura compleja si la solicitud no la exige. No despliegues, no hagas push ni uses secretos.`],
          ["qa-reviewer", `Revisa el proyecto, ejecuta build y pruebas disponibles. Documenta resultados reales y problemas en QA_REPORT.md. Si hay errores de compilación, corrige los problemas sencillos. No declares éxito sin ejecutar pruebas.`]
        ];
      } else {
        log(j, "Solicitud compleja (o indeterminada por defecto): se ejecuta el pipeline completo.");
        tasks = [
          ["factory-manager", `Analiza esta solicitud y crea PLAN.md con requisitos, arquitectura, hitos y criterios verificables. No modifiques archivos fuera de este proyecto. Solicitud: ${j.request}`],
          ["developer", `Implementa la aplicación solicitada siguiendo PLAN.md. Genera README.md, scripts build/test y pruebas. Solicitud: ${j.request}. No despliegues, no hagas push ni uses secretos.`],
          ["qa-reviewer", `Revisa el proyecto, ejecuta build y pruebas disponibles. Documenta resultados reales y problemas en QA_REPORT.md. Si hay errores de compilación, corrige los problemas sencillos. No declares éxito sin ejecutar pruebas.`]
        ];
      }
      for (const [agent, prompt] of tasks) {
        if ((j.status as Status) === "cancelled") break;
        log(j, `Comienza fase: ${agent} · modelo ${effectiveModel(agent)}`);
        const ok = await runAgent(j, agent, prompt);
        if (!ok) {
          if ((j.status as Status) !== "cancelled") { j.status = "failed"; j.phase = `Falló ${agent}`; }
          break;
        }
      }
      const needsCorrection = (tasks.some(t => t[0] === "qa-reviewer") || tasks.some(t => t[0] === "delivery-manager" ? false : false)) && j.status === "running";
      let attempts = 0;
      // Technical verification loop with auto-correction (max 3 attempts)
      if (j.status === "running" && tasks.some(t => t[0] === "developer")) {
        let verify = await verifyProject(j);
        if (!verify.ok) {
          while (attempts < 3 && !verify.ok) {
            attempts++;
            log(j, `Verificación técnica fallida (intento ${attempts}/3): ${verify.summary.split("\n")[0]}`);
            if ((j.status as Status) === "cancelled") break;
            j.phase = `Corrigiendo errores (intento ${attempts}/3)`;
            save();
            const correctionPrompt = `Corrige los errores técnicos detectados en el proyecto. Errores y logs disponibles:\n${verify.summary.slice(0, 8000)}\n\nRevisa el código, corrige y vuelve a intentar compilar/ejecutar. No despliegues, no hagas push ni uses secretos.`;
            const devOk = await runAgent(j, "developer", correctionPrompt);
            if ((j.status as Status) === "cancelled") break;
            if (!devOk) { j.status = "failed"; j.phase = "Falló developer (corrección)"; break; }
            if (tasks.some(t => t[0] === "qa-reviewer")) {
              const qaOk = await runAgent(j, "qa-reviewer", `Revisa de nuevo el proyecto tras la corrección. Ejecuta build y pruebas; documenta en QA_REPORT.md.`);
              if ((j.status as Status) === "cancelled") break;
              if (!qaOk) { j.status = "failed"; j.phase = "Falló qa-reviewer (corrección)"; break; }
            }
            const v2 = await verifyProject(j);
            if (v2.ok) { verify = { ok: true, summary: "Verificación técnica OK tras corrección." }; break; }
            else verify = v2;
          }
        }
        if ((j.status as Status) !== "failed" && (j.status as Status) !== "cancelled") {
          if (!verify.ok) {
            j.status = "needs_intervention";
            j.phase = "Requiere intervención";
            j.lastError = verify.summary.slice(0, 3000);
          } else {
            // Delivery phase
            j.phase = "Preparando entrega";
            save();
            const deliveryBeforeState = captureDeliveryReportState(j.directory);
            const deliveryStartedAtNs = BigInt(Date.now()) * 1_000_000n;
            const delOk = await runAgent(j, "delivery-manager", `Revisa el proyecto final y crea o actualiza DELIVERY_REPORT.md. El archivo debe incluir estos encabezados exactos, cada uno con contenido útil:
## Funcionalidades
## Dependencias
## Variables de entorno
## Instalación y ejecución
## Problemas conocidos y limitaciones
No incluyas valores secretos ni afirmes verificaciones sin evidencia. No modifiques código, no despliegues ni hagas push.`);
            if ((j.status as Status) === "cancelled") return;
            const reportPath = path.join(j.directory, "DELIVERY_REPORT.md");
            const reportContent = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
            const reportFresh = wasDeliveryReportUpdatedSince(j.directory, deliveryStartedAtNs, deliveryBeforeState);
            const deliveryCompletion = validateDeliveryCompletion(delOk, reportFresh, reportContent);
            if (!deliveryCompletion.ok) {
              const reason = !delOk && j.lastError ? j.lastError : deliveryCompletion.error || "Informe de entrega inválido.";
              j.status = "failed";
              j.phase = "Falló delivery-manager";
              j.lastError = reason;
              log(j, `Motivo del fallo: ${reason}`);
            } else {
              j.status = "validated";
              j.phase = "Validado (ver QA_REPORT.md y DELIVERY_REPORT.md)";
            }
          }
        }
      }
      if (j.status === "running") { j.status = "done"; j.phase = "Revisión terminada (ver QA_REPORT.md)"; }
    }
  } catch (e) {
    if ((j.status as Status) !== "cancelled") { j.status = "failed"; j.phase = "Error de ejecución"; log(j, String(e)); }
  } finally {
    await jobProcesses.finish(j.id);
    j.updatedAt = stamp(); save();
    releaseWorker();
    if (jobs.some(job => job.status === "queued")) setImmediate(worker);
  }
}

function safeProjectPath(input: string): string | null {
  if (!input) return null;
  const dir = path.resolve(PROJECTS, path.basename(input));
  if (!dir.startsWith(PROJECTS + path.sep)) return null;
  try { if (!fs.statSync(dir).isDirectory()) return null; }
  catch { return null; }
  return dir;
}

const reply = (res: http.ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};
const readBody = async (req: http.IncomingMessage, limit = 20000): Promise<string | null> => {
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > limit) return null; }
  return body;
};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  if (u.pathname === "/api/health") return reply(res, 200, { ok: true, mode: "local", active: active?.id || null });
  if (u.pathname === "/api/settings" && req.method === "GET") return reply(res, 200, settings);
  if (u.pathname === "/api/settings" && req.method === "PUT") {
    const body = await readBody(req, 10000);
    if (body === null) return reply(res, 413, { error: "Configuración demasiado grande" });
    let input: unknown; try { input = JSON.parse(body); } catch { return reply(res, 400, { error: "JSON inválido" }); }
    const next = normalizeSettings(input);
    if (!next) return reply(res, 400, { error: "Configuración no válida. Usa IDs de modelo con formato proveedor/modelo." });
    settings = next; saveSettings();
    return reply(res, 200, { ok: true, settings });
  }
  if (u.pathname === "/api/settings/validate" && req.method === "POST") {
    const result = await validateConfiguredModels();
    return reply(res, result.ok ? 200 : 422, result);
  }
  if (u.pathname === "/api/models" && req.method === "GET") {
    const result = await listOpenCodeModelsVerbose();
    if (!result.ok) return reply(res, 500, { error: result.error || "No se pudieron obtener modelos", models: result.models });
    return reply(res, 200, { models: result.models });
  }
  if (u.pathname === "/api/models/test" && req.method === "POST") {
    const body = await readBody(req, 1000);
    if (body === null) return reply(res, 413, { error: "Solicitud demasiado grande" });
    let input: any; try { input = JSON.parse(body); } catch { return reply(res, 400, { error: "JSON inválido" }); }
    const model = String(input.model || "").trim();
    const agent = input.agent as AgentId;
    if (!model || !["factory-manager", "developer", "qa-reviewer", "delivery-manager"].includes(agent)) return reply(res, 400, { error: "Modelo o agente no válido" });
    const result = await testOpenCodeModel(model, agent);
    let history: any[] = [];
    try { history = JSON.parse(fs.readFileSync(path.join(DATA, "model-tests.json"), "utf8")); } catch {}
    history.push({ timestamp: stamp(), model, agent, ok: result.ok, error: result.error, duration: result.duration });
    if (history.length > 500) history = history.slice(-500);
    fs.writeFileSync(path.join(DATA, "model-tests.json"), JSON.stringify(history, null, 2), "utf8");
    settings.modelStatus[model] = result.ok ? "ok" : "no-results";
    saveSettings();
    return reply(res, result.ok ? 200 : 422, result);
  }
  if (u.pathname === "/api/jobs" && req.method === "GET") return reply(res, 200, jobs.map(x => ({ ...x, request: x.request.slice(0, 1000) })).reverse());
  if (u.pathname === "/api/jobs" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) return reply(res, 413, { error: "Solicitud demasiado grande" });
    let input: any; try { input = JSON.parse(body); } catch { return reply(res, 400, { error: "JSON inválido" }); }
    const name = String(input.name || "").trim(), request = String(input.request || "").trim();
    if (!name || name.length > 55 || request.length < 15 || request.length > 12000) return reply(res, 400, { error: "Nombre o descripción no válidos" });
    const id = randomUUID().slice(0, 8);
    let directory = path.join(PROJECTS, slug(name) + "-" + id);
    const existingInput = typeof input.directory === "string" ? input.directory.trim() : "";
    let existingSafe: string | null = null;
    let checkpoint = false;
    if (existingInput) {
      existingSafe = safeProjectPath(existingInput);
      if (!existingSafe) return reply(res, 400, { error: "Directorio no valido o fuera de projects/" });
      directory = existingSafe;
      checkpoint = true;
    } else {
      fs.mkdirSync(directory, { recursive: true });
    }
    const now = stamp(); const j: Job = { id, name, request, status: "queued", phase: checkpoint ? "En cola (modificacion)" : "En cola", createdAt: now, updatedAt: now, directory, logs: [] };
    if (checkpoint && existingSafe) {
      try { fs.cpSync(existingSafe, path.join(PROJECTS, `${slug(name)}-${id}-checkpoint`), { recursive: true, errorOnExist: false, force: true }); }
      catch { }
      log(j, `Modificacion de proyecto existente. Checkpoint creado en ${path.basename(existingSafe)}-${id}-checkpoint.`);
    }
    jobs.push(j); save(); setImmediate(worker); return reply(res, 201, { id });
  }
  const match = u.pathname.match(/^\/api\/jobs\/([a-f0-9]{8})\/cancel$/);
  if (match && req.method === "POST") {
    const j = jobs.find(x => x.id === match[1]);
    if (!j) return reply(res, 404, { error: "No encontrado" });
    if (!["queued", "running"].includes(j.status)) return reply(res, 409, { error: "Solo se pueden cancelar trabajos en cola o ejecución" });
    const wasQueued = j.status === "queued";
    j.status = "cancelled"; j.phase = "Cancelado"; save();
    jobProcesses.cancel(j.id);
    if (wasQueued) await jobProcesses.finish(j.id);
    return reply(res, 200, { ok: true });
  }
  const retryMatch = u.pathname.match(/^\/api\/jobs\/([a-f0-9]{8})\/retry$/);
  if (retryMatch && req.method === "POST") {
    const j = jobs.find(x => x.id === retryMatch[1]);
    if (!j) return reply(res, 404, { error: "No encontrado" });
    if (!["failed", "cancelled"].includes(j.status)) return reply(res, 409, { error: "Solo se pueden reintentar trabajos fallidos o cancelados" });
    if (jobProcesses.isActive(j.id)) return reply(res, 409, { error: "El trabajo anterior todavía está terminando" });
    j.status = "queued"; j.phase = "En cola (reintento)"; j.lastError = undefined;
    log(j, "Reintento solicitado por el usuario.");
    setImmediate(worker);
    return reply(res, 200, { ok: true });
  }
  const deleteMatch = u.pathname.match(/^\/api\/jobs\/([a-f0-9]{8})$/);
  if (deleteMatch && req.method === "DELETE") {
    const index = jobs.findIndex(x => x.id === deleteMatch[1]);
    if (index === -1) return reply(res, 404, { error: "No encontrado" });
    if (["queued", "running"].includes(jobs[index].status)) return reply(res, 409, { error: "Cancela el trabajo antes de borrarlo" });
    jobs.splice(index, 1); save();
    return reply(res, 200, { ok: true });
  }
  if (await handlePreview(req, res, u)) return;
  if (await handleZip(req, res, u)) return;
  return reply(res, 404, { error: "Ruta no encontrada" });
});
// Recover reasons for jobs that failed before lastError existed (must run after the error helpers are defined).
for (const j of jobs) {
  if (j.lastError || !["failed", "cancelled"].includes(j.status)) continue;
  const reason = reasonFromLogs(j);
  // Cancelled jobs only surface a reason when a real provider/tool failure is in the log.
  if (reason && (j.status === "failed" || !/permisos de herramientas/.test(reason))) j.lastError = reason;
}
save();
server.listen(4177, "127.0.0.1", () => { console.log("Taridev API: http://127.0.0.1:4177"); worker(); });
