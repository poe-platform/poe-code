import assert from "node:assert/strict";
import { Budget, createRealm, defineExtension } from "@poe-platform/safe-js/core";

let callback;
let args;
const timers = defineExtension({
  manifest: { version: 1, name: "timers", capabilities: ["guest:retain"], globals: ["timers"] },
  setup(context) {
    return {
      globals: {
        timers: context.createHostObject({
          methods: {
            schedule: context.retainGuestArguments((fn, delay, ...values) => {
              assert.equal(delay, 0);
              callback = fn;
              args = values;
            }, 2)
          }
        })
      }
    };
  }
});
const realm = createRealm({
  extensions: [timers],
  grants: ["guest:retain"],
  budget: new Budget({ maxSteps: 20_000, dataSize: 100_000 }),
  limits: { guestReferences: 10 }
});
try {
  assert.equal(
    (
      await realm.evaluate(`
    const argument = { value: 1 };
    argument.self = argument;
    const fn = () => argument.value;
    let observed;
    timers.schedule(function(value, closure, primitive, live) {
      observed = [value === argument, value.self === argument, this === argument,
        closure === fn, closure(), primitive, live === timers];
      value.value++;
    }, 0, argument, fn, 7, timers);
    argument.value = 8;
  `)
    ).ok,
    true
  );
  for (const reference of args) {
    assert.equal(Object.getPrototypeOf(reference), null);
    assert.equal(Object.isFrozen(reference), true);
    assert.deepEqual(Reflect.ownKeys(reference), []);
  }
  await realm.invokeCallback(callback, { args, thisValue: args[0] });
  const result = await realm.evaluate("return [observed, argument.value];");
  assert.equal(result.ok, true);
  assert.deepEqual(result.returnValue, [[true, true, true, true, 8, 7, true], 9]);
  for (const reference of args) realm.releaseGuestReference(reference);
  await assert.rejects(realm.invokeCallback(callback, { args }), /revoked/);
} finally {
  await realm.close();
}
console.log(
  "Public retained arguments preserve deferred identity, cycles, closures and live objects"
);
