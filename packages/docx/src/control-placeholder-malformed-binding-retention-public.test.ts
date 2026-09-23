import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const run = '<w:r><w:t>海🌊</w:t><w:tab/><w:t>Bay</w:t><w:br/><w:t>Next</w:t></w:r>';
const control = (properties: string, content = run) => `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const expectedKeys = ["location", "kind", "id", "tag", "alias", "lock", "placeholder", "binding", "value", "choices", "support", "reason"].sort();
const rows: (Partial<Omit<api.ControlSnapshot, "location" | "kind" | "value">> & {
  properties: string; content?: string; unsupported?: boolean;
  kind: string; value: api.ControlSnapshot["value"];
})[] = [
  ...["unknown", " on ", "\u00a0false\u00a0"].map(state => ({ properties: `<w:text/><w:id w:val="7"/><w:tag w:val="Exact海"/><w:alias w:val="Alias"/><w:lock w:val="contentLocked"/><w:showingPlcHdr w:val="${state}"/><w:dataBinding w:storeItemID="retained-store" w:xpath="/root/value" w:prefixMappings="xmlns:x='urn:retained'"/>`, kind: "plain-text", id: "7", tag: "Exact海", alias: "Alias", lock: "contentLocked", placeholder: false, binding: { storeItemId: "retained-store", xpath: "/root/value", prefixMappings: "xmlns:x='urn:retained'" }, value: "海🌊\tBay\nNext", unsupported: true }))
];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`malformed placeholder snapshots retain independently readable binding metadata; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const product = route.startsWith("native") ? native : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const bodyRows = rows;
  const parts = readPackage(await textFixture(bodyRows.map(row => `<w:p>${control(row.properties, row.content)}</w:p>`).join(""), {}, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/publication": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const operations = [{ operation: "controls.list" as const, arguments: {} }];
  let result: api.ControlReadData;
  if (route.endsWith("sdk")) result = await product.inspectDocumentControls(input, {}, context);
  else if (route.endsWith("sdk-batch")) {
    const batch = await product.executeDocumentBatch(input, { version: 1, operations }, { dryRun: true }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/publication", bytes); } } });
    expect(batch.publication).toBeNull(); result = batch.results[0]!.data as api.ControlReadData;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/retained", encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const command = route.endsWith("cli-batch") ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json` : "docx controls list /input --json";
      const response = await shell.exec(command); expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const envelope = JSON.parse(response.stdout); expect(envelope.ok).toBe(true);
      result = route.endsWith("cli-batch") ? envelope.data.results[0].data : envelope.data;
      if (route.endsWith("cli-batch")) expect(envelope.data.publication).toBeNull();
      const missingRoute = await shell.exec("docx controls get /input --control 1 --json");
      expect(missingRoute.exitCode).toBe(2); expect(JSON.parse(missingRoute.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/retained")).toEqual(encode("Retained destination"));
    } finally { await shell.dispose(); }
  }
  expect(Object.keys(result!)).toEqual(["items"]); expect(result!.items).toHaveLength(rows.length);
  for (const [index, snapshot] of result!.items.entries()) {
    const row = rows[index]!;
    expect(Object.keys(snapshot).sort()).toEqual(expectedKeys);
    const { properties: ignoredProperties, content: ignoredContent, unsupported, ...values } = row;
    expect(snapshot).toMatchObject({ id: null, tag: null, alias: null, lock: "unlocked", placeholder: false, binding: null, choices: [], ...values, support: unsupported ? "unsupported" : "supported", reason: unsupported ? expect.any(String) : null });
    if (unsupported) expect(snapshot.reason!.length).toBeGreaterThan(0);
    expect(snapshot.location).toMatchObject({ kind: "control", positions: { control: index + 1 }, value: { part: "/word/document.xml", generation: 0, range: null } });
    expect(snapshot.location.token.length).toBeGreaterThan(0);
  }
  const selected = await product.inspectDocumentControls(input, { control: 3 }, context);
  expect(selected.items).toEqual([result!.items[2]]);
  expect(memory.statSync("/publication").size).toBe(0); expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
});
