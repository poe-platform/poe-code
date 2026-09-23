import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
type Case={row:number;inner:string;attributes?:string;member:string;expected:unknown};
const address='https://links.example.invalid/coast',r=(text:string)=>`<w:r><w:t>${text}</w:t></w:r>`;
const cases:Case[]=[
 {row:1276,inner:r('post'),attributes:'r:id="rId6"',member:'address',expected:address},
 {row:1277,inner:'',attributes:'w:anchor="_Toc147925734"',member:'address',expected:''},
 {row:1278,inner:'',member:'address',expected:''},
 ...[['',false],['<w:r/>',false],['<w:r><w:t>abc</w:t><w:lastRenderedPageBreak/><w:t>def</w:t></w:r>',true],['<w:r><w:lastRenderedPageBreak/><w:t>abc</w:t><w:t>def</w:t></w:r>',true],['<w:r><w:t>abc</w:t><w:t>def</w:t><w:lastRenderedPageBreak/></w:r>',true]].map(([inner,expected],i)=>({row:1279+i,inner:inner as string,member:'contains_page_break',expected})),
 {row:1284,inner:'',attributes:'r:id="rId6"',member:'fragment',expected:''},
 {row:1285,inner:'',attributes:'w:anchor="intro"',member:'fragment',expected:'intro'},
 ...[['',0],['<w:r/>',1],['<w:r/><w:r/>',2],['<w:r/><w:lastRenderedPageBreak/>',1],['<w:lastRenderedPageBreak/><w:r/>',1],['<w:r/><w:lastRenderedPageBreak/><w:r/>',2]].map(([inner,expected],i)=>({row:1286+i,inner:inner as string,member:'runs',expected})),
 ...[['',''],['<w:r/>',''],[r('foobar'),'foobar'],['<w:r><w:t>foo</w:t><w:lastRenderedPageBreak/><w:t>bar</w:t></w:r>','foobar'],['<w:r><w:t>abc</w:t><w:tab/><w:t>def</w:t><w:noBreakHyphen/></w:r>','abc\tdef‑']].map(([inner,expected],i)=>({row:1292+i,inner:inner!,member:'text',expected})),
 {row:1297,inner:'',member:'url',expected:''},
 {row:1298,inner:'',attributes:'w:anchor="_Toc147925734"',member:'url',expected:''},
 {row:1299,inner:r('post'),attributes:'r:id="rId6"',member:'url',expected:address},
 {row:1300,inner:r('post'),attributes:'r:id="rId6" w:anchor="foo"',member:'url',expected:address+'#foo'}
];
expect(cases.map(c=>c.row)).toEqual(Array.from({length:25},(_,i)=>1276+i));
const ref=(resultHandle:string,index?:number)=>({resultHandle,...(index===undefined?{}:{index})});
for(const strict of [false,true])for(const kind of ['docx','dotx'] as const)for(const c of cases)for(const route of ['model','sdk','shell'])
it(`${route} independently executes exact hyperlink witness R${c.row}; strict=${strict}; kind=${kind}`,async()=>{
 const parts=readPackage(await textFixture(`<w:p><w:pPr><w:bidi/></w:pPr><w:hyperlink ${c.attributes??''}>${c.inner}</w:hyperlink><w:r><w:rPr><w:i/></w:rPr><w:t>Untouched é 日本 עברית 🌊</w:t></w:r></w:p>`,{},strict)),rel=strict?'http://purl.oclc.org/ooxml/officeDocument/relationships':'http://schemas.openxmlformats.org/officeDocument/2006/relationships';parts.set('word/_rels/document.xml.rels',new TextEncoder().encode(new TextDecoder().decode(parts.get('word/_rels/document.xml.rels')).replace('</Relationships>',`<Relationship Id="rId6" Type="${rel}/hyperlink" Target="${address}" TargetMode="External"/></Relationships>`)));
 if(kind==='dotx')parts.set('[Content_Types].xml',new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('wordprocessingml.document.main+xml','wordprocessingml.template.main+xml')));const volume=Volume.fromJSON({'/input':'','/out':''});await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')}))},{async write(bytes){volume.appendFileSync('/input',bytes);}},{order:'input',compression:'store'},textContext);const input=new Uint8Array(volume.readFileSync('/input') as Buffer),sink={async write(bytes:Uint8Array){volume.appendFileSync('/out',bytes);}},operations=[{operation:'model.document.Document.paragraphs.get',receiver:ref('document'),arguments:{},resultHandle:'paragraphs'},{operation:'model.text.paragraph.Paragraph.hyperlinks.get',receiver:ref('paragraphs',0),arguments:{},resultHandle:'links'},{operation:`model.text.hyperlink.Hyperlink.${c.member}.get`,receiver:ref('links',0),arguments:{}}],observe=(value:unknown)=>expect(c.member==='runs'?(value as unknown[]).length:value).toEqual(c.expected);
 if(route==='model'){const doc=await api.Document(input,textContext),p=doc.paragraphs[0]!,link=p.hyperlinks[0]!;expect(link).toBeInstanceOf(api.Hyperlink);expect(link.part).toBe(p.part);observe(Reflect.get(link,c.member));if(c.member==='runs'){const xml=new api.DocumentXmlEditor(link.element.serialize());expect(link.runs.map(run=>new TextDecoder().decode(run.element.serialize()).includes('<w:r'))).toEqual(Array.from({length:c.expected as number},()=>true));expect(xml.root.children.filter(n=>n.localName==='r')).toHaveLength(c.expected as number);for(const run of link.runs)expect(run.part).toBe(link.part);}expect(p.runs).toHaveLength(1);expect(p.runs[0]!.italic).toBe(true);await doc.save(sink);}else if(route==='sdk'){const batch=await api.applyStyleModelBatch(input,{version:1,operations},textContext);observe(batch.results.at(-1)!.value);expect(batch.affected).toBe(0);await batch.save(sink);}else{const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/out',new TextEncoder().encode('Original destination'));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));try{const result=await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version:1,operations})}' --json`);expect(result.exitCode,result.stdout+result.stderr).toBe(0);observe(JSON.parse(result.stdout).data.results.at(-1).data);expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Original destination');expect(await fs.readFile('/input')).toEqual(input);await(await api.Document(input,textContext)).save(sink);}finally{await shell.dispose();}}
 const after=readPackage(new Uint8Array(volume.readFileSync('/out') as Buffer));assertPackageLinks(after);expect(after.size).toBe(parts.size);for(const[name,bytes]of parts)expect(after.get(name),name).toEqual(bytes);expect(volume.readFileSync('/input')).toEqual(Buffer.from(input));
});
