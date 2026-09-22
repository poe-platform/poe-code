import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/js-resolver-dash-base-expressions-20260920.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/scratch/case'), budgets: { nodes: 100, bytes: 100000, depth: 20, symlinks: 10 } };

it.each(['Case-$RepresentationID$.mp4', 'case-$bAnDwIdTh$.mp4'])('retains DASH BaseURL filename grammar without probing the placeholder: %s', async filename => {
  const probes: Uint8Array[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
  const root = await resolver.add({ value: b('lists/master'), access: 'read', grammar: 'dash' });
  probes.length = 0;
  const [node] = await resolver.content(root.id, { content: b(`<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation id="v" bandwidth="7"><BaseURL>../media/${filename}</BaseURL></Representation></AdaptationSet></Period></MPD>`) });
  expect(node).toMatchObject({ original: b(`../media/${filename}`), kind: 'filename-expression', live: true, upload: false,
    base: { kind: 'resource', value: b('/scratch/case/lists/master') }, location: b(`/scratch/case/lists/../media/${filename}`),
    expression: { dialect: 'dash-resource', complete: true, tokens: expect.arrayContaining([expect.objectContaining({ kind: 'template' })]) } });
  expect(probes).toEqual([]);
});

it('recognizes templates in inherited bases for single files, initialization and segment reads', async () => {
  const probes: Uint8Array[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
  const root = await resolver.add({ value: b('lists/master'), access: 'read', grammar: 'dash' });
  probes.length = 0;
  const nodes = await resolver.content(root.id, { content: b('<MPD><BaseURL>../$RepresentationID$/</BaseURL><Period><AdaptationSet><Representation id="a"><BaseURL>Case.mp4</BaseURL></Representation><Representation id="b"><SegmentList><Initialization sourceURL="init.mp4"/><SegmentURL media="case.m4s" index="index.bin"/></SegmentList></Representation></AdaptationSet></Period></MPD>') });
  expect(nodes.map(node => node.original)).toEqual(['Case.mp4', 'init.mp4', 'case.m4s', 'index.bin'].map(b));
  expect(nodes.every(node => node.kind === 'filename-expression' && node.expression?.tokens.some(token => token.kind === 'template') && node.live && !node.upload)).toBe(true);
  expect(nodes.map(node => node.location)).toEqual(['Case.mp4', 'init.mp4', 'case.m4s', 'index.bin'].map(name => b('/scratch/case/lists/../$RepresentationID$/' + name)));
  expect(probes).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'unresolved', detail: expect.stringContaining('local BaseURL') }));
});

it('preserves signed URL bytes and templates across changed captures and repeated representations', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://origin/lists/master?sig=parent'), access: 'read', grammar: 'dash', policy: { allow: ['https'] } });
  for (const filename of ['Case雪-$RepresentationID$.mp4?sig=+%2f#frame', 'case雪-$RepresentationID$.mp4?sig=%2F+#frame']) {
    const content = b(`<MPD><BaseURL>../media/</BaseURL><Period><Representation><BaseURL>${filename}</BaseURL></Representation><Representation><BaseURL>${filename}</BaseURL></Representation></Period></MPD>`);
    const original = content.slice();
    const nodes = await resolver.content(root.id, { location: b('https://cdn/lists/master?sig=redirect'), content });
    expect(nodes.map(node => node.original)).toEqual([b(filename), b(filename)]);
    expect(nodes.map(node => node.location)).toEqual([b('https://cdn/media/' + filename), b('https://cdn/media/' + filename)]);
    expect(nodes.every(node => node.kind === 'url' && node.expression?.dialect === 'dash-resource' && node.policy?.allow?.[0] === 'https' && node.live && !node.upload)).toBe(true);
    expect(nodes[0].id).not.toBe(nodes[1].id);
    expect(content).toEqual(original);
  }
  expect(resolver.graph().status).toBe('live');
});

it('keeps frame placeholders and formatted bandwidth literal in the single-file BaseURL reader', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/master'), access: 'read', grammar: 'dash' });
  const filename = 'Case-$Number$-$Bandwidth%05d$.mp4';
  const [node] = await resolver.content(root.id, { content: b(`<MPD><Period><Representation id="v" bandwidth="7"><BaseURL>${filename}</BaseURL></Representation></Period></MPD>`) });
  expect(node.kind).toBe('path');
  expect(node.expression).toMatchObject({ dialect: 'dash-resource', complete: true });
  expect(node.expression?.tokens.every(token => token.kind === 'literal')).toBe(true);
  expect(node.location).toEqual(b('/scratch/case/lists/' + filename));
  expect(resolver.graph().status).toBe('live');
});

it.each([
  { id: 'representation-id', filename: '../media/Case-$RepresentationID$.mp4', actual: 'lists/../media/Case-v.mp4', status: 0 },
  { id: 'case-insensitive-bandwidth', filename: '../media/case-$bAnDwIdTh$.mp4', actual: 'lists/../media/case-7.mp4', status: 0 },
  { id: 'inherited-template', inherited: '../media/$RepresentationID$/', filename: 'Case.mp4', actual: 'lists/Case.mp4', status: 1 },
  { id: 'literal-frame-and-format', filename: '../media/Case-$Number$-$Bandwidth%05d$.mp4', actual: 'lists/../media/Case-$Number$-$Bandwidth%05d$.mp4', status: 0 },
])('qualifies original $id discovery and explicit runtime supplementation against paired native reads', async fixture => {
  // The fixture and expected native operands are original test inputs, never
  // generated from a trace. No native execution or file creation in unit tests.
  const resolver = new DependencyResolver(options);
  const operand = `lists/${fixture.id}.mpd`;
  const root = await resolver.add({ value: b(operand), access: 'read', grammar: 'dash' });
  const content = b('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1S" minBufferTime="PT1S">'
    + (fixture.inherited ? `<BaseURL>${fixture.inherited}</BaseURL>` : '')
    + `<Period><AdaptationSet mimeType="video/mp4"><Representation id="v" bandwidth="7"><BaseURL>${fixture.filename}</BaseURL></Representation></AdaptationSet></Period></MPD>`);
  const [prediction] = await resolver.content(root.id, { content });
  expect(prediction.original).toEqual(b(fixture.filename));
  expect(prediction.kind).toBe(fixture.id === 'literal-frame-and-format' ? 'path' : 'filename-expression');
  expect(resolver.graph().status).toBe(fixture.inherited ? 'incomplete' : 'live');
  const observed = [
    await resolver.observe({ value: b(operand), access: 'read', sequence: 0 }),
    await resolver.observe({ value: b(fixture.actual), access: 'read', sequence: 1 }, root.id),
  ];
  const native = evidence.cases.find(row => row.id === fixture.id)!;
  expect(native.manifest).toBe(new TextDecoder().decode(content));
  expect(native.equal_status_stdout && native.fixtures_unchanged).toBe(true);
  expect(native.runs.map(run => run.status)).toEqual([fixture.status, fixture.status]);
  expect(native.runs[1].accesses.map(access => new Uint8Array(Buffer.from(access.path_hex, 'hex')))).toEqual(observed.map(node => node.original));
  expect(observed.every(node => node.access === 'read' && node.live && !node.upload)).toBe(true);
  // Native diagnostics qualify operand coverage, not kernel open timing or
  // integrated mediation. Supplied sequences exercise the bridge contract.
  expect(resolver.graph().edges).toContainEqual({ from: observed[0].id, to: observed[1].id, kind: 'observed-before' });
});
