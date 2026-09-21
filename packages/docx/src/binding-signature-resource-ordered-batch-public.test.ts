import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as api from "./index.js";
import { textContext, w, r } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const batchSchema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "batch" } })!.data as api.DocxSchemaData;
const resultVariants = batchSchema.operations[0]!.result.oneOf![0]!.properties!.data!.properties!.results!.items as api.DocxJsonSchema;
const resultValidator = new Ajv2020({ strict: false, validateFormats: false });
const seal = "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/";
const store = "{38E185E1-4A31-4AB8-A420-FA578658AA11}";
async function fixture(strict: boolean, kind: "docx" | "dotx", scalar: "string" | "integer" | "double", signed: boolean, shared = false, incompleteGlossary = false) {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const relationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
  const edge = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const control = (tag: string) => `<w:sdt><w:sdtPr><w:text/><w:tag w:val="${tag}"/><w:dataBinding w:storeItemID="${store}" w:xpath="/v:record/v:value" w:prefixMappings="xmlns:v='urn:original:ordered-store'"/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Original</w:t></w:r></w:sdtContent></w:sdt>`;
  const types: Record<string, string> = { "reports/body.xml": `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`, "data/item.xml": "application/xml", "data/properties.xml": "application/vnd.openxmlformats-officedocument.customXmlProperties+xml", "resources/glossary.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml", "metadata/settings.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml" };
  const files: Record<string, string> = {
    "[Content_Types].xml": "",
    "_rels/.rels": rels(edge("body", relationships + "/officeDocument", "reports/body.xml") + (signed ? edge("seal", seal + "origin", "seals/origin.sigs") : "") + (shared ? edge("shared", "urn:original:shared", "seals/signature.xml") : "")),
    "reports/body.xml": `<w:document xmlns:w="${word}"><w:body><w:p><w:r><w:t>Retained 海 🌊</w:t></w:r></w:p><w:p>${control("target")}${control("alias")}</w:p></w:body></w:document>`,
    "reports/_rels/body.xml.rels": rels(edge("store", relationships + "/customXml", "../data/item.xml") + edge("glossary", relationships + "/glossaryDocument", "../resources/glossary.xml") + edge("settings", relationships + "/settings", "../metadata/settings.xml")),
    "data/item.xml": `<v:record xmlns:v="urn:original:ordered-store" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema"><v:value xsi:type="xs:${scalar}">${scalar === "string" ? "Original" : "1"}</v:value><!--retain--><?audit exact?></v:record>`,
    "data/properties.xml": `<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${store}"/>`,
    "data/_rels/item.xml.rels": rels(edge("properties", relationships + "/customXmlProps", "properties.xml")),
    "resources/glossary.xml": `<w:glossaryDocument xmlns:w="${word}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Retained block"/><w:guid w:val="original-block"/><w:category><w:name w:val="Reports"/><w:gallery w:val="docParts"/></w:category></w:docPartPr><w:docPartBody><w:p><w:r><w:t>Inert block</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`,
    "metadata/settings.xml": `<w:settings xmlns:w="${word}"><w:updateFields w:val="0"/><!--retain--></w:settings>`
  };
  if (signed) {
    types["seals/origin.sigs"] = "application/vnd.openxmlformats-package.digital-signature-origin";
    types["seals/signature.xml"] = "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml";
    files["seals/origin.sigs"] = "";
    files["seals/signature.xml"] = '<s:Signature xmlns:s="http://www.w3.org/2000/09/xmldsig#"/>';
    files["seals/_rels/origin.sigs.rels"] = rels(edge("signature", seal + "signature", "signature.xml"));
  }
  if (incompleteGlossary) files["resources/glossary.xml"] = files["resources/glossary.xml"]!.replace('<w:guid w:val="original-block"/>', "");
  files["[Content_Types].xml"] = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${Object.entries(types).map(([name, type]) => `<Override PartName="/${name}" ContentType="${type}"/>`).join("")}</Types>`;
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: Object.entries(files).map(([name, value]) => ({ name, bytes: encode(value), directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/input") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const scenario of ["string", "empty-string", "integer-zero", "double-zero", "glossary-incomplete", "signed-read", "strip-then-edit", "signed-edit-refusal", "shared-strip-refusal", "strip-then-failure"] as const)
for (const route of ["sdk", "cli"] as const)
  it(`${route} ordered ${scenario} preserves binding/resource/signature graphs; ${kind}; strict=${strict}`, async () => {
    const signed = scenario.startsWith("signed") || scenario.startsWith("strip") || scenario === "shared-strip-refusal";
    const input = await fixture(strict, kind, scenario === "integer-zero" ? "integer" : scenario === "double-zero" ? "double" : "string", signed, scenario === "shared-strip-refusal", scenario === "glossary-incomplete");
    const value = scenario === "empty-string" ? "" : scenario.endsWith("zero") ? 0 : "Updated 海 🌊";
    const operations: (api.DocxBatchItem & { readonly id?: string })[] = scenario === "signed-read" ? [
      { operation: "signatures.list", arguments: {} }
    ] : scenario === "shared-strip-refusal" ? [
      { id: "strip", operation: "signatures.remove", arguments: {} }
    ] : scenario === "strip-then-edit" || scenario === "strip-then-failure" ? [
      { id: "strip", operation: "signatures.remove", arguments: {} },
      { id: "edit", operation: "text.replace", arguments: { find: scenario === "strip-then-failure" ? "Missing" : "Retained", with: "Changed", first: true } },
      { operation: "signatures.list", arguments: {} }
    ] : scenario === "signed-edit-refusal" ? [
      { id: "edit", operation: "text.replace", arguments: { find: "Retained", with: "Changed", first: true } }
    ] : [
      { operation: "controls.bind", arguments: { all: true, binding: "target", valueJson: value } },
      { operation: "controls.list", arguments: {} }
    ];
    operations.push({ operation: "custom-xml.list", arguments: {} }, { operation: "glossary.list", arguments: {} }, { operation: "settings.list", arguments: {} });
    const failed = scenario === "signed-edit-refusal" || scenario === "shared-strip-refusal" || scenario === "strip-then-failure";
    const errorCode = scenario === "strip-then-failure" ? "missing-selection" : "unsupported-edit";
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    let data: api.DocumentBatchData | undefined;
    let writes = 0;
    if (route === "sdk") {
      const execution = api.executeDocumentBatch(input, { version: 1, operations }, scenario === "signed-read" ? {} : { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { writes++; memory.appendFileSync("/output", bytes); } } });
      if (failed) { await expect(execution).rejects.toMatchObject({ code: errorCode, operationIndex: scenario === "strip-then-failure" ? 1 : 0, operationId: scenario === "shared-strip-refusal" ? "strip" : "edit" }); expect(writes).toBe(0); }
      else { data = await execution; expect(writes).toBe(scenario === "signed-read" ? 0 : 1); }
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/operations", encode(JSON.stringify({ version: 1, operations }))); await fs.writeFile("/output", encode("Existing destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec(`docx batch /input --ops-file /operations ${scenario === "signed-read" ? "" : "--output /output --force"} --json`);
        expect(result.exitCode, result.stdout + result.stderr).toBe(failed ? 1 : 0);
        const envelope = JSON.parse(result.stdout);
        if (failed) { expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: errorCode, operationIndex: scenario === "strip-then-failure" ? 1 : 0, operationId: scenario === "shared-strip-refusal" ? "strip" : "edit" }] }); expect(await fs.readFile("/output")).toEqual(encode("Existing destination")); }
        else { data = envelope.data; if (scenario !== "signed-read") memory.writeFileSync("/output", await fs.readFile("/output")); else expect(await fs.readFile("/output")).toEqual(encode("Existing destination")); }
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    if (data) {
      for (const result of data.results) {
        const schema = resultVariants.oneOf!.find(variant => variant.properties?.id && variant.properties.operation?.const === result.operation)!;
        expect(schema, result.operation).toBeDefined();
        expect(resultValidator.validate(schema, result), JSON.stringify(resultValidator.errors)).toBe(true);
      }
      expect(data.results.map(result => result.operation)).toEqual(operations.map(operation => operation.operation));
      expect(data.results.at(-3)).toMatchObject({ affected: 0, data: { items: [{ kind: "custom-xml", name: "/data/item.xml", support: "preserve", details: { storeItemId: store } }] } });
      expect(data.results.at(-2)).toMatchObject({ affected: 0, data: { items: [{ kind: "glossary", details: { buildingBlocks: [{ name: "Retained block" }] } }] } });
      expect(data.results.at(-2)!.warnings).toEqual(scenario === "glossary-incomplete" ? [{ code: "unrecognized-resource-metadata", message: "Resource metadata is missing, ambiguous or unrecognized; resources remain preserved." }] : []);
      expect(data.results.at(-1)).toMatchObject({ affected: 0, data: { items: [{ details: { updateFields: false } }] } });
      if (scenario === "signed-read") { expect(data.publication).toBeNull(); expect(data.results[0]).toMatchObject({ affected: 0, data: { verified: null, items: [{ details: { role: "origin", verified: null } }, { details: { role: "signature", verified: null } }] } }); }
      else {
        const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
        assertPackageLinks(after);
        if (scenario === "strip-then-edit") {
          expect((await api.inspectDocumentSignatures(output, {}, textContext)).items).toEqual([]);
          expect((await api.extractDocumentText(output, textContext, {})).text).toContain("Changed 海 🌊");
          expect(data.results[0]).toMatchObject({ affected: 3, data: { removedParts: ["/seals/origin.sigs", "/seals/signature.xml", "/seals/_rels/origin.sigs.rels"], removedRelationships: [{ id: "seal" }, { id: "signature" }] } });
          for (const [name, bytes] of before) if (!["reports/body.xml", "[Content_Types].xml", "_rels/.rels"].includes(name) && !name.startsWith("seals/")) expect(after.get(name), name).toEqual(bytes);
        } else {
          expect((await api.inspectDocumentControls(output, {}, textContext)).items.map(control => control.value)).toEqual([String(value), String(value)]);
          expect(new TextDecoder().decode(after.get("data/item.xml"))).toContain(`>${String(value)}</v:value><!--retain--><?audit exact?>`);
          expect(data.results[0]).toMatchObject({ affected: 2 });
          expect([...after.keys()]).toEqual([...before.keys()]);
          for (const [name, bytes] of before) if (!["reports/body.xml", "data/item.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
        }
      }
    }
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
