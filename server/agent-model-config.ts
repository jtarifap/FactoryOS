import fs from "node:fs";
import path from "node:path";
import { isModelId } from "./model-list.js";
import { atomicWriteFileSync } from "./atomic-write.js";

export const AGENT_IDS = [
  "factory-manager",
  "developer",
  "qa-reviewer",
  "delivery-manager",
  "disenador",
  "auditoria-seguridad",
] as const;

export type AgentId = typeof AGENT_IDS[number];
export type ModelMode = "common" | "independent";
export type AgentModelMap = Record<AgentId, string>;

export function normalizeAgentModels(
  mode: unknown,
  commonModel: unknown,
  rawModels: unknown
): { mode: ModelMode; commonModel: string; agentModels: AgentModelMap } | null {
  if (mode !== "common" && mode !== "independent") return null;
  if (!isModelId(commonModel)) return null;

  const selectedCommonModel = commonModel.trim();
  const source = typeof rawModels === "object" && rawModels !== null && !Array.isArray(rawModels)
    ? rawModels as Partial<Record<AgentId, unknown>>
    : {};
  const agentModels = {} as AgentModelMap;

  for (const agent of AGENT_IDS) {
    const candidate = mode === "common" ? selectedCommonModel : source[agent] ?? selectedCommonModel;
    if (!isModelId(candidate)) return null;
    agentModels[agent] = candidate.trim();
  }

  return { mode, commonModel: selectedCommonModel, agentModels };
}

export function updateAgentModelFrontmatter(content: string, model: string): string {
  const selected = model.trim();
  if (!isModelId(selected)) {
    throw new Error("ID de modelo no válido");
  }

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") throw new Error("El agente no tiene frontmatter YAML");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("Frontmatter YAML sin cierre");

  const frontmatter = lines.slice(1, end);
  const existing = frontmatter.findIndex(line => /^model\s*:/.test(line));
  if (existing >= 0) {
    frontmatter[existing] = `model: ${selected}`;
  } else {
    const description = frontmatter.findIndex(line => /^description\s*:/.test(line));
    frontmatter.splice(description >= 0 ? description + 1 : frontmatter.length, 0, `model: ${selected}`);
  }

  return ["---", ...frontmatter, "---", ...lines.slice(end + 1)].join(newline);
}

export function syncAgentModelFiles(agentDirectory: string, models: AgentModelMap): AgentId[] {
  const updates = AGENT_IDS.map(agent => {
    const file = path.join(agentDirectory, `${agent}.md`);
    const original = fs.readFileSync(file, "utf8");
    return { agent, file, original, updated: updateAgentModelFrontmatter(original, models[agent]) };
  });

  const changed: AgentId[] = [];
  for (const update of updates) {
    if (update.updated === update.original) continue;
    atomicWriteFileSync(update.file, update.updated, "utf8");
    changed.push(update.agent);
  }
  return changed;
}
