import fs from "node:fs";
import path from "node:path";

const REQUIRED_SECTIONS = [
  "## Funcionalidades",
  "## Dependencias",
  "## Variables de entorno",
  "## Instalación y ejecución",
  "## Problemas conocidos y limitaciones",
] as const;

export function validateDeliveryReport(content: string): { ok: boolean; missing: string[] } {
  const lines = content.split(/\r?\n/);
  const missing: string[] = [];
  for (const required of REQUIRED_SECTIONS) {
    const target = required.toLocaleLowerCase();
    const index = lines.findIndex(line => line.trim().toLocaleLowerCase() === target);
    if (index < 0) {
      missing.push(required);
      continue;
    }
    let end = index + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end].trim())) end++;
    if (!lines.slice(index + 1, end).some(line => line.trim())) missing.push(required);
  }
  return { ok: missing.length === 0, missing };
}

export type DeliveryReportState = { mtimeNs: bigint; size: bigint; ino: bigint };

export function captureDeliveryReportState(directory: string): DeliveryReportState | null {
  try {
    const stat = fs.statSync(path.join(directory, "DELIVERY_REPORT.md"), { bigint: true });
    if (!stat.isFile() || stat.size === 0n) return null;
    return { mtimeNs: stat.mtimeNs, size: stat.size, ino: stat.ino };
  } catch {
    return null;
  }
}

export function wasDeliveryReportUpdatedSince(
  directory: string,
  phaseStartedAtNs: bigint,
  before: DeliveryReportState | null
): boolean {
  const after = captureDeliveryReportState(directory);
  if (!after || after.mtimeNs <= phaseStartedAtNs) return false;
  if (!before) return true;
  return after.mtimeNs !== before.mtimeNs || after.size !== before.size || after.ino !== before.ino;
}

export function validateDeliveryCompletion(
  agentOk: boolean,
  reportFresh: boolean,
  content: string
): { ok: boolean; error?: string } {
  if (!agentOk) return { ok: false, error: "Delivery Manager terminó con error." };
  if (!reportFresh) return { ok: false, error: "DELIVERY_REPORT.md no se generó o actualizó durante esta fase." };
  const report = validateDeliveryReport(content);
  if (!report.ok) return { ok: false, error: `DELIVERY_REPORT.md incompleto. Faltan apartados: ${report.missing.join(", ")}` };
  return { ok: true };
}
