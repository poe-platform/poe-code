import assert from "node:assert/strict";

for (const entry of ["@poe-platform/safe-js/core", "@poe-platform/safe-js"]) {
  const { createRealm, defineExtension, run } = await import(entry);
  const journals = [];
  let cleanups = 0;
  const extension = defineExtension({
    manifest: { version: 1, name: "browser-console", capabilities: ["journal"], globals: ["console", "window", "self"] },
    setup(context) {
      const journal = [];
      journals.push(journal);
      context.onCleanup(() => { cleanups++; });
      const console = context.createHostObject({ methods: {
        log: (...args) => { context.chargeWork(); journal.push(args); },
        warn: (...args) => { context.chargeWork(); journal.push(args); },
        count: () => journal.length
      } });
      const window = context.createHostObject({ properties: { console: { get: () => console } } });
      return { globals: { console, window, self: window } };
    }
  });
  assert.throws(() => createRealm({ extensions: [extension], grants: ["journal"] }), /Conflicting/);
  assert.throws(() => createRealm({ extensions: [extension], builtinOverrides: { console: "browser-console" } }), /Missing grant/);
  assert.equal(journals.length, 0);
  const options = { extensions: [extension], grants: ["journal"], builtinOverrides: { console: "browser-console" } };
  const unused = createRealm(options);
  await unused.close();
  assert.equal(cleanups, 0);
  const first = createRealm(options);
  const second = createRealm(options);
  let callback;
  try {
    const result = await first.evaluate('const saved = console; console.log("one"); window.console.warn("two"); return [console === window.console, console === self.console, console.log === self.console.log];');
    assert.equal(result.ok, true);
    assert.deepEqual(result.returnValue, [true, true, true]);
    const retained = await first.evaluate('return () => saved.log("callback");');
    assert.equal(retained.ok, true);
    callback = retained.returnValue;
    await first.invokeCallback(callback);
    await second.evaluate('self.console.log("independent");');
    assert.deepEqual(journals, [[["one"], ["two"], ["callback"]], [["independent"]]]);
  } finally { await first.close(); await second.close(); }
  assert.equal(cleanups, 2);
  await assert.rejects(first.invokeCallback(callback), /closed/);
  const oneShot = await run('console.warn("one-shot"); return console === self.console;', options);
  assert.equal(oneShot.ok, true);
  assert.equal(oneShot.returnValue, true);
  assert.equal(cleanups, 3);
}
console.log("Public owned console authorization, aliases, isolation and cleanup passed");
