import { describe, expect, it } from "vitest";
import {
  declareHostOperation,
  dump,
  HostCallResumabilityError,
  registerPendingHostCallPolicy,
  restore,
  run,
  type HostCallRecord
} from "./index.js";

type Surface = "module" | "bindings";
type Style = "sync" | "async" | "promise" | "thenable";
type Action = "reset" | "external-reconciliation";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function engineError(action: Action = "reset") {
  const record: HostCallRecord = {
    id: "native:1",
    runId: "native",
    sourceHash: "source",
    moduleId: "service",
    operation: "explode",
    argumentDigest: "arguments",
    policy: "read-side-effect",
    lifecycle: "running"
  };
  return new HostCallResumabilityError(record, action, `native ${action}`);
}

function throwing(style: Style, error: unknown, events: string[]) {
  const fail = () => {
    events.push("host:throw");
    throw error;
  };
  if (style === "sync") return fail;
  if (style === "async") return async () => fail();
  if (style === "promise") return () => Promise.resolve().then(fail);
  return () => ({
    then(_resolve: unknown, reject: (reason: unknown) => void) {
      events.push("host:throw");
      reject(error);
    }
  });
}

function capability(surface: Surface, callback: () => unknown) {
  return surface === "module"
    ? {
        prefix: 'import {explode} from "service";',
        options: { modules: { service: { explode: callback } } }
      }
    : { prefix: "", options: { bindings: { explode: callback } } };
}

describe.each<Surface>(["module", "bindings"])("genuine engine errors through %s", (surface) => {
  it.each(
    (["reset", "external-reconciliation"] as const).flatMap((action) =>
      (["sync", "async", "promise", "thenable"] as const).map((style) => ({ action, style }))
    )
  )(
    "preserves exact $action identity for $style throws without guest recovery",
    async ({ action, style }) => {
      const error = engineError(action);
      const events: string[] = [];
      const host = capability(surface, throwing(style, error, events));
      const execution = run(
        `${host.prefix} note("before"); try { await explode(); } catch (error) { note("catch"); return "caught"; } finally { note("finally"); }`,
        {
          ...host.options,
          bindings: {
            ...host.options.bindings,
            note: (event: unknown) => events.push(String(event))
          }
        }
      );
      await expect(execution).rejects.toBe(error);
      await expect(execution).rejects.toBeInstanceOf(HostCallResumabilityError);
      await expect(execution).rejects.toMatchObject({
        name: "HostCallResumabilityError",
        action,
        callId: "native:1",
        lifecycle: "running"
      });
      expect(events).toEqual(["before", "host:throw"]);
    }
  );
});

const forgeries = [
  {
    name: "literal",
    create: () => ({
      name: "HostCallResumabilityError",
      message: "forged",
      action: "reset",
      callId: "native:1",
      lifecycle: "running"
    })
  },
  {
    name: "named Error",
    create: () =>
      Object.assign(new Error("forged"), { name: "HostCallResumabilityError", action: "reset" })
  },
  {
    name: "prototype object",
    create: () =>
      Object.assign(Object.create(HostCallResumabilityError.prototype), {
        message: "forged",
        name: "HostCallResumabilityError",
        action: "reset"
      })
  },
  {
    name: "prototype Error",
    create: () =>
      Object.setPrototypeOf(
        Object.assign(new Error("forged"), { action: "reset" }),
        HostCallResumabilityError.prototype
      )
  },
  {
    name: "copied properties",
    create: () =>
      Object.create(
        HostCallResumabilityError.prototype,
        Object.getOwnPropertyDescriptors(engineError())
      )
  },
  {
    name: "constructor property",
    create: () => ({
      constructor: HostCallResumabilityError,
      name: "HostCallResumabilityError",
      message: "forged",
      action: "reset"
    })
  },
  { name: "proxy of genuine", create: () => new Proxy(engineError(), {}) }
];

