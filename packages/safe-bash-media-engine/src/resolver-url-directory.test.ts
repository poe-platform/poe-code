import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-url-directory-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('resolves a dash member against an explicit URL directory without consuming stdin', async () => {
  const probes: Uint8Array[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
  const parent = await resolver.add({ value: b('https://origin/list'), access: 'read' });
  const base = { kind: 'directory' as const, value: b('https://cdn/Case雪/?sig=old/a#old') };
  const member = await resolver.observe({ value: b('-'), access: 'read', base, sequence: 1 }, parent.id);
  expect(member).toMatchObject({ original: b('-'), kind: 'url', location: b('https://cdn/Case雪/-'),
    base, parent: parent.id, live: true, upload: false });
  expect(member.timing).toMatchObject({ certainty: 'observed', sequence: 1 });
  expect(probes).toEqual([]);
  expect(resolver.graph().status).toBe('live');
});

it('applies URL policy to dash members while keeping explicit pipe protocols as descriptors', async () => {
  const resolver = new DependencyResolver({ ...options, policy: { allow: ['pipe'] } });
  const base = { kind: 'directory' as const, value: b('https://cdn/live/') };
  const member = await resolver.add({ value: b('-'), access: 'read', base });
  const pipe = await resolver.add({ value: b('pipe:3'), access: 'read', base });
  expect(member.kind).toBe('url');
  expect(pipe).toMatchObject({ kind: 'descriptor', location: undefined });
  expect(resolver.graph().issues).toEqual([expect.objectContaining({ node: member.id, reason: 'policy' })]);
});

it('keeps invocation dash descriptors and literal dash files separate from URL directory members', async () => {
  const resolver = new DependencyResolver(options);
  const stdin = await resolver.add({ value: b('-'), access: 'read' });
  const file = await resolver.add({ value: b('-'), literal: true, access: 'read-write' });
  expect(stdin).toMatchObject({ kind: 'descriptor', location: undefined });
  expect(file).toMatchObject({ kind: 'path', location: b('/work/-'), access: 'read-write' });
});

// Qualification only: product code never imports native captures. Native HLS
// supplies a resource base; this checks equivalence with its URL directory base.
it('covers independent native URL opens and ordered HTTP requests for a dash member', async () => {
  expect(evidence.executables_unchanged).toBe(true);
  expect(evidence.runs.map(run => run.status)).toEqual([0, 0]);
  expect(evidence.runs[0].stdout_base64).toBe(evidence.runs[1].stdout_base64);
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b(evidence.argv.at(-1)!), access: 'read', grammar: 'hls' });
  const [predicted] = await resolver.content(root.id, { content: b(evidence.manifest) });
  const observedRoot = await resolver.observe({ value: root.original, access: 'read', sequence: 1 });
  const observedMember = await resolver.observe({ value: b('-'), access: 'read', sequence: 2,
    base: { kind: 'directory', value: b(evidence.origin + '/Case/') } }, observedRoot.id);
  expect(observedMember.location).toEqual(predicted.location);
  for (const run of evidence.runs) {
    expect(run.opens).toEqual([root, predicted].map(node => new TextDecoder().decode(node.location)));
    expect(run.requests).toEqual(['/Case/list.m3u8?sig=+%2f', '/Case/-']);
  }
  expect(resolver.graph().edges).toContainEqual({ from: observedRoot.id, to: observedMember.id, kind: 'observed-before' });
  expect([predicted, observedMember].every(node => node.kind === 'url' && node.live && !node.upload)).toBe(true);
});
