import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, readDocumentArchive, validateDocumentArchive, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const defect of ["missing target", "missing type"] as const)
it(`retains native relationship diagnostic ownership for ${defect} in ${owner}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p/>', {}, strict)), encode = (xml: string) => new TextEncoder().encode(xml), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const row = `<Relationship Id="audit"${defect === "missing type" ? "" : ' Type="urn:original:audit"'} Target="/absent.xml"/>`;
  parts.set(name, encode(decode(parts.get(name)!).replace('</Relationships>', row + '</Relationships>')));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const archive = {comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))};
  const memory = Volume.fromJSON({"/input": ""});
  await writeArchive(archive, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), expected = {code: "invalid-package", part: "/" + name, ...(defect === "missing type" ? {location: `/Relationship[${owner === "root" ? 2 : 1}]`} : {})};
  await expect(readDocumentArchive(input, textContext)).rejects.toMatchObject(expected);
  await expect(Document(input, textContext)).rejects.toMatchObject(expected);
  expect(validateDocumentArchive(archive).diagnostics).toContainEqual(expect.objectContaining({part: "/" + name, code: "package-structure"}));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
