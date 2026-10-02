import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";

type Case = { row: number; inner: string; member: string; value?: unknown; expected?: unknown; after?: string; reject?: string; companion?: boolean };
const cases: Case[] = [
  {row:1488,inner:'<w:rPr/>',member:'bold',expected:null},
  {row:1489,inner:'<w:rPr><w:b/></w:rPr>',member:'bold',expected:true},
  {row:1490,inner:'<w:rPr><w:b w:val="on"/></w:rPr>',member:'bold',expected:true},
  {row:1491,inner:'<w:rPr><w:b w:val="off"/></w:rPr>',member:'bold',expected:false},
  {row:1492,inner:'<w:rPr><w:b w:val="1"/></w:rPr>',member:'bold',expected:true},
  {row:1493,inner:'<w:rPr><w:i w:val="0"/></w:rPr>',member:'italic',expected:false},
  ...[
    ['', 'bold',true,'<w:rPr><w:b/></w:rPr>'], ['', 'bold',false,'<w:rPr><w:b w:val="0"/></w:rPr>'], ['', 'italic',null,'<w:rPr/>'],
    ['<w:rPr><w:b/></w:rPr>','bold',true,'<w:rPr><w:b/></w:rPr>'], ['<w:rPr><w:b/></w:rPr>','bold',false,'<w:rPr><w:b w:val="0"/></w:rPr>'], ['<w:rPr><w:i/></w:rPr>','italic',null,'<w:rPr/>'],
    ['<w:rPr><w:b w:val="on"/></w:rPr>','bold',true,'<w:rPr><w:b/></w:rPr>'], ['<w:rPr><w:b w:val="1"/></w:rPr>','bold',false,'<w:rPr><w:b w:val="0"/></w:rPr>'], ['<w:rPr><w:b w:val="1"/></w:rPr>','bold',null,'<w:rPr/>'],
    ['<w:rPr><w:i w:val="false"/></w:rPr>','italic',true,'<w:rPr><w:i/></w:rPr>'], ['<w:rPr><w:i w:val="0"/></w:rPr>','italic',false,'<w:rPr><w:i w:val="0"/></w:rPr>'], ['<w:rPr><w:i w:val="off"/></w:rPr>','italic',null,'<w:rPr/>']
  ].map(([inner,member,value,after],i)=>({row:1494+i,inner:inner as string,member:member as string,value,after:after as string})),
  ...[['',false],['<w:t>foobar</w:t>',false],['<w:t>abc</w:t><w:lastRenderedPageBreak/><w:t>def</w:t>',true],['<w:lastRenderedPageBreak/><w:lastRenderedPageBreak/>',true]].map(([inner,expected],i)=>({row:1506+i,inner:inner as string,member:'contains_page_break',expected})),
  {row:1510,inner:'',member:'iter_inner_content',expected:[]},
  {row:1511,inner:'<w:t>foo</w:t><w:cr/><w:t>bar</w:t>',member:'iter_inner_content',expected:['foo\nbar']},
  {row:1512,inner:'<w:t>abc</w:t><w:br/><w:lastRenderedPageBreak/><w:noBreakHyphen/><w:t>def</w:t>',member:'iter_inner_content',expected:['abc\n','RenderedPageBreak','‑def']},
  {row:1513,inner:'<w:t>abc</w:t><w:lastRenderedPageBreak/><w:drawing/>',member:'iter_inner_content',expected:['abc','RenderedPageBreak','Drawing']},
  {row:1514,inner:'<w:t>referenced text</w:t>',member:'mark_comment_range',reject:'unsupported-edit'},
  {row:1515,inner:'<w:rPr><w:rStyle w:val="Barfoo"/></w:rPr>',member:'style',expected:'Barfoo'},
  ...[
    ['', 'Foo Font','<w:rPr><w:rStyle w:val="FooFont"/></w:rPr>'], ['<w:rPr/>','Foo Font','<w:rPr><w:rStyle w:val="FooFont"/></w:rPr>'], ['<w:rPr><w:rStyle w:val="FooFont"/></w:rPr>','Bar Font','<w:rPr><w:rStyle w:val="BarFont"/></w:rPr>'], ['<w:rPr><w:rStyle w:val="FooFont"/></w:rPr>',null,'<w:rPr/>'], ['',null,'<w:rPr/>']
  ].map(([inner,value,after],i)=>({row:1516+i,inner:inner as string,member:'style',value,after:after as string})),
  ...[['',null],['<w:rPr><w:u/></w:rPr>',null],['<w:rPr><w:u w:val="single"/></w:rPr>',true],['<w:rPr><w:u w:val="none"/></w:rPr>',false],['<w:rPr><w:u w:val="double"/></w:rPr>',api.WD_UNDERLINE.DOUBLE],['<w:rPr><w:u w:val="wave"/></w:rPr>',api.WD_UNDERLINE.WAVY]].map(([inner,expected],i)=>({row:1521+i,inner:inner as string,member:'underline',expected})),
  ...[
    ['',true,'single'],['',false,'none'],['',null,null],['',api.WD_UNDERLINE.SINGLE,'single'],['',api.WD_UNDERLINE.THICK,'thick'],
    ['<w:rPr><w:u w:val="single"/></w:rPr>',true,'single'],['<w:rPr><w:u w:val="single"/></w:rPr>',false,'none'],['<w:rPr><w:u w:val="single"/></w:rPr>',null,null],['<w:rPr><w:u w:val="single"/></w:rPr>',api.WD_UNDERLINE.SINGLE,'single'],['<w:rPr><w:u w:val="single"/></w:rPr>',api.WD_UNDERLINE.DOTTED,'dotted']
  ].map(([inner,value,token],i)=>({row:1527+i,inner:inner as string,member:'underline',value,after:token===null?'<w:rPr/>':`<w:rPr><w:u w:val="${token}"/></w:rPr>`})),
  ...['foobar',42,'single'].map((value,i)=>({row:1537+i,inner:'',member:'underline',value,reject:'usage'})),
  {row:1540,inner:'',member:'font',expected:'Font'},
  ...[
    ['', 'foo','<w:t>foo</w:t>'],['<w:t>foo</w:t>','bar','<w:t>foo</w:t><w:t>bar</w:t>'],['','fo ','<w:t xml:space="preserve">fo </w:t>'],['','f o','<w:t>f o</w:t>']
  ].map(([inner,value,after],i)=>({row:1541+i,inner:inner!,member:'add_text',value,after:after!})),
  ...[
    [api.WD_BREAK.LINE,'<w:br/>'],[api.WD_BREAK.PAGE,'<w:br w:type="page"/>'],[api.WD_BREAK.COLUMN,'<w:br w:type="column"/>'],[api.WD_BREAK.LINE_CLEAR_LEFT,'<w:br w:clear="left"/>'],[api.WD_BREAK.LINE_CLEAR_RIGHT,'<w:br w:clear="right"/>'],[api.WD_BREAK.LINE_CLEAR_ALL,'<w:br w:clear="all"/>']
  ].map(([value,after],i)=>({row:1545+i,inner:'',member:'add_break',value,after:after as string})),
  {row:1551,inner:'<w:t>foo</w:t>',member:'add_tab',after:'<w:t>foo</w:t><w:tab/>'},
  {row:1552,inner:'<wp:x xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"/>',member:'add_picture'},
  ...[
    ['',''],['<w:t>foo</w:t>',''],['<w:br/>',''],['<w:rPr/>','<w:rPr/>'],['<w:rPr/><w:t>foo</w:t>','<w:rPr/>'],['<w:rPr><w:b/><w:i/></w:rPr><w:t>foo</w:t><w:cr/><w:t>bar</w:t>','<w:rPr><w:b/><w:i/></w:rPr>']
  ].map(([inner,after],i)=>({row:1553+i,inner:inner!,member:'clear',after:after!})),
  ...[['',''],['<w:t>foobar</w:t>','foobar'],['<w:t>abc</w:t><w:tab/><w:t>def</w:t><w:cr/>','abc\tdef\n'],['<w:br w:type="page"/><w:t>abc</w:t><w:t>def</w:t><w:tab/>','abcdef\t']].map(([inner,expected],i)=>({row:1559+i,inner:inner!,member:'text',expected})),
  ...[['abc  def','<w:t>abc  def</w:t>'],['abc\tdef','<w:t>abc</w:t><w:tab/><w:t>def</w:t>'],['abc\ndef','<w:t>abc</w:t><w:br/><w:t>def</w:t>'],['abc\rdef','<w:t>abc</w:t><w:br/><w:t>def</w:t>']].map(([value,after],i)=>({row:1563+i,inner:'',member:'text',value,after:after!}))
];
expect(cases.map(c=>c.row)).toEqual(Array.from({length:79},(_,i)=>1488+i));
const companions: Case[] = [{row:1514,inner:'<w:t>referenced text</w:t>',member:'mark_comment_range',companion:true}];
const ref=(resultHandle:string,index?:number)=>({resultHandle,...(index===undefined?{}:{index})});
for(const strict of [false,true])for(const kind of ['docx','dotx'] as const)for(const c of [...cases,...companions])for(const route of ['model','sdk','shell'] as const)
it(`${route} independently executes exact run witness R${c.row}; strict=${strict}; kind=${kind}; fixture=${c.companion?'native-comment-companion':'original'}`,async()=>{
  const ns=strict?'http://purl.oclc.org/ooxml/wordprocessingml/main':w;
  const styles='<w:style w:type="character" w:styleId="FooFont"><w:name w:val="Foo Font"/></w:style><w:style w:type="character" w:styleId="BarFont"><w:name w:val="Bar Font"/></w:style><w:style w:type="character" w:styleId="Barfoo"><w:name w:val="Barfoo"/></w:style>';
  const story={styles:{kind:'styles',xml:`<w:styles xmlns:w="${w}">${styles}<!--styles--></w:styles>`},...(c.companion?{comments:{kind:'comments',xml:`<w:comments xmlns:w="${w}"><w:comment w:id="42" w:author="Survey"><w:p><w:r><w:t>Original annotation</w:t></w:r></w:p></w:comment></w:comments>`}}:{})};
  const parts=readPackage(await textFixture(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r>${strict?c.inner.replace("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing","http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing"):c.inner}</w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Untouched é 日本 עברית 🌊</w:t></w:r></w:p>`,story,strict)),memory=Volume.fromJSON({'/input':'','/out':''});
  if(kind==='dotx')parts.set('[Content_Types].xml',new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('wordprocessingml.document.main+xml','wordprocessingml.template.main+xml')));
  await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')}))},{async write(bytes){memory.appendFileSync('/input',bytes);}},{order:'input',compression:'store'},textContext);
  const input=new Uint8Array(memory.readFileSync('/input') as Buffer),sink={async write(bytes:Uint8Array){memory.appendFileSync('/out',bytes);}},mutation=Object.hasOwn(c,'value')||['add_text','add_break','add_tab','clear','mark_comment_range','add_picture'].includes(c.member),method=['iter_inner_content','add_text','add_break','add_tab','clear','mark_comment_range','add_picture'].includes(c.member),png=replacementPng();
  const args:Record<string,unknown>=c.member==='add_text'?{text:c.value}:c.member==='add_break'?{breakType:c.value}:c.member==='mark_comment_range'?{lastRun:ref('runs',0),commentId:42}:c.member==='add_picture'?{input:{kind:'bytes',base64:Buffer.from(png).toString('base64')},width:{value:1111,unit:'emu'},height:{value:2222,unit:'emu'}}:Object.hasOwn(c,'value')?{value:c.value}:{};
  const operations:{operation:string;receiver:ReturnType<typeof ref>;arguments:Record<string,unknown>;resultHandle?:string}[]=[{operation:'model.document.Document.paragraphs.get',receiver:ref('document'),arguments:{},resultHandle:'paragraphs'},{operation:'model.text.paragraph.Paragraph.runs.get',receiver:ref('paragraphs',0),arguments:{},resultHandle:'runs'},{operation:`model.text.run.Run.${c.member}.${method?'call':mutation?'set':'get'}`,receiver:ref('runs',0),arguments:args,...(!mutation||['add_text','clear','add_picture'].includes(c.member)?{resultHandle:'observed'}:{})}];
  if(c.member==='style'&&!mutation)operations.push({operation:'model.styles.style.BaseStyle.name.get',receiver:ref('observed'),arguments:{}});
  if(c.member==='font')operations.push({operation:'model.text.run.Font.element.get',receiver:ref('observed'),arguments:{},resultHandle:'fontElement'},{operation:'model.XmlElementView.tag.get',receiver:ref('fontElement'),arguments:{}});
  if(c.member==='add_text')operations.push({operation:'model.XmlElementView.text.get',receiver:ref('observed'),arguments:{}});
  if(c.member==='add_picture')operations.push({operation:'model.shape.InlineShape.width.get',receiver:ref('observed'),arguments:{}},{operation:'model.shape.InlineShape.height.get',receiver:ref('observed'),arguments:{}});
  const observe=(values:unknown[])=>{
    if(!mutation&&c.member==='iter_inner_content')expect((values.at(-1) as (string|{type:string})[]).map(v=>typeof v==='string'?v:v.type)).toEqual(c.expected);
    else if(!mutation&&c.member==='font')expect(values.at(-1)).toEqual({namespaceURI:ns,localName:'r'});
    else if(!mutation)expect(values.at(-1)).toEqual(c.expected);
    else if(c.member==='add_text')expect(values.at(-1)).toBe(c.value);
  };
  if(route==='model'){
    const doc=await api.Document(input,textContext),run=doc.paragraphs[0]!.runs[0]!;
    const execute=async()=>{
      if(c.member==='mark_comment_range')run.mark_comment_range(run,42);
      else if(c.member==='add_picture'){const shape=await run.add_picture(png,api.Emu(1111),api.Emu(2222));expect(shape.width.emu).toBe(1111);expect(shape.height.emu).toBe(2222);}
      else if(c.member==='add_text')expect(run.add_text(c.value as string)?.text).toBe(c.value);
      else if(c.member==='add_tab')run.add_tab();else if(c.member==='add_break')run.add_break(c.value as typeof api.WD_BREAK.LINE);else if(c.member==='clear')expect(run.clear()).toBe(run);
      else if(c.member==='iter_inner_content')expect([...run.iter_inner_content()].map(v=>typeof v==='string'?v:v instanceof api.RenderedPageBreak?'RenderedPageBreak':'Drawing')).toEqual(c.expected);
      else if(c.member==='font'){expect(run.font).toBeInstanceOf(api.Font);expect(run.font.equals(run.font)).toBe(true);expect(run.font.element.serialize()).toEqual(run.element.serialize());expect(run.font.part).toBe(run.part);}
      else if(c.member==='style'){if(mutation)run.style=c.value as string|null;else expect(run.style?.equals(doc.styles.at('Barfoo'))).toBe(true);}
      else if(mutation)Reflect.set(run,c.member,c.value);else expect(Reflect.get(run,c.member)).toEqual(c.expected);
    };
    if(c.reject){await expect(execute()).rejects.toMatchObject(c.reject==='usage'?{name:'TypeError'}:{code:c.reject});expect(run.element.serialize()).toEqual((await api.Document(input,textContext)).paragraphs[0]!.runs[0]!.element.serialize());}else{await execute();expect(run.equals(doc.paragraphs[0]!.runs[0])).toBe(true);await doc.save(sink);}
  }else if(route==='sdk'){
    if(c.reject)await expect(api.applyStyleModelBatch(input,{version:1,operations},textContext)).rejects.toMatchObject({code:c.reject});
    else{const batch=await api.applyStyleModelBatch(input,{version:1,operations},textContext);observe(batch.results.map(r=>r.value));await batch.save(sink);}
  }else{
    const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/out',new TextEncoder().encode('Original destination'));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));
    try{const r=await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version:1,operations})}' ${mutation?'--output /out --force':''} --json`);expect(r.exitCode,r.stdout+r.stderr).toBe(c.reject==='usage'?2:c.reject?1:0);if(c.reject){expect(JSON.parse(r.stdout).errors[0].code).toBe(c.reject);expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Original destination');}else{observe(JSON.parse(r.stdout).data.results.map((r:{data:unknown})=>r.data));if(mutation)memory.writeFileSync('/out',await fs.readFile('/out'));else await (await api.Document(input,textContext)).save(sink);}expect(await fs.readFile('/input')).toEqual(input);}finally{await shell.dispose();}
  }
  if(c.reject){expect(memory.readFileSync('/out')).toEqual(Buffer.from(''));return;}
  const output=new Uint8Array(memory.readFileSync('/out') as Buffer),after=readPackage(output);assertPackageLinks(after);
  for(const[name,bytes]of parts)if(name!=='word/document.xml'&&!(c.member==='add_picture'&&['[Content_Types].xml','word/_rels/document.xml.rels'].includes(name)))expect(after.get(name),name).toEqual(bytes);
  const doc=await api.Document(output,textContext),p=doc.paragraphs[0]!,run=p.runs[0]!;expect(doc.paragraphs[1]!.text).toBe('Untouched é 日本 עברית 🌊');expect(doc.paragraphs[1]!.runs[0]!.italic).toBe(true);expect(p.paragraph_format.keep_with_next).toBe(true);
  const snapshot=(bytes:Uint8Array)=>{
    const root=new api.DocumentXmlEditor(bytes).root;
    const visit=(node:typeof root):unknown=>({name:[node.namespace,node.localName],attributes:node.attributes.filter(a=>a.namespace!=='http://www.w3.org/2000/xmlns/'&&!(node.localName==='t'&&a.namespace==='http://www.w3.org/XML/1998/namespace'&&a.localName==='space'&&a.value==='preserve'&&node.text.trim()===node.text)).map(a=>[a.namespace,a.localName,['b','i'].includes(node.localName)&&a.localName==='val'?['1','on','true'].includes(a.value)?true:false:a.value]).concat(['b','i'].includes(node.localName)&&!node.attributes.some(a=>a.localName==='val')?[[node.namespace,'val',true]]:[]).sort(),content:node.content.map(n=>n.kind==='element'?visit(n):n)});
    return visit(root);
  };
  if(['add_text','text'].includes(c.member)&&mutation)expect(run.text).toBe(c.member==='add_text'?(c.row===1542?'foo':'')+c.value:(c.value as string).split('\r').join('\n'));
  if(c.after!==undefined){const expected=new TextEncoder().encode(`<w:r xmlns:w="${ns}">${c.after}</w:r>`);expect(snapshot(run.element.serialize())).toEqual(snapshot(expected));}
  else if(!mutation)expect(after.get('word/document.xml')).toEqual(parts.get('word/document.xml'));
  if(c.member==='add_picture'){expect(run.element.children[0]!.localName).toBe('x');expect(run.element.children[0]!.namespace).toBe(strict?'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing');expect(doc.inline_shapes.length).toBe(1);expect(doc.inline_shapes.at(0).width.emu).toBe(1111);expect(doc.inline_shapes.at(0).height.emu).toBe(2222);expect([...after.values()].some(bytes=>Buffer.from(bytes).equals(Buffer.from(png)))).toBe(true);}
  if(c.companion){expect(p.element.children.map(n=>n.localName)).toEqual(['pPr','commentRangeStart','r','commentRangeEnd','r']);expect(p.text).toBe('referenced text');const anchors=p.element.children.filter(n=>['commentRangeStart','commentRangeEnd'].includes(n.localName));for(const anchor of anchors)expect([...anchor.attributes].find(([name])=>name.localName==='id')?.[1]).toBe('42');expect(p.runs[1]!.element.children.map(n=>n.localName)).toEqual(['rPr','commentReference']);expect(p.runs[1]!.element.children[0]!.children[0]!.localName).toBe('rStyle');}
  expect(memory.readFileSync('/input')).toEqual(Buffer.from(input));
});
