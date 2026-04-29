import { readFile } from "node:fs/promises";

import { extractBlock } from "./loader/extract-block.js";
import { splitFrontmatter } from "./loader/frontmatter.js";
import { lint } from "./lint.js";
import { makeAgentModule } from "./modules/agent.js";
import { makeFailModule } from "./modules/fail.js";
import { makeHarnessModule } from "./modules/harness.js";
import { makeLogModule, type LogModuleEntry } from "./modules/log.js";
import { makeMetricModule } from "./modules/metric.js";
import type { ModuleExports, ModuleRegistry } from "./modules/registry.js";

type CliStream = {
  write(chunk: string): void;
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
  const [filepath] = argv;

  if (filepath === undefined) {
    process.stderr.write("Missing script path.\n");
    return 1;
  }

  try {
    const rawSource = await readFile(filepath, "utf8");
    const { frontmatter, executableSource } = loadExecutableSource(rawSource);
    const meta = {
      filepath,
      kind: frontmatter.kind,
      version: frontmatter.version
    };
    const runtime = createExampleRuntime(frontmatter, meta, process.stdout);
    const errors = lint(executableSource, {
      filename: filepath,
      modules: createLintModules(runtime.registry)
    }).filter((diagnostic) => diagnostic.severity === "error");

    if (errors.length > 0) {
      process.stderr.write(
        `${errors
          .map((diagnostic) => `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}`)
          .join("\n")}\n`
      );
      return 1;
    }

    const returnValue = await runExample(frontmatter, runtime);
    process.stdout.write(`${JSON.stringify({ ok: true, returnValue })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${readErrorMessage(error)}\n`);
    return 1;
  }
}

function loadExecutableSource(source: string): {
  executableSource: string;
  frontmatter: Record<string, unknown>;
} {
  const { frontmatter, body } = splitFrontmatter(source);
  const executableBlock = extractBlock(body);

  return {
    executableSource: executableBlock.source,
    frontmatter
  };
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
  const registry = createExampleRegistry(frontmatter.kind, {
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

function createExampleRegistry(
  kind: unknown,
  modules: Omit<ExampleRuntime, "registry">
): ModuleRegistry {
  if (kind === "superintendent") {
    return new Map<string, ModuleExports>([
      ["agent", toModuleExports(new Map(Object.entries(modules.agent)))],
      ["fail", toModuleExports(new Map([["default", modules.fail]]))],
      ["harness", toModuleExports(new Map(Object.entries(modules.harness)))],
      ["log", toModuleExports(new Map(Object.entries(modules.log)))]
    ]);
  }

  if (kind === "experiment") {
    return {
      agent: toModuleExports(modules.agent),
      harness: toModuleExports(new Map(Object.entries(modules.harness))),
      git: toModuleExports(new Map<string, unknown>([
        ["checkpoint", modules.git.checkpoint],
        ["commit", modules.git.commit],
        ["revert", modules.git.revert]
      ])),
      log: toModuleExports(modules.log),
      metric: toModuleExports(modules.metric)
    };
  }

  return {
    agent: toModuleExports(modules.agent),
    harness: toModuleExports(modules.harness),
    log: toModuleExports(modules.log)
  };
}

function createLintModules(modules: ModuleRegistry): Map<string, string[]> {
  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);

  return new Map(
    entries.map(([moduleName, moduleExports]) => [moduleName, listModuleExports(moduleExports)] as const)
  );
}

function listModuleExports(moduleExports: ModuleExports): string[] {
  const exportNames = moduleExports instanceof Map ? [...moduleExports.keys()] : Object.keys(moduleExports);
  return exportNames.filter((exportName) => exportName.length > 0).sort((left, right) => left.localeCompare(right));
}

async function runExample(frontmatter: Record<string, unknown>, runtime: ExampleRuntime): Promise<unknown> {
  if (frontmatter.kind === "pipeline") {
    return await runPipelineExample(runtime);
  }

  if (frontmatter.kind === "superintendent") {
    return await runSuperintendentExample(runtime);
  }

  if (frontmatter.kind === "experiment") {
    return await runExperimentExample(runtime);
  }

  throw new Error(`Unsupported example kind: ${String(frontmatter.kind)}`);
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
    const review = await runtime.agent.spawn(reviewer as Parameters<typeof runtime.agent.spawn>[0], {
      prompt: `Review ${id}\n\n${build.summary}`
    });
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
  const inspectors = [agents.security, agents.perf, agents.tests].filter((agent) => agent !== undefined);
  const frontmatter = readRecord(runtime.harness.meta.frontmatter, "frontmatter");
  const maxRounds = readNumber(frontmatter.max_rounds, "frontmatter.max_rounds");

  if (inspectors.length !== 3) {
    throw new Error("Superintendent example requires security, perf, and tests inspectors.");
  }

  for (let round = 0; round < maxRounds; round += 1) {
    const builderRun = await runtime.agent.spawn(builder as Parameters<typeof runtime.agent.spawn>[0], {
      prompt: `Round ${round + 1}: continue from the current plan state.`
    });
    const reports = await Promise.all(
      inspectors.map(async (inspector) => await runtime.agent.spawn(inspector as Parameters<typeof runtime.agent.spawn>[0], {
        prompt: `Inspect round ${round + 1}\n\n${builderRun.summary}`
      }))
    );
    const verdict = await runtime.agent.spawn(judge as Parameters<typeof runtime.agent.spawn>[0], {
      prompt: `Judge round ${round + 1}\n\n${reports.map((report) => report.summary).join("\n")}`
    });
    const owner = await runtime.agent.spawn(ownerAgent as Parameters<typeof runtime.agent.spawn>[0], {
      prompt: verdict.summary
    });

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
    const result = await runtime.agent.spawn(experimenter as Parameters<typeof runtime.agent.spawn>[0], {
      prompt: `Attempt ${attemptNumber}\n\n${summarizeAttempts(attempts)}`
    });
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
  return attempts.map((attempt) => `${attempt.event}:${attempt.attempt}:${attempt.score}`).join("\n");
}

function toModuleExports(value: unknown): ModuleExports {
  return value as ModuleExports;
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

  return String(error);
}

main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
