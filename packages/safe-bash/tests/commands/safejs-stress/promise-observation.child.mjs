import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const load = name => import(pathToFileURL(join(process.env.SAFEJS_LOCAL_ROOT, "src", name)).href);
const { createSandboxClosure, createSandboxPromise } = await load("interp/values.ts");
const { wrapCancelableBindings } = await load("interp/cancel.ts");
for (const mode of ["raw-immediate", "sandbox-immediate", "raw-delayed", "sandbox-delayed", "preexisting"]) {
  const controller = new AbortController();
  const reason = new Error(`abort ${mode}`);
  const originalAdd = controller.signal.addEventListener.bind(controller.signal);
  const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
  const listeners = new Set();
  controller.signal.addEventListener = (type, listener, options) => {
    if (type === "abort") listeners.add(listener);
    return originalAdd(type, listener, options);
  };
  controller.signal.removeEventListener = (type, listener, options) => {
    if (type === "abort") listeners.delete(listener);
    return originalRemove(type, listener, options);
  };
  let rejectOriginal;
  const original = new Promise((resolve, reject) => { rejectOriginal = reject; });
  const span = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };
  const metadata = { span };
  if (mode === "preexisting") {
    controller.abort(reason);
    const wrapped = wrapCancelableBindings({ existing: createSandboxPromise(original, metadata) }, controller.signal).existing;
    assert.equal(wrapped.span, span);
    rejectOriginal(new Error("unobserved original is a bug"));
    await assert.rejects(wrapped.promise, error => error === reason);
  } else {
    const closure = createSandboxClosure({
      async: true,
      call() {
        if (mode.endsWith("immediate")) {
          controller.abort(reason);
          rejectOriginal(new Error("unobserved original is a bug"));
        }
        return mode.startsWith("sandbox") ? createSandboxPromise(original, metadata) : original;
      },
    });
    const result = wrapCancelableBindings({ closure }, controller.signal).closure.call([]);
    if (mode.startsWith("sandbox")) assert.equal(result.span, span);
    const rejection = assert.rejects(mode.startsWith("sandbox") ? result.promise : result, error => error === reason);
    if (mode.endsWith("delayed")) {
      controller.abort(reason);
      await delay(5);
      rejectOriginal(new Error("late original is observed"));
    }
    await rejection;
  }
  await delay(10);
  assert.equal(listeners.size, 0, mode);
  console.log(`observed ${mode}; exact abort; no listeners`);
}
console.log("all promise observation variants completed");
