import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
const owners = ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of owners) for (const present of [false, true])
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} resolves native ${owner} empty style name present=${present} in ${carrier}; ${kind} strict=${strict}`, async () => {
  const fixture = await nativeStoryFixture(owner, strict, kind, "<w:p/>");
  const memory = Volume.fromJSON({ "/seed": "", "/input": "", "/output": "" }), seed = await api.Document(fixture.input, textContext);
  seed.styles.add_style("Source Ledger", api.WD_STYLE_TYPE.PARAGRAPH);
  await seed.save({ async write(bytes) { memory.appendFileSync("/seed", bytes); } });
  const members = readPackage(new Uint8Array(memory.readFileSync("/seed") as Buffer));
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const inactive = '<w:style w:type="paragraph" w:styleId="InactiveEmpty"><w:name w:val=""/></w:style>';
  const active = `<w:style w:type="paragraph" w:styleId="ActiveEmpty">${present ? '<w:name w:val=""/>' : ""}</w:style>`;
  const process = (body: string) => `<f:carrier>${body}</f:carrier>`;
  const alternative = (body: string, fallback = false) => `<mc:AlternateContent><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inactive : body}</mc:Choice><mc:Fallback>${fallback ? body : inactive}</mc:Fallback></mc:AlternateContent>`;
  const wrapped = carrier === "direct" ? active : carrier === "choice" ? alternative(active) : carrier === "fallback" ? alternative(active, true) : carrier === "process" ? process(active) : alternative(process(active));
  members.set(String(seed.styles.part.partname).slice(1), enc(`<?xml version="1.0"?><!--ledger--><w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:ledger:future" mc:Ignorable="f" mc:ProcessContent="f:carrier"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${wrapped}<f:sealed>${inactive}</f:sealed><?retain ledger?></w:styles>`));
  await api.writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    ...(!fixture.main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${fixture.relationships}/${fixture.role}` }, resultHandle: "owner" }] : []),
    { operation: `model.parts.${owner}.get_style_id.call`, receiver: ref(fixture.main ? "main" : "owner"), arguments: { styleOrName: "", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } } }
  ];
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), part = (fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)) as api.StoryPart;
    if (present) expect(part.get_style_id("", api.WD_STYLE_TYPE.PARAGRAPH)).toBe("ActiveEmpty");
    else expect(() => part.get_style_id("", api.WD_STYLE_TYPE.PARAGRAPH)).toThrow(api.MissingKeyError);
    await doc.save(sink);
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(before);
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    if (present) {
      const result = await pending; expect(result.results.at(-1)!.data).toBe("ActiveEmpty"); expect(result.results.map(item => item.affected)).toEqual(operations.map(() => 0)); expect(result.publication?.changed).toBe(false);
      expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(before);
    } else { await expect(pending).rejects.toBeInstanceOf(api.MissingKeyError); expect(memory.readFileSync("/output")).toEqual(Buffer.alloc(0)); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("retained")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json"), envelope = JSON.parse(response.stdout);
      expect(response.exitCode, response.stdout + response.stderr).toBe(present ? 0 : 1); expect(envelope.affected).toBe(0);
      if (present) { expect(envelope.data.results.at(-1).data).toBe("ActiveEmpty"); expect(readPackage(await fs.readFile("/output"))).toEqual(before); }
      else { expect(envelope).toMatchObject({ ok: false, data: null, errors: [{ code: "missing-selection" }] }); expect(await fs.readFile("/output")).toEqual(enc("retained")); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
