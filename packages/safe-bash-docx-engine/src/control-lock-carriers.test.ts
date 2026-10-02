import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, replaceDocumentText, replaceDocumentXmlPart, writeArchive, type XmlElementView } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const carrier of ["direct", "choice", "fallback", "process", "ignored", "inactive"] as const) for (const position of ["properties", "lock"] as const) for (const route of ["inspect-sdk", "inspect-shell", "model-xml", "sdk-edit", "shell-edit", "sdk-xml", "shell-xml"] as const) it(`${route} control ${position} in ${carrier}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const wrap = (xml: string) => carrier === "direct" ? xml : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="w">${xml}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="x"/><mc:Fallback>${xml}</mc:Fallback></mc:AlternateContent>` : carrier === "inactive" ? `<mc:AlternateContent><mc:Choice Requires="w"/><mc:Fallback>${xml}</mc:Fallback></mc:AlternateContent>` : `<x:${carrier === "process" ? "carrier" : "ignored"}>${xml}</x:${carrier === "process" ? "carrier" : "ignored"}>`;
  const lock = '<w:lock w:val="sdtContentLocked"/>', properties = position === "properties" ? wrap(`<w:sdtPr>${lock}</w:sdtPr>`) : `<w:sdtPr>${wrap(lock)}</w:sdtPr>`;
  const control = `<w:sdt>${properties}<w:sdtContent><w:p><w:r><w:t>Harbor survey</w:t></w:r></w:p></w:sdtContent></w:sdt>`;
  const active = carrier !== "ignored" && carrier !== "inactive";
  const main = `<w:document xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:opaque" mc:Ignorable="x" mc:ProcessContent="x:carrier"><w:body><w:p><w:r><w:t>Unrelated</w:t></w:r></w:p>${control}</w:body></w:document>`;
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/reports/body.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/body.xml"/></Relationships>`,
    "reports/body.xml": main
  }).map(([name, xml]) => [name, encode(xml)]));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const context = {...textContext, encoding: {order: "input", compression: "store"} as const, stdout: {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}}};
  if (route.startsWith("inspect")) {
    let data;
    if (route === "inspect-sdk") data = await inspectDocument(input, context);
    else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: context.limits})})).exec("docx inspect /input --json"); expect(result.exitCode, result.stderr).toBe(0); data = JSON.parse(result.stdout).data; expect(await fs.readFile("/input")).toEqual(original);}
    expect(data).toMatchObject({protected: active, protection: active ? [{part: "/reports/body.xml", kind: "lock", enforced: true, edit: "sdtContentLocked"}] : []});
  } else for (const unrelated of [false, true]) {
    memory.writeFileSync("/output", "");
    // Raw/model XML uses the contract's lock-closed route without a preservation baseline.
    const find = unrelated ? "Unrelated" : "Harbor survey", replacement = encode(main.replace(find, "Changed")), reject = active && (!unrelated || route.endsWith("xml"));
    if (route.startsWith("shell")) {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement);
      const command = route === "shell-edit" ? `text replace /input --find '${find}' --with Changed --first --output -` : "xml set /input --part /reports/body.xml --file /replacement --output -";
      const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: context.limits})})).exec("docx " + command + " > /output");
      expect(result.exitCode, result.stderr).toBe(reject ? 1 : 0); expect(result.stdout).toBe(""); if (reject) expect(result.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(original);
    } else {
      const pending = route === "model-xml" ? (async () => {
        const doc = await Document(input, context);
        const findText = (node: XmlElementView): XmlElementView | undefined => node.localName === "t" && node.text === find ? node : node.children.map(findText).find(Boolean);
        const text = findText(doc.element); expect(text).toBeDefined(); text!.text = "Changed"; await doc.save(context.stdout);
      })() : route === "sdk-edit" ? replaceDocumentText(input, {find, with: "Changed", first: true, output: "-"}, context) : replaceDocumentXmlPart(input, replacement, {part: "/reports/body.xml", output: "-"}, context);
      if (reject) await expect(pending).rejects.toMatchObject({code: "unsupported-edit"}); else await pending;
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    if (reject) expect(output).toHaveLength(0);
    else {const saved = readPackage(output); for (const [name, bytes] of parts) if (name !== "reports/body.xml") expect(saved.get(name)).toEqual(bytes); const body = new TextDecoder().decode(saved.get("reports/body.xml")); expect(body).toContain("Changed"); expect(body).toContain(properties); if (unrelated) expect(body).toContain(control);}
  }
  expect(input).toEqual(original); expect(memory.readFileSync("/input")).toEqual(Buffer.from(original));
});
