import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver, DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['[link\\]one]', "[link']'one]"])('uses native link-label quoting for %s before resource readers', async label => {
  const graph = label + "lut3d=file='profiles/Case雪.cube',subtitles=filename='subs/case.srt'";
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', graph, 'out'].map(b)), options);
  expect(resolver.graph().nodes.filter(node => node.access === 'read').map(node => t(node.location))).toEqual([
    '/work/profiles/Case雪.cube', '/work/subs/case.srt',
  ]);
  expect(resolver.graph().status).toBe('live');
});

it.each(['filter', 'preset'] as const)('retains %s label grammar on changed captures and signed movie resources', async grammar => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('elsewhere/script'), access: 'read', grammar });
  const signed = 'https\\://cdn/movie?sig=+%2f#part';
  for (const spelling of ['Case雪', 'case雪']) {
    const name = spelling + (grammar === 'filter' ? '\n' : '') + '.cube';
    const graph = "[link']'one]lut3d=file='" + name + "';amovie=filename='" + signed + "'";
    const nodes = await resolver.content(root.id, { content: b((grammar === 'preset' ? 'vf=' : '') + graph) });
    expect(nodes.map(node => [t(node.original), t(node.location), node.kind])).toEqual([
      [name, '/work/' + name, 'path'],
      ['https://cdn/movie?sig=+%2f#part', 'https://cdn/movie?sig=+%2f#part', 'url'],
    ]);
    expect(nodes.every(node => node.live && !node.upload && node.parent === root.id)).toBe(true);
  }
  expect(resolver.graph().status).toBe('live');
});

it.each(['[]', '[   ]', '[missing', "[quoted']'"])('marks a malformed label %s incomplete while retaining preceding hints', async label => {
  const graph = 'lut3d=file=first.cube;' + label;
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-vf', graph, 'out'].map(b)), options);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
  expect(resolver.graph().nodes.some(node => t(node.original) === 'first.cube')).toBe(true);
  const observed = new DependencyResolver(options);
  const root = await observed.add({ value: b('script'), access: 'read', grammar: 'filter' });
  expect((await observed.content(root.id, { content: b(graph) })).map(node => t(node.original))).toEqual(['first.cube']);
  expect(observed.graph().status).toBe('incomplete');
});

it('does not parse link-looking bytes after native C-string termination', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('script'), access: 'read', grammar: 'filter' });
  const nodes = await resolver.content(root.id, { content: b('lut3d=file=first.cube\0[bad') });
  expect(nodes.map(node => t(node.original))).toEqual(['first.cube']);
  expect(resolver.graph().status).toBe('live');
});

it.each(['ffmpeg', 'ffprobe'] as const)('keeps escaped labels and syntax diagnostics in %s lavfi inputs', async tool => {
  const valid = await createDependencyResolver(discover(tool, ['-f', 'lavfi', '-i', "color[link\\]one];[link\\]one]lut3d=file=Case.cube"].map(b)), options);
  expect(valid.graph().nodes.some(node => t(node.original) === 'Case.cube')).toBe(true);
  expect(valid.graph().status).toBe('live');
  const invalid = await createDependencyResolver(discover(tool, ['-f', 'lavfi', '-i', 'color[]'].map(b)), options);
  expect(invalid.graph().status).toBe('incomplete');
  expect(invalid.graph().issues).toContainEqual(expect.objectContaining({ reason: 'syntax' }));
});

it.each(['vf=lut3d=file=Case.cube;[]', 'unknown-resolver-fixture=value'])('retains preset diagnostics for %s', async assignment => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('presets/job'), access: 'read', grammar: 'preset' });
  await resolver.content(root.id, { content: b(assignment) });
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: root.id, reason: 'syntax' }));
});
