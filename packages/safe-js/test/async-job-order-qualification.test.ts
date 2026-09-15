import { assert, describe, expect, it } from "vitest";
import { declareHostOperation, deepCopyFromSandbox, dump, restore, run } from "../src/index.js";
import { bounded, deferred } from "./fixtures/final-async-proof.js";

// ECMA-262 edition 16: Promise Resolve Functions, NewPromiseResolveThenableJob,
// NewPromiseReactionJob, Await, AsyncGeneratorYield, and AsyncIteratorClose.
// Literal traces are the oracle; native execution is an independent control.
const cases = [
  {
    name: "resolution is locked before a reentrant then getter",
    body: `let resolve; const p=new Promise(r=>{resolve=r});
      resolve({get then(){trace.push('get');resolve(99);return r=>{trace.push('call');r(7)}}});
      trace.push('sync');trace.push(await p);`,
    expected: ["get", "sync", "call", 7]
  },
  {
    name: "delegated generator return performs its separate absent-method await",
    body: `const delegate={ [Symbol.asyncIterator](){return this},next(){return {done:false}},
        get return(){trace.push('get return')} };
      async function* f(){trace.push('start');yield* delegate;}
      const ticks=Promise.resolve().then(()=>trace.push('tick 1')).then(()=>trace.push('tick 2')).then(()=>trace.push('tick 3'));
      const g=f();const first=g.next();const last=g.return({get then(){trace.push('get then')}});
      await ticks;await first;await last;`,
    expected: ["start", "tick 1", "get then", "tick 2", "get return", "get then", "tick 3"]
  },
  {
    name: "queued generator return reads a non-callable then only once",
    body: `async function* f(){ trace.push('start'); yield 123; }
      const ticks=Promise.resolve().then(()=>trace.push('tick 1')).then(()=>trace.push('tick 2'));
      const g=f(); const first=g.next();
      const last=g.return({get then(){trace.push('get then')}});
      await ticks; await first; await last;`,
    expected: ["start", "tick 1", "get then", "tick 2"]
  },
  {
    name: "executor prefix, nested thenables and reentrant resolution",
    body: `const p = new Promise(resolve => {
      trace.push('executor');
      resolve({ get then() { trace.push('get'); return r => {
        trace.push('outer'); r({ then(s) { trace.push('inner'); s(7); } });
        r(99); throw 'ignored';
      }; } });
      trace.push('resolved');
    });
    const done = p.then(v => trace.push('value:' + v));
    trace.push('sync'); await done;`,
    expected: ["executor", "get", "resolved", "sync", "outer", "inner", "value:7"]
  },
  {
    name: "FIFO reactions including registration inside a reaction",
    body: `const p = Promise.resolve();
    const a = p.then(() => { trace.push('a'); p.then(() => trace.push('c')); });
    const b = p.then(() => trace.push('b'));
    trace.push('sync'); await a; await b;`,
    expected: ["sync", "a", "b", "c"]
  },
  {
    name: "async function synchronous prefix and await reaction order",
    body: `async function f() { trace.push('prefix'); await 0; trace.push('resume'); }
    const p = f(); trace.push('sync');
    const q = Promise.resolve().then(() => trace.push('reaction'));
    await p; await q;`,
    expected: ["prefix", "sync", "resume", "reaction"]
  },
  {
    name: "finally preserves fulfillment and replaces rejection",
    body: `trace.push(await Promise.resolve('kept').finally(() => 'ignored'));
    try { await Promise.reject('old').finally(() => Promise.reject('new')); }
    catch (e) { trace.push(e); }
    try { await Promise.resolve('old').finally(() => { throw 'thrown'; }); }
    catch (e) { trace.push(e); }`,
    expected: ["kept", "new", "thrown"]
  },
  {
    name: "combinator input ordering and empty completion",
    body: `let finish; const pending = new Promise(r => { finish = r; });
    const all = Promise.all([pending, Promise.resolve('second')]);
    const settled = Promise.allSettled([pending, Promise.reject('bad')]);
    const race = Promise.race([pending, Promise.resolve('winner')]);
    const any = Promise.any([Promise.reject('bad'), pending]);
    trace.push(await race); finish('first');
    trace.push((await all).join(','));
    trace.push((await settled).map(x => x.status).join(','));
    trace.push(await any); trace.push((await Promise.all([])).length);
    try { await Promise.any([]); } catch(e) { trace.push(e.errors.length); }`,
    expected: ["winner", "first,second", "fulfilled,rejected", "first", 0, 0]
  },
  {
    name: "queued async generator requests and for-await break cleanup",
    body: `async function* f() { try { trace.push('start'); yield 1; trace.push('next'); yield 2; }
      finally { await 0; trace.push('close'); } }
    const g = f(); const a = g.next(); const b = g.next();
    trace.push('sync'); trace.push((await a).value); trace.push((await b).value);
    await g.return();
    for await (const v of f()) { trace.push(v); break; }`,
    expected: ["start", "sync", "next", 1, 2, "close", "start", 1, "close"]
  }
];

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

