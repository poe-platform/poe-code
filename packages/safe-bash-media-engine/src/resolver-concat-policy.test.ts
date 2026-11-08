import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-concat-policy-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

function diagnostics(encoded: string): string[] {
  // Registered FFmpeg context addresses vary between processes. Compare every
  // remaining byte of each diagnostic; retain the raw channels in the artifact.
  return Buffer.from(encoded, 'base64').toString().split('\n').map(line => {
    const begin = line.indexOf(' @ 0x');
    const end = line.indexOf(']', begin);
    if (!line.startsWith('[') || begin < 0 || end < 0) return line;
    const address = line.slice(begin + 5, end);
    if (!address || ![...address].every(char => '0123456789abcdef'.includes(char))) return line;
    return line.slice(0, begin + 3) + '<context-address>' + line.slice(end);
  });
}

it('applies concat file options after the filename, with last assignment winning and no sibling leakage', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), grammar: 'concat', access: 'read',
    policy: { allow: ['concat', 'file', 'https'], deny: ['pipe'] } });
  const children = await resolver.content(root.id, { content: b(
    "file 'concat:https://cdn/Case?sig=+%2f#part|file:Case雪'\n" +
    "option protocol_whitelist file\noption protocol_whitelist 'concat,https'\n" +
    "option protocol_blacklist 'file'\nfile https://cdn/case?sig=%2F+#part\n",
  ) });
  expect(children.map(node => node.policy)).toEqual([
    { allow: ['concat', 'https'], deny: ['file'] },
    { allow: ['concat', 'file', 'https'], deny: ['pipe'] },
  ]);
  const members = resolver.graph().nodes.filter(node => node.parent === children[0].id);
  expect(members.map(node => node.original)).toEqual([b('https://cdn/Case?sig=+%2f#part'), b('file:Case雪')]);
  expect(members.map(node => node.policy)).toEqual([children[0].policy, children[0].policy]);
  expect(resolver.graph().issues.filter(issue => issue.reason === 'policy').map(issue => issue.node)).toEqual([members[1].id]);
  expect(resolver.graph().nodes.every(node => node.live && !node.upload)).toBe(true);
});

it('retains inherited restrictions when only one concat policy field is replaced, including empty whitelist entries', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), grammar: 'concat', access: 'read',
    policy: { allow: ['https'], deny: ['file'] } });
  const [child] = await resolver.content(root.id, { content: b("file https://cdn/clip\noption protocol_whitelist ,\n") });
  expect(child.policy).toEqual({ allow: ['', ''], deny: ['file'] });
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: child.id, reason: 'policy' }));
});

it('retains per-file policy in a malformed prefix and resets file options on changed captures', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), grammar: 'concat', access: 'read', policy: { allow: ['https'] } });
  const [first] = await resolver.content(root.id, { content: b('file https://cdn/Case\noption protocol_blacklist https\nunknown\nfile later\n') });
  const [changed] = await resolver.content(root.id, { content: b('file https://cdn/Case\n') });
  expect(first.policy).toEqual({ allow: ['https'], deny: ['https'] });
  expect(changed.policy).toEqual({ allow: ['https'] });
  expect(first.id).not.toBe(changed.id);
  expect(resolver.graph().status).toBe('incomplete');
});

it('qualifies named read coverage and order against independent native concat policy traces', async () => {
  expect(evidence.registered_executable_match).toBe(true);
  expect(evidence.results.map(result => result.runs[0].status)).toEqual([0, 1, 0, 1, 0]);
  for (const sample of evidence.results) {
    const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd),
      policy: { allow: ['file', 'concat'], deny: ['pipe'] } });
    const root = await resolver.add({ value: b('lists/root'), grammar: 'concat', access: 'read' });
    await resolver.content(root.id, { content: b(sample.manifest) });
    expect(sample.fixtures_unchanged).toBe(true);
    expect(sample.runs[0].status).toBe(sample.runs[1].status);
    expect(sample.runs[0].stdout_base64).toBe(sample.runs[1].stdout_base64);
    expect(diagnostics(sample.runs[0].stderr_base64)).toEqual(diagnostics(sample.runs[1].stderr_without_trace_base64));
    const graph = resolver.graph();
    let previous = -1;
    for (const access of sample.runs[1].named_accesses) {
      expect(access.flags & 3).toBe(0);
      const location = Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')]);
      const node = graph.nodes.find(node => node.id > previous && node.access === 'read'
        && node.location && Buffer.from(node.location).equals(location));
      expect(node, `independent native attempted read: ${access.path_hex}`).toBeDefined();
      previous = node!.id;
    }
    const denied = graph.issues.filter(issue => issue.reason === 'policy').map(issue => graph.nodes[issue.node!]);
    for (const node of denied) {
      expect(sample.runs[1].named_accesses.some(access => node.location
        && Buffer.from(node.location).equals(Buffer.concat([b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex')])))).toBe(false);
    }
  }
});
