import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { readFonts } from './opaque-objects.js';
import { openRetainedFonts } from './retained-fonts.js';
import { streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
const enc=new TextEncoder();
for(const strict of [false,true])for(const variant of ['normal','long','duplicate','no-font','missing','external','wrong-type','no-id','foreign','root-missing','bulk'] as const)it(`retains font inventory ${variant}, strict=${strict}`,async()=>{
 const p=strict?'http://purl.oclc.org/ooxml/presentationml/main':'http://schemas.openxmlformats.org/presentationml/2006/main',r=strict?'http://purl.oclc.org/ooxml/officeDocument/relationships':'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const rels=(body:string)=>enc.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`),label=variant==='long'?'Font'.repeat(16000):'Typeface';
 const declaration=`<p:embeddedFont>${variant==='no-font'?'':`<p:font typeface="${label}" charset="0" pitchFamily="34"/>`}<p:regular ${variant==='no-id'?'':'r:id="font"'}/><p:bold r:id="absent"/><p:italic/><p:unknown/></p:embeddedFont>`;
 const parts=new Map<string,Uint8Array>([
 ['/[Content_Types].xml',enc.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>')],
 ['/_rels/.rels',rels(`<Relationship Id="main" Type="${r}/officeDocument" Target="${variant==='root-missing'?'absent.xml':'deck.xml'}"/>`)],
 ['/deck.xml',enc.encode(`<p:presentation xmlns:p="${variant==='foreign'?'urn:foreign':p}" xmlns:r="${r}"><p:embeddedFontLst>${declaration}${variant==='duplicate'?declaration:variant==='bulk'?declaration.repeat(200):''}</p:embeddedFontLst></p:presentation>`)],
 ['/_rels/deck.xml.rels',rels(`<Relationship Id="font" Type="${r}/${variant==='wrong-type'?'image':'font'}" Target="${variant==='missing'?'absent.fntdata':variant==='external'?'https://example.com/font':'font.fntdata'}"${variant==='external'?' TargetMode="External"':''}/>`)],
 ['/font.fntdata',enc.encode('font bytes')],['/other.bin',new Uint8Array([77,90])]
 ]);
 const bytes=storedArchive([...parts].map(([name,bytes])=>({name:name.slice(1),bytes}))),context=resourceContext({}),fs=createMemoryFileSystem();fs.readFile=async()=>{throw new Error('whole-file read forbidden');};
 const archive={async *parts(){yield* parts.keys();},async has(part:string){return parts.has(part);},async byteLength(part:string){return parts.get(part)!.length;},async *read(part:string){const bytes=parts.get(part)!,reuse=new Uint8Array(4096);for(let p=0;p<bytes.length;p+=reuse.length){const n=Math.min(reuse.length,bytes.length-p);reuse.set(bytes.subarray(p,p+n));yield reuse.subarray(0,n);reuse.fill(255);}}};
 let expected,error;try{expected=await readFonts(bytes,context);}catch(failure){error=failure;}
 const promise=openRetainedFonts(archive,{...context,workingStorage:{fs,directory:'/',cacheBytes:16384}});
 if(error)await expect(promise).rejects.toMatchObject({code:(error as {code:string}).code,message:(error as Error).message});
 else {const reader=await promise;let json='';for await(const bytes of streamJson({declarations:reader.declarations(),fonts:reader.fonts(),installationPerformed:false}))json+=new TextDecoder().decode(bytes);expect(JSON.parse(json)).toEqual(expected);await reader.close();await reader.close();await expect(reader.declarations().next()).rejects.toMatchObject({code:'invalid-handle'});}
 expect(await fs.readdir('/')).toEqual([]);
});