describe("independent ECMAScript 2025 async ordering traces", () => {
  it.each(cases)(
    "$name: native, original, pending restore and completed replay",
    async ({ body, expected }) => {
      const source = `const trace = []; await gate(); ${body} return trace;`;
      expect(await new AsyncFunction("gate", source)(async () => undefined)).toEqual(expected);
      const entered = deferred<void>();
      const gate = deferred<void>();
      let calls = 0;
      const execution = run(source, {
        bindings: {
          gate: declareHostOperation(() => {
            calls++;
            entered.release();
            return gate.promise;
          }, "re-issue")
        }
      });
      await bounded(entered.promise, "gate entry");
      const pending = await bounded(dump(execution, { mode: "replay" }), "pending capture");
      gate.release();
      const original = await bounded(execution, "original trace");
      assert(original.ok, JSON.stringify(original));
      expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
      const resumed = await bounded(
        run(source, {
          snapshot: restore(JSON.parse(pending), { source }),
          bindings: {
            gate: declareHostOperation(() => {
              calls++;
              return Promise.resolve();
            }, "re-issue")
          }
        }),
        "pending restore trace"
      );
      assert(resumed.ok, JSON.stringify(resumed));
      expect(deepCopyFromSandbox(resumed.returnValue)).toEqual(expected);
      expect(calls).toBe(2);
      const completed = await bounded(dump(resumed), "completed capture");
      const replayed = await bounded(
        run(source, {
          snapshot: restore(JSON.parse(completed), { source }),
          bindings: {
            gate: declareHostOperation(() => {
              calls++;
              throw new Error("duplicate host operation");
            }, "re-issue")
          }
        }),
        "completed replay trace"
      );
      assert(replayed.ok, JSON.stringify(replayed));
      expect(deepCopyFromSandbox(replayed.returnValue)).toEqual(expected);
      expect(calls).toBe(2);
    }
  );
});

