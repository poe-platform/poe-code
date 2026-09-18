import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const tags = ["en-US", "zh-Hant-TW", "es-419", "de-DE-u-co-phonebk", "x-coastal", "i-klingon", "zh-cmn-Hans-CN"];
for (const strict of [false, true]) for (const tag of tags) for (const shape of ["scalar", "latin", "eastAsia", "bidi"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} applies declared ${shape} language shape ${tag}; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:b/><w:rtl/><w:rFonts w:eastAsia="Original CJK"/><w:lang w:val="fr-FR" w:eastAsia="ja-JP" w:bidi="he-IL"/></w:rPr><w:t>é 日本 עברית 🌊</w:t></w:r></w:p>', {}, strict), volume = Volume.fromJSON({ "/out": "" });
  const batch = { version: 1, operations: shape === "scalar" ? [{ operation: "runs.set", arguments: { paragraph: 1, run: 1, language: tag } }] : [
    { operation: "runs.get", arguments: { paragraph: 1, run: 1 }, resultHandle: "owner" },
    { operation: "runs.fonts.set", receiver: { resultHandle: "owner" }, arguments: { language: { [shape]: tag } } }
  ] };
  if (route === "sdk") await api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = shape === "scalar" ? `docx runs set /input --paragraph 1 --run 1 --language ${tag} --output - > /out` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`;
      const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); expect(after.size).toBe(before.size);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const root = api.parseDocumentXml(after.get("word/document.xml")!).root, lang = root.children[0]!.children[0]!.children[0]!.children[0]!.children.find(n => n.localName === "lang")!;
  const values = ["val", "eastAsia", "bidi"].map(name => lang.attributes.find(a => a.namespace === root.namespace && a.localName === name)?.value);
  expect(values).toEqual([shape === "scalar" || shape === "latin" ? tag : "fr-FR", shape === "eastAsia" ? tag : "ja-JP", shape === "bidi" ? tag : "he-IL"]);
  const run = (await api.Document(output, textContext)).paragraphs[0]!.runs[0]!; expect(run.text).toBe("é 日本 עברית 🌊"); expect(run.bold).toBe(true); expect(run.font.rtl).toBe(true);
});

for (const strict of [false, true]) for (const language of ["", ...tags, { val: "en-US" }]) for (const route of ["sdk", "shell"] as const)
it(`${route} rejects undeclared advanced language shape ${JSON.stringify(language)} before publication; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict), volume = Volume.fromJSON({ "/out": "" });
  const batch = { version: 1, operations: [{ operation: "runs.get", arguments: { paragraph: 1, run: 1 }, resultHandle: "owner" }, { operation: "runs.fonts.set", receiver: { resultHandle: "owner" }, arguments: { language } }] };
  if (route === "sdk") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "usage" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --json --output - > /out`); expect(result.exitCode).toBe(2); expect(JSON.parse(new TextDecoder().decode(await fs.readFile('/out')))).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: 'usage' })] }); expect(await fs.readFile("/input")).toEqual(input); expect(result.stderr).toContain("Invalid language"); } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/out")).toHaveLength(0);
});
