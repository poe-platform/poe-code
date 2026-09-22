import { expect, it } from "vitest";
import { createRealm } from "./realm.js";
import { defineExtension } from "./extensions.js";

it.each([
  ["() => 7", 7],
  ["async () => { await 0; return 7; }", 7],
  ["() => Promise.resolve(7)", 7],
  ["() => ({ then(resolve) { resolve(7); } })", 7],
  ["() => {}", undefined],
  ["() => helper(6)", 7],
  ["() => ({ value: 7 })", { value: 7 }]
])("settles an authorized host call's regular callback result: %s", async (callback, expected) => {
  const realm = createRealm({
    grants: ["source:nested"],
    extensions: [
      defineExtension({
        manifest: {
          version: 1,
          name: "callback-result",
          capabilities: ["source:nested"],
          globals: ["dispatch", "helper"]
        },
        setup(context) {
          return {
            globals: {
              dispatch: context.nestedOperation((callback: unknown) =>
                context.invokeCallback(callback)
              ),
              helper: context.nestedOperation(async (value: number) => value + 1)
            }
          };
        }
      })
    ]
  });
  const execution = realm.evaluate(
    `const value=dispatch(${callback});return [value,value instanceof Promise];`
  );
  const settled = execution.then(
    (result) => ({ state: "settled", result }),
    (error) => ({ state: "failed", error })
  );
  try {
    expect(
      await Promise.race([
        settled,
        new Promise((resolve) => setImmediate(() => resolve({ state: "pending" })))
      ])
    ).toMatchObject({ state: "settled", result: { ok: true, returnValue: [expected, false] } });
  } finally {
    await realm.close();
    await settled;
  }
});
