import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc = (text: string) => new TextEncoder().encode(text), ref = (resultHandle: string) => ({ resultHandle });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const ownership of ["orphan", "shared-style", "ambiguous-style"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} resolves a ${ownership} native story without guessing a conflicting document style owner; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const seed = await api.Document(fixture.input, textContext), w = seed.element.namespace;
  const id = seed.styles.add_style("Coastal Style", api.WD_STYLE_TYPE.PARAGRAPH).style_id!;
  const header = api.HeaderPart.new(seed.part.package); seed.part.relate_to(header, "urn:coast:selected");
  if (ownership !== "orphan") {
    const chapter = await api.DocumentPartView.load("/appendix/chapter.xml", seed.part.content_type,
      enc(`<w:document xmlns:w="${w}"><w:body><w:p/></w:body></w:document>`), seed.part.package);
    seed.part.relate_to(chapter, "urn:coast:appendix");
    const styles = ownership === "shared-style" ? seed.styles.part : await api.StylesPart.load("/appendix/styles.xml", seed.styles.part.content_type,
      enc(`<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="Different Style"/></w:style></w:styles>`), seed.part.package);
    chapter.relate_to(styles, fixture.relationships + "/styles");
    chapter.relate_to(header, fixture.relationships + "/header"); seed.part.relate_to(header, fixture.relationships + "/header");
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.part_related_by.call", receiver: ref("main"), arguments: { reltype: "urn:coast:selected" }, resultHandle: "header" },
    { operation: "model.parts.hdrftr.HeaderPart.get_style.call", receiver: ref("header"), arguments: { styleId: id, styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "style" },
    { operation: "model.styles.style.ParagraphStyle.name.get", receiver: ref("style"), arguments: {} }
  ];
  if (route === "model") {
    const document = await api.Document(input, textContext), selected = document.part.part_related_by("urn:coast:selected") as api.HeaderPart;
    if (ownership === "ambiguous-style") expect(() => selected.get_style(id, api.WD_STYLE_TYPE.PARAGRAPH)).toThrow(expect.objectContaining({ code: "unsupported-edit" }));
    else expect(selected.get_style(id, api.WD_STYLE_TYPE.PARAGRAPH).name).toBe("Coastal Style");
    await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  } else if (route === "sdk") {
    const pending = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (ownership === "ambiguous-style") await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
    else expect((await pending).results.at(-1)!.value).toBe("Coastal Style");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --dry-run --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(ownership === "ambiguous-style" ? 1 : 0); const data = JSON.parse(result.stdout); if (ownership === "ambiguous-style") expect(data.errors[0].code).toBe("unsupported-edit"); else expect(data.data.results.at(-1).data).toBe("Coastal Style"); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
});
