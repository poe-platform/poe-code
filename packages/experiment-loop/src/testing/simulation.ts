import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import { stringify } from "yaml";
import { hasOwnErrorCode } from "../errors.js";
import { baselineFromEntry, ExperimentJournal } from "../journal/journal.js";
import { runExperimentLoop } from "../run/loop.js";
import {
  experimentDocumentSchemaId,
  parseExperimentFrontmatter
} from "../frontmatter/frontmatter.js";
import { evaluateChain } from "../evaluator/evaluator.js";
import type {
  AgentRunInput,
  AgentRunResult,
  EvalResult,
  ExecFn,
  ExperimentFileSystem,
  ExperimentGit,
  ExperimentRunResult,
  JournalEntry,
  MetricDef
} from "../types.js";

type SimulationFs = ExperimentFileSystem;

type TurnContext = {
  fs: SimulationFs;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
};

type MetricResultQueue = Record<string, SimulationMetricResult | SimulationMetricResult[]>;

type GitSnapshot = Record<string, string>;

type RawFs = ReturnType<typeof createFsFromVolume>["promises"];

export type SimulationExecCall = {
  command: string;
  cwd?: string;
  timeout?: number;
};

export type AgentTurnSpec = {
  assertPrompt?: (prompt: string, ctx: TurnContext) => void | Promise<void>;
  fileChanges?: Record<string, string>;
  output: AgentRunResult;
};

export type SimulationMetricResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CreateExperimentDocOptions = {
  agent?: string | string[];
  metric?: MetricDef | MetricDef[];
  baseline?: Record<string, number> | null;
  body?: string;
};

export type ExperimentLoopSimulationOptions = {
  docPath?: string;
  docContent?: string;
  files?: Record<string, string>;
  maxExperiments: number;
  metricResults?: MetricResultQueue;
  signal?: AbortSignal;
  turns: AgentTurnSpec[];
};

export type SimulationGit = ExperimentGit & {
  commitAll: (message: string, cwd: string) => Promise<string>;
  currentHashCalls: string[];
  commitAllCalls: Array<{ message: string; cwd: string }>;
  resetCalls: Array<{ commitHash: string; cwd: string }>;
  getHeadHash: () => string;
};

export type SimulationResult = {
  result: ExperimentRunResult;
  prompts: string[];
  runs: AgentRunInput[];
  fs: SimulationFs;
  git: SimulationGit;
  execCalls: SimulationExecCall[];
  cwd: string;
  homeDir: string;
  docPath: string;
  journalPath: string;
  readDoc: () => Promise<string>;
  readFile: (filePath: string) => Promise<string>;
  readJournal: () => Promise<JournalEntry[]>;
};

function resolveJournalPath(docPath: string): string {
  return path.join(
    path.dirname(docPath),
    `${path.basename(docPath, path.extname(docPath))}.journal.jsonl`
  );
}

function normalizeMetricResult(result: SimulationMetricResult | SimulationMetricResult[]): {
  queue: SimulationMetricResult[];
} {
  return {
    queue: Array.isArray(result) ? [...result] : [result]
  };
}

function createSimulationFs(options: ExperimentLoopSimulationOptions): {
  fs: SimulationFs;
  cwd: string;
  homeDir: string;
  rawFs: RawFs;
  docPath: string;
  journalPath: string;
} {
  const cwd = "/repo";
  const homeDir = "/home/test";
  const docPath = resolveWorkflowPath(
    options.docPath ?? ".poe-code/experiments/plan.md",
    cwd,
    homeDir
  );
  const journalPath = resolveJournalPath(docPath);
  const files: Record<string, string> = {
    [docPath]: options.docContent ?? createExperimentDoc(),
    ...Object.fromEntries(
      Object.entries(options.files ?? {}).map(([filePath, content]) => [
        resolveWorkflowPath(filePath, cwd, homeDir),
        content
      ])
    )
  };
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  const fs = {
    readFile: (filePath, encoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: async (filePath, content, options) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.writeFile(filePath, content, options ?? { encoding: "utf8" });
    },
    readdir: (filePath) => rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath) => {
      const stat = await rawFs.stat(filePath);

      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    lstat: async (filePath) => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: async (filePath, mkdirOptions) => {
      await rawFs.mkdir(filePath, mkdirOptions);
    },
    realpath: (filePath: string) => rawFs.realpath(filePath) as Promise<string>,
    rmdir: async (filePath) => {
      await rawFs.rmdir(filePath);
    },
    appendFile: async (filePath, content) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.appendFile(filePath, content, { encoding: "utf8" });
    },
    rename: async (oldPath, newPath) => {
      await rawFs.mkdir(path.dirname(newPath), { recursive: true });
      await rawFs.rename(oldPath, newPath);
    },
    unlink: async (filePath) => {
      await rawFs.unlink(filePath);
    }
  } as SimulationFs;

  return {
    fs,
    cwd,
    homeDir,
    rawFs,
    docPath,
    journalPath
  };
}

