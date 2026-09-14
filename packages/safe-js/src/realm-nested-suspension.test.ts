import { expect, it } from "vitest";
import { createRealm } from "./realm.js";
import { defineExtension } from "./extensions.js";

it.each(["value = 7", "await 0; value = 7"])("finishes authorized nested source before returning: %s", async source => {
  const realm = createRealm({
    grants: ["source:nested"],
    extensions: [defineExtension({
      manifest: { version: 1, name: "nested", capabilities: ["source:nested"], globals: ["nested"] },
      setup(context) { return { globals: { nested: context.nestedOperation(() => context.evaluateNested(source)) } }; }
    })]
  });
  const execution = realm.evaluate("let value = 0; nested(); return value;");
  const settled = execution.then(result => ({ state: "settled", result }), error => ({ state: "failed", error }));
  try {
    // No native I/O or timers: await 0 must settle through the microtask queue.
    expect(await Promise.race([settled, new Promise(resolve => setImmediate(() => resolve({ state: "pending" })))]))
      .toMatchObject({ state: "settled", result: { ok: true, returnValue: 7 } });
  } finally { await realm.close(); await settled; }
});
