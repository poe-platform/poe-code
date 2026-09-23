import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const ref = (resultHandle: string) => ({ resultHandle });
function xmlBytes(value: string, codec: "UTF-8" | "UTF-16LE" | "UTF-16BE") {
  if (codec === "UTF-8") return new TextEncoder().encode(value);
  const bytes = new Uint8Array(2 + value.length * 2), view = new DataView(bytes.buffer);
  bytes.set(codec === "UTF-16LE" ? [255, 254] : [254, 255]);
  for (let index = 0; index < value.length; index++) view.setUint16(2 + index * 2, value.charCodeAt(index), codec === "UTF-16LE");
  return bytes;
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["UTF-8", "UTF-16LE", "UTF-16BE"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`retains six original supplied settings children and explicitly authored default asset boundary; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const markup = `<q:settings xmlns:q="${namespace}"><q:zoom q:percent="110"/><q:defaultTabStop q:val="480"/><q:characterSpacingControl q:val="doNotCompress"/><q:compat/><q:updateFields q:val="false"/><q:embedTrueTypeFonts q:val="false"/><!--six retained--><?audit exact?></q:settings>`;
  const supplied = xmlBytes(markup, codec), input = await textFixture('<w:p><w:r><w:t>Unchanged 海🌊</w:t></w:r></w:p>', {}, strict, { kind });
  const before = readPackage(input), memory = Volume.fromJSON({ "/input": "", "/output": "" }); memory.writeFileSync("/input", input);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "owner" },
    { operation: "model.parts.settings.SettingsPart.default.call", arguments: { ownerPackage: ref("owner") }, resultHandle: "originalDefault" },
    { operation: "model.parts.settings.SettingsPart.element.get", receiver: ref("originalDefault"), arguments: {}, resultHandle: "defaultElement" },
    { operation: "model.XmlElementView.serialize.call", receiver: ref("defaultElement"), arguments: {} },
    { operation: "model.parts.settings.SettingsPart.load.call", arguments: { partname: "/supplied/settings.xml", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml", blob: { kind: "bytes", base64: Buffer.from(supplied).toString("base64") }, ownerPackage: ref("owner") }, resultHandle: "supplied" },
    { operation: "model.parts.settings.SettingsPart.element.get", receiver: ref("supplied"), arguments: {}, resultHandle: "suppliedElement" },
    { operation: "model.XmlElementView.serialize.call", receiver: ref("suppliedElement"), arguments: {} },
    { operation: "model.parts.settings.SettingsPart.settings.get", receiver: ref("supplied"), arguments: {}, resultHandle: "settings" },
    { operation: "model.settings.Settings.odd_and_even_pages_header_footer.get", receiver: ref("settings"), arguments: {} },
    { operation: "model.parts.settings.SettingsPart.package.get", receiver: ref("supplied"), arguments: {} },
    { operation: "model.parts.settings.SettingsPart.blob.get", receiver: ref("supplied"), arguments: {} }
  ];
  const observe = (values: unknown[]) => {
    expect(values[2]).toMatchObject({ type: "SettingsPart" });
    const encoded = values[4] as { base64: string }, root = xmlStructure(Buffer.from(encoded.base64, "base64"));
    const element = root.children.find(value => typeof value !== "string"); expect(element).toMatchObject({ name: `{${namespace}}settings`, children: [] });
    const serialized = values[7] as { base64: string };
    expect(xmlStructure(Buffer.from(serialized.base64, "base64"))).toEqual(xmlStructure(new TextEncoder().encode(markup)));
    expect(values[11]).toEqual({ kind: "bytes", base64: Buffer.from(supplied).toString("base64") }); expect(values[9]).toBe(false); expect(values[10]).toEqual(values[1]);
  };
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, textContext), owner = document.part.package, originalDefault = api.SettingsPart.default(owner);
    expect(originalDefault).toBeInstanceOf(api.SettingsPart); expect(originalDefault.package).toBe(owner); expect(originalDefault.element.tag.namespaceURI).toBe(namespace); expect(originalDefault.element.tag.localName).toBe("settings");
    const root = xmlStructure(originalDefault.element.serialize()).children.find(value => typeof value !== "string"); expect(root).toMatchObject({ name: `{${namespace}}settings`, children: [] });
    const pending = api.SettingsPart.load("/supplied/settings.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml", supplied, owner); expect(pending).toBeInstanceOf(Promise);
    const part = await pending; expect(part).toBeInstanceOf(api.SettingsPart); expect(part.package).toBe(owner); expect(part.blob).toEqual(supplied); expect(part.settings.part).toBe(part); expect(part.settings.odd_and_even_pages_header_footer).toBe(false);
    expect(xmlStructure(part.element.serialize())).toEqual(xmlStructure(new TextEncoder().encode(markup)));
    expect(xmlStructure(part.settings.element.serialize())).toEqual(xmlStructure(new TextEncoder().encode(markup))); await document.save(sink);
  } else if (route === "sdk") { const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); observe(batch.results.map(result => result.value)); await batch.save(sink); }
  else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /operations --output /output --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0); observe(JSON.parse(response.stdout).data.results.map((result: { data: unknown }) => result.data)); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output", await fs.readFile("/output")); } finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  expect(after.get("supplied/settings.xml")).toEqual(supplied); const suppliedRoot = xmlStructure(new TextEncoder().encode(markup)).children.find(value => typeof value !== "string"); if (!suppliedRoot || typeof suppliedRoot === "string") throw new Error("Missing native settings root");
  expect(suppliedRoot.children.filter(value => typeof value !== "string" && value.name.startsWith(`{${namespace}}`))).toHaveLength(6);
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml") expect(after.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
