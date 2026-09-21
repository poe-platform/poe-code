import {expect,it} from "vitest";
import {Volume} from "memfs";
import * as api from "./index.js";
import {textContext,textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

for(const strict of [false,true])for(const form of ['simple','complex'] as const)
for(const carrier of ['direct','choice','fallback','process'] as const)for(const route of ['sdk','cli'])
it(`native nonbreaking/soft hyphen field caches retain logical characters and can be replaced; ${form}; ${carrier}; strict=${strict}; ${route}`,async()=>{
 const attrs='xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:field-hyphens" mc:Ignorable="f" mc:ProcessContent="f:pass"',inert='<f:inert stamp="retained"/>',wrap=(s:string)=>carrier==='direct'?s:carrier==='process'?`<f:pass>${s}</f:pass>`:`<mc:AlternateContent><mc:Choice Requires="${carrier==='choice'?'w':'f'}">${carrier==='choice'?s:inert}</mc:Choice><mc:Fallback>${carrier==='fallback'?s:inert}</mc:Fallback></mc:AlternateContent>`;
 const cache=`<w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>A</w:t>${wrap('<w:noBreakHyphen/>')}<w:t>B</w:t>${wrap('<w:softHyphen/>')}<w:t>C é 海</w:t></w:r>`,field=form==='simple'?`<w:fldSimple w:instr=" REF Coast " w:dirty="0" w:fldLock="1">${cache}</w:fldSimple>`:`<w:r><w:fldChar w:fldCharType="begin" w:dirty="0" w:fldLock="1"/><w:instrText> REF Coast </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>${cache}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
 const input=await textFixture(`<w:p ${attrs}><!--owner--><?p keep?>${field}</w:p>`,{},strict),v=Volume.fromJSON({'/input':Buffer.from(input),'/out':'','/err':''}),stdout={async write(b:Uint8Array){v.appendFileSync('/out',b);}};
 const logical='A\u2011B\u00adC é 海';expect((await api.extractDocumentText(input,textContext)).text).toBe(logical);expect((await api.inspectDocumentFields(input,{},textContext)).items[0]).toMatchObject({instruction:' REF Coast ',result:logical,update:false,locked:true});
 if(route==='sdk')await api.editDocumentFields(input,{operation:'fields.set',options:{field:1,result:'New é 海',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout});
 else{const r=await api.createDocxInspectionCommandEngine({limits:textContext.limits}).execute({args:['fields','set','/input','--field','1','--result','New é 海','--output','-'].map(s=>new TextEncoder().encode(s)),cwd:'/',signal:textContext.signal,filesystem:{async readFile(p){return new Uint8Array(v.readFileSync(p) as Buffer);}},stdin:{async *[Symbol.asyncIterator](){}},stdout,stderr:{async write(b){v.appendFileSync('/err',b);}}});expect(r.exitCode,v.readFileSync('/err','utf8') as string).toBe(0);}
 const output=new Uint8Array(v.readFileSync('/out') as Buffer),before=readPackage(input),after=readPackage(output);for(const[p,b]of before)if(p!=='word/document.xml')expect(after.get(p),p).toEqual(b);
 const xml=new TextDecoder().decode(after.get('word/document.xml'));expect(xml).toContain('<!--owner--><?p keep?>');expect(xml).toContain('<w:b/><w:rtl/>');expect(xml.split(inert).length).toBe(new TextDecoder().decode(before.get('word/document.xml')).split(inert).length);
 expect((await api.inspectDocumentFields(output,{},textContext)).items[0]).toMatchObject({instruction:' REF Coast ',result:'New é 海',update:false,locked:true});expect((await api.extractDocumentText(output,textContext)).text).toBe('New é 海');expect(v.readFileSync('/input')).toEqual(Buffer.from(input));
});
