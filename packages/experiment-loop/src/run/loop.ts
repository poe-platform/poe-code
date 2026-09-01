import "@poe-code/agent-spawn/register-factories";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import {
  ensureSafeRunLogDir,
  makeRunLogFileName,
  resolvePoeCommandExecution,
  resolveWorkflowPath,
  runPoeCommand
} from "@poe-code/agent-harness-tools";
import { resolve } from "@poe-code/config-extends";
import {
  parseExperimentFrontmatterData,
  type ExperimentFrontmatter
} from "../frontmatter/frontmatter.js";
import { createDefaultGit, createExperimentCommitCommand } from "../git/git.js";
import { baselineFromEntry, ExperimentJournal } from "../journal/journal.js";
import { evaluateChain } from "../evaluator/evaluator.js";
import { loadInstructions, loadRunConfig } from "../config/loader.js";
import { parseAgentSpecifier, type AgentSpecifier } from "@poe-code/agent-defs";
import type {
  AgentRunResult,
  EvalResult,
  ExecFn,
  ExperimentFileSystem,
  ExperimentRunOptions,
  ExperimentCallbackResult,
  ExperimentRunResult,
  JournalEntry,
  MetricDef,
  RunConfig
} from "../types.js";

function createDefaultFs(): ExperimentFileSystem {
  const fs = {
    readFile: fsPromises.readFile as ExperimentFileSystem["readFile"],
    writeFile: (
      filePath: string,
      content: string,
      options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
    ) => fsPromises.writeFile(filePath, content, options ?? { encoding: "utf8" }),
    readdir: fsPromises.readdir,
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    },
    lstat: async (filePath: string) => {
      const stat = await fsPromises.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath: string) => {
      await fsPromises.rmdir(filePath);
    },
    appendFile: async (filePath: string, content: string) => {
      await fsPromises.appendFile(filePath, content, "utf8");
    },
    rename: async (oldPath: string, newPath: string) => {
      await fsPromises.rename(oldPath, newPath);
    },
    unlink: async (filePath: string) => {
      await fsPromises.unlink(filePath);
    },
    realpath: fsPromises.realpath
  };

  return fs as ExperimentFileSystem;
}

function createDefaultExec(homeDir: string): ExecFn {
  return async (command, options) => {
    const cwd = options?.cwd ?? process.cwd();
    const shell = process.env.SHELL ?? "sh";
    const argv = [shell, "-lc", command];
    const execution = resolvePoeCommandExecution({
      cwd,
      env: process.env as Record<string, string>,
      argv,
      tool: "experiment-loop",
      context: { homeDir },
      openSpec: {
        execution: {
          wrapForLogTee: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          captureOutput: true,
          activityTimeoutMs: options?.timeout
        }
      }
    });

    try {
      const result = await runPoeCommand({
        factory: execution.factory,
        openSpec: execution.openSpec,
        detach: false,
        state: execution.state
      });

      if (result.kind === "detached") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode
      };
    } catch (error) {
      if (isActivityTimeoutError(error)) {
        return {
          stdout: "",
          stderr: error.message,
          exitCode: 1
        };
      }

      throw error;
    }
  };
}

function resolveJournalPath(docPath: string): string {
  return path.join(
    path.dirname(docPath),
    `${path.basename(docPath, path.extname(docPath))}.journal.jsonl`
  );
}

function normalizeMetrics(metric: MetricDef | MetricDef[] | undefined): MetricDef[] {
  if (!metric) {
    throw new Error("Experiment doc is missing metric frontmatter.");
  }

  const metrics = Array.isArray(metric) ? metric : [metric];
  if (metrics.length === 0) {
    throw new Error("Experiment doc must contain at least one metric.");
  }
  const names = new Set<string>();

  for (const currentMetric of metrics) {
    if (names.has(currentMetric.name)) {
      throw new Error(`Metric names must be unique: "${currentMetric.name}".`);
    }
    names.add(currentMetric.name);
  }

  return metrics;
}

function metricsEqual(left: MetricDef[], right: MetricDef[]): boolean {
  return (
    left.length === right.length &&
    left.every((metric, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        metric.name === other.name &&
        metric.script === other.script &&
        metric.direction === other.direction &&
        metric.delta === other.delta
      );
    })
  );
}

