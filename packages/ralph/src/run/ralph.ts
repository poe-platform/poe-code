import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { OverbakingDetector } from "../overbaking/detector.js";
import { parseFrontmatter, writeFrontmatter } from "../frontmatter/frontmatter.js";
import type { RalphPlanStatus } from "../frontmatter/frontmatter.js";
import type {
  RalphFileStat,
  RalphFileSystem,
  RalphRunOptions,
  RalphRunResult
} from "../types.js";

export async function runRalph(
  options: RalphRunOptions
): Promise<RalphRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const runAgent = options.runAgent;
  if (!runAgent) {
    throw new Error("runRalph requires a runAgent implementation.");
  }

  if (!Number.isInteger(options.maxIterations) || options.maxIterations < 1) {
    throw new Error("maxIterations must be a positive integer.");
  }

  const threshold = options.maxFailures ?? 3;
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("maxFailures must be a positive integer.");
  }

  const absoluteDocPath = resolveAbsoluteDocPath(
    options.docPath,
    options.cwd,
    options.homeDir
  );
  const rawContent = await fs.readFile(absoluteDocPath, "utf8");
  const { body: prompt } = parseFrontmatter(rawContent);
  const detector = new OverbakingDetector(threshold);
  const startTime = Date.now();
  let iterationsCompleted = 0;

  await updateFrontmatter(fs, absoluteDocPath, prompt, "in_progress", 0);

  async function finalize(
    stopReason: RalphRunResult["stopReason"]
  ): Promise<RalphRunResult> {
    const status = stopReasonToStatus(stopReason);
    await updateFrontmatter(
      fs,
      absoluteDocPath,
      prompt,
      status,
      iterationsCompleted
    );
    if (stopReason === "max_iterations" && iterationsCompleted > 0) {
      await archivePlan(fs, absoluteDocPath);
    }
    return {
      stopReason,
      docPath: options.docPath,
      iterationsCompleted,
      totalDurationMs: Date.now() - startTime
    };
  }

  try {
    for (
      let iteration = 1;
      iteration <= options.maxIterations;
      iteration += 1
    ) {
      assertNotAborted(options.signal);
      options.onIterationStart?.(iteration, options.maxIterations);

      const iterationStart = Date.now();
      let result;
      try {
        result = await runAgent({
          agent: options.agent,
          prompt,
          cwd: options.cwd,
          ...(options.model ? { model: options.model } : {}),
          ...(options.signal ? { signal: options.signal } : {})
        });
      } catch (error) {
        if (isAbortError(error)) {
          return finalize("cancelled");
        }
        throw error;
      }

      const success = result.exitCode === 0;
      iterationsCompleted += 1;

      await updateFrontmatter(
        fs,
        absoluteDocPath,
        prompt,
        "in_progress",
        iterationsCompleted
      );

      options.onIterationComplete?.(
        iteration,
        Date.now() - iterationStart,
        success
      );

      const overbake = detector.record(success);
      if (!overbake.shouldWarn) {
        continue;
      }

      options.onOverbakeWarning?.(
        overbake.consecutiveFailures,
        threshold
      );

      const action = options.promptOverbake
        ? await options.promptOverbake({
            consecutiveFailures: overbake.consecutiveFailures,
            threshold
          })
        : "abort";

      if (action === "abort") {
        return finalize("overbake_abort");
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      return finalize("cancelled");
    }
    throw error;
  }

  return finalize("max_iterations");
}

function createDefaultFs(): RalphFileSystem {
  return {
    readFile: fsPromises.readFile as RalphFileSystem["readFile"],
    writeFile: (filePath, content) =>
      fsPromises.writeFile(filePath, content, "utf8"),
    readdir: fsPromises.readdir,
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        mtimeMs: stat.mtimeMs
      } satisfies RalphFileStat;
    },
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    rename: fsPromises.rename
  };
}

function resolveAbsoluteDocPath(
  docPath: string,
  cwd: string,
  homeDir: string
): string {
  if (docPath.startsWith("~/")) {
    return path.join(homeDir, docPath.slice(2));
  }
  return path.isAbsolute(docPath) ? docPath : path.resolve(cwd, docPath);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error("Ralph run cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function updateFrontmatter(
  fs: RalphFileSystem,
  absoluteDocPath: string,
  body: string,
  status: RalphPlanStatus,
  iteration: number
): Promise<void> {
  const content = writeFrontmatter({ status, iteration }, body);
  await fs.writeFile(absoluteDocPath, content);
}

async function archivePlan(
  fs: RalphFileSystem,
  absoluteDocPath: string
): Promise<void> {
  const dir = path.dirname(absoluteDocPath);
  const archiveDir = path.join(dir, "archive");
  const archivePath = path.join(archiveDir, path.basename(absoluteDocPath));
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.rename(absoluteDocPath, archivePath);
}

function stopReasonToStatus(stopReason: RalphRunResult["stopReason"]): RalphPlanStatus {
  switch (stopReason) {
    case "completed":
    case "max_iterations":
      return "completed";
    case "overbake_abort":
      return "overbake_abort";
    case "cancelled":
      return "cancelled";
  }
}
