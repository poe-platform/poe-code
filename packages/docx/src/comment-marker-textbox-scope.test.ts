import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { box as shapeBox } from "../tests/fixtures/shapes.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["vml", "office", "native"] as const) for (const operation of ["assign", "replace"] as const) for (const route of ["sdk", "sdk-model-batch", "cli", "cli-model-batch"] as const)
it(`${route} ${operation} refuses annotationRef in separate comment text-box story; carrier=${carrier}; ${kind}; strict=${strict}`, async () => {
  const box = shapeBox('<w:p><w:r><w:t>c🌊</w:t><w:annotationRef/><w:t>st</w:t></w:r></w:p>', carrier, strict);
  const parts = readPackage(await textFixture("<w:p/>", { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7">${box}</w:comment></w:comments>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "Original destination" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  if (strict && carrier !== "native") {
    const rejection = carrier === "vml" ? "invalid-package" : "missing-selection";
    if (carrier === "vml") await expect(api.Document(input, textContext)).rejects.toMatchObject({ code: rejection });
    else {
      const locations = await api.openDocumentLocations(input, textContext);
      expect(locations.text({ scope: "text-boxes" }).text).toBe("");
      expect(locations.list("paragraph", { scope: "text-boxes" })).toHaveLength(0);
      expect((await api.inspectDocumentShapes(input, { scope: "comments" }, textContext)).items).toHaveLength(1);
    }
    const args = operation === "assign" ? { scope: "text-boxes" as const, paragraph: 1, text: "NEW" } : { scope: "text-boxes" as const, paragraph: 1, find: "🌊s", with: "日本", all: true };
    const op = operation === "assign" ? "paragraphs.set" as const : "text.replace" as const;
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
    if (route === "sdk") {
      if (operation === "assign") await expect(api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { ...args, output: "-" } }, context)).rejects.toMatchObject({ code: rejection });
      else await expect(api.replaceDocumentText(input, { ...args, find: "🌊s", with: "日本", all: true, output: "-" }, context)).rejects.toMatchObject({ code: rejection });
    } else if (route === "sdk-model-batch") await expect(api.executeDocumentBatch(input, { version: 1, operations: [{ operation: op, arguments: args }] }, { output: "-" }, context)).rejects.toMatchObject({ code: rejection });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec(route === "cli-model-batch" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation: op, arguments: args }] })}' --output /out --force --json` : operation === "assign" ? "docx paragraphs set /input --scope text-boxes --paragraph 1 --text NEW --output /out --force --json" : "docx text replace /input --scope text-boxes --paragraph 1 --find '🌊s' --with '日本' --all --output /out --force --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: rejection }] });
        expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
      } finally { await shell.dispose(); }
    }
    expect(volume.readFileSync("/out", "utf8")).toBe("Original destination"); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
    return;
  }
  const locations = await api.openDocumentLocations(input, textContext);
  expect(locations.text({ scope: "text-boxes" }).text).toBe("c🌊st");
  const select = locations.at("paragraph", 1, { scope: "text-boxes" }).token, code = operation === "assign" ? "unsupported-edit" : "missing-selection";
  const operations = operation === "assign" ? [
    { operation: "paragraphs.get", arguments: { select }, resultHandle: "owner" },
    { operation: "model.text.paragraph.Paragraph.text.set", receiver: { resultHandle: "owner" }, arguments: { value: "NEW" } }
  ] : [{ operation: "text.replace", arguments: { select, find: "🌊s", with: "日本", all: true } }];
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  if (route === "sdk") {
    if (operation === "assign") await expect(api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { select, text: "NEW", output: "-" } }, context)).rejects.toMatchObject({ code });
    else await expect(api.replaceDocumentText(input, { select, find: "🌊s", with: "日本", all: true, output: "-" }, context)).rejects.toMatchObject({ code });
  } else if (route === "sdk-model-batch") await expect(api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, context)).rejects.toMatchObject({ code });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(route === "cli-model-batch" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --force --json` : operation === "assign" ? `docx paragraphs set /input --select '${select}' --text NEW --output /out --force --json` : `docx text replace /input --select '${select}' --find '🌊s' --with '日本' --all --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/out", "utf8")).toBe("Original destination"); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
