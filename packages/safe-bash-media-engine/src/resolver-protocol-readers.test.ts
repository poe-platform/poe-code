import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('keeps cwd AVIO dash filenames explicit in concatf and HLS key-info readers', async () => {
  for (const [grammar, content] of [['concatf', '-\npipe:3\n'], ['hls-key-info', 'https://cdn/key\n-\n']] as const) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar });
    const children = await resolver.content(root.id, { content: b(content) });
    expect([children[0].kind, t(children[0].location), children[0].literal]).toEqual(['path', '/work/-', true]);
    if (grammar === 'concatf') expect(children[1].kind).toBe('descriptor');
  }
});

it('opens protocol wrapper members using their own reader base rather than the enclosing playlist', async () => {
  for (const value of ['concat:clip.ppm|clip.ppm', 'cache:clip.ppm', 'async:clip.ppm', 'crypto:clip.ppm']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
    const [wrapper] = await resolver.content(root.id, { content: b(`file '${value}'\n`) });
    const members = resolver.graph().nodes.filter(node => node.parent === wrapper.id);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every(node => t(node.location) === '/work/clip.ppm')).toBe(true);
    expect(members.every(node => node.base.kind === 'directory' && t(node.base.value) === '/work')).toBe(true);
    expect(t(wrapper.base.value)).toBe('/work/lists/root');
  }
});

it('uses concat protocol separator runs without inventing empty trailing accesses', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('concat:a|||b||a|'), access: 'read-write' });
  const graph = resolver.graph();
  const members = graph.nodes.filter(node => node.parent === root.id);
  expect(members.map(node => t(node.original))).toEqual(['a', 'b', 'a']);
  expect(members.every(node => node.access === 'read-write')).toBe(true);
  expect(graph.edges.filter(edge => edge.kind === 'before')).toEqual([
    { from: members[0].id, to: members[1].id, kind: 'before' },
    { from: members[1].id, to: members[2].id, kind: 'before' },
  ]);
});

it('preserves crypto nested-scheme signed operands and selects crypto protocol policy', async () => {
  const resolver = new DependencyResolver({ ...options, policy: { allow: ['crypto', 'https'], deny: ['https'] } });
  const root = await resolver.add({ value: b('crypto+https://cdn/clip?sig=a+%2F#part'), access: 'read' });
  const graph = resolver.graph();
  const members = graph.nodes.filter(node => node.parent === root.id);
  expect(members.map(node => [t(node.original), t(node.location), node.kind, node.upload])).toEqual([
    ['https://cdn/clip?sig=a+%2F#part', 'https://cdn/clip?sig=a+%2F#part', 'url', false],
  ]);
  expect(graph.issues.filter(issue => issue.reason === 'policy').map(issue => issue.node)).toEqual([members[0].id]);
});

it('observes concatf lists using av_get_token lines and cwd member semantics', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('concatf:lists/files'), access: 'read' });
  const [list] = resolver.graph().nodes.filter(node => node.parent === root.id);
  expect(list?.grammar).toBe('concatf');
  expect(t(list?.location)).toBe('/work/lists/files');
  const members = await resolver.content(list.id, { content: b(" '雪\nCase.ppm'\r\nhttps://cdn/a?sig=a+%2F#f\nclip\\ name.ppm\nclip\\ name.ppm\n \t\r\n") });
  expect(members.map(node => [t(node.original), t(node.location)])).toEqual([
    ['雪\nCase.ppm', '/work/雪\nCase.ppm'],
    ['https://cdn/a?sig=a+%2F#f', 'https://cdn/a?sig=a+%2F#f'],
    ['clip name.ppm', '/work/clip name.ppm'], ['clip name.ppm', '/work/clip name.ppm'],
  ]);
  expect(members.every(node => node.live && !node.upload && node.access === 'read')).toBe(true);
  const changed = await resolver.content(list.id, { content: b('case.ppm\n') });
  expect(t(changed[0].location)).toBe('/work/case.ppm');
});

it('reports concatf truncation as incomplete when the explicit node budget is exhausted', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 3 } });
  const root = await resolver.add({ value: b('concatf:files'), access: 'read' });
  const [list] = resolver.graph().nodes.filter(node => node.parent === root.id);
  expect(list?.grammar).toBe('concatf');
  await resolver.content(list.id, { content: b('a\nb\nc\n') });
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues.some(issue => issue.reason === 'budget')).toBe(true);
});

it('stops concatf discovery at NUL while charging the complete observed buffer', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('concatf:files'), access: 'read' });
  const [list] = resolver.graph().nodes.filter(node => node.parent === root.id);
  const members = await resolver.content(list.id, { content: b('a\n\0not-a-dependency\n') });
  expect(members.map(node => t(node.original))).toEqual(['a']);
  const limited = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 100 } });
  const entry = await limited.add({ value: b('concatf:files'), access: 'read' });
  const [capture] = limited.graph().nodes.filter(node => node.parent === entry.id);
  await limited.content(capture.id, { content: b('a\n\0' + 'x'.repeat(100)) });
  expect(limited.graph().status).toBe('incomplete');
  expect(limited.graph().issues.some(issue => issue.reason === 'budget')).toBe(true);
});

it('detects concatf ancestor cycles without dropping shared independent list captures', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('concatf:files'), access: 'read' });
  const [list] = resolver.graph().nodes.filter(node => node.parent === root.id);
  const members = await resolver.content(list.id, { content: b('concatf:files\nconcatf:other\nconcatf:other\n') });
  const nested = members.map(member => resolver.graph().nodes.find(node => node.parent === member.id)!);
  expect(await resolver.content(nested[0].id, { content: b('concatf:files\n') })).toEqual([]);
  expect(resolver.graph().issues.some(issue => issue.reason === 'cycle')).toBe(true);
  for (const capture of nested.slice(1)) {
    const [leaf] = await resolver.content(capture.id, { content: b('clip.ppm\n') });
    expect(t(leaf.location)).toBe('/work/clip.ppm');
  }
  expect(resolver.graph().nodes.filter(node => t(node.original) === 'clip.ppm')).toHaveLength(2);
});

it('retains initial empty concat accesses and enforces protocol nesting and node budgets', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('concat:||a|'), access: 'read' });
  expect(resolver.graph().nodes.filter(node => node.parent === root.id).map(node => t(node.original))).toEqual(['', 'a']);
  for (const [value, budgets] of [
    ['cache:async:concat:a|b', { ...options.budgets, depth: 1 }],
    ['concat:' + Array.from({ length: 1000 }, () => 'a').join('|'), { ...options.budgets, nodes: 3 }],
  ] as const) {
    const limited = new DependencyResolver({ ...options, budgets });
    await limited.add({ value: b(value), access: 'read' });
    expect(limited.graph().status).toBe('incomplete');
    expect(limited.graph().issues.some(issue => issue.reason === 'budget')).toBe(true);
  }
});
