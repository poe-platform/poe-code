import { describe, expect, it } from "vitest";
import {
  declareHostOperation,
  dump,
  HostCallResumabilityError,
  registerPendingHostCallPolicy,
  restore,
  run,
  type PendingHostCallPolicyMode
} from "./index.js";

type RunOptions = NonNullable<Parameters<typeof run>[1]>;
type Surface = "module" | "bindings";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function target(id: string, surface: Surface) {
  const moduleId = surface === "bindings" ? "<bindings>" : `named-policy-${id}`;
  const operation = `operation_${id}`;
  return {
    moduleId,
    operation,
    source:
      surface === "bindings"
        ? `return await ${operation}("argument");`
        : `import * as service from ${JSON.stringify(moduleId)}; return await service[${JSON.stringify(operation)}]("argument");`,
    options(callback: (value: unknown) => unknown): RunOptions {
      return surface === "bindings"
        ? { bindings: { [operation]: callback } }
        : { modules: { [moduleId]: { [operation]: callback } } };
    }
  };
}

type PendingCase = {
  id: string;
  surface: Surface;
  registration?: PendingHostCallPolicyMode;
  declaration?: PendingHostCallPolicyMode;
  changedRegistration?: PendingHostCallPolicyMode;
  provider?: "accepted" | "callId" | "sourceHash" | "moduleId" | "operation" | "argumentDigest";
  policy: PendingHostCallPolicyMode;
  result: "reissue" | "reconcile" | "external-reconciliation" | "mismatch" | "invalid-proof";
};

async function pendingCase(testCase: PendingCase): Promise<void> {
  const call = target(testCase.id, testCase.surface);
  const entered = deferred<void>();
  const release = deferred<void>();
  const events: string[] = [];
  const register = (policy: PendingHostCallPolicyMode) => {
    registerPendingHostCallPolicy({ moduleId: call.moduleId, operation: call.operation, policy });
  };
  if (testCase.registration !== undefined) register(testCase.registration);
  const callback = (phase: string) => {
    const operation = async (argument: unknown) => {
      events.push(`${phase}:issue:${String(argument)}`);
      if (phase === "original") {
        entered.resolve();
        await release.promise;
      }
      events.push(`${phase}:settle`);
      return 79;
    };
    return testCase.declaration === undefined
      ? operation
      : declareHostOperation(operation, testCase.declaration);
  };
  const original = run(call.source, call.options(callback("original")));
  const originalSettled = Promise.allSettled([original]);
  try {
    await Promise.race([
      entered.promise,
      original.then(() => {
        throw new Error("Original call settled before its gate");
      })
    ]);
    const snapshot = JSON.parse(await dump(original, { mode: "replay" }));
    const unchanged = JSON.stringify(snapshot);
    expect(snapshot.executionSemantics).toBe("jobs-v7");
    expect(snapshot.hostCalls).toHaveLength(1);
    expect(snapshot.hostCalls[0]).toMatchObject({
      moduleId: call.moduleId,
      operation: call.operation,
      policy: testCase.policy
    });
    expect(snapshot.replay.calls[0].policy).toBe(testCase.policy);
    if (testCase.changedRegistration !== undefined) register(testCase.changedRegistration);
    for (let iteration = 0; iteration < 3; iteration++) {
      const recapture = JSON.parse(await dump(original, { mode: "replay" }));
      expect(recapture.hostCalls[0]).toMatchObject(snapshot.hostCalls[0]);
      expect(recapture.replay.calls[0]).toMatchObject(snapshot.replay.calls[0]);
      expect(JSON.stringify(snapshot)).toBe(unchanged);
    }
    const options = call.options(callback("resume"));
    if (testCase.provider !== undefined) {
      options.hostCallResumeProvider = (request) => {
        events.push("provider");
        return {
          callId: request.callId,
          sourceHash: request.sourceHash,
          moduleId: request.moduleId,
          operation: request.operation,
          argumentDigest: request.argumentDigest,
          outcome: { status: "fulfilled", value: 79 },
          ...(testCase.provider === "accepted" ? {} : { [testCase.provider!]: "wrong-identity" })
        };
      };
    }
    const replay = run(call.source, {
      ...options,
      snapshot: restore(snapshot, { source: call.source })
    });
    if (testCase.result === "external-reconciliation") {
      await expect(replay).rejects.toBeInstanceOf(HostCallResumabilityError);
      await expect(replay).rejects.toMatchObject({ action: "external-reconciliation" });
    } else if (testCase.result === "mismatch") {
      await expect(replay).rejects.toThrow(
        "does not match the next restored invocation; reset is required"
      );
    } else if (testCase.result === "invalid-proof") {
      await expect(replay).rejects.toBeInstanceOf(HostCallResumabilityError);
      await expect(replay).rejects.toMatchObject({ action: "external-reconciliation" });
    } else {
      expect(await replay).toMatchObject({ ok: true, returnValue: 79 });
      const recapture = JSON.parse(await dump(replay));
      expect(recapture.replay.calls[0].policy).toBe(testCase.policy);
    }
    const expected = ["original:issue:argument"];
    if (testCase.result === "reissue") expected.push("resume:issue:argument", "resume:settle");
    if (testCase.result === "reconcile" || testCase.result === "invalid-proof")
      expected.push("provider");
    expect(events).toEqual(expected);
    expect(JSON.stringify(snapshot)).toBe(unchanged);
    release.resolve();
    expect(await original).toMatchObject({ ok: true, returnValue: 79 });
    expect(events).toEqual([...expected, "original:settle"]);
  } finally {
    release.resolve();
    await originalSettled;
  }
}

