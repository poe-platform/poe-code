import {
  Budget,
  declareHostOperation,
  deepCopyFromSandbox,
  dump,
  restore,
  run,
  type HostCallResumeProof,
  type HostCallResumeRequest
} from "@poe-code/safe-js";

export const callbackSources = {
  function: `const state = { calls: 0, count: 2 };
const result = await host(async () => {
  state.calls++;
  await gate();
  const compute = () => state.count;
  return { compute, alias: compute };
});
state.count = 7;
return { same: result.compute === result.alias, calls: state.calls, value: result.compute() };
`,
  data: `let calls = 0;
const result = await host(async () => {
  calls++;
  await gate();
  const shared = { value: 7 };
  return { left: shared, right: shared };
});
return { same: result.left === result.right, calls, value: result.left.value };
`
};

export function deferred<Value>() {
  let release!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export async function bounded<Value>(promise: PromiseLike<Value>, phase: string): Promise<Value> {
  let settled = false;
  let value: Value | undefined;
  let failure: unknown;
  let rejected = false;
  promise.then(
    (result) => {
      value = result;
      settled = true;
    },
    (error: unknown) => {
      failure = error;
      rejected = true;
      settled = true;
    }
  );
  for (let turn = 0; turn < 8192 && !settled; turn++) await Promise.resolve();
  if (!settled) throw new Error("Finite notification budget exhausted: " + phase);
  if (rejected) throw failure;
  return value!;
}

export async function nativeCallback(source: string): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  return new AsyncFunction("host", "gate", source)(
    async (callback: () => Promise<unknown>) => callback(),
    async () => undefined
  );
}

function output(result: Awaited<ReturnType<typeof run>>): unknown {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return deepCopyFromSandbox(result.returnValue);
}

export async function exerciseCallbackProof(kind: keyof typeof callbackSources) {
  const source = callbackSources[kind];
  const native = await nativeCallback(source);
  const gate = deferred<void>();
  const entered = deferred<void>();
  let callbackInvocations = 0;
  const events: unknown[] = [];
  const execution = run(source, {
    budget: new Budget({ maxSteps: 75000 }),
    bindings: {
      host: declareHostOperation(async (callback: () => Promise<unknown>) => {
        callbackInvocations++;
        return callback();
      }, "read-side-effect"),
      gate: declareHostOperation(() => {
        entered.release();
        return gate.promise;
      }, "re-issue")
    }
  });
  await bounded(entered.promise, "original nested gate");
  const serialized = await bounded(dump(execution, { mode: "replay" }), "external pending capture");
  const snapshot = restore(JSON.parse(serialized), { source });
  events.push({ phase: "capture", snapshot });
  gate.release();
  const original = output(await bounded(execution, "original completion"));
  let requestReceipt: HostCallResumeRequest | undefined;
  let replayedCallbackIds: number[] = [];
  const resumedExecution = run(source, {
    snapshot,
    budget: new Budget({ maxSteps: 75000 }),
    bindings: {
      host: declareHostOperation(async (callback: () => Promise<unknown>) => {
        callbackInvocations++;
        return callback();
      }, "read-side-effect"),
      gate: declareHostOperation(async () => {
        events.push({ phase: "nested reissue" });
      }, "re-issue")
    },
    hostCallResumeProvider: async (request, context): Promise<HostCallResumeProof> => {
      requestReceipt = request;
      events.push({
        phase: "provider",
        request,
        callbackIds: context ? [...context.callbacks.keys()] : []
      });
      if (context === undefined || context.replayed.length !== 1)
        throw new Error("Expected exactly one reconstructed callback");
      replayedCallbackIds = context.replayed.map((entry) => entry.callbackId);
      const result = await context.replayed[0].result;
      const returnedFunctions =
        result && typeof result === "object"
          ? Object.entries(result).filter(([, value]) => typeof value === "function")
          : [];
      events.push({
        phase: "callback-return",
        replayedCallbackIds,
        functionKeys: returnedFunctions.map(([key]) => key),
        functionAliasOrdinals: returnedFunctions.map(([, value]) =>
          returnedFunctions.findIndex(([, candidate]) => value === candidate)
        )
      });
      await context.waitForCallbacks();
      try {
        const proof: HostCallResumeProof = {
          callId: request.callId,
          sourceHash: request.sourceHash,
          moduleId: request.moduleId,
          operation: request.operation,
          argumentDigest: request.argumentDigest,
          callbackDisposition: "joined",
          outcome: { status: "fulfilled", value: context.toSandboxValue(result) }
        };
        events.push({ phase: "proof-return", proof });
        return proof;
      } catch (error) {
        console.log(JSON.stringify({ kind, native, original, events, error: String(error) }));
        throw error;
      }
    }
  });
  const resumedResult = await bounded(resumedExecution, "resumed completion");
  const resumed = output(resumedResult);
  return {
    kind,
    native,
    original,
    resumed,
    callbackInvocations,
    replayedCallbackIds,
    consumed: resumedResult.snapshot.hostCalls?.some(
      (record) => record.id === requestReceipt?.callId && record.lifecycle === "consumed"
    ),
    events
  };
}
