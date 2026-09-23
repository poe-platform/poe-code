import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
const enc=(text:string)=>new TextEncoder().encode(text),ref=(resultHandle:string)=>({resultHandle});
for(const strict of [false,true])for(const kind of ["docx","dotx"] as const)for(const route of ["model","model-sdk","model-cli"])
it(`core lastPrinted model rejects native invalid assigned epoch; strict=${strict}; kind=${kind}; route=${route}`,async()=>{
 const parts=readPackage(await textFixture('<w:p><w:r><w:t>Retained</w:t></w:r></w:p>',{},strict,{kind})),name="meta/native-core.xml",memory=Volume.fromJSON({"/input":"","/output":""}),context={...textContext,encoding:{order:"input",compression:"store"} as const},dec=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
 parts.set(name,enc('<p:coreProperties xmlns:p="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><p:lastPrinted>2000-01-01T00:00:00Z</p:lastPrinted><!--retain--></p:coreProperties>'));
 parts.set("[Content_Types].xml",enc(dec(parts.get("[Content_Types].xml")!).replace("</Types>",`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`)));
 parts.set("_rels/.rels",enc(dec(parts.get("_rels/.rels")!).replace("</Relationships>",`<Relationship Id="nativeMetadata" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="${name}"/></Relationships>`)));
 await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("1980-01-01T00:00:00Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},context.encoding,context);const input=new Uint8Array(memory.readFileSync("/input") as Buffer);
 const ops={version:1 as const,operations:[{operation:"model.document.Document.core_properties.get",receiver:ref("document"),arguments:{},resultHandle:"core"},{operation:"model.opc.coreprops.CoreProperties.last_printed.set",receiver:ref("core"),arguments:{value:"0000-03-01T00:00:00Z"}}]};
 if(route==="model"){const doc=await api.Document(input,context),core=doc.core_properties,before=core.part.blob;expect(()=>{core.last_printed=new Date("0000-03-01T00:00:00Z");}).toThrowError(expect.objectContaining({code:"usage"}));expect(core.part.blob).toEqual(before);}
 else if(route==="model-sdk")await expect(api.applyStyleModelBatch(input,ops,context)).rejects.toMatchObject({code:"usage"});
 else{const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/destination",enc("Retained destination"));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:context.limits})}));try{const result=await shell.exec(`docx batch /input --ops-json '${JSON.stringify(ops)}' --output /destination --force --json`);expect(result.exitCode,result.stdout+result.stderr).toBe(2);expect(JSON.parse(result.stdout)).toMatchObject({affected:0,errors:[{code:"usage"}]});expect(await fs.readFile("/input")).toEqual(input);expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));}finally{await shell.dispose();}}
 expect(memory.readFileSync("/output")).toHaveLength(0);
});
