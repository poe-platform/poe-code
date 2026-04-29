import { exec as execCallback } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import {
  lockWorkflow,
  makeRunLogFileName,
  resolveRunLogDir,
  resolveWorkflowPath
} from "@poe-code/agent-harness-tools";
import {
  makeAgentModule,
  makeGitModule,
  makeHarnessModule,
  makeLogModule,
  makeMetricModule,
  makeTimeModule,
  runHarness
} from "@poe-code/agent-script";
import { parseExperimentFrontmatter } from "../frontmatter/frontmatter.js";
import { parseExperimentFrontmatterData } from "../frontmatter/frontmatter.js";
import type {
  ExecFn,
  ExperimentFileSystem,
  ExperimentRunOptions,
  ExperimentRunResult,
  JournalEntry,
  MetricDef
} from "../types.js";

type LockCapableExperimentFs = {
  open(path: string, flags: string): Promise<{
    close(): Promise<void>;
    writeFile(
      data: string,
      options?: BufferEncoding | { encoding?: BufferEncoding }
    ): Promise<void>;
  }>;
  stat(path: string): Promise<{
    mtimeMs: number;
  }>;
  unlink(path: string): Promise<void>;
};

type LogModuleEntry = Parameters<NonNullable<Parameters<typeof makeLogModule>[0]>>[0];
type ExperimentHarnessModules = ReturnType<Parameters<typeof runHarness>[1]["modulesFor"]>;

function createDefaultFs(): ExperimentFileSystem {
  const fs = {
    readFile: fsPromises.readFile as ExperimentFileSystem["readFile"],
    writeFile: (filePath: string, content: string) =>
      fsPromises.writeFile(filePath, content, "utf8"),
    readdir: fsPromises.readdir,
    open: (filePath: string, flags: string) => fsPromises.open(filePath, flags),
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    },
    unlink: async (filePath: string) => {
      await fsPromises.unlink(filePath);
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath: string) => {
      await fsPromises.rmdir(filePath);
    },
    appendFile: async (filePath: string, content: string) => {
      await fsPromises.appendFile(filePath, content, "utf8");
    }
  };

  return fs as ExperimentFileSystem;
}

function createDefaultExec(): ExecFn {
  return async (command, options) =>
    await new Promise((resolve) => {
      execCallback(
        command,
        {
          cwd: options?.cwd,
          timeout: options?.timeout,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          const exitCode =
            error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
              ? (error as NodeJS.ErrnoException & { code: number }).code
              : error
                ? 1
                : 0;

          resolve({
            stdout,
            stderr,
            exitCode
          });
        }
      );
    });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error("Experiment loop cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function createMetricRunner(
  exec: ExecFn,
  cwd: string,
  options: ExperimentRunOptions,
  metrics: MetricDef[]
) {
  return async (scriptName: string): Promise<string> => {
    const result = await exec(`npm run --silent ${shellEscape(scriptName)}`, { cwd });
    const score = readMetricScore(result.stdout, scriptName);

    options.onMetricResult?.(readMetricDefinition(scriptName, metrics), {
      score,
      passed: result.exitCode === 0,
      output: result.stdout
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `Metric run failed: ${scriptName}`);
    }

    return result.stdout;
  };
}

function readMetricScore(stdout: string, scriptName: string): number {
  const scoreLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);

  if (scoreLine === undefined) {
    throw new Error(`Metric script "${scriptName}" must print a numeric score.`);
  }

  const score = Number(scoreLine);

  if (!Number.isFinite(score)) {
    throw new Error(`Metric script "${scriptName}" must print a numeric score.`);
  }

  return score;
}

