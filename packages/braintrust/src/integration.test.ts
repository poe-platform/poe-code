import type {
  AcpEvent,
  AcpSpawnContext as SpawnContext,
} from "@poe-code/agent-spawn";
import type { TaskCompletion, TaskProgress } from "@poe-code/pipeline";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SpanRecord {
  id: number;
  parentId: number | undefined;
  name: string;
  type: "task" | "tool";
  event?: unknown;
  logs: unknown[];
  ended: boolean;
}

const mockBraintrust = vi.hoisted(() => {
  type SpanType = "task" | "tool";
  type RecordShape = {
    id: number;
    parentId: number | undefined;
    name: string;
    type: SpanType;
    event?: unknown;
    logs: unknown[];
    ended: boolean;
  };
  type StubShape = {
    record: RecordShape;
    startSpan(args: {
      name: string;
      type: SpanType;
      event?: unknown;
    }): StubShape;
    log(event: unknown): void;
    end(): void;
  };

  const records: RecordShape[] = [];
  const spans = new Map<number, StubShape>();
  let nextId = 1;
  let current: StubShape | undefined;

  function createSpan(args: {
    name: string;
    type: SpanType;
    event?: unknown;
    parentId?: number;
  }): StubShape {
    const record: RecordShape = {
      id: nextId,
      parentId: args.parentId,
      name: args.name,
      type: args.type,
      event: args.event,
      logs: [],
      ended: false,
    };
    nextId += 1;
    records.push(record);

    const span: StubShape = {
      record,
      startSpan(childArgs) {
        const child = createSpan({
          ...childArgs,
          parentId: record.id,
        });
        current = child;
        return child;
      },
      log(event) {
        record.logs.push(event);
      },
      end() {
        record.ended = true;
        if (current?.record.id === record.id) {
          current = record.parentId === undefined
            ? undefined
            : spans.get(record.parentId);
        }
      },
    };

    spans.set(record.id, span);
    return span;
  }

  return {
    records,
    initLogger: vi.fn(),
    initExperiment: vi.fn(),
    flush: vi.fn(),
    traced: vi.fn(),
    currentSpan: vi.fn(() => current),
    reset() {
      records.length = 0;
      spans.clear();
      nextId = 1;
      current = undefined;
      this.initLogger.mockReset();
      this.initExperiment.mockReset();
      this.flush.mockReset();
      this.currentSpan.mockClear();
      this.traced.mockReset();
      this.initLogger.mockReturnValue({ logger: "root" });
      this.traced.mockImplementation(
        async (
          fn: () => Promise<unknown>,
          args: { name: string; type: SpanType; event?: unknown },
        ) => {
          const previous = current;
          const root = createSpan(args);
          current = root;

          try {
            return await fn();
          } finally {
            root.end();
            current = previous;
          }
        },
      );
    },
  };
});

vi.mock("braintrust", () => ({
  initLogger: mockBraintrust.initLogger,
  initExperiment: mockBraintrust.initExperiment,
  flush: mockBraintrust.flush,
  traced: mockBraintrust.traced,
  currentSpan: mockBraintrust.currentSpan,
}));

describe("Braintrust integration", () => {
  beforeEach(() => {
    vi.resetModules();
    mockBraintrust.reset();
  });

  it("traces a pipeline run through bootstrap, pipeline callbacks, and spawn middleware", async () => {
    const { bootstrap } = await import("./index.js");
    const integrations = await bootstrap({
      enabled: true,
      apiKey: "key",
      project: "project",
    });
    expect(integrations).not.toBeNull();

    const spawnRuns: Promise<void>[] = [];
    const onTaskStart = (progress: TaskProgress): void => {
      integrations?.pipelineCallbacks?.onTaskStart?.(progress);
      spawnRuns.push((async () => {
        await nextTick();
        await integrations?.spawnMiddleware?.(
          createSpawnContext(progress, progress.taskIndex === 0
            ? ["read", "execute"]
            : ["search"]),
          async () => undefined,
        );
      })());
    };
    const onTaskComplete = (completion: TaskCompletion): void => {
      integrations?.pipelineCallbacks?.onTaskComplete?.(completion);
    };

    await integrations?.traceRun("pipeline", "demo", async () => {
      const first = createTaskProgress(0);
      onTaskStart(first);
      await drain(spawnRuns);
      onTaskComplete(createTaskCompletion(first));
      await nextTick();

      const second = createTaskProgress(1);
      onTaskStart(second);
      await drain(spawnRuns);
      onTaskComplete(createTaskCompletion(second));
      await nextTick();
    });

    const spans = mockBraintrust.records as SpanRecord[];
    expectTree(spans);

    const firstAgent = findSpan(spans, "agent:codex:gpt-5");
    expect(firstAgent.logs).toContainEqual(expect.objectContaining({
      metrics: {
        prompt_tokens: 11,
        completion_tokens: 7,
        tokens: 18,
        prompt_cached_tokens: 3,
      },
    }));
  });
});

