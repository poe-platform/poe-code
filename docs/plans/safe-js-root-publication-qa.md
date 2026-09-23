# Root SafeJS publication QA

Verify the root `poe-code` tarball before delivering a SafeJS dependency change.
Use an isolated consumer outside the checkout, with no ancestor `node_modules`,
`NODE_PATH`, source aliases, or separately installed SafeJS package. Keep temporary
logs and evidence in `/out` and remove them after recording the result.

1. Run `npm run build`, then `npm pack --ignore-scripts --pack-destination <artifact-directory>`.
2. Install that tarball in the isolated consumer using
   `npm install --omit=dev --ignore-scripts --no-audit --no-fund <tarball>`.
   Do not install polyfills by hand. Skipping scripts avoids global skill changes.
3. Run this module from that consumer under both Node and Bun. Record their versions.
   Also import `poe-code/safe-js/cli` and `poe-code/safejs/cli` to cover the other
   SafeJS files shipped in the root artifact.

```js
import assert from "node:assert/strict";

for (const specifier of ["poe-code/safe-js", "poe-code/safe-js/core", "poe-code/safejs", "poe-code/safejs/core"]) {
  const { run, Budget } = await import(specifier);
  let calls = 0;
  const result = await run(`
    const answer = await lookup(21);
    return [answer,
      new Float16Array([1.5])[0],
      Temporal.PlainDate.from('2026-09-23').add({ days: 1 }).toString(),
      new Intl.NumberFormat('en', { useGrouping: false }).format(1234.5),
      new Intl.PluralRules('en').select(2),
      new Intl.DurationFormat('en', { style: 'digital' }).format({ hours: 1, minutes: 2, seconds: 3 }),
      typeof process];
  `, {
    bindings: { lookup: async value => { calls++; await Promise.resolve(); return value * 2; } },
    budget: new Budget({ maxSteps: 20000, maxCallDepth: 100, dataSize: 1000000 })
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.returnValue, [42, 1.5, "2026-09-24", "1234.5", "other", "1:02:03", "undefined"]);
  assert.equal(calls, 1);
  await assert.rejects(run("while (true) {}", { budget: new Budget({ maxSteps: 100 }) }),
    error => error.code === "budgetExceeded" && error.budget === "steps");
  console.log(`${specifier}: async capability, polyfills, and Budget passed`);
}
await import("poe-code/safe-js/cli");
await import("poe-code/safejs/cli");
```

4. Compile the following consumer `.mts` file with TypeScript 5.9 or later,
   `--strict --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext`.
   Install the compiler and Node types in a separate toolchain directory; supply
   that directory's `@types` through `--typeRoots`. Do not enable `skipLibCheck`.
   Resolution must use the installed tarball's public exports.

```ts
import * as full from "poe-code/safe-js";
import * as core from "poe-code/safe-js/core";
import * as legacy from "poe-code/safejs";
import * as legacyCore from "poe-code/safejs/core";

for (const api of [full, core, legacy, legacyCore]) {
  const budget: InstanceType<typeof core.Budget> = new api.Budget({ maxSteps: 1000 });
  const extension: core.SafeJSExtension = api.defineExtension({
    manifest: { version: 1, name: "consumer", globals: ["lookup"] },
    setup: () => ({ globals: { lookup: async (value: number) => value * 2 } })
  });
  const result = await api.run("return await lookup(21);", { budget, extensions: [extension] });
  const ok: boolean = result.ok;
  void ok;
}
```

5. Review `dist/metafile.json`'s main, canonical Node, and canonical browser output
   imports. Every external package (including packages used by inlined private
   workspaces) must appear in the root runtime manifest; only Node builtins and
   validated public filesystem/native routes are exempt. Run `npm run lint:packages`
   to enforce this. Confirm the seven SafeJS workspace polyfill dependency ranges
   match the root runtime manifest.
6. Record runtime and typecheck results, then remove the consumer and temporary artifacts.
