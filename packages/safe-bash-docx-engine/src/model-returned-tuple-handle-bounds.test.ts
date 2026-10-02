import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const creators = ["header-pair", "footer-pair", "story-image-pair", "scaled-dimensions"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const owner of creators) for (const boundary of ["valid", "index-end"] as const) for (const route of ["sdk", "shell"])
it(`${route} selects ${boundary} from returned ${owner}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "Original destination" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), blob = { kind: "bytes", base64: Buffer.from(replacementPng()).toString("base64") };
  const operations: Record<string, unknown>[] = owner === "scaled-dimensions" ? [
    { operation: "model.image.image.Image.from_blob.call", arguments: { blob }, resultHandle: "image" },
    { operation: "model.image.image.Image.scaled_dimensions.call", receiver: ref("image"), arguments: { width: 100, height: 200 }, resultHandle: "items" }
  ] : [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part" },
    { operation: `model.parts.document.DocumentPart.${owner === "header-pair" ? "add_header_part" : owner === "footer-pair" ? "add_footer_part" : "get_or_add_image"}.call`, receiver: ref("part"), arguments: owner === "story-image-pair" ? { imageDescriptor: blob } : {}, resultHandle: "items" }
  ];
  const index = boundary === "index-end" ? 2 : owner === "story-image-pair" ? 1 : 0;
  operations.push({ operation: owner === "scaled-dimensions" ? "model.shared.Length.emu.get" : owner === "story-image-pair" ? "model.image.image.Image.content_type.get" : `model.parts.hdrftr.${owner === "header-pair" ? "HeaderPart" : "FooterPart"}.partname.get`, receiver: ref("items", index), arguments: {} });
  const batch = { version: 1, operations };
  if (route === "sdk") {
    if (boundary === "index-end") { const pending = api.applyStyleModelBatch(input, batch, textContext); await expect(pending).rejects.toBeInstanceOf(api.BoundsError); await expect(pending).rejects.toMatchObject({ code: "missing-selection", operationIndex: 2 }); }
    else { const result = await api.applyStyleModelBatch(input, batch, textContext), value = result.results.at(-1)!.value; if (owner === "scaled-dimensions") expect(value).toBe(100); else if (owner === "story-image-pair") expect(value).toBe("image/png"); else expect(value).toContain(owner === "header-pair" ? "header" : "footer"); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' ${owner === "scaled-dimensions" ? "" : "--output /out --force"} --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(boundary === "index-end" ? 1 : 0);
      if (boundary === "index-end") { expect(JSON.parse(result.stdout).errors[0]).toMatchObject({ code: "missing-selection", operationIndex: 2 }); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination"); }
      else { const value = JSON.parse(result.stdout).data.results.at(-1).data; if (owner === "scaled-dimensions") expect(value).toBe(100); else if (owner === "story-image-pair") expect(value).toBe("image/png"); else expect(value).toContain(owner === "header-pair" ? "header" : "footer"); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/out", "utf8")).toBe("Original destination");
});
