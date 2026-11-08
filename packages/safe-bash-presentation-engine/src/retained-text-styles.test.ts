import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { parseXmlPart } from './xml.js';
import { resolveTextStyles, type TextStyleContext } from './text-style-resolution.js';
import { openRetainedTextStyles } from './retained-text-styles.js';
import { literal } from './retained-values.js';
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main', a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const shape = (body: string, tail = '') => `<p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="body" idx="7"/></p:nvPr></p:nvSpPr><p:txBody>${body}</p:txBody>${tail}</p:sp>`;
const drawing = (tag: string, body: string, tail = '') => `<p:${tag} xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld>${tail}</p:${tag}>`;
function fixture(run: string) {
  return {
    slide: drawing('sld', shape(`<a:lstStyle/><a:p><a:pPr><a:defRPr i="1"/></a:pPr><a:r>${run}<a:t>Text</a:t></a:r></a:p>`)),
    layout: drawing('sldLayout', shape('<a:lstStyle><a:lvl1pPr><a:defRPr b="1" sz="2400"/></a:lvl1pPr></a:lstStyle>')),
    master: drawing('sldMaster', shape('<a:lstStyle><a:lvl1pPr><a:defRPr><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></a:lstStyle>'), '<p:clrMap tx1="dk1"/>'),
    theme: `<a:theme xmlns:a="${a}"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Display"/></a:majorFont><a:minorFont><a:ea typeface="East"/></a:minorFont></a:fontScheme><a:clrScheme><a:dk1><a:srgbClr val="abc123"/></a:dk1></a:clrScheme></a:themeElements></a:theme>`
  };
}
async function materialize(value: unknown): Promise<unknown> {
  if (typeof value === 'function') { let text = ''; const decoder = new TextDecoder(); for await (const bytes of value()) text += decoder.decode(bytes, { stream: true }); return text + decoder.decode(); }
  if (Array.isArray(value)) return Promise.all(value.map(materialize));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await materialize(item)])));
  return value;
}
for (const run of [
  '<a:rPr b="0"><a:latin typeface="+mj-lt"/><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>',
  '<a:rPr lang="en-US" sz="0002400" baseline="-25000" spc="+125" u="wavyDbl" strike="dblStrike" cap="small"/>',
  '<a:rPr b="yes" sz="99" baseline="1.5" spc="400001" u="bad" strike="bad" cap="bad" lang=""/>',
  '<a:rPr><a:noFill/><a:latin typeface="+missing"/><a:highlight><a:srgbClr val="ABCDEF"/></a:highlight></a:rPr>',
  '<a:rPr><a:solidFill><a:schemeClr val="absent"/></a:solidFill></a:rPr>',
  '<a:rPr><a:solidFill><a:srgbClr val="ABCDEF"><a:tint val="1000"/></a:srgbClr></a:solidFill></a:rPr>'
]) it('matches all effective properties and provenance without collecting scalar values', async () => {
  const files = fixture(run), fs = createMemoryFileSystem();
  const input = Object.fromEntries(Object.entries(files).map(([key, source]) => [key, { part: `/${key}.xml`, source: () => literal(source) }]));
  const expected = resolveTextStyles(Object.fromEntries(Object.entries(files).map(([key, source]) => [key, { part: `/${key}.xml`, root: parseXmlPart(new TextEncoder().encode(source), { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }).root }])) as unknown as TextStyleContext);
  const session = await openRetainedTextStyles(input as unknown as Parameters<typeof openRetainedTextStyles>[0], { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  const actual = []; for await (const record of session.records()) actual.push(await materialize(record));
  expect(actual).toEqual(expected); await session.close(); expect(await fs.readdir('/')).toEqual([]);
});

type Files = Partial<Record<keyof Parameters<typeof openRetainedTextStyles>[0], string>> & { slide: string };
async function parity(files: Files) {
  const fs = createMemoryFileSystem(), input = Object.fromEntries(Object.entries(files).map(([key, source]) => [key, { part: `/${key}.xml`, source: () => literal(source) }]));
  const buffered: Record<string, unknown> = {}, overrides = [];
  for (const [key, source] of Object.entries(files)) {
    const part = { part: `/${key}.xml`, root: parseXmlPart(new TextEncoder().encode(source), { maxBytes: 1000000, maxNodes: 10000, maxDepth: 100 }).root };
    if (['slideTheme', 'layoutTheme', 'masterTheme'].includes(key)) overrides.push(part); else buffered[key] = part;
  }
  buffered.themeOverrides = overrides;
  let expected, failure;
  try { expected = resolveTextStyles(buffered as unknown as TextStyleContext); } catch (error) { failure = error; }
  const opening = openRetainedTextStyles(input as unknown as Parameters<typeof openRetainedTextStyles>[0], { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (failure) await expect(opening).rejects.toMatchObject({ code: (failure as { code: string }).code });
  else {
    const session = await opening, actual = [];
    for await (const record of session.records()) actual.push(await materialize(record));
    expect(actual).toEqual(expected);
    await session.close(); await expect(session.records().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  }
  expect(await fs.readdir('/')).toEqual([]);
}
for (const run of [
  ...['+mj-lt', '+mn-lt', '+mj-ea', '+mn-ea', '+mj-cs', '+mn-cs', '+invalid', '', 'Literal Face'].map(token => `<a:rPr><a:latin typeface="${token}"/></a:rPr>`),
  ...['0', '1', 'false', 'true', ' false', 'FALSE', ''].map(value => `<a:rPr b="${value}" i="${value}"/>`),
  ...['0000100', '400000', '400001', '+100', ' 100', '1e3', '', '000'].map(value => `<a:rPr sz="${value}" baseline="${value}" spc="${value}"/>`),
  ...['srgbClr val="abc123"', 'srgbClr val="bad"', 'sysClr val="windowText"', 'prstClr val="red"', 'schemeClr val="accent1"'].map(value => `<a:rPr><a:solidFill><a:${value}/></a:solidFill></a:rPr>`),
  '<a:rPr><a:solidFill/><a:solidFill/></a:rPr>',
  '<a:rPr><a:latin/><a:latin/></a:rPr>'
]) it('preserves scalar admission and unresolved reasons', async () => { await parity(fixture(run)); });

for (const files of [
  { ...fixture(''), slide: drawing('sld', shape('<a:p><a:endParaRPr lang="end"/></a:p><a:p><a:fld><a:rPr b="1"/></a:fld><a:br><a:rPr i="1"/></a:br></a:p>')) },
  { ...fixture(''), slide: drawing('sld', shape('<a:p><a:pPr lvl="8"/><a:r/></a:p>')), presentation: drawing('presentation', '', '<p:defaultTextStyle><a:lvl9pPr><a:defRPr lang="default"/></a:lvl9pPr></p:defaultTextStyle>') },
  { ...fixture(''), slide: drawing('sld', shape('<a:p><a:pPr lvl="9"/></a:p>')) },
  { ...fixture(''), slide: drawing('sld', shape('<a:p><a:pPr/><a:pPr/></a:p>')) },
  { ...fixture(''), layout: drawing('sldLayout', shape('') + shape('')) },
  { ...fixture(''), master: drawing('sldMaster', shape('') + shape('')) },
  { ...fixture(''), slide: drawing('sld', shape('<a:p/>', '<p:style><a:fontRef idx="major"><a:srgbClr val="aabbcc"/></a:fontRef></p:style>')) },
  { ...fixture(''), slide: drawing('sld', shape('<a:p/>', '<p:style><a:fontRef idx="none"><a:schemeClr val="tx1"/></a:fontRef></p:style>')) },
  { ...fixture('<a:rPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>'), slideTheme: `<a:themeOverride xmlns:a="${a}"><a:clrScheme><a:dk1><a:srgbClr val="987654"/></a:dk1></a:clrScheme></a:themeOverride>` },
  { ...fixture('<a:rPr><a:latin typeface="+mj-lt"/></a:rPr>'), layoutTheme: `<a:themeOverride xmlns:a="${a}"><a:fontScheme><a:majorFont><a:latin typeface="Override"/></a:majorFont></a:fontScheme></a:themeOverride>` },
  { ...fixture('<a:rPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>'), theme: `<a:theme xmlns:a="${a}"><a:themeElements><a:clrScheme/><a:clrScheme/></a:themeElements></a:theme>` },
  { slide: drawing('sld', shape('<a:p><a:r><a:rPr lang="first"/></a:r></a:p>') + '<p:grpSp>' + shape('<a:p><a:r><a:rPr lang="group"/></a:r></a:p>') + '<p:grpSp>' + shape('<a:p><a:r><a:rPr lang="nested"/></a:r></a:p>') + '</p:grpSp></p:grpSp>' + shape('<a:p><a:r><a:rPr lang="last"/></a:r></a:p>')) }
] satisfies Files[]) it('preserves inheritance layers, theme overrides, traversal and structure errors', async () => { await parity(files); });

it('resolves strict namespaces with the same precedence', async () => {
  const files = fixture('<a:rPr><a:latin typeface="+mj-lt"/><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>');
  await parity(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, value.split(p).join('http://purl.oclc.org/ooxml/presentationml/main').split(a).join('http://purl.oclc.org/ooxml/drawingml/main')])) as Files);
});

for (const mode of ['success', 'read', 'write', 'cancel', 'source'] as const) it(`spills long style scalars, numeric tokens and provenance with owned cleanup: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController();
  let handles = 0, written = 0, pending = 0, peak = 0;
  fs.readFile = async () => { throw new Error('payload-wide read forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'read' && mode === 'read') return async () => { throw new Error('injected read failure'); };
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      if (mode === 'write') throw new Error('injected write failure');
      if (mode === 'cancel') controller.abort();
      const length = parameters[0].length; written += length; pending += length; peak = Math.max(peak, pending);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const encode = (text: string) => new TextEncoder().encode(text);
  async function* slide() {
    const chunk = new Uint8Array(4096);
    async function* repeated(byte: number) { for (let n = 0; n < 8; n++) { chunk.fill(byte); yield chunk; chunk.fill(255); } }
    yield encode(`<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="`);
    yield* repeated(48); yield encode('2"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr sz="');
    yield* repeated(48); yield encode('2400" lang="'); yield* repeated(108);
    if (mode === 'source') throw new Error('injected source failure');
    yield encode('"><a:latin typeface="'); yield* repeated(102);
    yield encode('"/></a:rPr><a:t>text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  }
  const opening = openRetainedTextStyles({ slide: { part: '/slide.xml', source: slide } }, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (mode !== 'success') await expect(opening).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  else {
    const session = await opening, next = await session.records().next();
    if (next.done) throw new Error('Expected a style record');
    const record = next.value;
    expect(record.properties.size.value).toBe(24);
    const font = record.properties.latin.value;
    expect(typeof font).toBe('function'); let size = 0;
    if (typeof font === 'function') for await (const bytes of font()) { await Promise.resolve(); expect(bytes.every(value => value === 102)).toBe(true); size += bytes.length; }
    expect(size).toBe(32768);
    expect(await materialize(record.properties.language.value)).toBe('l'.repeat(32768));
    expect(await materialize(record.properties.latin.source!.path)).toBe(`shape[${'0'.repeat(32768)}2]/p[0]/run[0]/rPr`);
    expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
    await session.close(); await expect(record.shapeId()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  }
  expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});

it('spills shape traversal frames and list links separately from XML payload storage', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let spilledStores = 0, outstanding = 0, peak = 0;
  fs.readFile = async () => { throw new Error('payload-wide read forbidden'); };
  fs.open = async (...args) => {
    const handle = await open(...args); let wrote = false;
    return new Proxy(handle, { get(target, key) {
      if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
        if (!wrote) { wrote = true; spilledStores++; }
        const length = parameters[0].length; outstanding += length; peak = Math.max(peak, outstanding);
        try { return await handle.write(...parameters); } finally { outstanding -= length; }
      };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  async function* slide() {
    yield* literal(`<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>`);
    for (let n = 0; n < 1024; n++) yield* literal(`<p:sp><p:nvSpPr><p:cNvPr id="${n}"/></p:nvSpPr>${n === 1023 ? '<p:txBody><a:p><a:endParaRPr lang="last"/></a:p></p:txBody>' : ''}</p:sp>`);
    yield* literal('</p:spTree></p:cSld></p:sld>');
  }
  const session = await openRetainedTextStyles({ slide: { part: '/slide.xml', source: slide } }, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  const records = []; for await (const record of session.records()) records.push(await materialize(record));
  expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ shapeId: '1023', properties: { language: { value: 'last' } } });
  expect(spilledStores).toBeGreaterThanOrEqual(2); expect(peak).toBeLessThanOrEqual(16384);
  await session.close(); expect(await fs.readdir('/')).toEqual([]);
});
