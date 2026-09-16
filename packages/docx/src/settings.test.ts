import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";

const metadata = '<w:compat><w:compatSetting w:name="layoutMode" w:uri="urn:original:layout" w:val="15"/></w:compat><w:updateFields w:val="false"/><w:embedTrueTypeFonts/><w:saveSubsetFonts w:val="0"/><x:future x:value="retain"/>';
const settingsXml = (body: string) => `<w:settings xmlns:w="${w}" xmlns:x="urn:original:future" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x">${body}</w:settings>`;
const fixture = (body = metadata, strict = false) => textFixture(paragraph("coast"), { settings: { kind: "settings", xml: settingsXml(body) } }, strict);

it.each([false, true])("reads stored settings without creating parts in dialect %s", async strict => {
  const input = await fixture(metadata, strict);
  const data = await docx.inspectDocumentSettings(input, {}, textContext);
  expect(data.items).toHaveLength(1);
  expect(data.items[0]!.details.updateFields).toBe(false);
  expect(data.items[0]!.details.fontEmbedding).toEqual({ embedTrueTypeFonts: true, embedSystemFonts: null, saveSubsetFonts: false });
  expect(data.items[0]!.details.entries.find(entry => entry.localName === "compatSetting")!.attributes).toContainEqual(expect.objectContaining({ localName: "val", value: "15" }));
  expect(data.items[0]!.details.entries.find(entry => entry.localName === "future")!.status).toBe("opaque");
  expect(await docx.inspectDocumentSettings(await textFixture(paragraph("plain")), {}, textContext)).toEqual({ items: [] });
});

it("exposes protection state without password material", async () => {
  const data = await docx.inspectDocumentSettings(await fixture('<w:documentProtection w:edit="readOnly" w:enforcement="1" w:hash="secret-hash" w:salt="secret-salt"/><w:writeProtection w:recommended="1" w:password="secret-password"/>'), {}, textContext);
  expect(data.items[0]!.details.protection).toEqual([{ kind: "documentProtection", enforced: true, edit: "readOnly" }, { kind: "writeProtection", enforced: true, edit: null }]);
  expect(JSON.stringify(data)).not.toContain("secret-");
});

it("executes settings list through the common command contract", async () => {
  const input = await fixture(), volume = Volume.fromJSON({ "/out": "", "/err": "" });
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["settings", "list", "/input", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal, filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
  expect(result.exitCode).toBe(0);
  const resultJson = JSON.parse(String(volume.readFileSync("/out", "utf8")));
  expect(resultJson.data).toEqual(await docx.inspectDocumentSettings(input, {}, textContext));
  const schema = docx.getDocxDiscovery(docx.parseDocxArguments(["schema"].map(value => new TextEncoder().encode(value))))!.data;
  expect("operations" in schema && schema.operations.find(item => item.id === "settings.list")?.support).toBe("read");
});

it("preserves all settings bytes during ordinary text edits", async () => {
  const input = await fixture(), volume = Volume.fromJSON({ "/out": "" });
  await docx.replaceDocumentText(input, { find: "coast", with: "shore", all: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect(await docx.getDocumentXml(output, textContext, { part: "/word/settings.xml", raw: true })).toEqual(await docx.getDocumentXml(input, textContext, { part: "/word/settings.xml", raw: true }));
});

it("permits only an explicit boolean field-update change in raw settings", async () => {
  const input = await fixture();
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const } };
  await expect(docx.replaceDocumentXmlPart(input, new TextEncoder().encode(settingsXml(metadata.replace('w:val="false"', 'w:val="true"'))), { part: "/word/settings.xml", dryRun: true }, context)).resolves.toMatchObject({ changed: true });
  for (const changed of [metadata.replace("embedTrueTypeFonts", "embedSystemFonts"), metadata.replace('w:val="15"', 'w:val="16"'), metadata.replace('w:val="false"', 'w:val="maybe"')]) {
    await expect(docx.replaceDocumentXmlPart(input, new TextEncoder().encode(settingsXml(changed)), { part: "/word/settings.xml", dryRun: true }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  }
});

it.each(['<w:documentProtection w:enforcement="1" w:edit="readOnly"/>', '<w:documentProtection w:enforcement="unknown"/>', '<w:writeProtection/>'])("refuses protected package edits before any output for %s", async protection => {
  const input = await fixture(protection), writes: Uint8Array[] = [];
  await expect(docx.replaceDocumentText(input, { find: "coast", with: "shore", all: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { writes.push(bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(writes).toEqual([]);
});

it("rejects story selectors on package-global settings", async () => {
  const input = await fixture(), data = await docx.inspectDocumentSettings(input, {}, textContext);
  await expect(docx.inspectDocumentSettings(input, { select: data.items[0]!.location.token } as never, textContext)).rejects.toMatchObject({ code: "usage" });
  await expect(docx.inspectDocumentSettings(input, { paragraph: 1 } as never, textContext)).rejects.toMatchObject({ code: "usage" });
});

it("advertises the bounded settings and rights profile", () => {
  const data = docx.getDocxDiscovery(docx.parseDocxArguments(["capabilities"].map(value => new TextEncoder().encode(value))))!.data;
  expect(data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F42", level: "read", subsets: expect.arrayContaining([expect.objectContaining({ name: "settings-and-protection" })]) })]) });
});

it("distinguishes opaque native settings and unsupported boolean metadata", async () => {
  const data = await docx.inspectDocumentSettings(await fixture('<w:futureSetting w:val="retain"/><w:updateFields x:mode="unknown" w:val="1"/>'), {}, textContext);
  expect(data.items[0]!.details.entries.map(entry => entry.status)).toEqual(["opaque", "opaque"]);
  expect(data.items[0]!.details.updateFields).toBe(null);
});

it("reports stored field-update and embedding values in human output", async () => {
  const { executeSettingsCommand } = await import("./settings-command.js");
  const output = await executeSettingsCommand(docx.parseDocxArguments(["settings", "list", "input"].map(value => new TextEncoder().encode(value))), await fixture(), textContext);
  expect(new TextDecoder().decode(output)).toContain("Field updates: false");
  expect(new TextDecoder().decode(output)).toContain("embedTrueTypeFonts: true");
});

it("advertises only applicable global settings options", () => {
  const help = docx.getDocxDiscovery(docx.parseDocxArguments(["settings", "list", "--help"].map(value => new TextEncoder().encode(value))))!;
  expect(help.human).not.toContain("--paragraph");
  expect(help.human).not.toContain("--select");
  const schema = docx.getDocxOperationSchema("settings.list");
  expect(schema.properties?.select).toBeUndefined();
});
