import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('resolves subfile members from the protocol reader cwd, preserving delimiter and filename bytes', async () => {
  for (const prefix of ['subfile:', 'subfile,,start,0,end,100,,:', 'subfile,;start;0;end;100;;:']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
    const [wrapper] = await resolver.content(root.id, { content: b(`file '${prefix}雪 Case.ppm'\n`) });
    const members = resolver.graph().nodes.filter(node => node.parent === wrapper.id);
    expect(members.map(node => [t(node.original), t(node.location), t(node.base.value), node.access])).toEqual([
      ['雪 Case.ppm', '/work/雪 Case.ppm', '/work', 'read'],
    ]);
    expect(t(wrapper.original)).toBe(prefix + '雪 Case.ppm');
    expect(t(wrapper.base.value)).toBe('/work/lists/root');
  }
});

it('preserves signed nested URLs and checks the inner protocol policy without metadata access', async () => {
  let calls = 0;
  const resolver = new DependencyResolver({ ...options, policy: { allow: ['subfile', 'https'], deny: ['https'] }, link: async () => { calls++; return undefined; } });
  const signed = 'https://cdn/a,b;雪?sig=a+%2F&next=../x#frame';
  const root = await resolver.add({ value: b('subfile,,start,0,,:'), access: 'read' });
  const wrapper = await resolver.add({ value: b('subfile,;start;0;;:' + signed), access: 'read' });
  const graph = resolver.graph();
  const [member] = graph.nodes.filter(node => node.parent === wrapper.id);
  expect([t(member?.original), t(member?.location), member?.kind]).toEqual([signed, signed, 'url']);
  expect(graph.issues).toContainEqual(expect.objectContaining({ node: member.id, reason: 'policy' }));
  expect(graph.nodes.filter(node => node.parent === root.id).map(node => t(node.original))).toEqual(['']);
  expect(calls).toBe(0);
  expect(graph.nodes.every(node => node.live && !node.upload)).toBe(true);
});

it('retains changing shared manifest occurrences, case distinctions and input/output aliases', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  for (const content of ['file subfile:Case.ppm\nfile subfile:case.ppm\n', 'file subfile:Case.ppm\n']) {
    await resolver.content(root.id, { content: b(content) });
  }
  await resolver.add({ value: b('Case.ppm'), access: 'write' });
  await resolver.observe({ value: b('Case.ppm'), access: 'read-write', sequence: 7 });
  const graph = resolver.graph();
  const aliases = graph.nodes.filter(node => t(node.location) === '/work/Case.ppm');
  expect(aliases.map(node => node.access)).toEqual(['read', 'read', 'write', 'read-write']);
  expect(graph.nodes.filter(node => t(node.location) === '/work/case.ppm')).toHaveLength(1);
  expect(aliases.at(-1)?.timing).toMatchObject({ certainty: 'observed', sequence: 7 });
  expect(graph.status).toBe('live');
});

it('keeps missing optional subfile references advisory and records child byte-budget refusal', async () => {
  const resolver = new DependencyResolver({ ...options, link: async () => { throw new Error('missing optional metadata'); } });
  await expect(resolver.add({ value: b('subfile:absent.ppm'), access: 'read', optional: true })).resolves.toMatchObject({ live: true, upload: false });
  expect(resolver.graph().issues.some(issue => issue.reason === 'unresolved')).toBe(true);
  const limited = new DependencyResolver({ ...options, budgets: { ...options.budgets, bytes: 23 } });
  await limited.add({ value: b('subfile:absent.ppm'), access: 'read' });
  expect(limited.graph().nodes).toHaveLength(1);
  expect(limited.graph().status).toBe('incomplete');
  expect(limited.graph().issues.some(issue => issue.reason === 'budget')).toBe(true);
});

it('retains subfile descriptor and shared symlink-sensitive occurrences without opening content', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => t(path) === '/work/link' ? b('/storage/inner') : undefined });
  for (const value of ['subfile:link/../雪\nA', 'subfile:link/../雪\nA', 'subfile:pipe:0', 'subfile:fd:3']) {
    await resolver.add({ value: b(value), access: 'read' });
  }
  const members = resolver.graph().nodes.filter(node => node.parent !== undefined);
  expect(members.map(node => [t(node.original), t(node.location), node.kind])).toEqual([
    ['link/../雪\nA', '/storage/雪\nA', 'path'], ['link/../雪\nA', '/storage/雪\nA', 'path'],
    ['pipe:0', undefined, 'descriptor'], ['fd:3', undefined, 'descriptor'],
  ]);
  expect(members[0].trace.map(step => t(step.path))).toContain('/work/link');
});

it('marks malformed subfile option grammar and expansion exhaustion incomplete', async () => {
  for (const value of ['subfile,,start,0,:clip', 'subfile,,unknown,0,,:clip']) {
    const resolver = new DependencyResolver(options);
    const root = await resolver.add({ value: b(value), access: 'read' });
    expect(resolver.graph().status).toBe('incomplete');
    expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: root.id, reason: 'syntax' }));
    expect(resolver.graph().nodes).toHaveLength(1);
  }
  for (const budgets of [{ ...options.budgets, depth: 1 }, { ...options.budgets, nodes: 1 }]) {
    const resolver = new DependencyResolver({ ...options, budgets });
    await resolver.add({ value: b('subfile:subfile:clip'), access: 'read' });
    expect(resolver.graph().status).toBe('incomplete');
    expect(resolver.graph().issues.some(issue => issue.reason === 'budget')).toBe(true);
  }
});
