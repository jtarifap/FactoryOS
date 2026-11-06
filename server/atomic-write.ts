import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type AtomicWriteOptions = {
  encoding?: BufferEncoding;
  mode?: number;
};

export type AtomicWriteDependencies = {
  mkdirSync: typeof fs.mkdirSync;
  openSync: typeof fs.openSync;
  writeSync: typeof fs.writeSync;
  fsyncSync: typeof fs.fsyncSync;
  closeSync: typeof fs.closeSync;
  renameSync: typeof fs.renameSync;
  rmSync: typeof fs.rmSync;
};

/**
 * Writes a file atomically on Node.js and Windows.
 *
 * The data goes to a unique temporary file in the destination directory, is
 * flushed to disk and only then renamed over the destination. If any step
 * fails, the temporary file is removed and the previous destination (if any)
 * remains readable. The destination is never deleted before the replacement
 * is ready.
 */
export function atomicWriteFileSync(
  filePath: string,
  data: string | Buffer,
  options: AtomicWriteOptions | BufferEncoding = {},
  overrides: Partial<AtomicWriteDependencies> = {}
): void {
  const resolvedOptions: AtomicWriteOptions = typeof options === "string" ? { encoding: options } : (options || {});
  // Read fs methods at call time so tests and diagnostics can replace them.
  const dependencies: AtomicWriteDependencies = {
    mkdirSync: fs.mkdirSync,
    openSync: fs.openSync,
    writeSync: fs.writeSync,
    fsyncSync: fs.fsyncSync,
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    rmSync: fs.rmSync,
    ...overrides,
  };
  const directory = path.dirname(filePath);
  dependencies.mkdirSync(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  let descriptor: number | null = null;
  try {
    descriptor = dependencies.openSync(temporaryPath, "w", resolvedOptions.mode ?? 0o666);
    const buffer = typeof data === "string" ? Buffer.from(data, resolvedOptions.encoding || "utf8") : data;
    let offset = 0;
    while (offset < buffer.length) {
      const written = dependencies.writeSync(descriptor, buffer, offset, buffer.length - offset);
      if (written <= 0) throw new Error("No se pudo escribir el archivo temporal completo.");
      offset += written;
    }
    dependencies.fsyncSync(descriptor);
    dependencies.closeSync(descriptor);
    descriptor = null;

    // renameSync replaces an existing file atomically on POSIX and Windows.
    dependencies.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== null) {
      try { dependencies.closeSync(descriptor); } catch {}
    }
    try { dependencies.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

export const atomicWriteFile = atomicWriteFileSync;
export const writeAtomicFileSync = atomicWriteFileSync;
export const writeFileAtomic = atomicWriteFileSync;
export const writeFileAtomicSync = atomicWriteFileSync;
export const writeFileSyncAtomic = atomicWriteFileSync;
export const safeWriteFileSync = atomicWriteFileSync;
export const writeAtomic = atomicWriteFileSync;
export const atomicWrite = atomicWriteFileSync;
export const atomicWriteFileAsync = async (
  filePath: string,
  data: string | Buffer,
  options?: AtomicWriteOptions | BufferEncoding
): Promise<void> => {
  atomicWriteFileSync(filePath, data, options);
};

export function atomicWriteJsonSync(filePath: string, value: unknown, spacing = 2): void {
  atomicWriteFileSync(filePath, JSON.stringify(value, null, spacing), "utf8");
}

export const writeJsonAtomicSync = atomicWriteJsonSync;
export const writeJsonAtomic = atomicWriteJsonSync;
export const atomicWriteJson = atomicWriteJsonSync;
export default atomicWriteFileSync;
