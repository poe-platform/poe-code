import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
type Case = { row: number; variant: string; helper?: "Length" | "Inches" | "Cm" | "Emu" | "Mm" | "Pt" | "Twips"; field?: string; input?: number; expected?: unknown; property?: string; rgb?: unknown[]; error?: "type" | "value" };
const cases: Case[] = [
 {row:988,variant:"owner-node-equality",expected:[true,false,false,false,true,true]},
 {row:989,variant:"bounded-native-element",expected:"p"},
 {row:990,variant:"owning-part",expected:"/word/document.xml"},
 ...([ [991,"Length","emu",914400,914400], [992,"Inches","inches",1.1,1005840], [993,"Cm","cm",2.53,910800], [994,"Emu","emu",9144.9,9145], [995,"Mm","mm",13.8,496800], [996,"Pt","points",24.5,311150], [997,"Twips","twips",360,228600] ] as const).map(([row,helper,field,input,expected])=>({row,variant:"shared-rounding",helper,field,input,expected})),
 ...([ [998,"inches",1], [999,"cm",2.54], [1000,"emu",914400], [1001,"mm",25.4], [1002,"pt",72], [1003,"twips",1440] ] as const).map(([row,property,expected])=>({row,variant:"explicit-accessor",helper:"Length" as const,field:"emu",input:914400,property,expected})),
 {row:1004,variant:"readonly-channel-tuple",rgb:[18,52,86],expected:[18,52,86]},
 {row:1005,variant:"channel-strings",rgb:["12","34","56"],error:"type"},
 {row:1005,variant:"negative-channel",rgb:[-1,34,56],error:"value"},
 {row:1005,variant:"channel-256",rgb:[12,256,56],error:"value"},
 {row:1006,variant:"six-digit-hex",expected:[18,52,86]},
 {row:1007,variant:"uppercase-string",rgb:[243,138,86],expected:"F38A56"},
 // JavaScript has no repr protocol. Preserve the exact source channels and documented string/tuple protocols.
 {row:1008,variant:"javascript-value-representation",rgb:[66,240,186],expected:["42F0BA",[66,240,186]]}
];
expect([...new Set(cases.map(c=>c.row))]).toEqual(Array.from({length:21},(_,i)=>988+i));
const ref = (resultHandle:string,index?:number)=>({resultHandle,...(index===undefined?{}:{index})});
for(const strict of [false,true])for(const kind of ["docx","dotx"] as const)for(const c of cases)for(const route of ["model","sdk","shell"] as const)
it(`${route} independently executes exact shared witness R${c.row}; variant=${c.variant}; ${kind}; strict=${strict}`,async()=>{
 const parts=readPackage(await textFixture('<w:p/><w:p/><w:p><w:r><w:t>Untouched é 日本 עברית 🌊</w:t></w:r></w:p>',{},strict));
 if(kind==="dotx")parts.set("[Content_Types].xml",new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml","wordprocessingml.template.main+xml")));
 const volume=Volume.fromJSON({"/input":"","/out":""});
 await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){volume.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},textContext);
 const input=new Uint8Array(volume.readFileSync("/input") as Buffer), sink={async write(bytes:Uint8Array){volume.appendFileSync("/out",bytes);}};
 const operations:Record<string,unknown>[]=[];
 if(c.row<=990){operations.push({operation:"model.document.Document.paragraphs.get",receiver:ref("document"),arguments:{},resultHandle:"paragraphs"});
  if(c.row===988)for(const member of ["__eq__"])for(const other of [ref("paragraphs",0),ref("paragraphs",1),"Foobar"])operations.push({operation:`model.text.paragraph.Paragraph.${member}.call`,receiver:ref("paragraphs",0),arguments:{other}});
  else if(c.row===989)operations.push({operation:"model.text.paragraph.Paragraph.element.get",receiver:ref("paragraphs",0),arguments:{},resultHandle:"element"},{operation:"model.XmlElementView.localName.get",receiver:ref("element"),arguments:{}});
  else operations.push({operation:"model.text.paragraph.Paragraph.part.get",receiver:ref("paragraphs",0),arguments:{},resultHandle:"part"},{operation:"model.parts.story.StoryPart.partname.get",receiver:ref("part"),arguments:{}});
 }else if(c.helper)operations.push({operation:`model.shared.${c.helper}.call`,arguments:{[c.field!]:c.input},resultHandle:"value"},{operation:`model.shared.${c.helper}.${c.property??"emu"}.get`,receiver:ref("value"),arguments:{}});
 else{operations.push(c.row===1006?{operation:"model.shared.RGBColor.from_string.call",arguments:{rgbHexStr:"123456"},resultHandle:"value"}:{operation:"model.shared.RGBColor.call",arguments:{r:c.rgb![0],g:c.rgb![1],b:c.rgb![2]},resultHandle:"value"});
  for(const member of c.row===1008?["__str__","tuple_value_protocol"]:[c.row===1007?"__str__":"tuple_value_protocol"])operations.push({operation:`model.shared.RGBColor.${member}.call`,receiver:ref("value"),arguments:{}});
 }
 const observe=(values:unknown[])=>expect(c.row===988?[...values.slice(1),...values.slice(1).map(v=>!v)]:c.row===1008?values.slice(1):values.at(-1)).toEqual(c.expected);
 if(route==="model"){
  const doc=await api.Document(input,textContext);
  if(c.row===988){const p=doc.paragraphs[0]!,same=doc.paragraphs[0]!,q=doc.paragraphs[1]!;expect([p.equals(same),p.equals(q),p.equals("Foobar"),!p.equals(same),!p.equals(q),!p.equals("Foobar")]).toEqual(c.expected);}
  else if(c.row===989){expect(doc.paragraphs[0]!.element.localName).toBe("p");expect(doc.paragraphs[0]!.element.namespace).toBe(strict?"http://purl.oclc.org/ooxml/wordprocessingml/main":"http://schemas.openxmlformats.org/wordprocessingml/2006/main");}
  else if(c.row===990){expect(doc.paragraphs[0]!.part).toBe(doc.part);expect(String(doc.paragraphs[0]!.part.partname)).toBe(c.expected);}
  else if(c.helper){const value=api[c.helper](c.input!);expect(Number.isSafeInteger(value.emu)).toBe(true);expect(Reflect.get(value,c.property??"emu")).toBe(c.expected);expect(Object.isFrozen(value)).toBe(true);}
  else{const create=()=>c.row===1006?api.RGBColor.from_string("123456"):new api.RGBColor(...(c.rgb as [number,number,number]));
   if(c.error)expect(create).toThrow(c.error==="type"?api.InputTypeError:api.InvalidValueError);
   else{const value=create();expect(c.row===1008?[value.toString(),value.toArray()]:c.row===1007?value.toString():value.toArray()).toEqual(c.expected);}
  }
  await doc.save(sink);
 }else if(route==="sdk"){
  if(c.error)await expect(api.applyStyleModelBatch(input,{version:1,operations},textContext)).rejects.toMatchObject({code:"usage"});
  else{const batch=await api.applyStyleModelBatch(input,{version:1,operations},textContext);observe(batch.results.map(r=>r.value));expect(batch.affected).toBe(0);await batch.save(sink);}
 }else{
  const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/out",new TextEncoder().encode("Original destination"));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));
  try{const result=await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version:1,operations})}' --json`);expect(result.exitCode,result.stdout+result.stderr).toBe(c.error?2:0);const envelope=JSON.parse(result.stdout);if(c.error){expect(envelope.ok).toBe(false);expect(envelope.errors[0].code).toBe("usage");}else observe(envelope.data.results.map((r:{data:unknown})=>r.data));expect(envelope.affected).toBe(0);expect(await fs.readFile("/input")).toEqual(input);expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");}finally{await shell.dispose();}
 }
 if((volume.readFileSync("/out") as Buffer).length){const after=readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer));assertPackageLinks(after);expect(after.size).toBe(parts.size);for(const[name,bytes]of parts)expect(after.get(name),name).toEqual(bytes);}
 expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
