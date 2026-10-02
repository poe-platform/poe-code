import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 }, policy: { allow: ['file', 'https', 'pipe'] } };

it('retains reader policy on late accesses without inheriting the reader base', async () => {
  const probes: Uint8Array[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
  const root = await resolver.add({ value: b('https://cdn/live/list?sig=+%2f'), access: 'read', grammar: 'hls', policy: { allow: ['https'] } });
  const child = await resolver.observe({ value: b('optional雪\n.key'), access: 'read', optional: true, sequence: 1 }, root.id);
  expect(child.location).toEqual(b('/work/optional雪\n.key'));
  expect(child.policy).toEqual({ allow: ['https'] });
  expect(probes).toEqual([]);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: child.id, reason: 'policy' }));
});

it('propagates late wrapper policy to every nested protocol and descriptor occurrence', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/list'), access: 'read', policy: { deny: ['file', 'pipe'] } });
  const wrapper = await resolver.observe({ value: b('concat:file:Case|pipe:3|file:Case'), access: 'read-write', sequence: 2 }, root.id);
  const children = resolver.graph().nodes.filter(node => node.parent === wrapper.id);
  expect(children.map(node => node.policy)).toEqual(Array.from({ length: 3 }, () => ({ deny: ['file', 'pipe'] })));
  expect(resolver.graph().issues.filter(issue => issue.reason === 'policy').map(issue => issue.node)).toEqual(children.map(node => node.id));
  expect(children.every(node => node.live && !node.upload && node.access === 'read-write')).toBe(true);
});

it('uses an explicitly observed policy instead of the parent policy, and owns it', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/list'), access: 'read', policy: { deny: ['file'] } });
  const policy = { allow: ['file'] };
  const pending = resolver.observe({ value: b('Case'), access: 'write', policy, sequence: 3 }, root.id);
  policy.allow[0] = 'https';
  const child = await pending;
  expect(child.policy).toEqual({ allow: ['file'] });
  expect(resolver.graph().issues.filter(issue => issue.reason === 'policy')).toEqual([]);
});
