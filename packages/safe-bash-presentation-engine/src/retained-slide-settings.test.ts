import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedSlideSettings } from './retained-slide-settings.js';
import { mutateSlides, type MutateSlidesOptions } from './slides.js';
import { readSelectionIndex } from './selectors.js';
import { openPackageArchive } from './retained-package.js';
import { readPackage } from './package-reader.js';
import { resourceContext } from './resource-limits.js';
import { fixture, xml, tree, read } from '../tests/fixtures/validation.js';
import { storedArchive } from '../tests/fixtures/archive.js';
const encode=(text:string)=>new TextEncoder().encode(text);
async function collect(source:AsyncIterable<Uint8Array>){const chunks=[];for await(const bytes of source)chunks.push(Buffer.from(bytes));return Buffer.concat(chunks);}
const archiveOf=(reader:ReturnType<typeof read>)=>({async *parts(){yield* reader.names;},async has(part:string){return reader.has(part);},async byteLength(part:string){return reader.get(part).length;},async *read(part:string){yield reader.get(part);}});
const selection={kind:'slide' as const,all:true};
for(const update of [{hidden:true},{hidden:false},{name:'New 港 & " label'},{name:''},{hidden:true,name:'Both'}]) for(const source of ['default','existing','strict','whitespace'])it(`matches buffered slide settings ${source} ${JSON.stringify(update)}`,async()=>{
 const volume=fixture({'slide.xml':source==='whitespace'?xml('sld',tree()).replace('<p:cSld>','<p:cSld  name = "Old"  >'):xml('sld',tree())});
 if(source==='existing')volume.writeFileSync('/deck/slide.xml',xml('sld',tree()).replace('<p:sld ','<p:sld show="0" ').replace('<p:cSld>','<p:cSld name=\'Old\'>'));
 if(source==='strict')for(const [path,text]of Object.entries(volume.toJSON()))volume.writeFileSync(path,text!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
 const reader=read(volume),bytes=storedArchive(Object.entries(volume.toJSON()).map(([path,text])=>({name:path.slice(6),bytes:encode(text!)}))),context=resourceContext({}),index=await readSelectionIndex(bytes,context),fs=createMemoryFileSystem();
 const expected=await readPackage(await mutateSlides(bytes,{selection,...update},context),context);
 const result=await openRetainedSlideSettings(archiveOf(reader),index.fingerprint,{selection,...update},{...context,workingStorage:{fs,directory:'/',cacheBytes:16384}});
 expect(await result.replacement('/main.xml')).toBeUndefined();const replacement=await result.replacement('/slide.xml');expect(Boolean(replacement)).toBe(result.changed);if(replacement)expect(await collect(replacement)).toEqual(Buffer.from(expected.get('/slide.xml')));
 expect(result.affected).toBe(1);for(const part of reader.names)expect(await collect(result.read(part))).toEqual(Buffer.from(expected.get(part)));
 const targets=[];for await(const location of result.targets())targets.push(location);expect(targets).toEqual([index.slides[0]!.location]);
 await result.close();expect(await fs.readdir('/')).toEqual([]);
});
for(const selection of [{kind:'slide',id:'absent'},{kind:'slide',all:true},[{kind:'slide',all:true},{kind:'slide',all:true}]]) for(const allowEmpty of [false,true])it(`preserves selection diagnostics ${JSON.stringify(selection)} allowEmpty ${allowEmpty}`,async()=>{
 const volume=fixture(),reader=read(volume),bytes=storedArchive(Object.entries(volume.toJSON()).map(([path,text])=>({name:path.slice(6),bytes:encode(text!)}))),context=resourceContext({}),index=await readSelectionIndex(bytes,context),fs=createMemoryFileSystem(),options={selection,name:'New',allowEmpty} as MutateSlidesOptions;
 let failure:unknown;try{await mutateSlides(bytes,options,context);}catch(error){failure=error;}
 const pending=openRetainedSlideSettings(archiveOf(reader),index.fingerprint,options,{...context,workingStorage:{fs,directory:'/',cacheBytes:16384}});
 if(failure)await expect(pending).rejects.toMatchObject({code:(failure as {code:string}).code});else await(await pending).close();expect(await fs.readdir('/')).toEqual([]);
});
for(const mode of ['signature','macro','protected','conditional','bad-show','bad-label','missing-common'] as const)it(`preserves mutation admission guard ${mode}`,async()=>{
 const volume=fixture();
 if(mode==='signature')volume.writeFileSync('/deck/[Content_Types].xml',String(volume.readFileSync('/deck/[Content_Types].xml')).replace('application/xml','application/digital-signature+xml'));
 if(mode==='macro')volume.writeFileSync('/deck/[Content_Types].xml',String(volume.readFileSync('/deck/[Content_Types].xml')).replace('presentation.main+xml','macroEnabled.main+xml'));
 if(mode==='protected')volume.writeFileSync('/deck/main.xml',String(volume.readFileSync('/deck/main.xml')).replace('</p:presentation>','<p:modifyVerifier/></p:presentation>'));
 if(mode==='conditional')volume.writeFileSync('/deck/main.xml',String(volume.readFileSync('/deck/main.xml')).replace('</p:presentation>','<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Fallback/></mc:AlternateContent></p:presentation>'));
 if(mode==='bad-show')volume.writeFileSync('/deck/slide.xml',xml('sld',tree()).replace('<p:sld ','<p:sld show="sometimes" '));
 if(mode==='missing-common')volume.writeFileSync('/deck/slide.xml',xml('sld','<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Fallback>'+tree()+'</mc:Fallback></mc:AlternateContent>'));
 const reader=read(volume),bytes=storedArchive(Object.entries(volume.toJSON()).map(([path,text])=>({name:path.slice(6),bytes:encode(text!)}))),context=resourceContext({}),fs=createMemoryFileSystem(),options={selection,name:mode==='bad-label'?'bad\0':'New',hidden:true};
 let failure:unknown;try{await mutateSlides(bytes,options,context);}catch(error){failure=error;}
 expect(failure).toBeDefined();await expect(openRetainedSlideSettings(archiveOf(reader),'a'.repeat(64),options,{...context,workingStorage:{fs,directory:'/',cacheBytes:16384}})).rejects.toMatchObject({code:(failure as {code:string}).code});expect(await fs.readdir('/')).toEqual([]);
});
for(const mode of ['success','write','read','cancel'] as const)it(`spills slide mutation state and cleans ${mode}`,async()=>{
 const volume=fixture({'slide.xml':xml('sld',tree()).replace('<p:cSld>','<p:cSld name="'+'x'.repeat(40000)+'">')}),reader=read(volume),fs=createMemoryFileSystem(),open=fs.open!.bind(fs),controller=new AbortController();let written=0,peak=0,outstanding=0,handles=0;
 fs.readFile=async()=>{throw new Error('payload-wide read forbidden');};
 fs.open=async(...args)=>{const handle=await open(...args);handles++;return new Proxy(handle,{get(target,key){
 if(key==='write')return async(...parameters:Parameters<typeof handle.write>)=>{written+=parameters[0].length;outstanding+=parameters[0].length;peak=Math.max(peak,outstanding);try{if(mode==='write')throw new Error('injected write');if(mode==='cancel')controller.abort();await Promise.resolve();return await handle.write(...parameters);}finally{outstanding-=parameters[0].length;}};
 if(key==='read'&&mode==='read')return async()=>{throw new Error('injected read');};
 if(key==='close')return async()=>{handles--;return handle.close();};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});};
 const archive={...archiveOf(reader),async *read(part:string){const bytes=reader.get(part),reused=new Uint8Array(4096);for(let offset=0;offset<bytes.length;offset+=reused.length){const size=Math.min(reused.length,bytes.length-offset);reused.set(bytes.subarray(offset,offset+size));yield reused.subarray(0,size);reused.fill(255);}}};
 const pending=openRetainedSlideSettings(archive,'a'.repeat(64),{selection,name:'y'.repeat(40000),hidden:true},{workingStorage:{fs,directory:'/',cacheBytes:16384},signal:controller.signal});
 if(mode==='success'){const result=await pending;expect(result.changed).toBe(true);expect(result.affected).toBe(1);const actual=await collect(result.read('/SLIDE.XML'));expect(actual.toString()).toContain('name="'+'y'.repeat(40000)+'"');expect(await result.byteLength('/SLIDE.XML')).toBe(actual.length);await result.close();await expect(collect(result.read('/slide.xml'))).rejects.toMatchObject({code:'invalid-handle'});expect(written).toBeGreaterThan(40000*2);}else await expect(pending).rejects.toBeDefined();
 expect(peak).toBeLessThanOrEqual(16384);expect(handles).toBe(0);expect(await fs.readdir('/')).toEqual([]);
});
for(const options of [null,[],{selection},{selection,name:3},{selection,hidden:'yes'}])it(`rejects invalid settings before archive reads: ${JSON.stringify(options)}`,async()=>{
 const fs=createMemoryFileSystem();let reads=0;const archive={async *parts(){reads++;yield '/unused';},async has(){reads++;return false;},async byteLength(){reads++;return 0;},async *read(){reads++;yield new Uint8Array();}};
 await expect(openRetainedSlideSettings(archive,'a'.repeat(64),options as unknown as MutateSlidesOptions,{workingStorage:{fs,directory:'/',cacheBytes:16384}})).rejects.toMatchObject({code:'invalid-value'});expect(reads).toBe(0);expect(await fs.readdir('/')).toEqual([]);
});

it('feeds only changed parts to retained archive rewriting',async()=>{
 const volume=fixture(),bytes=storedArchive(Object.entries(volume.toJSON()).map(([path,text])=>({name:path.slice(6),bytes:encode(text!)}))),context=resourceContext({}),index=await readSelectionIndex(bytes,context),fs=createMemoryFileSystem(),settings={...context,workingStorage:{fs,directory:'/',cacheBytes:16384}},options={selection,name:'Changed',hidden:true};
 const archive=await openPackageArchive({size:bytes.length,async read(offset,length){return bytes.subarray(offset,offset+length);}},settings),result=await openRetainedSlideSettings(archive,index.fingerprint,options,settings),chunks:Uint8Array[]=[];
 await archive.rewrite({async write(bytes){chunks.push(new Uint8Array(bytes));}},{replace:result.replacement});
 const actual=await readPackage(Buffer.concat(chunks),context),expected=await readPackage(await mutateSlides(bytes,options,context),context);for(const name of expected.names)expect(actual.get(name)).toEqual(expected.get(name));
 await result.close();await archive.close();expect(await fs.readdir('/')).toEqual([]);
});
