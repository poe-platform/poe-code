import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as source from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const state of [
  ...["true", "1", "false", "0"].map(raw => ({ raw: ` &#x9;${raw}&#xA; `, value: raw === "true" || raw === "1" })),
  { raw: "false", value: false }, { raw: "1", value: true }, { raw: "\u00a01\u00a0", value: null }, { raw: "unknown", value: null }
])
for (const runtime of ["source", "native"] as const)
for (const route of ["inspect-sdk", "inspect-cli", "settings-sdk", "settings-cli", "settings-sdk-batch", "settings-cli-batch"] as const)
it(`native protection boolean whitespace ${JSON.stringify(state.raw)}; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}`, async () => {
  const api = (runtime === "native" ? native : source) as typeof source;
  const context = { signal: textContext.signal, limits: textContext.limits, encoding: { order: "input", compression: "store" } as const };
  const settings = `<w:settings xmlns:w="${w}"><w:documentProtection w:edit="readOnly" w:enforcement="${state.raw}" w:hash="private-hash" w:salt="private-salt"/><!--retained 海🌊--><?audit exact?></w:settings>`;
  const parts = readPackage(await textFixture("<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>", { settings: { kind: "settings", xml: settings } }, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), inspection = route.startsWith("inspect");
  const operations = [{ operation: "settings.list", arguments: {} }];
  let data: unknown;
  if (route.includes("sdk")) data = inspection ? await api.inspectDocument(input, context) : route.endsWith("batch") ? (await api.executeDocumentBatch(input, { version: 1, operations }, { dryRun: true }, context)).results[0]!.data : await api.inspectDocumentSettings(input, {}, context, "resource");
  else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec((inspection ? "docx inspect /input" : route.endsWith("batch") ? "docx batch /input --ops-file /ops --dry-run" : "docx settings list /input") + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0); const envelope = JSON.parse(response.stdout); data = route.endsWith("batch") ? envelope.data.results[0].data : envelope.data;
      const failure = await shell.exec("docx text replace /input --find Retained --with Changed --first --output /output --force --json");
      expect(failure.exitCode).toBe(1); expect(JSON.parse(failure.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/output")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  if (inspection) expect(data).toMatchObject({ protected: state.value !== false, protection: [{ part: "/word/settings.xml", kind: "documentProtection", enforced: state.value, edit: "readOnly" }] });
  else expect(data).toMatchObject({ items: [{ properties: expect.arrayContaining([{ name: "protection[0].enforced", type: "boolean", value: state.value, writable: false, cached: false }]) }] });
  expect(JSON.stringify(data)).not.toContain("private-");
  expect((await api.inspectDocumentSettings(input, {}, context)).items[0]!.details.protection).toEqual([{ kind: "documentProtection", enforced: state.value, edit: "readOnly" }]);
  await expect(api.replaceDocumentText(input, { find: "Retained", with: "Changed", first: true, output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  const document = await api.Document(input, context);
  await expect(document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(memory.statSync("/output").size).toBe(0); expect(readPackage(input)).toEqual(parts); expect(input).toEqual(original);
});