describe.each<Surface>(["module", "bindings"])("public named policy on %s", (surface) => {
  const cases: Omit<PendingCase, "surface">[] = [
    { id: "unregistered", policy: "re-issue", result: "reissue" },
    {
      id: "named_effect",
      registration: "read-side-effect",
      policy: "read-side-effect",
      result: "external-reconciliation"
    },
    { id: "named_reissue", registration: "re-issue", policy: "re-issue", result: "reissue" },
    {
      id: "declared_effect",
      registration: "re-issue",
      declaration: "read-side-effect",
      policy: "read-side-effect",
      result: "external-reconciliation"
    },
    {
      id: "declared_reissue",
      registration: "read-side-effect",
      declaration: "re-issue",
      policy: "re-issue",
      result: "reissue"
    },
    {
      id: "accepted_proof",
      registration: "read-side-effect",
      provider: "accepted",
      policy: "read-side-effect",
      result: "reconcile"
    },
    ...(["callId", "sourceHash", "moduleId", "operation", "argumentDigest"] as const).map(
      (field): Omit<PendingCase, "surface"> => ({
        id: `wrong_${field}`,
        registration: "read-side-effect",
        provider: field,
        policy: "read-side-effect",
        result: "invalid-proof"
      })
    ),
    {
      id: "registry_downgrade",
      registration: "read-side-effect",
      changedRegistration: "re-issue",
      policy: "read-side-effect",
      result: "mismatch"
    },
    {
      id: "registry_downgrade_with_proof",
      registration: "read-side-effect",
      changedRegistration: "re-issue",
      provider: "accepted",
      policy: "read-side-effect",
      result: "mismatch"
    },
    {
      id: "registry_upgrade",
      registration: "re-issue",
      changedRegistration: "read-side-effect",
      policy: "re-issue",
      result: "mismatch"
    },
    {
      id: "late_registration",
      changedRegistration: "read-side-effect",
      policy: "re-issue",
      result: "mismatch"
    },
    {
      id: "declaration_resists_downgrade",
      declaration: "read-side-effect",
      changedRegistration: "re-issue",
      policy: "read-side-effect",
      result: "external-reconciliation"
    }
  ];
  it.each(cases)("$id", (testCase) =>
    pendingCase({ ...testCase, id: `${surface}_${testCase.id}`, surface })
  );

  it("replays recorded outcomes without calling a replacement or provider", async () => {
    const call = target(`${surface}_recorded`, surface);
    registerPendingHostCallPolicy({
      moduleId: call.moduleId,
      operation: call.operation,
      policy: "read-side-effect"
    });
    const events: string[] = [];
    const original = await run(
      call.source,
      call.options(async () => {
        events.push("original");
        return 31;
      })
    );
    const saved = JSON.parse(await dump(original));
    const unchanged = JSON.stringify(saved);
    expect(saved.replay.calls[0].policy).toBe("read-side-effect");
    for (let iteration = 0; iteration < 3; iteration++) {
      const replay = await run(call.source, {
        ...call.options(() => {
          events.push("unexpected replacement");
          throw new Error("reissued recorded outcome");
        }),
        hostCallResumeProvider: () => {
          events.push("unexpected provider");
          throw new Error("reconciled recorded outcome");
        },
        snapshot: restore(saved, { source: call.source })
      });
      expect(replay).toMatchObject({ ok: true, returnValue: 31 });
      expect(JSON.parse(await dump(replay)).replay.calls[0].policy).toBe("read-side-effect");
      expect(JSON.stringify(saved)).toBe(unchanged);
    }
    expect(events).toEqual(["original"]);
  });

  it("rejects a changed recorded policy before replacement or reconciliation", async () => {
    const call = target(`${surface}_recorded_downgrade`, surface);
    registerPendingHostCallPolicy({
      moduleId: call.moduleId,
      operation: call.operation,
      policy: "read-side-effect"
    });
    const events: string[] = [];
    const original = await run(
      call.source,
      call.options(async () => {
        events.push("original");
        return 31;
      })
    );
    const saved = JSON.parse(await dump(original));
    const unchanged = JSON.stringify(saved);
    registerPendingHostCallPolicy({
      moduleId: call.moduleId,
      operation: call.operation,
      policy: "re-issue"
    });
    const replay = run(call.source, {
      ...call.options(() => {
        events.push("unexpected replacement");
        return 31;
      }),
      hostCallResumeProvider: () => {
        events.push("unexpected provider");
        throw new Error("reconciled recorded outcome");
      },
      snapshot: restore(saved, { source: call.source })
    });
    await expect(replay).rejects.toThrow(
      "does not match the next restored invocation; reset is required"
    );
    expect(events).toEqual(["original"]);
    expect(JSON.stringify(saved)).toBe(unchanged);
    expect(JSON.parse(await dump(original)).replay.calls[0].policy).toBe("read-side-effect");
  });

  it("selects registry changes at issue rather than wrapper creation", async () => {
    const call = target(`${surface}_issue_time`, surface);
    const entered = deferred<void>();
    const release = deferred<void>();
    const source = call.source.replace("return await", "await pause(); return await");
    const options = call.options(async () => 37);
    const original = run(source, {
      ...options,
      bindings: {
        ...options.bindings,
        pause: async () => {
          entered.resolve();
          await release.promise;
        }
      }
    });
    const settled = Promise.allSettled([original]);
    try {
      await entered.promise;
      registerPendingHostCallPolicy({
        moduleId: call.moduleId,
        operation: call.operation,
        policy: "read-side-effect"
      });
      release.resolve();
      const result = await original;
      expect(result).toMatchObject({ ok: true, returnValue: 37 });
      const capture = JSON.parse(await dump(result));
      expect(
        capture.replay.calls.find(
          (record: { operation: string }) => record.operation === call.operation
        ).policy
      ).toBe("read-side-effect");
    } finally {
      release.resolve();
      await settled;
    }
  });

  it.each<PendingHostCallPolicyMode>(["re-issue", "read-side-effect"])(
    "explicit %s wins a conflicting registry update after wrapping",
    async (policy) => {
      const call = target(
        `${surface}_precedence_${policy === "re-issue" ? "read" : "effect"}`,
        surface
      );
      const entered = deferred<void>();
      const release = deferred<void>();
      const source = call.source.replace("return await", "await pause(); return await");
      const options = call.options(declareHostOperation(async () => 41, policy));
      const original = run(source, {
        ...options,
        bindings: {
          ...options.bindings,
          pause: async () => {
            entered.resolve();
            await release.promise;
          }
        }
      });
      const settled = Promise.allSettled([original]);
      try {
        await entered.promise;
        registerPendingHostCallPolicy({
          moduleId: call.moduleId,
          operation: call.operation,
          policy: policy === "re-issue" ? "read-side-effect" : "re-issue"
        });
        release.resolve();
        const result = await original;
        expect(result).toMatchObject({ ok: true, returnValue: 41 });
        const capture = JSON.parse(await dump(result));
        expect(
          capture.replay.calls.find(
            (record: { operation: string }) => record.operation === call.operation
          ).policy
        ).toBe(policy);
      } finally {
        release.resolve();
        await settled;
      }
    }
  );
});

