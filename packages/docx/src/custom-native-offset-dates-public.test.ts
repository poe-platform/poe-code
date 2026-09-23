import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc=(text:string)=>new TextEncoder().encode(text),dec=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
const cases=[
 {raw:"2012-11-17T11:07:40-05:30",expected:"2012-11-17T16:37:40Z"},
 {raw:"2024-03-01T00:30:00.999+01:00",expected:"2024-02-29T23:30:00Z"},
 {raw:"1969-12-31T23:59:59.999-00:00",expected:"1969-12-31T23:59:59Z"},
 {raw:"1900-01-01T00:00:00.0000001+00:00",expected:"1900-01-01T00:00:00Z"},
 {raw:"2024-02-30T12:00:00+01:00",expected:null},
 {raw:"2024-02-29T24:00:00+01:00",expected:"2024-02-29T23:00:00Z"},
 {raw:"2024-02-29T12:00:00+25:00",expected:null},
 {raw:"2024-02-29T12:00:00+01:60",expected:null},
 {raw:"2024-02-29T12:00:00",expected:null},
 {raw:"2024-02-29",expected:null}
];
for(const strict of [false,true])for(const kind of ["docx","dotx"] as const)for(const variant of ["date","filetime"])
for(const route of ["sdk","cli","sdk-batch","cli-batch"] as const)for(const sample of cases)
it(`native custom explicit-offset date width; strict=${strict}; kind=${kind}; variant=${variant}; route=${route}; lexical=${sample.raw}`,async()=>{
 const office=strict?"http://purl.oclc.org/ooxml/officeDocument/":"http://schemas.openxmlformats.org/officeDocument/2006/",ns=office+(strict?"customProperties":"custom-properties"),vt=office+"docPropsVTypes",name="meta/native-custom.xml",fmt="{d5cdd505-2e9c-101b-9397-08002b2cf9ae}",qualified="custom:Offset";
 const stored=`<p:property name="Offset" pid="11" fmtid="${fmt}"><v:${variant}>${sample.raw}</v:${variant}></p:property>`,source=`<p:Properties xmlns:p="${ns}" xmlns:v="${vt}">${stored}<p:property name="Title" pid="19" fmtid="${fmt}"><v:lpstr>Original</v:lpstr></p:property><!--retain--><?audit exact?></p:Properties>`;
 const parts=readPackage(await textFixture("<w:p><w:r><w:t>Retained 海🌊</w:t></w:r></w:p>",{},strict,{kind}));parts.set(name,enc(source));parts.set("[Content_Types].xml",enc(dec(parts.get("[Content_Types].xml")!).replace("</Types>",`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`)));parts.set("_rels/.rels",enc(dec(parts.get("_rels/.rels")!).replace("</Relationships>",`<Relationship Id="nativeMetadata" Type="${office}relationships/custom-properties" Target="${name}"/></Relationships>`)));
 const memory=Volume.fromJSON({"/input":"","/output":""}),sink={async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}},context={...textContext,encoding:{order:"input",compression:"store"} as const};
 await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("1980-01-01T00:00:00Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},context.encoding,context);
 const input=new Uint8Array(memory.readFileSync("/input") as Buffer),ops={version:1 as const,operations:[{operation:"properties.get" as const,arguments:{name:qualified}}]};
 const observe=(item:unknown)=>expect(item).toMatchObject({name:qualified,support:sample.expected===null?"preserve":"edit",properties:[{name:"Offset",type:"date",value:sample.expected,writable:sample.expected!==null,cached:false}],details:{group:"custom",storedType:{namespace:vt,localName:variant},id:"11"},references:[{owner:"/",id:"nativeMetadata"}]});
 if(route==="sdk"){const data=await api.inspectDocumentProperties(input,{name:qualified},context);observe(data.items[0]);expect(data.warnings.map(x=>x.code)).toEqual(sample.expected===null?["invalid-property"]:[]);}
 else if(route==="sdk-batch"){const data=await api.executeDocumentBatch(input,ops,{},context);observe((data.results[0]!.data as {item:unknown}).item);expect(data.results[0]!.affected).toBe(0);expect(data.publication).toBeNull();}
 else{const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/destination",enc("Retained destination"));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:context.limits})}));try{const command=route==="cli"?`docx properties get /input --name ${qualified} --json`:`docx batch /input --ops-json '${JSON.stringify(ops)}' --json`,result=await shell.exec(command);expect(result.exitCode,result.stdout+result.stderr).toBe(0);const e=JSON.parse(result.stdout);observe(route==="cli"?e.data.item:e.data.results[0].data.item);expect(e.affected).toBe(0);expect(await fs.readFile("/input")).toEqual(input);expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));}finally{await shell.dispose();}}
 expect(memory.readFileSync("/output")).toHaveLength(0);if(sample.expected!==null){await expect(api.editDocumentProperties(input,{operation:"properties.set",name:qualified,value:sample.raw,dryRun:true},context)).rejects.toMatchObject({code:"usage"});await api.editDocumentProperties(input,{operation:"properties.set",name:qualified,value:sample.expected,output:"-"},{...context,stdout:sink});expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input);memory.writeFileSync("/output","");await api.editDocumentProperties(input,{operation:"properties.set",name:"custom:Title",value:"Updated",output:"-"},{...context,stdout:sink});const output=new Uint8Array(memory.readFileSync("/output") as Buffer),after=readPackage(output);expect(dec(after.get(name)!)).toBe(source.replace("Original","Updated"));for(const[part,bytes]of parts)if(part!==name)expect(after.get(part),part).toEqual(bytes);expect(dec(after.get(name)!)).toContain(stored);}
 expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
