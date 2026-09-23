import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
const enc=(value:string)=>new TextEncoder().encode(value),ref=(resultHandle:string,index?:number)=>({resultHandle,...(index===undefined?{}:{index})});
for(const strict of [false,true])for(const kind of ["docx","dotx"] as const)
for(const operation of ["comments.add","revisions.add","text.replace","model-comment"] as const)
for(const route of operation==="model-comment"?["model","model-sdk","model-cli"] as const:["sdk","cli","sdk-batch","cli-batch"] as const)
for(const lexical of operation==="model-comment"&&route!=="model-cli"?["0000-01-01T00:00:00.000Z","+010000-01-01T00:00:00.000Z","-000001-01-01T00:00:00.000Z"]:["0000-01-01T00:00:00Z"])
it(`native review creation timestamp range refuses; strict=${strict}; kind=${kind}; operation=${operation}; route=${route}; lexical=${lexical}`,async()=>{
 const input=await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>',{comments:{kind:"comments",xml:`<w:comments xmlns:w="${w}"><w:comment w:id="7" w:date="2000-01-01T00:00:00Z"><w:p/></w:comment><!--retain--></w:comments>`}},strict,{kind}),saved=input.slice(),memory=Volume.fromJSON({"/output":""}),sink={async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}},context={...textContext,encoding:{order:"input",compression:"store"} as const,stdout:sink};
 const locations=await api.openDocumentLocations(input,textContext),select=locations.range(locations.at("paragraph",1).token,0,5).token,metadata={author:"",timestamp:lexical},arguments_=operation==="comments.add"?{select,text:"Note",...metadata}:operation==="revisions.add"?{paragraph:1,kind:"insert",text:"New",...metadata}:{paragraph:1,find:"Coast",with:"Shore",first:true,trackChanges:true,...metadata};
 const modelOps=[{operation:"model.document.Document.paragraphs.get",receiver:ref("document"),arguments:{},resultHandle:"paragraphs"},{operation:"model.text.paragraph.Paragraph.runs.get",receiver:ref("paragraphs",0),arguments:{},resultHandle:"runs"},{operation:"model.document.Document.add_comment.call",receiver:ref("document"),arguments:{runs:ref("runs",0),text:"Note",author:""}}],ops={version:1 as const,operations:operation==="model-comment"?modelOps:[{operation,arguments:arguments_}]};
 if(route==="model"){
  const doc=await api.Document(input,{...context,timestamp:new Date(lexical)});expect(()=>doc.add_comment(doc.paragraphs[0]!.runs[0]!,"Note","")).toThrowError(expect.objectContaining({code:"usage"}));await doc.save(sink);expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input);memory.writeFileSync("/output","");
 }else if(route==="model-sdk")await expect(api.applyStyleModelBatch(input,ops,{...context,timestamp:new Date(lexical)})).rejects.toMatchObject({code:"usage"});
 else if(route==="sdk"){
  const pending=operation==="comments.add"?api.editDocumentComments(input,{operation,options:{select,text:"Note",...metadata,output:"-"}},context):operation==="revisions.add"?api.editDocumentRevisions(input,{paragraph:1,kind:"insert",text:"New",...metadata,output:"-"},context):api.replaceDocumentText(input,{paragraph:1,find:"Coast",with:"Shore",first:true,trackChanges:true,...metadata,output:"-"},context);await expect(pending).rejects.toMatchObject({code:"usage"});
 }else if(route==="sdk-batch")await expect(api.executeDocumentBatch(input,ops,{output:"-"},context)).rejects.toMatchObject({code:"usage"});
 else{
  const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/destination",enc("Retained destination"));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:context.limits})}));try{const flags=operation==="comments.add"?`--select '${select}' --text Note`:operation==="revisions.add"?"--paragraph 1 --kind insert --text New":"--paragraph 1 --find Coast --with Shore --first --track-changes",command=route==="cli"?`docx ${operation.split(".").join(" ")} /input ${flags} --author '' --timestamp ${lexical}`:`docx batch /input --ops-json '${JSON.stringify(ops)}' ${route==="model-cli"?`--author '' --timestamp ${lexical}`:""}`,result=await shell.exec(command+" --output /destination --force --json");expect(result.exitCode,result.stdout+result.stderr).toBe(2);expect(JSON.parse(result.stdout)).toMatchObject({affected:0,errors:[{code:"usage"}]});expect(await fs.readFile("/input")).toEqual(input);expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));}finally{await shell.dispose();}
 }
 expect(memory.readFileSync("/output")).toHaveLength(0);expect(input).toEqual(saved);
});
