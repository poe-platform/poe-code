import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { countLineBreaks, extractBlock, maskSource } from "./loader/extract-block.js";
import { splitFrontmatter } from "./loader/frontmatter.js";
import { lint, type Fix } from "./lint.js";
import { createLintModulesFromRuntimeRegistry } from "./lint/runtime-modules.js";
import { makeAgentModule } from "./modules/agent.js";
import { makeFailModule } from "./modules/fail.js";
import { makeHarnessModule } from "./modules/harness.js";
import { makeLogModule, type LogModuleEntry } from "./modules/log.js";
import { makeMetricModule } from "./modules/metric.js";
import type { ModuleExports, ModuleRegistry } from "./modules/registry.js";
import {
  createBrokenPipeState,
  createSafeOutputStream,
  withBrokenPipeGuard,
  type OutputStream
} from "./output-stream.js";
import { parseModule } from "./parse/parser.js";
import { run } from "./run.js";

type CliStream = OutputStream;

export type ReadMarkdownFile = (filepath: string, encoding: "utf8") => Promise<string>;
export type WriteMarkdownFile = (
  filepath: string,
  source: string,
  options: { encoding: "utf8" }
) => Promise<void>;

export type RunExampleFileOptions = {
  fix?: boolean;
  readFile?: ReadMarkdownFile;
  stderr?: CliStream;
  stdout?: CliStream;
  writeFile?: WriteMarkdownFile;
};

type HarnessMeta = {
  filepath: string;
  kind: unknown;
  version: unknown;
};

type ExampleRuntime = {
  agent: ReturnType<typeof makeAgentModule>;
  fail: ReturnType<typeof makeFailModule>["default"];
  git: {
    checkpoint(): Promise<{
      head: string;
      stashRef: string;
    }>;
    commit(): Promise<string>;
    revert(): Promise<void>;
  };
  harness: ReturnType<typeof makeHarnessModule>;
  log: ReturnType<typeof makeLogModule>;
  metric: ReturnType<typeof makeMetricModule>;
  registry: ModuleRegistry;
};

async function main(argv: readonly string[]): Promise<number> {
  const { filepath, fix } = parseArgs(argv);

  if (filepath === undefined) {
    process.stderr.write("Missing script path.\n");
    return 1;
  }

  return await runExampleFile(filepath, { fix });
}

export async function runExampleFile(
  filepath: string,
  options: RunExampleFileOptions = {}
): Promise<number> {
  const brokenPipe = createBrokenPipeState();
  const stdout = createSafeOutputStream(options.stdout ?? process.stdout, brokenPipe);
  const stderr = createSafeOutputStream(options.stderr ?? process.stderr, brokenPipe);
  const readMarkdownFile = options.readFile ?? readFile;
  const writeMarkdownFile = options.writeFile ?? writeFile;

  return withBrokenPipeGuard(
    [options.stdout ?? process.stdout, options.stderr ?? process.stderr],
    brokenPipe,
    async () => {
      try {
        const rawSource = await readMarkdownFile(filepath, "utf8");
        const loaded = loadExecutableSource(rawSource);
        const { frontmatter, hasScriptBlock } = loaded;
        let executableSource = loaded.executableSource;
        const meta = {
          filepath,
          kind: frontmatter.kind,
          version: frontmatter.version
        };
        const runtime = createExampleRuntime(frontmatter, meta, stdout);

        if (!hasScriptBlock) {
          const returnValue = await runDemoFallback(frontmatter, runtime);
          stdout.write(`${JSON.stringify({ ok: true, returnValue })}\n`);
          return 0;
        }

        const lintOptions = {
          allowedExportNames: ["schema"],
          filename: filepath,
          modules: createLintModulesFromRuntimeRegistry(runtime.registry)
        };
        const lintResult = options.fix
          ? lint(executableSource, { ...lintOptions, fix: true, fixRanges: loaded.fixRanges })
          : lint(executableSource, lintOptions);
        const diagnostics = Array.isArray(lintResult) ? lintResult : lintResult.diagnostics;

        if (!Array.isArray(lintResult)) {
          executableSource = lintResult.fixed;
          if (lintResult.fixed !== loaded.executableSource) {
            await writeMarkdownFile(
              filepath,
              replaceExecutableSource(rawSource, loaded, lintResult.fixes),
              {
                encoding: "utf8"
              }
            );
          }
        }
        const lintErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

        if (lintErrors.length > 0) {
          stderr.write(`Lint failed:\n${formatDiagnostics(lintErrors)}\n`);
          return brokenPipe.closed ? 0 : 1;
        }

        const lintWarnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
        if (lintWarnings.length > 0) {
          stderr.write(`Lint warnings:\n${formatDiagnostics(lintWarnings)}\n`);
          if (brokenPipe.closed) {
            return 0;
          }
        }

        const result = await run(executableSource, {
          entryPointArgs: hasDefaultExport(executableSource, filepath) ? [] : undefined,
          filename: filepath,
          modules: runtime.registry
        });

        if (brokenPipe.closed) {
          return 0;
        }

        if (!result.ok) {
          stderr.write(`${readErrorMessage(result.error)}\n`);
          return brokenPipe.closed ? 0 : 1;
        }

        stdout.write(`${JSON.stringify({ ok: true, returnValue: result.returnValue })}\n`);
        return 0;
      } catch (error) {
        if (brokenPipe.closed) {
          return 0;
        }
        stderr.write(`${readErrorMessage(error)}\n`);
        return brokenPipe.closed ? 0 : 1;
      }
    }
  );
}