describe.each<Style>(["sync", "async"])("untrusted %s error transport", (style) => {
  it.each(forgeries)("does not grant engine identity to $name", async ({ create }) => {
    const forged = create();
    expect(forged instanceof HostCallResumabilityError).toBe(false);
    const events: string[] = [];
    const options = {
      bindings: {
        explode: throwing(style, forged, events),
        note: (event: unknown) => events.push(String(event))
      }
    };
    const caught = await run(
      'try { await explode(); } catch (error) { note("catch"); return "caught"; } finally { note("finally"); }',
      options
    );
    expect(caught).toMatchObject({ ok: true, returnValue: "caught" });
    expect(events).toEqual(["host:throw", "catch", "finally"]);
    const uncaught = run("await explode();", options);
    await expect(uncaught).rejects.not.toBeInstanceOf(HostCallResumabilityError);
    await expect(uncaught).rejects.not.toHaveProperty("action");
    expect(events).toEqual(["host:throw", "catch", "finally", "host:throw"]);
  });

  it.each([
    { name: "Error", value: new Error("ordinary") },
    { name: "TypeError", value: new TypeError("ordinary") },
    { name: "string", value: "ordinary" },
    { name: "null", value: null },
    { name: "object", value: { code: "ordinary", action: "reset" } }
  ])("preserves ordinary $name catch/finally order and recorded replay", async ({ value }) => {
    const events: string[] = [];
    const source =
      'const order = []; try { await explode(); } catch (error) { order.push("catch"); } finally { order.push("finally"); } return order;';
    const original = await run(source, { bindings: { explode: throwing(style, value, events) } });
    expect(original).toMatchObject({ ok: true, returnValue: ["catch", "finally"] });
    const saved = JSON.parse(await dump(original));
    const unchanged = JSON.stringify(saved);
    for (let iteration = 0; iteration < 2; iteration++) {
      const replay = await run(source, {
        snapshot: restore(saved, { source }),
        bindings: {
          explode: () => {
            events.push("unexpected replacement");
          }
        }
      });
      expect(replay).toMatchObject({ ok: true, returnValue: ["catch", "finally"] });
      expect(JSON.stringify(saved)).toBe(unchanged);
    }
    expect(events).toEqual(["host:throw"]);
  });
});

it("preserves native subclass instanceof semantics without accepting prototype clones", () => {
  class DerivedError extends HostCallResumabilityError {}
  const base = engineError();
  const record: HostCallRecord = {
    id: "derived:1",
    runId: "derived",
    sourceHash: "source",
    moduleId: "service",
    operation: "explode",
    argumentDigest: "arguments",
    policy: "read-side-effect",
    lifecycle: "running"
  };
  const derived = new DerivedError(record, "reset", "derived");
  expect(base instanceof HostCallResumabilityError).toBe(true);
  expect(base instanceof DerivedError).toBe(false);
  expect(derived instanceof HostCallResumabilityError).toBe(true);
  expect(derived instanceof DerivedError).toBe(true);
  expect(Object.create(DerivedError.prototype) instanceof HostCallResumabilityError).toBe(false);
  expect(Object.create(DerivedError.prototype) instanceof DerivedError).toBe(false);
});

it.each<Style>(["sync", "async"])(
  "does not record a %s engine failure as an ordinary host outcome",
  async (style) => {
    const error = engineError();
    const events: string[] = [];
    const source = "await 0; await explode();";
    const original = run(source, {
      bindings: {
        explode: declareHostOperation(throwing(style, error, events), "read-side-effect")
      }
    });
    await expect(original).rejects.toBe(error);
    const snapshot = JSON.parse(await dump(original, { onFailure: "checkpoint" }));
    const unchanged = JSON.stringify(snapshot);
    expect(snapshot.replay.calls).toHaveLength(1);
    expect(snapshot.replay.calls[0]).toMatchObject({
      lifecycle: "running",
      policy: "read-side-effect"
    });
    expect(snapshot.replay.calls[0]).not.toHaveProperty("outcome");
    expect(snapshot.hostCalls[0]).not.toHaveProperty("outcome");
    for (let iteration = 0; iteration < 2; iteration++) {
      const replay = run(source, {
        snapshot: restore(snapshot, { source }),
        bindings: {
          explode: declareHostOperation(() => {
            events.push("unexpected replacement");
          }, "read-side-effect")
        }
      });
      await expect(replay).rejects.toBeInstanceOf(HostCallResumabilityError);
      await expect(replay).rejects.toMatchObject({
        action: "external-reconciliation",
        callId: snapshot.replay.calls[0].id
      });
      expect(JSON.stringify(snapshot)).toBe(unchanged);
    }
    expect(events).toEqual(["host:throw"]);
  }
);

