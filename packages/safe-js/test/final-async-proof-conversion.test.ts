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
import { bounded, deferred } from "./fixtures/final-async-proof.js";

const source = `let count = 2;
const result = await host(async () => {
  await gate();
  const compute = () => count;
  const shared = { compute, alias: compute };
  shared.self = shared;
  return { shared, alias: shared, map: new Map([[compute, shared]]), set: new Set([compute]) };
});
count = 7;
return {
  value: result.shared.compute(),
  closureAlias: result.shared.compute === result.shared.alias,
  objectAlias: result.shared === result.alias,
  cycle: result.shared.self === result.shared,
  map: result.map.get(result.shared.compute) === result.shared,
  set: result.set.has(result.shared.compute)
};`;

const expected = {
  value: 7,
  closureAlias: true,
  objectAlias: true,
  cycle: true,
  map: true,
  set: true
};

async function capture() {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const execution = run(source, {
    bindings: {
      host: declareHostOperation(
        async (callback: () => Promise<unknown>) => callback(),
        "read-side-effect"
      ),
      gate: declareHostOperation(() => {
        entered.release();
        return gate.promise;
      }, "re-issue")
    }
  });
  await bounded(entered.promise, "callback entered");
  const serialized = await bounded(dump(execution, { mode: "replay" }), "callback capture");
  gate.release();
  const original = await bounded(execution, "original completion");
  expect(original.ok).toBe(true);
  if (original.ok) expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
  return serialized;
}

function resume(serialized: string, provider: HostCallResumeProvider) {
  return run(source, {
    snapshot: restore(JSON.parse(serialized), { source }),
    bindings: {
      host: declareHostOperation(() => {
        throw new Error("External operation must not be reissued");
      }, "read-side-effect"),
      gate: declareHostOperation(async () => undefined, "re-issue")
    },
    hostCallResumeProvider: provider
  });
}

function requireContext(context: HostCallResumeContext | undefined): HostCallResumeContext {
  if (context === undefined) throw new Error("Missing callback resume context");
  return context;
}

it("anchors cycles, collection aliases and captures natively", async () => {
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  expect(
    await new AsyncFunction("host", "gate", source)(
      async (callback: () => Promise<unknown>) => callback(),
      async () => undefined
    )
  ).toEqual(expected);
});

