import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Budget,
  declareHostOperation,
  dump,
  restore,
  run,
  type HostCallResumeRequest
} from "../src/index.js";
import { runCli } from "../src/cli.js";
import { promiseReplayContext } from "../src/interp/promise-replay.js";
import { hashSource } from "../src/parse/hash.js";
import { parseModule } from "../src/parse/parser.js";
import { EXECUTION_SEMANTICS, serializeSafeJSSnapshot } from "../src/snapshot/dump-format.js";
import { restore as restoreInterpreter } from "../src/snapshot/restore.js";
import { serialize, type RuntimeSnapshotValue } from "../src/snapshot/serialize.js";
import { attachSignalDumpHandler } from "../src/runner/signal-dump.js";
import {
  deferred,
  makeFixture,
  originalScenarios,
  receiptsProvider
} from "./fixtures/ppr2-integration-workflows.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const expectedFresh =
  process.env.SAFEJS_PPR2_ADJUDICATION_PHASE === "ordered" ? "jobs-v6" : "jobs-v8";

afterEach(() => {
  vi.restoreAllMocks();
  vol.reset();
});

describe("independent ordered PPR2 fresh writer continuations", () => {
  it.each(originalScenarios)(
    "$id: native trace, public/signal/completed checkpoints and recapture",
    async (scenario) => {
      const nativeHost = makeFixture(scenario.id, true, scenario.policy);
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
      const nativeExecution = new AsyncFunction(
        ...Object.keys(nativeHost.bindings),
        scenario.source
      )(...Object.values(nativeHost.bindings));
      try {
        await Promise.race([
          nativeHost.entered,
          nativeExecution.then(() => {
            throw Error("Native execution missed pending boundary");
          })
        ]);
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        nativeHost.release();
      }
      const native = await nativeExecution;
      expect(native).toEqual(scenario.expected);
      expect(nativeHost.calls).toEqual(scenario.calls);
      const host = makeFixture(scenario.id, true, scenario.policy);
      const execution = run(scenario.source, {
        bindings: host.bindings,
        budget: new Budget({ maxSteps: 150_000 })
      });
      const captures: string[] = [];
      try {
        await Promise.race([
          host.entered,
          execution.then(() => {
            throw Error("No pending boundary");
          })
        ]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(host.calls).toEqual(scenario.callsAtBoundary);
        expect(() => dump(execution)).toThrow(expect.objectContaining({ code: "reentry" }));
        captures.push(await dump(execution, { mode: "replay" }));
        const signals = new EventEmitter();
        const delivered = deferred<string>();
        const errors = vi.fn();
        const detach = attachSignalDumpHandler(execution, {
          process: signals as unknown as Pick<NodeJS.Process, "on" | "off">,
          onSnapshot: (snapshot) => delivered.resolve(snapshot),
          onError: (error) => delivered.reject(error),
          stderr: { write: errors }
        });
        try {
          signals.emit("SIGUSR1");
          captures.push(await delivered.promise);
          expect(host.isHeld()).toBe(true);
          expect(errors).not.toHaveBeenCalled();
        } finally {
          detach();
        }
      } finally {
        host.release();
      }
      const original = await execution;
      expect(original).toMatchObject({ ok: true, returnValue: native });
      if (!original.ok) throw Error(original.error.message);
      expect(original.returnValue).toEqual(native);
      expect(host.calls).toEqual(nativeHost.calls);
      captures.push(await dump(execution));
      for (const [index, bytes] of captures.entries()) {
        const snapshot = restore(JSON.parse(bytes), { source: scenario.source });
        expect(snapshot.executionSemantics).toBe(expectedFresh);
        expect(snapshot.version).toBe(1);
        const before = JSON.stringify(snapshot);
        const rebound = makeFixture(scenario.id, false, scenario.policy);
        const requests: HostCallResumeRequest[] = [];
        const resumed = await run(scenario.source, {
          snapshot,
          bindings: rebound.bindings,
          budget: new Budget({ maxSteps: 150_000 }),
          hostCallResumeProvider: receiptsProvider(original.snapshot.hostCalls ?? [], requests)
        });
        expect(resumed).toMatchObject({ ok: true, returnValue: native });
        if (!resumed.ok) throw Error(resumed.error.message);
        expect(resumed.returnValue).toEqual(native);
        expect(rebound.calls).toEqual(index === 2 ? [] : scenario.resumeCalls);
        expect(requests).toHaveLength(index < 2 && scenario.policy === "read-side-effect" ? 1 : 0);
        expect(JSON.stringify(snapshot)).toBe(before);
        const recaptured = restore(JSON.parse(await dump(resumed)), { source: scenario.source });
        expect(recaptured.executionSemantics).toBe(expectedFresh);
        const finalHost = makeFixture(scenario.id, false, scenario.policy);
        const finalProvider = vi.fn();
        expect(
          await run(scenario.source, {
            snapshot: recaptured,
            bindings: finalHost.bindings,
            hostCallResumeProvider: finalProvider
          })
        ).toMatchObject({ ok: true, returnValue: native });
        expect(finalHost.calls).toEqual([]);
        expect(finalProvider).not.toHaveBeenCalled();
      }
    }
  );

  it.each(["re-issue", "read-side-effect"] as const)(
    "pending %s: strict writer marker and exactly observed consumption",
    async (policy) => {
      const source =
        'const first = await lookup(2); const final = await checkpoint("hold"); return { first, final };';
      const gate = deferred<number>();
      const entered = deferred<void>();
      const execution = run(source, {
        bindings: {
          lookup: declareHostOperation(async (value: number) => value * 10, "re-issue"),
          checkpoint: declareHostOperation(() => {
            entered.resolve();
            return gate.promise;
          }, policy)
        }
      });
      let bytes: string;
      try {
        await entered.promise;
        bytes = await dump(execution, { mode: "replay" });
      } finally {
        gate.resolve(13);
      }
      const original = await execution;
      const snapshot = restore(JSON.parse(bytes!), { source });
      expect(snapshot.executionSemantics).toBe(expectedFresh);
      const lookup = vi.fn();
      const checkpoint = vi.fn(async () => 13);
      const requests: HostCallResumeRequest[] = [];
      const bindings = {
        lookup: declareHostOperation(lookup, "re-issue"),
        checkpoint: declareHostOperation(checkpoint, policy)
      };
      const resumed = await run(source, {
        snapshot,
        bindings,
        hostCallResumeProvider: receiptsProvider(original.snapshot.hostCalls ?? [], requests)
      });
      expect(resumed).toMatchObject({ ok: true, returnValue: { first: 20, final: 13 } });
      expect(lookup).not.toHaveBeenCalled();
      expect(checkpoint.mock.calls).toEqual(policy === "re-issue" ? [["hold"]] : []);
      expect(requests).toHaveLength(policy === "read-side-effect" ? 1 : 0);
      checkpoint.mockClear();
      const completed = restore(JSON.parse(await dump(resumed)), { source });
      expect(completed.executionSemantics).toBe(expectedFresh);
      const provider = vi.fn();
      expect(
        await run(source, { snapshot: completed, bindings, hostCallResumeProvider: provider })
      ).toMatchObject({ ok: true, returnValue: { first: 20, final: 13 } });
      expect(lookup).not.toHaveBeenCalled();
      expect(checkpoint).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    }
  );

  it("SIGINT emits a replayable fresh checkpoint without releasing the pending call", async () => {
    const source = 'import { checkpoint } from "api"; return await checkpoint("hold");';
    vol.fromJSON({ "/validation/source.ajs": source });
    const host = makeFixture("reduction");
    const signals = new EventEmitter();
    const errors: string[] = [];
    const cli = runCli(["source.ajs", "--snapshot", "interrupted.json"], {
      cwd: "/validation",
      process: signals as unknown as Pick<NodeJS.Process, "on" | "off">,
      modulesFor: () => ({ api: { checkpoint: host.bindings.checkpoint } }),
      stdout: { write: () => undefined },
      stderr: {
        write: (text) => {
          errors.push(text);
        }
      }
    });
    try {
      await Promise.race([
        host.entered,
        cli.then(() => {
          throw Error("CLI exited before pending call");
        })
      ]);
      signals.emit("SIGINT");
      expect(await cli).toBe(130);
      expect(host.isHeld()).toBe(true);
      expect(errors.join("")).toContain("Interrupted by SIGINT");
      const snapshot = restore(
        JSON.parse(vol.readFileSync("/validation/interrupted.json", "utf8") as string),
        { source }
      );
      expect(snapshot.executionSemantics).toBe(expectedFresh);
      const rebound = makeFixture("reduction", false);
      const resumed = await run(source, {
        snapshot,
        modules: { api: { checkpoint: rebound.bindings.checkpoint } }
      });
      expect(resumed).toMatchObject({ ok: true, returnValue: 13 });
      expect(rebound.calls).toEqual([["checkpoint", "hold"]]);
      expect(JSON.parse(await dump(resumed)).executionSemantics).toBe(expectedFresh);
    } finally {
      host.release();
      await cli;
    }
  });
});

function roundtrip(bindings: Record<string, RuntimeSnapshotValue>) {
  const source = "return null;";
  expect(EXECUTION_SEMANTICS).toBe(expectedFresh);
  const envelope = JSON.parse(
    serializeSafeJSSnapshot({
      sourceHash: hashSource(source),
      executionSemantics: EXECUTION_SEMANTICS,
      bindings
    })
  );
  expect(envelope.executionSemantics).toBe(expectedFresh);
  expect(envelope.version).toBe(1);
  const validated = restore(envelope, { source });
  const encoded = serialize({
    source,
    currentAstNodeId: parseModule(source).body[0]!.nodeId!,
    scopeChain: [{ id: "module", bindings: {} }],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {}
  });
  const scope = restoreInterpreter(
    {
      ...encoded,
      scopeChain: [{ id: "module", bindings: validated.bindings }],
      heap: validated.heap
    },
    { source }
  ).currentScope;
  return (name: string) => {
    const binding = scope.lookup(name);
    if (!binding.found) throw Error(`Missing restored binding: ${name}`);
    return binding.value;
  };
}

describe("independent fresh OBJ2 graph checks", () => {
  it("preserves metadata/raw and cross-root identity without retaining originals", () => {
    const metadata = { count: 5 };
    const rows = Object.assign([metadata], { metadata, raw: metadata });
    const read = roundtrip({ rows, alias: rows, metadata, object: { metadata, raw: metadata } });
    const actual = read("rows") as typeof rows;
    expect(actual).not.toBe(rows);
    expect(actual).toBe(read("alias"));
    expect(Object.keys(actual)).toEqual(Object.keys(rows));
    for (const member of [
      actual[0],
      actual.metadata,
      actual.raw,
      (read("object") as typeof rows).metadata,
      (read("object") as typeof rows).raw
    ])
      expect(member).toBe(read("metadata"));
    expect(actual.metadata.count).toBe(5);
  });
  it.each([0, 2, 9])("preserves all %i holes and native length", (length) => {
    const rows = new Array<RuntimeSnapshotValue>(length);
    const actual = roundtrip({ rows })("rows") as typeof rows;
    expect(actual.length).toBe(length);
    expect(Object.keys(actual)).toEqual([]);
    expect(actual).toStrictEqual(rows);
  });
  it("distinguishes missing, undefined, null and named undefined", () => {
    const rows = Object.assign(new Array<RuntimeSnapshotValue>(6), { metadata: undefined });
    rows[1] = undefined;
    rows[3] = null;
    const actual = roundtrip({ rows })("rows") as typeof rows;
    expect(actual.length).toBe(6);
    expect(Object.keys(actual)).toEqual(["1", "3", "metadata"]);
    expect(Object.hasOwn(actual, 0)).toBe(false);
    expect(Object.hasOwn(actual, 1)).toBe(true);
    expect(Object.hasOwn(actual, "metadata")).toBe(true);
    expect(actual[1]).toBeUndefined();
    expect(actual[3]).toBeNull();
    expect(actual.metadata).toBeUndefined();
  });
  it("discovers named-only references and mutual cycles", () => {
    const metadata: Record<string, RuntimeSnapshotValue> = {};
    const raw: RuntimeSnapshotValue[] = [];
    const rows = Object.assign(new Array<RuntimeSnapshotValue>(3), { metadata, raw });
    metadata.owner = rows;
    metadata.raw = raw;
    raw.push(rows, metadata);
    const actual = roundtrip({ rows })("rows") as typeof rows;
    expect(actual.length).toBe(3);
    expect(Object.keys(actual)).toEqual(["metadata", "raw"]);
    expect(actual.metadata.owner).toBe(actual);
    expect(actual.metadata.raw).toBe(actual.raw);
    expect(actual.raw[0]).toBe(actual);
    expect(actual.raw[1]).toBe(actual.metadata);
  });
  it("keeps independent capture heaps separate and within-capture aliases shared", () => {
    const metadata = { count: 5 };
    const rows = Object.assign(new Array<RuntimeSnapshotValue>(4), { metadata, raw: metadata });
    const first = roundtrip({ rows, alias: rows });
    const second = roundtrip({ rows, alias: rows });
    expect(first("rows")).not.toBe(second("rows"));
    for (const read of [first, second]) {
      const actual = read("rows") as typeof rows;
      expect(actual).toBe(read("alias"));
      expect(actual.metadata).toBe(actual.raw);
      expect(actual.length).toBe(4);
      expect(Object.keys(actual)).toEqual(["metadata", "raw"]);
    }
  });
});

describe("independent native ALS receiver and lifetime checks", () => {
  it("native exit disables temporarily, hides its store and then restores it", () => {
    const context = new AsyncLocalStorage<object>();
    const store = {};
    const disable = vi.spyOn(context, "disable");
    context.run(store, () => {
      context.exit(() => expect(context.getStore()).toBeUndefined());
      expect(context.getStore()).toBe(store);
    });
    expect(disable).toHaveBeenCalledTimes(1);
    expect(disable.mock.contexts).toEqual([context]);
    context.disable();
  });

  it.each([false, true])(
    "host context is live across await, then disposed exactly once (throw=%s)",
    async (shouldThrow) => {
      const disable = vi.spyOn(AsyncLocalStorage.prototype, "disable");
      const enter = vi.spyOn(AsyncLocalStorage.prototype, "run");
      let retained: AsyncResource | undefined;
      let hostContext: AsyncLocalStorage<unknown> | undefined;
      const callback = async () => {
        const index = enter.mock.calls.map((args) => args[0] === true).lastIndexOf(true);
        const receiver = enter.mock.contexts[index];
        if (!(receiver instanceof AsyncLocalStorage))
          throw Error("Missing native host context receiver");
        hostContext = receiver;
        expect(hostContext).toBeDefined();
        expect(hostContext).not.toBe(promiseReplayContext);
        expect(hostContext!.getStore()).toBe(true);
        retained = new AsyncResource("ppr2-validation-retained-callback");
        await Promise.resolve();
        expect(hostContext!.getStore()).toBe(true);
        if (shouldThrow) throw Error("bounded callback failure");
        return 1;
      };
      try {
        const execution = run("return await callback()", { bindings: { callback } });
        if (shouldThrow) await expect(execution).rejects.toThrow("bounded callback failure");
        else expect(await execution).toMatchObject({ ok: true, returnValue: 1 });
        expect(disable.mock.contexts.filter((context) => context !== promiseReplayContext)).toEqual(
          [hostContext]
        );
        expect(disable.mock.contexts.filter((context) => context === hostContext)).toHaveLength(1);
        expect(disable.mock.contexts.some((context) => context === promiseReplayContext)).toBe(
          expectedFresh !== "jobs-v6"
        );
        expect(retained!.runInAsyncScope(() => hostContext!.getStore())).toBeUndefined();
        console.info(
          "PPR2_ALS_RECEIVERS",
          JSON.stringify({
            shouldThrow,
            phase: expectedFresh,
            total: disable.mock.contexts.length,
            sharedTemporaryDisables: disable.mock.contexts.filter(
              (context) => context === promiseReplayContext
            ).length,
            hostDisposals: disable.mock.contexts.filter((context) => context === hostContext)
              .length,
            retainedStoreAfterDisposal: "undefined"
          })
        );
      } finally {
        retained?.emitDestroy();
      }
    }
  );

  it("parse failure still disposes its sole run-local receiver exactly once", async () => {
    const disable = vi.spyOn(AsyncLocalStorage.prototype, "disable");
    await expect(run("return (", { bindings: { callback: async () => 1 } })).rejects.toThrow();
    expect(disable).toHaveBeenCalledTimes(1);
    expect(disable.mock.contexts[0]).not.toBe(promiseReplayContext);
  });
});
