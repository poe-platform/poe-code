import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { stageRetainedXmlEdits } from './retained-xml-edits.js';
import { literal } from './retained-values.js';
import type { ByteSource } from '@poe-code/office-package';
async function collect(source: ByteSource) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks); }
function encoded(text: string, encoding: string, bom: boolean) { if (encoding === 'utf-8') return Buffer.from((bom ? '\ufeff' : '') + text); const result = Buffer.concat([bom ? Buffer.from([255,254]) : Buffer.alloc(0), Buffer.from(text,'utf16le')]); return encoding === 'utf-16be' ? result.swap16() : result; }
for (const encoding of ['utf-8','utf-16le','utf-16be']) for (const bom of [true,false]) it(`edits streamed ranges while preserving ${encoding}, BOM ${bom}`, async () => {
  const original = `<root label='old'>\r\n<a>港 &amp; 😀</a><remove/><last/>\r\n</root>`, source = encoded(original,encoding,bom), fs = createMemoryFileSystem();
  const result = await stageRetainedXmlEdits((async function* () { for (let n=0;n<source.length;n++) yield source.subarray(n,n+1); })(), async function* (xml) {
    for await (const token of xml.tokens()) {
      if (token.kind === 'attribute-value') yield { range: token.range, replacement: literal('new &quot; label') };
      if (token.kind === 'text' && (await collect(xml.read(token.range))).toString().includes('港')) yield { range: token.range, replacement: literal('Changed &#x1f600;') };
      if (token.kind === 'start-name' && (await collect(xml.read(token.range))).toString() === 'remove') yield { range: {start:token.range.start-1,length:9},replacement:literal('<added/>') };
    }
  }, {workingStorage:{fs,directory:'/',cacheBytes:16384}});
  const expected = encoded(`<root label='new &quot; label'>\r\n<a>Changed &#x1f600;</a><added/><last/>\r\n</root>`,encoding,bom);
  expect(await collect(result.bytes())).toEqual(expected); expect(result.byteLength).toBe(expected.length);
  const written: Uint8Array[]=[]; await result.write({async write(bytes){expect(bytes.length).toBeLessThanOrEqual(16384);written.push(new Uint8Array(bytes));}}); expect(Buffer.concat(written)).toEqual(expected);
  await result.close(); await result.close(); await expect(collect(result.bytes())).rejects.toMatchObject({code:'invalid-handle'}); expect(await fs.readdir('/')).toEqual([]);
});
it('rejects a malformed source before invoking edits', async () => {
  const fs=createMemoryFileSystem();let called=false;
  await expect(stageRetainedXmlEdits(literal('<root>&bad;</root>'),async function*(){called=true;yield* [];},{workingStorage:{fs,directory:'/',cacheBytes:16384}})).rejects.toMatchObject({code:'invalid-xml'});
  expect(called).toBe(false);expect(await fs.readdir('/')).toEqual([]);
});
for (const replacement of ['</root><other/>','&missing;','<unbound:child/>']) it(`rejects an invalid result before exposing bytes: ${replacement}`,async()=>{
 const fs=createMemoryFileSystem();await expect(stageRetainedXmlEdits(literal('<root>old</root>'),async function*(){yield {range:{start:6,length:3},replacement:literal(replacement)};},{workingStorage:{fs,directory:'/',cacheBytes:16384}})).rejects.toMatchObject({code:'invalid-xml'});expect(await fs.readdir('/')).toEqual([]);
});
for(const range of [{start:-1,length:0},{start:1.5,length:0},{start:0,length:99},{start:7,length:0},{start:6,length:1}]) it(`rejects invalid or split UTF-8 source ranges: ${JSON.stringify(range)}`,async()=>{
 const fs=createMemoryFileSystem();await expect(stageRetainedXmlEdits(literal('<root>港</root>'),async function*(){yield {range,replacement:literal('x')};},{workingStorage:{fs,directory:'/',cacheBytes:16384}})).rejects.toMatchObject({code:'invalid-value'});expect(await fs.readdir('/')).toEqual([]);
});
it('rejects overlapping edits and retires the edit iterator',async()=>{
 const fs=createMemoryFileSystem();let retired=false;await expect(stageRetainedXmlEdits(literal('<root>abcd</root>'),async function*(){try{yield {range:{start:6,length:3},replacement:literal('X')};yield {range:{start:8,length:1},replacement:literal('Y')};}finally{retired=true;}},{workingStorage:{fs,directory:'/',cacheBytes:16384}})).rejects.toMatchObject({code:'invalid-value'});expect(retired).toBe(true);expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['success','source','edit','replacement','write','read','cancel','sink'] as const) it(`bounds staged XML working memory and cleans failures: ${mode}`,async()=>{
 const fs=createMemoryFileSystem(),open=fs.open!.bind(fs),controller=new AbortController();let handles=0,written=0,outstanding=0,peak=0,returned=false,sourceRetired=false,editsRetired=false,replacementRetired=false;
 const failure=new Error('injected '+mode);
 fs.readFile=async()=>{throw new Error('whole-file read forbidden');};
 fs.open=async(...args)=>{const handle=await open(...args);handles++;return new Proxy(handle,{get(target,key){
  if(key==='write')return async(...parameters:Parameters<typeof handle.write>)=>{written+=parameters[0].length;outstanding+=parameters[0].length;peak=Math.max(peak,outstanding);try{if(mode==='write')throw failure;await Promise.resolve();return await handle.write(...parameters);}finally{outstanding-=parameters[0].length;}};
  if(key==='read' && mode==='read')return async()=>{throw failure;};
  if(key==='close')return async()=>{handles--;return handle.close();};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});};
 async function* source(){try{yield* literal('<root>');const reused=new Uint8Array(4096);for(let i=0;i<32;i++){reused.fill(32);yield reused;reused.fill(255);if(mode==='source'&&i===8)throw failure;}yield* literal('<child>old</child></root>');}finally{sourceRetired=true;}}
 const operation=stageRetainedXmlEdits(source(),async function*(xml){try{for await(const token of xml.tokens())if(token.kind==='text'&&token.range.length===3){if(mode==='edit')throw failure;yield {range:token.range,replacement:(async function*(){try{const reused=new Uint8Array(4096);for(let i=0;i<32;i++){reused.fill(120);yield reused;reused.fill(255);if(mode==='replacement'&&i===8)throw failure;if(mode==='cancel'&&i===8)controller.abort();}}finally{replacementRetired=true;}})()};}}finally{editsRetired=true;}},{workingStorage:{fs,directory:'/',cacheBytes:16384},signal:controller.signal});
 if(mode==='success'||mode==='sink'){
  const result=await operation;returned=true;let received=0;const pending=result.write({async write(bytes){if(mode==='sink')throw failure;await Promise.resolve();expect(bytes.length).toBeLessThanOrEqual(16384);received+=bytes.length;}});
  if(mode==='sink')await expect(pending).rejects.toBe(failure);else {await pending;expect(received).toBe(result.byteLength);expect(received).toBe(32*4096*2+28);}
  await result.close();expect(editsRetired).toBe(true);expect(replacementRetired).toBe(true);
 }else if(mode==='edit'||mode==='replacement')await expect(operation).rejects.toBe(failure);else await expect(operation).rejects.toBeDefined();
 expect(sourceRetired).toBe(true);expect(returned).toBe(mode==='success'||mode==='sink');expect(written).toBeGreaterThan(mode==='success'||mode==='sink'?32*4096*2:0);expect(peak).toBeLessThanOrEqual(16384);expect(handles).toBe(0);expect(await fs.readdir('/')).toEqual([]);
});
it('consumes many ordered edits without retaining the collection',async()=>{
 const fs=createMemoryFileSystem();let consumed=0;
 async function* source(){yield* literal('<root>');for(let i=0;i<512;i++)yield* literal('<a>x</a>');yield* literal('</root>');}
 const result=await stageRetainedXmlEdits(source(),async function*(xml){for await(const token of xml.tokens())if(token.kind==='text'){consumed++;yield{range:token.range,replacement:literal('y')};}},{workingStorage:{fs,directory:'/',cacheBytes:16384}});
 expect(consumed).toBe(512);expect((await collect(result.bytes())).toString()).toBe('<root>'+'<a>y</a>'.repeat(512)+'</root>');await result.close();expect(await fs.readdir('/')).toEqual([]);
});
it('retains a borrowed lexical view only during the edit factory',async()=>{
 const fs=createMemoryFileSystem();let view:Parameters<Parameters<typeof stageRetainedXmlEdits>[1]>[0]|undefined;
 const result=await stageRetainedXmlEdits(literal('<root/>'),async function*(xml){view=xml;yield* [];},{workingStorage:{fs,directory:'/',cacheBytes:16384}});
 await expect(collect(view!.read({start:0,length:1}))).rejects.toMatchObject({code:'invalid-handle'});expect((await collect(result.bytes())).toString()).toBe('<root/>');await result.close();
});
for(const kind of ['bytes','nodes','depth','utf8'] as const)it(`enforces final XML ${kind} admission before exposure`,async()=>{
 const fs=createMemoryFileSystem();const replacement=kind==='utf8'?(async function*(){yield new Uint8Array([0xe2]);})():literal(kind==='bytes'?'x'.repeat(100):kind==='nodes'?'<a/><b/><c/>':'<a><b><c/></b></a>');
 await expect(stageRetainedXmlEdits(literal('<root>old</root>'),async function*(){yield{range:{start:6,length:3},replacement};},{workingStorage:{fs,directory:'/',cacheBytes:16384},xmlLimits:{maxBytes:kind==='bytes'?50:Infinity,maxNodes:kind==='nodes'?3:Infinity,maxDepth:kind==='depth'?3:Infinity}})).rejects.toMatchObject({code:kind==='utf8'?'invalid-xml':'resource-limit'});expect(await fs.readdir('/')).toEqual([]);
});
for(const encoding of ['utf-8','utf-16le','utf-16be'])it(`preserves a declaration and no-op bytes in ${encoding}`,async()=>{
 const fs=createMemoryFileSystem(),source=encoded(`<?xml version="1.0" encoding="${encoding === 'utf-8' ? 'utf-8' : 'utf-16'}"?>\r\n<!--before--><root a='港 &amp; 😀'>\r\n<![CDATA[keep]]></root><!--after-->`,encoding,true);
 const result=await stageRetainedXmlEdits((async function*(){yield source;})(),async function*(){},{workingStorage:{fs,directory:'/',cacheBytes:16384}});
 await result.write({async write(bytes){bytes.fill(255);}});expect(await collect(result.bytes())).toEqual(source);await result.close();expect(await fs.readdir('/')).toEqual([]);
});
it('preserves the edit failure when cleanup also fails',async()=>{
 const fs=createMemoryFileSystem(),open=fs.open!.bind(fs),primary=new Error('edit failed');let armed=false;
 fs.open=async(...args)=>{const handle=await open(...args);return new Proxy(handle,{get(target,key){if(key==='close')return async()=>{await handle.close();if(armed)throw new Error('cleanup failed');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
 async function* source(){yield* literal('<root>');for(let i=0;i<16;i++)yield* literal(' '.repeat(4096));yield* literal('</root>');}
 await expect(stageRetainedXmlEdits(source(),async function*(){armed=true;yield* [];throw primary;},{workingStorage:{fs,directory:'/',cacheBytes:16384}})).rejects.toBe(primary);expect(await fs.readdir('/')).toEqual([]);
});
