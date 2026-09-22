import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it('uses MSL image reader grammar without expanding filename lists or globs', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'msl' });
  const nodes = await resolver.content(root.id, { content: b('<image><read filename="PPM:雪&#10;frame.ppm[0]"/><read filename="https://h/image?sig=%2F+a&amp;x=1#part"/><read filename="xc:red"/><read filename="@names"/><read filename="frames*.ppm"/><write filename="PPM:out.ppm"/><write filename="out-%03d.ppm"/></image>') });
  expect(nodes.map(node => [node.kind, node.location, node.access])).toEqual([
    ['image-selector', b('/work/雪\nframe.ppm'), 'read'],
    ['url', b('https://h/image?sig=%2F+a&x=1#part'), 'read'],
    ['synthetic', undefined, 'read'],
    ['path', b('/work/names'), 'read'],
    ['path', b('/work/@names'), 'read'],
    ['path', b('/work/frames*.ppm'), 'read'],
    ['path', b('/work/out.ppm'), 'write'],
    ['output-pattern', b('/work/out-%03d.ppm'), 'write'],
  ]);
  expect(nodes[0].original).toEqual(b('PPM:雪\nframe.ppm[0]'));
  expect(nodes.every(node => node.live && !node.upload)).toBe(true);
});

it('retains optional MSL property-content reads before the selected filename reader', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'msl' });
  const nodes = await resolver.content(root.id, { content: b('<image><read filename=" &#9;@雪&#10;name"/><profile local.icc="@profile-text"/></image>') });
  expect(nodes.map(node => [node.location, node.grammar, node.optional])).toEqual([
    [b('/work/雪\nname'), 'text', true], [b('/work/ \t@雪\nname'), undefined, true],
    [b('/work/profile-text'), 'text', true], [b('/work/local.icc'), undefined, true],
  ]);
});

it('orders all MSL write attributes before the resulting output effect', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'msl' });
  const nodes = await resolver.content(root.id, { content: b('<image><write filename="out.ppm" format="@format"/></image>') });
  expect(nodes.map(node => [node.location, node.access])).toEqual([
    [b('/work/format'), 'read'], [b('/work/out.ppm'), 'write'],
  ]);
});

it('retains ordered MSL prefix accesses when later XML syntax is malformed', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'msl' });
  const nodes = await resolver.content(root.id, { content: b('<image><read filename="seed.ppm"/><write filename="out.ppm"/><read filename="unfinished') });
  expect(nodes.map(node => [node.location, node.access])).toEqual([
    [b('/work/seed.ppm'), 'read'], [b('/work/out.ppm'), 'write'],
  ]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues.some(issue => issue.reason === 'syntax')).toBe(true);
});

it('retains coder-prefixed MSL frame and property expressions as filename expressions', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'msl' });
  const nodes = await resolver.content(root.id, { content: b('<image><read filename="PPM:frames-%03d.ppm"/><write filename="PPM:out-%[filename:base]"/></image>') });
  expect(nodes.map(node => [node.kind, node.location, node.access])).toEqual([
    ['filename-expression', b('/work/frames-%03d.ppm'), 'read'],
    ['filename-expression', b('/work/out-%[filename:base]'), 'write'],
  ]);
  expect(nodes.map(node => node.original)).toEqual([b('PPM:frames-%03d.ppm'), b('PPM:out-%[filename:base]')]);
});

it('reads MSL profile attribute names and interprets element and attribute case', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('scripts/job'), access: 'read', grammar: 'msl' });
  const nodes = await resolver.content(root.id, { content: b('<image><READ FILENAME="seed.ppm"/><profile local.icc="https:unused"/><WRITE FILENAME="seed.ppm"/></image>') });
  expect(nodes.map(node => [node.location, node.access])).toEqual([
    [b('/work/seed.ppm'), 'read'], [b('/work/local.icc'), 'read'], [b('/work/seed.ppm'), 'write'],
  ]);
  expect(resolver.graph().edges.filter(edge => edge.kind === 'before')).toEqual([
    { from: nodes[0].id, to: nodes[1].id, kind: 'before' },
    { from: nodes[1].id, to: nodes[2].id, kind: 'before' },
  ]);
});

it('uses MVG image coder and selector grammar while leaving reader filenames unexpanded', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('drawings/job'), access: 'read', grammar: 'mvg' });
  const nodes = await resolver.content(root.id, { content: b("image Over 0,0 1,1 'PPM:雪\nframe.ppm[0]' image Over 0,0 1,1 '@names' image Over 0,0 1,1 'frames*.ppm' image Over 0,0 1,1 'data:image/png;base64,AAAA'") });
  expect(nodes.map(node => [node.kind, node.location])).toEqual([
    ['image-selector', b('/work/雪\nframe.ppm')], ['path', b('/work/@names')],
    ['path', b('/work/frames*.ppm')], ['synthetic', undefined],
  ]);
});
it('keeps MVG data URLs synthetic even when the same name is accessible', async () => {
  const resolver = new DependencyResolver({...options, accessible:async () => true, exists:async () => true});
  const root = await resolver.add({value:b('drawings/job'), access:'read', grammar:'mvg'});
  const nodes = await resolver.content(root.id, {content:b("image Over 0,0 1,1 'DATA:invalid'")});
  expect(nodes).toMatchObject([{original:b('DATA:invalid'),kind:'synthetic',location:undefined}]);
});

it('reports MVG expansion budget exhaustion explicitly and retains preceding occurrences', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 2 } });
  const root = await resolver.add({ value: b('drawings/job'), access: 'read', grammar: 'mvg' });
  const nodes = await resolver.content(root.id, { content: b('image Over 0,0 1,1 first.ppm image Over 0,0 1,1 second.ppm') });
  expect(nodes.map(node => node.original)).toEqual([b('first.ppm')]);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues.some(issue => issue.reason === 'budget')).toBe(true);
});