function readMetricDefinition(scriptName: string, metrics: MetricDef[]): MetricDef {
  const name = scriptName.startsWith("metric:") ? scriptName.slice("metric:".length) : scriptName;
  return metrics.find((metric) => metric.name === name) ?? {
    name,
    direction: "maximize"
  };
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function toError(message: string): Error {
  return new Error(message);
}

function normalizeFrontmatter(
  frontmatter: Record<string, unknown>,
  agentOverride: ExperimentRunOptions["agent"]
): Record<string, unknown> {
  if (!agentOverride) {
    return frontmatter;
  }

  const parsed = parseExperimentFrontmatterData(frontmatter);
  const overrideAgents = Array.isArray(agentOverride) ? agentOverride : [agentOverride];
  const existingAgents = parsed.agents ?? {};
  const existingEntries = Object.entries(existingAgents);

  if (existingEntries.length === 0) {
    return {
      ...frontmatter,
      agents: Object.fromEntries(
        overrideAgents.map((agent, index) => [
          index === 0 ? "experimenter" : `experimenter${index + 1}`,
          { agent }
        ])
      )
    };
  }

  return {
    ...frontmatter,
    agents: Object.fromEntries(
      existingEntries.map(([name, definition], index) => [
        name,
        typeof definition === "string"
          ? overrideAgents[index % overrideAgents.length] ?? definition
          : {
              ...definition,
              agent: overrideAgents[index % overrideAgents.length] ?? definition.agent
            }
      ])
    )
  };
}

function withRuntimeOverrides(
  frontmatter: Record<string, unknown>,
  options: Pick<ExperimentRunOptions, "agent" | "maxExperiments">
): Record<string, unknown> {
  const normalizedFrontmatter = normalizeFrontmatter(frontmatter, options.agent);

  if (options.maxExperiments === undefined) {
    return normalizedFrontmatter;
  }

  return {
    ...normalizedFrontmatter,
    maxExperiments: options.maxExperiments
  };
}

function assertExperimentScriptBlock(content: string, docPath: string): void {
  const { body } = parseExperimentFrontmatter(content);

  if (containsExperimentScriptBlock(body)) {
    return;
  }

  throw new Error(
    `Experiment doc "${docPath}" must include a fenced \`js\` block with the loop body.`
  );
}

function containsExperimentScriptBlock(body: string): boolean {
  for (const line of body.split("\n")) {
    if (matchesExperimentScriptFence(line)) {
      return true;
    }
  }

  return false;
}

function matchesExperimentScriptFence(line: string): boolean {
  const trimmedLine = line.trimStart();

  if (!trimmedLine.startsWith("```")) {
    return false;
  }

  const info = trimmedLine.slice(3).trimStart();
  return matchesScriptInfoWord(info, "js") || matchesScriptInfoWord(info, "ajs");
}

function matchesScriptInfoWord(info: string, expected: string): boolean {
  if (!info.startsWith(expected)) {
    return false;
  }

  const nextCharacter = info[expected.length];
  return nextCharacter === undefined || nextCharacter === " " || nextCharacter === "\t";
}

function handleLogEntry(entry: LogModuleEntry, options: ExperimentRunOptions): void {
  if (entry.type !== "event") {
    return;
  }

  if (entry.name === "experiment.start") {
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    if (typeof payload?.index === "number" && typeof payload.agent === "string") {
      options.onExperimentStart?.(payload.index, payload.agent);
    }
    return;
  }

  if (entry.name === "baseline.collected") {
    const baseline = isRecord(entry.payload)
      ? readNumberRecord(entry.payload)
      : isRecord((entry.payload as { baseline?: unknown } | undefined)?.baseline)
        ? readNumberRecord((entry.payload as { baseline: Record<string, unknown> }).baseline)
        : undefined;
    if (baseline !== undefined) {
      options.onBaselineCollected?.(baseline);
    }
    return;
  }

  if (entry.name === "experiment.commit") {
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    const commitHash =
      typeof entry.payload === "string"
        ? entry.payload
        : typeof payload?.commitHash === "string"
          ? payload.commitHash
          : typeof payload?.commit === "string"
            ? payload.commit
            : undefined;
    if (commitHash !== undefined) {
      options.onCommit?.(commitHash);
    }
    return;
  }

  if (entry.name === "experiment.reset") {
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    const targetHash =
      typeof entry.payload === "string"
        ? entry.payload
        : typeof payload?.targetHash === "string"
          ? payload.targetHash
          : typeof payload?.target === "string"
            ? payload.target
            : undefined;
    if (targetHash !== undefined) {
      options.onReset?.(targetHash);
    }
    return;
  }

  if (entry.name === "experiment.complete") {
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    const index = typeof payload?.index === "number" ? payload.index : undefined;
    const entryValue = isJournalEntry(payload?.entry) ? payload.entry : undefined;
    if (index !== undefined && entryValue !== undefined) {
      options.onExperimentComplete?.(index, entryValue);
    }
  }
}

function readRunResult(
  value: unknown,
  docPath: string,
  totalDurationMs: number
): ExperimentRunResult {
  if (!isRecord(value)) {
    throw new Error("Experiment harness must return an object result.");
  }

  const stopReason = typeof value.stopReason === "string" ? value.stopReason : "completed";
  const experimentsCompleted =
    typeof value.experimentsCompleted === "number" && Number.isFinite(value.experimentsCompleted)
      ? value.experimentsCompleted
      : 0;
  const experimentsKept =
    typeof value.experimentsKept === "number" && Number.isFinite(value.experimentsKept)
      ? value.experimentsKept
      : 0;
  const duration =
    typeof value.totalDurationMs === "number" && Number.isFinite(value.totalDurationMs)
      ? value.totalDurationMs
      : totalDurationMs;

  return {
    stopReason:
      stopReason === "cancelled"
      || stopReason === "completed"
      || stopReason === "max_experiments"
      || stopReason === "max_kept"
        ? stopReason
        : "completed",
    docPath,
    experimentsCompleted,
    experimentsKept,
    totalDurationMs: duration
  };
}

function isJournalEntry(value: unknown): value is JournalEntry {
  return (
    isRecord(value)
    && typeof value.commit === "string"
    && (value.status === "keep" || value.status === "discard")
    && typeof value.output === "string"
    && typeof value.agentOutput === "string"
    && typeof value.durationMs === "number"
    && typeof value.timestamp === "string"
  );
}

function readNumberRecord(value: Record<string, unknown>): Record<string, number> | undefined {
  const entries = Object.entries(value).map(([key, entryValue]) =>
    typeof entryValue === "number" && Number.isFinite(entryValue)
      ? ([key, entryValue] as const)
      : undefined
  );

  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry !== undefined));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

