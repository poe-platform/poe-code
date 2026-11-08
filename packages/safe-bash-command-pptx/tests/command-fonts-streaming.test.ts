import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
function deck(payload: string) {
  return storedArchive([
    {name:'[Content_Types].xml',bytes:encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/x-fontdata"/><Default Extension="xml" ContentType="application/xml"/></Types>')},
    {name:'object.bin',bytes:encode(payload)},
    {name:'deck.xml',bytes:encode('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:embeddedFontLst><p:embeddedFont><p:font typeface="'+payload+'"/><p:regular r:id="font"/></p:embeddedFont></p:embeddedFontLst></p:presentation>')},
    {name:'_rels/deck.xml.rels',bytes:encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="font" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="object.bin"/></Relationships>')},
    {name:'_rels/.rels',bytes:encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="o" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="object.bin"/><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="deck.xml"/></Relationships>')},
    {name:'_rels/object.bin.rels',bytes:encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="urn:external" TargetMode="External" Target="https://example.com/'+payload+'"/></Relationships>')}
  ]);
}
for (const json of [false,true]) it(`streams font inventory, json=${json}`, async()=> {
 const bytes=deck('payload'),fs=createMemoryFileSystem(),signal=new AbortController().signal,engine=createPptxCommandEngine(),chunks:Uint8Array[]=[];
 const args=['fonts','list','/deck.pptx',...(json?['--json']:[])].map(encode);
 const expected=await engine.execute({args,signal,readInput:async()=>bytes});
 const result=await engine.execute({args,signal,readInput:async()=>{throw new Error('whole input forbidden');},streaming:{workingStorage:{fs,directory:'/',cacheBytes:16384},openInput:async()=>({size:bytes.length,async read(p,n){return bytes.subarray(p,p+n);},async *stream(){yield bytes;}}),stdout:{async write(bytes){chunks.push(new Uint8Array(bytes));}},stderr:{async write(){throw new Error('unexpected stderr');}}}});
 expect(result.exitCode).toBe(expected.exitCode);expect(Buffer.concat([...chunks,result.stdout])).toEqual(Buffer.from(expected.stdout));expect(result.stderr).toEqual(expected.stderr);expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage'] as const) it(`stages font inventory output with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck('x'.repeat(80000));
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController(); let written = 0, outstanding = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide read forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      if (mode === 'storage') throw new Error('injected storage failure');
      written += parameters[0].length; outstanding += parameters[0].length; peak = Math.max(peak, outstanding);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= parameters[0].length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 100 } : {}), args = ['fonts', 'list', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
  const execution = engine.execute({ args, signal: controller.signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { const size = Math.min(n, reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + size)); return reused.subarray(0, size); },
      async *stream() { for (let p = 0; p < bytes.length; p += reused.length) { const size = Math.min(reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + size)); yield reused.subarray(0, size); reused.fill(255); } } }),
    stdout: { async write(bytes) { if (mode === 'sink') throw new Error('injected sink failure'); if (mode === 'cancel') controller.abort(); await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostics'); } }
  } });
  if (mode === 'sink') await expect(execution).rejects.toThrow('injected sink failure');
  else if (mode === 'cancel') await expect(execution).rejects.toMatchObject({ code: 'cancelled' });
  else {
    const result = await execution;
    if (mode === 'storage') { expect(result.exitCode).toBe(3); expect(chunks).toEqual([]); }
    else {
      const expected = await engine.execute({ args, signal: controller.signal, readInput: async () => bytes });
      expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
      expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384); if (mode === 'limit') expect(chunks).toEqual([]);
    }
  }
  expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});

for (const stdin of [false, true]) it(`routes the default adapter through retained input, stdin=${stdin}`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const owner = createMemoryFileSystem(), bytes = deck('payload');
  await owner.writeFile('/deck.pptx', bytes); await owner.mkdir('/scratch'); let retained = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { retained++; return owner.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['fonts', 'list', stdin ? '-' : '/deck.pptx', '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () { if (stdin) yield bytes; })(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); if (!stdin) expect(retained).toBeGreaterThan(0);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { fonts: [{ kind: 'font' }] } });
  expect(await owner.readdir('/scratch')).toEqual([]);
});