function expectTree(spans: SpanRecord[]): void {
  const root = findSpan(spans, "pipeline:demo");
  expect(root).toMatchObject({
    parentId: undefined,
    type: "task",
    event: {
      tags: ["surface:pipeline"],
    },
  });

  const firstStep = findSpan(spans, "step:build:0");
  const secondStep = findSpan(spans, "step:build:1");
  expect(firstStep).toMatchObject({ parentId: root.id, type: "task" });
  expect(secondStep).toMatchObject({ parentId: root.id, type: "task" });

  const firstAgent = childSpans(spans, firstStep, "agent:codex:gpt-5")[0];
  const secondAgent = childSpans(spans, secondStep, "agent:codex:gpt-5")[0];
  expect(firstAgent).toMatchObject({ type: "task" });
  expect(secondAgent).toMatchObject({ type: "task" });

  expect(childSpans(spans, firstAgent).map((span) => ({
    name: span.name,
    type: span.type,
  }))).toEqual([
    { name: "tool_call:read", type: "tool" },
    { name: "tool_call:execute", type: "tool" },
  ]);
  expect(childSpans(spans, secondAgent).map((span) => ({
    name: span.name,
    type: span.type,
  }))).toEqual([
    { name: "tool_call:search", type: "tool" },
  ]);
}

function findSpan(spans: SpanRecord[], name: string): SpanRecord {
  const span = spans.find((candidate) => candidate.name === name);
  expect(span).toBeDefined();
  return span as SpanRecord;
}

function childSpans(
  spans: SpanRecord[],
  parent: SpanRecord,
  name?: string,
): SpanRecord[] {
  return spans.filter((span) =>
    span.parentId === parent.id && (name === undefined || span.name === name)
  );
}

function createTaskProgress(taskIndex: number): TaskProgress {
  return {
    taskId: `task-${taskIndex}`,
    taskTitle: `Task ${taskIndex}`,
    stepName: "build",
    taskIndex,
    totalTasks: 2,
    stepIndex: taskIndex,
    totalSteps: 2,
  };
}

function createTaskCompletion(progress: TaskProgress): TaskCompletion {
  return {
    ...progress,
    durationMs: 25,
    success: true,
    usage: {
      inputTokens: 2,
      outputTokens: 3,
    },
  };
}

function createSpawnContext(
  progress: TaskProgress,
  toolKinds: string[],
): SpawnContext {
  return {
    sessionId: `session-${progress.taskIndex}`,
    agent: "codex",
    model: "gpt-5",
    prompt: progress.taskTitle,
    mode: "edit",
    cwd: "/repo",
    threadId: `thread-${progress.taskIndex}`,
    events: createToolEvents(toolKinds),
    usage: {
      inputTokens: 11,
      outputTokens: 7,
      cachedTokens: 3,
    },
  };
}

function createToolEvents(toolKinds: string[]): AcpEvent[] {
  return toolKinds.flatMap((kind, index) => {
    const toolCallId = `${kind}-${index}`;
    return [
      {
        sessionUpdate: "tool_call",
        toolCallId,
        title: kind,
        kind,
        input: { value: index },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        content: [{ type: "text", text: `${kind} output` }],
      },
    ] as unknown as AcpEvent[];
  });
}

async function drain(promises: Promise<void>[]): Promise<void> {
  await Promise.all(promises.splice(0));
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
