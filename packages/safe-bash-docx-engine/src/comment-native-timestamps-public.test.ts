import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc=(text:string)=>new TextEncoder().encode(text),dec=(bytes:Uint8Array)=>new TextDecoder().decode(bytes),ref=(resultHandle:string)=>({resultHandle});
const cases=[
 {raw:null,expected:null},
 {raw:"2024-03-01T00:30:00.123-05:30",expected:"2024-03-01T06:00:00.123Z"},
 {raw:"2024-03-01T00:00:00+14:00",expected:"2024-02-29T10:00:00.000Z"},
 {raw:"1969-12-31T23:59:59.999-00:00",expected:"1969-12-31T23:59:59.999Z"},
 {raw:"2024-02-29T24:00:00.000Z",expected:"2024-03-01T00:00:00.000Z"},
 {raw:"\n 2024-02-29T12:00:00+01:00 \t",expected:"2024-02-29T11:00:00.000Z"},
 {raw:"2024-02-29T12:00:00.123456789Z",expected:"2024-02-29T12:00:00.123Z"},
 {raw:"2024-02-29T12:00:00+14:01",expected:null},
 {raw:"2023-02-29T12:00:00Z",expected:null},
 {raw:"2024-02-29T24:00:00.001Z",expected:null},
 {raw:"0000-01-01T00:00:00Z",expected:null},
 {raw:"2024-02-29T12:00:00",expected:null},
 {raw:"2024-02-29",expected:null},
 {raw:"",expected:null}
];
for(const strict of [false,true])for(const kind of ["docx","dotx"] as const)
for(const route of ["model","model-sdk","model-cli","sdk","cli","sdk-batch","cli-batch"] as const)for(const sample of cases)
it(`native comment timestamp UTC mapping; strict=${strict}; kind=${kind}; route=${route}; lexical=${sample.raw}`,async()=>{
 const lexical=sample.raw?.split("\n").join("&#10;").split("\t").join("&#9;"),attribute=sample.raw===null?"":` w:date="${lexical}"`,body='<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>Retained</w:t></w:r><w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>',xml=`<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Stored"${attribute}><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:p></w:comment><!--retain--><?audit exact?></w:comments>`;
 const parts=readPackage(await textFixture(body,{comments:{kind:"comments",xml}},strict,{kind})),memory=Volume.fromJSON({"/input":"","/output":""}),context={...textContext,encoding:{order:"input",compression:"store"} as const},sink={async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}};
 await api.writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("1980-01-01T00:00:00Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},context.encoding,context);
 const input=new Uint8Array(memory.readFileSync("/input") as Buffer),modelOps=[{operation:"model.document.Document.comments.get",receiver:ref("document"),arguments:{},resultHandle:"comments"},{operation:"model.comments.Comments.get.call",receiver:ref("comments"),arguments:{commentId:7},resultHandle:"comment"},{operation:"model.comments.Comment.timestamp.get",receiver:ref("comment"),arguments:{}}],utilityOps={version:1 as const,operations:[{operation:"comments.get" as const,arguments:{comment:1}}]};
 const observe=(value:unknown)=>{
  if(route.startsWith("model")) expect(value).toBe(sample.expected);
  else if(route==="sdk") expect(value).toMatchObject({comment_id:7,timestamp:sample.raw,author:"Stored",text:"Old",range:{start:{part:"/word/document.xml"},end:{part:"/word/document.xml"},reference:{part:"/word/document.xml"}}});
  else expect(value).toMatchObject({kind:"comments",text:"Old",details:{commentId:7,author:"Stored",timestamp:sample.expected===null?null:sample.expected.slice(0,19)+"Z",modern:false,anchors:expect.arrayContaining([expect.objectContaining({kind:"annotation",value:expect.objectContaining({part:"/word/document.xml"})})])},properties:expect.arrayContaining([expect.objectContaining({name:"stored_timestamp",value:sample.raw})])});
 };
 if(route==="model"){
  const doc=await api.Document(input,context),comment=doc.comments.get(7)!;expect(comment).toBeInstanceOf(api.Comment);observe(comment.timestamp?.toISOString()??null);const date=comment.timestamp;if(date){date.setTime(0);expect(comment.timestamp?.toISOString()).toBe(sample.expected);}expect(Object.getOwnPropertyDescriptor(api.Comment.prototype,"timestamp")!.set).toBeUndefined();expect("id" in comment).toBe(false);expect("date" in comment).toBe(false);await doc.save(sink);expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input);memory.writeFileSync("/output","");
 }else if(route==="model-sdk"){const result=await api.applyStyleModelBatch(input,{version:1,operations:modelOps},context);observe(result.results.at(-1)!.value);expect(result.affected).toBe(0);await result.save(sink);expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input);memory.writeFileSync("/output","");}
 else if(route==="sdk"){observe((await api.inspectDocumentComments(input,{operation:"comments.get",options:{comment:1}},context)).items[0]);}
 else if(route==="sdk-batch"){const result=await api.executeDocumentBatch(input,utilityOps,{},context);observe((result.results[0]!.data as {item:unknown}).item);expect(result.results[0]!.affected).toBe(0);expect(result.publication).toBeNull();}
 else{const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/destination",enc("Retained destination"));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:context.limits})}));try{const result=await shell.exec(route==="cli"?"docx comments get /input --comment 1 --json":`docx batch /input --ops-json '${JSON.stringify(route==="model-cli"?{version:1,operations:modelOps}:utilityOps)}' ${route==="model-cli"?"--dry-run --output /destination --force":""} --json`);expect(result.exitCode,result.stdout+result.stderr).toBe(0);const e=JSON.parse(result.stdout);observe(route==="cli"?e.data.item:route==="model-cli"?e.data.results.at(-1).data:e.data.results[0].data.item);expect(e.affected).toBe(0);expect(await fs.readFile("/input")).toEqual(input);expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));}finally{await shell.dispose();}}
 expect(memory.readFileSync("/output")).toHaveLength(0);await api.editDocumentComments(input,{operation:"comments.set",options:{comment:1,text:"Updated",output:"-"}},{...context,stdout:sink});const after=readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));for(const[part,bytes]of parts)if(part!=="word/comments.xml")expect(after.get(part),part).toEqual(bytes);if(sample.raw!==null)expect(dec(after.get("word/comments.xml")!)).toContain(attribute);expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
