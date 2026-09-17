import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, inspectDocumentSettings, replaceDocumentText, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
function rewrittenStructure(bytes: Uint8Array) {
  const tree = xmlStructure(bytes);
  const visit = (node: typeof tree) => { delete node.attributes["{http://www.w3.org/XML/1998/namespace}space"]; for (const child of node.children) if (typeof child !== "string") visit(child); };
  visit(tree); return tree;
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const carrier of ["direct", "choice", "fallback", "process", "ignored", "inactive"] as const) for (const protection of ["documentProtection", "writeProtection"] as const) for (const enforcement of protection === "documentProtection" ? ["1", "true", "on", "0", "false", "off", undefined, "invalid"] : ["1"]) for (const route of enforcement === "1" ? ["inspect-sdk", "inspect-shell", "settings-sdk", "settings-shell", "model-edit", "sdk-edit", "shell-edit", "sdk-xml", "shell-xml"] as const : ["inspect-sdk", "inspect-shell", "sdk-edit", "shell-edit"] as const) it(`${route} ${protection} in ${carrier}; ${kind} strict=${strict}${enforcement === "1" ? "" : "; enforcement=" + String(enforcement)}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const declaration = `<w:${protection}${protection === "documentProtection" ? ' w:edit="readOnly"' + (enforcement === undefined ? '' : ` w:enforcement="${enforcement}"`) : ' w:recommended="1"'} w:hash="private-hash" w:salt="private-salt"/>`;
  const enforced = protection === "writeProtection" || ["1", "true", "on"].includes(enforcement ?? "") ? true : enforcement === undefined || ["0", "false", "off"].includes(enforcement) ? false : null;
  const edit = protection === "writeProtection" ? null : "readOnly";
  const wrap = (xml: string) => carrier === "direct" ? xml : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="w">${xml}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="x"/><mc:Fallback>${xml}</mc:Fallback></mc:AlternateContent>` : carrier === "inactive" ? `<mc:AlternateContent><mc:Choice Requires="w"/><mc:Fallback>${xml}</mc:Fallback></mc:AlternateContent>` : `<x:${carrier === "process" ? "carrier" : "ignored"}>${xml}</x:${carrier === "process" ? "carrier" : "ignored"}>`;
  const active = carrier !== "ignored" && carrier !== "inactive";
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/reports/body.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/><Override PartName="/reports/policy.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/body.xml"/></Relationships>`,
    "reports/body.xml": `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Harbor survey</w:t></w:r></w:p></w:body></w:document>`,
    "reports/_rels/body.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="policy" Type="${r}/settings" Target="policy.xml"/></Relationships>`,
    "reports/policy.xml": `<w:settings xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:opaque" mc:Ignorable="x" mc:ProcessContent="x:carrier">${wrap(declaration)}</w:settings>`
  }).map(([name, xml]) => [name, encode(xml)]));
  const memory = Volume.fromJSON({"/input": "", "/output": "", "/sentinel": "keep"});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), replacement = encode(new TextDecoder().decode(parts.get("reports/body.xml")).replace("Harbor survey", "Coastal survey"));
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  const context = {...textContext, encoding: {order: "input", compression: "store"} as const, stdout: sink};
  let data: unknown;
  if (route.includes("shell")) {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/sentinel", encode("keep"));
    const command = route === "inspect-shell" ? "inspect /input --json" : route === "settings-shell" ? "settings list /input --json" : route === "shell-edit" ? "text replace /input --find Harbor --with Coastal --first --output - > /output" : "xml set /input --part /reports/body.xml --file /replacement --output - > /output";
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: context.limits})})).exec("docx " + command);
    const reading = route === "inspect-shell" || route === "settings-shell";
    expect(result.exitCode, result.stderr).toBe(!reading && active ? 1 : 0);
    if (reading) data = JSON.parse(result.stdout).data;
    else { expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); if (active) expect(result.stderr).toContain("unsupported-edit"); }
    expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/sentinel")).toEqual(encode("keep"));
  } else if (route === "inspect-sdk") data = await inspectDocument(input, context);
  else if (route === "settings-sdk") data = await inspectDocumentSettings(input, {}, context);
  else {
    const pending = route === "model-edit" ? (async () => {const doc = await Document(input, context); doc.paragraphs[0]!.runs[0]!.text = "Coastal survey"; await doc.save(sink);})() : route === "sdk-edit" ? replaceDocumentText(input, {find: "Harbor", with: "Coastal", first: true, output: "-"}, context) : replaceDocumentXmlPart(input, replacement, {part: "/reports/body.xml", output: "-"}, context);
    if (active) await expect(pending).rejects.toMatchObject({code: "unsupported-edit"}); else await pending;
  }
  if (route.startsWith("inspect")) expect(data).toMatchObject({protected: active && enforced !== false, protection: active ? [{part: "/reports/policy.xml", kind: protection, enforced, edit}] : []});
  else if (route.startsWith("settings")) {
    expect(data).toMatchObject({items: [{details: {protection: active ? [{kind: protection, enforced, edit}] : []}}]});
    expect(JSON.stringify(data)).not.toContain("private-hash"); expect(JSON.stringify(data)).not.toContain("private-salt");
  } else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    if (active) expect(output).toHaveLength(0);
    else {const saved = readPackage(output); for (const [name, bytes] of parts) if (name !== "reports/body.xml") expect(saved.get(name)).toEqual(bytes); if (route.endsWith("xml")) expect(saved.get("reports/body.xml")).toEqual(replacement); else expect(rewrittenStructure(saved.get("reports/body.xml")!)).toEqual(rewrittenStructure(replacement));}
  }
  expect(input).toEqual(original); expect(memory.readFileSync("/input")).toEqual(Buffer.from(original)); expect(memory.readFileSync("/sentinel", "utf8")).toBe("keep");
});
