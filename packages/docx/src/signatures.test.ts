import { expect, it } from "vitest";
import { Volume } from "memfs";
import { inspectDocumentSignatures, stripDocumentSignatures } from "./signatures.js";
import { replaceDocumentText } from "./text-replace.js";
import { signatureFixture } from "../tests/fixtures/signatures.js";
import { textContext, textFixture, paragraph } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const encoding = {order:"input",compression:"store"} as const;
it.each(["ordinary","unusual","malformed-root"])("inventories multiple signature structures without validity claims: %s",async scenario=>{
 const input=await signatureFixture(scenario), original=new Uint8Array(input);
 const data=await inspectDocumentSignatures(input,{},textContext);
 expect(data.items.map(item=>item.name)).toEqual(["/seals/origin.sigs","/seals/first.xml","/seals/second.xml","/seals/cert.cer"]);
 expect(data.relationships).toHaveLength(4); expect(data.verified).toBeNull(); expect(input).toEqual(original);
});
it("rejects ordinary edits until a separate full signature removal completes",async()=>{
 const input=await signatureFixture(), fs=Volume.fromJSON({"/output":""});
 await expect(replaceDocumentText(input,{find:"Harbor",with:"Coastal",all:true,output:"-"},{...textContext,encoding,stdout:{async write(bytes){fs.appendFileSync("/output",bytes);}}})).rejects.toMatchObject({code:"unsupported-edit"});
 expect(fs.readFileSync("/output")).toHaveLength(0);
 const data=await stripDocumentSignatures(input,{output:"-"},{...textContext,encoding,stdout:{async write(bytes){fs.appendFileSync("/output",bytes);}}});
 expect(data.removedParts).toEqual(["/seals/origin.sigs","/seals/first.xml","/seals/second.xml","/seals/cert.cer","/seals/_rels/origin.sigs.rels","/seals/_rels/first.xml.rels"]);
 expect(data.removedRelationships).toHaveLength(4); expect(data.removedContentTypes).toHaveLength(4);
 const output=new Uint8Array(fs.readFileSync("/output") as Uint8Array), parts=readPackage(output); assertPackageLinks(parts);
 expect([...parts.keys()].some(name=>name.startsWith("seals/"))).toBe(false);
 expect(parts.get("word/document.xml")).toEqual(readPackage(input).get("word/document.xml"));
 await expect(replaceDocumentText(output,{find:"Harbor",with:"Coastal",all:true,dryRun:true},{...textContext,encoding})).resolves.toMatchObject({changed:true});
});
it.each(["incoming","outgoing"])("preserves input and sinks for unsafe shared graph: %s",async scenario=>{
 const input=await signatureFixture(scenario), original=new Uint8Array(input), fs=Volume.fromJSON({"/output":"existing"});
 await expect(stripDocumentSignatures(input,{output:"-"},{...textContext,encoding,stdout:{async write(bytes){fs.appendFileSync("/output",bytes);}}})).rejects.toMatchObject({code:"unsupported-edit"});
 expect(input).toEqual(original); expect(fs.readFileSync("/output","utf8")).toBe("existing");
});
it("reports exact dry-run effects without publishing and rejects empty removal unless explicit",async()=>{
 const input=await signatureFixture(), write=async()=>{throw new Error("unexpected publication");};
 const data=await stripDocumentSignatures(input,{dryRun:true},{...textContext,encoding,stdout:{write}});
 expect(data.changed).toBe(true); expect(data.output).toBeNull(); expect(data.removedRelationships).toHaveLength(4);
 const unsigned=await textFixture(paragraph("Unsealed"));
 await expect(stripDocumentSignatures(unsigned,{dryRun:true},{...textContext,encoding})).rejects.toMatchObject({code:"missing-selection"});
 await expect(stripDocumentSignatures(unsigned,{dryRun:true,allowEmpty:true},{...textContext,encoding})).resolves.toMatchObject({changed:false,removedParts:[]});
});

it("does not let ordinary publication silently remove signatures from its admitted baseline",async()=>{
 const {readDocumentArchive}=await import("./admission.js"), {publishDocumentArchive}=await import("./publication.js");
 const signed=await readDocumentArchive(await signatureFixture(),textContext);
 const unsigned=await readDocumentArchive(await textFixture(paragraph("Harbor records")),textContext);
 await expect(publishDocumentArchive(unsigned,{dryRun:true},{...textContext,encoding},signed)).rejects.toMatchObject({code:"unsupported-edit"});
});

it("keeps external signature declarations inert and omits raw targets",async()=>{
 const input=await signatureFixture("external"), data=await inspectDocumentSignatures(input,{},textContext);
 expect(data.relationships).toContainEqual(expect.objectContaining({id:"remote",external:true,target:null}));
 expect(JSON.stringify(data)).not.toContain("secret");
 const removed=await stripDocumentSignatures(input,{dryRun:true},{...textContext,encoding});
 expect(removed.removedRelationships).toHaveLength(5);
});
it.each(["protected","invalid-xml"])("preserves input for refused removal: %s",async scenario=>{
 const input=await signatureFixture(scenario), original=new Uint8Array(input);
 await expect(stripDocumentSignatures(input,{dryRun:true},{...textContext,encoding})).rejects.toBeInstanceOf(Error);
 expect(input).toEqual(original);
});
it("preserves input and existing destination when atomic signature publication fails",async()=>{
 const {publication}=await import("../tests/fixtures/object-publication.js"), input=await signatureFixture(), env=publication(input);
 env.volume.writeFileSync("/out/result.docx","existing");
 const fs={...env.fs,publishStagedFile:async()=>{throw new Error("Original publication refusal");}};
 await expect(stripDocumentSignatures(input,{output:"/out/result.docx",force:true},{...textContext,encoding,filesystem:fs})).rejects.toMatchObject({code:"sink-failure"});
 expect(env.volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
 expect(env.volume.readFileSync("/out/result.docx","utf8")).toBe("existing");
 expect(env.volume.readdirSync("/out")).toEqual(["result.docx"]);
});
it("admits precise effects before publication and preserves source on admission failure",async()=>{
 const input=await signatureFixture(), original=new Uint8Array(input);
 await expect(stripDocumentSignatures(input,{output:"-"},{...textContext,encoding,stdout:{async write(){throw new Error("unexpected sink");}},admitPublication(){throw new Error("Original receipt limit");}})).rejects.toThrow("Original receipt limit");
 expect(input).toEqual(original);
});

it("fingerprints the owned admitted bytes when the caller changes its input during admission",async()=>{
 const input=await signatureFixture(), original=new Uint8Array(input);
 const pending=inspectDocumentSignatures(input,{},textContext); input.fill(0);
 const data=await pending;
 const expected=[...new Uint8Array(await crypto.subtle.digest("SHA-256",original))].map(value=>value.toString(16).padStart(2,"0")).join("");
 expect(data.items[0]!.location.value.sourceSha256).toBe(expected);
});

it("removes encoded signature part names using admitted OPC identity",async()=>{
 const input=await signatureFixture("encoded"), fs=Volume.fromJSON({"/output":""});
 const data=await stripDocumentSignatures(input,{output:"-"},{...textContext,encoding,stdout:{async write(bytes){fs.appendFileSync("/output",bytes);}}});
 expect(data.removedParts).toHaveLength(6); expect(data.removedParts[0]).toBe("/★/origin.sigs");
 const parts=readPackage(new Uint8Array(fs.readFileSync("/output") as Uint8Array)); assertPackageLinks(parts);
 expect(parts.size).toBe(4);
});
