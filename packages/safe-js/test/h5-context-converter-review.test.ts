import { expect, expectTypeOf, it } from "vitest";
import {
  declareHostOperation,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  dump,
  restore,
  run,
  type HostCallOutcome,
  type HostCallResumeContext,
  type HostCallResumeProof,
  type HostCallResumeProvider
} from "@poe-code/safe-js";

const source = `let count = 2;
let computeCalls = 0;
let callbackCalls = 0;
const result = await host(async () => {
  callbackCalls++;
  await gate();
  const compute = () => { computeCalls++; tap("compute"); return count; };
  const node = { compute, alias: compute };
  node.self = node;
  return { node, alias: node, list: [compute, compute], set: new Set([compute]) };
});
count = 7;
tap("after-host");
const before = computeCalls;
const value = result.node.compute();
return { value, before, computeCalls, callbackCalls,
  functionAlias: result.node.compute === result.node.alias,
  objectAlias: result.node === result.alias,
  cycle: result.node.self === result.node,
  listAlias: result.list[0] === result.node.compute && result.list[1] === result.node.compute,
  setAlias: result.set.has(result.node.compute) };
`;
const expected = {
  value: 7,
  before: 0,
  computeCalls: 1,
  callbackCalls: 1,
  functionAlias: true,
  objectAlias: true,
  cycle: true,
  listAlias: true,
  setAlias: true
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

async function bounded<Value>(promise: PromiseLike<Value>, phase: string): Promise<Value> {
  let complete = false;
  let rejected = false;
  let result: Value | undefined;
  let failure: unknown;
  promise.then(
    (value) => {
      result = value;
      complete = true;
    },
    (error: unknown) => {
      failure = error;
      rejected = true;
      complete = true;
    }
  );
  for (let turn = 0; turn < 8192 && !complete; turn++) await Promise.resolve();
  if (!complete) throw new Error("Finite notification budget: " + phase);
  if (rejected) throw failure;
  return result!;
}

function requireContext(context: HostCallResumeContext | undefined) {
  if (!context) throw new Error("Expected genuine callback context");
  return context;
}

async function capture() {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const calls: string[] = [];
  const execution = run(source, {
    bindings: {
      host: declareHostOperation(
        async (callback: () => Promise<unknown>) => callback(),
        "read-side-effect"
      ),
      gate: declareHostOperation(() => {
        entered.resolve();
        return gate.promise;
      }, "re-issue"),
      tap: declareHostOperation((label: string) => {
        calls.push(label);
      }, "re-issue")
    }
  });
  await bounded(entered.promise, "original callback gate");
  let serialized: string;
  try {
    serialized = await bounded(dump(execution, { mode: "replay" }), "external capture");
  } finally {
    gate.resolve();
  }
  const original = await bounded(execution, "original completion");
  expect(original.ok).toBe(true);
  if (original.ok) expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
  expect(calls).toEqual(["after-host", "compute"]);
  return { serialized, original };
}

function resume(serialized: string, provider: HostCallResumeProvider, calls: string[] = []) {
  return run(source, {
    snapshot: restore(JSON.parse(serialized), { source }),
    bindings: {
      host: declareHostOperation(() => {
        throw new Error("Unexpected external host reissue");
      }, "read-side-effect"),
      gate: declareHostOperation(async () => undefined, "re-issue"),
      tap: declareHostOperation((label: string) => {
        calls.push(label);
      }, "re-issue")
    },
    hostCallResumeProvider: provider
  });
}

it("anchors the exact independent source natively without converter effects", async () => {
  const calls: string[] = [];
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  const result = await new AsyncFunction("host", "gate", "tap", source)(
    async (callback: () => Promise<unknown>) => callback(),
    async () => undefined,
    (label: string) => {
      calls.push(label);
    }
  );
  expect(result).toEqual(expected);
  expect(calls).toEqual(["after-host", "compute"]);
});

it("converts genuine return graphs without invoking functions or adding callbacks", async () => {
  const { serialized } = await capture();
  const captured = restore(JSON.parse(serialized), { source });
  const calls: string[] = [];
  const events: unknown[] = [];
  let savedContext: HostCallResumeContext | undefined;
  let returned: unknown;
  const result = await bounded(
    resume(
      serialized,
      async (request, context): Promise<HostCallResumeProof> => {
        const current = requireContext(context);
        savedContext = current;
        const record = captured.hostCalls.find(
          (entry: { id: string }) => entry.id === request.callId
        );
        expect([
          request.sourceHash,
          request.moduleId,
          request.operation,
          request.argumentDigest
        ]).toEqual([record.sourceHash, record.moduleId, record.operation, record.argumentDigest]);
        const value = await current.replayed[0].result;
        returned = value;
        const before = {
          callbacks: structuredClone(request.callbacks),
          keys: [...current.callbacks.keys()],
          replayed: current.replayed.map((entry) => entry.callbackId),
          calls: [...calls]
        };
        expect(before.replayed).toEqual(request.callbacks?.map((entry) => entry.id));
        expect(before.replayed).toHaveLength(1);
        expect(() => deepCopyToSandbox(value)).toThrow("function");
        current.toSandboxValue(value);
        const converted = current.toSandboxValue(value);
        expectTypeOf(converted).toEqualTypeOf<
          Extract<HostCallOutcome, { status: "fulfilled" }>["value"]
        >();
        const after = {
          callbacks: structuredClone(request.callbacks),
          keys: [...current.callbacks.keys()],
          replayed: current.replayed.map((entry) => entry.callbackId),
          calls: [...calls]
        };
        expect(after).toEqual(before);
        expect(calls).toEqual([]);
        events.push({ request: structuredClone(request), before, after });
        return {
          ...request,
          callbackDisposition: "joined",
          outcome: { status: "fulfilled", value: converted }
        };
      },
      calls
    ),
    "pure converted proof"
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
  expect(calls).toEqual(["after-host", "compute"]);
  expect(result.snapshot.hostCalls?.find((record) => record.operation === "host")?.lifecycle).toBe(
    "consumed"
  );
  expect(() => requireContext(savedContext).toSandboxValue(returned)).toThrow("no longer active");
  console.log(
    JSON.stringify({
      kind: "independent-pure-conversion",
      serialized,
      events,
      calls,
      completed: await dump(result)
    })
  );
});

it("rejects ordinary native functions and public function-shaped records without invoking them", async () => {
  const { serialized } = await capture();
  let nativeInvocations = 0;
  const native = () => {
    nativeInvocations++;
    return 17;
  };
  const invalid = [
    native,
    { compute: native },
    { kind: "fn", name: "ordinary", call: native },
    new Set([native]),
    Promise.resolve(17)
  ];
  const result = await bounded(
    resume(serialized, async (request, context) => {
      const current = requireContext(context);
      const value = await current.replayed[0].result;
      for (const item of invalid) expect(() => current.toSandboxValue(item)).toThrow();
      expect(() => deepCopyToSandbox(native)).toThrow("function");
      expect(nativeInvocations).toBe(0);
      expect(
        deepCopyFromSandbox(current.toSandboxValue({ kind: "fn", label: "plain data" }))
      ).toEqual({ kind: "fn", label: "plain data" });
      return {
        ...request,
        callbackDisposition: "joined",
        outcome: { status: "fulfilled", value: current.toSandboxValue(value) }
      };
    }),
    "bounded ordinary invalid values"
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
  expect(nativeInvocations).toBe(0);
});

it("rejects another active resume context while accepting its own genuine result", async () => {
  const { serialized } = await capture();
  const ready = deferred<unknown>();
  const release = deferred<void>();
  const first = resume(serialized, async (request, context) => {
    const current = requireContext(context);
    const value = await current.replayed[0].result;
    ready.resolve(value);
    await release.promise;
    return {
      ...request,
      callbackDisposition: "joined",
      outcome: { status: "fulfilled", value: current.toSandboxValue(value) }
    };
  });
  const foreign = await bounded(ready.promise, "foreign active context ready");
  try {
    const result = await bounded(
      resume(serialized, async (request, context) => {
        const current = requireContext(context);
        const own = await current.replayed[0].result;
        expect(() => current.toSandboxValue(foreign)).toThrow("function");
        return {
          ...request,
          callbackDisposition: "joined",
          outcome: { status: "fulfilled", value: current.toSandboxValue(own) }
        };
      }),
      "second context completion"
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
  } finally {
    release.resolve();
  }
  const firstResult = await bounded(first, "first context cleanup");
  expect(firstResult.ok).toBe(true);
});

it("expires conversion after a provider rejection without broadening generic conversion", async () => {
  const { serialized } = await capture();
  let savedContext: HostCallResumeContext | undefined;
  await expect(
    bounded(
      resume(serialized, (_request, context) => {
        savedContext = requireContext(context);
        throw new Error("receipt unavailable");
      }),
      "provider refusal"
    )
  ).rejects.toThrow("receipt unavailable");
  expect(() => requireContext(savedContext).toSandboxValue(7)).toThrow("no longer active");
  expect(() => deepCopyToSandbox(() => 7)).toThrow("function");
});
