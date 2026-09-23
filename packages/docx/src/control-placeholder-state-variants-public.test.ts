import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime, encode = (value: string) => new TextEncoder().encode(value);
const states = [
  { name: "absent", flag: "", placeholder: false },
  { name: "implicit true", flag: '<w:showingPlcHdr><!--flag retain--><?audit   flag exact  ?></w:showingPlcHdr>', placeholder: true },
  ...["0", "false", "off", "1", "true", "on", " 0 ", "\ttrue\n"].map(value => ({ name: JSON.stringify(value), flag: `<w:showingPlcHdr w:val="${value}" xml:lang="cy"><!--flag retain--><?audit   flag exact  ?></w:showingPlcHdr>`, placeholder: ["1", "true", "on", "\ttrue\n"].includes(value) })),
  ...["unknown", " on ", "\u00a0false\u00a0"].map(value => ({ name: `malformed ${JSON.stringify(value)}`, flag: `<w:showingPlcHdr w:val="${value}"><!--flag retain--><?audit   flag exact  ?></w:showingPlcHdr>`, placeholder: false, unsupported: true }))
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
for (const operation of ["read", "fill", "empty-repeat", "empty-template"] as const) for (const state of states)
it(`placeholder boolean state ${state.name}; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; operation=${operation}`, async () => {
  const product: typeof api = runtime === "native" ? native : api, context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const field = (type: string, tag: string, id: number) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:tag w:val="${tag}"/><w:${type}/>${state.flag}<w:placeholder><w:docPart w:val="Retained definition"/></w:placeholder></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Original 海🌊</w:t></w:r></w:sdtContent></w:sdt>`;
  const fields = field("text", "plain", 3) + field("richText", "rich", 4);
  const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><w:tag w:val="records"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${fields}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Outside {{plain}}</w:t></w:r></w:p>' + (operation.startsWith("empty") ? region : `<w:p>${fields}</w:p>`) + '<!--body retain--><?audit body?>', {}, strict, { kind }));
  const decoding = codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be";
  if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), unsupported = "unsupported" in state;
  const operationId = operation === "read" ? "controls.list" : operation === "fill" ? "controls.set" : operation === "empty-repeat" ? "controls.repeat" : "template.apply";
  const arguments_ = operation === "read" ? {} : operation === "fill" ? { all: true, text: "Filled 海🌊" } : operation === "empty-repeat" ? { control: 1, data: [] } : { data: [] };
  const batch = { version: 1, operations: [{ operation: operationId, arguments: arguments_ }] };
  let result: api.ControlReadData | undefined;
  const rejected = operation !== "read" && unsupported;
  if (route.startsWith("sdk")) {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route === "sdk-batch" ? product.executeDocumentBatch(input, batch, operation === "read" ? { dryRun: true } : { output: "-" }, io) : operation === "read" ? product.inspectDocumentControls(input, {}, io) : operation === "fill" ? product.editDocumentControls(input, { all: true, text: "Filled 海🌊", output: "-" }, io) : operation === "empty-repeat" ? product.editDocumentControlRepeats(input, { control: 1, data: [], output: "-" }, io) : product.applyDocumentTemplate(input, { data: [], output: "-" }, io);
    if (rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
    else { const value = await pending; if (operation === "read") result = route === "sdk-batch" ? (value as { results: readonly { data: unknown }[] }).results[0]!.data as api.ControlReadData : value as api.ControlReadData; }
  } else {
    const fs = new MemoryFileSystem(), retained = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", retained); await fs.writeFile("/ops", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const flags = operation === "read" ? "" : operation === "fill" ? "--all --text 'Filled 海🌊'" : operation === "empty-repeat" ? "--control 1 --data-json '[]'" : "--data-json '[]'";
      const response = await shell.exec((route === "cli-batch" ? "docx batch /input --ops-file /ops" : `docx ${operationId.split(".").join(" ")} /input ${flags}`) + (operation === "read" ? (route === "cli-batch" ? " --dry-run" : "") : " --output /output --force") + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(rejected ? 1 : 0);
      const envelope = JSON.parse(response.stdout);
      if (rejected) expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
      else if (operation === "read") result = route === "cli-batch" ? envelope.data.results[0].data : envelope.data;
      else memory.writeFileSync("/output", await fs.readFile("/output"));
      if (operation === "read" || rejected) expect(await fs.readFile("/output")).toEqual(retained);
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
  if (operation === "read") { expect(memory.statSync("/output").size).toBe(0); expect(result!.items).toHaveLength(2); for (const item of result!.items) expect(item).toMatchObject({ placeholder: state.placeholder, support: unsupported ? "unsupported" : "supported", reason: unsupported ? expect.any(String) : null }); return; }
  if (rejected) { expect(memory.statSync("/output").size).toBe(0); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect([...after.keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder(decoding, { fatal: true }).decode(after.get("word/document.xml")!);
  if (codec !== "utf8") expect([...after.get("word/document.xml")!.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]);
  if (state.flag) { expect(xml.split("<!--flag retain-->")).toHaveLength(3); expect(xml.split("<?audit   flag exact  ?>")).toHaveLength(3); }
  expect(xml).toContain("Retained definition"); expect(xml).toContain("<!--body retain--><?audit body?>");
  const items = (await product.inspectDocumentControls(output, {}, context)).items.filter(item => ["plain", "rich"].includes(item.tag ?? ""));
  expect(items).toHaveLength(2); for (const item of items) expect(item).toMatchObject({ placeholder: operation !== "fill", value: operation === "fill" ? "Filled 海🌊" : "", support: "supported" });
  if (operation !== "fill") {
    const refill = Volume.fromJSON({ "/refill": "" }); await product.editDocumentControlRepeats(output, { control: 1, data: [{ values: [{ binding: "plain", value: "Refilled 海🌊" }, { binding: "rich", value: "Refilled rich" }] }], output: "-" }, { ...context, stdout: { async write(bytes) { refill.appendFileSync("/refill", bytes); } } });
    const values = (await product.inspectDocumentControls(new Uint8Array(refill.readFileSync("/refill") as Buffer), {}, context)).items.filter(item => ["plain", "rich"].includes(item.tag ?? "")); expect(values.map(item => ({ value: item.value, placeholder: item.placeholder }))).toEqual([{ value: "Refilled 海🌊", placeholder: false }, { value: "Refilled rich", placeholder: false }]);
  }
});