export async function runExperimentLoop(
  options: ExperimentRunOptions
): Promise<ExperimentRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const exec = options.exec ?? createDefaultExec();
  const runAgent = options.runAgent;

  if (!runAgent) {
    throw new Error("runExperimentLoop requires a runAgent implementation.");
  }

  const absoluteDocPath = resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  const runLogDir = resolveRunLogDir({
    planPath: absoluteDocPath,
    runner: "experiment",
    homeDir: options.homeDir
  });
  const startedAt = Date.now();
  let releaseLock: (() => Promise<void>) | undefined;

  try {
    assertNotAborted(options.signal);
    releaseLock = await lockWorkflow(absoluteDocPath, {
      fs: fs as unknown as LockCapableExperimentFs
    });
    assertExperimentScriptBlock(await fs.readFile(absoluteDocPath, "utf8"), options.docPath);

    const result = await runHarness(absoluteDocPath, {
      modulesFor: (frontmatter, meta): ExperimentHarnessModules => {
        const effectiveFrontmatter = withRuntimeOverrides(frontmatter, options);
        const parsedFrontmatter = parseExperimentFrontmatterData(effectiveFrontmatter);
        const metrics = parsedFrontmatter.metric
          ? Array.isArray(parsedFrontmatter.metric)
            ? parsedFrontmatter.metric
            : [parsedFrontmatter.metric]
          : [];

        return {
          agent: makeAgentModule(async (input) => {
            const result = await runAgent({
              agent: input.agent,
              prompt: input.prompt,
              cwd: input.cwd ?? options.cwd,
              ...(input.model ? { model: input.model } : {}),
              ...(options.signal ? { signal: options.signal } : {}),
              logDir: runLogDir,
              logFileName: makeRunLogFileName(`experiment-${input.agent}`)
            });

            return {
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              summary: result.stdout.trim(),
              durationMs: 0
            };
          }),
          git: makeGitModule(options.cwd),
          harness: makeHarnessModule(effectiveFrontmatter, {
            filepath: meta.filepath,
            kind: effectiveFrontmatter.kind,
            version: effectiveFrontmatter.version
          }),
          log: makeLogModule((entry) => {
            handleLogEntry(entry, options);
          }),
          metric: makeMetricModule(createMetricRunner(exec, options.cwd, options, metrics)),
          time: makeTimeModule()
        } as ExperimentHarnessModules;
      },
      ...(options.signal ? { signal: options.signal } : {})
    });

    if (result.ok !== true) {
      throw toError(readErrorMessage((result as unknown as { error: unknown }).error));
    }

    return readRunResult(
      (result as { returnValue?: unknown }).returnValue,
      options.docPath,
      Date.now() - startedAt
    );
  } catch (error) {
    if (isAbortError(error)) {
      return {
        stopReason: "cancelled",
        docPath: options.docPath,
        experimentsCompleted: 0,
        experimentsKept: 0,
        totalDurationMs: Date.now() - startedAt
      };
    }

    throw error;
  } finally {
    await releaseLock?.();
  }
}
