import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { createDependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-key-info-lineage-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each(['preset', 'direct', 'tee'] as const)('retains the HLS key-info reader through %s indirection', async route => {
  const args = route === 'preset' ? ['-fpre', 'presets/root', 'out.m3u8']
    : route === 'direct' ? ['-hls_key_info_file', 'keys/Case雪.info', 'out.m3u8']
    : ['-f', 'tee', '[f=hls:hls_key_info_file=keys/Case雪.info]out.m3u8'];
  const resolver = await createDependencyResolver(discover('ffmpeg', args.map(b)), options);
  let info = resolver.graph().nodes.find(node => node.access === 'read')!;
  if (route === 'preset') [info] = await resolver.content(info.id, {
    content: b('hls_key_info_file=keys/Case雪.info\n'),
  });
  expect(info.grammar).toBe('hls-key-info');
  const content = b('https://cdn/key?sig=+%2f#key\nsecrets/Case雪.bin\n');
  const original = content.slice();
  const [key] = await resolver.content(info.id, { content });
  expect(key).toMatchObject({ original: b('secrets/Case雪.bin'), location: b('/work/secrets/Case雪.bin'), access: 'read', live: true, upload: false });
  expect(content).toEqual(original);
  expect(resolver.graph().nodes.some(node => node.original.toString() === b('https://cdn/key?sig=+%2f#key').toString())).toBe(false);
});

it('keeps changed key captures, case collisions and an output alias as separate live roles', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-hls_key_info_file', 'keys/info', 'secrets/Case雪.bin'].map(b)), options);
  const info = resolver.graph().nodes[0];
  const [first] = await resolver.content(info.id, { content: b('https://cdn/key?sig=+%2f#key\nsecrets/Case雪.bin\n') });
  const [changed] = await resolver.content(info.id, { content: b('https://cdn/key?sig=+%2f#key\nsecrets/case雪.bin\n') });
  const [shared] = await resolver.content(info.id, { content: b('https://cdn/key?sig=+%2f#key\nsecrets/Case雪.bin\n') });
  expect(new Set([first.id, changed.id, shared.id]).size).toBe(3);
  expect([first.location, changed.location, shared.location]).toEqual(['Case', 'case', 'Case'].map(name => b(`/work/secrets/${name}雪.bin`)));
  expect(resolver.graph().nodes.filter(node => node.location?.toString() === first.location?.toString()).map(node => node.access)).toEqual(['write', 'read', 'read']);
});

it('marks key discovery budget refusal incomplete rather than claiming closure', async () => {
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-hls_key_info_file', 'keys/info', 'out'].map(b)), {
    ...options, budgets: { ...options.budgets, nodes: 2 },
  });
  expect(await resolver.content(0, { content: b('https://cdn/key\nsecrets/key\n') })).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'budget' }));
});

it('qualifies independently recorded direct and tee key reads without using traces for discovery', async () => {
  expect(evidence.registered_executable_match).toBe(true);
  for (const sample of evidence.cases.filter(sample => sample.route !== 'preset')) {
    expect(sample.equalStatusStdoutOutputs && sample.fixturesUnchanged).toBe(true);
    expect(sample.runs.map(run => run.status)).toEqual([0, 0]);
    const resolver = await createDependencyResolver(discover('ffmpeg', sample.runs[0].argv.slice(1).map(b)), { ...options, cwd: b(evidence.cwd) });
    const info = resolver.graph().nodes.find(node => node.grammar === 'hls-key-info')!;
    await resolver.content(info.id, { content: Buffer.from(evidence.fixtures['keys/Case雪.info'], 'base64') });
    const candidates = resolver.graph().nodes.filter(node => node.access === 'read' && node.kind === 'path');
    let checked = 0;
    for (const access of sample.runs[1].accesses) {
      const path = Buffer.from(access.path_hex, 'hex');
      if (!['keys/Case雪.info', 'secrets/Case雪.bin'].some(name => path.equals(b(name)))) continue;
      expect(access.flags & 3).toBe(0);
      const index = candidates.findIndex(node => Buffer.from(node.location!).equals(Buffer.concat([b(evidence.cwd + '/'), path])));
      expect(index).toBeGreaterThanOrEqual(0);
      candidates.splice(index, 1);
      checked++;
    }
    expect(checked).toBe(2);
    expect(candidates).toEqual([]);
  }
});
