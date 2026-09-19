import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { sectionPropertyCases } from "../tests/fixtures/section-exact-source.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";
const ref=(resultHandle:string,index?:number)=>({resultHandle,...(index===undefined?{}:{index})});
expect(sectionPropertyCases).toHaveLength(57);
for(const strict of [false,true])for(const kind of ["docx","dotx"] as const)for(const c of sectionPropertyCases)for(const route of ["model","sdk","shell"] as const)
it(`${route} independently executes exact section property witness R${c.row}; ${kind}; strict=${strict}`,async()=>{
 const edits="value" in c,ns=strict?"http://purl.oclc.org/ooxml/wordprocessingml/main":"http://schemas.openxmlformats.org/wordprocessingml/2006/main";
 const parts=readPackage(await textFixture('<w:p><w:r><w:t>Untouched é 日本 עברית 🌊</w:t></w:r></w:p>'+c.xml,{},strict));
 if(kind==="dotx")parts.set("[Content_Types].xml",new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml","wordprocessingml.template.main+xml")));
 const volume=Volume.fromJSON({"/input":"","/out":""});await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){volume.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},textContext);
 const input=new Uint8Array(volume.readFileSync("/input") as Buffer),sink={async write(bytes:Uint8Array){volume.appendFileSync("/out",bytes);}},operations:Record<string,unknown>[]=[{operation:"model.document.Document.sections.get",receiver:ref("document"),arguments:{},resultHandle:"sections"},{operation:`model.section.Section.${c.member}.${edits?"set":"get"}`,receiver:ref("sections",0),arguments:edits?{value:c.value}:{}}];
 if(edits)operations.push({operation:"model.section.Section.element.get",receiver:ref("sections",0),arguments:{},resultHandle:"element"},{operation:"model.XmlElementView.serialize.call",receiver:ref("element"),arguments:{}});
 const expected=edits?xmlStructure(new TextEncoder().encode(c.after.replace('<w:sectPr',`<w:sectPr xmlns:w="${ns}"`))):c.expected;
 const observe=(v:unknown)=>{if(edits)expect(xmlStructure(new Uint8Array(Buffer.from((v as {base64:string}).base64,"base64")))).toEqual(expected);else if(v&&typeof v==="object"&&"unit" in v)expect(Math.sign((v as api.DocxLength).value)*Math.round(Math.abs((v as api.DocxLength).value)*({emu:1,twip:635,in:914400,cm:360000,mm:36000,pt:12700})[(v as api.DocxLength).unit])).toBe(typeof expected==="object"&&expected!==null&&"value" in expected?expected.value:expected);else expect(v).toEqual(expected);};
 if(route==="model"){
  const doc=await api.Document(input,textContext),section=doc.sections[0]!,before=section.element.serialize();expect(section.part).toBe(doc.part);
  if(edits){const v=c.value;Reflect.set(section,c.member,v&&typeof v==="object"?("unit"in v?api.Length(v.value):Reflect.get(Reflect.get(api,v.enum) as object,v.name)):v);expect(xmlStructure(section.element.serialize())).toEqual(expected);}else{const v=Reflect.get(section,c.member) as unknown;if(v&&typeof v==="object"&&"emu"in v)expect(v.emu).toBe(typeof expected==="object"&&expected!==null&&"value"in expected?expected.value:expected);else expect(v).toEqual(expected);expect(section.element.serialize()).toEqual(before);}
  expect(doc.paragraphs[0]!.text).toBe("Untouched é 日本 עברית 🌊");await doc.save(sink);
 }else if(route==="sdk"){const batch=await api.applyStyleModelBatch(input,{version:1,operations},textContext);observe(batch.results.at(-1)!.value);if(!edits)expect(batch.affected).toBe(0);await batch.save(sink);}
 else{const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/out",new TextEncoder().encode("Original destination"));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:textContext.limits})}));try{const result=await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version:1,operations})}' ${edits?"--output /out --force":""} --json`);expect(result.exitCode,result.stdout+result.stderr).toBe(0);observe(JSON.parse(result.stdout).data.results.at(-1).data);if(edits)volume.writeFileSync("/out",await fs.readFile("/out"));else expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");expect(await fs.readFile("/input")).toEqual(input);}finally{await shell.dispose();}}
 if((volume.readFileSync("/out") as Buffer).length){const after=readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer));assertPackageLinks(after);expect(after.size).toBe(parts.size);for(const[name,bytes]of parts)if(!edits||name!=="word/document.xml")expect(after.get(name),name).toEqual(bytes);const doc=await api.Document(new Uint8Array(volume.readFileSync("/out") as Buffer),textContext);expect(doc.paragraphs[0]!.text).toBe("Untouched é 日本 עברית 🌊");}
 expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