describe("exact named-registry identity", () => {
  it.each([
    ["pair.a", "b", "pair", "a.b"],
    ["case-sensitive", "Emit", "case-sensitive", "emit"],
    ["__proto__", "constructor", "constructor", "__proto__"],
    ["toString", "hasOwnProperty", "hasOwnProperty", "toString"]
  ])("separates %s/%s from %s/%s", async (moduleId, operation, otherModule, otherOperation) => {
    registerPendingHostCallPolicy({ moduleId, operation, policy: "read-side-effect" });
    registerPendingHostCallPolicy({
      moduleId: otherModule,
      operation: otherOperation,
      policy: "re-issue"
    });
    const source = `import * as first from ${JSON.stringify(moduleId)}; import * as second from ${JSON.stringify(otherModule)}; return [await first[${JSON.stringify(operation)}](), await second[${JSON.stringify(otherOperation)}]()];`;
    const events: string[] = [];
    const modules = new Map([
      [
        moduleId,
        new Map([
          [
            operation,
            async () => {
              events.push("first");
              return 1;
            }
          ]
        ])
      ],
      [
        otherModule,
        new Map([
          [
            otherOperation,
            async () => {
              events.push("second");
              return 2;
            }
          ]
        ])
      ]
    ]);
    if (moduleId === otherModule)
      modules.get(moduleId)!.set(operation, async () => {
        events.push("first");
        return 1;
      });
    const result = await run(source, { modules });
    expect(result).toMatchObject({ ok: true, returnValue: [1, 2] });
    expect(events).toEqual(["first", "second"]);
    expect(
      JSON.parse(await dump(result)).replay.calls.map(
        (record: { moduleId: string; operation: string; policy: string }) => [
          record.moduleId,
          record.operation,
          record.policy
        ]
      )
    ).toEqual([
      [moduleId, operation, "read-side-effect"],
      [otherModule, otherOperation, "re-issue"]
    ]);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "constructor")).toBe(true);
  });
});
