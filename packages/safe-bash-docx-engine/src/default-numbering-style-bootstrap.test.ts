import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} materializes all four style defaults including the numbering default; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {}, strict);
  const volume = Volume.fromJSON({ "/out": "" });
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const operations = [
    { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__len__.get", receiver: { resultHandle: "styles" }, arguments: {} },
    { operation: "model.styles.styles.Styles.default.call", receiver: { resultHandle: "styles" }, arguments: { styleType: { enum: "WD_STYLE_TYPE", name: "LIST" } }, resultHandle: "numberingDefault" },
    { operation: "model.styles.style.BaseStyle.name.get", receiver: { resultHandle: "numberingDefault" }, arguments: {} }
  ];
  if (route === "model") {
    const document = await api.Document(input, textContext);
    expect(document.styles.length).toBe(4);
    const style = document.styles.default(api.WD_STYLE_TYPE.LIST);
    expect(style).toBeInstanceOf(api.BaseStyle);
    expect(style!.name).toBe("No List");
    expect(style!.style_id).toBe("NoList");
    expect(style!.type).toBe(api.WD_STYLE_TYPE.LIST);
    expect(style!.builtin).toBe(true);
    await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results[1]!.value).toBe(4);
    expect(result.results[3]!.value).toBe("No List");
    await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.data.results[1].data).toBe(4);
      expect(envelope.data.results[3].data).toBe("No List");
      expect(await fs.readFile("/input")).toEqual(input);
      volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const before = readPackage(input), after = readPackage(bytes); assertPackageLinks(after);
  for (const [name, payload] of before) if (name !== "[Content_Types].xml" && name !== "word/_rels/document.xml.rels") expect(after.get(name), name).toEqual(payload);
  const reloaded = await api.Document(bytes, textContext);
  expect(reloaded.styles.length).toBe(4);
  expect(reloaded.styles.default(api.WD_STYLE_TYPE.LIST)!.name).toBe("No List");
  expect(reloaded.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊");
  const repeat = Volume.fromJSON({ "/out": "" }); await reloaded.save({ async write(payload: Uint8Array) { repeat.appendFileSync("/out", payload); } });
  const repeated = readPackage(new Uint8Array(repeat.readFileSync("/out") as Buffer));
  for (const [name, payload] of after) expect(repeated.get(name), name).toEqual(payload);
});
