# Root core import boundary native QA

1. Execute the original bundler control below independently using esbuild and Vitest from the repository root. Keep the original five-second deadline.
2. Verify the core graph contains `src/sdk/bash.ts` and excludes agent harness command source. Run the maintained normal build alongside this control to verify publication policy.
3. The fast unit suite retains all manifest/export/bin/package-file boundary assertions.
4. Store temporary evidence under `out` and purge it after verification.

```ts
import { build } from "esbuild";
import { expect, it } from "vitest";

it('wires the bash SDK while keeping agent harness commands outside its import graph', async () => {
  const result = await build({
    entryPoints: ['src/index.ts'], bundle: true, packages: 'external',
    platform: 'node', format: 'esm', write: false, metafile: true,
    loader: { '.md': 'text', '.mustache': 'text', '.log': 'text' },
  });
  expect(Object.keys(result.metafile!.inputs).filter(file => file.includes('/commands/harness'))).toEqual([]);
  expect(Object.keys(result.metafile!.inputs)).toContain('src/sdk/bash.ts');
});


```
