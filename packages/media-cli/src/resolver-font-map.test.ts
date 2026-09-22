import { expect, it } from 'vitest';
import { DependencyResolver } from './resolver.js';
import evidence from '../test-fixtures/native/dependency-font-map-native-evidence-20260921.json';

const b = (value: string) => new TextEncoder().encode(value);
const options = { cwd: b('/work'), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } };

it.each([true, false])('selects literal font-map paths using cwd accessibility first: %s', async cwdAccessible => {
  const probes: string[] = [];
  const resolver = new DependencyResolver({ ...options, accessible: async path => {
    const name = new TextDecoder().decode(path);
    probes.push(name);
    return name === '/work/https:Case雪.ttf' ? cwdAccessible : true;
  } });
  const root = await resolver.add({ value: b('config/type.xml'), access: 'read', grammar: 'magick-config' });
  const content = b('<typemap><type glyphs="https:Case雪.ttf"/></typemap>');
  const unchanged = content.slice();
  const [font] = await resolver.content(root.id, { content });
  expect(font.original).toEqual(b('https:Case雪.ttf'));
  expect(font.location).toEqual(b(cwdAccessible ? '/work/https:Case雪.ttf' : '/work/config/https:Case雪.ttf'));
  expect(font).toMatchObject({ kind: 'path', literal: true, live: true, upload: false, access: 'read' });
  expect(probes).toEqual(cwdAccessible ? ['/work/https:Case雪.ttf'] : ['/work/https:Case雪.ttf', '/work/config/https:Case雪.ttf']);
  expect(content).toEqual(unchanged);
});

it('retains both optional font candidates when metadata is unavailable without guessing a winner', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('config/type.xml'), access: 'read', grammar: 'magick-config' });
  const fonts = await resolver.content(root.id, { content: b('<typemap><type glyphs="Case.ttf" metrics="case.ttf"/></typemap>') });
  expect(fonts.map(node => node.location)).toEqual(['/work/Case.ttf', '/work/config/Case.ttf', '/work/case.ttf', '/work/config/case.ttf'].map(b));
  expect(fonts.every(node => node.optional && node.live && !node.upload)).toBe(true);
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'live', detail: expect.stringContaining('Font-map') }));
});

it('uses case-insensitive native config names and literal includes without XML URL bases', async () => {
  const resolver = new DependencyResolver(options);
  const root = await resolver.add({ value: b('config/type.xml'), access: 'read', grammar: 'magick-config' });
  const [include, delegate] = await resolver.content(root.id, { content: b('<typemap xml:base="https://cdn/"><INCLUDE FILE="https:child.xml"/><DELEGATE COMMAND="helper %i %o"/></typemap>') });
  expect(include).toMatchObject({ literal: true, kind: 'path', grammar: 'magick-config' });
  expect(include.original).toEqual(b('https:child.xml'));
  expect(include.location).toEqual(b('/work/config/https:child.xml'));
  expect(delegate).toMatchObject({ kind: 'delegate', location: undefined, live: true, upload: false });
});

it('keeps failed font metadata advisory and reports alternative expansion budget exhaustion', async () => {
  const resolver = new DependencyResolver({ ...options, budgets: { ...options.budgets, nodes: 2 },
    accessible: async () => { throw new Error('metadata unavailable'); } });
  const root = await resolver.add({ value: b('config/type.xml'), access: 'read', grammar: 'magick-config' });
  const fonts = await resolver.content(root.id, { content: b('<typemap><type glyphs="absent.ttf"/></typemap>') });
  expect(fonts.map(node => node.location)).toEqual([b('/work/absent.ttf')]);
  expect(fonts[0].optional).toBe(true);
  expect(resolver.graph().status).toBe('incomplete');
  expect(resolver.graph().issues).toContainEqual(expect.objectContaining({ reason: 'budget' }));
});

it('qualifies original font-map candidates against independent native metadata access traces', async () => {
  // Trace data is test evidence only. Unknown metadata keeps both candidates;
  // successful native stat does not establish a later font byte read.
  for (const sample of evidence.cases) {
    expect(sample.before).toEqual(sample.after);
    expect(sample.runs.map(run => run.status)).toEqual([0, 0]);
    expect(sample.runs[0].stdout_sha256).toBe(sample.runs[1].stdout_sha256);
    const resolver = new DependencyResolver({ ...options, cwd: b(evidence.cwd) });
    const root = await resolver.add({ value: b('config/type.xml'), access: 'read', grammar: 'magick-config' });
    const fonts = await resolver.content(root.id, { content: b('<typemap><type name="OriginalResolverFont" family="OriginalResolverFont" glyphs="https:Case雪.ttf"/></typemap>') });
    expect(sample.manifest).toBe('<typemap><type name="OriginalResolverFont" family="OriginalResolverFont" glyphs="https:Case雪.ttf"/></typemap>');
    expect(sample.runs[1].font_stat_attempts.length).toBeGreaterThan(0);
    for (const path of sample.runs[1].font_stat_attempts) {
      const absolute = path.startsWith('/') ? path : evidence.cwd + '/' + path;
      expect(fonts.some(node => Buffer.from(node.location!).equals(b(absolute)))).toBe(true);
    }
    expect(fonts.every(node => node.literal && node.optional && node.live && !node.upload)).toBe(true);
  }
});
