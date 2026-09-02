import assert from "node:assert/strict";
import { Budget, createRealm, defineExtension, run } from "@poe-platform/safe-js/core";

let dispatch;
let disposed = 0;
const dom = defineExtension({
  manifest: {
    version: 1,
    name: "consumer-dom",
    capabilities: ["dom", "source:nested"],
    globals: ["document"],
    modules: { dom: ["button"] }
  },
  setup(context) {
    let text = "ready";
    let listener;
    const button = context.createHostObject({
      properties: {
        textContent: {
          get: () => text,
          set: (value) => {
            text = String(value);
          }
        }
      },
      methods: {
        addEventListener(name, callback) {
          assert.equal(name, "click");
          listener = callback;
        }
      }
    });
    dispatch = () => context.invokeCallback(listener, { thisValue: button });
    context.onCleanup(async () => {
      await Promise.resolve();
      disposed++;
    });
    return {
      globals: {
        document: context.createHostObject({
          methods: {
            querySelector: (selector) => (selector === "#go" ? button : null),
            write: context.nestedOperation((source) => {
              void context.evaluateNested(source);
            })
          }
        })
      },
      modules: { dom: { button } }
    };
  }
});

const realm = createRealm({
  extensions: [dom],
  grants: ["dom", "source:nested"],
  budget: new Budget({ maxSteps: 20_000, maxCallDepth: 100, dataSize: 100_000 })
});
try {
  assert.equal(
    (
      await realm.evaluate(`
    const button = document.querySelector('#go');
    let clicks = 0;
    button.addEventListener('click', function () {
      clicks++;
      this.textContent = 'clicked ' + clicks;
    });
  `)
    ).ok,
    true
  );
  await dispatch();
  await dispatch();
  const result = await realm.evaluate(`
    import { button as imported } from 'dom';
    let written = 0;
    document.write('for (let index = 0; index < 5; index++) written += 1;');
    return [button.textContent, clicks, button === imported, written,
      document.constructor, document.__proto__, typeof process];
  `);
  assert.equal(result.ok, true);
  assert.deepEqual(result.returnValue, [
    "clicked 2",
    2,
    true,
    5,
    undefined,
    undefined,
    "undefined"
  ]);
} finally {
  await realm.close();
}
assert.equal(disposed, 1);
await assert.rejects(dispatch(), /closed|revoked/);

const answer = defineExtension({
  manifest: { version: 1, name: "answer", globals: ["answer"] },
  setup: () => ({ globals: { answer: () => 42 } })
});
assert.equal((await run("return answer();", { extensions: [answer] })).returnValue, 42);
console.log("Public realm DOM-like adapter, callbacks, nested ordering and cleanup passed");