function normalizeAgents(agent: string | string[] | undefined): AgentSpecifier[] {
  if (!agent) {
    throw new Error("Experiment doc is missing agent frontmatter.");
  }

  const raw = typeof agent === "string" ? [agent] : agent;

  if (raw.length === 0) {
    throw new Error("agent must contain at least one entry.");
  }

  return raw.map((value) => {
    try {
      return parseAgentSpecifier(value);
    } catch {
      throw new Error("Agent specifier must include an agent id.");
    }
  });
}

function validateMaxExperiments(maxExperiments: number | undefined): number {
  if (maxExperiments === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (!Number.isInteger(maxExperiments) || maxExperiments < 0) {
    throw new Error("max_experiments must be a non-negative integer.");
  }

  return maxExperiments;
}

function normalizeResolvedBody(prompt: unknown): string {
  if (prompt === undefined) {
    return "";
  }

  if (typeof prompt !== "string") {
    throw new Error("Experiment doc prompt must be a string.");
  }

  return prompt;
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

function isActivityTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.name === "ActivityTimeoutError";
}

function interpolate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  return output;
}

function formatMetrics(metrics: MetricDef[], baseline: Record<string, number> | null): string {
  return metrics
    .map((m) => {
      const parts = [`- ${m.name}: ${m.direction}`];
      if (m.delta !== undefined) {
        parts.push(`±${m.delta}`);
      }
      parts.push(`script: \`${m.script}\``);
      const score = baseline !== null && Object.hasOwn(baseline, m.name) ? baseline[m.name] : undefined;
      if (score !== undefined) {
        parts.push(`(baseline: ${score})`);
      }
      return parts.join(", ");
    })
    .join("\n");
}

function buildPrompt(options: {
  runConfig: RunConfig;
  instructions: string;
  body: string;
  journal: string;
  metrics: MetricDef[];
  experimentIndex: number;
  baseline: Record<string, number> | null;
  docPath: string;
  docName: string;
  commitCommand: string;
}): string {
  const vars = {
    body: options.body.trim(),
    journal: options.journal,
    metrics: formatMetrics(options.metrics, options.baseline),
    experiment_index: String(options.experimentIndex),
    baseline: options.baseline ? JSON.stringify(options.baseline) : "",
    doc_path: options.docPath,
    doc_name: options.docName,
    commit_command: options.commitCommand
  };

  const context = interpolate(options.runConfig.prompt, vars).trim();
  const instructions = interpolate(options.instructions, vars).trim();

  return `${context}\n\n${instructions}`;
}

function allMetricsPassed(metrics: MetricDef[], results: EvalResult[]): boolean {
  return results.length === metrics.length && results.every((result) => result.passed);
}

function baselineFromResults(metrics: MetricDef[], results: EvalResult[]): Record<string, number> {
  return Object.fromEntries(
    metrics.map((metric, index) => {
      const score = results[index]?.score;

      if (score === null || score === undefined) {
        throw new Error(`Metric "${metric.name}" is missing a numeric score.`);
      }

      return [metric.name, score] as const;
    })
  );
}

function deriveStateFromJournal(entries: JournalEntry[]): {
  experimentsCompleted: number;
  experimentsKept: number;
  baseline: Record<string, number> | null;
  baselineHash: string | undefined;
} {
  const keepEntries = entries.filter((e) => e.status === "keep");
  const lastKeep = keepEntries[keepEntries.length - 1];
  const baseline = readFiniteScores(lastKeep?.scores);
  const baselineHash = readNonEmptyString(lastKeep?.commit);

  return {
    experimentsCompleted: entries.length,
    experimentsKept: keepEntries.length,
    baseline,
    baselineHash
  };
}

