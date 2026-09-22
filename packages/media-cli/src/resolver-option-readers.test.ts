import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('leaves the remainder of an unknown preset option to late access', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-fpre', 'preset', 'out'].map(b)), options);
  const root = resolver.graph().nodes.find(node => t(node.original) === 'preset')!;
  const children = await resolver.content(root.id, { content: b('attach=before.wav\nunknown_preset_option=value\nattach=late.wav\n') });
  expect(children.map(node => t(node.original))).toEqual(['before.wav']);
  expect(resolver.graph().issues.some(issue => issue.reason === 'syntax')).toBe(true);
});

it('omits unreachable preset resources after native exit handlers from the access graph', async () => {
  for (const key of ['version', 'noversion', 'no/version', 'version:0']) {
    const resolver = await createDependencyResolver(discover('ffmpeg', ['-fpre', 'preset', 'out'].map(b)), options);
    const root = resolver.graph().nodes.find(node => t(node.original) === 'preset')!;
    const children = await resolver.content(root.id, { content: b(`attach=before.wav\n${key}=ignored\nattach=unreachable.wav\n`) });
    expect(children.map(node => t(node.original)), key).toEqual(['before.wav']);
    expect(resolver.graph().issues.some(issue => issue.reason === 'live')).toBe(true);
  }
});

it('predicts sequential preset no-prefixed attachments without opening resources', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-fpre', 'presets/root', 'out.mkv'].map(b)), options);
  const root = resolver.graph().nodes.find(node => t(node.original) === 'presets/root')!;
  const children = await resolver.content(root.id, { content: b('noss=0.02\nnoattach=assets/in.wav\nnofpre=nested\n') });
  expect(children.map(node => [t(node.original), node.kind, t(node.location), node.access])).toEqual([
    ['assets/in.wav', 'path', '/work/assets/in.wav', 'read'],
    ['nested', 'resource-lookup', undefined, 'read'],
  ]);
});

it('uses native preset read boundaries for graph occurrences and nested readers', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-fpre', 'preset', 'out'].map(b)), options);
  const root = resolver.graph().nodes.find(node => t(node.original) === 'preset')!;
  const children = await resolver.content(root.id, { content: b('/attach=name.txt\rignored\nattach=first\0ignored\nattach=\nattach=unreachable\n') });
  expect(children.map(node => [t(node.original), t(node.location)])).toEqual([
    ['name.txt', '/work/name.txt'], ['first', '/work/first'],
  ]);
  expect(resolver.graph().issues.some(issue => issue.reason === 'syntax')).toBe(true);
});

it('uses the selected slash-loaded attachment reader with cwd and C-string semantics', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'clip', '-/attach', 'options/name', 'out'].map(b)), options);
  const root = resolver.graph().nodes.find(node => t(node.original) === 'options/name')!;
  const children = await resolver.content(root.id, { content: b('雪\nprofile:one.icc\0ignored.icc') });
  expect(children.map(node => [t(node.original), t(node.location), node.literal, node.access])).toEqual([
    ['雪\nprofile:one.icc', '/work/雪\nprofile:one.icc', undefined, 'read'],
  ]);
  expect(resolver.graph().edges).toContainEqual({ from: root.id, to: children[0].id, kind: 'depends-on' });
});

it('keeps slash-loaded ffprobe output timing and signed input URL semantics', async () => {
  const resolver = await createDependencyResolver(discover('ffprobe', ['-/o', 'output-name', '-/i', 'input-name'].map(b)), options);
  const roots = resolver.graph().nodes;
  const writes = await resolver.content(roots.find(node => t(node.original) === 'output-name')!.id, { content: b('result\n.json') });
  const reads = await resolver.content(roots.find(node => t(node.original) === 'input-name')!.id, { content: b('https://cdn/clip?sig=x+%2F#frag') });
  expect(writes.map(node => [t(node.location), node.access])).toEqual([['/work/result\n.json', 'write']]);
  expect(reads.map(node => [t(node.location), node.kind, node.upload])).toEqual([['https://cdn/clip?sig=x+%2F#frag', 'url', false]]);
});

it('retains recursive preset option-file readers and their per-reader resolution bases', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'clip', '-fpre', 'presets/root', 'out'].map(b)), options);
  const root = resolver.graph().nodes.find(node => t(node.original) === 'presets/root')!;
  const [loaded] = await resolver.content(root.id, { content: b('/attach=options/profile\n') });
  expect(t(loaded.location)).toBe('/work/options/profile');
  const children = await resolver.content(loaded.id, { content: b('profiles/display.icc') });
  expect(children.map(node => t(node.location))).toEqual(['/work/profiles/display.icc']);
});

it('stops an observed filter script at its native C-string boundary', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'clip', '-/vf', 'graphs/root', 'out'].map(b)), options);
  const root = resolver.graph().nodes.find(node => t(node.original) === 'graphs/root')!;
  const children = await resolver.content(root.id, { content: b('lut3d=first.cube\0, movie=absent.mov') });
  expect(children.map(node => t(node.original))).toEqual(['first.cube']);
});