function loadExecutableSource(source: string): {
  sourceOffset: number;
  fixRanges: readonly Fix["range"][];
  executableSource: string;
  frontmatter: Record<string, unknown>;
  hasScriptBlock: boolean;
} {
  const { frontmatter, body } = splitFrontmatter(source);
  const bodyStartOffset = source.length - body.length;
  const executableBlock = extractBlock(body, countLineBreaks(source, 0, bodyStartOffset) + 1);
  const hasScriptBlock = executableBlock.source !== body || executableBlock.lineOffset !== 1;
  return {
    sourceOffset: 0,
    fixRanges: executableBlock.ranges.map(([start, end]) => [
      bodyStartOffset + start,
      bodyStartOffset + end
    ]),
    executableSource:
      maskSource(source.slice(0, bodyStartOffset + executableBlock.startOffset)) +
      executableBlock.source,
    frontmatter,
    hasScriptBlock
  };
}

function replaceExecutableSource(
  source: string,
  loaded: ReturnType<typeof loadExecutableSource>,
  fixes: readonly Fix[]
): string {
  return fixes.reduce(
    (result, fix) =>
      `${result.slice(0, loaded.sourceOffset + fix.range[0])}${fix.replacement}${result.slice(loaded.sourceOffset + fix.range[1])}`,
    source
  );
}

function parseArgs(argv: readonly string[]): { filepath: string | undefined; fix: boolean } {
  let fix = false;
  let filepath: string | undefined;

  for (const arg of argv) {
    if (arg === "--fix") {
      fix = true;
      continue;
    }

    if (filepath !== undefined) {
      return { filepath: undefined, fix };
    }
    filepath = arg;
  }

  return { filepath, fix };
}

function createExampleRuntime(
  frontmatter: Record<string, unknown>,
  meta: HarnessMeta,
  stdout: CliStream
): ExampleRuntime {
  const state = createExampleState();
  const harness = makeHarnessModule(frontmatter, meta);
  const agent = makeAgentModule(async (input) => {
    state.spawnCount += 1;

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: `${input.agent} handled ${summarizePrompt(input.prompt)}`,
      durationMs: 25 * state.spawnCount
    };
  });
  const fail = makeFailModule().default;
  const log = makeLogModule((entry) => {
    stdout.write(`${JSON.stringify(normalizeLogEntry(entry))}\n`);
  });
  const git = {
    async checkpoint() {
      state.checkpointCount += 1;
      return {
        head: `head-${state.commitCount}`,
        stashRef: `savepoint-${state.checkpointCount}`
      };
    },
    async commit() {
      state.commitCount += 1;
      return `commit-${state.commitCount}`;
    },
    async revert() {
      state.revertCount += 1;
    }
  };
  const metric = makeMetricModule(async (scriptName) => `${readMetricScore(scriptName, state)}\n`);
  const registry = createExampleRegistry({
    agent,
    fail,
    git,
    harness,
    log,
    metric
  });

  return {
    agent,
    fail,
    git,
    harness,
    log,
    metric,
    registry
  };
}

