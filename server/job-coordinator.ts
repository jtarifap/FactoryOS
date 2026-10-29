import type { ChildProcess } from "node:child_process";

export class WorkerLease {
  private held = false;

  tryAcquire(): (() => void) | null {
    if (this.held) return null;
    this.held = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held = false;
    };
  }
}

type JobProcesses = { children: Set<ChildProcess>; cancelled: boolean; finished: boolean; waiters: Set<() => void> };

export class JobProcessRegistry {
  private readonly jobs = new Map<string, JobProcesses>();

  constructor(private readonly terminate: (child: ChildProcess) => void) {}

  private get(jobId: string): JobProcesses {
    let job = this.jobs.get(jobId);
    if (!job) {
      job = { children: new Set(), cancelled: false, finished: false, waiters: new Set() };
      this.jobs.set(jobId, job);
    }
    return job;
  }

  add(jobId: string, child: ChildProcess): void {
    const job = this.get(jobId);
    job.children.add(child);
    child.once("close", () => this.remove(jobId, child));
    if (job.cancelled || job.finished) this.terminate(child);
  }

  remove(jobId: string, child: ChildProcess): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.children.delete(child);
    if (job.finished && job.children.size === 0) {
      this.jobs.delete(jobId);
      for (const resolve of job.waiters) resolve();
      job.waiters.clear();
    }
  }

  cancel(jobId: string): void {
    const job = this.get(jobId);
    if (job.cancelled || job.finished) return;
    job.cancelled = true;
    for (const child of job.children) this.terminate(child);
  }

  isCancelled(jobId: string): boolean {
    return this.jobs.get(jobId)?.cancelled ?? false;
  }

  isActive(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  finish(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve();
    job.finished = true;
    if (job.children.size === 0) {
      this.jobs.delete(jobId);
      return Promise.resolve();
    }
    return new Promise(resolve => job.waiters.add(resolve));
  }
}

export function terminateChildTree(
  child: ChildProcess,
  platform: string,
  spawnTaskkill: (command: string, args: string[]) => ChildProcess
): void {
  if (!child.pid || platform !== "win32") {
    try { child.kill(); } catch {}
    return;
  }

  let parentKillSent = false;
  const killParent = () => {
    if (parentKillSent) return;
    parentKillSent = true;
    try { child.kill(); } catch {}
  };
  try {
    const killer = spawnTaskkill("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    // Let taskkill discover and terminate descendants before signalling the parent handle directly.
    killer.once("close", killParent);
    killer.once("error", killParent);
  } catch {
    killParent();
  }
}