async function fsWriteFile(rawFs: RawFs, absolutePath: string, content: string): Promise<void> {
  await rawFs.mkdir(path.dirname(absolutePath), { recursive: true });
  await rawFs.writeFile(absolutePath, content, { encoding: "utf8" });
}

async function readTree(rawFs: RawFs, rootPath: string): Promise<GitSnapshot> {
  const snapshot: GitSnapshot = {};

  async function visit(currentPath: string): Promise<void> {
    const entries = (await rawFs.readdir(currentPath)) as string[];

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry);
      const stat = await rawFs.stat(entryPath);

      if (stat.isFile()) {
        snapshot[entryPath] = (await rawFs.readFile(entryPath, "utf8")) as string;
        continue;
      }

      if (stat.isDirectory()) {
        await visit(entryPath);
      }
    }
  }

  try {
    await visit(rootPath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return snapshot;
    }

    throw error;
  }

  return snapshot;
}

function omitPaths(snapshot: GitSnapshot, excludedPaths: Set<string>): GitSnapshot {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([filePath]) => !excludedPaths.has(filePath))
  );
}

function snapshotsEqual(left: GitSnapshot, right: GitSnapshot): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([leftPath, leftContent], index) => {
    const rightEntry = rightEntries[index];
    return rightEntry?.[0] === leftPath && rightEntry[1] === leftContent;
  });
}

async function restoreSnapshot(
  rawFs: RawFs,
  current: GitSnapshot,
  target: GitSnapshot
): Promise<void> {
  for (const filePath of Object.keys(current)) {
    if (filePath in target) {
      continue;
    }

    await rawFs.unlink(filePath);
  }

  for (const [filePath, content] of Object.entries(target)) {
    await fsWriteFile(rawFs, filePath, content);
  }
}

async function createSimulationGit(options: {
  rawFs: RawFs;
  cwd: string;
  excludedPaths: Set<string>;
}): Promise<SimulationGit> {
  const currentHashCalls: string[] = [];
  const commitAllCalls: Array<{ message: string; cwd: string }> = [];
  const resetCalls: Array<{ commitHash: string; cwd: string }> = [];
  const snapshots = new Map<string, GitSnapshot>();
  let nextCommitNumber = 1;
  let headHash = "base-1";

  snapshots.set(
    headHash,
    omitPaths(await readTree(options.rawFs, options.cwd), options.excludedPaths)
  );

  return {
    async currentHash(cwd): Promise<string> {
      currentHashCalls.push(cwd);
      return headHash;
    },

    async commitAll(message, cwd): Promise<string> {
      commitAllCalls.push({ message, cwd });
      const currentSnapshot = omitPaths(
        await readTree(options.rawFs, options.cwd),
        options.excludedPaths
      );
      const headSnapshot = snapshots.get(headHash) ?? {};

      if (snapshotsEqual(currentSnapshot, headSnapshot)) {
        return headHash;
      }

      headHash = `commit-${nextCommitNumber}`;
      nextCommitNumber += 1;
      snapshots.set(headHash, currentSnapshot);

      return headHash;
    },

    async reset(commitHash, cwd): Promise<void> {
      resetCalls.push({ commitHash, cwd });
      const targetSnapshot = snapshots.get(commitHash);

      if (!targetSnapshot) {
        throw new Error(`Unknown commit hash: ${commitHash}`);
      }

      const currentSnapshot = omitPaths(
        await readTree(options.rawFs, options.cwd),
        options.excludedPaths
      );
      await restoreSnapshot(options.rawFs, currentSnapshot, targetSnapshot);
      headHash = commitHash;
    },

    currentHashCalls,
    commitAllCalls,
    resetCalls,
    getHeadHash: () => headHash
  };
}

