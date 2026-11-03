export type TokenUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
};

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

const safeNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  const input = left.input + right.input;
  const output = left.output + right.output;
  const reasoning = left.reasoning + right.reasoning;
  const cacheRead = left.cacheRead + right.cacheRead;
  const cacheWrite = left.cacheWrite + right.cacheWrite;
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    cost: left.cost + right.cost,
  };
}

type TokenPayload = {
  input?: unknown;
  output?: unknown;
  reasoning?: unknown;
  cache?: { read?: unknown; write?: unknown };
};

/** Builds a normalized usage record from an OpenCode `tokens` object. */
export function tokenUsageFromPayload(payload: unknown, cost = 0): TokenUsage {
  if (!payload || typeof payload !== "object") return emptyTokenUsage();
  const tokens = payload as TokenPayload;
  const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
  const input = safeNumber(tokens.input);
  const output = safeNumber(tokens.output);
  const reasoning = safeNumber(tokens.reasoning);
  const cacheRead = safeNumber(cache.read);
  const cacheWrite = safeNumber(cache.write);
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    cost: safeNumber(cost),
  };
}

/**
 * Sums every `step_finish` event in OpenCode `--format json` output.
 * This is the fallback when the job database cannot be read (for example,
 * because a session is still being flushed).
 */
export function parseTokenUsage(output: string): TokenUsage {
  let usage = emptyTokenUsage();
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event?.type !== "step_finish" || !event.part || typeof event.part !== "object") continue;
      const cost = safeNumber(event.part.cost) || safeNumber(event.cost);
      usage = addTokenUsage(usage, tokenUsageFromPayload(event.part.tokens, cost));
    } catch {
      // Non-JSON lines are stderr or progress output; they carry no token data.
    }
  }
  return usage;
}

export function formatTokenCount(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatCost(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  const digits = safe > 0 && safe < 0.01 ? 4 : 2;
  return `$${safe.toFixed(digits).replace(".", ",")}`;
}

/** Compact, human-readable summary used in job logs and the UI. */
export function formatTokenUsage(usage: TokenUsage): string {
  const parts = [
    `${formatTokenCount(usage.total)} tokens`,
    `entrada ${formatTokenCount(usage.input)}`,
    `salida ${formatTokenCount(usage.output)}`,
  ];
  if (usage.reasoning > 0) parts.push(`razonamiento ${formatTokenCount(usage.reasoning)}`);
  if (usage.cacheRead > 0) parts.push(`caché L ${formatTokenCount(usage.cacheRead)}`);
  if (usage.cacheWrite > 0) parts.push(`caché E ${formatTokenCount(usage.cacheWrite)}`);
  parts.push(formatCost(usage.cost));
  return parts.join(" · ");
}

export function formatTokenUsageShort(usage: TokenUsage): string {
  return `${formatTokenCount(usage.total)} tokens · ${formatCost(usage.cost)}`;
}

/** Markdown snapshot written to `factory/consumo-tokens.md` after a project run. */
export function tokenUsageMarkdown(usage: TokenUsage): string {
  return [
    "# Consumo de tokens",
    "",
    "Generado por FactoryOS a partir de las sesiones de OpenCode del trabajo,",
    "incluidos los subagentes que hayan intervenido.",
    "",
    "| Concepto | Tokens |",
    "| --- | ---: |",
    `| Entrada | ${formatTokenCount(usage.input)} |`,
    `| Salida | ${formatTokenCount(usage.output)} |`,
    `| Razonamiento | ${formatTokenCount(usage.reasoning)} |`,
    `| Caché de lectura | ${formatTokenCount(usage.cacheRead)} |`,
    `| Caché de escritura | ${formatTokenCount(usage.cacheWrite)} |`,
    `| **Total** | **${formatTokenCount(usage.total)}** |`,
    "",
    `Coste estimado: **${formatCost(usage.cost)}**`,
    "",
  ].join("\n");
}
