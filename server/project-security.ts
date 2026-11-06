import fs from "node:fs";
import path from "node:path";

export type ProjectScanLimits = { maxEntries: number; maxFileBytes: number; maxTotalBytes: number };
const DEFAULT_LIMITS: ProjectScanLimits = { maxEntries: 20_000, maxFileBytes: 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 };
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", ".cache"]);

const HIGH_CONFIDENCE_SECRET_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\baws_secret_access_key\b\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s/]+@/gi,
];

const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|apikey|secret(?:[_-]?key)?|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{20,})/gi;

const PLACEHOLDER_SECRET = [
  /^x{4,}$/i,
  /^\*{4,}$/,
  /^\.{3,}$/,
  /^changeme/i,
  /^change[_-]?me/i,
  /^example/i,
  /^sample/i,
  /^dummy/i,
  /^fake/i,
  /^test/i,
  /^placeholder/i,
  /^your[_-]/i,
  /redacted/i,
  /^none$/i,
  /^null$/i,
  /^undefined$/i,
  /^(?:process\.env|import\.meta\.env|os\.environ)/i,
];

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_SECRET.some(pattern => pattern.test(value));
}

/** Returns true when the text contains a credential pattern. Never returns the value. */
export function containsSecret(content: string): boolean {
  for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) return true;
  }
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECRET_ASSIGNMENT_PATTERN.exec(content)) !== null) {
    if (!isPlaceholderSecret(match[2])) return true;
  }
  return false;
}

/** Replaces credential values before they reach logs, API responses or reports. */
export function redactSecrets(text: string): string {
  let output = String(text ?? "");
  for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) {
    output = output.replace(new RegExp(pattern.source, pattern.flags), "[REDACTADO]");
  }
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  return output.replace(SECRET_ASSIGNMENT_PATTERN, (match, _name: string, value: string) => {
    if (isPlaceholderSecret(value)) return match;
    return `${match.slice(0, match.length - value.length)}[REDACTADO]`;
  });
}

export class ProjectScanLimitError extends Error {
  constructor() {
    super("La inspección de seguridad superó sus límites; no se creó el ZIP.");
    this.name = "ProjectScanLimitError";
  }
}

export function isSensitiveRelativePath(relative: string): boolean {
  const parts = relative.replace(/\\/g, "/").split("/").filter(Boolean).map(part => part.toLowerCase());
  if (parts.some(part => EXCLUDED_DIRECTORIES.has(part))) return true;
  const name = parts.at(-1) || "";
  if (name.startsWith(".env")) return !/\.(?:example|sample|template|dist)$/i.test(name);
  if (/^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)$/.test(name)) return true;
  if (/^(?:credentials?|secrets?)(?:[._-].*)?$/.test(name)) return true;
  if (/^(?:\.npmrc|\.netrc|\.pypirc|\.git-credentials)$/.test(name)) return true;
  if (/^terraform\.tfstate(?:\.backup)?$/.test(name)) return true;
  if (parts.includes(".docker") && name === "config.json") return true;
  if (/service-account.*\.json$/.test(name)) return true;
  if (/\.(?:key|p12|pfx|keystore|jks)$/.test(name)) return true;
  // A bare certificate is public; private material is still caught by the
  // content fingerprint and by names such as private.pem / server.pem.
  if (/\.pem$/.test(name) && !/^(?:cert|certs?|ca|chain|public)/i.test(name)) return true;
  return false;
}

export function findSecretCandidates(projectRoot: string, overrides: Partial<ProjectScanLimits> = {}): string[] {
  return scanProjectFiles(projectRoot, null, overrides);
}

export function createScannedSnapshot(
  projectRoot: string,
  snapshotRoot: string,
  overrides: Partial<ProjectScanLimits> = {}
): string[] {
  fs.mkdirSync(snapshotRoot, { recursive: true });
  try {
    return scanProjectFiles(projectRoot, snapshotRoot, overrides);
  } catch (error) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

function readBoundedFile(filePath: string, maxBytes: number): Buffer {
  let fd: number;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  } catch {
    throw new ProjectScanError();
  }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes) throw new ProjectScanLimitError();
    const chunks: Buffer[] = [];
    let total = 0;
    const scratch = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1));
    while (true) {
      const remainingPlusOne = maxBytes - total + 1;
      const bytesRead = fs.readSync(fd, scratch, 0, Math.min(scratch.length, remainingPlusOne), null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new ProjectScanLimitError();
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    const after = fs.fstatSync(fd);
    if (after.size > maxBytes || after.size !== total) throw new ProjectScanLimitError();
    return Buffer.concat(chunks, total);
  } finally {
    fs.closeSync(fd);
  }
}

