import {expect,it} from "vitest";
import {Volume} from "memfs";
import * as api from "./index.js";
import {textContext,textFixture,w} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

for(const strict of [false,true])for(const name of ['header','footer'] as const)
for(const suffix of ['dat','XML'])for(const route of ['sdk','cli'])
it(`default caption sequence detects native ${name} owner regardless of part extension; ${suffix}; strict=${strict}; ${route}`,async()=>{
 const source=await textFixture(`<w:p><w:r><w:t>Report</w:t></w:r></w:p><w:sectPr><w:${name}Reference w:type="default" r:id="stored"/></w:sectPr>`,{stored:{kind:name,xml:`<w:${name==='header'?'hdr':'ftr'} xmlns:w="${w}"><w:p><w:fldSimple w:instr=" SEQ Figure "><w:r><w:t>8</w:t></w:r></w:fldSimple></w:p></w:${name==='header'?'hdr':'ftr'}>`}},strict),p=readPackage(source),old='word/stored.xml',current=`word/stored.${suffix}`;
 p.set(current,p.get(old)!);p.delete(old);
 for(const path of ['[Content_Types].xml','word/_rels/document.xml.rels'])p.set(path,new TextEncoder().encode(new TextDecoder().decode(p.get(path)).split('stored.xml').join(`stored.${suffix}`)));
 const volume=Volume.fromJSON({'/input':'','/out':'','/json':''});await api.writeArchive({comment:new Uint8Array(),members:[...p].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')}))},{async write(b){volume.appendFileSync('/input',b);}},{order:'input',compression:'store'},textContext);
 const input=new Uint8Array(volume.readFileSync('/input') as Buffer),stdout={async write(b:Uint8Array){volume.appendFileSync('/out',b);}};
 expect((await api.inspectDocumentFields(input,{scope:name==='header'?'headers':'footers'},textContext)).items[0]).toMatchObject({kind:'SEQ',result:'8'});
 if(route==='sdk')await expect(api.editDocumentFields(input,{operation:'captions.add',options:{paragraph:1,label:'Figure',text:'New coast',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout})).rejects.toMatchObject({code:'unsupported-edit'});
 else{const result=await api.createDocxInspectionCommandEngine({limits:textContext.limits}).execute({args:['captions','add','/input','--paragraph','1','--label','Figure','--text','New coast','--dry-run','--json'].map(s=>new TextEncoder().encode(s)),cwd:'/',signal:textContext.signal,filesystem:{async readFile(path){return new Uint8Array(volume.readFileSync(path) as Buffer);}},stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(b){volume.appendFileSync('/json',b);}},stderr:{async write(){}}});expect(result.exitCode).toBe(1);expect(JSON.parse(volume.readFileSync('/json','utf8') as string)).toMatchObject({ok:false,affected:0,errors:[{code:'unsupported-edit'}]});}
 expect(volume.readFileSync('/out')).toHaveLength(0);expect(volume.readFileSync('/input')).toEqual(Buffer.from(input));
 await api.editDocumentFields(input,{operation:'captions.add',options:{paragraph:1,label:'Figure',text:'New coast',sequence:'Figure',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout});
 const output=new Uint8Array(volume.readFileSync('/out') as Buffer),after=readPackage(output);for(const[path,bytes]of p)if(path!=='word/document.xml')expect(after.get(path),path).toEqual(bytes);
 expect((await api.inspectDocumentFields(output,{scope:'all-stories'},textContext)).items.map(i=>[i.kind,i.result])).toEqual([['SEQ',''],['SEQ','8']]);
});

for(const strict of [false,true])for(const route of ['sdk','cli'])
it(`caption sequence census leaves declared opaque binary with xml suffix inert; strict=${strict}; ${route}`,async()=>{
 const p=readPackage(await textFixture('<w:p><w:r><w:t>Report</w:t></w:r></w:p>',{},strict)),types=new TextDecoder().decode(p.get('[Content_Types].xml'));
 p.set('[Content_Types].xml',new TextEncoder().encode(types.replace('</Types>','<Override PartName="/audit/inert.xml" ContentType="application/octet-stream"/></Types>')));p.set('audit/inert.xml',Uint8Array.of(0,255,7,17));
 const volume=Volume.fromJSON({'/input':'','/out':'','/err':''});await api.writeArchive({comment:new Uint8Array(),members:[...p].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')}))},{async write(b){volume.appendFileSync('/input',b);}},{order:'input',compression:'store'},textContext);
 const input=new Uint8Array(volume.readFileSync('/input') as Buffer),stdout={async write(b:Uint8Array){volume.appendFileSync('/out',b);}};
 if(route==='sdk')await api.editDocumentFields(input,{operation:'captions.add',options:{paragraph:1,label:'Figure',text:'New coast',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout});
 else{const result=await api.createDocxInspectionCommandEngine({limits:textContext.limits}).execute({args:['captions','add','/input','--paragraph','1','--label','Figure','--text','New coast','--output','-'].map(s=>new TextEncoder().encode(s)),cwd:'/',signal:textContext.signal,filesystem:{async readFile(path){return new Uint8Array(volume.readFileSync(path) as Buffer);}},stdin:{async *[Symbol.asyncIterator](){}},stdout,stderr:{async write(b){volume.appendFileSync('/err',b);}}});expect(result.exitCode,volume.readFileSync('/err','utf8') as string).toBe(0);}
 const after=readPackage(new Uint8Array(volume.readFileSync('/out') as Buffer));for(const[path,bytes]of p)if(path!=='word/document.xml')expect(after.get(path),path).toEqual(bytes);expect(volume.readFileSync('/input')).toEqual(Buffer.from(input));
});
