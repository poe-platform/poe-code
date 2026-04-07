import { exec as execCallback } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { resolve } from "@poe-code/config-extends";
import {
  parseExperimentFrontmatterData,
  type ExperimentFrontmatter
} from "../frontmatter/frontmatter.js";
import { createDefaultGit } from "../git/git.js";
import { baselineFromEntry, ExperimentJournal } from "../journal/journal.js";
import { evaluateChain } from "../evaluator/evaluator.js";
import { loadInstructions, loadRunConfig } from "../config/loader.js";
import { parseAgentSpecifier, type AgentSpecifier } from "@poe-code/agent-defs";
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

function normalizeAgents(agent: string | string[] | undefined): AgentSpecifier[] {
  if (!agent) {
    throw new Error("Experiment doc is missing agent frontmatter.");
  }

  const raw = typeof agent === "string" ? [agent] : agent;

  if (raw.length === 0) {
    throw new Error("agent must contain at least one entry.");
  }

  return raw.map(parseAgentSpecifier);
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
      const score = baseline?.[m.name];
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
}): string {
  const vars = {
    body: options.body.trim(),
    journal: options.journal,
    metrics: formatMetrics(options.metrics, options.baseline),
    experiment_index: String(options.experimentIndex),
    baseline: options.baseline ? JSON.stringify(options.baseline) : "",
    doc_path: options.docPath,
    doc_name: options.docName
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

function deriveStateFromJournal(
  entries: JournalEntry[]
): {
  experimentsCompleted: number;
  experimentsKept: number;
  baseline: Record<string, number> | null;
  baselineHash: string | undefined;
} {
  const keepEntries = entries.filter((e) => e.status === "keep");
  const lastKeep = keepEntries[keepEntries.length - 1];

  return {
    experimentsCompleted: entries.length,
    experimentsKept: keepEntries.length,
    baseline: lastKeep ? baselineFromEntry(lastKeep) : null,
    baselineHash: lastKeep?.commit
  };
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
  const [runConfig, instructions] = await Promise.all([
    loadRunConfig({ cwd: options.cwd, homeDir: options.homeDir, fs }),
    loadInstructions()
  ]);
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

  const { frontmatter: initialFrontmatter } = await readDoc();
  const initialMetrics = normalizeMetrics(initialFrontmatter.metric);
  const journalEntries = await journal.readAll();
  const journalState = deriveStateFromJournal(journalEntries);

  let experimentsCompleted = journalState.experimentsCompleted;
  let experimentsKept = journalState.experimentsKept;
  let baselineHash: string | undefined = journalState.baselineHash;
  // Journal's last keep takes priority; fall back to frontmatter seed if no keeps yet
  let baseline: Record<string, number> | null =
    journalState.baseline ?? initialFrontmatter.baseline;

  if (baseline === null) {
    const metricTimeoutMs = initialFrontmatter.metricTimeout
      ? initialFrontmatter.metricTimeout * 1000
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
      options.onBaselineCollected?.(baseline);
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
      const { body, frontmatter } = doc;

      const maxExperiments = validateMaxExperiments(
        options.maxExperiments ?? frontmatter.maxExperiments
      );
      if (experimentsCompleted >= maxExperiments) {
        break;
      }

      const metrics = normalizeMetrics(frontmatter.metric);
      const agents = normalizeAgents(options.agent ?? frontmatter.agent);

      const experimentIndex = experimentsCompleted + 1;
      baselineHash ??= await git.currentHash(options.cwd);
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
        docName: path.basename(absoluteDocPath, path.extname(absoluteDocPath))
      });

      const currentSpecifier = agents[(experimentIndex - 1) % agents.length]!;
      const model = currentSpecifier.model;
      options.onExperimentStart?.(experimentIndex, currentSpecifier.agent);

      try {
        await runAgent({
          agent: currentSpecifier.agent,
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

      const journalAfter = await journal.readAll();
      let newEntry = journalAfter.length > journalLengthBefore
        ? journalAfter[journalAfter.length - 1]!
        : null;

      experimentsCompleted += 1;

      if (newEntry && !newEntry.scores && metrics.length > 0) {
        const metricTimeoutMs = frontmatter.metricTimeout
          ? frontmatter.metricTimeout * 1000
          : undefined;
        const results = await evaluateChain(
          metrics,
          options.cwd,
          exec,
          options.onMetricResult,
          metricTimeoutMs
        );
        if (allMetricsPassed(metrics, results)) {
          const scores = baselineFromResults(metrics, results);
          newEntry = (await journal.updateLast({ scores })) ?? newEntry;
        }
      }

      if (newEntry) {
        if (newEntry.status === "keep") {
          experimentsKept += 1;
          baselineHash = newEntry.commit;
          baseline = baselineFromEntry(newEntry) ?? baseline;
          options.onCommit?.(newEntry.commit);
        } else {
          await git.reset(preExperimentHash, options.cwd);
          options.onReset?.(preExperimentHash);
        }

        options.onExperimentComplete?.(experimentIndex, newEntry);
      } else {
        // Agent exited without writing a journal entry — reset silently.
        await git.reset(preExperimentHash, options.cwd);
        options.onReset?.(preExperimentHash);
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      return finalize("cancelled");
    }

    throw error;
  }

  return finalize("max_experiments");
}
