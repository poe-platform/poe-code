import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedTransitions } from './retained-transitions.js';
import { readTransitions } from './transitions.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
const cases = [
  '', '<p:transition><p:cut/></p:transition>', '<p:transition><p:fade/></p:transition>',
  '<p:transition advClick="false" advTm=" +000123 "><p:push dir="r"/></p:transition>',
  '<p:transition xmlns:q="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="q" q:dur="2147483647"><p:wipe/></p:transition>',
  '<p:transition/><p:transition/>', '<p:transition><p:cut/><p:fade/></p:transition>',
  '<p:transition><p:cut thruBlk="1"/></p:transition>', '<p:transition><p:cut thruBlk="false"/><p:sndAc/></p:transition>',
  '<p:transition><p:push dir="invalid"/></p:transition>', '<p:transition><p:push><p:child/></p:push></p:transition>',
  '<p:transition><p:fade/><p:sndAc/><p:sndAc/></p:transition>',
  '<p:transition><p:cut/></p:transition><p:extLst><p:ext uri="x"><p:transition/></p:ext></p:extLst>',
  '<p:transition unknown="yes"><p:fade/></p:transition>', '<p:transition advClick="on"><p:cut/></p:transition>',
  '<p:extLst><p:ext uri="unknown"><p:transition><p:fade/></p:transition></p:ext></p:extLst>',
  ...['', ' ', '+', '-0', '1e2', '0x10', '2147483648', '\u00a0+12\u00a0', '0'.repeat(40000) + '123'].map(value => `<p:transition advTm="${value}"><p:fade/></p:transition>`),
  `<p:transition ignored="${'x'.repeat(40000)}"><p:fade/></p:transition>`
];
for (const strict of [false, true]) for (const [caseIndex, transition] of cases.entries()) for (const selected of [false, true]) it(`retains transition read parity ${caseIndex}, strict=${strict}, selected=${selected}`, async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2') + transition) });
  if (strict) for (const [path, value] of Object.entries(volume.toJSON())) volume.writeFileSync(path, value!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  const reader = read(volume);
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) })));
  const context = resourceContext({}), fingerprint = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join(''), options = selected ? { selection: { kind: 'slide' as const, position: { coordinateSystem: 'one-based' as const, value: 1 } } } : {};
  const fs = createMemoryFileSystem(); fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { const bytes = reader.get(part), chunk = new Uint8Array(8192); for (let p = 0; p < bytes.length; p += chunk.length) { const count = Math.min(chunk.length, bytes.length - p); chunk.set(bytes.subarray(p, p + count)); yield chunk.subarray(0, count); chunk.fill(255); } } };
  let expected, error;
  try { expected = await readTransitions(bytes, options, context); } catch (failure) { error = failure; }
  const result = openRetainedTransitions(archive, fingerprint, options, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (error) await expect(result).rejects.toMatchObject({ message: (error as Error).message });
  else { const value = await result, records = []; for await (const record of value.records()) records.push(record); expect(records).toEqual(expected); expect(value.count).toBe(expected!.length); await value.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
