import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { w, textContext, textFixture } from "../tests/fixtures/text.js";

const level = { level: 0, format: "decimal", text: "%1.", start: 1 };
const cases = [
 { label: "empty effect", args: {}, code: "usage" },
 { label: "empty levels", args: { levels: [] }, code: "usage" },
 { label: "duplicate level", args: { levels: [level, level] }, code: "usage" },
 { label: "negative level", args: { levels: [{ ...level, level: -1 }] }, code: "usage" },
 { label: "level nine", args: { levels: [{ ...level, level: 9 }] }, code: "usage" },
 { label: "negative start", args: { levels: [{ ...level, start: -1 }] }, code: "usage" },
 { label: "unsafe start", args: { levels: [{ ...level, start: Number.MAX_SAFE_INTEGER + 1 }] }, code: "usage" },
 { label: "self restart", args: { levels: [{ ...level, restartAfter: 0 }] }, code: "usage" },
 { label: "cyclic restart", args: { levels: [{ ...level, restartAfter: 1 }, { ...level, level: 1, restartAfter: 0 }] }, code: "usage" },
 { label: "inherited cyclic restart", args: { levels: [{ ...level, restartAfter: 1 }] }, code: "usage", second: '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlRestart w:val="1"/><w:lvlText w:val="%2."/></w:lvl>' },
 { label: "missing paragraph style", args: { levels: [{ ...level, paragraphStyle: "Missing" }] }, code: "usage" },
 { label: "missing numbering style", args: { numberingStyle: "Missing" }, code: "usage" },
 { label: "unknown format", args: { levels: [{ ...level, format: "chicago" }] }, code: "usage" },
 { label: "extra field", args: { levels: [{ ...level, unexpected: true }] }, code: "usage" },
 { label: "picture scheme", args: { levels: [{ ...level, start: 3 }] }, code: "unsupported-edit", extra: '<w:lvlPicBulletId w:val="1"/>' },
 { label: "missing abstract", args: { levels: [level] }, code: "unsupported-edit", reference: 99 },
 { label: "opaque property history", args: { levels: [{ ...level, start: 3 }] }, code: "unsupported-edit", history: '<w:pPrChange w:id="7" w:author="Reviewer"><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrChange>' }
] as const;
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell"] as const) for (const value of cases)
 it(`${route} rejects advanced list ${value.label} without publication; strict=${strict}`, async () => {
  const numbering = `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>${"extra" in value ? value.extra : ""}</w:lvl>${"second" in value ? value.second : ""}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="${"reference" in value ? value.reference : 7}"/></w:num></w:numbering>`, body = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${"history" in value ? value.history : ""}</w:pPr><w:r><w:t>Original</w:t></w:r></w:p>`, input = await textFixture(body, { numbering: { kind: "numbering", xml: numbering } }, strict), memory = Volume.fromJSON({ "/out": "" });
  const batch = { version: 1, operations: [{ operation: "paragraphs.get", arguments: { paragraph: 1 }, resultHandle: "owner" }, { operation: "lists.levels.set", receiver: { resultHandle: "owner" }, arguments: value.args }] };
  if (route === "model") await expect(api.applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: value.code });
  else if (route === "sdk") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: value.code });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(value.code === "usage" ? 2 : 1); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/out")).toHaveLength(0); } finally { await shell.dispose(); } }
  expect(memory.readFileSync("/out")).toHaveLength(0);
 });

it("bare restart syntax rejects without replacing the original document", async () => {
 const input = await textFixture('<w:p><w:r><w:t>Original</w:t></w:r></w:p>'), fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
 try { const result = await shell.exec('docx lists set /input --paragraph 1 --restart --start 3 --output - > /out'); expect(result.exitCode).toBe(2); expect(result.stderr).toContain("Invalid value for --restart"); expect(await fs.readFile("/out")).toHaveLength(0); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
});
