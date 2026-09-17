import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textFixture, textContext, paragraph } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const scenario of ["empty", "package", "values"] as const)
it(`uses the contract BatchData for ${scenario} reads without creating parts; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture(paragraph("Coast record"), {}, strict));
  const enc = (value: string) => new TextEncoder().encode(value);
  parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/model": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const operations = scenario === "empty" ? [] : scenario === "package" ? [
    {operation: "model.opc.package.OpcPackage.open.call", arguments: {pkgFile: {kind: "bytes", base64: Buffer.from(input).toString("base64")}}, resultHandle: "package"},
    {operation: "model.opc.package.OpcPackage.parts.get", receiver: {resultHandle: "package"}, arguments: {}}
  ] : [
    {operation: "model.shared.Inches.call", arguments: {inches: 2}, resultHandle: "length"},
    {operation: "model.shared.Inches.emu.get", receiver: {resultHandle: "length"}, arguments: {}}
  ];
  const batch = {version: 1, operations}, sdk = await applyStyleModelBatch(input, batch, textContext);
  expect(sdk.affected).toBe(0); if (scenario === "package") expect(sdk.results.at(-1)!.value).toHaveLength(1); if (scenario === "values") expect(sdk.results.at(-1)!.value).toBe(1828800);
  await sdk.save({async write(bytes) {memory.appendFileSync("/model", bytes);}});
  expect(readPackage(new Uint8Array(memory.readFileSync("/model") as Buffer))).toEqual(parts);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
  const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
  const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stderr).toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(Object.keys(envelope).sort()).toEqual(["affected", "data", "errors", "locations", "ok", "operation", "version", "warnings"]);
  expect(envelope).toMatchObject({version: 1, operation: "batch", ok: true, affected: 0, errors: [], warnings: [], locations: []});
  expect(Object.keys(envelope.data).sort()).toEqual(["publication", "results"]); expect(envelope.data.publication).toBeNull();
  expect(envelope.data.results).toHaveLength(operations.length);
  for (const [index, item] of envelope.data.results.entries()) {
    expect(Object.keys(item).sort()).toEqual(["affected", "data", "errors", "locations", "ok", "operation", "version", "warnings"]);
    expect(item).toMatchObject({version: 1, operation: operations[index]!.operation, ok: true, affected: 0, warnings: [], errors: [], locations: []});
    expect(item.data).toEqual(sdk.results[index]!.value);
  }
  expect(await fs.readFile("/input")).toEqual(input); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  expect((await Document(input, textContext)).paragraphs[0]!.text).toBe("Coast record");
});
