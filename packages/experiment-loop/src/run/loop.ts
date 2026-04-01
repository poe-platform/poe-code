import { exec as execCallback } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import {
  parseExperimentFrontmatter,
  writeExperimentFrontmatter
} from "../frontmatter/frontmatter.js";
import { createDefaultGit } from "../git/git.js";
import { ExperimentJournal } from "../journal/journal.js";
import { evaluateChain } from "../evaluator/evaluator.js";
import { loadRunConfig } from "../config/loader.js";
import type {
  EvalResult,
  ExecFn,
  ExperimentFileSystem,
  ExperimentRunOptions,
  ExperimentRunResult,
  JournalEntry,
  MetricDef,
  RunConfig
} from "../types.js";

function createDefaultFs(): ExperimentFileSystem {
  return {
    readFile: fsPromises.readFile as ExperimentFileSystem["readFile"],
    writeFile: (filePath, content) => fsPromises.writeFile(filePath, content, "utf8"),
    readdir: fsPromises.readdir,
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        mtimeMs: stat.mtimeMs
      };
    },
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    appendFile: async (filePath, content) => {
      await fsPromises.appendFile(filePath, content, "utf8");
    }
  };
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

function resolveAbsoluteDocPath(docPath: string, cwd: string, homeDir: string): string {
  if (docPath.startsWith("~/")) {
    return path.join(homeDir, docPath.slice(2));
  }

  return path.isAbsolute(docPath) ? docPath : path.resolve(cwd, docPath);
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

  return Array.isArray(metric) ? metric : [metric];
}

function normalizeAgents(agent: string | string[] | undefined): string[] {
  if (!agent) {
    throw new Error("Experiment doc is missing agent frontmatter.");
  }

  if (typeof agent === "string") {
    return [agent];
  }

  if (agent.length === 0) {
    throw new Error("agent must contain at least one entry.");
  }

  return agent;
}

function validateMaxExperiments(maxExperiments: number | undefined): number {
  if (maxExperiments === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (!Number.isInteger(maxExperiments) || maxExperiments < 0) {
    throw new Error("maxExperiments must be a non-negative integer.");
  }

  return maxExperiments;
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

function combineOutput(stdout: string, stderr: string): string {
  return `${stdout}${stderr}`;
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
      const parts = [`- ${m.name}: ${m.direction}, script: \`${m.script}\``];
      const score = baseline?.[m.name];
      if (score !== undefined) {
        parts.push(`(baseline: ${score})`);
      }
      return parts.join(" ");
    })
    .join("\n");
}

function buildPrompt(options: {
  runConfig: RunConfig;
  body: string;
  journal: string;
  metrics: MetricDef[];
  lastCrashOutput?: string;
  experimentIndex: number;
  baseline: Record<string, number> | null;
}): string {
  return interpolate(options.runConfig.prompt, {
    body: options.body.trim(),
    journal: options.journal,
    metrics: formatMetrics(options.metrics, options.baseline),
    crash_output: options.lastCrashOutput
      ? `## Last crash output\n\n${options.lastCrashOutput.trim()}`
      : "",
    experiment_index: String(options.experimentIndex),
    baseline: options.baseline ? JSON.stringify(options.baseline) : ""
  }).trim();
}

function allMetricsPassed(metrics: MetricDef[], results: EvalResult[]): boolean {
  return results.length === metrics.length && results.every((result) => result.passed);
}

function allScoresImproved(
  metrics: MetricDef[],
  results: EvalResult[],
  baseline: Record<string, number> | null
): boolean {
  return metrics.every((metric, index) => {
    const score = results[index]?.score;

    if (score === null || score === undefined) {
      return false;
    }

    const baselineScore = baseline?.[metric.name];

    if (baselineScore === undefined) {
      return true;
    }

    if (metric.direction === "stable") {
      return score === baselineScore;
    }

    return metric.direction === "maximize" ? score > baselineScore : score < baselineScore;
  });
}

