import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['i', 'o'] as const)('reads duplicate slash -%s values without predicting access to their discarded filenames', async name => {
  const fs = Volume.fromJSON({ '/work/duplicate.option': 'unused.resource\0ignored' });
  const argv = [`-${name}`, 'retained.resource', `-/${name}`, 'duplicate.option'];
  const resolver = await createDependencyResolver(discover('ffprobe', argv.map(b)), {
    cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 },
  });
  const root = resolver.graph().nodes.find(node => Buffer.from(node.original).equals(b('duplicate.option')))!;
  expect(root.access).toBe('read');
  expect(await resolver.content(root.id, { content: fs.readFileSync('/work/duplicate.option') })).toEqual([]);
  expect(resolver.graph().nodes.map(node => node.original)).toEqual([
    b('duplicate.option'), b('retained.resource'),
  ]);
});

it.each(['i', 'o'] as const)('retains the first slash -%s value when its content is observed', async name => {
  const resolver = await createDependencyResolver(discover('ffprobe', [`-/${name}`, 'first.option', `-/${name}`, 'duplicate.option'].map(b)), {
    cwd: b('/work'), budgets: { nodes: 20, bytes: 10000, depth: 5, symlinks: 5 },
  });
  const [first, duplicate] = resolver.graph().nodes;
  // Observation order cannot change which callback retained the filename.
  expect(await resolver.content(duplicate.id, { content: b('unused.resource') })).toEqual([]);
  expect((await resolver.content(first.id, { content: b('retained.resource') })).map(node => [node.original, node.access])).toEqual([
    [b('retained.resource'), name === 'i' ? 'read' : 'write'],
  ]);
});
