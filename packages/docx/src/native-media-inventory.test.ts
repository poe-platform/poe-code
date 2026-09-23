import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, inspectDocumentCharts, inspectDocumentDiagrams, inspectDocumentEquations, inspectDocumentPackageResources, replaceDocumentText, writeArchive } from "./index.js";
import { chartFixture, chartContext, chartSpace, chartMime, sheetMime, series } from "../tests/fixtures/charts.js";
import { diagramCarrier } from "../tests/fixtures/diagrams.js";
import { readPackage } from "../tests/assertions.js";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["chart", "orphan-chart", "workbook", "chart-style", "chart-color", "diagram-data", "diagram-layout", "diagram-style", "diagram-color", "glossary", "custom-properties", "math-settings"] as const)
for (const parameter of ["", '; audit="coast; dune"'] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} inventories native ${role} with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", d = strict ? "http://purl.oclc.org/ooxml/drawingml/diagram" : "http://schemas.openxmlformats.org/drawingml/2006/diagram", m = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const resource = "audit/native.xml";
  let seed: Uint8Array, operation: "charts.list" | "diagrams.list" | "glossary.list" | "custom-xml.list" | "equations.list", expected: object;
  if (role === "chart" || role === "orphan-chart") {
    seed = await chartFixture({strict, definitions: [{name: resource, xml: chartSpace('<c:barChart>' + series() + '</c:barChart>', strict), type: chartMime + parameter, referenced: role === "chart"}]});
    operation = "charts.list"; expected = {items: [{name: "/" + resource, support: "read", details: {status: "decoded", chartType: "barChart", series: [{cachedValues: ["1.00"]}]}}]};
  } else if (role === "workbook" || role === "chart-style" || role === "chart-color") {
    const field = role === "workbook" ? "workbook" : role === "chart-style" ? "style" : "color", type = role === "workbook" ? sheetMime : "application/vnd.ms-office.chart" + (field === "style" ? "style" : "colorstyle") + "+xml";
    const bytes = role === "workbook" ? new Uint8Array([80, 75, 3, 4, 7]) : `<s:${field === "style" ? "chartStyle" : "colorStyle"} xmlns:s="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>`;
    seed = await chartFixture({strict, resources: [{name: resource, type: type + parameter, bytes}], relationships: [{owner: "/word/charts/plot.xml", id: "native", type: role === "workbook" ? r + "/package" : "http://schemas.microsoft.com/office/2011/relationships/" + (field === "style" ? "chartStyle" : "chartColorStyle"), target: "/" + resource}]});
    operation = "charts.list"; expected = {items: [{details: {resources: [{role: field, status: "internal", target: {contentType: type + parameter}}]}}]};
  } else if (role.startsWith("diagram-")) {
    const suffix = role.slice(8), types = ["diagramData", "diagramLayout", "diagramStyle", "diagramColors"], names = ["data", "layout", "style", "color"], roots = ["dataModel", "layoutDef", "styleDef", "colorsDef"];
    const resources = names.map((name, i) => ({name: `audit/${name}.xml`, type: `application/vnd.openxmlformats-officedocument.drawingml.${types[i]}+xml` + (name === suffix ? parameter : ""), bytes: `<d:${roots[i]} xmlns:d="${d}"/>`}));
    seed = await chartFixture({strict, definitions: [], resources, relationships: names.map((name, i) => ({owner: "/word/document.xml", id: name, type: r + "/" + ["diagramData", "diagramLayout", "diagramQuickStyle", "diagramColors"][i], target: `/audit/${name}.xml`})), body: '<w:p><w:r><w:t>coast</w:t></w:r>' + diagramCarrier(strict) + '</w:p>'});
    operation = "diagrams.list"; expected = {items: expect.arrayContaining([{kind: "diagrams", name: "/word/document.xml", location: expect.any(Object), properties: [], references: expect.any(Array), support: "preserve", details: expect.objectContaining({observations: [expect.objectContaining({bindings: names.map(name => expect.objectContaining({role: name, status: "internal"}))})]})}, ...names.map(name => expect.objectContaining({name: `/audit/${name}.xml`, details: expect.objectContaining({roles: [{role: name, part: `/audit/${name}.xml`, evidence: "both", root: {namespace: d, localName: roots[names.indexOf(name)]}, status: "matching"}]})}))])};
  } else {
    const type = role === "glossary" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml" : role === "custom-properties" ? "application/vnd.openxmlformats-officedocument.customXmlProperties+xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml";
    const bytes = role === "glossary" ? `<w:glossaryDocument xmlns:w="${w}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Original coast"/></w:docPartPr><w:docPartBody><w:p/></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>` : role === "custom-properties" ? '<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{00112233-4455-6677-8899-AABBCCDDEEFF}"/>' : `<w:settings xmlns:w="${w}" xmlns:m="${m}"><m:mathPr><m:mathFont m:val="Original Coast"/></m:mathPr></w:settings>`;
    seed = await chartFixture({strict, definitions: [], resources: [{name: resource, type: type + parameter, bytes}]});
    operation = role === "glossary" ? "glossary.list" : role === "custom-properties" ? "custom-xml.list" : "equations.list";
    expected = role === "math-settings" ? {globalProperties: expect.arrayContaining([expect.objectContaining({localName: "mathFont"})])} : {items: [expect.objectContaining({name: "/" + resource, details: expect.objectContaining(role === "glossary" ? {buildingBlocks: [expect.objectContaining({name: "Original coast"})]} : {storeItemId: "{00112233-4455-6677-8899-AABBCCDDEEFF}"})})]};
  }
  const parts = readPackage(seed); parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": "", "/model": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") {
    const data = operation === "charts.list" ? await inspectDocumentCharts(input, {}, chartContext) : operation === "diagrams.list" ? await inspectDocumentDiagrams(input, {}, chartContext) : operation === "equations.list" ? await inspectDocumentEquations(input, {}, chartContext) : await inspectDocumentPackageResources(input, operation, {}, chartContext);
    expect(data).toMatchObject(expected);
    await replaceDocumentText(input, {find: "coast", with: "shore", first: true, output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
    const read = await shell.exec(`docx ${operation.replace(".", " ")} /input --json`); expect(read.exitCode, read.stderr).toBe(0); expect(JSON.parse(read.stdout).data).toMatchObject(expected);
    const edit = await shell.exec("docx text replace /input --find coast --with shore --first --output - > /output"); expect(edit.exitCode, edit.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  if (role === "chart" || role === "orphan-chart") expect((await inspectDocument(input, chartContext)).features.find(feature => feature.id === "F37")).toMatchObject({detected: true, level: "read"});
  const model = await Document(input, chartContext); model.paragraphs[0]!.runs[0]!.text = "shore"; await model.save({async write(bytes) {memory.appendFileSync("/model", bytes);}});
  for (const path of ["/output", "/model"]) { const saved = readPackage(new Uint8Array(memory.readFileSync(path) as Buffer)); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes); }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