function createSimulationExec(metricResults: MetricResultQueue | undefined): {
  exec: ExecFn;
  execCalls: SimulationExecCall[];
} {
  const queues = new Map(
    Object.entries(metricResults ?? {}).map(([key, result]) => [
      key,
      normalizeMetricResult(result).queue
    ])
  );
  const execCalls: SimulationExecCall[] = [];

  const exec: ExecFn = async (command, options) => {
    execCalls.push({
      command,
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.timeout !== undefined ? { timeout: options.timeout } : {})
    });

    const queue = queues.get(command);
    const nextResult = queue?.shift();

    if (!nextResult) {
      throw new Error(`No metric result configured for command: ${command}`);
    }

    return nextResult;
  };

  return {
    exec,
    execCalls
  };
}

async function applyFileChanges(
  rawFs: RawFs,
  cwd: string,
  homeDir: string,
  changes: Record<string, string>
): Promise<void> {
  for (const [filePath, content] of Object.entries(changes)) {
    await fsWriteFile(rawFs, resolveWorkflowPath(filePath, cwd, homeDir), content);
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "ENOENT");
}

function scoresPassBaseline(
  metrics: MetricDef[],
  results: EvalResult[],
  baseline: Record<string, number>
): boolean {
  if (results.length !== metrics.length) {
    return false;
  }

  return metrics.every((metric, i) => {
    const result = results[i];
    if (!result?.passed || result.score === null) {
      return false;
    }

    const baselineScore = baseline[metric.name];
    if (baselineScore === undefined) {
      return true;
    }

    const delta = metric.delta ?? 0;
    if (metric.direction === "maximize") {
      return result.score > baselineScore - delta;
    }
    if (metric.direction === "minimize") {
      return result.score < baselineScore + delta;
    }
    return Math.abs(result.score - baselineScore) <= delta;
  });
}

export function createExperimentDoc(options: CreateExperimentDocOptions = {}): string {
  const body = options.body ?? "# Improve the implementation\n\nShip a better change.\n";

  const yaml = stringify({
    $schema: experimentDocumentSchemaId,
    kind: "experiment",
    version: 1,
    agent: options.agent ?? "claude-code",
    metric: options.metric ?? {
      name: "tests",
      script: "node scripts/metric-tests.mjs",
      direction: "maximize"
    },
    baseline: options.baseline ?? null
  }).trimEnd();

  return `---\n${yaml}\n---\n${body}`;
}

export function metricResult(
  options: {
    score?: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    passed?: boolean;
  } = {}
): SimulationMetricResult {
  const stdout = options.stdout ?? (options.score === undefined ? "" : `${options.score}\n`);

  return {
    stdout,
    stderr: options.stderr ?? "",
    exitCode: options.exitCode ?? (options.passed === false ? 1 : 0)
  };
}

export function agentOutput(
  output: Partial<AgentRunResult> = {},
  options: {
    assertPrompt?: AgentTurnSpec["assertPrompt"];
    fileChanges?: Record<string, string>;
  } = {}
): AgentTurnSpec {
  return {
    ...(options.assertPrompt ? { assertPrompt: options.assertPrompt } : {}),
    ...(options.fileChanges ? { fileChanges: options.fileChanges } : {}),
    output: {
      stdout: output.stdout ?? "",
      stderr: output.stderr ?? "",
      exitCode: output.exitCode ?? 0
    }
  };
}

export function agentMakesChanges(
  fileChanges: Record<string, string> = {},
  options: {
    assertPrompt?: AgentTurnSpec["assertPrompt"];
    stdout?: string;
    stderr?: string;
  } = {}
): AgentTurnSpec {
  return agentOutput(
    {
      stdout: options.stdout ?? "",
      stderr: options.stderr ?? "",
      exitCode: 0
    },
    {
      ...(options.assertPrompt ? { assertPrompt: options.assertPrompt } : {}),
      fileChanges
    }
  );
}

