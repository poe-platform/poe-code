import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model-sdk", "sdk", "cli"] as const)
for (const variant of ["null-string", "unknown-argument", "unknown-operation", "missing-receiver"] as const)
it(`reports the failing schema step before staging; strict=${strict}; kind=${kind}; route=${route}; variant=${variant}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Unrelated 海🌊</w:t></w:r></w:p>', {}, strict, { kind });
  const invalid = { id: "invalidScalar", operation: variant === "unknown-operation" ? "model.opc.coreprops.CoreProperties.unlisted.set" : "model.opc.coreprops.CoreProperties.subject.set", ...(variant === "missing-receiver" ? {} : { receiver: ref("core") }), arguments: variant === "null-string" ? { value: null } : variant === "unknown-argument" ? { value: "Title", unlisted: true } : { value: "Title" } };
  const batch = { version: 1 as const, operations: [{ operation: "model.document.Document.core_properties.get", receiver: ref("document"), arguments: {}, resultHandle: "core" }, { operation: "model.opc.coreprops.CoreProperties.title.set", receiver: ref("core"), arguments: { value: "Staged title" } }, invalid] };
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/destination": "Retained destination" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/destination", bytes); } }, context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: sink };
  if (route === "model-sdk") await expect(api.applyStyleModelBatch(input, batch, context)).rejects.toMatchObject({ code: "usage", operationIndex: 2 });
  else if (route === "sdk") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, context)).rejects.toMatchObject({ code: "usage", operationIndex: 2 });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /destination --force --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(2); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage", operationIndex: 2 }] }); expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained destination"); } finally { await shell.dispose(); } }
  expect(memory.readFileSync("/destination", "utf8")).toBe("Retained destination"); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
