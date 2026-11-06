export type ProjectLike = { name: string; path?: string; hasPackage?: boolean; hasIndex?: boolean };

export type ModificationJob = {
  id: string;
  name?: string;
  request?: string;
  action?: string;
  status?: string;
  phase?: string;
  createdAt?: string;
  updatedAt?: string;
  directory?: string;
  logs?: string[];
};

export type ProjectGroup = {
  project: ProjectLike;
  modifications: ModificationJob[];
};

const STATUS_LABELS: Record<string, string> = {
  queued: "En cola",
  running: "En curso",
  done: "Completado",
  validated: "Validado",
  failed: "Con error",
  needs_intervention: "Requiere intervención",
};

export function projectNameFromDirectory(directory: unknown): string {
  if (typeof directory !== "string") return "";
  const trimmed = directory.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

export function isModificationJob(job: unknown): job is ModificationJob {
  return !!job && typeof job === "object" && (job as { action?: unknown }).action === "modify";
}

export function statusLabel(status: unknown): string {
  const key = String(status ?? "");
  return STATUS_LABELS[key] ?? key;
}

export function formatModificationDate(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export function buildProjectGroups(projects: ProjectLike[] = [], jobs: ModificationJob[] = []): ProjectGroup[] {
  const groups: ProjectGroup[] = (projects || []).map(project => ({ project, modifications: [] }));
  const byName = new Map(groups.map(group => [group.project.name, group]));
  for (const job of jobs || []) {
    if (!isModificationJob(job)) continue;
    const name = projectNameFromDirectory(job.directory);
    const group = byName.get(name);
    if (!group) continue;
    group.modifications.push(job);
  }
  for (const group of groups) {
    group.modifications.sort((left, right) =>
      String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? "")),
    );
  }
  return groups;
}