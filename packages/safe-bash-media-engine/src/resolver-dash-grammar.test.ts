import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 20, symlinks: 10 } };

it('uses native case-insensitive DASH elements with inherited addressing and reader-relative signed bases', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://origin/root'), access: 'read', grammar: 'dash' });
  const nodes = await resolver.content(root.id, {
    location: b('https://cdn/manifests/master?sig=parent+%2F#old'),
    content: b('<mPd><bAsEuRl>../media/</bAsEuRl><pErIoD><sEgMeNtLiSt><iNiTiAlIzAtIoN sourceURL="init?sig=a+%2F#i"/><sEgMeNtUrL media="雪.m4s?sig=b+%2f#s"/></sEgMeNtLiSt><aDaPtAtIoNsEt><rEpReSeNtAtIoN><bAsEuRl>one/</bAsEuRl></rEpReSeNtAtIoN><RePrEsEnTaTiOn><BaSeUrL>two/</BaSeUrL></RePrEsEnTaTiOn></aDaPtAtIoNsEt></pErIoD></mPd>'),
  });
  expect(nodes.map(node => [t(node.original), t(node.location)])).toEqual([
    ['init?sig=a+%2F#i', 'https://cdn/media/one/init?sig=a+%2F#i'],
    ['雪.m4s?sig=b+%2f#s', 'https://cdn/media/one/雪.m4s?sig=b+%2f#s'],
    ['init?sig=a+%2F#i', 'https://cdn/media/two/init?sig=a+%2F#i'],
    ['雪.m4s?sig=b+%2f#s', 'https://cdn/media/two/雪.m4s?sig=b+%2f#s'],
  ]);
  expect(nodes.every(node => node.access === 'read' && node.live && !node.upload)).toBe(true);
  expect(resolver.graph().edges.filter(edge => edge.kind === 'before')).toEqual(nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id, kind: 'before' })));
  expect(resolver.graph().status).toBe('live');
});

it('rejects a non-MPD root without inventing media accesses', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'dash' });
  expect(await resolver.content(root.id, { content: b('<playlist><Representation><SegmentList><SegmentURL media="collision"/></SegmentList></Representation></playlist>') })).toEqual([]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ node: root.id, reason: 'syntax' }));
});

it('keeps DASH attribute names case-sensitive and changed captures as separate accesses', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'dash' });
  for (const name of ['A', 'a']) {
    const nodes = await resolver.content(root.id, { content: b('<mpd><period><representation><segmentlist><initialization SOURCEURL="ignored"/><segmenturl MEDIA="ignored" media="' + name + '"/></segmentlist></representation></period></mpd>') });
    expect(nodes.map(node => t(node.location))).toEqual(['/work/lists/' + name]);
  }
  expect(resolver.graph().nodes.map(node => t(node.original))).toEqual(['lists/root', 'A', 'a']);
});
