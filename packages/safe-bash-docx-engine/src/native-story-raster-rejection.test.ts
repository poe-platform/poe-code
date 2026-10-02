import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { invalidStoryRasters } from "../tests/fixtures/story-raster-invalid.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"])
for (const raster of invalidStoryRasters) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects native ${owner} ${raster.name} with no added resources; strict=${strict}; kind=${kind}`, async () => {
  const { input, main, role, relationships } = await nativeStoryFixture(owner, strict, kind, '<w:p><w:r><w:t>Retained marsh notes</w:t></w:r></w:p>');
  const before = input.slice(), imageBefore = raster.bytes.slice(), memory = Volume.fromJSON({ "/output": "" });
  for (const method of ["get_or_add_image", "new_pic_inline"] as const) {
    const operations = [
      { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
      ...(!main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${relationships}/${role}` }, resultHandle: "owner" }] : []),
      { operation: `model.parts.${owner}.${method}.call`, receiver: ref(main ? "main" : "owner"), arguments: { imageDescriptor: { kind: "bytes", base64: Buffer.from(raster.bytes).toString("base64") } } }
    ];
    if (route === "model") {
      const document = await api.Document(input, textContext);
      const part = (main ? document.part : document.part.part_related_by(`${relationships}/${role}`)) as api.StoryPart;
      const pending = part[method](raster.bytes); expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
      memory.writeFileSync("/output", "");
      await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
      expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(before));
    } else if (route === "sdk") {
      await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "unsupported-edit" });
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("Existing destination"));
      await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
        expect(await fs.readFile("/input")).toEqual(before); expect(await fs.readFile("/output")).toEqual(enc("Existing destination"));
      } finally { await shell.dispose(); }
    }
    expect(input).toEqual(before); expect(raster.bytes).toEqual(imageBefore);
  }
});
