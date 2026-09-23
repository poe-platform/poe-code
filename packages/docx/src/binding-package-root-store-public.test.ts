import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as source from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
const store = "{76543210-1234-5678-9012-345678901234}";
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
for (const carrier of ["package-root", "document-part", "both-owners", "orphan", "external", "inert-role"] as const)
it(`binding store declaration carrier preserves singleton ownership; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}; carrier=${carrier}`, async () => {
  const product = route.startsWith("native") ? native : source;
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const rel = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const data = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
  const opc = "http://schemas.openxmlformats.org/package/2006/relationships";
  const rootEdge = carrier === "package-root" || carrier === "both-owners" ? `<Relationship Id="rootStore" Type="${rel}/customXml" Target="records/item.xml"/>` : carrier === "external" ? `<Relationship Id="rootStore" Type="${rel}/customXml" Target="https://example.invalid/inert" TargetMode="External"/>` : carrier === "inert-role" ? '<Relationship Id="rootStore" Type="urn:original:inert/customXml" Target="records/item.xml"/>' : "";
  const partEdge = carrier === "document-part" || carrier === "both-owners" ? `<Relationship Id="partStore" Type="${rel}/customXml" Target="../records/item.xml"/>` : "";
  const control = (tag: string) => `<w:sdt><w:sdtPr><w:text/><w:tag w:val="${tag}"/><w:dataBinding w:storeItemID="${store}" w:xpath="/v:record/v:value" w:prefixMappings="xmlns:v='urn:original:root-store'"/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>`;
  const xml = new Map<string, string>([
    ["[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/stories/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml"/><Override PartName="/records/properties.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`],
    ["_rels/.rels", `<Relationships xmlns="${opc}"><Relationship Id="main" Type="${rel}/officeDocument" Target="stories/main.xml"/>${rootEdge}<!--root retain--><?audit root?></Relationships>`],
    ["stories/main.xml", `<w:document xmlns:w="${word}"><w:body><w:p>${control("record")}${control("alias")}</w:p><!--body retain--></w:body></w:document>`],
    ["stories/_rels/main.xml.rels", `<Relationships xmlns="${opc}">${partEdge}<Relationship Id="audit" Type="urn:original:inert" Target="https://example.invalid/never-fetch" TargetMode="External"/><!--edge retain--></Relationships>`],
    ["records/item.xml", '<v:record xmlns:v="urn:original:root-store"><v:value>Old</v:value><!--data retain--><?audit data?></v:record>'],
    ["records/properties.xml", `<d:datastoreItem xmlns:d="${data}" d:itemID="${store}"/>`],
    ["records/_rels/item.xml.rels", `<Relationships xmlns="${opc}"><Relationship Id="properties" Type="${rel}/customXmlProps" Target="properties.xml"/><!--properties retain--></Relationships>`]
  ]);
  const parts = new Map([...xml].map(([name, value]) => {
    const bytes = codec === "utf8" ? new TextEncoder().encode(value) : Buffer.from("\ufeff" + value, "utf16le");
    if (codec === "utf16be") (bytes as Buffer).swap16();
    if (codec !== "utf8") expect([...bytes.subarray(0, 2)]).toEqual(codec === "utf16le" ? [255, 254] : [254, 255]);
    return [name, new Uint8Array(bytes)] as const;
  }));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  expect((await product.validateDocument(input, context)).valid).toBe(true);
  const supported = ["package-root", "document-part", "both-owners"].includes(carrier);
  if (supported) expect((await product.inspectDocumentPackageResources(input, "custom-xml.list", {}, context)).items.find(item => item.name === "/records/item.xml")).toMatchObject({ support: "preserve", details: { storeItemId: store } });
  const arguments_ = { all: true, binding: "record", valueJson: "Fresh海🌊" }, batch = { version: 1 as const, operations: [{ operation: "controls.bind" as const, arguments: arguments_ }] };
  if (route.includes("sdk")) {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route.endsWith("batch") ? product.executeDocumentBatch(input, batch, { output: "-" }, io) : product.editDocumentControlBindings(input, { ...arguments_, output: "-" }, io);
    if (supported) await pending; else await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
  } else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/destination", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const command = route.endsWith("batch") ? `docx batch /input --ops-json ${quote(JSON.stringify(batch))}` : `docx controls bind /input --all --binding record --value-json ${quote(JSON.stringify(arguments_.valueJson))}`;
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(supported ? 0 : 1);
      if (supported) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 2, errors: [] }); memory.writeFileSync("/output", await fs.readFile("/destination")); }
      else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
  if (!supported) { expect(memory.statSync("/output").size).toBe(0); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect([...after.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) if (!["stories/main.xml", "records/item.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  expect((await product.inspectDocumentControls(output, {}, context)).items.map(item => item.value)).toEqual(["Fresh海🌊", "Fresh海🌊"]);
  expect((await product.inspectDocumentControls(output, {}, context)).items.map(item => item.binding?.storeItemId)).toEqual([store, store]);
  expect(product.parseDocumentXml(after.get("records/item.xml")!).root.children[0]!.text).toBe("Fresh海🌊");
  const model = await product.Document(output, context), saved = Volume.fromJSON({ "/saved": "" });
  await model.save({ async write(bytes) { saved.appendFileSync("/saved", bytes); } });
  expect(new Uint8Array(saved.readFileSync("/saved") as Buffer)).toEqual(output);
  expect((await product.validateDocument(output, context)).valid).toBe(true);
});
