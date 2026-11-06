export type RequestKind = "project" | "question";
export type JobAction = "new" | "modify" | "question";

export type RequestRoute =
  | { kind: "project"; action: "new" | "modify" }
  | { kind: "question"; action?: "question" };

type RouteInput = {
  kind?: unknown;
  requestKind?: unknown;
  directory?: unknown;
  action?: unknown;
};

function explicitAction(value: unknown): JobAction | null {
  return value === "new" || value === "modify" || value === "question" ? value : null;
}

/**
 * Resolves the persisted action for a job.
 *
 * Jobs created before the action field existed fall back to a safe value:
 * consultations stay consultations, a stored checkpoint proves a modification,
 * and any other project job is treated as a creation. The directory is
 * deliberately ignored so a creation with an assigned directory can never
 * become a modification by accident.
 */
export function resolveJobAction(job: { action?: unknown; requestKind?: unknown; checkpoint?: unknown }): JobAction {
  const persisted = explicitAction(job.action);
  if (persisted) return persisted;
  // A stored checkpoint is explicit evidence of a legacy modification.
  if (typeof job.checkpoint === "string" && job.checkpoint.trim()) return "modify";
  return job.requestKind === "question" ? "question" : "new";
}

/**
 * Routes a request using an explicit action when it is available.
 *
 * The legacy two-argument form is still accepted for stored jobs and older
 * clients: a project with a directory means modification. New callers must pass
 * the action explicitly so a creation with an assigned directory stays a
 * creation.
 */
export function routeRequest(
  kindOrInput: unknown,
  directory?: unknown,
  action?: unknown
): RequestRoute | null {
  const input: RouteInput = typeof kindOrInput === "object" && kindOrInput !== null
    ? kindOrInput as RouteInput
    : { kind: kindOrInput, directory, action };

  const rawKind = input.kind ?? input.requestKind;
  const rawDirectory = input.directory;
  const requestedAction = explicitAction(input.action);

  if (input.action !== undefined && requestedAction === null) return null;

  // A standalone "new" or "modify" is unambiguously an action. "question" is
  // still accepted as a legacy request kind when no explicit action is given.
  const standaloneAction = rawKind === "new" || rawKind === "modify" ? rawKind : null;
  const resolvedAction = requestedAction ?? standaloneAction;

  if (resolvedAction) {
    return resolvedAction === "question"
      ? { kind: "question", action: "question" }
      : { kind: "project", action: resolvedAction };
  }

  if (rawKind !== "project" && rawKind !== "question") return null;

  if (typeof rawDirectory === "string" && rawDirectory.trim()) {
    return { kind: "project", action: "modify" };
  }

  return rawKind === "question"
    ? { kind: "question" }
    : { kind: "project", action: "new" };
}

export function extractOpenCodeText(output: string): string {
  const parts: string[] = [];
  let sawJsonEvent = false;
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      sawJsonEvent = true;
      if (event.type === "text" && typeof event.part?.text === "string") parts.push(event.part.text);
    } catch {
      // Non-JSON output is handled by the plain-text fallback below.
    }
  }
  const text = parts.join("").trim();
  if (text || sawJsonEvent) return text;
  return output.replace(/\u001b\[[0-9;]*m/g, "").trim();
}
