import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"])
for (const raw of ["+003", " &#x9;+003&#xA; "])
for (const action of ["rename", "remove"])
for (const route of ["sdk", "cli"])
it(`bookmark XML integer identity remains scoped across references; strict=${strict}; ${carrier}; ${raw}; ${action}; ${route}`, async () => {
  const wrap = (value: string) => carrier === "direct" ? value : carrier === "process" ? `<f:pass>${value}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? value : '<f:keep stamp="inert"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : '<f:keep stamp="inert"/>'}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:bookmark" mc:Ignorable="f" mc:ProcessContent="f:pass"><!--range--><?owner retain?>${wrap(`<w:bookmarkStart w:id="${raw}" w:name="Coast"/>`)}<w:r><w:rPr><w:b/></w:rPr><w:t>Original é 海</w:t></w:r>${wrap('<w:bookmarkEnd w:id="3"/>')}</w:p><w:p><w:hyperlink w:anchor="Coast"><w:r><w:t>Link</w:t></w:r></w:hyperlink><w:fldSimple w:instr=" REF Coast "><w:r><w:rPr><w:i/></w:rPr><w:t>Cache</w:t></w:r></w:fldSimple></w:p><w:sectPr/>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const inspect = await api.inspectDocumentBookmarks(input, {}, textContext);
  expect(inspect.issues).toEqual([]); expect(inspect.items).toHaveLength(1); expect(inspect.items[0]).toMatchObject({ name: "Coast", id: "3", issues: [] });
  if (route === "sdk") {
    if (action === "rename") await api.editDocumentBookmarks(input, { operation: "bookmarks.set", options: { bookmark: 1, name: "Estuary", references: "update", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
    else await api.editDocumentBookmarks(input, { operation: "bookmarks.remove", options: { bookmark: 1, references: "remove", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
  } else {
    const args = ["bookmarks", action === "rename" ? "set" : "remove", "/input", "--bookmark", "1", "--references", action === "rename" ? "update" : "remove", ...(action === "rename" ? ["--name", "Estuary"] : []), "--output", "-"];
    const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), current = await api.inspectDocumentBookmarks(output, {}, textContext);
  expect(current.issues).toEqual([]); expect(current.items).toHaveLength(action === "rename" ? 1 : 0);
  const before = readPackage(input), after = readPackage(output); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml).toContain('<!--range--><?owner retain?>'); expect(xml).toContain('<w:rPr><w:b/></w:rPr>'); expect(xml).toContain('<w:rPr><w:i/></w:rPr>');
  if (carrier === "choice" || carrier === "fallback") expect(xml.split('<f:keep stamp="inert"/>')).toHaveLength(3);
  expect((await api.extractDocumentText(output, textContext)).text).toBe("Original é 海\nLinkCache");
  expect((await api.Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(["Original é 海", action === "rename" ? "Link" : "LinkCache"]);
  if (action === "rename") expect((await api.inspectDocumentFields(output, {}, textContext)).items).toMatchObject([{ result: "Cache" }]);
  if (action === "rename") { expect(xml).toContain(`w:id="${raw}"`); expect(xml).toContain('w:anchor="Estuary"'); expect(xml).toContain(' REF Estuary '); }
  else { expect(xml).not.toContain("bookmarkStart"); expect(xml).not.toContain("bookmarkEnd"); expect(xml).not.toContain("fldSimple"); expect(xml).not.toContain("hyperlink"); }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
