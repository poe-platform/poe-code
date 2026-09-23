import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const repeated of ["none", "id", "tag", "alias", "lock", "dataBinding", "showingPlcHdr"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`independent control metadata survives repeated ${repeated}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const api = route.startsWith("native") ? native : source, context = { signal: textContext.signal, limits: textContext.limits, encoding: { order: "input", compression: "store" } as const };
  const fields = { id: '<w:id w:val="7"/>', tag: '<w:tag w:val="Known 海🌊"/>', alias: '<w:alias w:val="Known alias"/>', lock: '<w:lock w:val="unlocked"/>', dataBinding: '<w:dataBinding w:storeItemID="known-store" w:xpath="/root/value" w:prefixMappings="xmlns:x=\'urn:known\'"/>', showingPlcHdr: '<w:showingPlcHdr><!--flag retained--><?audit flag?></w:showingPlcHdr>' };
  const properties = Object.entries(fields).map(([name, xml]) => xml + (name === repeated ? xml : "")).join("");
  const parts = readPackage(await textFixture(`<w:p><w:sdt><w:sdtPr><w:text/>${properties}</w:sdtPr><w:sdtContent><w:r><w:t>Known value</w:t></w:r></w:sdtContent></w:sdt></w:p><!--body retained-->`, {}, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), operations = [{ operation: "controls.list", arguments: { control: 1 } }];
  let snapshots: source.ControlReadData;
  if (route.includes("sdk")) {
    if (route.endsWith("batch")) { const result = await api.executeDocumentBatch(input, { version: 1, operations }, { dryRun: true }, context); expect(result.publication).toBeNull(); snapshots = result.results[0]!.data as source.ControlReadData; }
    else snapshots = await api.inspectDocumentControls(input, { control: 1 }, context);
    await expect(api.editDocumentControls(input, { control: 1, text: "Refused", output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  } else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops --dry-run" : "docx controls list /input --control 1") + " --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0); const envelope = JSON.parse(response.stdout); snapshots = route.endsWith("batch") ? envelope.data.results[0].data : envelope.data; expect(envelope).toMatchObject({ ok: true, errors: [], affected: 0 }); if (route.endsWith("batch")) expect(envelope.data.publication).toBeNull();
      const failure = await shell.exec("docx controls set /input --control 1 --text Refused --output /output --force --json"); expect(failure.exitCode).toBe(1); expect(JSON.parse(failure.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/output")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  expect(snapshots!.items).toHaveLength(1); expect(snapshots!.items[0]).toMatchObject({ kind: "plain-text", id: repeated === "id" ? null : "7", tag: repeated === "tag" ? null : "Known 海🌊", alias: repeated === "alias" ? null : "Known alias", lock: repeated === "lock" ? "unknown" : "unlocked", placeholder: repeated !== "showingPlcHdr", binding: repeated === "dataBinding" ? null : { storeItemId: "known-store", xpath: "/root/value", prefixMappings: "xmlns:x='urn:known'" }, value: "Known value", support: repeated === "none" ? "supported" : "unsupported", reason: repeated === "none" ? null : "Repeated control properties are unsupported." });
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts); expect(memory.statSync("/output").size).toBe(0);
});
