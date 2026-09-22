import { expect, it } from 'vitest';
import { build } from 'esbuild';

it('keeps the portable media frontend independent of shell implementations and contracts', async () => {
  const result = await build({ entryPoints: [new URL('./index.ts', import.meta.url).pathname],
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.filter(input => input.includes('/safe-bash/') || input.includes('/safe-bash-contracts/'))).toEqual([]);
});
