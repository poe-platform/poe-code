import { Volume } from "memfs";
import { afterEach, expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentParagraphs, getDocumentXml, inspectDocument, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const encode = (text: string) => new TextEncoder().encode(text);
const quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
const ref = (resultHandle: string) => ({resultHandle});
const shells = new Set<Shell>();
afterEach(async () => {
  const pending = [...shells];
  shells.clear();
  await Promise.all(pending.map(shell => shell.dispose()));
});
const row = '<pr:Relationship Id="audit" Type="urn:original:audit" Target="/records/a.xml"/>';
const inactive = '<pr:Relationship Id="audit" Type="urn:original:inactive" Target="/absent.xml" mc:MustUnderstand="f"/>';
const carriers = [
  ["direct", row, ""],
  ["choice", `<mc:AlternateContent><mc:Choice Requires="pr">${row}</mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent>`, ""],
  ["fallback", `<mc:AlternateContent><mc:Choice Requires="f">${inactive}</mc:Choice><mc:Fallback>${row}</mc:Fallback></mc:AlternateContent>`, ""],
  ["word choice excluded", `<mc:AlternateContent><mc:Choice Requires="w">${inactive}</mc:Choice><mc:Fallback>${row}</mc:Fallback></mc:AlternateContent>`, ""],
  ["process", `<f:carrier>${row}</f:carrier>`, 'mc:Ignorable="f" mc:ProcessContent="f:carrier"'],
  ["ignored attributes", row.replace('/>', ' f:stamp="coast"/>'), 'mc:Ignorable="f" f:stamp="coast" mc:PreserveAttributes="f:stamp"'],
  ["ignored subtree", `<f:opaque xml:base="relative/" mc:MustUnderstand="f">${inactive}</f:opaque>${row}`, 'mc:Ignorable="f" mc:PreserveElements="f:opaque"'],
  ["understood requirement", row, 'mc:MustUnderstand="pr"']
] as const;

async function fixture(strict: boolean, kind: "docx" | "dotx", owner: "root" | "document", content: string, flags: string, encoding: "utf8" | "utf8bom" | "utf16le" | "utf16be" = "utf8", typesFlags = "") {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const main = `<pr:Relationship Id="main" Type="${r}/officeDocument" Target="reports/main.xml" TargetMode="Internal"/>`;
  const other = row.replace("a.xml", "b.xml").replace("urn:original:audit", "urn:original:replacement");
  const envelope = (body: string, attrs = "") => `<?xml version="1.0" encoding="${encoding.startsWith("utf8") ? "UTF-8" : "UTF-16"}"?><!--before--><pr:Relationships xmlns:pr="${pr}" xmlns:mc="${mc}" xmlns:f="urn:original:future" xmlns:w="${w}" ${attrs}>\n${body}\n<?keep carrier?>\n</pr:Relationships><!--after-->`;
  const name = owner === "root" ? "_rels/.rels" : "reports/_rels/main.xml.rels";
  const xml = envelope((owner === "root" ? main : "") + content, flags);
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" xmlns:mc="${mc}" xmlns:f="urn:original:future" ${typesFlags}><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/reports/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/></Types>`,
    "_rels/.rels": envelope(owner === "root" ? main + content : main + other, owner === "root" ? flags : ""),
    "reports/main.xml": `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Original coast</w:t></w:r></w:p></w:body></w:document>`,
    "reports/_rels/main.xml.rels": envelope(owner === "document" ? content : other, owner === "document" ? flags : ""),
    "records/a.xml": "<audit>Original 海</audit>", "records/b.xml": "<audit>Replacement dunes</audit>"
  }).map(([name, value]) => [name, name.endsWith(".rels") && encoding !== "utf8" ? new Uint8Array(encoding === "utf8bom" ? Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(value)]) : Buffer.concat([Buffer.from(encoding === "utf16le" ? [255, 254] : [254, 255]), encoding === "utf16le" ? Buffer.from(value, "utf16le") : Buffer.from(value, "utf16le").swap16()])) : encode(value)]));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  let shell: Shell | undefined;
  return {parts, input, memory, sink, fs, get shell() {
    if (!shell) {
      shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
      shells.add(shell);
    }
    return shell;
  }, name, xml, main, context: {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: sink}};
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const [label, content, flags] of carriers)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} reads and retains ${owner} relationships ${label}; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, owner, content, flags);
  if (route === "model") {
    const doc = await Document(f.input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
    expect(rels.at("audit").target_part.blob).toEqual(f.parts.get("records/a.xml")); expect(rels.at("audit").reltype).toBe("urn:original:audit");
    expect(rels.xml).toBe(f.xml); doc.paragraphs[0]!.text = "Changed coast"; await doc.save(f.sink);
  } else {
    const data = route === "sdk" ? await inspectDocument(f.input, textContext) : await (async () => {const r = await f.shell.exec("docx inspect /input --json"); expect(r.exitCode, r.stderr).toBe(0); return JSON.parse(r.stdout).data as Awaited<ReturnType<typeof inspectDocument>>;})();
    expect(data.kind).toBe(kind); expect(data.dialect).toBe(strict ? "strict" : "transitional");
    expect(data.relationships.filter(row => row.owner === (owner === "root" ? "/" : "/reports/main.xml") && row.id === "audit")).toEqual([{owner: owner === "root" ? "/" : "/reports/main.xml", id: "audit", type: "urn:original:audit", target: "/records/a.xml", external: false}]);
    if (route === "sdk") {expect(await getDocumentXml(f.input, textContext, {part: "/" + f.name, raw: true})).toEqual(f.parts.get(f.name)); await editDocumentParagraphs(f.input, {operation: "paragraphs.set", options: {paragraph: 1, text: "Changed coast", output: "-"}}, f.context);}
    else {const raw = await f.shell.exec(`docx xml get /input --part /${f.name} --raw > /raw`); expect(raw.exitCode, raw.stderr).toBe(0); expect(await f.fs.readFile("/raw")).toEqual(f.parts.get(f.name)); const edit = await f.shell.exec("docx paragraphs set /input --paragraph 1 --text 'Changed coast' --output - > /output"); expect(edit.exitCode, edit.stderr).toBe(0); f.memory.writeFileSync("/output", await f.fs.readFile("/output"));}
  }
  const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of f.parts) if (name !== "reports/main.xml") expect(saved.get(name), name).toEqual(bytes);
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Changed coast"); expect(await f.fs.readFile("/input")).toEqual(f.input);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const [label, content, flags] of carriers)
for (const encoding of ["utf8", "utf8bom", "utf16le", "utf16be"] as const) for (const action of ["add", "delete", "replace"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${action} retains dirty ${owner} relationships ${label} ${encoding}; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, owner, content, flags, encoding);
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part"},
    {operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package"},
    {operation: "model.parts.document.DocumentPart.rels.get", receiver: ref("part"), arguments: {}, resultHandle: owner === "document" ? "rels" : "other"},
    {operation: "model.opc.package.OpcPackage.rels.get", receiver: ref("package"), arguments: {}, resultHandle: owner === "root" ? "rels" : "other"},
    ...(action === "replace" ? [{operation: "model.opc.rel.Relationships.__getitem__.call", receiver: ref("other"), arguments: {rId: "audit"}, resultHandle: "replacement"}] : []),
    {operation: action === "add" ? "model.opc.rel.Relationships.add_relationship.call" : action === "delete" ? "model.opc.rel.Relationships.__delitem__.call" : "model.opc.rel.Relationships.__setitem__.call", receiver: ref("rels"), arguments: action === "add" ? {rId: "extra", reltype: "urn:original:extra", target: "https://example.invalid/coast", isExternal: true} : action === "delete" ? {rId: "audit"} : {rId: "audit", value: ref("replacement")}}
  ]};
  if (route === "model") {
    const doc = await Document(f.input, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels, other = owner === "root" ? doc.part.rels : doc.part.package.rels;
    if (action === "add") rels.add_relationship("urn:original:extra", "https://example.invalid/coast", "extra", true);
    else if (action === "delete") rels.delete("audit"); else rels.set("audit", other.at("audit"));
    await doc.save(f.sink);
  } else if (route === "sdk") await (await applyStyleModelBatch(f.input, batch, textContext)).save(f.sink);
  else {const result = await f.shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); f.memory.writeFileSync("/output", await f.fs.readFile("/output"));}
  const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of f.parts) if (name !== f.name) expect(saved.get(name), name).toEqual(bytes);
  const decoded = new TextDecoder(encoding.startsWith("utf8") ? "utf-8" : encoding === "utf16le" ? "utf-16le" : "utf-16be").decode(saved.get(f.name));
  if (owner === "root") expect(decoded).toContain(f.main);
  const expected = action === "delete" ? f.xml.replace(content, content.replace(label === "ignored attributes" ? row.replace('/>', ' f:stamp="coast"/>') : row, "")) : action === "replace" ? f.xml.replace(content, content.replace("urn:original:audit", "urn:original:replacement").replace("/records/a.xml", "../records/b.xml")) : undefined;
  if (expected !== undefined) expect(decoded).toBe(owner === "root" && action === "replace" ? expected.replace("../records/b.xml", "records/b.xml") : expected);
  else {expect(decoded).toContain(content); expect(decoded).toContain('<?keep carrier?>'); expect(decoded).toContain('Id="extra"');}
  if (encoding !== "utf8") expect([...saved.get(f.name)!.slice(0, encoding === "utf8bom" ? 3 : 2)]).toEqual(encoding === "utf8bom" ? [239, 187, 191] : encoding === "utf16le" ? [255, 254] : [254, 255]);
  const doc = await Document(output, textContext), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
  expect(rels.has("audit")).toBe(action !== "delete"); if (action === "replace") expect(rels.at("audit").target_part.blob).toEqual(f.parts.get("records/b.xml")); if (action === "add") expect(rels.at("extra").target_ref).toBe("https://example.invalid/coast");
  expect(await f.fs.readFile("/input")).toEqual(f.input);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const route of ["model", "sdk", "shell"] as const)