it.each([false, true])(
  "preserves shared callback mutations and host effects (already settled: %s)",
  async (settled) => {
    const source = `const state = { n: 0, trace: [] };
    await host(async () => {
      state.trace.push('prefix:' + ++state.n);
      await gate();
      await Promise.resolve().then(() => state.trace.push('reaction:' + ++state.n));
      state.trace.push('callback:' + ++state.n);
      return state.n;
    });
    state.trace.push('after:' + ++state.n);
    await effect(state.n);
    return state;`;
    const expected = { n: 4, trace: ["prefix:1", "reaction:2", "callback:3", "after:4"] };
    expect(
      await new AsyncFunction("host", "gate", "effect", source)(
        async (callback: () => unknown) => callback(),
        async () => undefined,
        async () => undefined
      )
    ).toEqual(expected);
    const gate = deferred<void>();
    const entered = deferred<void>();
    let hosts = 0;
    let gates = 0;
    let effects = 0;
    const bindings = {
      host: declareHostOperation(async (callback: () => Promise<unknown>) => {
        hosts++;
        return callback();
      }, "read-side-effect"),
      gate: declareHostOperation(() => {
        gates++;
        entered.release();
        return settled ? Promise.resolve() : gate.promise;
      }, "re-issue"),
      effect: declareHostOperation(() => {
        effects++;
        return Promise.resolve();
      }, "read-side-effect")
    };
    const execution = run(source, { bindings });
    await bounded(entered.promise, "callback gate");
    // A settled host promise cannot guarantee a pending capture. Capture the actual
    // completion in that cell; the deferred cell requires a genuinely pending host call.
    const pending = settled
      ? undefined
      : await bounded(dump(execution, { mode: "replay" }), "callback capture");
    gate.release();
    const original = await bounded(execution, "callback completion");
    assert(original.ok, JSON.stringify(original));
    expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
    let result = original;
    if (pending !== undefined) {
      result = await bounded(
        run(source, {
          bindings,
          snapshot: restore(JSON.parse(pending), { source }),
          hostCallResumeProvider: async (request, context) => {
            assert(context);
            expect(context.replayed).toHaveLength(1);
            const value = await context.replayed[0].result;
            await context.waitForCallbacks();
            return {
              ...request,
              callbackDisposition: "joined",
              outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
            };
          }
        }),
        "callback restoration"
      );
      assert(result.ok, JSON.stringify(result));
      expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
    }
    expect(hosts).toBe(1);
    expect(gates).toBe(settled ? 1 : 2);
    // effect is beyond the pending checkpoint, so it must execute in each live continuation.
    expect(effects).toBe(settled ? 1 : 2);
    const completed = await bounded(dump(result), "callback completed capture");
    const replayed = await bounded(
      run(source, {
        bindings,
        snapshot: restore(JSON.parse(completed), { source }),
        hostCallResumeProvider: () => {
          throw new Error("completed proof requested again");
        }
      }),
      "callback completed replay"
    );
    assert(replayed.ok, JSON.stringify(replayed));
    expect(deepCopyFromSandbox(replayed.returnValue)).toEqual(expected);
    expect(hosts).toBe(1);
    expect(gates).toBe(settled ? 1 : 2);
    expect(effects).toBe(settled ? 1 : 2);
  }
);

it.each([false, true])(
  "handles rejected host Promises in original and replay (settled: %s)",
  async (settled) => {
    // Host-operation failures are normalized by createHostErrorValue; this is
    // distinct from guest Promise.reject, whose primitive reason is preserved.
    const source = `const trace=['sync'];try{await gate()}catch(e){trace.push(e.name+':'+e.message)}return trace;`;
    const entered = deferred<void>();
    let reject!: (reason: string) => void;
    const promise = new Promise<never>((_, fail) => {
      reject = fail;
    });
    let calls = 0;
    const execution = run(source, {
      bindings: {
        gate: declareHostOperation(() => {
          calls++;
          entered.release();
          return settled ? Promise.reject("reason") : promise;
        }, "re-issue")
      }
    });
    await bounded(entered.promise, "rejected host entry");
    const pending = settled
      ? undefined
      : await bounded(dump(execution, { mode: "replay" }), "pending rejection capture");
    reject("reason");
    // Observe the unused test-controlled Promise in the already-settled cell.
    void promise.catch(() => undefined);
    let result = await bounded(execution, "host rejection");
    assert(result.ok);
    expect(deepCopyFromSandbox(result.returnValue)).toEqual(["sync", "Error:reason"]);
    const bindings = {
      gate: declareHostOperation(() => {
        calls++;
        return Promise.reject("reason");
      }, "re-issue")
    };
    if (pending !== undefined) {
      result = await bounded(
        run(source, { bindings, snapshot: restore(JSON.parse(pending), { source }) }),
        "rejected host restore"
      );
      assert(result.ok);
      expect(deepCopyFromSandbox(result.returnValue)).toEqual(["sync", "Error:reason"]);
    }
    const completed = await dump(result);
    const replayed = await bounded(
      run(source, { bindings, snapshot: restore(JSON.parse(completed), { source }) }),
      "rejected host replay"
    );
    assert(replayed.ok);
    expect(deepCopyFromSandbox(replayed.returnValue)).toEqual(["sync", "Error:reason"]);
    expect(calls).toBe(settled ? 1 : 2);
  }
);
