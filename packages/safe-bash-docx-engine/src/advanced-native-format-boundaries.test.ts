import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const invalid: readonly { label: string; operation: string; arguments: unknown }[] = [
 ...["", "not_a_tag", "en--US", "x", "en-abcdefghj"].map(value => ({ label: `language ${JSON.stringify(value)}`, operation: "runs.fonts.set", arguments: { language: { bidi: value } } })),
 ...["", "\n", "\t", "\u0000"].map(value => ({ label: `font ${JSON.stringify(value)}`, operation: "runs.fonts.set", arguments: { complexScript: value } })),
 { label: "invalid theme", operation: "runs.fonts.set", arguments: { theme: { ascii: "MajorBidi" } } },
 { label: "negative width", operation: "paragraphs.format.set", arguments: { borders: { top: { style: "single", width: { value: -1, unit: "pt" }, color: "224466" } } } },
 { label: "negative border space", operation: "paragraphs.format.set", arguments: { borders: { top: { style: "single", width: { value: 1, unit: "pt" }, color: "224466", space: { value: -1, unit: "pt" } } } } }
];
for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const) for (const value of invalid)
 it(`${route} rejects advanced ${value.label} before publication; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict), memory = Volume.fromJSON({ "/out": "" });
  const batch = { version: 1, operations: [{ operation: value.operation === "runs.fonts.set" ? "runs.get" : "paragraphs.get", arguments: value.operation === "runs.fonts.set" ? { paragraph: 1, run: 1 } : { paragraph: 1 }, resultHandle: "owner" }, { operation: value.operation, receiver: { resultHandle: "owner" }, arguments: value.arguments }] };
  if (route === "sdk") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "usage" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(2); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/out")).toHaveLength(0); } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/out")).toHaveLength(0);
 });

for (const strict of [false, true]) for (const operation of ["paragraphs.format.set", "runs.fonts.set"] as const)
 for (const guard of ["history", "range"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} refuses unsupported ${guard} in advanced ${operation} without publication; strict=${strict}`, async () => {
  const history = '<w:pPrChange w:id="7" w:author="Reviewer"><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrChange>', p = `<w:p><w:pPr>${guard === "history" ? history : ""}</w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Original</w:t></w:r></w:p>`;
  const input = await textFixture(guard === "range" ? '<w:moveFromRangeStart w:id="7" w:name="Review"/>' + p + '<w:moveFromRangeEnd w:id="7"/>' : p, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  const isRun = operation === "runs.fonts.set", batch = { version: 1, operations: [{ operation: isRun ? "runs.get" : "paragraphs.get", arguments: isRun ? { paragraph: 1, run: 1 } : { paragraph: 1 }, resultHandle: "owner" }, { operation, receiver: { resultHandle: "owner" }, arguments: isRun ? { ascii: "New font" } : { shading: { fill: "224466", pattern: "clear" } } }] };
  if (route === "sdk") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/out")).toHaveLength(0); } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/out")).toHaveLength(0);
 });