for (const [label, content, flags, typesFlags, code] of [
  ["unknown required namespace", row, 'mc:MustUnderstand="f"', "", "unsupported-profile"],
  ["word required namespace", row, 'mc:MustUnderstand="w"', "", "unsupported-profile"],
  ["unknown active element", row + '<f:unknown/>', "", "", "invalid-package"],
  ["unknown active attribute", row.replace('/>', ' f:stamp="coast"/>'), "", "", "invalid-package"],
  ["root xml base", row, 'xml:base="relative/"', "", "invalid-package"],
  ["active row xml base", row.replace('/>', ' xml:base="relative/"/>'), "", "", "invalid-package"],
  ["active duplicate ID", `<mc:AlternateContent><mc:Choice Requires="pr">${row}${row}</mc:Choice><mc:Fallback/></mc:AlternateContent>`, "", "", "invalid-package"],
  ["active missing target", `<mc:AlternateContent><mc:Choice Requires="pr">${row.replace("/records/a.xml", "/absent.xml")}</mc:Choice><mc:Fallback/></mc:AlternateContent>`, "", "", "invalid-package"],
  ["collapsed duplicate ID", row + row.replace('Id="audit"', 'Id=" &#x9;audit&#xA; "'), "", "", "invalid-package"],
  ["relationship child element", row.replace('/>', '><pr:Relationship Id="child" Type="urn:original:child" Target="/records/a.xml"/></pr:Relationship>'), "", "", "invalid-package"],
  ["noncollapsed target mode", row.replace('/>', ' TargetMode=" Internal "/>'), "", "", "invalid-package"],
  ["missing type attribute", row.replace(' Type="urn:original:audit"', ''), "", "", "invalid-package"],
  ["content types compatibility", row, "", 'mc:Ignorable="f" f:stamp="coast"', "invalid-package"]
] as const)
it(`${route} rejects ${label} in ${owner} relationships; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, owner, content, flags, "utf8", typesFlags);
  if (route === "model") await expect(Document(f.input, textContext)).rejects.toMatchObject({code});
  else if (route === "sdk") await expect(inspectDocument(f.input, textContext)).rejects.toMatchObject({code});
  else {const result = await f.shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [expect.objectContaining({code})]});}
  expect(await f.fs.readFile("/input")).toEqual(f.input); expect(f.memory.readFileSync("/output", "utf8")).toBe("");
});
