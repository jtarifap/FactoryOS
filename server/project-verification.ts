import fs from "node:fs";
import path from "node:path";

export type VerificationScript = "build" | "test";
export type ProjectVerification = {
  kind: "static" | "package" | "invalid";
  scripts: VerificationScript[];
  error?: string;
};
export type ScriptResult = { ok: boolean; output: string };
export type VerificationCommand = "npm install" | "npm run build" | "npm test";
export type VerificationCheck = { command: VerificationCommand; ok: boolean };

export function getProjectVerification(directory: string): ProjectVerification {
  const packagePath = path.join(directory, "package.json");
  if (fs.existsSync(packagePath)) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    } catch {
      return { kind: "invalid", scripts: [], error: "package.json no es JSON válido." };
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return { kind: "invalid", scripts: [], error: "package.json debe contener un objeto JSON." };
    }
    const configured = (manifest as { scripts?: unknown }).scripts;
    const scripts = (["build", "test"] as const).filter(script =>
      !!configured && typeof configured === "object" &&
      typeof (configured as Record<string, unknown>)[script] === "string" &&
      !!(configured as Record<string, string>)[script].trim()
    );
    if (!scripts.length) {
      return { kind: "invalid", scripts: [], error: "package.json debe definir al menos un script build o test para verificar el proyecto." };
    }
    return { kind: "package", scripts };
  }

  try {
    if (fs.lstatSync(path.join(directory, "index.html")).isFile()) return { kind: "static", scripts: [] };
  } catch {}
  return { kind: "invalid", scripts: [], error: "No se encontró package.json ni index.html en el proyecto." };
}

export async function runProjectChecks(
  directory: string,
  scripts: VerificationScript[],
  run: (directory: string, script: VerificationScript) => Promise<ScriptResult>
): Promise<{ ok: boolean; summary: string; output: string; checks: VerificationCheck[] }> {
  const ordered = (["build", "test"] as const).filter(script => scripts.includes(script));
  if (!ordered.length) return { ok: false, summary: "No hay scripts build/test que ejecutar.", output: "", checks: [] };

  const checks: VerificationCheck[] = [];
  for (const script of ordered) {
    let result: ScriptResult;
    try {
      result = await run(directory, script);
    } catch (error) {
      result = { ok: false, output: String(error) };
    }
    checks.push({ command: script === "build" ? "npm run build" : "npm test", ok: result.ok });
    if (!result.ok) {
      return { ok: false, summary: formatChecks(checks), output: result.output.slice(-3000), checks };
    }
  }
  return { ok: true, summary: formatChecks(checks), output: "", checks };
}

function formatChecks(checks: VerificationCheck[]): string {
  return checks.map(check => `${check.command}: ${check.ok ? "OK" : "FAIL"}`).join("\n");
}

export function appendVerificationEvidence(directory: string, checks: VerificationCheck[], ok: boolean): void {
  const reportPath = path.join(directory, "QA_REPORT.md");
  const allowedCommands = new Set<VerificationCommand>(["npm install", "npm run build", "npm test"]);
  const commands = checks
    .filter(check => allowedCommands.has(check.command) && typeof check.ok === "boolean")
    .map(check => `${check.command}: ${check.ok ? "OK" : "FAIL"}`);
  const evidence = [
    "## Verificación técnica automatizada",
    "",
    `Estado: ${ok ? "PASS" : "FAIL"}`,
    ...(commands.length ? commands : ["No se ejecutaron comandos de verificación."]),
    "",
  ].join("\n");
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  fs.appendFileSync(reportPath, `${existing && !existing.endsWith("\n") ? "\n" : ""}${evidence}`, "utf8");
}
