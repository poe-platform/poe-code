import { expect, it } from "vitest";
import { run } from "../src/run.js";
import { SandboxPromiseRejectionTracker } from "../src/interp/promise-tracker.js";
import { createSandboxPromise } from "../src/interp/values.js";

// HostPromiseRejectionTracker is host-defined (ECMA-262 16, 27.2.1.9).
// These assertions qualify SafeJS embedding policy, not ECMAScript conformance.
it("reports an unobserved rejection at run completion", async () => {
  await expect(run("Promise.reject('reason'); return 1;")).rejects.toMatchObject({
    name: "UnhandledRejectionError",
    reason: "reason"
  });
});

it("accepts a handler attached after rejection but before run completion", async () => {
  expect(
    await run("const p=Promise.reject('reason'); await 0; return await p.catch(e=>'handled:'+e);")
  ).toMatchObject({ ok: true, returnValue: "handled:reason" });
});

it("tracks the rejection propagated to an unhandled derived promise", async () => {
  await expect(run("Promise.reject('reason').then(); return 1;")).rejects.toMatchObject({
    name: "UnhandledRejectionError",
    reason: "reason"
  });
});

it("late observation clears the tracker report without undoing an earlier report", async () => {
  const tracker = new SandboxPromiseRejectionTracker();
  const promise = createSandboxPromise(Promise.reject("reason"));
  tracker.track(promise);
  const first = await tracker.findUnhandledRejection();
  expect(first).toMatchObject({ reason: "reason" });
  tracker.observe(promise);
  expect(await tracker.findUnhandledRejection()).toBeUndefined();
  expect(first).toMatchObject({ reason: "reason" });
});
