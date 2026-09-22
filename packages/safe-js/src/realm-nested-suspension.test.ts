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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Cooperative host turns are allowed. Still detect a circular wait between
    // parent ownership and nested source instead of waiting indefinitely.
    expect(await Promise.race([settled, new Promise(resolve => {
      timer = setTimeout(() => resolve({ state: "pending" }), 1000);
    })]))
      .toMatchObject({ state: "settled", result: { ok: true, returnValue: 7 } });
  } finally { clearTimeout(timer); await realm.close(); await settled; }
});