function createExampleRegistry(modules: Omit<ExampleRuntime, "registry">): ModuleRegistry {
  return {
    agent: toModuleExports(modules.agent),
    fail: toModuleExports(new Map([["default", modules.fail]])),
    git: toModuleExports(
      new Map<string, unknown>([
        ["checkpoint", modules.git.checkpoint],
        ["commit", modules.git.commit],
        ["revert", modules.git.revert]
      ])
    ),
    harness: toModuleExports(modules.harness),
    log: toModuleExports(modules.log),
    metric: toModuleExports(modules.metric)
  };
}

async function runDemoFallback(
  frontmatter: Record<string, unknown>,
  runtime: ExampleRuntime
): Promise<unknown> {
  if (frontmatter.kind === "pipeline" || frontmatter.kind === "pipeline-demo") {
    return await runPipelineExample(runtime);
  }

  if (frontmatter.kind === "superintendent" || frontmatter.kind === "superintendent-demo") {
    return await runSuperintendentExample(runtime);
  }

  if (frontmatter.kind === "experiment" || frontmatter.kind === "experiment-demo") {
    return await runExperimentExample(runtime);
  }

  throw new Error(`Unsupported demo kind: ${String(frontmatter.kind)}`);
}

async function runPipelineExample(runtime: ExampleRuntime): Promise<{
  kind: unknown;
  taskIds: string[];
}> {
  const tasks = Array.isArray(runtime.harness.tasks) ? runtime.harness.tasks : [];
  const agents = readRecord(runtime.harness.agents, "agents");
  const builder = agents.builder;
  const reviewer = agents.reviewer;

  if (builder === undefined || reviewer === undefined) {
    throw new Error("Pipeline example requires builder and reviewer agents.");
  }

  const taskIds: string[] = [];

  for (const task of tasks) {
    const record = readRecord(task, "task");
    const id = readString(record.id, "task.id");
    const title = readString(record.title, "task.title");
    const prompt = readString(record.prompt, "task.prompt");

    runtime.log.event("task.started", { id, title });
    const build = await runtime.agent.spawn(builder as Parameters<typeof runtime.agent.spawn>[0], {
      prompt: `${id}: ${title}\n\n${prompt}`
    });
    const review = await runtime.agent.spawn(
      reviewer as Parameters<typeof runtime.agent.spawn>[0],
      {
        prompt: `Review ${id}\n\n${build.summary}`
      }
    );
    runtime.log.info(id, build.summary, review.summary);
    runtime.log.event("task.completed", { id });
    taskIds.push(id);
  }

  return {
    kind: runtime.harness.meta.kind,
    taskIds
  };
}

async function runSuperintendentExample(runtime: ExampleRuntime): Promise<{
  inspectors: number;
  kind: unknown;
  rounds: number;
}> {
  const agents = readRecord(runtime.harness.agents, "agents");
  const builder = readPresent(agents.builder, "agents.builder");
  const judge = readPresent(agents.judge, "agents.judge");
  const ownerAgent = readPresent(agents.owner, "agents.owner");
  const inspectors = [agents.security, agents.perf, agents.tests].filter(
    (agent) => agent !== undefined
  );
  const frontmatter = readRecord(runtime.harness.meta.frontmatter, "frontmatter");
  const maxRounds = readNumber(frontmatter.max_rounds, "frontmatter.max_rounds");

  if (inspectors.length !== 3) {
    throw new Error("Superintendent example requires security, perf, and tests inspectors.");
  }

  for (let round = 0; round < maxRounds; round += 1) {
    const builderRun = await runtime.agent.spawn(
      builder as Parameters<typeof runtime.agent.spawn>[0],
      {
        prompt: `Round ${round + 1}: continue from the current plan state.`
      }
    );
    const reports = await Promise.all(
      inspectors.map(
        async (inspector) =>
          await runtime.agent.spawn(inspector as Parameters<typeof runtime.agent.spawn>[0], {
            prompt: `Inspect round ${round + 1}\n\n${builderRun.summary}`
          })
      )
    );
    const verdict = await runtime.agent.spawn(judge as Parameters<typeof runtime.agent.spawn>[0], {
      prompt: `Judge round ${round + 1}\n\n${reports.map((report) => report.summary).join("\n")}`
    });
    const owner = await runtime.agent.spawn(
      ownerAgent as Parameters<typeof runtime.agent.spawn>[0],
      {
        prompt: verdict.summary
      }
    );

    runtime.log.event("round.completed", {
      round: round + 1,
      owner: owner.summary
    });

    return {
      kind: runtime.harness.meta.kind,
      rounds: round + 1,
      inspectors: reports.length
    };
  }

  return runtime.fail(`max rounds (${maxRounds}) reached without approval`);
}

