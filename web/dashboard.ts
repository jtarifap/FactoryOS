/**
 * Resumen del panel: estadisticas y tabla de trabajos.
 *
 * Los datos vienen de `/api/jobs`. Solo se muestra informacion real: el
 * progreso se representa con la fase del trabajo porque OpenCode no expone
 * un porcentaje.
 */

export type DashboardJob = {
  id: string;
  name: string;
  status: string;
  phase: string;
  updatedAt: string;
  tokens?: { cost?: number } | null;
};

export type DashboardStats = {
  activos: number;
  finalizados: number;
  conError: number;
  costeMes: number;
};

export type DashboardRow = {
  id: string;
  name: string;
  status: string;
  tone: "active" | "ok" | "error" | "idle" | "muted";
  phase: string;
  cost: number;
  updated: string;
};

const STATUS_LABELS: Record<string, { label: string; tone: DashboardRow["tone"] }> = {
  queued: { label: "En cola", tone: "idle" },
  running: { label: "En curso", tone: "active" },
  done: { label: "Completado", tone: "ok" },
  validated: { label: "Validado", tone: "ok" },
  failed: { label: "Con error", tone: "error" },
  needs_intervention: { label: "Requiere intervención", tone: "error" },
  cancelled: { label: "Cancelado", tone: "muted" },
};

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const FINISHED_STATUSES = new Set(["done", "validated"]);
const ERROR_STATUSES = new Set(["failed", "needs_intervention"]);

const costOf = (job: DashboardJob): number => {
  const cost = job.tokens?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : 0;
};

const isSameMonth = (value: Date, now: Date): boolean =>
  value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth();

/** Cuenta los trabajos por estado y suma el coste de IA del mes en curso. */
export function buildDashboardStats(jobs: DashboardJob[], now: Date = new Date()): DashboardStats {
  let activos = 0;
  let finalizados = 0;
  let conError = 0;
  let costeMes = 0;

  for (const job of jobs) {
    if (ACTIVE_STATUSES.has(job.status)) activos++;
    else if (FINISHED_STATUSES.has(job.status)) finalizados++;
    else if (ERROR_STATUSES.has(job.status)) conError++;

    const updated = new Date(job.updatedAt);
    if (!Number.isNaN(updated.getTime()) && isSameMonth(updated, now)) costeMes += costOf(job);
  }

  return { activos, finalizados, conError, costeMes };
}

/** Tiempo transcurrido desde la ultima actualizacion, en texto. */
export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "desconocido";

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return "ahora mismo";
  if (seconds < 60) return "hace un momento";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} d`;

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Prepara las filas de la tabla de trabajos. */
export function buildDashboardRows(jobs: DashboardJob[], now: Date = new Date()): DashboardRow[] {
  return jobs.map(job => {
    const status = STATUS_LABELS[job.status] ?? { label: job.status || "Desconocido", tone: "muted" as const };
    return {
      id: job.id,
      name: job.name || job.id,
      status: status.label,
      tone: status.tone,
      phase: job.phase || "",
      cost: costOf(job),
      updated: formatRelativeTime(job.updatedAt, now),
    };
  });
}