it("converts current source functions without invoking them or losing graph identity", async () => {
  const serialized = await capture();
  let savedContext: HostCallResumeContext | undefined;
  let savedResult: unknown;
  const result = await bounded(
    resume(serialized, async (request, optionalContext): Promise<HostCallResumeProof> => {
      const context = requireContext(optionalContext);
      savedContext = context;
      expect(context.replayed.map((entry) => entry.callbackId)).toEqual(
        request.callbacks?.map((entry) => entry.id)
      );
      const value = await context.replayed[0].result;
      savedResult = value;
      expect(() => deepCopyToSandbox(value)).toThrow("function");
      const converted = context.toSandboxValue(value);
      expectTypeOf(converted).toEqualTypeOf<
        Extract<HostCallOutcome, { status: "fulfilled" }>["value"]
      >();
      return {
        ...request,
        callbackDisposition: "joined",
        outcome: { status: "fulfilled", value: converted }
      };
    }),
    "converted proof"
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
  expect(result.snapshot.hostCalls?.find((record) => record.operation === "host")?.lifecycle).toBe(
    "consumed"
  );
  expect(() => requireContext(savedContext).toSandboxValue(savedResult)).toThrow(
    "no longer active"
  );
  const completed = await bounded(dump(result), "completed converted proof capture");
  const replayed = await bounded(
    resume(completed, () => {
      throw new Error("Consumed proof must not request another provider");
    }),
    "completed converted proof replay"
  );
  expect(replayed.ok).toBe(true);
  const originalBaseline = await bounded(
    run(source, {
      bindings: {
        host: declareHostOperation(
          async (callback: () => Promise<unknown>) => callback(),
          "read-side-effect"
        ),
        gate: declareHostOperation(async () => undefined, "re-issue")
      }
    }),
    "original completed baseline"
  );
  expect(originalBaseline.ok).toBe(true);
  if (originalBaseline.ok)
    expect(deepCopyFromSandbox(originalBaseline.returnValue)).toEqual(expected);
  const baselineReplay = await bounded(
    resume(await dump(originalBaseline), () => {
      throw new Error("Original completed baseline must not request a proof");
    }),
    "original completed baseline replay"
  );
  expect(baselineReplay.ok).toBe(true);
  if (replayed.ok && baselineReplay.ok) {
    const baselineValue = deepCopyFromSandbox(baselineReplay.returnValue);
    expect(baselineValue).toEqual({ ...expected, map: true });
    expect(deepCopyFromSandbox(replayed.returnValue)).toEqual(baselineValue);
  }
  const identities = (records: typeof result.snapshot.hostCalls) =>
    records?.map(({ outcome, ...record }) => {
      void outcome;
      return record;
    });
  expect(identities(replayed.snapshot.hostCalls)).toEqual(identities(result.snapshot.hostCalls));
});

it("rejects ordinary functions, copied adapters and unresolved promises", async () => {
  const serialized = await capture();
  const result = await bounded(
    resume(serialized, async (request, optionalContext) => {
      const context = requireContext(optionalContext);
      const value = await context.replayed[0].result;
      const callback = context.callbacks.values().next().value;
      if (callback === undefined) throw new Error("Missing genuine callback");
      expect(() => context.toSandboxValue({ compute: () => 7 })).toThrow("function");
      expect(() => context.toSandboxValue({ compute: callback.bind(undefined) })).toThrow(
        "function"
      );
      expect(() => context.toSandboxValue({ value: Promise.resolve(7) })).toThrow("promise");
      expect(() => context.toSandboxValue(Symbol("invalid"))).toThrow("symbol");
      const converted = context.toSandboxValue(value);
      expect(() => context.toSandboxValue(converted)).toThrow("sandbox capability");
      return {
        ...request,
        callbackDisposition: "joined",
        outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
      };
    }),
    "invalid-value controls"
  );
  expect(result.ok).toBe(true);
});

it("rejects foreign active-context and previous-run adapters", async () => {
  const serialized = await capture();
  const available = deferred<unknown>();
  const release = deferred<void>();
  const first = resume(serialized, async (request, optionalContext) => {
    const context = requireContext(optionalContext);
    const value = await context.replayed[0].result;
    available.release(value);
    await release.promise;
    return {
      ...request,
      callbackDisposition: "joined",
      outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
    };
  });
  const foreign = await bounded(available.promise, "first context result");
  const provider: HostCallResumeProvider = async (request, optionalContext) => {
    const context = requireContext(optionalContext);
    const value = await context.replayed[0].result;
    expect(() => context.toSandboxValue(foreign)).toThrow("function");
    return {
      ...request,
      callbackDisposition: "joined",
      outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
    };
  };
  try {
    expect((await bounded(resume(serialized, provider), "foreign active context")).ok).toBe(true);
  } finally {
    release.release();
  }
  expect((await bounded(first, "first context completion")).ok).toBe(true);
  expect((await bounded(resume(serialized, provider), "previous-run context")).ok).toBe(true);
});

it("expires the converter after provider rejection", async () => {
  const serialized = await capture();
  let savedContext: HostCallResumeContext | undefined;
  await expect(
    bounded(
      resume(serialized, (_request, context) => {
        savedContext = requireContext(context);
        throw new Error("No external proof available");
      }),
      "provider rejection"
    )
  ).rejects.toThrow("No external proof available");
  expect(() => requireContext(savedContext).toSandboxValue(7)).toThrow("no longer active");
});

it("keeps source-function provenance scoped to one call in the same run", async () => {
  const concurrentSource = `const first = host(async () => { await gate(); return () => 7; });
const second = host(async () => { await gate(); return () => 9; });
return [(await first)(), (await second)()];`;
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  expect(
    await new AsyncFunction("host", "gate", concurrentSource)(
      async (callback: () => Promise<unknown>) => callback(),
      async () => undefined
    )
  ).toEqual([7, 9]);
  const entered = deferred<void>();
  const gate = deferred<void>();
  let gates = 0;
  const execution = run(concurrentSource, {
    bindings: {
      host: declareHostOperation(
        async (callback: () => Promise<unknown>) => callback(),
        "read-side-effect"
      ),
      gate: declareHostOperation(() => {
        if (++gates === 2) entered.release();
        return gate.promise;
      }, "re-issue")
    }
  });
  await bounded(entered.promise, "two concurrent callbacks");
  const serialized = await bounded(dump(execution, { mode: "replay" }), "concurrent capture");
  gate.release();
  const original = await bounded(execution, "concurrent completion");
  expect(original.ok).toBe(true);
  if (original.ok) expect(deepCopyFromSandbox(original.returnValue)).toEqual([7, 9]);
  const ready = deferred<void>();
  const results = new Map<string, unknown>();
  const resumed = await bounded(
    run(concurrentSource, {
      snapshot: restore(JSON.parse(serialized), { source: concurrentSource }),
      bindings: {
        host: declareHostOperation(() => {
          throw new Error("Unexpected host reissue");
        }, "read-side-effect"),
        gate: declareHostOperation(async () => undefined, "re-issue")
      },
      hostCallResumeProvider: async (request, optionalContext) => {
        const context = requireContext(optionalContext);
        const value = await context.replayed[0].result;
        results.set(request.callId, value);
        if (results.size === 2) ready.release();
        await ready.promise;
        const foreign = [...results].find(([callId]) => callId !== request.callId);
        if (foreign === undefined) throw new Error("Missing concurrent result");
        expect(() => context.toSandboxValue(foreign[1])).toThrow("function");
        return {
          ...request,
          callbackDisposition: "joined",
          outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
        };
      }
    }),
    "concurrent proofs"
  );
  expect(resumed.ok).toBe(true);
  if (resumed.ok) expect(deepCopyFromSandbox(resumed.returnValue)).toEqual([7, 9]);
});
