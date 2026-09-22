import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

it('owns effective manifest location bytes while content parsing yields', async () => {
  const encoder = new TextEncoder();
  const resolver = new DependencyResolver({ cwd: encoder.encode('/work'), budgets: { nodes: 8, bytes: 1024, depth: 8, symlinks: 8 } });
  const root = await resolver.add({ value: encoder.encode('https://origin/master'), access: 'read', grammar: 'hls' });
  const producer = Buffer.from('https://cdn/dir/master');
  const pending = resolver.content(root.id, { location: producer, content: encoder.encode('#EXTM3U\nsegment.ts\n') });
  producer.fill(120);
  const children = await pending;
  expect(new TextDecoder().decode(children[0].base.value)).toBe('https://cdn/dir/master');
  expect(new TextDecoder().decode(children[0].location)).toBe('https://cdn/dir/segment.ts');
});
