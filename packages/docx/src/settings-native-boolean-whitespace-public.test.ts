import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
const states = [
  ...["true", "1", "on"].map(raw => ({ raw, value: true })),
  ...["false", "0", "off"].map(raw => ({ raw, value: false })),
  ...["true", "1", "false", "0"].map(raw => ({ raw: ` &#x9;${raw}&#xA; `, value: raw === "true" || raw === "1" })),
  ...[" on ", " off ", "\u00a01\u00a0", "unknown"].map(raw => ({ raw, value: null })),
  { raw: null, value: true }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const state of states)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`native settings boolean whitespace ${JSON.stringify(state.raw)}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const api = (route.startsWith("native") ? native : source) as typeof source;
  const context = { signal: textContext.signal, limits: textContext.limits, encoding: { order: "input", compression: "store" } as const };
  const flags = ["embedTrueTypeFonts", "embedSystemFonts", "saveSubsetFonts", "updateFields"];
  const settings = `<w:settings xmlns:w="${w}">${flags.map(name => `<w:${name}${state.raw === null ? "" : ` w:val="${state.raw}"`}/>`).join("")}<!--retained 海🌊--><?audit exact?></w:settings>`;
  const parts = readPackage(await textFixture("<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>", { settings: { kind: "settings", xml: settings } }, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const operations = [{ operation: "settings.list", arguments: {} }];
  let data: source.SettingsResourceListData;
  if (route.includes("sdk")) {
    data = route.endsWith("batch") ? (await api.executeDocumentBatch(input, { version: 1, operations }, { dryRun: true }, context)).results[0]!.data as source.SettingsResourceListData : await api.inspectDocumentSettings(input, {}, context, "resource");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops --dry-run" : "docx settings list /input") + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const envelope = JSON.parse(response.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [] });
      data = route.endsWith("batch") ? envelope.data.results[0].data : envelope.data;
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(data.items).toHaveLength(1); expect(Object.hasOwn(data.items[0]!, "details")).toBe(false);
  for (const name of flags) expect(data.items[0]!.properties).toContainEqual({ name, type: "boolean", value: state.value, writable: false, cached: false });
  const snapshot = await api.inspectDocumentSettings(input, {}, context);
  expect(snapshot.items[0]!.details).toMatchObject({ updateFields: state.value, fontEmbedding: { embedTrueTypeFonts: state.value, embedSystemFonts: state.value, saveSubsetFonts: state.value } });
  const document = await api.Document(input, context);
  await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(original);
  expect(readPackage(input)).toEqual(parts); expect(input).toEqual(original);
});