function updateBaseline(metrics: MetricDef[], results: EvalResult[]): Record<string, number> {
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

function formatEvaluationOutput(metrics: MetricDef[], results: EvalResult[]): string {
  return metrics
    .map((metric, index) => {
      const result = results[index];

      if (!result) {
        return `${metric.name}: not_run`;
      }

      return [
        `${metric.name}: score=${result.score === null ? "null" : result.score}, passed=${String(result.passed)}`,
        result.output.trim()
      ]
        .filter((entry) => entry.length > 0)
        .join("\n");
    })
    .join("\n\n");
}

function selectJournalScore(metrics: MetricDef[], results: EvalResult[]): number | null {
  if (metrics.length !== 1) {
    return null;
  }

  return results[0]?.score ?? null;
}

function createEntry(options: {
  commit: string;
  status: JournalEntry["status"];
  score: number | null;
  output: string;
  durationMs: number;
}): JournalEntry {
  return {
    commit: options.commit,
    status: options.status,
    score: options.score,
    output: options.output,
    durationMs: options.durationMs,
    timestamp: new Date().toISOString()
  };
}

async function persistDoc(options: {
  fs: ExperimentFileSystem;
  docPath: string;
  baseline: Record<string, number> | null;
  experimentsCompleted: number;
  experimentsKept: number;
}): Promise<void> {
  const rawContent = await options.fs.readFile(options.docPath, "utf8");
  const { frontmatter, body } = parseExperimentFrontmatter(rawContent);

  await writeExperimentFrontmatter(
    options.docPath,
    {
      ...frontmatter,
      baseline: options.baseline,
      status: {
        ...frontmatter.status,
        experiment: options.experimentsCompleted,
        kept: options.experimentsKept
      }
    },
    body,
    options.fs
  );
}

export async function runExperimentLoop(
  options: ExperimentRunOptions
): Promise<ExperimentRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const exec = options.exec ?? createDefaultExec();
  const git = options.git ?? createDefaultGit(exec);
  const runAgent = options.runAgent;

  if (!runAgent) {
    throw new Error("runExperimentLoop requires a runAgent implementation.");
  }

  const absoluteDocPath = resolveAbsoluteDocPath(options.docPath, options.cwd, options.homeDir);
  const journal = new ExperimentJournal(resolveJournalPath(absoluteDocPath), fs);
  await journal.init();
  const runConfig = await loadRunConfig({ cwd: options.cwd, homeDir: options.homeDir, fs });
  const startTime = Date.now();

  async function readDoc(): Promise<{ frontmatter: ReturnType<typeof parseExperimentFrontmatter>["frontmatter"]; body: string }> {
    const rawContent = await fs.readFile(absoluteDocPath, "utf8");
    return parseExperimentFrontmatter(rawContent);
  }

  let { frontmatter, body } = await readDoc();
  let experimentsCompleted = 0;
  let experimentsKept = 0;
  let lastCrashOutput: string | undefined;
  let baselineHash: string | undefined;

  if (frontmatter.baseline === null) {
    const metrics = normalizeMetrics(frontmatter.metric);
    const metricTimeoutMs = frontmatter.metricTimeout ? frontmatter.metricTimeout * 1000 : undefined;
    const baselineResults = await evaluateChain(metrics, options.cwd, exec, options.onMetricResult, metricTimeoutMs);
    if (allMetricsPassed(metrics, baselineResults)) {
      const baseline = updateBaseline(metrics, baselineResults);
      options.onBaselineCollected?.(baseline);
      frontmatter = {
        ...frontmatter,
        baseline
      };
      await persistDoc({
        fs,
        docPath: absoluteDocPath,
        baseline: frontmatter.baseline,
        experimentsCompleted,
        experimentsKept
      });
    }
  }

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
    while (true) {
      assertNotAborted(options.signal);

      const doc = await readDoc();
      body = doc.body;
      frontmatter = doc.frontmatter;

      const maxExperiments = validateMaxExperiments(
        options.maxExperiments ?? frontmatter.maxExperiments
      );
      if (experimentsCompleted >= maxExperiments) {
        break;
      }

      const metrics = normalizeMetrics(frontmatter.metric);
      const agents = normalizeAgents(options.agent ?? frontmatter.agent);
      const metricTimeoutMs = frontmatter.metricTimeout ? frontmatter.metricTimeout * 1000 : undefined;
      const model = options.model ?? frontmatter.model;

      const experimentIndex = experimentsCompleted + 1;
      const prompt = buildPrompt({
        runConfig,
        body,
        journal: await journal.format(),
        metrics,
        experimentIndex,
        baseline: frontmatter.baseline,
        ...(lastCrashOutput ? { lastCrashOutput } : {})
      });
      baselineHash ??= await git.currentHash(options.cwd);
      const preExperimentHash = baselineHash;
      const experimentStart = Date.now();

      const currentAgent = agents[(experimentIndex - 1) % agents.length]!;
      options.onExperimentStart?.(experimentIndex, currentAgent);

      let agentResult;
      try {
        agentResult = await runAgent({
          agent: currentAgent,
          prompt,
          cwd: options.cwd,
          ...(model ? { model } : {}),
          ...(options.signal ? { signal: options.signal } : {})
        });
      } catch (error) {
        if (isAbortError(error)) {
          return finalize("cancelled");
        }

        throw error;
      }

      if (agentResult.exitCode !== 0) {
        const entry = createEntry({
          commit: preExperimentHash,
          status: "crash",
          score: null,
          output: combineOutput(agentResult.stdout, agentResult.stderr),
          durationMs: Date.now() - experimentStart
        });

        experimentsCompleted += 1;
        lastCrashOutput = entry.output;
        await journal.log(entry);
        await git.reset(preExperimentHash, options.cwd);
        options.onReset?.(preExperimentHash);
        options.onExperimentComplete?.(experimentIndex, entry);
        await persistDoc({
          fs,
          docPath: absoluteDocPath,
          baseline: frontmatter.baseline,
          experimentsCompleted,
          experimentsKept
        });
        continue;
      }

      const commitHash = await git.commitAll(
        `experiment-loop: ${path.basename(absoluteDocPath, path.extname(absoluteDocPath))} #${experimentIndex}`,
        options.cwd
      );
      options.onCommit?.(commitHash);
      const evaluationResults = await evaluateChain(metrics, options.cwd, exec, options.onMetricResult, metricTimeoutMs);
      const keep =
        allMetricsPassed(metrics, evaluationResults) &&
        allScoresImproved(metrics, evaluationResults, frontmatter.baseline);
      const entry = createEntry({
        commit: commitHash,
        status: keep ? "keep" : "discard",
        score: selectJournalScore(metrics, evaluationResults),
        output: formatEvaluationOutput(metrics, evaluationResults),
        durationMs: Date.now() - experimentStart
      });

      experimentsCompleted += 1;
      await journal.log(entry);

      if (keep) {
        experimentsKept += 1;
        frontmatter = {
          ...frontmatter,
          baseline: updateBaseline(metrics, evaluationResults)
        };
        baselineHash = commitHash;
        lastCrashOutput = undefined;
      } else {
        await git.reset(preExperimentHash, options.cwd);
        options.onReset?.(preExperimentHash);
        lastCrashOutput = undefined;
      }

      options.onExperimentComplete?.(experimentIndex, entry);
      await persistDoc({
        fs,
        docPath: absoluteDocPath,
        baseline: frontmatter.baseline,
        experimentsCompleted,
        experimentsKept
      });
    }
  } catch (error) {
    if (isAbortError(error)) {
      return finalize("cancelled");
    }

    throw error;
  }

  return finalize("max_experiments");
}
