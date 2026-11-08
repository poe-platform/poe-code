import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-key-info-boundary-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['\r', '\0', '\r\n', '\n'])('uses native key-info line boundaries %j and cwd rather than the info directory', async separator => {
  const resolver = new DependencyResolver(options);
  const info = await resolver.add({ value: b('keys/info'), access: 'read', grammar: 'hls-key-info' });
  const content = b(['https://cdn/key?sig=+%2f#key', 'secrets/Case雪.bin', '001122'].join(separator));
  const original = content.slice();
  const [key] = await resolver.content(info.id, { content });
  expect(key).toMatchObject({ original: b('secrets/Case雪.bin'), location: b('/work/secrets/Case雪.bin'),
    access: 'read', kind: 'path', live: true, upload: false });
  expect(content).toEqual(original);
  expect(resolver.graph().status).toBe('live');
});

it.each([0, 1])('refuses a truncated key-info field at index %i without interpreting altered content', async field => {
  const resolver = new DependencyResolver(options);
  const info = await resolver.add({ value: b('keys/info'), access: 'read', grammar: 'hls-key-info' });
  const lines = ['https://cdn/key?sig=+%2f#key', 'secrets/Case雪.bin'];
  lines[field] = '雪'.repeat(1366) + '?sig=+%2f#key';
  const content = b(lines.join('\n') + '\n');
  const original = content.slice();
  expect(await resolver.content(info.id, { content })).toEqual([]);
  expect(content).toEqual(original);
  expect(resolver.graph()).toMatchObject({ status: 'incomplete', issues: [expect.objectContaining({ node: info.id, reason: 'unresolved' })] });
  const [changed] = await resolver.content(info.id, { content: b('https://cdn/key\0secrets/case雪.bin\0') });
  const late = await resolver.observe({ value: b('secrets/Case雪\n.bin'), access: 'read-write', optional: true, sequence: 1 }, info.id);
  expect(changed.location).toEqual(b('/work/secrets/case雪.bin'));
  expect(late).toMatchObject({ location: b('/work/secrets/Case雪\n.bin'), timing: { certainty: 'observed', sequence: 1 } });
  expect(resolver.graph().status).toBe('incomplete');
});

it('accepts exactly 4096 filename bytes and ignores lines beyond the three native reads', async () => {
  const resolver = new DependencyResolver(options);
  const info = await resolver.add({ value: b('keys/info'), access: 'read', grammar: 'hls-key-info' });
  const filename = '雪'.repeat(1365) + 'A';
  expect(b(filename).length).toBe(4096);
  const [key] = await resolver.content(info.id, { content: b('https://cdn/key\n' + filename + '\n001122\n' + 'x'.repeat(5000)) });
  expect(key.original).toEqual(b(filename));
  expect(resolver.graph().status).toBe('live');
});

it('retains descriptor and signed network key operands without local metadata or upload admission', async () => {
  let probes = 0;
  const resolver = new DependencyResolver({ ...options, link: async () => { probes++; return undefined; } });
  const info = await resolver.add({ value: b('pipe:3'), access: 'read', grammar: 'hls-key-info' });
  const [key] = await resolver.content(info.id, { location: b('/work/keys/info'), content: b('published\0https://cdn/key?sig=+%2f#key\0') });
  expect(key).toMatchObject({ original: b('https://cdn/key?sig=+%2f#key'), kind: 'url', location: b('https://cdn/key?sig=+%2f#key'), upload: false });
  const [descriptor] = await resolver.content(info.id, { location: b('/work/keys/info'), content: b('published\rpipe:0\r') });
  expect(descriptor).toMatchObject({ kind: 'descriptor', location: undefined, upload: false });
  expect(probes).toBe(0);
});

it.each(evidence.cases)('qualifies $id against independent native attempted reads without replay discovery', async sample => {
  expect(evidence.registered_executable_match).toBe(true);
  expect(sample.equal_status_stdout && sample.equal_outputs && sample.fixtures_unchanged).toBe(true);
  expect(sample.runs[0].argv).toEqual(sample.runs[1].argv);
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const info = await resolver.add({ value: b(sample.info), access: 'read', grammar: 'hls-key-info' });
  const children = await resolver.content(info.id, { content: Buffer.from(sample.content_base64, 'base64') });
  const overlong = sample.id.startsWith('overlong');
  expect(children.length).toBe(overlong ? 0 : 1);
  expect(resolver.graph().status).toBe(overlong ? 'incomplete' : 'live');
  // These independently specified operands qualify captured runtime reads.
  // The product must never use an access trace to manufacture predictions.
  if (overlong) await resolver.observe({ value: b(sample.id === 'overlong-file'
    ? ('file:' + 'directory/'.repeat(500)).slice(0, 4096) : 'secrets/Case雪.bin'), access: 'read', sequence: 1 }, info.id);
  const candidates = [...resolver.graph().nodes];
  let checked = 0;
  for (const access of sample.runs[1].accesses) {
    const path = Buffer.from(access.path_hex, 'hex');
    if (!['keys/', 'secrets/', 'directory/'].some(prefix => path.subarray(0, prefix.length).equals(b(prefix)))) continue;
    expect(access.flags & 3).toBe(0);
    const absolute = Buffer.concat([b(evidence.cwd + '/'), path]);
    const index = candidates.findIndex(node => node.access === 'read' && node.location
      && Buffer.from(node.location).equals(node.kind === 'file-protocol' ? Buffer.concat([b('file:'), absolute]) : absolute));
    expect(index, `independent native attempted read: ${access.path_hex}`).toBeGreaterThanOrEqual(0);
    candidates.splice(index, 1);
    checked++;
  }
  expect(checked).toBe(2);
  expect(candidates).toEqual([]);
});