async function runExperimentExample(runtime: ExampleRuntime): Promise<{
  baseline: number;
  kept: number;
  kind: unknown;
}> {
  const agents = readRecord(runtime.harness.agents, "agents");
  const experimenter = readPresent(agents.experimenter, "agents.experimenter");
  const frontmatter = readRecord(runtime.harness.meta.frontmatter, "frontmatter");
  const metricConfig = readRecord(frontmatter.metric, "frontmatter.metric");
  const metricName = readString(metricConfig.name, "frontmatter.metric.name");
  const maxKept = readNumber(frontmatter.maxKept, "frontmatter.maxKept");
  const baseline = await runtime.metric.run(metricName);
  const attempts: Array<{
    attempt: number;
    event: string;
    score: number;
  }> = [];
  let kept = 0;

  while (kept < maxKept) {
    const savepoint = await runtime.git.checkpoint();
    const attemptNumber = attempts.length + 1;
    const result = await runtime.agent.spawn(
      experimenter as Parameters<typeof runtime.agent.spawn>[0],
      {
        prompt: `Attempt ${attemptNumber}\n\n${summarizeAttempts(attempts)}`
      }
    );
    const score = await runtime.metric.run(metricName);

    if (score >= baseline) {
      await runtime.git.commit();
      kept += 1;
      attempts.push({
        event: "kept",
        attempt: attemptNumber,
        score
      });
      runtime.log.event("attempt.kept", {
        attempt: attemptNumber,
        score,
        summary: result.summary
      });
      continue;
    }

    await runtime.git.revert();
    runtime.log.event("attempt.discarded", {
      attempt: attemptNumber,
      head: savepoint.head,
      score
    });
    attempts.push({
      event: "discarded",
      attempt: attemptNumber,
      score
    });
  }

  return {
    kind: runtime.harness.meta.kind,
    kept,
    baseline
  };
}

function createExampleState(): {
  checkpointCount: number;
  commitCount: number;
  revertCount: number;
  spawnCount: number;
  metricCalls: Map<string, number>;
} {
  return {
    checkpointCount: 0,
    commitCount: 0,
    revertCount: 0,
    spawnCount: 0,
    metricCalls: new Map()
  };
}

function readMetricScore(
  scriptName: string,
  state: {
    metricCalls: Map<string, number>;
  }
): number {
  const callCount = (state.metricCalls.get(scriptName) ?? 0) + 1;
  state.metricCalls.set(scriptName, callCount);

  if (scriptName === "metric:tests") {
    if (callCount === 1) {
      return 10;
    }

    if (callCount === 2) {
      return 9;
    }
  }

  return 9 + callCount;
}

function normalizeLogEntry(entry: LogModuleEntry): LogModuleEntry {
  return {
    ...entry,
    ts: "2026-04-29T00:00:00.000Z"
  };
}

function summarizePrompt(prompt: string): string {
  const normalizedPrompt = prompt.trim().replaceAll("\n", " ");
  return normalizedPrompt.length <= 48 ? normalizedPrompt : `${normalizedPrompt.slice(0, 45)}...`;
}

function summarizeAttempts(
  attempts: Array<{
    attempt: number;
    event: string;
    score: number;
  }>
): string {
  return attempts
    .map((attempt) => `${attempt.event}:${attempt.attempt}:${attempt.score}`)
    .join("\n");
}

function toModuleExports(value: unknown): ModuleExports {
  return value as ModuleExports;
}

function formatDiagnostics(diagnostics: ReturnType<typeof lint>): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}`
    )
    .join("\n");
}

function hasDefaultExport(source: string, filename: string): boolean {
  return parseModule(source, filename).body.some(
    (statement) => statement.type === "ExportDefaultDeclaration"
  );
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readPresent<TValue>(value: TValue | undefined, label: string): TValue {
  if (value === undefined) {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "message") &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return String(error);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