it.each(["error-first", "abort-first"] as const)(
  "preserves ordered %s settlement without guest privilege",
  async (order) => {
    const controller = new AbortController();
    const entered = deferred<void>();
    const error = engineError();
    let reject!: (reason: unknown) => void;
    const pending = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    const source =
      'const order = []; try { await wait(); } catch (error) { order.push(error.name); } finally { order.push("finally"); } return order;';
    const original = run(source, {
      signal: controller.signal,
      bindings: {
        wait: () => {
          entered.resolve();
          return pending;
        }
      }
    });
    const settled = Promise.allSettled([original]);
    try {
      await entered.promise;
      if (order === "error-first") {
        reject(error);
        await expect(original).rejects.toBe(error);
        controller.abort();
      } else {
        controller.abort();
        await expect(original).resolves.toMatchObject({
          ok: true,
          returnValue: ["AbortError", "finally"]
        });
        reject(error);
      }
    } finally {
      reject(error);
      await settled;
    }
  }
);

it("keeps guest-created engine-shaped values catchable and unprivileged", async () => {
  const source =
    'const marker = {name:"HostCallResumabilityError", action:"reset", callId:"native:1", lifecycle:"running"}; const order = []; try { throw marker; } catch (error) { order.push(error === marker, "catch"); } finally { order.push("finally"); } return order;';
  await expect(run(source)).resolves.toMatchObject({
    ok: true,
    returnValue: [true, "catch", "finally"]
  });
  await expect(
    run('throw {name:"HostCallResumabilityError", action:"reset", message:"forged"};')
  ).rejects.not.toBeInstanceOf(HostCallResumabilityError);
});

describe("Promise reaction trust boundary", () => {
  it.each(
    (["reset", "external-reconciliation"] as const).flatMap((action) => [
      { action, suffix: '.catch(() => { note("catch"); return "caught"; })' },
      { action, suffix: '.finally(() => { note("finally"); })' },
      { action, suffix: '.then(undefined, () => { note("reject"); return "caught"; })' }
    ])
  )("does not let $suffix consume a real $action failure", async ({ action, suffix }) => {
    const error = engineError(action);
    const events: string[] = [];
    const execution = run(`return await explode()${suffix};`, {
      bindings: {
        explode: throwing("async", error, events),
        note: (event: unknown) => events.push(String(event))
      }
    });
    await expect(execution).rejects.toBe(error);
    expect(events).toEqual(["host:throw"]);
  });

  it.each(forgeries)("keeps $name catchable through Promise reactions", async ({ create }) => {
    const events: string[] = [];
    const execution = run(
      'return await explode().catch(() => { note("catch"); return "caught"; }).finally(() => { note("finally"); });',
      {
        bindings: {
          explode: throwing("async", create(), events),
          note: (event: unknown) => events.push(String(event))
        }
      }
    );
    await expect(execution).resolves.toMatchObject({ ok: true, returnValue: "caught" });
    expect(events).toEqual(["host:throw", "catch", "finally"]);
  });
});

