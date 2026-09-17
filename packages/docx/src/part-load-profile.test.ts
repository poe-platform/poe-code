import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, PartView, XmlPartView, applyStyleModelBatch, createDocxInspectionCommandEngine, readDocumentArchive, writeArchive, type DocxBatchOperation } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false,true]) for (const kind of ["docx","dotx"] as const)
for (const factory of ["Part","XmlPart"] as const) for (const type of ["application/xml", "application/xml;audit=native", 'application/x-audit+xml; audit="coast; dunes"'])
for (const form of ["must-understand","choice","unknown-requirement"] as const) for (const route of ["model","sdk","shell"] as const)
it(`${route} loads generic ${factory} ${form} ${JSON.stringify(type)}; ${kind} strict=${strict}`, async () => {
  const enc=(text:string)=>new TextEncoder().encode(text),dec=(bytes:Uint8Array)=>new TextDecoder().decode(bytes),w=strict?"http://purl.oclc.org/ooxml/wordprocessingml/main":"http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parts=readPackage(await textFixture('<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>',{},strict));parts.set("[Content_Types].xml",enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml",`wordprocessingml.${kind==="dotx"?"template":"document"}.main+xml`)));
  const content=form==="choice"?'<mc:AlternateContent><mc:Choice Requires="w"><w:p/></mc:Choice><mc:Fallback><f:opaque/></mc:Fallback></mc:AlternateContent>':'<w:p/>';
  const xml=`<!--retained--><pr:Relationships xmlns:pr="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future"${form==="must-understand"?' mc:MustUnderstand="w"':form==="unknown-requirement"?' mc:MustUnderstand="f"':''}>${content}</pr:Relationships><?audit retained?>`,blob=enc(xml),memory=Volume.fromJSON({"/input":"","/output":""}),sink={async write(bytes:Uint8Array){memory.appendFileSync("/output",bytes);}};
  await writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){memory.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},textContext);const input=new Uint8Array(memory.readFileSync("/input") as Buffer);
  if(route==="model"){
    const model=await Document(input,textContext),task=(factory==="Part"?PartView:XmlPartView).load("/audit/loaded.data",type,blob,model.part.package);
    if(form==="unknown-requirement"){await expect(task).rejects.toMatchObject({code:"unsupported-profile"});await model.save(sink);expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);return;}
    const loaded=await task;expect(loaded).toBeInstanceOf(XmlPartView);expect(loaded.blob).toEqual(blob);expect((loaded as XmlPartView).element.tag.localName).toBe("Relationships");if(factory==="XmlPart")(loaded as XmlPartView).element.set_attribute({namespaceURI:"",localName:"audit"},"retained");await model.save(sink);
  }else{
    const operations:DocxBatchOperation[]=[
      {operation:"model.document.Document.part.get",receiver:{resultHandle:"document"},arguments:{},resultHandle:"main"},
      {operation:"model.parts.document.DocumentPart.package.get",receiver:{resultHandle:"main"},arguments:{},resultHandle:"owner"},
      {operation:factory==="Part"?"model.opc.part.Part.load.call":"model.opc.part.XmlPart.load.call",arguments:{partname:"/audit/loaded.data",contentType:type,blob:{kind:"bytes",base64:Buffer.from(blob).toString("base64")},ownerPackage:{resultHandle:"owner"}},resultHandle:"loaded"},
      {operation:"model.opc.part.XmlPart.element.get",receiver:{resultHandle:"loaded"},arguments:{},resultHandle:"xml"},
      {operation:"model.XmlElementView.set_attribute.call",receiver:{resultHandle:"xml"},arguments:{name:{namespaceURI:"",localName:"audit"},value:"retained"}}
    ],batch={version:1 as const,operations:factory==="Part"?operations.slice(0,3):operations};
    if(route==="sdk"){const task=applyStyleModelBatch(input,batch,textContext);if(form==="unknown-requirement")await expect(task).rejects.toMatchObject({code:"unsupported-profile"});else await(await task).save(sink);}
    else{const fs=new MemoryFileSystem();await fs.writeFile("/input",input);await fs.writeFile("/ops.json",enc(JSON.stringify(batch)));const result=await new Shell({fs}).use(docxCommands({engine:createDocxInspectionCommandEngine({limits:textContext.limits})})).exec("docx batch /input --ops-file /ops.json --output - > /output");if(form==="unknown-requirement"){expect(result.exitCode).not.toBe(0);expect(result.stderr).toContain("unsupported-profile");}else expect(result.exitCode,result.stderr).toBe(0);memory.writeFileSync("/output",await fs.readFile("/output"));expect(await fs.readFile("/input")).toEqual(input);}
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));if(form==="unknown-requirement"){expect(memory.readFileSync("/output").length).toBe(0);return;}
  const output=new Uint8Array(memory.readFileSync("/output") as Buffer),saved=readPackage(output),added=saved.get("audit/loaded.data")!;
  expect(dec(added)).toBe(factory==="XmlPart"?xml.replace('>'+content,' audit="retained">'+content):xml);expect((await readDocumentArchive(output,textContext)).package.getPart("/audit/loaded.data").content_type).toBe(type);for(const[name,bytes]of parts)if(name!=="[Content_Types].xml")expect(saved.get(name),name).toEqual(bytes);expect((await Document(output,textContext)).paragraphs[0]!.text).toBe("Retained body");
});
