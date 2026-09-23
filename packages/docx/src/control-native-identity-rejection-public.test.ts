import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const raw of ["1.0", "1e3", "+", "&#xA0;1"])
for (const operation of ["controls.repeat", "template.apply"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`malformed control identity cloning is atomic; strict=${strict}; kind=${kind}; raw=${raw}; operation=${operation}; route=${route}`, async () => {
  const input = await textFixture(`<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="${raw}"/><w:tag w:val="rows"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="coast"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Retained海🌊</w:t></w:r></w:sdtContent></w:sdt></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const records = [{ values: [{ binding: "coast", value: "Changed" }] }], arguments_ = operation === "controls.repeat" ? { control: 1, data: records } : { data: records };
  const batch = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
  if (route.startsWith("sdk")) {
    const pending = route === "sdk-batch" ? api.executeDocumentBatch(input, batch, { output: "-" }, context) : operation === "controls.repeat" ? api.editDocumentControlRepeats(input, { control: 1, data: records, output: "-" }, context) : api.applyDocumentTemplate(input, { data: records, output: "-" }, context);
    await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
  } else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec((route === "cli" ? `docx ${operation.split(".").join(" ")} /input ${operation === "controls.repeat" ? "--control 1 " : ""}--data-json '${JSON.stringify(records)}'` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`) + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/destination")).toEqual(retained); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(memory.statSync("/output").size).toBe(0); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
