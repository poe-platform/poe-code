import {expect,it} from "vitest";
import {Volume} from "memfs";
import * as api from "./index.js";
import {textContext,textFixture} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

for(const strict of [false,true])for(const form of ['simple','complex'] as const)
for(const carrier of ['direct','choice','fallback','process'])
for(const name of ['tab','ptab','br','cr','noBreakHyphen','softHyphen'])for(const route of ['sdk','cli'])
it(`native ${name} cache structural replacement retains interior XML trivia; ${form}; ${carrier}; strict=${strict}; ${route}`,async()=>{
 const attrs='xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:cache-trivia" mc:Ignorable="f" mc:ProcessContent="f:pass"',inert='<f:inert stamp="retained"/>',wrap=(s:string)=>carrier==='direct'?s:carrier==='process'?`<f:pass>${s}</f:pass>`:`<mc:AlternateContent><mc:Choice Requires="${carrier==='choice'?'w':'f'}">${carrier==='choice'?s:inert}</mc:Choice><mc:Fallback>${carrier==='fallback'?s:inert}</mc:Fallback></mc:AlternateContent>`;
 const nativeAttrs=name==='ptab'?' w:alignment="center" w:relativeTo="margin" w:leader="dot"':'';
 const trivia=' \n<!--first native--><?first keep?>\t',last='<!--last native--><?last keep?>',cache=`<w:r><w:rPr><w:b/><w:rtl/></w:rPr>${wrap(`<w:${name}${nativeAttrs}>${trivia}</w:${name}>`)}<w:t>Sea é 海</w:t>${wrap(`<w:${name}${nativeAttrs}>${last}</w:${name}>`)}</w:r>`,field=form==='simple'?`<w:fldSimple w:instr=" REF Coast " w:dirty="0" w:fldLock="1">${cache}</w:fldSimple>`:`<w:r><w:fldChar w:fldCharType="begin" w:dirty="0" w:fldLock="1"/><w:instrText> REF Coast </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>${cache}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
 const input=await textFixture(`<w:p ${attrs}><!--owner--><?p keep?>${field}</w:p>`,{},strict),v=Volume.fromJSON({'/input':Buffer.from(input),'/out':'','/err':''}),stdout={async write(b:Uint8Array){v.appendFileSync('/out',b);}};
 const literal=name==='tab'||name==='ptab'?'\t':name==='noBreakHyphen'?'\u2011':name==='softHyphen'?'\u00ad':'\n';expect((await api.inspectDocumentFields(input,{},textContext)).items[0]).toMatchObject({result:literal+'Sea é 海'+literal,instruction:' REF Coast ',update:false,locked:true});
 if(route==='sdk')await api.editDocumentFields(input,{operation:'fields.set',options:{field:1,result:'\tNew é 海\n',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout});
 else{const r=await api.createDocxInspectionCommandEngine({limits:textContext.limits}).execute({args:['fields','set','/input','--field','1','--result','\tNew é 海\n','--output','-'].map(s=>new TextEncoder().encode(s)),cwd:'/',signal:textContext.signal,filesystem:{async readFile(p){return new Uint8Array(v.readFileSync(p) as Buffer);}},stdin:{async *[Symbol.asyncIterator](){}},stdout,stderr:{async write(b){v.appendFileSync('/err',b);}}});expect(r.exitCode,v.readFileSync('/err','utf8') as string).toBe(0);}
 const output=new Uint8Array(v.readFileSync('/out') as Buffer),before=readPackage(input),after=readPackage(output);for(const[p,b]of before)if(p!=='word/document.xml')expect(after.get(p),p).toEqual(b);
 const xml=new TextDecoder().decode(after.get('word/document.xml'));expect(xml).toContain(trivia);expect(xml).toContain(last);expect(xml).toContain('<!--owner--><?p keep?>');expect(xml).toContain('<w:b/><w:rtl/>');expect(xml.split(inert).length).toBe(new TextDecoder().decode(before.get('word/document.xml')).split(inert).length);
 expect((await api.inspectDocumentFields(output,{},textContext)).items[0]).toMatchObject({instruction:' REF Coast ',result:'\tNew é 海\n',update:false,locked:true});expect((await api.extractDocumentText(output,textContext)).text).toBe('\tNew é 海\n');expect(v.readFileSync('/input')).toEqual(Buffer.from(input));
});
