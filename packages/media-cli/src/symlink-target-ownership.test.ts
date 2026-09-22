import { expect, it } from 'vitest';
import { traceLocal } from './resolution-path.js';

it('retains symlink target bytes when the metadata producer reuses its Buffer', async () => {
  const encoder = new TextEncoder();
  const producer = Buffer.from('/real');
  const result = await traceLocal(encoder.encode('/alias/file'), {
    cwd: encoder.encode('/'),
    budgets: { nodes: 8, bytes: 1024, depth: 8, symlinks: 8 },
    async link(path) {
      if (new TextDecoder().decode(path) === '/alias') return producer;
      producer.fill(120);
      return undefined;
    },
  }, 1024);
  expect(new TextDecoder().decode(result.location)).toBe('/real/file');
  expect(new TextDecoder().decode(result.trace[0].target)).toBe('/real');
});
