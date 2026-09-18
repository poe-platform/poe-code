import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { DocumentXmlEditor } from "./xml-write.js";

const enc = (value: string) => new TextEncoder().encode(value);
const mce = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const carriers = ["body", "table", "headers", "footers", "footnotes", "endnotes", "comments", "text-boxes"] as const;
async function fixture(carrier: typeof carriers[number], strict: boolean, kind: "docx" | "dotx", protectedInput = false) {
  const properties = `<mc:AlternateContent xmlns:mc="${mce}"><mc:Choice Requires="w"><w:b w:val="false"/></mc:Choice><mc:Fallback><w:b/></mc:Fallback></mc:AlternateContent>`;
  const content = `<w:p xmlns:mc="${mce}" xmlns:x="urn:coast:opaque" mc:Ignorable="x" x:retain="opaque"><!--retain--><?coast keep?><w:hyperlink r:id="coast"><w:r><w:rPr>${properties}</w:rPr><w:t>Harbor 😀</w:t></w:r></w:hyperlink><mc:AlternateContent><mc:Choice Requires="x"><w:r><w:t>Inactive</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t> active</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>`;
  const root = (tag: string, body: string) => `<w:${tag} xmlns:w="${w}" xmlns:r="${r}">${body}</w:${tag}>`;
  const stories: Record<string, { kind: string; xml: string }> = {};
  let body = content, owner = "document";
  if (carrier === "table") body = `<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
  else if (carrier === "text-boxes") body = `<w:p><w:r><w:drawing><w:txbxContent>${content}</w:txbxContent></w:drawing></w:r></w:p>`;
  else if (carrier !== "body") {
    owner = "native";
    if (carrier === "headers" || carrier === "footers") {
      const role = carrier === "headers" ? "header" : "footer";
      stories.native = { kind: role, xml: root(role === "header" ? "hdr" : "ftr", content) };
      body = `<w:p/><w:sectPr><w:${role}Reference w:type="default" r:id="native"/></w:sectPr>`;
    } else {
      const singular = carrier === "comments" ? "comment" : carrier.slice(0, -1);
      stories.native = { kind: carrier, xml: root(carrier, `<w:${singular} w:id="2"${carrier === "comments" ? ' w:author="Coast"' : ""}>${content}</w:${singular}>`) };
      body = carrier === "comments" ? "<w:p/>" : `<w:p><w:r><w:${singular}Reference w:id="2"/></w:r></w:p>`;
    }
  }
  if (protectedInput) stories.settings = { kind: "settings", xml: root("settings", '<w:documentProtection w:enforcement="1" w:edit="readOnly"/>') };
  const members = readPackage(await textFixture(body, stories, strict));
  const reltype = (strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r) + "/hyperlink";
  const relation = `<Relationship Id="coast" Type="${reltype}" Target="https://example.invalid/coast?x=1&amp;y=2" TargetMode="External"/>`;
  const relname = `word/_rels/${owner}.xml.rels`;
  if (members.has(relname)) { const xml = new DocumentXmlEditor(members.get(relname)!); xml.insertChildren(xml.root, relation); members.set(relname, xml.serialize()); }
  else members.set(relname, enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relation}</Relationships>`));
  if (kind === "dotx") { const xml = new DocumentXmlEditor(members.get("[Content_Types].xml")!); const main = xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "PartName" && attribute.value === "/word/document.xml"))!; xml.setAttribute(main, { namespace: "", localName: "ContentType" }, "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"); members.set("[Content_Types].xml", xml.serialize()); }
  const volume = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { compression: "store", order: "input" }, textContext);
  return { input: new Uint8Array(volume.readFileSync("/input") as Buffer), owner: `/word/${owner}.xml`, reltype };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of carriers) for (const resource of ["paragraphs", "runs"] as const) for (const route of ["sdk", "shell"] as const) for (const action of ["get", "list"] as const)
it(`${route} ${action === "get" ? "reads" : "lists"} ${resource} from ${carrier} with active MCE and owner-local inert links; strict=${strict}; kind=${kind}`, async () => {
  const { input, owner, reltype } = await fixture(carrier, strict, kind, true);
  const scope = carrier === "table" ? "body" : carrier;
  const options = { scope, ...(carrier === "table" ? { table: 1, cell: "A1" } : {}), paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) };
  let data: api.TextResourceInspectionData;
  if (route === "sdk") {
    if (action === "get") data = await (resource === "paragraphs" ? api.inspectDocumentParagraph : api.inspectDocumentRun)(input, options, textContext);
    else { const result = await (resource === "paragraphs" ? api.inspectDocumentParagraphs : api.inspectDocumentRuns)(input, options, textContext); expect(result.items).toHaveLength(1); data = { item: result.items[0]! }; }
  }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/source", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx ${resource} ${action} /source --scope ${scope}${carrier === "table" ? " --table 1 --cell A1" : ""} --paragraph 1${resource === "runs" ? " --run 1" : ""} --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const resultData = JSON.parse(result.stdout).data; data = action === "get" ? resultData : { item: resultData.items[0] }; if (action === "list") expect(resultData.items).toHaveLength(1); expect(await fs.readFile("/source")).toEqual(input); } finally { await shell.dispose(); }
  }
  expect(data.item.text).toBe(resource === "paragraphs" ? "Harbor 😀 active" : "Harbor 😀");
  expect(data.item.location.value.part).toBe(owner);
  expect(data.item.references).toEqual(resource === "paragraphs" ? [{ owner, id: "coast", type: reltype, target: "https://example.invalid/coast?x=1&y=2", external: true }] : []);
  if (resource === "runs") expect(data.item.properties).toContainEqual({ name: "bold", type: "boolean", value: false, writable: true, cached: false });
  const volume = Volume.fromJSON({ "/saved": "" });
  const doc = await api.Document(input, textContext);
  await expect(doc.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(volume.readFileSync("/saved", "utf8")).toBe("");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const resource of ["paragraphs", "runs"] as const)
it(`bounds ${resource} output exactly and cancels without acquiring ambient authority; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await fixture("body", strict, kind);
  const read = resource === "paragraphs" ? api.inspectDocumentParagraph : api.inspectDocumentRun;
  const options = { paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) };
  const expected = await read(input, options, textContext), size = enc(JSON.stringify(expected)).length;
  expect(await read(input, { ...options, limit: [{ name: "serializedOutput", value: size }] }, textContext)).toEqual(expected);
  await expect(read(input, { ...options, limit: [{ name: "serializedOutput", value: size - 1 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
  const controller = new AbortController(); controller.abort();
  await expect(read(input, options, { ...textContext, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
});
