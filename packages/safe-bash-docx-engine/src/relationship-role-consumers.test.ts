import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor, createDocxInspectionCommandEngine, inspectDocument, inspectDocumentCharts, inspectDocumentDiagrams, inspectDocumentEquations, inspectDocumentObjects, readArchive, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (xml: string) => new TextEncoder().encode(xml);
const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
async function fixture(strict: boolean, lookalike: boolean, uppercase: boolean) {
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", drawing = strict ? "http://purl.oclc.org/ooxml/drawingml/" : "http://schemas.openxmlformats.org/drawingml/2006/", math = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const archive = await readArchive(await textFixture(`<w:p><m:oMath xmlns:m="${math}"><m:r><m:t>x</m:t></m:r></m:oMath></w:p>`, {}, strict), textContext), rels = "http://schemas.openxmlformats.org/package/2006/relationships";
  const members = archive.members.map(part => {
    if (part.name !== "[Content_Types].xml") return part;
    const xml = new DocumentXmlEditor(part.bytes);
    xml.insertChildren(xml.root, `<Default xmlns="${xml.root.namespace}" Extension="xml" ContentType="application/xml"/><Default xmlns="${xml.root.namespace}" Extension="bin" ContentType="application/octet-stream"/><Override xmlns="${xml.root.namespace}" PartName="/audit/owner.xml" ContentType="${lookalike ? "application/x.audit-relationships+xml" : "application/xml"}"/>`);
    const types = new DocumentXmlEditor(xml.serialize());
    if (uppercase) for (const node of types.root.children) types.setAttribute(node, "ContentType", node.attributes.find(attribute => attribute.localName === "ContentType")!.value.toUpperCase());
    return { ...part, bytes: types.serialize() };
  });
  const files = {
    "audit/owner.xml": '<audit xmlns="urn:original:audit"/>',
    "audit/_rels/owner.xml.rels": `<Relationships xmlns="${rels}"><Relationship Id="chart" Type="${r}/chart" Target="chart.xml"/><Relationship Id="object" Type="${r}/oleObject" Target="payload.bin"/><Relationship Id="diagram" Type="${r}/diagramData" Target="diagram.xml"/><Relationship Id="equation" Type="urn:original:reference" Target="../word/document.xml"/><Relationship Id="font" Type="${r}/font" Target="first.bin"/></Relationships>`,
    "audit/chart.xml": `<c:chartSpace xmlns:c="${drawing}chart"/>`,
    "audit/diagram.xml": `<d:dataModel xmlns:d="${drawing}diagram"/>`,
    "audit/payload.bin": "original inert object",
    "audit/first.bin": "first inert font",
    "audit/second.bin": "second inert font"
  };
  for (const [name, xml] of Object.entries(files)) members.push({ name, bytes: encode(xml), directory: false, modified: new Date("2026-01-02T03:04:06Z") });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
async function command(input: Uint8Array, args: string[], replacement?: Uint8Array) {
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "", ...(replacement ? { "/replacement.xml": Buffer.from(replacement) } : {}) });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(encode), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  return { result, output: new Uint8Array(volume.readFileSync("/out") as Buffer), stderr: volume.readFileSync("/err", "utf8") as string };
}
async function extendFixture(input: Uint8Array, files: Record<string, { xml: string; type: string }>, relationshipOwner?: { part: string; xml: string }) {
  const archive = await readArchive(input, textContext);
  const members = archive.members.map(member => {
    if (member.name === "[Content_Types].xml" && Object.keys(files).length) {
      const xml = new DocumentXmlEditor(member.bytes);
      xml.insertChildren(xml.root, Object.entries(files).map(([name, part]) => `<Override xmlns="${xml.root.namespace}" PartName="/${name}" ContentType="${part.type}"/>`).join(""));
      return { ...member, bytes: xml.serialize() };
    }
    if (member.name === relationshipOwner?.part) {
      const xml = new DocumentXmlEditor(member.bytes); xml.insertChildren(xml.root, relationshipOwner.xml);
      return { ...member, bytes: xml.serialize() };
    }
    return member;
  });
  for (const [name, part] of Object.entries(files)) members.push({ name, bytes: encode(part.xml), directory: false, modified: new Date("2026-01-02T03:04:06Z") });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}