function scanProjectFiles(projectRoot: string, snapshotRoot: string | null, overrides: Partial<ProjectScanLimits>): string[] {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const root = fs.realpathSync(projectRoot);
  const candidates = new Set<string>();
  let entriesSeen = 0;
  let bytesScanned = 0;

  const visit = (directory: string, prefix: string) => {
    const dir = fs.opendirSync(directory);
    try {
      while (true) {
        const entry = dir.readSync();
        if (!entry) break;
        if (++entriesSeen > limits.maxEntries) throw new ProjectScanLimitError();
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const lowerName = entry.name.toLowerCase();
        const fullPath = path.join(directory, entry.name);
        const snapshotPath = snapshotRoot ? path.join(snapshotRoot, ...relative.split("/")) : null;

        if (entry.isDirectory()) {
          // Exact-case paths are excluded by tar too. Case variants are candidates, not skipped.
          if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
          if (isSensitiveRelativePath(relative)) { candidates.add(relative); continue; }
          let realDirectory: string;
          try { realDirectory = fs.realpathSync(fullPath); }
          catch { throw new ProjectScanError(); }
          if (!isInside(root, realDirectory)) { candidates.add(relative); continue; }
          if (snapshotPath) fs.mkdirSync(snapshotPath, { recursive: true });
          visit(realDirectory, relative);
          continue;
        }

        if (entry.isSymbolicLink()) { candidates.add(relative); continue; }
        if (!entry.isFile()) continue;
        if (isSensitiveRelativePath(relative)) { candidates.add(relative); continue; }
        // Lower-case logs are excluded from the resulting archive; case variants are scanned.
        if (entry.name.endsWith(".log")) continue;

        let realFile: string;
        try { realFile = fs.realpathSync(fullPath); }
        catch { throw new ProjectScanError(); }
        if (!isInside(root, realFile)) { candidates.add(relative); continue; }
        const remainingBytes = limits.maxTotalBytes - bytesScanned;
        if (remainingBytes < 0) throw new ProjectScanLimitError();
        const data = readBoundedFile(realFile, Math.min(limits.maxFileBytes, remainingBytes));
        bytesScanned += data.length;
        if (data.includes(0)) {
          if (snapshotPath) {
            fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
            fs.writeFileSync(snapshotPath, data);
          }
          continue;
        }
        const content = data.toString("utf8");
        if (containsSecret(content)) {
          candidates.add(relative);
          continue;
        }
        if (snapshotPath) {
          fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
          fs.writeFileSync(snapshotPath, data);
        }
      }
    } finally {
      try { dir.closeSync(); } catch {}
    }
  };

  visit(root, "");
  return [...candidates].sort();
}

export class ProjectScanError extends Error {
  constructor() {
    super("No se pudo completar la inspección de seguridad; no se creó el ZIP.");
    this.name = "ProjectScanError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveProjectFile(
  projectRoot: string,
  encodedRelativePath: string
): { absolutePath: string; relativePath: string } | null {
  let decoded: string;
  try { decoded = decodeURIComponent(encodedRelativePath); }
  catch { return null; }
  if (!decoded || decoded.includes("\0") || decoded.includes("\\")) return null;
  if (decoded.split("/").some(part => part === "." || part === "..")) return null;

  try {
    const root = fs.realpathSync(projectRoot);
    const candidate = path.resolve(root, decoded);
    if (!isInside(root, candidate)) return null;
    const requestedRelative = path.relative(root, candidate);
    if (isSensitiveRelativePath(requestedRelative)) return null;
    let realFile = fs.realpathSync(candidate);
    if (!isInside(root, realFile)) return null;
    if (fs.statSync(realFile).isDirectory()) realFile = fs.realpathSync(path.join(realFile, "index.html"));
    if (!isInside(root, realFile)) return null;
    const realRelativePath = path.relative(root, realFile);
    if (isSensitiveRelativePath(realRelativePath) || !fs.statSync(realFile).isFile()) return null;
    return { absolutePath: realFile, relativePath: realRelativePath };
  } catch {
    return null;
  }
}

/**
 * Resolves and reads a static project file through a single descriptor.
 *
 * The descriptor pins the opened file even if the path is replaced after
 * validation. `O_NOFOLLOW` is used where the platform provides it; Windows
 * leaves it undefined, so containment is still enforced by `resolveProjectFile`
 * before the open.
 */
export function readProjectFile(
  projectRoot: string,
  encodedRelativePath: string,
  maxBytes = 20 * 1024 * 1024
): { data: Buffer; relativePath: string } | null {
  const resolved = resolveProjectFile(projectRoot, encodedRelativePath);
  if (!resolved) return null;

  let fd: number | null = null;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(resolved.absolutePath, flags);
    const stats = fs.fstatSync(fd);
    if (!stats.isFile() || stats.size > maxBytes) return null;
    const data = fs.readFileSync(fd);
    if (data.length > maxBytes) return null;
    // Previews must not become a side channel for a credential that lives in
    // an otherwise ordinary file (for example a database URL in notes.txt).
    if (!data.includes(0) && containsSecret(data.toString("utf8"))) return null;
    return { data, relativePath: resolved.relativePath };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}
