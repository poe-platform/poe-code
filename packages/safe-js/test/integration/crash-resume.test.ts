import { describe, expect, it } from "vitest";
import { Budget } from "../../src/interp/budget.js";
import { declareHostOperation } from "../../src/interp/host-bridge.js";
import { parseModule, type ParseResult } from "../../src/parse/parser.js";
import type { SafeJSSnapshot } from "../../src/restore.js";
import type { RunResult, RunSnapshot } from "../../src/run.js";
import type { SnapshotBackend } from "../../src/snapshot/backend.js";
import type { RuntimePendingPromise, RuntimeSnapshotValue } from "../../src/snapshot/serialize.js";

const { restore } = await import("../../src/restore.js");
const { run } = await import("../../src/run.js");
const { serializeSafeJSSnapshot } = await import("../../src/snapshot/dump-format.js");
const { registerPendingHostCallPolicy } = await import("../../src/snapshot/policy.js");
const { restore: restoreInterpreterSnapshot } = await import("../../src/snapshot/restore.js");
const { serialize } = await import("../../src/snapshot/serialize.js");

describe("crash and resume integration", () => {
  it("resumes from an await boundary without duplicating or skipping work", async () => {
    const source = [
      "const output = [];",
      'output.push("before");',
      "await Promise.resolve();",
      'output.push("after");',
      "return JSON.stringify(output);"
    ].join("\n");

    await expectCrashResumeMatchesUninterrupted(source, (snapshot) =>
      hasBinding(snapshot, "output", ["before"])
    );
  });

  it("resumes from a loop iteration without duplicating or skipping work", async () => {
    const source = [
      "const output = [];",
      "for (let index = 0; index < 5; index = index + 1) {",
      "  output.push(index);",
      "}",
      "return JSON.stringify(output);"
    ].join("\n");

    await expectCrashResumeMatchesUninterrupted(
      source,
      (snapshot) => hasBinding(snapshot, "index", 2),
      { snapshotIndexWhenMultiple: 0 }
    );
  });

  it("resumes from a generator yield without duplicating or skipping work", async () => {
    const source = [
      "const output = [];",
      "function* values() { yield 1; yield 2; yield 3; }",
      "const iterator = values();",
      "output.push(iterator.next().value);",
      "output.push(iterator.next().value);",
      "output.push(iterator.next().value);",
      "return JSON.stringify(output);"
    ].join("\n");

    await expectCrashResumeMatchesUninterrupted(source, (snapshot) =>
      hasSuspendedGenerator(snapshot, "iterator", 1)
    );
  });

  it("resumes a loop after an await in the middle of an iteration", async () => {
    const source = [
      "const output = [];",
      "for (let index = 0; index < 3; index = index + 1) {",
      '  output.push("start:".concat(index));',
      "  await Promise.resolve();",
      '  output.push("end:".concat(index));',
      "}",
      "return JSON.stringify(output);"
    ].join("\n");

    await expectCrashResumeMatchesUninterrupted(source, (snapshot) =>
      hasBinding(snapshot, "output", ["start:0", "end:0", "start:1"])
    );
  });

  it("resumes a generator pulled inside an awaiting loop", async () => {
    const source = [
      "const output = [];",
      "function* values() { yield 1; yield 2; yield 3; }",
      "const iterator = values();",
      "for (let index = 0; index < 3; index = index + 1) {",
      "  output.push(iterator.next().value);",
      "  await Promise.resolve();",
      "}",
      "return JSON.stringify(output);"
    ].join("\n");

    await expectCrashResumeMatchesUninterrupted(source, (snapshot) =>
      hasBinding(snapshot, "output", [1, 2])
    );
  });

  it("resumes nested loops with an inner generator", async () => {
    const source = [
      "const output = [];",
      "function* values(offset) { yield offset; yield offset + 1; }",
      "for (let outer = 0; outer < 2; outer = outer + 1) {",
      "  const iterator = values(outer * 10);",
      "  for (const value of iterator) {",
      "    output.push(value);",
      "  }",
      "}",
      "return JSON.stringify(output);"
    ].join("\n");

    await expectCrashResumeMatchesUninterrupted(source, (snapshot) =>
      hasBinding(snapshot, "output", [0, 1, 10])
    );
  });

  it("runs finally exactly once when the crash lands after the await", async () => {
    const source = [
      "const output = [];",
      "try {",
      "  await Promise.resolve();",
      '  output.push("body");',
      "  for (let index = 0; index < 1; index = index + 1) {",
      '    output.push("inner");',
      "  }",
      "} finally {",
      '  output.push("finally");',
      "}",
      "return JSON.stringify(output);"
    ].join("\n");

    await expectCrashResumeMatchesUninterrupted(source, (snapshot) =>
      hasBinding(snapshot, "output", ["body"])
    );
  });

  it("replays a recorded iteration error instead of retrying the failed operation", async () => {
    const source = [
      "const output = [];",
      "for (let index = 0; index < 4; index = index + 1) {",
      "  output.push(index);",
      "  if (index === 2) { await crash(); }",
      "}",
      "return JSON.stringify(output);"
    ].join("\n");
    const backend = new MemorySnapshotBackend();
    const originalDateNow = Date.now;
    let now = 0;
    Date.now = () => (now += 2);

    try {
      await expect(
        run(source, {
          bindings: {
            crash: async () => {
              throw new Error("process crashed");
            }
          },
          snapshotBackend: backend,
          snapshotIntervalMs: 1
        })
      ).rejects.toThrow("process crashed");
    } finally {
      Date.now = originalDateNow;
    }

    expect(backend.snapshots.some((snapshot) => hasBinding(snapshot, "output", [0]))).toBe(true);
    const lastGaspSnapshot = backend.snapshots.at(-1);
    expect(lastGaspSnapshot).toBeDefined();
    expect(lastGaspSnapshot).toSatisfy((snapshot: RunSnapshot) =>
      hasBinding(snapshot, "output", [0, 1, 2])
    );

    let resumedCalls = 0;
    await expect(
      run(source, {
        bindings: {
          crash: async () => {
            resumedCalls += 1;
          }
        },
        snapshot: restore(lastGaspSnapshot!, { source })
      })
    ).rejects.toThrow("process crashed");
    expect(resumedCalls).toBe(0);
  });

  it("re-issues an idempotent pending host call after restore", async () => {
    const read = createHostStub("re-issue", ["first", "first"]);
    const snapshot = createPendingHostCallSnapshot({
      callId: "storage-read-1",
      moduleId: "storage",
      operation: "read"
    });

    await read.operation();
    const resumedValue = await resumePendingHostCall(snapshot, {
      read: read.operation
    });

    expect(resumedValue).toBe("first");
    expect(read.calls()).toBe(2);
  });

  it("reads a recorded effect without invoking the effectful host call again", async () => {
    const commit = createHostStub("read-side-effect", ["commit-1"]);
    const recordedEffects = new Map<string, RuntimeSnapshotValue>();
    recordedEffects.set("effects-commit-1", await commit.operation());
    const snapshot = createPendingHostCallSnapshot({
      callId: "effects-commit-1",
      moduleId: "effects",
      operation: "commit",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "effects-commit-1",
        moduleId: "effects",
        operation: "commit"
      }
    });

    const resumedValue = await resumePendingHostCall(
      snapshot,
      { commit: commit.operation },
      recordedEffects
    );

    expect(resumedValue).toBe("commit-1");
    expect(commit.calls()).toBe(1);
  });

  it("documents that a non-deterministic re-issued call can diverge", async () => {
    const read = createHostStub("re-issue", ["before-crash", "after-crash"]);
    const snapshot = createPendingHostCallSnapshot({
      callId: "storage-read-2",
      moduleId: "storage",
      operation: "read"
    });

    const originalValue = await read.operation();
    const resumedValue = await resumePendingHostCall(snapshot, {
      read: read.operation
    });

    expect(originalValue).toBe("before-crash");
    expect(resumedValue).toBe("after-crash");
    expect(resumedValue).not.toBe(originalValue);
  });
});

