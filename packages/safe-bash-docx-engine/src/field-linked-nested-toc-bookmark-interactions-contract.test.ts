import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const outer of ["simple", "complex"])
for (const inner of ["simple", "complex"]) for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "cli"])
it(`nested linked TOC permits inner cache and literal bookmark rename while preserving outer rejection; ${outer}/${inner}; ${carrier}; ${route}; strict=${strict}`, async () => {
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:nested-toc" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const field = (form: string, instruction: string, cache: string) => form === "simple" ? `<w:fldSimple w:instr="${instruction.split('"').join('&quot;')}" w:dirty="0" w:fldLock="1">${cache}</w:fldSimple>` : `<w:r><w:fldChar w:fldCharType="begin" w:dirty="0" w:fldLock="1"/><w:instrText>${instruction}</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>${cache}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const cachedPage = field(inner, ' PAGEREF "Coast" \\h ', '<w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>12</w:t></w:r>');
  const link = `<w:hyperlink w:anchor="Coast" w:history="${strict ? "0" : "off"}"><!--link--><?link keep?>${cachedPage}</w:hyperlink>`;
  const inert = '<f:inert stamp="retained"/>', linkedPage = carrier === "direct" ? link : carrier === "process" ? `<f:pass>${link}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? link : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? link : inert}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p><w:bookmarkStart w:id="11" w:name="Coast"/><w:r><w:t>Target</w:t></w:r><w:bookmarkEnd w:id="11"/></w:p><w:p ${attrs}><!--TOC--><?owner keep?>${field(outer, ' TOC \\o "1-3" \\h \\z ', '<w:r><w:t>Coast </w:t></w:r>' + linkedPage)}</w:p>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const sink = { async write(b: Uint8Array) { volume.appendFileSync("/out", b); } };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const cli = async (args: string[]) => api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(p) { return new Uint8Array(volume.readFileSync(p) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
    stderr: { async write(b) { volume.appendFileSync("/err", b); } }
  });
  const observe = async (bytes: Uint8Array, result: string, target = "Coast") => {
    const data = await api.inspectDocumentFields(bytes, {}, textContext);
    expect(data.items.map(f => [f.kind, f.result, f.update, f.locked])).toEqual([["TOC", "Coast " + result, false, true], ["PAGEREF", result, false, true]]);
    expect(data.items[0]!.nested).toHaveLength(1);
    expect(data.items[1]!.instruction).toBe(` PAGEREF "${target}" \\h `);
    expect((await api.inspectDocumentLinks(bytes, {}, textContext)).items[0]).toMatchObject({ fragment: target, history: false, url: "" });
  };
  await observe(input, "12");
  if (route === "sdk") await api.editDocumentFields(input, { operation: "fields.set", options: { field: 2, result: "14", output: "-" } }, context);
  else expect((await cli(["fields", "set", "/input", "--field", "2", "--result", "14", "--output", "-"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  const edited = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(edited);
  expect(after.size).toBe(before.size); for (const [part, bytes] of before) expect(after.get(part), part).toEqual(part === "word/document.xml" ? new TextEncoder().encode(new TextDecoder().decode(bytes).replace('>12<', '>14<')) : bytes);
  await observe(edited, "14"); volume.writeFileSync("/out", ""); volume.writeFileSync("/input", Buffer.from(edited));
  if (route === "sdk") await api.editDocumentBookmarks(edited, { operation: "bookmarks.set", options: { bookmark: 1, name: "Bay", references: "update", output: "-" } }, context);
  else expect((await cli(["bookmarks", "set", "/input", "--bookmark", "1", "--name", "Bay", "--references", "update", "--output", "-"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  const renamed = new Uint8Array(volume.readFileSync("/out") as Buffer); await observe(renamed, "14", "Bay");
  const renamedParts = readPackage(renamed);
  for (const [part, bytes] of after) {
    const xml = new TextDecoder().decode(bytes);
    const expected = xml.replace('w:name="Coast"', 'w:name="Bay"').replace('w:anchor="Coast"', 'w:anchor="Bay"').replace('PAGEREF &quot;Coast&quot;', 'PAGEREF &quot;Bay&quot;').replace('PAGEREF "Coast"', 'PAGEREF "Bay"');
    expect(renamedParts.get(part), part).toEqual(part === "word/document.xml" ? new TextEncoder().encode(expected) : bytes);
  }
  volume.writeFileSync("/out", ""); volume.writeFileSync("/input", Buffer.from(renamed));
  if (route === "sdk") await expect(api.editDocumentFields(renamed, { operation: "toc.set", options: { field: 1, text: "flatten", output: "-" } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  else {
    expect((await cli(["toc", "set", "/input", "--field", "1", "--text", "flatten", "--output", "-"])).exitCode).toBe(1);
    expect(volume.readFileSync("/err", "utf8") as string).toContain("unsupported-edit");
  }
  expect(volume.readFileSync("/out", "utf8")).toBe(""); expect(volume.readFileSync("/input")).toEqual(Buffer.from(renamed));
  await observe(renamed, "14", "Bay");
});
