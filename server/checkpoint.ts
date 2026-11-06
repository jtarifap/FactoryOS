import fs from "node:fs";
import path from "node:path";

export type CheckpointOptions = {
  /** Optional dependency hook used by tests to simulate filesystem failures. */
  fileSystem?: Pick<typeof fs, "existsSync" | "statSync" | "mkdirSync" | "cpSync" | "rmSync" | "readdirSync" | "readFileSync" | "readlinkSync">;
};

function assertDirectory(directory: string, label: string, fileSystem: CheckpointOptions["fileSystem"]): void {
  const io = fileSystem ?? fs;
  if (!io.existsSync(directory)) {
    throw new Error(`${label} no existe: ${directory}`);
  }
  if (!io.statSync(directory).isDirectory()) {
    throw new Error(`${label} no es un directorio: ${directory}`);
  }
}

function relativeEntries(root: string, fileSystem: CheckpointOptions["fileSystem"]): string[] {
  const io = fileSystem ?? fs;
  const entries: string[] = [];

  const walk = (directory: string, prefix: string) => {
    const children = io.readdirSync(directory, { withFileTypes: true });
    for (const child of children) {
      const relative = prefix ? path.join(prefix, child.name) : child.name;
      entries.push(relative);
      if (child.isDirectory()) walk(path.join(directory, child.name), relative);
    }
  };

  walk(root, "");
  return entries.sort();
}

/**
 * Verifies that the checkpoint contains exactly the same tree and file contents
 * as the source project. A partially copied or corrupted checkpoint is rejected.
 */
export function verifyCheckpoint(
  sourceDirectory: string,
  checkpointDirectory: string,
  options: CheckpointOptions = {}
): void {
  const io = options.fileSystem ?? fs;
  assertDirectory(sourceDirectory, "El proyecto de origen", io);
  assertDirectory(checkpointDirectory, "El checkpoint", io);

  const sourceEntries = relativeEntries(sourceDirectory, io);
  const checkpointEntries = relativeEntries(checkpointDirectory, io);

  if (sourceEntries.length !== checkpointEntries.length) {
    throw new Error("El checkpoint está incompleto: faltan o sobran entradas respecto al proyecto original.");
  }

  for (let index = 0; index < sourceEntries.length; index++) {
    const relative = sourceEntries[index];
    if (relative !== checkpointEntries[index]) {
      throw new Error(`El checkpoint está incompleto: falta la entrada ${relative}.`);
    }

    const sourcePath = path.join(sourceDirectory, relative);
    const checkpointPath = path.join(checkpointDirectory, relative);
    const sourceStat = io.statSync(sourcePath);
    const checkpointStat = io.statSync(checkpointPath);

    if (sourceStat.isDirectory() !== checkpointStat.isDirectory()) {
      throw new Error(`El checkpoint no coincide en ${relative}: tipo de entrada distinto.`);
    }

    if (sourceStat.isDirectory()) continue;

    if (sourceStat.isSymbolicLink() || checkpointStat.isSymbolicLink()) {
      if (!sourceStat.isSymbolicLink() || !checkpointStat.isSymbolicLink()) {
        throw new Error(`El checkpoint no coincide en ${relative}: enlace simbólico distinto.`);
      }
      if (io.readlinkSync(sourcePath) !== io.readlinkSync(checkpointPath)) {
        throw new Error(`El checkpoint no coincide en ${relative}: enlace simbólico distinto.`);
      }
      continue;
    }

    if (!sourceStat.isFile()) {
      throw new Error(`El checkpoint no puede verificar la entrada no regular ${relative}.`);
    }

    const sourceContent = io.readFileSync(sourcePath);
    const checkpointContent = io.readFileSync(checkpointPath);
    if (Buffer.compare(sourceContent, checkpointContent) !== 0) {
      throw new Error(`El contenido del checkpoint difiere en ${relative}.`);
    }
  }
}

/**
 * Creates and verifies a checkpoint. The destination must not exist, so a
 * previous checkpoint can never be silently overwritten. On failure any
 * partially created destination is removed.
 */
export function createCheckpoint(
  sourceDirectory: string,
  checkpointDirectory: string,
  options: CheckpointOptions = {}
): string {
  const io = options.fileSystem ?? fs;
  assertDirectory(sourceDirectory, "El proyecto de origen", io);

  if (io.existsSync(checkpointDirectory)) {
    throw new Error(`El destino del checkpoint ya existe: ${checkpointDirectory}`);
  }

  io.mkdirSync(path.dirname(checkpointDirectory), { recursive: true });
  try {
    io.cpSync(sourceDirectory, checkpointDirectory, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    verifyCheckpoint(sourceDirectory, checkpointDirectory, options);
    return checkpointDirectory;
  } catch (error) {
    if (io.existsSync(checkpointDirectory)) {
      try { io.rmSync(checkpointDirectory, { recursive: true, force: true }); } catch {}
    }
    throw error;
  }
}

export const createProjectCheckpoint = createCheckpoint;
export const verifyProjectCheckpoint = verifyCheckpoint;
export const makeCheckpoint = createCheckpoint;
export const checkpointProject = createCheckpoint;
