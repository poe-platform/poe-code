import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const paragraphs = { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" };
const paragraphText = { operation: "model.text.paragraph.Paragraph.text.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {} };
const read = { operation: "text.get", arguments: {} };
const length = { operation: "model.shared.Inches.call", arguments: { inches: 2 } };
const scenarios: { name: string; operations?: unknown[]; success?: "empty" | "text" | "length"; missing?: boolean }[] = [
  { name: "empty value-only batch", operations: [], success: "empty" },
  { name: "generated utility ID", operations: [read], success: "text" },
  { name: "64-character utility ID", operations: [{ ...read, id: "A".repeat(64) }], success: "text" },
  { name: "hyphenated utility ID", operations: [{ ...read, id: "Survey-1_a" }], success: "text" },
  { name: "100-character result handle", operations: [{ ...length, resultHandle: "A".repeat(100) }], success: "length" },
  { name: "underscore result handle", operations: [{ ...length, resultHandle: "Length_2" }], success: "length" },
  { name: "declared collection index", operations: [paragraphs, paragraphText], success: "text" },
  { name: "absent operations", missing: true },
  ...["", "1First", "First\n", "First\r\n", "First 海", "First\0", "A".repeat(65)].map(id => ({ name: `invalid utility ID ${JSON.stringify(id)}`, operations: [{ ...read, id }] })),
  { name: "duplicate explicit utility ID", operations: [{ ...read, id: "same" }, { ...read, id: "same" }] },
  { name: "generated utility ID collision", operations: [read, { ...read, id: "step1" }] },
  ...["", "1First", "First\n", "First\r\n", "First 海", "First\0", "First-hyphen"].map(resultHandle => ({ name: `invalid result handle ${JSON.stringify(resultHandle)}`, operations: [{ ...length, resultHandle }] })),
  { name: "reserved document handle", operations: [{ ...length, resultHandle: "document" }] },
  { name: "duplicate result handle", operations: [paragraphs, { ...length, resultHandle: "paragraphs" }] },
  { name: "forward receiver handle", operations: [paragraphText, paragraphs] },
  { name: "wrong receiver type", operations: [paragraphs, { ...paragraphText, operation: "model.text.run.Run.text.get" }] },
  { name: "collection key and index together", operations: [paragraphs, { ...paragraphText, receiver: { resultHandle: "paragraphs", index: 0, key: "title" } }] },
  { name: "undeclared collection key", operations: [paragraphs, { ...paragraphText, receiver: { resultHandle: "paragraphs", key: "title" } }] },
  { name: "void setter result binding", operations: [paragraphs, { ...paragraphText, operation: "model.text.paragraph.Paragraph.text.set", arguments: { value: "Staged" }, resultHandle: "voidValue" }] },
  { name: "recursive batch", operations: [{ operation: "batch", arguments: { version: 1, operations: [] } }] },
  { name: "document creation item", operations: [{ operation: "create", arguments: {} }] },
  { name: "discovery item", operations: [{ operation: "schema", arguments: {} }] },
  { name: "arbitrary method dispatch", operations: [{ operation: "model.document.Document.constructor.call", receiver: { resultHandle: "document" }, arguments: {} }] },
  { name: "evaluation item", operations: [{ operation: "eval", arguments: { source: "Forbidden" } }] },
  ...["output", "inPlace", "force", "json", "dryRun", "limit"].map(key => ({ name: `item ${key} publication/context`, operations: [{ ...read, arguments: { [key]: key === "output" ? "/destination" : key === "limit" ? [] : true } }] }))
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli"] as const) for (const scenario of scenarios)
it(`ordered public batch boundary ${scenario.name}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const input = await textFixture('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Retained海🌊</w:t></w:r></w:p><!--retain--><?audit exact?>', {}, strict, { kind });
  const before = readPackage(input), destination = encode("Retained destination"), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/destination": Buffer.from(destination) });
  const batch = scenario.missing ? { version: 1 } : { version: 1, operations: scenario.operations };
  let data: api.DocumentBatchData | undefined, writes = 0;
  if (route === "sdk") {
    const result = api.executeDocumentBatch(input, batch, scenario.success ? {} : { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { writes++; memory.appendFileSync("/destination", bytes); } } });
    if (scenario.success) data = await result;
    else await expect(result).rejects.toMatchObject({ code: "usage" });
    expect(writes).toBe(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations " + (scenario.success ? "" : "--output /destination --force ") + "--json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(scenario.success ? 0 : 2);
      const envelope = JSON.parse(result.stdout);
      if (scenario.success) { expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] }); data = envelope.data; }
      else expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "usage" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  if (data) {
    expect(data.publication).toBeNull(); expect(data.results).toHaveLength(scenario.operations!.length);
    if (scenario.success === "empty") expect(data.results).toEqual([]);
    else if (scenario.success === "text") {
      if (scenario.operations!.length === 1) {
        expect(data.results[0]).toMatchObject({ id: (scenario.operations![0] as { id?: string }).id ?? "step1", affected: 0, data: { text: "Retained海🌊" } });
      } else expect(data.results.at(-1)).toMatchObject({ affected: 0, data: "Retained海🌊" });
    } else expect(data.results[0]).toMatchObject({ affected: 0, data: { value: 1828800, unit: "emu" } });
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(readPackage(input)).toEqual(before);
  expect(new Uint8Array(memory.readFileSync("/destination") as Buffer)).toEqual(destination);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const variant of ["envelope-prototype", "item-prototype", "arguments-prototype", "operations-hole", "envelope-accessor", "item-accessor", "arguments-accessor"] as const)
it(`ordered SDK batch rejects non-JSON ${variant} without invoking callbacks; strict=${strict}; kind=${kind}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', {}, strict, { kind });
  const original = new Uint8Array(input), memory = Volume.fromJSON({ "/output": "" });
  let evaluations = 0;
  const batch = { version: 1, operations: [{ ...read, arguments: {} }] };
  const item = batch.operations[0]!, getter = () => { evaluations++; return "Forbidden"; };
  if (variant === "envelope-prototype") Object.setPrototypeOf(batch, { inherited: true });
  if (variant === "item-prototype") Object.setPrototypeOf(item, { inherited: true });
  if (variant === "arguments-prototype") Object.setPrototypeOf(item.arguments, { inherited: true });
  if (variant === "operations-hole") delete (batch.operations as (typeof item | undefined)[])[0];
  if (variant === "envelope-accessor") Object.defineProperty(batch, "version", { enumerable: true, get: getter });
  if (variant === "item-accessor") Object.defineProperty(item, "operation", { enumerable: true, get: getter });
  if (variant === "arguments-accessor") Object.defineProperty(item.arguments, "view", { enumerable: true, get: getter });
  await expect(api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "usage" });
  expect(evaluations).toBe(0); expect(memory.statSync("/output").size).toBe(0); expect(input).toEqual(original);
});
