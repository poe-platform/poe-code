import { expect, it, vi } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 16, bytes: 1024, depth: 8, symlinks: 8 } };

it.each(['content', 'location'] as const)('refuses oversized %s before copying producer bytes', async field => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://h/list'), access: 'read', grammar: 'hls' });
  const observation = { content: b('#EXTM3U\nleaf.ts\n'), [field]: Buffer.alloc(8 * 1024 * 1024) };
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    expect(await resolver.content(root.id, observation)).toEqual([]);
    expect(clone.mock.calls.some(([value]) => value === observation)).toBe(false);
    expect(resolver.graph()).toMatchObject({ status: 'incomplete', nodes: [{ id: root.id }] });
    expect(resolver.graph().issues).toContainEqual({ node: root.id, reason: 'budget', detail: 'Content/location exceeds byte budget' });
    expect(await resolver.content(root.id, { content: b('#EXTM3U\nleaf.ts\n') })).toHaveLength(1);
  } finally { clone.mockRestore(); }
});

it('preserves unknown-node and missing-grammar results for oversized captures', async () => {
  const resolver = new DependencyResolver(options);
  const content = Buffer.alloc(2048);
  await expect(resolver.content(99, { content })).rejects.toThrow('Unknown dependency node');
  const root = await resolver.add({ value: b('https://h/list'), access: 'read' });
  expect(await resolver.content(root.id, { content })).toEqual([]);
  expect(resolver.graph().issues).toContainEqual({ node: root.id, reason: 'unresolved', detail: 'Content grammar must come from the selected native reader' });
});

it('keeps oversized refusal behind an earlier delayed admission without retaining producer bytes', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const resolver = new DependencyResolver({ ...options, link: async () => { await gate; return undefined; } });
  const root = await resolver.add({ value: b('https://h/list'), access: 'read', grammar: 'hls' });
  const earlier = resolver.add({ value: b('earlier'), access: 'read' });
  const refused = resolver.content(root.id, { content: Buffer.alloc(2048) });
  expect(resolver.graph().issues).toEqual([]);
  release();
  await earlier;
  expect(await refused).toEqual([]);
  expect(resolver.graph().nodes).toHaveLength(2);
  expect(resolver.graph().status).toBe('incomplete');
});