export function createExperimentLoopSimulation(options: ExperimentLoopSimulationOptions): {
  run: () => Promise<SimulationResult>;
} {
  return {
    async run(): Promise<SimulationResult> {
      const { fs, cwd, homeDir, rawFs, docPath, journalPath } = createSimulationFs(options);
      const turns = [...options.turns];
      const prompts: string[] = [];
      const runs: AgentRunInput[] = [];
      const git = await createSimulationGit({
        rawFs,
        cwd,
        excludedPaths: new Set([docPath, journalPath])
      });
      const { exec, execCalls } = createSimulationExec(options.metricResults);

      const readFile = async (filePath: string): Promise<string> =>
        fs.readFile(resolveWorkflowPath(filePath, cwd, homeDir), "utf8");
      const readDoc = async (): Promise<string> => fs.readFile(docPath, "utf8");
      const readJournal = async (): Promise<JournalEntry[]> =>
        new ExperimentJournal(journalPath, fs).readAll();

      let collectedBaseline: Record<string, number> | null = null;

      const result = await runExperimentLoop({
        cwd,
        homeDir,
        docPath,
        maxExperiments: options.maxExperiments,
        ...(options.signal ? { signal: options.signal } : {}),
        fs,
        git,
        exec,
        onBaselineCollected: (b) => {
          collectedBaseline = b;
        },
        runAgent: async (input) => {
          const turn = turns.shift();

          if (!turn) {
            throw new Error("Experiment-loop simulation ran out of turns.");
          }

          prompts.push(input.prompt);
          runs.push(input);

          if (turn.assertPrompt) {
            await turn.assertPrompt(input.prompt, {
              fs,
              readFile,
              writeFile: async (filePath, content) => {
                await fsWriteFile(rawFs, resolveWorkflowPath(filePath, cwd, homeDir), content);
              }
            });
          }

          if (turn.fileChanges) {
            await applyFileChanges(rawFs, cwd, homeDir, turn.fileChanges);
          }

          // Simulate the agent evaluating metrics and writing a journal entry.
          const docContent = await fs.readFile(docPath, "utf8");
          const { frontmatter } = parseExperimentFrontmatter(docContent);
          const metrics = Array.isArray(frontmatter.metric)
            ? frontmatter.metric
            : frontmatter.metric
              ? [frontmatter.metric]
              : [];

          // Derive current baseline: journal's last keep → frontmatter seed → collected baseline.
          const allJournalEntries = await new ExperimentJournal(journalPath, fs).readAll();
          const lastKeep = allJournalEntries.filter((e) => e.status === "keep").at(-1);
          const currentBaseline = lastKeep
            ? baselineFromEntry(lastKeep)
            : (frontmatter.baseline ?? collectedBaseline);

          const experimentStart = Date.now();
          const preHash = await git.currentHash(cwd);
          const results = await evaluateChain(metrics, cwd, exec);
          const passed =
            currentBaseline !== null && scoresPassBaseline(metrics, results, currentBaseline);

          let commitHash: string;
          let status: "keep" | "discard";

          if (passed) {
            commitHash = await git.commitAll("simulation", cwd);
            status = "keep";
          } else {
            commitHash = preHash;
            status = "discard";
          }

          const scores = Object.fromEntries(
            metrics
              .map((m, i) => [m.name, results[i]?.score] as const)
              .filter(
                (entry): entry is [string, number] => entry[1] !== undefined && entry[1] !== null
              )
          );

          const agentOutputStr = `${turn.output.stdout}${turn.output.stderr}`;
          const entry: JournalEntry = {
            commit: commitHash,
            status,
            ...(Object.keys(scores).length > 0 ? { scores } : {}),
            output: agentOutputStr,
            agentOutput: agentOutputStr,
            durationMs: Date.now() - experimentStart,
            timestamp: new Date().toISOString()
          };

          await fs.appendFile(journalPath, JSON.stringify(entry) + "\n");

          return turn.output;
        }
      });

      return {
        result,
        prompts,
        runs,
        fs,
        git,
        execCalls,
        cwd,
        homeDir,
        docPath,
        journalPath,
        readDoc,
        readFile,
        readJournal
      };
    }
  };
}