class MemorySnapshotBackend implements SnapshotBackend {
  readonly snapshots: RunSnapshot[] = [];

  async read(): Promise<RunSnapshot | undefined> {
    return this.snapshots.at(-1);
  }

  async write(snapshot: SafeJSSnapshot): Promise<void> {
    this.snapshots.push(JSON.parse(serializeSafeJSSnapshot(snapshot)) as RunSnapshot);
  }

  async remove(): Promise<void> {
    this.snapshots.length = 0;
  }
}

async function expectCrashResumeMatchesUninterrupted(
  source: string,
  selectSnapshot: (snapshot: RunSnapshot) => boolean,
  options: { snapshotIndexWhenMultiple?: number } = {}
): Promise<void> {
  const uninterrupted = await expectSuccessfulRun(run(source));
  const backend = new MemorySnapshotBackend();
  const originalDateNow = Date.now;
  let now = 0;
  Date.now = () => (now += 2);

  try {
    await expectSuccessfulRun(
      run(source, {
        snapshotBackend: backend,
        snapshotIntervalMs: 1
      })
    );
  } finally {
    Date.now = originalDateNow;
  }

  const matchingSnapshots = backend.snapshots.filter(selectSnapshot);
  const snapshot = matchingSnapshots[options.snapshotIndexWhenMultiple ?? 0];
  expect(snapshot, "expected the run to persist the selected crash snapshot").toBeDefined();

  const resumed = await expectSuccessfulRun(
    run(source, {
      snapshot: restore(snapshot!, { source })
    })
  );

  expect(JSON.stringify(resumed.returnValue)).toBe(JSON.stringify(uninterrupted.returnValue));
}

