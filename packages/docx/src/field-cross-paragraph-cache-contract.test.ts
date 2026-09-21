import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["PAGE", "REF", "TOC"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const route of ["sdk", "cli"])
it(`complex ${kind} cached text across ordinary paragraph boundaries retains paragraph owners; ${carrier}; strict=${strict}; ${route}`, async () => {
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:field-paragraph" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const inert = '<f:inert stamp="retained"/>', wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : inert}</mc:Fallback></mc:AlternateContent>`;
  const instruction = ` ${kind}${kind === "REF" ? " Coast \\h" : kind === "TOC" ? ' \\o "1-3" \\h' : ""} `, encoded = instruction.split('"').join('&quot;');
  const body = `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="0" w:fldLock="1"/></w:r><w:r><w:instrText xml:space="preserve">${encoded}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:p>${wrap('<w:p><!--empty--><w:pPr><w:keepLines/></w:pPr></w:p>')}${wrap('<w:p><!--cache--><?owner keep?><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Sea</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')}`;
  const source = await textFixture(body, {}, strict), p = readPackage(source), main = new TextDecoder().decode(p.get('word/document.xml')).replace('<w:body>', `<w:body ${attrs}>`);p.set('word/document.xml',new TextEncoder().encode(main));
  const volume = Volume.fromJSON({ "/input": "", "/out": "", "/err": "" });
  await api.writeArchive({comment:new Uint8Array(),members:[...p].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date('2026-01-02T03:04:06Z')}))},{async write(b){volume.appendFileSync('/input',b);}},{order:'input',compression:'store'},textContext);
  const input = new Uint8Array(volume.readFileSync('/input') as Buffer), stdout = { async write(b: Uint8Array) { volume.appendFileSync('/out',b); } };
  expect((await api.inspectDocumentFields(input,{},textContext)).items[0]).toMatchObject({kind,form:'complex',instruction,result:'OldSea',update:false,locked:true});
  if(route==='sdk') await api.editDocumentFields(input,{operation:'fields.set',options:{field:1,result:'New é 海',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout});
  else {const result=await api.createDocxInspectionCommandEngine({limits:textContext.limits}).execute({args:['fields','set','/input','--field','1','--result','New é 海','--output','-'].map(s=>new TextEncoder().encode(s)),cwd:'/',signal:textContext.signal,filesystem:{async readFile(path){return new Uint8Array(volume.readFileSync(path) as Buffer);}},stdin:{async *[Symbol.asyncIterator](){}},stdout,stderr:{async write(b){volume.appendFileSync('/err',b);}}});expect(result.exitCode,volume.readFileSync('/err','utf8') as string).toBe(0);}
  const output=new Uint8Array(volume.readFileSync('/out') as Buffer),after=readPackage(output);
  for(const[name,bytes]of p)expect(after.get(name),name).toEqual(name==='word/document.xml'?new TextEncoder().encode(main.replace('>Old<','>New é 海<').replace('>Sea<','><')):bytes);
  expect((await api.inspectDocumentFields(output,{},textContext)).items[0]).toMatchObject({instruction,result:'New é 海',update:false,locked:true});
  const doc=await api.Document(output,textContext);expect(doc.paragraphs).toHaveLength(3);expect(doc.paragraphs[0]!.runs.some(r=>r.bold===true)).toBe(true);expect(doc.paragraphs[2]!.runs.some(r=>r.italic===true)).toBe(true);expect(volume.readFileSync('/input')).toEqual(Buffer.from(input));
});
