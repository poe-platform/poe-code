import { Volume } from "memfs";
import { readArchive } from "../../src/archive.js";
import { writeArchive } from "../../src/archive-write.js";
import { textContext, textFixture, paragraph } from "./text.js";

export const signatureRole = "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/";
const types = "application/vnd.openxmlformats-package.digital-signature-";
export async function signatureFixture(scenario = "ordinary") {
 const archive = await readArchive(await textFixture(paragraph("Harbor records")), textContext);
 const files: Record<string,string> = {
  "seals/origin.sigs": "",
  "seals/first.xml": '<s:Signature xmlns:s="http://www.w3.org/2000/09/xmldsig#"/>',
  "seals/second.xml": '<s:Signature xmlns:s="http://www.w3.org/2000/09/xmldsig#"/>',
  "seals/cert.cer": "original certificate bytes",
  "seals/_rels/origin.sigs.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="${signatureRole}signature" Target="first.xml"/><Relationship Id="second" Type="${signatureRole}signature" Target="second.xml"/></Relationships>`,
  "seals/_rels/first.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="certificate" Type="${signatureRole}certificate" Target="cert.cer"/>${scenario === "outgoing" ? '<Relationship Id="unsafe" Type="urn:original:shared" Target="../word/document.xml"/>' : ''}</Relationships>`
 };
 if (scenario === "malformed-root") files["seals/second.xml"] = '<data xmlns="urn:original:unrecognized"/>';
 if (scenario === "invalid-xml") files["seals/second.xml"] = '<broken>';
 if (scenario === "protected") files["word/settings.xml"] = '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:writeProtection/></w:settings>';
 const declarations = `<Default Extension="sigs" ContentType="${types}origin"/><Default Extension="cer" ContentType="${types}certificate"/><Override PartName="/seals/first.xml" ContentType="${types}xmlsignature+xml"/><Override PartName="/seals/second.xml" ContentType="${scenario === "unusual" ? 'application/xml' : types+'xmlsignature+xml'}"/>`;
 const members = archive.members.map(member => {
  let xml = new TextDecoder().decode(member.bytes);
  if(member.name === "[Content_Types].xml") xml = xml.replace('</Types>', declarations+(scenario === "protected" ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' : '')+'</Types>' );
  if(member.name === "_rels/.rels") xml = xml.replace('</Relationships>', `<Relationship Id="seal" Type="${signatureRole}origin" Target="seals/origin.sigs"/>` +(scenario === "external" ? `<Relationship Id="remote" Type="${signatureRole}certificate" Target="https://identity:secret@example.invalid/cert" TargetMode="External"/>` : '')+(scenario === "incoming" ? '<Relationship Id="shared" Type="urn:original:shared" Target="seals/cert.cer"/>' : '')+'</Relationships>');
  return {...member, bytes:new TextEncoder().encode(xml)};
 });
 members.push(...Object.entries(files).map(([name,value]) => ({name,bytes:new TextEncoder().encode(value),directory:false,modified:new Date("2025-01-02T03:04:06Z")})));
 const fs = Volume.fromJSON({"/input":""});
 const finalMembers=scenario === "encoded" ? members.map(member=>({...member,name:member.name.split("seals/").join("%e2%98%85/"),bytes:new TextEncoder().encode(new TextDecoder().decode(member.bytes).split("seals/").join("%e2%98%85/"))})) : members;
 await writeArchive({...archive,members:finalMembers},{async write(bytes){fs.appendFileSync("/input",bytes);}},{order:"input",compression:"store"},textContext);
 return new Uint8Array(fs.readFileSync("/input") as Uint8Array);
}