async function expectSuccessfulRun(result: Promise<RunResult>) {
  const completed = await result;
  expect(completed.ok).toBe(true);
  if (!completed.ok) {
    throw new Error(completed.error.message);
  }
  return completed;
}

function hasBinding(snapshot: RunSnapshot, name: string, expected: unknown): boolean {
  return JSON.stringify(snapshot.bindings[name]) === JSON.stringify(expected);
}

function hasSuspendedGenerator(snapshot: RunSnapshot, name: string, outputLength: number): boolean {
  const generator = snapshot.bindings[name] as { state?: string } | undefined;
  const output = snapshot.bindings.output as unknown[] | undefined;
  return generator?.state === "suspended" && output?.length === outputLength;
}

function createHostStub(policy: "read-side-effect" | "re-issue", results: string[]) {
  let callCount = 0;
  const operation = declareHostOperation(async () => {
    const result = results[callCount];
    callCount += 1;
    if (result === undefined) {
      throw new Error("Host stub has no configured result.");
    }
    return result;
  }, policy);

  return {
    calls: () => callCount,
    operation,
    policy
  };
}

function createPendingHostCallSnapshot(input: {
  callId: string;
  moduleId: string;
  operation: string;
  sideEffectTag?: {
    kind: "host-call-side-effect";
    callId: string;
    moduleId: string;
    operation: string;
  };
}) {
  const source = "await pending";
  const awaitNodeId = findNodeId(parseModule(source), "AwaitExpression");
  const pendingPromise: RuntimePendingPromise = {
    id: input.callId,
    moduleId: input.moduleId,
    operation: input.operation,
    ...(input.sideEffectTag === undefined ? {} : { sideEffectTag: input.sideEffectTag })
  };
  registerPendingHostCallPolicy({
    moduleId: input.moduleId,
    operation: input.operation,
    policy: input.sideEffectTag === undefined ? "re-issue" : "read-side-effect"
  });

  return serialize({
    source,
    currentAstNodeId: awaitNodeId,
    scopeChain: [
      {
        id: "root",
        bindings: {
          pending: {
            kind: "promise",
            id: input.callId
          }
        }
      }
    ],
    callStack: [
      {
        astNodeId: awaitNodeId,
        scopeId: "root",
        awaitingPromiseId: input.callId
      }
    ],
    pendingPromises: [pendingPromise],
    moduleBindings: {}
  });
}

async function resumePendingHostCall(
  snapshot: ReturnType<typeof createPendingHostCallSnapshot>,
  operations: Record<string, () => Promise<string>>,
  recordedEffects = new Map<string, RuntimeSnapshotValue>()
) {
  const restored = restoreInterpreterSnapshot(snapshot, {
    budget: new Budget(),
    source: "await pending"
  });
  const pendingCall = restored.pendingPromises[0];
  if (pendingCall === undefined) {
    throw new Error("Expected a pending host call.");
  }

  const policy = pendingCall.resumePolicy as
    | { kind: "re-issue" }
    | { kind: "read-side-effect"; sideEffectTag: { callId: string } };
  if (policy.kind === "read-side-effect") {
    if (!recordedEffects.has(policy.sideEffectTag.callId)) {
      throw new Error(`Missing recorded effect ${policy.sideEffectTag.callId}.`);
    }
    return recordedEffects.get(policy.sideEffectTag.callId);
  }

  const operation = operations[String(pendingCall.operation)];
  if (operation === undefined) {
    throw new Error(`Missing host operation ${String(pendingCall.operation)}.`);
  }
  return operation();
}

function findNodeId(root: ParseResult, type: ParseResult["type"]): number {
  if (root.type === type && root.nodeId !== undefined) {
    return root.nodeId;
  }

  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isParseResult(entry)) {
          const nodeId = findNodeId(entry, type);
          if (nodeId !== -1) {
            return nodeId;
          }
        }
      }
    } else if (isParseResult(value)) {
      const nodeId = findNodeId(value, type);
      if (nodeId !== -1) {
        return nodeId;
      }
    }
  }

  return -1;
}

function isParseResult(value: unknown): value is ParseResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "span" in value
  );
}
