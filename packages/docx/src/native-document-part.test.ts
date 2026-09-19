import * as api from "./index.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const properties = ["document", "styles", "settings", "comments", "inline_shapes", "core_properties"] as const;
for (const strict of [false, true]) for (const property of properties) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} resolves DocumentPart.${property} through the same document owner; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict), original = readPackage(input);
  const ctx = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z"), author: "Original coast" };
  const memory = Volume.fromJSON({ "/output": "" }), ref = (resultHandle: string) => ({ resultHandle });
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: `model.parts.document.DocumentPart.${property}.get`, receiver: ref("main"), arguments: {}, resultHandle: "view" },
    property === "document" ? { operation: "model.document.Document.paragraphs.get", receiver: ref("view"), arguments: {} }
      : property === "styles" ? { operation: "model.styles.styles.Styles.__len__.get", receiver: ref("view"), arguments: {} }
        : property === "settings" ? { operation: "model.settings.Settings.odd_and_even_pages_header_footer.get", receiver: ref("view"), arguments: {} }
          : property === "comments" ? { operation: "model.comments.Comments.__len__.get", receiver: ref("view"), arguments: {} }
            : property === "inline_shapes" ? { operation: "model.shape.InlineShapes.__len__.get", receiver: ref("view"), arguments: {} }
              : { operation: "model.opc.coreprops.CoreProperties.title.get", receiver: ref("view"), arguments: {} }
  ];
  const expected = property === "styles" ? 4 : property === "settings" ? false : property === "core_properties" ? "Document" : 0;
  if (route === "model") {
    const doc = await api.Document(input, ctx), main = doc.part as api.DocumentPartView & Pick<api.DocumentView, "styles" | "settings" | "comments" | "inline_shapes" | "core_properties"> & { document: api.DocumentView };
    expect(main[property], property).toBeDefined();
    if (property === "document") expect(main.document.paragraphs[0]!.text).toBe("Original coast");
    if (property === "styles") expect(main.styles.length).toBe(expected);
    if (property === "settings") expect(main.settings.odd_and_even_pages_header_footer).toBe(expected);
    if (property === "comments") expect(main.comments.length).toBe(expected);
    if (property === "inline_shapes") expect(main.inline_shapes.length).toBe(expected);
    if (property === "core_properties") expect(main.core_properties.title).toBe(expected);
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, ctx);
    if (property === "document") expect(result.results.at(-1)!.value).toHaveLength(1); else expect(result.results.at(-1)!.value).toBe(expected);
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const mutates = !["document", "inline_shapes"].includes(property);
      const result = await shell.exec(`docx batch /input --ops-file /ops --timestamp 2026-01-02T03:04:06Z --author 'Original coast' --json${mutates ? " --output /output" : ""}`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const value = JSON.parse(result.stdout).data.results.at(-1).data;
      if (property === "document") expect(value).toHaveLength(1); else expect(value).toBe(expected);
      memory.writeFileSync("/output", mutates ? await fs.readFile("/output") : input);
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of original) if (!["[Content_Types].xml", "word/_rels/document.xml.rels", "_rels/.rels"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Original coast");
});
