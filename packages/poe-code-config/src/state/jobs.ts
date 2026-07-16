import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  assertPathHasNoSymbolicLinks,
  defaultStateFs,
  isNotFoundError,
  type StateFileSystem
} from "./fs.js";
import { hasOwnErrorCode } from "../errors.js";

export type JobStatus = "pending" | "running" | "exited" | "killed" | "lost";

export interface JobEntry {
  id: string;
  env_id: string;
  env_kind: string;
  tool: string;
  argv: string[];
  cwd: string;
  started_at: string;
  status: JobStatus;
  exit_code?: number;
  exited_at?: string;
  log_file?: string;
  reattach_context?: Record<string, unknown>;
}

export interface JobListFilter {
  env_id?: string;
  env_kind?: string;
  tool?: string;
  status?: JobStatus;
  since?: Date;
  limit?: number;
}

export interface JobRegistry {
  get(id: string): Promise<JobEntry | null>;
  put(entry: JobEntry): Promise<void>;
  update(id: string, patch: Partial<JobEntry>): Promise<JobEntry | null>;
  /** Newest first, capped by filter.limit when provided. */
  list(filter?: JobListFilter): Promise<JobEntry[]>;
  remove(id: string): Promise<void>;
}

export function createJobRegistry(
  homeDir: string,
  fs: StateFileSystem = defaultStateFs
): JobRegistry {
  const jobsDir = path.join(homeDir, ".poe-code", "state", "jobs");
  let pendingMutation: Promise<void> = Promise.resolve();

  function jobPath(id: string): string {
    assertSafeJobId(id);
    return path.join(jobsDir, `${id}.json`);
  }

  async function assertSafeJobsDir(): Promise<void> {
    await assertPathHasNoSymbolicLinks(
      fs,
      jobsDir,
      "Refusing runtime job state access through symbolic link"
    );
  }

  async function assertSafeJobPath(filePath: string): Promise<void> {
    await assertPathHasNoSymbolicLinks(
      fs,
      filePath,
      "Refusing runtime job state access through symbolic link"
    );
  }

  async function get(id: string): Promise<JobEntry | null> {
    const filePath = jobPath(id);
    await assertSafeJobPath(filePath);
    try {
      return parseJobEntry(await fs.readFile(filePath, "utf8"), id);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async function put(entry: JobEntry): Promise<void> {
    assertJobEntry(entry);
    const filePath = jobPath(entry.id);
    await mutate(async () => {
      await assertSafeJobsDir();
      await fs.mkdir(jobsDir, { recursive: true });
      await assertSafeJobsDir();
      await writeJobAtomically(filePath, entry);
    });
  }

  async function update(id: string, patch: Partial<JobEntry>): Promise<JobEntry | null> {
    const filePath = jobPath(id);
    return mutate(async () => {
      await assertSafeJobsDir();
      await fs.mkdir(jobsDir, { recursive: true });
      await assertSafeJobsDir();
      const current = await get(id);
      if (current === null) {
        return null;
      }

      const updated = {
        ...current,
        ...patch,
        id: current.id
      };
      assertJobEntry(updated);
      await writeJobAtomically(filePath, updated);
      return updated;
    });
  }

  async function list(filter: JobListFilter = {}): Promise<JobEntry[]> {
    await assertSafeJobsDir();
    let entries: string[];

    try {
      entries = await fs.readdir(jobsDir);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    const jobs: JobEntry[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(jobsDir, entry);
      await assertSafeJobPath(filePath);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }

      const job = parseJobEntry(
        await fs.readFile(filePath, "utf8"),
        entry.slice(0, -".json".length)
      );
      if (job !== null && matchesFilter(job, filter)) {
        jobs.push(job);
      }
    }

    jobs.sort((left, right) => startedAtTime(right) - startedAtTime(left));
    return filter.limit === undefined ? jobs : jobs.slice(0, filter.limit);
  }

  async function remove(id: string): Promise<void> {
    const filePath = jobPath(id);
    await mutate(async () => {
      await assertSafeJobsDir();
      try {
        await fs.stat(jobsDir);
      } catch (error) {
        if (isNotFoundError(error)) {
          return;
        }

        throw error;
      }

      try {
        await assertSafeJobPath(filePath);
        await fs.unlink(filePath);
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    });
  }

  async function mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    const mutation = pendingMutation.then(operation);
    pendingMutation = mutation.then(
      () => undefined,
      () => undefined
    );
    return mutation;
  }

  async function writeJobAtomically(filePath: string, entry: JobEntry): Promise<void> {
    await assertSafeJobPath(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let tempCreated = false;

    try {
      await assertSafeJobPath(tempPath);
      await fs.writeFile(tempPath, `${JSON.stringify(entry, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      tempCreated = true;
      await assertSafeJobPath(filePath);
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (tempCreated || !isAlreadyExistsError(error)) {
        await removeTempFile(tempPath).catch(() => undefined);
      }
      throw error;
    }
  }

  async function removeTempFile(tempPath: string): Promise<void> {
    try {
      await fs.unlink(tempPath);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  return {
    get,
    put,
    update,
    list,
    remove
  };
}

function assertSafeJobId(id: string): void {
  if (
    id.length === 0 ||
    id === "." ||
    id === ".." ||
    path.isAbsolute(id) ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0")
  ) {
    throw new Error("Invalid job id.");
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function assertJobEntry(entry: JobEntry): void {
  if (!isJobEntry(entry)) {
    throw new Error("Invalid job entry.");
  }
}

function matchesFilter(job: JobEntry, filter: JobListFilter): boolean {
  return (
    (filter.env_id === undefined || job.env_id === filter.env_id) &&
    (filter.env_kind === undefined || job.env_kind === filter.env_kind) &&
    (filter.tool === undefined || job.tool === filter.tool) &&
    (filter.status === undefined || job.status === filter.status) &&
    isWithinSince(job, filter.since)
  );
}

function isWithinSince(job: JobEntry, since: Date | undefined): boolean {
  if (since === undefined) {
    return true;
  }

  const startedAt = Date.parse(job.started_at);
  return !Number.isFinite(startedAt) || startedAt >= since.getTime();
}

function startedAtTime(job: JobEntry): number {
  const startedAt = Date.parse(job.started_at);
  return Number.isFinite(startedAt) ? startedAt : 0;
}

function parseJobEntry(content: string, expectedId: string): JobEntry | null {
  const parsed = JSON.parse(content) as unknown;
  if (!isJobEntry(parsed)) {
    throw new Error("Invalid job state file.");
  }
  return parsed.id === expectedId ? parsed : null;
}

function isJobEntry(value: unknown): value is JobEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.env_id === "string" &&
    typeof value.env_kind === "string" &&
    typeof value.tool === "string" &&
    Array.isArray(value.argv) &&
    value.argv.every((arg) => typeof arg === "string") &&
    typeof value.cwd === "string" &&
    typeof value.started_at === "string" &&
    isJobStatus(value.status) &&
    (value.exit_code === undefined ||
      (typeof value.exit_code === "number" && Number.isInteger(value.exit_code))) &&
    (value.exited_at === undefined || typeof value.exited_at === "string") &&
    (value.log_file === undefined || typeof value.log_file === "string") &&
    (value.reattach_context === undefined || isRecord(value.reattach_context))
  );
}

function isJobStatus(value: unknown): value is JobStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "exited" ||
    value === "killed" ||
    value === "lost"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type { StateFileSystem } from "./fs.js";
