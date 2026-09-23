import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string) => ({ resultHandle });
const owners = ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"] as const;
const cases = [
  { name: "empty", body: "<w:p/>", expected: 1 },
  { name: "zero", body: '<w:p id="0"/>', expected: 1 },
  { name: "padded", body: '<w:p id="00021"/>', expected: 22 },
  { name: "malformed and qualified", body: '<w:p id="1.5" w:id="999"/><w:p id="-3"/><w:p id="+8"/><w:p id=" 9"/>', expected: 1 },
  { name: "safe ceiling", body: '<w:p id="9007199254740990"/>', expected: Number.MAX_SAFE_INTEGER },
  { name: "exhausted", body: '<w:p id="9007199254740991"/>', expected: null },
  { name: "unsafe", body: '<w:p id="9007199254740992"/>', expected: null },
  { name: "choice and inactive fallback", body: '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w"><w:p id="2"/></mc:Choice><mc:Fallback><w:p id="98"/></mc:Fallback></mc:AlternateContent>', expected: 99 },
  { name: "fallback and inactive choice", body: '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:ledger:future"><mc:Choice Requires="u"><u:opaque id="98"/></mc:Choice><mc:Fallback><w:p id="2"/></mc:Fallback></mc:AlternateContent>', expected: 99 },
  { name: "process content", body: '<u:carrier xmlns:u="urn:ledger:future" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="u" mc:ProcessContent="u:carrier" id="98"><w:p id="2"/></u:carrier>', expected: 99 },
  { name: "ignored opaque content", body: '<u:opaque xmlns:u="urn:ledger:future" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="u" id="98"><u:child id="12"/></u:opaque><w:p id="2"/>', expected: 99 }
] as const;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of owners) for (const route of ["model", "sdk", "shell"] as const)
for (const item of cases)
it(`${route} reserves physical ${owner} IDs for ${item.name}; ${kind} strict=${strict}`, async () => {
  const fixture = await nativeStoryFixture(owner, strict, kind, item.body), members = readPackage(fixture.input);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  if (!fixture.main) members.set("word/document.xml", enc(`<w:document xmlns:w="${word}"><w:body><w:p id="777"><w:r><w:t>Separate primary owner</w:t></w:r></w:p></w:body></w:document>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    ...(!fixture.main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${fixture.relationships}/${fixture.role}` }, resultHandle: "owner" }] : []),
    { operation: `model.parts.${owner}.next_id.get`, receiver: ref(fixture.main ? "main" : "owner"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, context), part = (fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)) as api.StoryPart;
    const before = doc.part.package.parts.map(part => [String(part.partname), part.blob]);
    if (item.expected === null) expect(() => part.next_id).toThrow(api.ResourceLimitError);
    else { expect(part.next_id).toBe(item.expected); expect(part.next_id).toBe(item.expected); }
    expect(doc.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(members);
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, {}, context);
    if (item.expected === null) await expect(pending).rejects.toMatchObject({ code: "limit-exceeded" });
    else { const result = await pending; expect(result.results.at(-1)!.data).toBe(item.expected); expect(result.publication).toBeNull(); expect(result.results.every(result => result.affected === 0)).toBe(true); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", enc("retained")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --json"), envelope = JSON.parse(response.stdout);
      expect(response.exitCode, response.stdout + response.stderr).toBe(item.expected === null ? 4 : 0);
      expect(envelope.affected).toBe(0);
      if (item.expected === null) expect(envelope).toMatchObject({ ok: false, data: null, errors: [{ code: "limit-exceeded" }] });
      else { expect(envelope.data.results.at(-1).data).toBe(item.expected); expect(envelope.data.publication).toBeNull(); }
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained"));
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
