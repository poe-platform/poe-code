import * as fs from "node:fs/promises";
import path from "node:path";
import {
  getSpawnConfig,
  spawn,
  spawnAutonomous,
  spawnStreaming,
  type AcpEvent,
  type AutonomousResult,
  type SpawnMode,
  type SpawnOptions,
  type SpawnResult,
  type StreamingSpawnFn
} from "@poe-code/agent-spawn";
import type { EvalDef, JudgeSpec, RubricKey } from "../types.js";
import type { NormalizedTrace } from "./trace/types.js";

type JudgeScores = Record<RubricKey, number> & { mean: number };
type JudgeSpawnResult = AutonomousResult | SpawnResult | string;
type AutonomousSpawnFn = (service: string, options: SpawnOptions) => Promise<AutonomousResult>;

export async function judgeRun(input: {
  evalDef: EvalDef;
  cloneDir: string;
  trace: NormalizedTrace;
  testsResult: { passed: number; total: number };
  spec: JudgeSpec;
  agentUnderTest: string;
}): Promise<JudgeScores> {
  const judgeAgent = input.spec.agent === input.agentUnderTest ? "codex" : input.spec.agent;
  const rubric = [...input.spec.rubric];
  const prompt = await buildJudgePrompt(input, rubric);
  const result = await spawnAutonomous(createJudgeStreamingSpawn(), {
    service: judgeAgent,
    prompt,
    cwd: input.cloneDir,
    model: input.spec.model,
    mode: resolveJudgeMode(judgeAgent)
  });

  return parseJudgeScores(extractFinalText(result), rubric);
}

async function buildJudgePrompt(
  input: {
    evalDef: EvalDef;
    cloneDir: string;
    trace: NormalizedTrace;
    testsResult: { passed: number; total: number };
  },
  rubric: readonly RubricKey[]
): Promise<string> {
  const files = await listFilesWithSizes(input.cloneDir);
  const responseShape = renderResponseShape(rubric);

  return [
    "Judge this completed agent run.",
    "Inspect the working tree with tool calls when needed. Do not rely on file contents in this prompt.",
    "",
    "Task prompt:",
    input.evalDef.plan.body,
    "",
    "Clone files:",
    files.length > 0
      ? files.map((file) => `${file.path}\t${file.bytes} bytes`).join("\n")
      : "(none)",
    "",
    `Tests: ${input.testsResult.passed}/${input.testsResult.total} passed`,
    "Normalized trace JSON:",
    JSON.stringify(input.trace),
    "",
    "Rubric keys:",
    rubric.join("\n"),
    "",
    "Respond with JSON only.",
    `Use exactly this shape: ${responseShape}`,
    "Each n must be a number from 0 to 5."
  ].join("\n");
}

function renderResponseShape(rubric: readonly RubricKey[]): string {
  const entries = rubric.map((key) => `${JSON.stringify(key)}: n`);
  return `{ ${entries.join(", ")} }`;
}

async function listFilesWithSizes(
  cloneDir: string
): Promise<readonly { path: string; bytes: number }[]> {
  const absoluteCloneDir = path.resolve(cloneDir);
  const files: { path: string; bytes: number }[] = [];

  await collectFiles(absoluteCloneDir, absoluteCloneDir, files);

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectFiles(
  rootDir: string,
  currentDir: string,
  files: { path: string; bytes: number }[]
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(rootDir, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    files.push({
      path: path.relative(rootDir, absolutePath),
      bytes: stat.size
    });
  }
}

function createJudgeStreamingSpawn(): StreamingSpawnFn<SpawnOptions, JudgeSpawnResult> {
  const autonomous = (spawn as typeof spawn & { autonomous?: AutonomousSpawnFn }).autonomous;

  if (autonomous) {
    return (service, options) => ({
      events: emptyEvents(),
      result: autonomous(service, options)
    });
  }

  return (service, options) => {
    const handle = spawnStreaming({ ...options, agentId: service });
    const eventsDone = createDeferred<void>();
    let finalText = "";

    const events = (async function* (): AsyncIterable<AcpEvent> {
      try {
        for await (const event of handle.events) {
          if (event.event === "agent_message" && typeof event.text === "string") {
            finalText += event.text;
          }
          yield event;
        }
        eventsDone.resolve();
      } catch (error) {
        eventsDone.reject(error);
        throw error;
      }
    })();

    return {
      events,
      result: (async () => {
        const result = await handle.done;
        await eventsDone.promise;
        return {
          ...result,
          stdout: finalText.length > 0 ? finalText : result.stdout
        };
      })()
    };
  };
}

async function* emptyEvents(): AsyncIterable<never> {}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function resolveJudgeMode(agent: string): SpawnMode {
  const config = getSpawnConfig(agent);
  if (config?.kind === "cli" && Object.hasOwn(config.modes, "read")) {
    return "read";
  }
  return "yolo";
}

function extractFinalText(result: JudgeSpawnResult): string {
  if (typeof result === "string") {
    return result;
  }

  if ("text" in result) {
    return (
      readNonEmptyString(result.text) ??
      readNonEmptyString(result.output) ??
      readNonEmptyString(result.stdout) ??
      readNonEmptyString(result.log) ??
      readNonEmptyString(result.summary) ??
      ""
    );
  }

  return readNonEmptyString(result.stdout) ?? "";
}

function parseJudgeScores(rawOutput: string, rubric: readonly RubricKey[]): JudgeScores {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawOutput.trim());
  } catch (error) {
    throw new Error(`Failed to parse judge output: ${formatUnknownError(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Malformed judge output: expected a JSON object");
  }

  const source = parsed as Record<string, unknown>;
  const scores: Record<string, number> = {};

  for (const key of rubric) {
    scores[key] = clampScore(source[key]);
  }

  const values = Object.values(scores);
  const mean =
    values.length === 0
      ? 0
      : Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;

  return {
    ...scores,
    mean
  } as JudgeScores;
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(5, Math.max(0, value));
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
