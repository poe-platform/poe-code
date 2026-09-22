import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('keeps unsupported DASH formatting live and incomplete without changing signed content or its URL base', async () => {
  let metadataCalls = 0;
  const resolver = new DependencyResolver({ ...options, link: async () => { metadataCalls++; return undefined; } });
  const root = await resolver.add({ value: b('https://origin/root?sig=original'), access: 'read', grammar: 'dash' });
  const content = b('<MPD><Period><AdaptationSet><Representation><SegmentTemplate initialization="init-$Bandwidth%5d$.mp4" media="Case雪-$Number%010d$.m4s?sig=%2f+X#part"/></Representation></AdaptationSet></Period></MPD>');
  const original = content.slice();
  const children = await resolver.content(root.id, { location: b('https://cdn/nested/root?sig=redirect#fragment'), content });
  expect(children).toHaveLength(2);
  expect(children.every(node => node.live && !node.upload && node.kind === 'url' && node.expression?.complete === false)).toBe(true);
  expect(children.map(node => node.location)).toEqual([
    b('https://cdn/nested/Case雪-$Number%010d$.m4s?sig=%2f+X#part'),
    b('https://cdn/nested/init-$Bandwidth%5d$.mp4'),
  ]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues.filter(issue => issue.reason === 'syntax')).toHaveLength(2);
  expect(content).toEqual(original);
  expect(metadataCalls).toBe(0);
});
