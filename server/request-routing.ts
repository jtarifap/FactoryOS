export type RequestKind = "project" | "question";

export type RequestRoute =
  | { kind: "project"; action: "new" | "modify" }
  | { kind: "question" };

/** Routes by explicit request type; a selected existing directory always means modification. */
export function routeRequest(kind: unknown, directory: unknown): RequestRoute | null {
  if (kind !== "project" && kind !== "question") return null;

  if (typeof directory === "string" && directory.trim()) {
    return { kind: "project", action: "modify" };
  }

  return kind === "question"
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
