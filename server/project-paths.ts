import fs from "node:fs";
import path from "node:path";

export type ProjectPathFailure =
  | "invalid-name"
  | "not-found"
  | "not-directory"
  | "symlink"
  | "outside";

export type ProjectPathResult =
  | { ok: true; name: string; directory: string }
  | { ok: false; reason: ProjectPathFailure };

const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_WINDOWS_CHAR = /[<>:"|?*\u0000-\u001f]/;

/**
 * Accepts only a direct project folder name, or the documented
 * `projects/<name>` form. Absolute paths, traversal, separators, Windows
 * reserved device names and characters Windows cannot store are rejected
 * instead of being silently rebased with `path.basename`.
 */
export function parseProjectName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (!input || input.includes("\0")) return null;

  const normalized = input.replace(/\\/g, "/");
  // The documented `projects/<name>` form may be surrounded by whitespace;
  // a bare directory name is taken verbatim so "name " is rejected instead of
  // being silently trimmed into a different folder.
  const documented = normalized.match(/^\s*projects\s*\/\s*(.*)$/i);
  const segment = documented ? documented[1].trim() : input;
  const parts = segment.split("/");
  if (parts.length !== 1) return null;

  const name = parts[0];
  if (!name || name === "." || name === "..") return null;
  if (name.toLowerCase() === "projects") return null;
  if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return null;
  if (INVALID_WINDOWS_CHAR.test(name)) return null;
  // Windows silently removes trailing dots and spaces, which would make the
  // validated name differ from the directory that is actually opened.
  if (/[. ]$/.test(name)) return null;
  if (RESERVED_WINDOWS_NAME.test(name)) return null;
  if (Buffer.byteLength(name, "utf8") > 255) return null;
  return name;
}

/**
 * Resolves a project folder to its canonical path.
 *
 * The folder must be a direct child of the canonical projects root, must be a
 * real directory (junctions and symlinks are rejected, even when they point
 * inside) and must still be inside the root after `realpath`.
 */
export function resolveProjectDirectory(projectsRoot: string, input: unknown): ProjectPathResult {
  const name = parseProjectName(input);
  if (!name) return { ok: false, reason: "invalid-name" };

  let root: string;
  try { root = fs.realpathSync(projectsRoot); }
  catch { return { ok: false, reason: "not-found" }; }

  const candidate = path.join(root, name);
  let stats: fs.Stats;
  try { stats = fs.lstatSync(candidate); }
  catch { return { ok: false, reason: "not-found" }; }

  if (stats.isSymbolicLink()) return { ok: false, reason: "symlink" };
  if (!stats.isDirectory()) return { ok: false, reason: "not-directory" };

  let real: string;
  try { real = fs.realpathSync(candidate); }
  catch { return { ok: false, reason: "not-found" }; }

  const relative = path.relative(root, real);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { ok: false, reason: "outside" };
  }
  if (relative.includes(path.sep)) return { ok: false, reason: "outside" };
  // Windows is case-insensitive, so the canonical casing may differ from the
  // requested one. The comparison still proves it is the same direct child.
  const sameName = process.platform === "win32"
    ? relative.toLowerCase() === name.toLowerCase()
    : relative === name;
  if (!sameName) return { ok: false, reason: "outside" };

  return { ok: true, name: path.basename(real), directory: real };
}

/**
 * Legacy checkpoints were copied into `projects/<name>-<id>-checkpoint` and
 * therefore appeared as ordinary projects. They are still readable for recovery,
 * but must never be offered as selectable projects.
 */
export function isLegacyCheckpointName(name: unknown): boolean {
  return typeof name === "string" && name.trim() !== "" && /-checkpoint$/i.test(name.trim());
}
