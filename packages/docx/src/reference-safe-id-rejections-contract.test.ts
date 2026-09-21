import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const domain of ["bookmark", "footnote", "endnote"] as const)
for (const raw of ["9007199254740992", "-9007199254740992", "1e0", "0x3", "3.0", "+", "&#xA0;3", "-1", "-2"])
it(`unsafe/malformed/nonnegative reference storage rejects across public paths; ${domain}; ${raw}; strict=${strict}`, async () => {
  const note=domain!=="bookmark", body=note?`<w:p><w:r><w:${domain}Reference w:id="${raw}"/></w:r></w:p>`:`<w:p><w:bookmarkStart w:id="${raw}" w:name="Coast"/><w:r><w:t>Retained é 海</w:t></w:r><w:bookmarkEnd w:id="${raw}"/></w:p>`;
  const input=await textFixture(body,note?{notes:{kind:domain+'s',xml:`<w:${domain}s xmlns:w="${w}"><w:${domain} w:id="${raw}"><w:p><w:r><w:t>Retained</w:t></w:r></w:p></w:${domain}></w:${domain}s>`}}:{},strict);
  const volume=Volume.fromJSON({'/input':Buffer.from(input),'/binary':'','/json':''}), stdout={async write(b:Uint8Array){volume.appendFileSync('/binary',b);}};
  const model=await api.Document(input,textContext);expect(model.paragraphs).toHaveLength(1);
  await expect(model.save(stdout)).rejects.toMatchObject({code:'invalid-package'});
  if(note)await expect(api.editDocumentNotes(input,{operation:'notes.set',options:{kind:domain,note:1,text:'Denied',output:'-'}},{...textContext,encoding:{order:"input",compression:"store"},stdout})).rejects.toMatchObject({code:'invalid-package'});
  else await expect(api.editDocumentBookmarks(input,{operation:'bookmarks.set',options:{bookmark:1,name:'Estuary',references:'update',output:'-'}},{...textContext,encoding:{order:"input",compression:"store"},stdout})).rejects.toMatchObject({code:'invalid-package'});
  const args=note?['notes','set','/input','--kind',domain,'--note','1','--text','Denied','--dry-run','--json']:['bookmarks','set','/input','--bookmark','1','--name','Estuary','--references','update','--dry-run','--json'];
  const result=await api.createDocxInspectionCommandEngine({limits:textContext.limits}).execute({args:args.map(s=>new TextEncoder().encode(s)),cwd:'/',signal:textContext.signal,filesystem:{async readFile(p){return new Uint8Array(volume.readFileSync(p) as Buffer);}},stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(b){volume.appendFileSync('/json',b);}},stderr:{async write(){}}});
  expect(result.exitCode).toBe(1); expect(JSON.parse(volume.readFileSync('/json','utf8') as string)).toMatchObject({ok:false,affected:0,data:null,errors:[{code:'invalid-package'}]});expect(volume.readFileSync('/binary')).toHaveLength(0);expect(volume.readFileSync('/input')).toEqual(Buffer.from(input));
});
