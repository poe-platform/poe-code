import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";
import { saveFixture } from "../tests/fixtures/save-output.js";

type Case = { row:number; member:string; body:string; text?:string; style?:string|null|undefined; level?:number; start?:string; oldStart?:string; reject?:string|undefined; companion?:boolean; nativeWidth?:number };
const geometry='<w:sectPr><w:pgSz w:w="6000" w:h="12000"/><w:pgMar w:left="1500" w:right="1000" w:top="1000" w:bottom="1000"/></w:sectPr>';
const authored='<w:p><w:r><w:t>Authored wave — 波</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Middle cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Last block</w:t></w:r></w:p>';
const cases:Case[]=[
 {row:811,member:'add_comment',body:'<w:p><w:r/></w:p>',reject:'unsupported-edit'},
 ...[0,1,2,9].map((level,i)=>({row:812+i,member:'add_heading',body:'',text:'Authored heading',level})),
 {row:816,member:'add_heading',body:'',text:'Authored heading',level:-1,reject:'usage'},
 {row:817,member:'add_page_break',body:''},
 ...[['',null],['','Heading 1'],['foo\rbar','Body Text']].map(([text,style],i)=>({row:818+i,member:'add_paragraph',body:'',text:text as string,style})),
 {row:821,member:'add_picture',body:''},
 {row:822,member:'add_section',body:'<w:p/><w:sectPr/>',start:'EVEN_PAGE'},
 {row:823,member:'add_section',body:'<w:p/><w:sectPr><w:type w:val="evenPage"/></w:sectPr>',start:'ODD_PAGE',oldStart:'evenPage'},
 {row:824,member:'add_section',body:'<w:p/><w:sectPr><w:type w:val="oddPage"/></w:sectPr>',start:'NEW_PAGE',oldStart:'oddPage'},
 {row:825,member:'add_table',body:geometry,style:'Light Shading Accent 1',nativeWidth:3500},
 {row:826,member:'save',body:'<w:p><w:r><w:t>Capability saved</w:t></w:r></w:p>'},
 ...['comments','core_properties','inline_shapes','iter_inner_content','paragraphs','sections','settings','styles','tables','part','body','block_width'].map((member,i)=>({row:827+i,member,body:member==='sections'||member==='block_width'?authored+geometry:authored,...(member==='block_width'?{nativeWidth:3500}:{})})),
 ...['','<w:p/>','<w:sectPr/>','<w:p/><w:sectPr/>'].map((body,i)=>({row:839+i,member:'clear_body',body}))
];
expect(cases.map(c=>c.row)).toEqual(Array.from({length:32},(_,i)=>811+i));
const companions:Case[]=[{...cases[0]!,body:'<w:p><w:r><w:t>Native nonempty anchor</w:t></w:r></w:p>',reject:undefined,companion:true}];
const invalidSecond:Case={...cases[5]!,level:10};
const ref=(resultHandle:string,index?:number)=>({resultHandle,...(index===undefined?{}:{index})});
type Step={operation:string;receiver:ReturnType<typeof ref>;arguments:Record<string,unknown>;resultHandle?:string};
function operations(c:Case):Step[]{
 const out:Step[]=[],add=(operation:string,receiver:string,args:Record<string,unknown>={},handle?:string,index?:number)=>out.push({operation,receiver:ref(receiver,index),arguments:args,...(handle?{resultHandle:handle}:{})});
 if(c.member==='add_comment'){add('model.document.Document.paragraphs.get','document',{},'paragraphs');add('model.text.paragraph.Paragraph.runs.get','paragraphs',{},'runs',0);}
 if(['body','clear_body'].includes(c.member)){add('model.document.Document.element.get','document',{},'root');add('model.XmlElementView.children.get','root',{},'children');add('model.XmlElementView.children.get','children',{},'bodyChildren',0);if(c.member==='clear_body'&&c.body.includes('<w:p'))add('model.XmlElementView.remove.call','bodyChildren',{},undefined,0);else add('model.XmlElementView.tag.get','children',{},undefined,0);return out;}
 const member=c.member==='block_width'?'add_table':c.member,method=member.startsWith('add_')||['iter_inner_content','save'].includes(member),args:Record<string,unknown>=member==='add_heading'?{text:c.text,level:c.level}:member==='add_paragraph'?{text:c.text,style:c.style}:member==='add_section'?{startType:api.WD_SECTION_START[c.start as 'EVEN_PAGE'|'ODD_PAGE'|'NEW_PAGE']}:member==='add_table'?{rows:c.row===825?4:1,cols:2,...(c.style?{style:c.style}:{})}:member==='add_picture'?{input:{path:'/picture.png',capability:'command'},width:100,height:200}:member==='add_comment'?{runs:ref('runs',0),text:'Comment text.'}:member==='save'?{output:{path:'/work/result',capability:'command'}}:{};
 add(`model.document.Document.${member}.${method?'call':'get'}`,'document',args,member==='save'?undefined:'observed');
 if(member==='sections')add('model.section.Sections.__len__.get','observed');
 if(member==='comments')add('model.comments.Comments.__len__.get','observed');
 if(member==='core_properties')add('model.opc.coreprops.CoreProperties.title.get','observed');
 if(member==='inline_shapes')add('model.shape.InlineShapes.__len__.get','observed');
 if(member==='settings')add('model.settings.Settings.odd_and_even_pages_header_footer.get','observed');
 if(member==='styles')add('model.styles.styles.Styles.__len__.get','observed');
 if(member==='part')add('model.opc.part.Part.partname.get','observed');
 return out;
}
for(const strict of [false,true])for(const kind of ['docx','dotx'] as const)for(const c of [...cases,...companions,invalidSecond])for(const route of ['model','sdk','shell'] as const)
it(`${route} independently executes exact document witness R${c.row}; strict=${strict}; kind=${kind}; fixture=${c.companion?'native-anchor-companion':'original'}${c.row===816?`; level=${c.level}`:''}`,async()=>{
 const parts=readPackage(await textFixture(c.body,{styles:{kind:'styles',xml:`<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style><w:style w:type="table" w:styleId="LightShading-Accent1"><w:name w:val="Light Shading Accent 1"/></w:style></w:styles>`},comments:{kind:'comments',xml:`<w:comments xmlns:w="${w}"><w:comment w:id="41" w:author="Original"><w:p/></w:comment></w:comments>`},settings:{kind:'settings',xml:`<w:settings xmlns:w="${w}"><w:evenAndOddHeaders/></w:settings>`}},strict));
 parts.set('metadata/core.xml',new TextEncoder().encode('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Native core title</dc:title></cp:coreProperties>'));
 parts.set('[Content_Types].xml',new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('</Types>','<Override PartName="/metadata/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>').replace(kind==='dotx'?'wordprocessingml.document.main+xml':'__absent__','wordprocessingml.template.main+xml')));
 parts.set('_rels/.rels',new TextEncoder().encode(new TextDecoder().decode(parts.get('_rels/.rels')).replace('</Relationships>','<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="metadata/core.xml"/></Relationships>')));
 const memory=Volume.fromJSON({'/input':'','/out':'','/picture.png':Buffer.from(replacementPng())});await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')}))},{async write(bytes){memory.appendFileSync('/input',bytes);}},{order:'input',compression:'store'},textContext);
 const input=new Uint8Array(memory.readFileSync('/input') as Buffer),env=saveFixture(),context={...textContext,timestamp:new Date('2026-01-02T03:04:06Z'),binaryResolver:{...(c.member==='save'?env.vfs:{open(path:string){return{async *[Symbol.asyncIterator](){yield new Uint8Array(memory.readFileSync(path) as Buffer);}};}}),capability:'command'}},sink={async write(bytes:Uint8Array){memory.appendFileSync('/out',bytes);}},mutation=c.member.startsWith('add_')||['block_width','save','comments','core_properties','settings','styles'].includes(c.member)||(c.member==='clear_body'&&c.body.includes('<w:p')),steps=operations(c);
 const observe=(values:unknown[])=>{const value=values.at(-1);if(c.member==='comments'||c.member==='inline_shapes'||c.member==='styles')expect(value).toBe(c.member==='comments'?1:c.member==='styles'?4:0);else if(c.member==='core_properties')expect(value).toBe('Native core title');else if(c.member==='settings')expect(value).toBe(true);else if(c.member==='part')expect(value).toBe('/word/document.xml');else if(['paragraphs','tables'].includes(c.member))expect((value as unknown[]).length).toBe(c.member==='paragraphs'?2:1);else if(c.member==='iter_inner_content')expect((value as {type:string}[]).map(v=>v.type)).toEqual(['Paragraph','Table','Paragraph']);else if(c.member==='sections')expect(value).toBe(1);};
 if(route==='model'){
  const doc=await api.Document(input,context),before=doc.element.serialize(),run=doc.paragraphs.find(()=>true)?.runs.find(()=>true);const perform=async()=>{
   if(c.member==='add_heading'){const added=doc.add_heading(c.text,c.level);expect(added.equals(doc.paragraphs.at(-1))).toBe(true);expect(added.part).toBe(doc.part);}
   else if(c.member==='add_paragraph'){const added=doc.add_paragraph(c.text,c.style);expect(added.equals(doc.paragraphs.at(-1))).toBe(true);}
   else if(c.member==='add_page_break'){const added=doc.add_page_break();expect(added.equals(doc.paragraphs.at(-1))).toBe(true);}
   else if(c.member==='add_comment'){const comment=doc.add_comment(run!,'Comment text.');expect(comment.comment_id).toBe(42);expect(comment.author).toBe('');expect(comment.initials).toBe('');expect(comment.text).toBe('Comment text.');expect(comment.timestamp).toEqual(context.timestamp);}
   else if(c.member==='add_picture'){const pending=doc.add_picture({path:'/picture.png',capability:'command'},100,200);expect(pending).toBeInstanceOf(Promise);const added=await pending;expect(added.width.emu).toBe(100);expect(added.height.emu).toBe(200);expect(added.part).toBe(doc.part);}
   else if(c.member==='add_section'){const added=doc.add_section(api.WD_SECTION_START[c.start as 'EVEN_PAGE'|'ODD_PAGE'|'NEW_PAGE']);expect(added.equals(doc.sections.at(-1))).toBe(true);expect(added.part).toBe(doc.part);}
   else if(['add_table','block_width'].includes(c.member)){const table=doc.add_table(c.row===825?4:1,2,c.style);expect(table.part).toBe(doc.part);}
   else if(c.member==='save'){const pending=doc.save({path:'/work/result',capability:'command'});expect(pending).toBeInstanceOf(Promise);await pending;memory.writeFileSync('/out',env.bytes('/work/result'));}
   else if(c.member==='clear_body'){const body=doc.element.children[0]!,p=doc.paragraphs.find(()=>true);for(const child of body.children)if(child.localName!=='sectPr')child.remove();if(p)expect(()=>p.text).toThrow(api.StaleHandleError);expect(body.localName).toBe('body');}
   else if(c.member==='body'){expect(doc.element.children[0]!.localName).toBe('body');expect(doc.element.children[0]!.namespace).toBe(strict?'http://purl.oclc.org/ooxml/wordprocessingml/main':w);}
   else if(c.member==='comments')expect(doc.comments.get(41)?.author).toBe('Original');
   else if(c.member==='core_properties')expect(doc.core_properties.title).toBe('Native core title');
   else if(c.member==='inline_shapes')expect(doc.inline_shapes.length).toBe(0);
   else if(c.member==='settings')expect(doc.settings.odd_and_even_pages_header_footer).toBe(true);
   else if(c.member==='styles')expect(doc.styles.at('Body Text').name).toBe('Body Text');
   else if(c.member==='sections')expect(doc.sections.at(0).page_width?.twips).toBe(6000);
   else if(c.member==='part'){expect(String(doc.part.partname)).toBe('/word/document.xml');expect(doc.part.blob).toEqual(parts.get('word/document.xml'));}
   else if(c.member==='iter_inner_content'){const items=[...doc.iter_inner_content()];expect(items.map(b=>b instanceof api.Paragraph?'Paragraph':'Table')).toEqual(['Paragraph','Table','Paragraph']);expect((items[1] as api.Table).rows.at(0).cells[0]!.text).toBe('Middle cell');}
   else expect(Reflect.get(doc,c.member)).toHaveLength(c.member==='paragraphs'?2:1);
  };if(c.reject){await expect(perform()).rejects.toMatchObject({code:c.reject});expect(doc.element.serialize()).toEqual(before);}else{await perform();if(c.member!=='save')await doc.save(sink);}
 }else if(route==='sdk'){
  if(c.reject)await expect(api.applyStyleModelBatch(input,{version:1,operations:steps},context)).rejects.toMatchObject({code:c.reject});else{const batch=await api.applyStyleModelBatch(input,{version:1,operations:steps},context);observe(batch.results.map(r=>r.value));if(c.member==='save'){expect(env.volume.existsSync('/work/result')).toBe(false);await batch.save({path:'/work/result',capability:'command'});memory.writeFileSync('/out',env.bytes('/work/result'));}else await batch.save(sink);}
 }else{
  const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.writeFile('/input',input);await fs.writeFile('/picture.png',replacementPng());await fs.writeFile('/out',new TextEncoder().encode('Original destination'));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));try{const result=await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version:1,operations:steps})}' ${mutation?`--output ${c.member==='save'?'/work/result':'/out'} ${c.member==='save'?'':'--force'}`:''} --timestamp 2026-01-02T03:04:06Z --json`);expect(result.exitCode,result.stdout+result.stderr).toBe(c.reject==='usage'?2:c.reject?1:0);if(c.reject){expect(JSON.parse(result.stdout).errors[0].code).toBe(c.reject);expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Original destination');}else{observe(JSON.parse(result.stdout).data.results.map((r:{data:unknown})=>r.data));if(mutation)memory.writeFileSync('/out',await fs.readFile(c.member==='save'?'/work/result':'/out'));else await(await api.Document(input,context)).save(sink);}expect(await fs.readFile('/input')).toEqual(input);}finally{await shell.dispose();}
 }
 expect(memory.readFileSync('/input')).toEqual(Buffer.from(input));if(c.reject){expect(memory.readFileSync('/out')).toEqual(Buffer.from(''));return;}
 const after=readPackage(new Uint8Array(memory.readFileSync('/out') as Buffer));assertPackageLinks(after);const resourceMutation=['add_picture','add_comment','add_heading'].includes(c.member);for(const[name,bytes]of parts)if(name!=='word/document.xml'&&!(resourceMutation&&['[Content_Types].xml','word/_rels/document.xml.rels','word/comments.xml','word/styles.xml'].includes(name)))expect(after.get(name),name).toEqual(bytes);
 const doc=await api.Document(new Uint8Array(memory.readFileSync('/out') as Buffer),context);
 if(c.member==='add_heading'){expect(doc.paragraphs.at(-1)!.text).toBe(c.text);expect(doc.paragraphs.at(-1)!.style!.name).toBe(c.level===0?'Title':`Heading ${c.level}`);}
 else if(c.member==='add_paragraph'){expect(doc.paragraphs[0]!.text).toBe(c.text!.split('\r').join('\n'));expect(doc.paragraphs[0]!.style!.name).toBe(c.style??'Normal');}
 else if(c.member==='add_page_break'){expect(doc.paragraphs).toHaveLength(1);expect(doc.paragraphs[0]!.runs).toHaveLength(1);expect(doc.paragraphs[0]!.text).toBe('');const run=new api.DocumentXmlEditor(doc.paragraphs[0]!.runs[0]!.element.serialize()).root;expect(run.children[0]!.localName).toBe('br');expect(run.children[0]!.attributes.find(a=>a.localName==='type')!.value).toBe('page');}
 else if(c.member==='add_picture'){expect(doc.inline_shapes.length).toBe(1);expect(doc.inline_shapes.at(0).width.emu).toBe(100);expect(doc.inline_shapes.at(0).height.emu).toBe(200);expect([...after.values()].some(b=>Buffer.from(b).equals(Buffer.from(replacementPng())))).toBe(true);}
 else if(c.member==='add_comment'){expect(doc.comments.get(41)?.author).toBe('Original');expect(doc.comments.get(42)?.text).toBe('Comment text.');expect(doc.paragraphs[0]!.text).toBe('Native nonempty anchor');}
 else if(c.member==='add_section'){expect(doc.sections.length).toBe(2);expect(doc.sections.at(-1).start_type).toEqual(api.WD_SECTION_START[c.start as 'EVEN_PAGE'|'ODD_PAGE'|'NEW_PAGE']);const body=new api.DocumentXmlEditor(after.get('word/document.xml')!).root.children[0]!;expect(body.children.map(n=>n.localName)).toEqual(['p','p','sectPr']);const old=body.children[1]!.children[0]!.children[0]!;expect(old.localName).toBe('sectPr');expect(old.children.find(n=>n.localName==='type')?.attributes.find(a=>a.localName==='val')?.value).toBe(c.oldStart);expect(body.children[2]!.children.find(n=>n.localName==='type')?.attributes.find(a=>a.localName==='val')?.value).toBe(c.start==='NEW_PAGE'?undefined:c.start==='ODD_PAGE'?'oddPage':'evenPage');}
 else if(['add_table','block_width'].includes(c.member)){const table=doc.tables.at(-1)!;expect(table.rows.length).toBe(c.row===825?4:1);expect(table.columns.length).toBe(2);expect(table.columns.at(0).width?.twips).toBe(1750);expect(table.columns.at(1).width?.twips).toBe(1750);expect(table.rows.at(0).cells[0]!.paragraphs).toHaveLength(1);if(c.style)expect(table.style?.name).toBe(c.style);}
 else if(c.member==='clear_body'){expect(doc.paragraphs).toHaveLength(0);expect(doc.tables).toHaveLength(0);expect(new api.DocumentXmlEditor(after.get('word/document.xml')!).root.children[0]!.children.map(n=>n.localName)).toEqual(c.body.includes('sectPr')?['sectPr']:[]);}
 else expect(after.get('word/document.xml')).toEqual(parts.get('word/document.xml'));
});
