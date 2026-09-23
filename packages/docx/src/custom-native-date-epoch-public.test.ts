import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc=(text:string)=>new TextEncoder().encode(text),dec=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
for(const strict of [false,true])for(const kind of ["docx","dotx"] as const)for(const variant of ["missing","date","filetime"])
for(const route of ["sdk","cli","sdk-batch","cli-batch"] as const)
it(`custom native calendar epoch refusal; strict=${strict}; kind=${kind}; variant=${variant}; route=${route}`,async()=>{
 const office=strict?"http://purl.oclc.org/ooxml/officeDocument/":"http://schemas.openxmlformats.org/officeDocument/2006/",ns=office+(strict?"customProperties":"custom-properties"),vt=office+"docPropsVTypes",name="meta/native-custom.xml";
 const parts=readPackage(await textFixture("<w:p><w:r><w:t>Retained</w:t></w:r></w:p>",{},strict,{kind}));
 if(variant!=="missing"){
  parts.set(name,enc(`<p:Properties xmlns:p="${ns}" xmlns:v="${vt}"><p:property name="Epoch" pid="11" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"><v:${variant}>2000-01-01T00:00:00Z</v:${variant}></p:property><!--retain--></p:Properties>`));
  parts.set("[Content_Types].xml",enc(dec(parts.get("[Content_Types].xml")!).replace("</Types>",`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`)));
  parts.set("_rels/.rels",enc(dec(parts.get("_rels/.rels")!).replace("</Relationships>",`<Relationship Id="nativeMetadata" Type="${office}relationships/custom-properties" Target="${name}"/></Relationships>`)));
 }
 const memory=Volume.fromJSON({"/input":"","/output":""}),context={...textContext,encoding:{order:"input",compression:"store"} as const},sink={async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}};
 await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("1980-01-01T00:00:00Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},context.encoding,context);
 const input=new Uint8Array(memory.readFileSync("/input") as Buffer),options={name:"custom:Epoch",value:"0000-03-01T00:00:00Z",type:"date" as const},ops={version:1 as const,operations:[{operation:"properties.set" as const,arguments:options}]};
 if(route==="sdk")await expect(api.editDocumentProperties(input,{operation:"properties.set",...options,output:"-"},{...context,stdout:sink})).rejects.toMatchObject({code:"usage"});
 else if(route==="sdk-batch")await expect(api.executeDocumentBatch(input,ops,{output:"-"},{...context,stdout:sink})).rejects.toMatchObject({code:"usage"});
 else{
  const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/output",enc("Retained destination"));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:context.limits})}));
  try{const result=await shell.exec(route==="cli"?"docx properties set /input --name custom:Epoch --value 0000-03-01T00:00:00Z --type date --output /output --force --json":`docx batch /input --ops-json '${JSON.stringify(ops)}' --output /output --force --json`);expect(result.exitCode,result.stdout+result.stderr).toBe(2);expect(JSON.parse(result.stdout)).toMatchObject({affected:0,errors:[{code:"usage"}]});expect(await fs.readFile("/input")).toEqual(input);expect(await fs.readFile("/output")).toEqual(enc("Retained destination"));}finally{await shell.dispose();}
 }
 expect(memory.readFileSync("/output")).toHaveLength(0);
 expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
