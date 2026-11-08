import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../tests/fixtures/native/dependency-baseurl-spelling-native-evidence.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

// dashdec.c uses xmlNodeGetContent, not a whitespace-trimming filename reader.
it.each([' Case雪.mp4 ', '\ncase.mp4\n', '\u00a0雪.mp4\u2003'])('preserves DASH BaseURL filename bytes: %j', async filename => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'dash' });
  const content = b(`<MPD><Period><Representation><BaseURL>${filename}</BaseURL></Representation></Period></MPD>`);
  const original = content.slice();
  const [child] = await resolver.content(root.id, { content });
  expect(child.original).toEqual(b(filename));
  expect(child.location).toEqual(b('/work/lists/' + filename));
  expect(child.base.value).toEqual(b('/work/lists/root'));
  expect(child).toMatchObject({ parent: root.id, access: 'read', live: true, upload: false });
  expect(content).toEqual(original);
});

it('preserves signed BaseURL suffixes and whitespace across changed captures', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('https://cdn/lists/root?sig=parent'), access: 'read', grammar: 'dash' });
  for (const filename of ['Case雪.mp4?sig=+%2f#fragment ', 'case.mp4?sig=%2F+#fragment\n']) {
    const [child] = await resolver.content(root.id, { content: b(`<MPD><Period><Representation><BaseURL>${filename}</BaseURL><SegmentBase><Initialization sourceURL="?sig=init+%2f"/></SegmentBase></Representation></Period></MPD>`) });
    expect(child.original).toEqual(b(filename));
    expect(child.location).toEqual(b('https://cdn/lists/' + filename));
    expect(child.kind).toBe('url');
  }
  expect(resolver.graph().nodes.filter(node => node.parent === root.id && node.original.includes(35))).toHaveLength(2);
});

it('retains whitespace in inherited BaseURL directories and resolves segment operands from that base', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'dash' });
  const [child] = await resolver.content(root.id, { content: b('<MPD><BaseURL> 雪/</BaseURL><Period><Representation><SegmentList><SegmentURL media="Case.mp4"/></SegmentList></Representation></Period></MPD>') });
  expect(child.original).toEqual(b('Case.mp4'));
  expect(child.base.value).toEqual(b('/work/lists/ 雪/'));
  expect(child.location).toEqual(b('/work/lists/ 雪/Case.mp4'));
});

// Independent in-memory predictions qualify named native occurrences. The
// product neither imports this evidence nor uses native execution for discovery.
it('covers native shared nested reads without trimming names or simplifying parent components', async () => {
  const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
  const root = await resolver.add({ value: b('lists/root'), access: 'read', grammar: 'concat' });
  const children = await resolver.content(root.id, { content: b('ffconcat version 1.0\nfile child\noption safe 0\nfile child\noption safe 0\n') });
  for (const child of children) await resolver.content(child.id, { grammar: 'concat', content: b("ffconcat version 1.0\nfile '../frames/ Case雪.ppm '\nfile '../frames/case.ppm'\n") });
  expect(evidence.runs.map(run => run.status)).toEqual([0, 0]);
  expect(evidence.pairedStatusStdoutEqual).toBe(true);
  expect(evidence.hashesAfter).toEqual(evidence.hashesBefore);
  const remaining = [...resolver.graph().nodes];
  expect(evidence.runs[1].diagnosticOpens).toHaveLength(7);
  for (const filename of evidence.runs[1].diagnosticOpens) {
    const index = remaining.findIndex(node => node.access === 'read'
      && Buffer.from(node.location!).equals(b(evidence.cwd + '/' + filename)));
    expect(index, `independent native read occurrence: ${filename}`).toBeGreaterThanOrEqual(0);
    remaining.splice(index, 1);
  }
  expect(remaining).toEqual([]);
});
