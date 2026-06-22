import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

const { runHarnessPair } = await import("../loader/run.js");

describe("harness recovery e2e", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/snapshots", { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("continues after a crash following the first await and matches a single-run baseline", async () => {
    const harness = createHarness(
      "after-first-await",
      [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  const first = await step('first');",
        "  const second = await step('second');",
        "  return first.concat('|').concat(second);",
        "};"
      ].join("\n")
    );
    const baseline = await runBaseline(harness.mdPath, {
      async step(name: string) {
        return name === "first" ? "alpha" : "beta";
      }
    });
    const crash = await crashAtPendingCall(harness.mdPath, {
      completed: [["first", "alpha"]],
      pending: "second"
    });

    const resumedCalls: string[] = [];
    const resumed = await resumeHarness(harness.mdPath, {
      async step(name: string) {
        resumedCalls.push(name);
        return "beta";
      }
    });

    expect(crash.calls).toEqual(["first", "second"]);
    expect(resumedCalls).toEqual(["second"]);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: readReturnValue(baseline)
    });
  });

  it("continues a for-of loop from the first uncached iteration after a crash", async () => {
    const harness = createHarness(
      "for-of",
      [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  const output = [];",
        "  for (const value of [1, 2, 3, 4]) {",
        "    output.push(await step(String(value)));",
        "  }",
        "  return JSON.stringify(output);",
        "};"
      ].join("\n")
    );
    const baseline = await runBaseline(harness.mdPath, {
      async step(value: string) {
        return "v".concat(value);
      }
    });
    const crash = await crashAtPendingCall(harness.mdPath, {
      completed: [
        ["1", "v1"],
        ["2", "v2"]
      ],
      pending: "3"
    });

    const resumedCalls: string[] = [];
    const resumed = await resumeHarness(harness.mdPath, {
      async step(value: string) {
        resumedCalls.push(value);
        return "v".concat(value);
      }
    });

    expect(crash.calls).toEqual(["1", "2", "3"]);
    expect(resumedCalls).toEqual(["3", "4"]);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: readReturnValue(baseline)
    });
  });

  it("continues from a try block crash and reaches the original throw and catch", async () => {
    const harness = createHarness(
      "try-catch",
      [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  try {",
        "    await step('before-throw');",
        "    throw Error('boom');",
        "  } catch (error) {",
        "    if (error.message !== 'boom') {",
        "      throw error;",
        "    }",
        "    return 'caught:'.concat(error.message);",
        "  }",
        "};"
      ].join("\n")
    );

    await crashAtPendingCall(harness.mdPath, {
      completed: [],
      pending: "before-throw"
    });

    const resumed = await resumeHarness(harness.mdPath, {
      async step() {
        return "ready";
      }
    });

    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "caught:boom"
    });
  });

  it("re-enters a finally clause without double-executing completed side effects", async () => {
    const harness = createHarness(
      "finally-once",
      [
        'import { cleanup, wait } from "host";',
        "export default async (frontmatter) => {",
        "  try {",
        "    return 'body';",
        "  } finally {",
        "    cleanup('once');",
        "    await wait('cleanup');",
        "  }",
        "};"
      ].join("\n")
    );
    let cleanupCalls = 0;
    const wait = createDeferred<string>();
    const controller = new AbortController();
    const firstRun = runHarnessPair(harness.mdPath, {
      modulesFor: () => ({
        host: {
          cleanup() {
            cleanupCalls += 1;
          },
          async wait() {
            return wait.promise;
          }
        }
      }),
      preserveSnapshotOnSuccess: true,
      signal: controller.signal,
      snapshotIntervalMs: -1,
      snapshotPath: snapshotPath()
    });

    await flushMicrotasks();
    expect(cleanupCalls).toBe(1);
    expect(vol.existsSync(snapshotPath())).toBe(true);

    controller.abort();
    wait.reject(new Error("crashed"));
    await expect(firstRun).rejects.toMatchObject({
      name: "AbortError"
    });

    const resumed = await resumeHarness(harness.mdPath, {
      cleanup() {
        cleanupCalls += 1;
      },
      async wait() {
        return "done";
      }
    });

    expect(cleanupCalls).toBe(1);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "body"
    });
  });

  it("reads cached completed host calls and re-issues the host call pending at crash time", async () => {
    const harness = createHarness(
      "host-call-policy",
      [
        'import { call } from "host";',
        "export default async (frontmatter) => {",
        "  const cached = await call('cached');",
        "  const pending = await call('pending');",
        "  return cached.concat('|').concat(pending);",
        "};"
      ].join("\n")
    );

    await crashAtPendingCall(harness.mdPath, {
      completed: [["cached", "from-cache"]],
      pending: "pending"
    });

    const resumedCalls: string[] = [];
    const resumed = await resumeHarness(harness.mdPath, {
      async call(name: string) {
        resumedCalls.push(name);
        return "from-resume";
      }
    });

    expect(resumedCalls).toEqual(["pending"]);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "from-cache|from-resume"
    });
  });

  it("treats a crash after final return as a no-op restore with the cached value", async () => {
    const harness = createHarness(
      "after-return",
      [
        'import { value } from "host";',
        "export default async (frontmatter) => {",
        "  return await value();",
        "};"
      ].join("\n")
    );
    let hostCalls = 0;
    const firstRun = await runHarnessPair(harness.mdPath, {
      modulesFor: () => ({
        host: {
          async value() {
            hostCalls += 1;
            return "cached-final";
          }
        }
      }),
      preserveSnapshotOnSuccess: true,
      snapshotIntervalMs: -1,
      snapshotPath: snapshotPath()
    });
    expect(firstRun).toMatchObject({
      ok: true,
      returnValue: "cached-final"
    });

    const restored = await resumeHarness(harness.mdPath, {
      async value() {
        hostCalls += 1;
        return "should-not-run";
      }
    });

    expect(hostCalls).toBe(1);
    expect(restored).toMatchObject({
      ok: true,
      returnValue: "cached-final"
    });
  });

  it("resolves two in-flight promises in deterministic order after restore", async () => {
    const harness = createHarness(
      "two-pending",
      [
        'import { later } from "host";',
        "export default async (frontmatter) => {",
        "  const left = (async () => await later('left'))();",
        "  const right = (async () => await later('right'))();",
        "  const values = await Promise.all([left, right]);",
        "  return JSON.stringify(values);",
        "};"
      ].join("\n")
    );
    const baseline = await runBaseline(harness.mdPath, {
      async later(name: string) {
        return name.concat(":done");
      }
    });
    const firstRun = {
      left: createDeferred<string>(),
      right: createDeferred<string>()
    };
    const controller = new AbortController();
    const firstCalls: string[] = [];
    const crashed = runHarnessPair(harness.mdPath, {
      modulesFor: () => ({
        host: {
          async later(name: string) {
            firstCalls.push(name);
            return name === "left" ? firstRun.left.promise : firstRun.right.promise;
          }
        }
      }),
      preserveSnapshotOnSuccess: true,
      signal: controller.signal,
      snapshotIntervalMs: -1,
      snapshotPath: snapshotPath()
    });

    await flushMicrotasks();
    await waitForCall(firstCalls, "right");
    expect(firstCalls).toEqual(["left", "right"]);
    expect(vol.existsSync(snapshotPath())).toBe(true);

    controller.abort();
    firstRun.left.reject(new Error("crashed"));
    firstRun.right.reject(new Error("crashed"));
    await expect(crashed).rejects.toMatchObject({
      name: "AbortError"
    });

    const secondRun = {
      left: createDeferred<string>(),
      right: createDeferred<string>()
    };
    const resumedCalls: string[] = [];
    const resumed = runHarnessPair(harness.mdPath, {
      modulesFor: () => ({
        host: {
          async later(name: string) {
            resumedCalls.push(name);
            return name === "left" ? secondRun.left.promise : secondRun.right.promise;
          }
        }
      }),
      snapshotIntervalMs: -1,
      snapshotPath: snapshotPath()
    });

    await flushMicrotasks();
    expect(resumedCalls).toEqual(["left", "right"]);
    secondRun.right.resolve("right:done");
    secondRun.left.resolve("left:done");

    await expect(resumed).resolves.toMatchObject({
      ok: true,
      returnValue: readReturnValue(baseline)
    });
  });

  it("rejects source hash mismatches without starting a partial run", async () => {
    const harness = createHarness(
      "source-mismatch",
      [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  const first = await step('first');",
        "  const second = await step('second');",
        "  return first.concat('|').concat(second);",
        "};"
      ].join("\n")
    );
    await crashAtPendingCall(harness.mdPath, {
      completed: [["first", "alpha"]],
      pending: "second"
    });
    vol.writeFileSync(
      harness.ajsPath,
      [
        'import { step } from "host";',
        "export default async (frontmatter) => {",
        "  const first = await step('first');",
        "  const second = await step('second');",
        "  return first.concat('|changed|').concat(second);",
        "};"
      ].join("\n")
    );

    const calls: string[] = [];
    await expect(
      resumeHarness(harness.mdPath, {
        async step(name: string) {
          calls.push(name);
          return "partial";
        }
      })
    ).rejects.toThrow("source changed since snapshot was taken");
    expect(calls).toEqual([]);
    expect(vol.existsSync(snapshotPath())).toBe(true);
  });
});

