import { expect, it } from "vitest";
import { createRealm, defineExtension, run } from "../src/index.js";
import { bounded, deferred } from "./fixtures/final-async-proof.js";

it.each(["function", "generator"])(
  "cancellation finishes %s cleanup before returning",
  async (kind) => {
    const entered = deferred<void>();
    const controller = new AbortController();
    const source = `const trace=[];
    async function${kind === "generator" ? "*" : ""} f(){
      try { entered(); await new Promise(()=>{}); }
      finally { trace.push('finally'); }
    }
    try { await ${kind === "generator" ? "f().next()" : "f()"}; }
    catch(e) { trace.push(e.message); }
    return trace;`;
    const execution = run(source, {
      signal: controller.signal,
      bindings: { entered: () => entered.release() }
    });
    await bounded(entered.promise, "cancellation entry");
    controller.abort(new Error("stop"));
    expect(await bounded(execution, "cancellation cleanup")).toMatchObject({
      ok: true,
      returnValue: ["finally", "stop"]
    });
  }
);

it("realm close revokes guest host calls and waits for asynchronous extension cleanup", async () => {
  const entered = deferred<void>();
  const cleanupEntered = deferred<void>();
  const cleanupGate = deferred<void>();
  const late = deferred<void>();
  const events: string[] = [];
  let callback: unknown;
  const realm = createRealm({
    extensions: [
      defineExtension({
        manifest: { version: 1, name: "async-order-close", globals: ["save", "gate", "mark"] },
        setup(context) {
          context.onCleanup(async () => {
            events.push("cleanup:start");
            cleanupEntered.release();
            await cleanupGate.promise;
            events.push("cleanup:end");
          });
          return {
            globals: {
              save(value: unknown) {
                callback = value;
              },
              gate() {
                entered.release();
                return late.promise;
              },
              mark(value: string) {
                events.push(value);
              }
            }
          };
        }
      })
    ]
  });
  await realm.evaluate(
    "save(async()=>{try{await gate();mark('late');}finally{mark('finally');}});"
  );
  const invocation = realm.invokeCallback(callback);
  const rejection = expect(invocation).rejects.toThrow(/closed|aborted/i);
  await bounded(entered.promise, "realm callback entry");
  let closed = false;
  const closing = realm.close().then(() => {
    closed = true;
    events.push("closed");
  });
  await bounded(cleanupEntered.promise, "extension cleanup entry");
  expect(closed).toBe(false);
  cleanupGate.release();
  await bounded(closing, "realm close");
  await rejection;
  late.release();
  // Invocation is already settled; a host result delivered after close cannot
  // resume guest code. A second close is idempotent, not a timing delay.
  await realm.close();
  // RealmState.close marks the realm closed before aborting; assertOpen rejects
  // host calls even from a guest finally block. Extension cleanup retains its
  // explicitly granted host authority. Ordinary run cancellation is tested above.
  expect(events).toEqual(["cleanup:start", "cleanup:end", "closed"]);
  await expect(realm.invokeCallback(callback)).rejects.toThrow(/closed/i);
});

it.each([false, true])(
  "for-await cleanup awaits return and preserves throw precedence (%s)",
  async (throwing) => {
    const source = `const trace=[];
    const iterator={ [Symbol.asyncIterator](){return this;},
      next(){return Promise.resolve({done:false,value:1});},
      async return(){trace.push('close:start');await 0;trace.push('close:end');throw 'close';}
    };
    try { for await (const value of iterator) {trace.push(value);${throwing ? "throw 'body';" : "break;"}} }
    catch(e){trace.push(e);} return trace;`;
    const expected = [1, "close:start", "close:end", throwing ? "body" : "close"];
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    expect(await new AsyncFunction(source)()).toEqual(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  }
);