for (const strict of [false, true]) for (const lookalike of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) {
  for (const kind of ["charts", "objects", "diagrams"] as const) it(`inventories physical ${kind} via ${route}; strict=${strict}; lookalike=${lookalike}; uppercase=${uppercase}`, async () => {
    const input = await fixture(strict, lookalike, uppercase), before = readPackage(input), r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    let data;
    if (route === "sdk") data = await ({ charts: inspectDocumentCharts, objects: inspectDocumentObjects, diagrams: inspectDocumentDiagrams }[kind])(input, {}, textContext);
    else {
      const response = await command(input, [kind, "list", "/input", "--json"]);
      expect(response.result.exitCode, response.stderr).toBe(0); data = JSON.parse(new TextDecoder().decode(response.output)).data;
    }
    const path = kind === "charts" ? "chart.xml" : kind === "objects" ? "payload.bin" : "diagram.xml", id = kind === "charts" ? "chart" : kind === "objects" ? "object" : "diagram", type = kind === "charts" ? "chart" : kind === "objects" ? "oleObject" : "diagramData";
    expect(data.items).toHaveLength(1);
    const item = data.items[0]!;
    expect(item).toMatchObject({ name: `/audit/${path}`, support: "preserve", references: [{ owner: "/audit/owner.xml", id, type: `${r}/${type}`, target: path, external: false }] });
    const details = item.details, descriptor = kind === "charts" ? details.definition : kind === "objects" ? details.resource : details.parts[0];
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", before.get(`audit/${path}`)!.slice()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    expect(descriptor).toMatchObject({ bytes: before.get(`audit/${path}`)!.length, sha256: hash });
    expect(readPackage(input)).toEqual(before);
  });
  it(`retains equation incoming references via ${route}; strict=${strict}; lookalike=${lookalike}; uppercase=${uppercase}`, async () => {
    const input = await fixture(strict, lookalike, uppercase), before = input.slice();
    let data;
    if (route === "sdk") data = await inspectDocumentEquations(input, {}, textContext);
    else { const response = await command(input, ["equations", "list", "/input", "--json"]); expect(response.result.exitCode, response.stderr).toBe(0); data = JSON.parse(new TextDecoder().decode(response.output)).data; }
    expect(data.items).toHaveLength(1);
    expect(data.items[0]!.references).toContainEqual({ owner: "/audit/owner.xml", id: "equation", type: "urn:original:reference", target: "../word/document.xml", external: false });
    expect(input).toEqual(before);
  });
  it(`detects relationship-derived feature roles via ${route}; strict=${strict}; lookalike=${lookalike}; uppercase=${uppercase}`, async () => {
    const input = await fixture(strict, lookalike, uppercase), before = input.slice();
    let data;
    if (route === "sdk") data = await inspectDocument(input, textContext);
    else { const response = await command(input, ["inspect", "/input", "--json"]); expect(response.result.exitCode, response.stderr).toBe(0); data = JSON.parse(new TextDecoder().decode(response.output)).data; }
    for (const id of ["F37", "F38"]) expect(data.features).toContainEqual(expect.objectContaining({ id, detected: true, level: "preserve" }));
    expect(input).toEqual(before);
  });
  it(`refuses raw font rebinding via ${route}; strict=${strict}; lookalike=${lookalike}; uppercase=${uppercase}`, async () => {
    const input = await fixture(strict, lookalike, uppercase), before = readPackage(input), part = "/audit/_rels/owner.xml.rels", xml = new DocumentXmlEditor(before.get(part.slice(1))!);
    const edge = xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "font"))!;
    xml.setAttribute(edge, "Target", "second.bin"); const replacement = xml.serialize();
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      await expect(replaceDocumentXmlPart(input, replacement, { part, output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(volume.readFileSync("/out").length).toBe(0);
    } else {
      const response = await command(input, ["xml", "set", "/input", "--part", part, "--file", "/replacement.xml", "--output", "-"], replacement);
      expect(response.result.exitCode).not.toBe(0); expect(response.stderr).toContain("Embedded font mutation is unsupported;"); expect(response.output.length).toBe(0);
    }
    expect(readPackage(input)).toEqual(before);
  });
  it(`inventories an inert embedding XML member via ${route}; strict=${strict}; lookalike=${lookalike}; uppercase=${uppercase}`, async () => {
    const type = lookalike ? "application/x.audit-relationships+xml" : "application/xml", name = "word/embeddings/orphan.xml";
    const input = await extendFixture(await fixture(strict, false, uppercase), { [name]: { xml: '<inert xmlns="urn:original:embedding"/>', type: uppercase ? type.toUpperCase() : type } }), before = readPackage(input);
    let data;
    if (route === "sdk") data = await inspectDocumentObjects(input, {}, textContext);
    else { const response = await command(input, ["objects", "list", "/input", "--json"]); expect(response.result.exitCode, response.stderr).toBe(0); data = JSON.parse(new TextDecoder().decode(response.output)).data; }
    expect(data.items).toHaveLength(2);
    expect(data.items).toContainEqual(expect.objectContaining({ name: `/${name}`, support: "preserve", details: expect.objectContaining({ resource: expect.objectContaining({ part: `/${name}`, contentType: uppercase ? type.toUpperCase() : type, bytes: before.get(name)!.length }) }) }));
    expect(readPackage(input)).toEqual(before);
  });
  it(`inventories a declared signature target via ${route}; strict=${strict}; lookalike=${lookalike}; uppercase=${uppercase}`, async () => {
    const name = "audit/signature.xml", input = await extendFixture(await fixture(strict, lookalike, uppercase), { [name]: { xml: '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>', type: uppercase ? "APPLICATION/XML" : "application/xml" } }, { part: "audit/_rels/owner.xml.rels", xml: '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="signature" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature" Target="signature.xml"/>' }), before = input.slice();
    let data;
    if (route === "sdk") data = await inspectDocument(input, textContext);
    else { const response = await command(input, ["inspect", "/input", "--json"]); expect(response.result.exitCode, response.stderr).toBe(0); data = JSON.parse(new TextDecoder().decode(response.output)).data; }
    expect(data.signed).toBe(true); expect(data.signatures).toEqual({ parts: [`/${name}`], verified: null });
    expect(input).toEqual(before);
  });
  it(`refuses raw diagram edge identity changes via ${route}; strict=${strict}; lookalike=${lookalike}; uppercase=${uppercase}`, async () => {
    const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const input = await extendFixture(await fixture(strict, lookalike, uppercase), {}, { part: "word/_rels/document.xml.rels", xml: `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="diagram" Type="${r}/diagramData" Target="../audit/diagram.xml"/>` }), before = readPackage(input), part = "/audit/_rels/owner.xml.rels", xml = new DocumentXmlEditor(before.get(part.slice(1))!);
    xml.setAttribute(xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "diagram"))!, "Id", "renamed");
    const replacement = xml.serialize();
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      await expect(replaceDocumentXmlPart(input, replacement, { part, output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(volume.readFileSync("/out").length).toBe(0);
    } else {
      const response = await command(input, ["xml", "set", "/input", "--part", part, "--file", "/replacement.xml", "--output", "-"], replacement);
      expect(response.result.exitCode).not.toBe(0); expect(response.stderr).toContain("unsupported-edit"); expect(response.output.length).toBe(0);
    }
    expect(readPackage(input)).toEqual(before);
  });
}
