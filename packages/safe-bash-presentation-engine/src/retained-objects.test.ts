import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { readObjects } from './opaque-objects.js';
import { openRetainedObjects } from './retained-objects.js';
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
for (const [type, relationship] of cases) for (const cyclic of [false, true]) it(`retains opaque inventory ${type}, cyclic=${cyclic}`, async () => {
  const rels = (body: string) => enc.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`);
  const parts = new Map<string, Uint8Array>([
    ['/[Content_Types].xml', enc.encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/object.bin" ContentType="${type}"/></Types>`)],
    ['/_rels/.rels', rels(`<Relationship Id="obj" Type="${relationship}" Target="object.bin"/>`)],
    ['/object.bin', enc.encode('opaque payload')],
    ['/other.bin', new Uint8Array([77,90,0,1])],
    ['/_rels/object.bin.rels', rels(`<Relationship Id="b" Type="urn:dependency" Target="other.bin"/><Relationship Id="x" Type="urn:external" TargetMode="External" Target="https://example.com/${'x'.repeat(33000)}"/>`)],
    ...cyclic ? [['/_rels/other.bin.rels', rels('<Relationship Id="a" Type="urn:dependency" Target="object.bin"/><Relationship Id="missing" Type="urn:dependency" Target="absent.bin"/>')] as [string, Uint8Array]] : []
  ]);
  const bytes = storedArchive([...parts].map(([name, bytes]) => ({name:name.slice(1),bytes})));
  const context = resourceContext({}), fs = createMemoryFileSystem();
  fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  const archive = { async *parts() { yield* parts.keys(); }, async has(part: string) { return parts.has(part); }, async byteLength(part: string) { return parts.get(part)!.length; }, async *read(part: string) { const bytes = parts.get(part)!, reused = new Uint8Array(4096); for(let p=0;p<bytes.length;p+=reused.length) { const n=Math.min(reused.length,bytes.length-p); reused.set(bytes.subarray(p,p+n)); yield reused.subarray(0,n); reused.fill(255); } } };
  const expected = await readObjects(bytes, context);
  const reader = await openRetainedObjects(archive, { ...context, workingStorage: { fs, directory:'/', cacheBytes:16384 } });
  let json = ''; for await (const chunk of streamJson({objects:reader.objects(), activationPerformed:false, recursiveParsingPerformed:false})) json += new TextDecoder().decode(chunk);
  expect(JSON.parse(json)).toEqual(expected);
  await reader.close(); await reader.close(); expect(await fs.readdir('/')).toEqual([]);
  await expect(reader.objects().next()).rejects.toMatchObject({code:'invalid-handle'});
});

for (const mode of ['success','cancel','storage','source'] as const) it(`spills a generated dependency graph with bounded IO: ${mode}`, async()=> {
  const count=180,parts=new Map<string,Uint8Array>();
  parts.set('/[Content_Types].xml',enc.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/root.bin" ContentType="application/x-fontdata"/></Types>'));
  parts.set('/root.bin',new Uint8Array(256*1024));
  const relationships=(body:string)=>enc.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`);
  parts.set('/_rels/root.bin.rels',relationships(Array.from({length:count},(_,n)=>`<Relationship Id="r${n}" Type="urn:dependency" Target="p${n}.bin"/>`).join('')));
  for(let n=0;n<count;n++) {parts.set(`/p${n}.bin`,new Uint8Array([0,n%256]));parts.set(`/_rels/p${n}.bin.rels`,relationships('<Relationship Id="cycle" Type="urn:dependency" Target="root.bin"/>'));}
  const controller=new AbortController(),fs=createMemoryFileSystem(),open=fs.open!.bind(fs);let handles=0,written=0,pending=0,peak=0;
  fs.readFile=async()=>{throw new Error('whole-file read forbidden');};
  fs.open=async(...args)=>{const handle=await open(...args);handles++;return new Proxy(handle,{get(target,key){
    if(key==='write') return async(...args:Parameters<typeof handle.write>)=>{if(mode==='storage')throw new Error('storage failed');const size=args[0].length;written+=size;pending+=size;peak=Math.max(peak,pending);try{await Promise.resolve();return await handle.write(...args);}finally{pending-=size;}};
    if(key==='close')return async()=>{handles--;return handle.close();};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});};
  const archive={async *parts(){yield* parts.keys();},async has(part:string){return parts.has(part);},async byteLength(part:string){return parts.get(part)!.length;},async *read(part:string){const bytes=parts.get(part)!,reuse=new Uint8Array(4096);for(let p=0;p<bytes.length;p+=reuse.length){if(part==='/root.bin'&&p>0){if(mode==='source')throw new Error('source failed');if(mode==='cancel')controller.abort();}const n=Math.min(reuse.length,bytes.length-p);reuse.set(bytes.subarray(p,p+n));yield reuse.subarray(0,n);reuse.fill(255);}}};
  const promise=openRetainedObjects(archive,{signal:controller.signal,workingStorage:{fs,directory:'/',cacheBytes:16384}});
  if(mode==='success') {
    const reader=await promise;let json='';for await(const chunk of streamJson(reader.objects())){await Promise.resolve();json+=new TextDecoder().decode(chunk);}
    const objects=JSON.parse(json);expect(objects).toHaveLength(1);expect(objects[0].dependencies).toEqual(Array.from({length:count},(_,n)=>`/p${n}.bin`).sort());expect(objects[0].owners).toHaveLength(count);expect(objects[0].missing).toEqual([]);
    await reader.close();expect(written).toBeGreaterThan(16384*4);expect(peak).toBeLessThanOrEqual(16384);
  } else await expect(promise).rejects.toMatchObject({code:mode==='cancel'?'cancelled':'io-failure'});
  expect(handles).toBe(0);expect(await fs.readdir('/')).toEqual([]);
});
