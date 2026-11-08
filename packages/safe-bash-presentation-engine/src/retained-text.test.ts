import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedText } from './retained-text.js';
import { streamJson } from './retained-output.js';
import { readPresentationText, type ReadPresentationTextOptions } from './text-reading.js';
import { readSelectionIndex } from './selectors.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
const shape = (id: number, body: string, name = 'Text') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;
const run = (text: string) => `<a:r><a:t>${text}</a:t></a:r>`;
const archiveOf = (reader: ReturnType<typeof read>) => ({ async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } });
async function collected(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const mode of ['plain', 'groups', 'table', 'compatibility', 'strict'] as const) it(`retains complete structural text with buffered parity: ${mode}`, async () => {
  let content = shape(3, `<a:p>${run('港 &amp; 😀')}<a:br/><a:fld id="clock" type="date"><a:t>Yesterday</a:t></a:fld></a:p><a:p/>`);
  if (mode === 'groups') content = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="Group"/></p:nvGrpSpPr>${content}${shape(4, `<a:p>${run('Last')}</a:p>`)}</p:grpSp>`;
  if (mode === 'table') content = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/main/table"><a:tbl><a:tr><a:tc><a:txBody><a:p>${run('Cell')}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p/></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  if (mode === 'compatibility') content = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:unknown"><mc:Choice Requires="x">${shape(4, '<a:p/>')}</mc:Choice><mc:Fallback>${content}</mc:Fallback></mc:AlternateContent>`;
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', content)) });
  if (mode === 'strict') for (const [path, source] of Object.entries(volume.toJSON())) volume.writeFileSync(path, source!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  const reader = read(volume), bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) }))), context = resourceContext({});
  const index = await readSelectionIndex(bytes, context);
  const options: ReadPresentationTextOptions[] = [{}, { scope: 'layouts' }, { scope: 'masters' }, { select: { kind: 'slide', position: { coordinateSystem: 'one-based', value: 1 } } }, { select: { token: index.objects.find(value => value.id === '3')!.token } }];
  for (const option of options) {
    const fs = createMemoryFileSystem(), expected = await readPresentationText(bytes, option, context);
    const result = await openRetainedText(archiveOf(reader), index.fingerprint, option, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
    expect(JSON.parse(await collected(streamJson({ text: result.text, order: 'structural', segments: result.segments() })))).toEqual(expected);
    await result.close(); expect(await fs.readdir('/')).toEqual([]);
  }
});

it('preserves selection admission and candidate diagnostics across text scopes', async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', shape(3, '<a:p/>') + shape(4, '<a:p/>'))) });
  const reader = read(volume), bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) }))), context = resourceContext({});
  const index = await readSelectionIndex(bytes, context), slide = { kind: 'slide' as const, id: '256' };
  const options: ReadPresentationTextOptions[] = [
    { shape: 'Text' }, { shape: 'Text', select: slide }, { shape: 'Missing', select: slide }, { shape: 'Text', select: { ...slide, all: true } },
    { scope: 'notes', shape: 'Lantern', select: slide }, { scope: 'notes-master' }, { scope: 'handout-master' }, { scope: 'notes-master', select: slide },
    { scope: 'notes', select: { token: index.objects.find(item => item.part === '/slide.xml')!.token } },
    { select: { kind: 'part', part: '/slide.xml', scope: 'slides' } }, { select: { kind: 'slide', id: '999' } },
    { select: { token: index.slides[0]!.token.replace(index.fingerprint, '0'.repeat(64)) } }
  ];
  for (const option of options) {
    const fs = createMemoryFileSystem(); let expected, failure;
    try { expected = await readPresentationText(bytes, option, context); } catch (error) { failure = error; }
    const admission = openRetainedText(archiveOf(reader), index.fingerprint, option, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
    if (failure) {
      const error = failure as { code: string; phase: string; message: string; candidates?: unknown };
      await expect(admission).rejects.toMatchObject({ code: error.code, phase: error.phase, message: error.message, ...(error.candidates ? { candidates: error.candidates } : {}) });
    } else {
      const result = await admission; expect(JSON.parse(await collected(streamJson({ text: result.text, order: 'structural', segments: result.segments() })))).toEqual(expected); await result.close();
    }
    expect(await fs.readdir('/')).toEqual([]);
  }
});

for (const mode of ['success', 'read', 'write', 'cancel'] as const) it(`uses bounded caller-backed text state and retires spills: ${mode}`, async () => {
  const content = `Text 😀 &amp; ${'x'.repeat(40000)}`;
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', shape(3, `<a:p><a:fld id="${content}" type="${content}"><a:t><![CDATA[First]]><a:span>${content}</a:span>Last</a:t></a:fld><a:br/>${run(content)}</a:p><a:p/>`))) });
  const owner = createMemoryFileSystem(), controller = new AbortController(); let writes = 0, peak = 0, outstanding = 0, handles = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      expect(args[0].startsWith('/.storage-')).toBe(true); const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(descriptor, property) {
        if (property === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
          if (mode === 'write') throw new Error('injected write'); if (mode === 'cancel') controller.abort();
          writes += parameters[0].length; outstanding += parameters[0].length; peak = Math.max(peak, outstanding);
          try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= parameters[0].length; }
        };
        if (property === 'read') return async (...parameters: Parameters<typeof handle.read>) => { if (mode === 'read') throw new Error('injected read'); return handle.read(...parameters); };
        if (property === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
        const value = Reflect.get(descriptor, property, descriptor); return typeof value === 'function' ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const reader = read(volume), archive = archiveOf(reader);
  archive.read = async function* (part: string) { const bytes = reader.get(part), reused = new Uint8Array(8192); for (let offset = 0; offset < bytes.length; offset += reused.length) { const count = Math.min(reused.length, bytes.length - offset); reused.set(bytes.subarray(offset, offset + count)); yield reused.subarray(0, count); reused.fill(255); } };
  const admission = openRetainedText(archive, 'a'.repeat(64), {}, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (mode === 'success') {
    const result = await admission;
    expect(await collected(result.text())).toBe(`First${content.replaceAll('&amp;', '&')}Last\v${content.replaceAll('&amp;', '&')}\n`);
    expect(writes).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
    let segment; for await (const value of result.segments()) { segment = value; break; }
    await result.close(); await expect(collected(segment!.text())).rejects.toMatchObject({ code: 'invalid-handle' });
  } else await expect(admission).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  expect(handles).toBe(0); expect(await owner.readdir('/')).toEqual([]);
});

for (const mode of ['text', 'frames'] as const) for (const options of [null, undefined]) it(`rejects absent ${mode} options before archive admission: ${options}`, async () => {
  const fs = createMemoryFileSystem(), archive = archiveOf(read(fixture()));
  await expect(openRetainedText(archive, 'a'.repeat(64), options as unknown as ReadPresentationTextOptions, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, mode)).rejects.toMatchObject({ code: 'invalid-value', phase: 'usage', message: 'Invalid text reading options.' });
  expect(await fs.readdir('/')).toEqual([]);
});
