import parseDuration from "parse-duration";
import {
  createStateManager,
  type JobEntry,
  type JobStatus,
  type StateManager
} from "@poe-code/poe-code-config";
import {
  selectExecutionEnvFactory,
  type ExecutionEnvType,
  type JobHandle,
  type OpenedEnv
} from "@poe-code/agent-harness-tools";
import type { CliContainer } from "../../../container.js";

export type JobIntent = "running" | "pullable";

export function createRuntimeState(container: CliContainer): StateManager {
  return createStateManager(
    container.env.homeDir,
    container.fs as unknown as Parameters<typeof createStateManager>[1]
  );
}

export async function resolveJob(
  state: StateManager,
  jobId: string | undefined,
  intent: JobIntent
): Promise<JobEntry> {
  const allowedStatuses =
    intent === "running" ? new Set<JobStatus>(["running"]) : new Set<JobStatus>(["running", "exited"]);
  if (jobId !== undefined) {
    const entry = await state.jobs.get(jobId);
    if (entry === null) {
      throw new Error(`No runtime job found for "${jobId}".`);
    }
    if (!allowedStatuses.has(entry.status) || entry.env_id.trim() === "") {
      throw new Error(`Runtime job "${jobId}" is not available for this command.`);
    }
    return entry;
  }

  const candidates = (await state.jobs.list())
    .filter((entry) => allowedStatuses.has(entry.status) && entry.env_id.trim() !== "")
    .sort(compareLatestFirst);

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length === 0) {
    throw new Error("No detached runtime jobs match this command.");
  }

  throw new Error(
    [
      "More than one detached runtime job matches this command. Pass a job id.",
      ...candidates.map((entry) => `- ${entry.id} ${entry.tool} ${entry.status} ${entry.started_at}`)
    ].join("\n")
  );
}

export async function attachJob(entry: JobEntry): Promise<{ env: OpenedEnv; handle: JobHandle }> {
  const factory = selectExecutionEnvFactory(entry.env_kind as ExecutionEnvType);
  const env = await factory.attach(entry.env_id, {
    jobId: entry.id,
    tool: entry.tool,
    argv: entry.argv,
    cwd: entry.cwd,
    ...(entry.reattach_context === undefined ? {} : { reattachContext: entry.reattach_context })
  });
  const handle = env.job;
  if (handle === null) {
    throw new Error(`Runtime "${entry.env_kind}" did not provide a handle for job "${entry.id}".`);
  }
  return { env, handle };
}

export function parseSince(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const milliseconds = parseDuration(value);
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error(`Invalid duration "${value}".`);
  }
  return new Date(Date.now() - milliseconds);
}

export async function syncJob(
  entry: JobEntry,
  opts: { forceSync: boolean; close: boolean }
): Promise<void> {
  const { env } = await attachJob(entry);
  const download = await env.downloadWorkspace({
    conflictPolicy: opts.forceSync ? "overwrite" : "refuse"
  });
  if (download.conflicts.length > 0) {
    throw new Error(
      [
        "Runtime workspace sync refused local conflicts:",
        ...download.conflicts.map((conflict) => `- ${conflict.path}: ${conflict.reason}`)
      ].join("\n")
    );
  }
  if (opts.close) {
    await env.close();
  }
}

export async function streamJobLog(
  handle: JobHandle,
  opts: {
    since?: Date;
    follow: boolean;
    write(chunk: string): void;
    onDetach?: () => void;
  }
): Promise<void> {
  let detaching = false;
  const iterator = handle.stream({
    ...(opts.since === undefined ? { sinceByte: 0 } : { since: opts.since }),
    follow: opts.follow
  })[Symbol.asyncIterator]();
  const onSigint = opts.onDetach
    ? () => {
        detaching = true;
        opts.onDetach?.();
        void iterator.return?.();
      }
    : undefined;

  if (onSigint) {
    process.once("SIGINT", onSigint);
  }

  try {
    if (!opts.follow) {
      while (true) {
        const result = await iterator.next();
        if (result.done === true) {
          break;
        }
        opts.write(result.value.data);
      }
      return;
    }

    let pendingNext: Promise<IteratorResult<{ byteOffset: number; data: string }>> | undefined;
    while (!detaching) {
      pendingNext ??= iterator.next();
      const result = await Promise.race([
        pendingNext,
        sleep(250).then(() => ({ timedOut: true as const }))
      ]);

      if ("timedOut" in result) {
        if ((await handle.status()) !== "running") {
          const finalResult = await pendingNext;
          if (finalResult.done !== true) {
            opts.write(finalResult.value.data);
          }
          break;
        }
        continue;
      }

      pendingNext = undefined;
      if (result.done === true) {
        break;
      }
      opts.write(result.value.data);
    }
  } finally {
    if (onSigint) {
      process.off("SIGINT", onSigint);
    }
    await iterator.return?.();
  }
}

export async function waitForGracefulStop(
  handle: JobHandle,
  graceMs = 30_000
): Promise<void> {
  const waitForExit = handle.wait().then(() => "exited" as const);
  const sigtermFailure = handle.kill("SIGTERM").then<never>(
    () => pendingForever(),
    (error: unknown) => {
      throw error;
    }
  );
  const result = await Promise.race([waitForExit, sleep(graceMs), sigtermFailure]);
  if (result !== "exited") {
    await handle.kill("SIGKILL");
    await waitForExit.catch(() => undefined);
  }
}

function compareLatestFirst(left: JobEntry, right: JobEntry): number {
  return Date.parse(right.started_at) - Date.parse(left.started_at);
}

function sleep(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms);
  });
}

function pendingForever(): Promise<never> {
  return new Promise<never>(() => {
    // Successful signal delivery should not settle the graceful-stop race.
  });
}
