import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-xml-string-value-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

// Original captures: resolve_content_path reads xmlNodeGetContent(BaseURL),
// including descendants in document order, before native segment URL lookup.
it.each([
  ['Case<part>雪</part>.mp4', 'Case雪.mp4'],
  ['<part>Case</part>雪.mp4', 'Case雪.mp4'],
  ['Case<part>雪<inner>\n</inner>x</part>.mp4', 'Case雪\nx.mp4'],
  ['Case<part><![CDATA[雪&]]></part>&amp;.mp4', 'Case雪&&.mp4'],
  ['Case<!-- ignored --><part>雪</part><?reader ignored?>.mp4', 'Case雪.mp4'],
])('retains the ordered XML string value of DASH BaseURL: %s', async (xml, filename) => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'dash' });
  const content = b(`<MPD><Period><Representation><BaseURL>${xml}</BaseURL></Representation></Period></MPD>`);
  const unchanged = content.slice();
  const [child] = await resolver.content(root.id, { content });
  expect(child.original).toEqual(b(filename));
  expect(child.location).toEqual(b('/work/lists/' + filename));
  expect(child.base.value).toEqual(b('/work/lists/root'));
  expect(child).toMatchObject({ parent: root.id, access: 'read', live: true, upload: false });
  expect(content).toEqual(unchanged);
  expect(resolver.graph().status).toBe('live');
});

it('retains signed URL bytes from nested XML text without local metadata probes', async () => {
  const probes: Uint8Array[] = [];
  const resolver = new DependencyResolver({ ...options, link: async path => { probes.push(path); return undefined; } });
  const root = await resolver.add({ value: b('https://cdn/lists/root?sig=parent/a#old'), access: 'read', grammar: 'dash' });
  const [child] = await resolver.content(root.id, { content: b('<MPD><Period><Representation><BaseURL>https://media/Case<part>雪.mp4?sig=+%2f&amp;x=%2F</part>#fragment </BaseURL></Representation></Period></MPD>') });
  expect(child.original).toEqual(b('https://media/Case雪.mp4?sig=+%2f&x=%2F#fragment '));
  expect(child.location).toEqual(child.original);
  expect(child.kind).toBe('url');
  expect(probes).toEqual([]);
});

it('uses descendant BaseURL text as the segment base after an effective URL observation', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://origin/root'), access: 'read', grammar: 'dash' });
  const children = await resolver.content(root.id, { location: b('https://cdn/lists/root?sig=old/a'), content: b('<MPD><BaseURL>../<part>Case雪</part>/</BaseURL><Period><Representation><SegmentList><Initialization sourceURL="?sig=+%2f#init"/><SegmentURL media="case.m4s?sig=%2F+#frame"/></SegmentList></Representation></Period></MPD>') });
  expect(children.map(node => node.base.value)).toEqual([b('https://cdn/Case雪/'), b('https://cdn/Case雪/')]);
  expect(children.map(node => node.location)).toEqual([b('https://cdn/Case雪/?sig=+%2f#init'), b('https://cdn/Case雪/case.m4s?sig=%2F+#frame')]);
  expect(resolver.graph().edges).toContainEqual({ from: children[0].id, to: children[1].id, kind: 'before' });
});

it('preserves symlink-sensitive reader bases and changed XML captures as distinct occurrences', async () => {
  const resolver = new DependencyResolver({ ...options, link: async path => Buffer.from(path).toString() === '/work/alias' ? b('/else/deep') : undefined });
  const root = await resolver.add({ value: b('alias/../lists/root'), access: 'read', grammar: 'dash' });
  for (const filename of ['Case雪.mp4', 'case雪.mp4']) {
    const [child] = await resolver.content(root.id, { content: b(`<MPD><Period><Representation><BaseURL>../frames/<part>${filename}</part></BaseURL></Representation></Period></MPD>`) });
    expect(child.original).toEqual(b('../frames/' + filename));
    expect(child.base.value).toEqual(b('/work/alias/../lists/root'));
    expect(child.location).toEqual(b('/else/frames/' + filename));
  }
  expect(resolver.graph().nodes).toHaveLength(3);
  expect(resolver.graph().nodes.every(node => node.live && !node.upload)).toBe(true);
});

it('reports nested XML depth exhaustion without admitting a partial BaseURL spelling', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, depth: 4 } });
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'dash' });
  expect(await resolver.content(root.id, { content: b('<MPD><Period><Representation><BaseURL>Case<part>雪</part>.mp4</BaseURL></Representation></Period></MPD>') })).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'budget' }));
});

// Independent original captures qualify filename bytes and direct-input access
// occurrence coverage only. Native ffprobe did not execute the DASH demuxer.
it('qualifies XML string values and named direct native reads without claiming native DASH execution', async () => {
  const originals = [
    ['mixed', 'Case<part>雪</part>.mp4', 'Case雪.mp4'],
    ['case', '<part>case</part>雪.mp4', 'case雪.mp4'],
    ['nested', 'Case<part>雪<inner>\n</inner>x</part>.mp4', 'Case雪\nx.mp4'],
    ['entities', 'Case<part><![CDATA[雪&]]></part>&amp;.mp4', 'Case雪&&.mp4'],
    ['comments', 'Case<!-- ignored --><part>雪</part><?reader ignored?>.mp4', 'Case雪.mp4'],
  ];
  expect(evidence.registered_executable_match).toBe(true);
  expect(evidence.registered_source_match).toBe(true);
  expect(evidence.native_dash_qualified).toBe(false);
  expect(evidence.hashes_after).toEqual(evidence.hashes_before);
  for (const [id, xml, filename] of originals) {
    const native = evidence.results.find(result => result.id === id)!;
    expect(native.baseurl_xml).toBe(xml);
    expect(Buffer.from(native.native_xml_content_hex, 'hex')).toEqual(Buffer.from(b(filename)));
    expect(native.runs.map(run => run.status)).toEqual([0, 0]);
    expect(native.runs[0].stdout_base64).toBe(native.runs[1].stdout_base64);
    const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
    const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'dash' });
    await resolver.content(root.id, { content: b(`<MPD><Period><Representation><BaseURL>${xml}</BaseURL></Representation></Period></MPD>`) });
    const candidates = resolver.graph().nodes.filter(node => node.parent === root.id);
    expect(native.runs[1].named_accesses).toHaveLength(1);
    for (const access of native.runs[1].named_accesses) {
      // Access-mode bits are O_RDONLY; O_CLOEXEC is independent of the role.
      expect(access.flags & 3).toBe(0);
      const index = candidates.findIndex(node => node.access === 'read' && Buffer.from(node.location!).equals(Buffer.concat([
        b(evidence.cwd + '/'), Buffer.from(access.path_hex, 'hex'),
      ])));
      expect(index, `independent native direct read: ${access.path_hex}`).toBeGreaterThanOrEqual(0);
      candidates.splice(index, 1);
    }
    expect(candidates).toEqual([]);
  }
});
