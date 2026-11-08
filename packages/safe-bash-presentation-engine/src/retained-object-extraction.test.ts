import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { extractObject } from './opaque-objects.js';
import { openRetainedObjectExtraction } from './retained-object-extraction.js';
import { streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const enc = new TextEncoder();
const cases = [
  ['application/vnd.openxmlformats-officedocument.oleObject', `${r}/oleObject`],
  ['application/octet-stream', `${r}/package`], ['application/x-fontdata', 'urn:unknown'],
  ['font/custom', 'urn:unknown'], ['model/gltf+json; charset=utf-8', 'urn:unknown'],
  ['application/octet-stream', 'urn:unknown'], ['APPLICATION/VND.MS-OFFICE.VBAPROJECT;version=1', 'urn:unknown']
];
for (const [type, relationship] of cases) for (const cyclic of [false, true, 'complete'] as const) it(`streams opaque extraction ${type}, cyclic=${cyclic}`, async () => {
  const rels = (body: string) => enc.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`);
  const parts = new Map<string, Uint8Array>([
    ['/[Content_Types].xml', enc.encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/object.bin" ContentType="${type}"/></Types>`)],
    ['/_rels/.rels', rels(`<Relationship Id="obj" Type="${relationship}" Target="object.bin"/>`)],
    ['/object.bin', enc.encode('opaque payload')],
    ['/other.bin', new Uint8Array([77,90,0,1])],
    ['/_rels/object.bin.rels', rels(`<Relationship Id="b" Type="urn:dependency" Target="other.bin"/><Relationship Id="x" Type="urn:external" TargetMode="External" Target="https://example.com/${'x'.repeat(33000)}"/>`)],
    ...cyclic ? [['/_rels/other.bin.rels', rels('<Relationship Id="a" Type="urn:dependency" Target="object.bin"/>' + (cyclic === true ? '<Relationship Id="missing" Type="urn:dependency" Target="absent.bin"/>' : ''))] as [string, Uint8Array]] : []
  ]);
  const bytes = storedArchive([...parts].map(([name, bytes]) => ({name:name.slice(1),bytes})));
  const context = resourceContext({}), fs = createMemoryFileSystem();
  fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  const archive = { async *parts() { yield* parts.keys(); }, async has(part: string) { return parts.has(part); }, async byteLength(part: string) { return parts.get(part)!.length; }, async *read(part: string) { const bytes = parts.get(part)!, reused = new Uint8Array(4096); for(let p=0;p<bytes.length;p+=reused.length) { const n=Math.min(reused.length,bytes.length-p); reused.set(bytes.subarray(p,p+n)); yield reused.subarray(0,n); reused.fill(255); } } };
  let expected, error;
  try { expected = await extractObject(bytes, {part:'/object.bin'}, context); } catch (failure) { error=failure; }
  const promise=openRetainedObjectExtraction(archive,{part:'/object.bin'},{...context,workingStorage:{fs,directory:'/',cacheBytes:16384}});
  if(error) await expect(promise).rejects.toMatchObject({code:(error as {code:string}).code,message:(error as Error).message});
  else {
    const reader=await promise, files=[];
    for await(const member of reader.members()) {const chunks:Uint8Array[]=[];for await(const bytes of member.bytes()) chunks.push(new Uint8Array(bytes));files.push({part:member.part,name:member.name,bytes:new Uint8Array(Buffer.concat(chunks))});}
    expect(files).toEqual([{part:expected!.part,name:expected!.name,bytes:expected!.bytes},...expected!.dependencies]);expect(reader.count).toBe(files.length);
    let json='';for await(const bytes of streamJson(reader.relationships())) json+=new TextDecoder().decode(bytes);expect(JSON.parse(json)).toEqual(expected!.relationships);
    await reader.close(); await reader.close(); await expect(reader.members().next()).rejects.toMatchObject({code:'invalid-handle'});
  }
  expect(await fs.readdir('/')).toEqual([]);
});