function createHarness(name: string, script: string): { ajsPath: string; mdPath: string } {
  const mdPath = `/repo/harness/${name}.md`;
  const ajsPath = `/repo/harness/${name}.ajs`;
  vol.mkdirSync("/repo/harness", { recursive: true });
  vol.writeFileSync(mdPath, `---\nkind: ${name}\nversion: 1\n---\n`);
  vol.writeFileSync(ajsPath, script);
  return {
    ajsPath,
    mdPath
  };
}

async function runBaseline(
  mdPath: string,
  host: Record<string, (...args: never[]) => unknown>
): Promise<Awaited<ReturnType<typeof runHarnessPair>>> {
  return await runHarnessPair(mdPath, {
    modulesFor: () => ({
      host
    }),
    resume: false,
    snapshotIntervalMs: -1,
    snapshotPath: "/snapshots/baseline.json"
  });
}

async function resumeHarness(
  mdPath: string,
  host: Record<string, (...args: never[]) => unknown>
): Promise<Awaited<ReturnType<typeof runHarnessPair>>> {
  return await runHarnessPair(mdPath, {
    modulesFor: () => ({
      host
    }),
    snapshotIntervalMs: -1,
    snapshotPath: snapshotPath()
  });
}

async function crashAtPendingCall(
  mdPath: string,
  input: {
    completed: Array<[name: string, result: string]>;
    pending: string;
  }
): Promise<{ calls: string[] }> {
  const pending = createDeferred<string>();
  const controller = new AbortController();
  const completed = new Map(input.completed);
  const calls: string[] = [];
  const run = runHarnessPair(mdPath, {
    modulesFor: () => ({
      host: {
        async step(name: string) {
          calls.push(name);
          if (completed.has(name)) {
            return completed.get(name);
          }
          return pending.promise;
        },
        async call(name: string) {
          calls.push(name);
          if (completed.has(name)) {
            return completed.get(name);
          }
          return pending.promise;
        }
      }
    }),
    preserveSnapshotOnSuccess: true,
    signal: controller.signal,
    snapshotIntervalMs: -1,
    snapshotPath: snapshotPath()
  });

  await flushMicrotasks();
  for (const [name] of input.completed) {
    await waitForCall(calls, name);
    await flushMicrotasks();
  }
  await waitForCall(calls, input.pending);
  expect(vol.existsSync(snapshotPath())).toBe(true);

  controller.abort();
  pending.reject(new Error("crashed"));
  await expect(run).rejects.toMatchObject({
    name: "AbortError"
  });

  return {
    calls
  };
}

function readReturnValue(result: Awaited<ReturnType<typeof runHarnessPair>>): unknown {
  if (!result.ok) {
    throw new Error("Expected harness run to succeed.");
  }

  return result.returnValue;
}

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    reject,
    resolve
  };
}

async function waitForCall(calls: readonly string[], name: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (calls.includes(name)) {
      return;
    }
    await flushMicrotasks();
  }

  throw new Error(`Timed out waiting for host call '${name}'.`);
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function snapshotPath(): string {
  return "/snapshots/recovery.json";
}