function readFiniteScores(scores: unknown): Record<string, number> | null {
  if (scores === undefined || scores === null || typeof scores !== "object") {
    return null;
  }

  const entries = Object.entries(scores);
  if (entries.length === 0 || entries.some(([, score]) => typeof score !== "number" || !Number.isFinite(score))) {
    return null;
  }

  return Object.fromEntries(entries) as Record<string, number>;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function notifyCompletedState(
  callback: ((value: string) => ExperimentCallbackResult) | undefined,
  value: string
): Promise<void> {
  try {
    await callback?.(value);
  } catch {
    return;
  }
}

export async function runExperimentLoop(
  options: ExperimentRunOptions
): Promise<ExperimentRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const exec = options.exec ?? createDefaultExec(options.homeDir);
  const runAgent = options.runAgent;

  if (!runAgent) {
    throw new Error("runExperimentLoop requires a runAgent implementation.");
  }

  const absoluteDocPath = resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  const journalPath = resolveJournalPath(absoluteDocPath);
  const managedPaths = [absoluteDocPath, journalPath];
  const git = options.git ?? createDefaultGit(exec, managedPaths);
  const runLogDir = await ensureSafeRunLogDir({
    planPath: absoluteDocPath,
    runner: "experiment",
    homeDir: options.homeDir,
    fs
  });
  const startTime = Date.now();

  async function readDoc(): Promise<{ frontmatter: ExperimentFrontmatter; body: string }> {
    const rawContent = await fs.readFile(absoluteDocPath, "utf8");
    const resolved = await resolve(
      [
        { source: "cli", data: { agent: options.agent } },
        { source: "document", filePath: absoluteDocPath, content: rawContent },
        { source: "base", path: path.join(options.cwd, ".poe-code/experiments/bases") },
        { source: "base", path: path.join(options.homeDir, ".poe-code/experiments/bases") },
        { source: "defaults", data: { agent: "claude-code" } }
      ],
      { fs }
    );
    const { prompt, ...frontmatterData } = resolved.data;

    return {
      frontmatter: parseExperimentFrontmatterData(frontmatterData),
      body: normalizeResolvedBody(prompt)
    };
  }

  let experimentsCompleted = 0;
  let experimentsKept = 0;
  let baselineHash: string | undefined;
  let baseline: Record<string, number> | null = null;
  let baselineMetrics: MetricDef[] = [];

  async function finalize(
    stopReason: ExperimentRunResult["stopReason"]
  ): Promise<ExperimentRunResult> {
    return {
      stopReason,
      docPath: options.docPath,
      experimentsCompleted,
      experimentsKept,
      totalDurationMs: Date.now() - startTime
    };
  }

  try {
    assertNotAborted(options.signal);

    const journal = new ExperimentJournal(journalPath, fs);
    await journal.init();
    const [runConfig, instructions] = await Promise.all([
      loadRunConfig({ cwd: options.cwd, homeDir: options.homeDir, fs }),
      loadInstructions()
    ]);
    const { frontmatter: initialFrontmatter } = await readDoc();
    const initialMetrics = normalizeMetrics(initialFrontmatter.metric);
    const journalEntries = await journal.readAll();
    const journalState = deriveStateFromJournal(journalEntries);

    experimentsCompleted = journalState.experimentsCompleted;
    experimentsKept = journalState.experimentsKept;
    baselineHash = journalState.baselineHash;
    // Journal's last keep takes priority; fall back to frontmatter seed if no keeps yet
    baseline = journalState.baseline ?? initialFrontmatter.baseline;
    baselineMetrics = initialMetrics;

    const initialMaxExperiments = validateMaxExperiments(
      options.maxExperiments ?? initialFrontmatter.max_experiments
    );
    if (experimentsCompleted >= initialMaxExperiments) {
      return finalize("max_experiments");
    }

    if (baseline === null) {
      const metricTimeoutMs = initialFrontmatter.metric_timeout !== undefined
        ? initialFrontmatter.metric_timeout * 1000
        : undefined;
      const baselineResults = await evaluateChain(
        initialMetrics,
        options.cwd,
        exec,
        options.onMetricResult,
        metricTimeoutMs
      );
      if (allMetricsPassed(initialMetrics, baselineResults)) {
        baseline = baselineFromResults(initialMetrics, baselineResults);
        await options.onBaselineCollected?.(baseline);
      } else {
        throw new Error("Unable to collect a passing experiment baseline.");
      }
    }

    while (true) {
      assertNotAborted(options.signal);

      // runDocumentWorkflow does not fit yet because experiment-loop rebuilds the
      // single-stage prompt from the latest doc + journal every iteration and then
      // decides keep/reset state from experiment-specific journal + git handling.
      const doc = await readDoc();
      const { body, frontmatter } = doc;

      const maxExperiments = validateMaxExperiments(
        options.maxExperiments ?? frontmatter.max_experiments
      );
      if (experimentsCompleted >= maxExperiments) {
        break;
      }

      const metrics = normalizeMetrics(frontmatter.metric);
      const agents = normalizeAgents(options.agent ?? frontmatter.agent);

      if (!metricsEqual(metrics, baselineMetrics)) {
        if (frontmatter.baseline === null) {
          const metricTimeoutMs = frontmatter.metric_timeout !== undefined
            ? frontmatter.metric_timeout * 1000
            : undefined;
          const baselineResults = await evaluateChain(
            metrics,
            options.cwd,
            exec,
            options.onMetricResult,
            metricTimeoutMs
          );
          if (!allMetricsPassed(metrics, baselineResults)) {
            throw new Error("Unable to collect a passing experiment baseline.");
          }
          baseline = baselineFromResults(metrics, baselineResults);
          await options.onBaselineCollected?.(baseline);
        } else {
          baseline = frontmatter.baseline;
        }
        baselineMetrics = metrics;
      }

      const experimentIndex = experimentsCompleted + 1;
      const currentHash = await git.currentHash(options.cwd);
      baselineHash ??= currentHash;
      const preExperimentHash = baselineHash;

      const journalLengthBefore = (await journal.readAll()).length;

      const prompt = buildPrompt({
        runConfig,
        instructions,
        body,
        journal: await journal.format(),
        metrics,
        experimentIndex,
        baseline,
        docPath: options.docPath,
        docName: path.basename(absoluteDocPath, path.extname(absoluteDocPath)),
        commitCommand: createExperimentCommitCommand(
          options.cwd,
          managedPaths,
          `experiment-loop: ${path.basename(absoluteDocPath, path.extname(absoluteDocPath))} #${experimentIndex}`
        )
      });

      const currentSpecifier = agents[(experimentIndex - 1) % agents.length]!;
      const model = currentSpecifier.model;
      await options.onExperimentStart?.(experimentIndex, currentSpecifier.agent);

      let newEntry: JournalEntry | null;
      let agentResult: AgentRunResult;

      try {
        agentResult = await runAgent({
          agent: currentSpecifier.agent,
          prompt,
          cwd: options.cwd,
          logDir: runLogDir,
          logFileName: makeRunLogFileName(
            `experiment-${experimentIndex}-${currentSpecifier.agent}`
          ),
          ...(options.runtime ? { runtime: options.runtime } : {}),
          ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
          ...(options.detach ? { detach: options.detach } : {}),
          ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
          ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
          ...(model ? { model } : {}),
          ...(options.signal ? { signal: options.signal } : {})
        });

        newEntry = await journal.retainLatestNewEntry(journalLengthBefore);
      } catch (error) {
        await git.reset(preExperimentHash, options.cwd);
        await notifyCompletedState(options.onReset, preExperimentHash);

        if (isAbortError(error)) {
          return finalize("cancelled");
        }

        throw error;
      }

      experimentsCompleted += 1;

      if (newEntry === null) {
        await git.reset(preExperimentHash, options.cwd);
        await notifyCompletedState(options.onReset, preExperimentHash);
        continue;
      }

      if (agentResult.exitCode !== 0 || newEntry.status === "discard") {
        try {
          await git.reset(preExperimentHash, options.cwd);
        } catch (error) {
          await journal.removeNewEntries(journalLengthBefore);
          throw error;
        }
        await notifyCompletedState(options.onReset, preExperimentHash);
        if (newEntry.status === "keep") {
          newEntry = (await journal.updateLast({ status: "discard" })) ?? {
            ...newEntry,
            status: "discard"
          };
        }
        await options.onExperimentComplete?.(experimentIndex, newEntry);
        continue;
      }

      if (!newEntry.scores) {
        try {
          const metricTimeoutMs = frontmatter.metric_timeout !== undefined
            ? frontmatter.metric_timeout * 1000
            : undefined;
          const results = await evaluateChain(
            metrics,
            options.cwd,
            exec,
            options.onMetricResult,
            metricTimeoutMs
          );
          if (!allMetricsPassed(metrics, results)) {
            await git.reset(preExperimentHash, options.cwd);
            await notifyCompletedState(options.onReset, preExperimentHash);
            newEntry = (await journal.updateLast({ status: "discard" })) ?? {
              ...newEntry,
              status: "discard"
            };
            await options.onExperimentComplete?.(experimentIndex, newEntry);
            continue;
          }

          const scores = baselineFromResults(metrics, results);
          newEntry = (await journal.updateLast({ scores })) ?? newEntry;
        } catch (error) {
          await git.reset(preExperimentHash, options.cwd);
          await notifyCompletedState(options.onReset, preExperimentHash);
          throw error;
        }
      }

      experimentsKept += 1;
      baselineHash = newEntry.commit;
      baseline = baselineFromEntry(newEntry) ?? baseline;
      baselineMetrics = metrics;
      await notifyCompletedState(options.onCommit, newEntry.commit);
      await options.onExperimentComplete?.(experimentIndex, newEntry);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return finalize("cancelled");
    }

    throw error;
  }

  return finalize("max_experiments");
}
