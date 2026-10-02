import { expect, it } from 'vitest';
import { build } from 'esbuild';
it('bundles the Worker composition with workerd conditions and no host imports', async () => {
  const result = await build({ entryPoints: ['deploy/composition.ts'], absWorkingDir: new URL('..', import.meta.url).pathname, platform: 'browser', conditions: ['workerd'], format: 'esm', bundle: true, write: false, metafile: true });
  expect(result.metafile!.outputs[Object.keys(result.metafile!.outputs)[0]!].imports.filter(item => ['node:fs', 'node:fs/promises', 'node:child_process', 'node:process'].includes(item.path))).toEqual([]);
  expect(Object.keys(result.metafile!.inputs).some(path => path.includes('sdk/bash') || path.includes('native-process') || path.includes('http-server'))).toBe(false);
});
it('bundles the full deployment without host filesystem or native launch code', async () => {
  const result = await build({ entryPoints: ['deploy/worker.ts'], absWorkingDir: new URL('..', import.meta.url).pathname, platform: 'browser', external: ['cloudflare:workers', 'node:*'], conditions: ['workerd'], format: 'esm', bundle: true, write: false, metafile: true });
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports.map(item => item.path));
  // Sandbox SDK uses Workers' supported path implementation. No other Node
  // module, including process or a host filesystem, belongs in this closure.
  expect(imports.filter(path => path.startsWith('node:') && path !== 'node:path/posix')).toEqual([]);
  expect(Object.keys(result.metafile!.inputs).filter(path => path.includes('native-process') || path.includes('http-server') || path.includes('sdk/bash'))).toEqual([]);
});