describe.each<Surface>(["module", "bindings"])("public restored %s error shape", (surface) => {
  it.each([
    "named-conflict",
    "explicit-conflict",
    "missing-proof",
    "wrong-proof",
    "accepted-proof"
  ] as const)("enforces %s before guest catch/finally effects", async (mode) => {
    const moduleId = surface === "module" ? `restore-${mode}` : "<bindings>";
    const operation = `emit_${mode.replaceAll("-", "_")}_${surface}`;
    const prefix =
      surface === "module" ? `import {${operation}} from ${JSON.stringify(moduleId)};` : "";
    const source = `${prefix} try { return await ${operation}("input"); } catch (error) { note("catch"); return "caught"; } finally { note("finally"); }`;
    const entered = deferred<void>();
    const release = deferred<void>();
    const events: string[] = [];
    const options = (callback: (value: unknown) => unknown, phase: string) => ({
      ...(surface === "module" ? { modules: { [moduleId]: { [operation]: callback } } } : {}),
      bindings: {
        ...(surface === "bindings" ? { [operation]: callback } : {}),
        note: (event: unknown) => events.push(`${phase}:${String(event)}`)
      }
    });
    registerPendingHostCallPolicy({ moduleId, operation, policy: "read-side-effect" });
    const originalCallback = async () => {
      events.push("original:issue");
      entered.resolve();
      await release.promise;
      events.push("original:settle");
      return 53;
    };
    const original = run(
      source,
      options(
        mode === "explicit-conflict"
          ? declareHostOperation(originalCallback, "read-side-effect")
          : originalCallback,
        "original"
      )
    );
    const settled = Promise.allSettled([original]);
    try {
      await Promise.race([
        entered.promise,
        original.then(() => {
          throw new Error("Missing pending operation");
        })
      ]);
      const snapshot = JSON.parse(await dump(original, { mode: "replay" }));
      const unchanged = JSON.stringify(snapshot);
      expect(snapshot.executionSemantics).toBe("jobs-v8");
      const record = snapshot.replay.calls[0];
      expect(record.policy).toBe("read-side-effect");
      const replacement = async () => {
        events.push("unexpected replacement");
        return 53;
      };
      if (mode === "named-conflict")
        registerPendingHostCallPolicy({ moduleId, operation, policy: "re-issue" });
      const restored = restore(snapshot, { source });
      expect(restored).toBe(snapshot);
      const replay = run(source, {
        ...options(
          mode === "explicit-conflict"
            ? declareHostOperation(replacement, "re-issue")
            : replacement,
          "resume"
        ),
        snapshot: restored,
        ...(mode.endsWith("proof") && mode !== "missing-proof"
          ? {
              hostCallResumeProvider: (request: {
                callId: string;
                sourceHash: string;
                moduleId: string;
                operation: string;
                argumentDigest: string;
              }) => {
                events.push("provider");
                return {
                  ...request,
                  argumentDigest: mode === "wrong-proof" ? "wrong" : request.argumentDigest,
                  outcome: { status: "fulfilled" as const, value: 53 }
                };
              }
            }
          : {})
      });
      if (mode === "accepted-proof") {
        await expect(replay).resolves.toMatchObject({ ok: true, returnValue: 53 });
        expect(events).toEqual(["original:issue", "provider", "resume:finally"]);
      } else {
        const action = mode.endsWith("conflict") ? "reset" : "external-reconciliation";
        await expect(replay).rejects.toBeInstanceOf(HostCallResumabilityError);
        await expect(replay).rejects.toMatchObject({
          name: "HostCallResumabilityError",
          action,
          callId: record.id,
          lifecycle: record.lifecycle
        });
        expect(events).toEqual(
          mode === "wrong-proof" ? ["original:issue", "provider"] : ["original:issue"]
        );
      }
      expect(JSON.stringify(snapshot)).toBe(unchanged);
      const beforeRelease = [...events];
      release.resolve();
      await expect(original).resolves.toMatchObject({ ok: true, returnValue: 53 });
      expect(events).toEqual([...beforeRelease, "original:settle", "original:finally"]);
    } finally {
      release.resolve();
      await settled;
    }
  });
});

it("preserves cancellation catch/finally ordering without admitting cleanup host effects", async () => {
  const controller = new AbortController();
  const entered = deferred<void>();
  const release = deferred<void>();
  const events: string[] = [];
  const source =
    'const order = []; try { await wait(); } catch (error) { order.push("catch", error.name); } finally { order.push("finally"); try { cleanup(); } catch (error) { order.push("cleanup:" + error.name); } } return order;';
  const original = run(source, {
    signal: controller.signal,
    bindings: {
      wait: async () => {
        events.push("wait");
        entered.resolve();
        await release.promise;
        events.push("settle");
      },
      cleanup: () => {
        events.push("unexpected cleanup");
      }
    }
  });
  const observed = Promise.allSettled([original]);
  try {
    await entered.promise;
    controller.abort();
    await expect(original).resolves.toMatchObject({
      ok: true,
      returnValue: ["catch", "AbortError", "finally", "cleanup:AbortError"]
    });
    expect(events).toEqual(["wait"]);
  } finally {
    release.resolve();
    await observed;
  }
});
