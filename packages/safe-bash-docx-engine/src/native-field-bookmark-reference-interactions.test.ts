import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, editDocumentBookmarks, inspectDocumentBookmarks, inspectDocumentFields, inspectDocumentLinks, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const enc = (text: string) => new TextEncoder().encode(text);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
for (const strict of [false, true]) for (const kind of ["REF", "PAGEREF"])
for (const form of ["simple", "complex"]) for (const route of ["sdk", "cli"])
it.each(["direct", "choice", "fallback", "process"])(
  `F21-F22 ${kind} ${form} reference rename preserves native %s cache and linked label; ${route} strict=${strict}`,
  async carrier => {
    const instruction = ` ${kind} Harbor \\h `, result = '<w:r><w:rPr><w:b/></w:rPr><w:t>7 海</w:t></w:r>';
    const field = form === "simple" ? `<w:fldSimple w:instr="${instruction}" w:dirty="0">${result}</w:fldSimple>` :
      `<w:r><w:fldChar w:fldCharType="begin" w:dirty="0"/></w:r><w:r><w:instrText>${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const wrapped = carrier === "direct" ? field : carrier === "process" ? `<f:pass>${field}</f:pass>` :
      `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? field : '<f:inactive stamp="retain"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? field : '<f:inactive stamp="retain"/>'}</mc:Fallback></mc:AlternateContent>`;
    const input = await textFixture(`<w:p><w:bookmarkStart w:id="7" w:name="Harbor"/><w:r><w:t>Anchor é</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p><w:p xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><!--retain--><?original keep?>${wrapped}<w:hyperlink w:anchor="Harbor"><w:r><w:rPr><w:i/></w:rPr><w:t>Link é</w:t></w:r></w:hyperlink></w:p>`, {}, strict);
    const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    if (route === "sdk") {
      const data = await editDocumentBookmarks(input, { operation: "bookmarks.set", options: { bookmark: 1, name: "Shore", references: "update", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
      expect(data.changes).toHaveLength(1);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["bookmarks", "set", "/input", "--bookmark", "1", "--name", "Shore", "--references", "update", "--output", "-"].map(enc), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = await readArchive(input, textContext), after = await readArchive(output, textContext);
    expect((await inspectDocumentBookmarks(output, {}, textContext)).items.map(item => item.name)).toEqual(["Shore"]);
    const actual = (await inspectDocumentFields(output, {}, textContext)).items[0]!;
    expect(actual.instruction).toContain("Shore"); expect(actual.instruction).toContain("\\h"); expect(actual.instruction).not.toContain("Harbor");
    expect([actual.result, actual.update]).toEqual(["7 海", false]);
    expect((await inspectDocumentLinks(output, {}, textContext)).items[0]).toMatchObject({ fragment: "Shore", text: "Link é" });
    for (const member of before.members) {
      const saved = after.members.find(item => item.name === member.name)!.bytes;
      if (member.name !== "word/document.xml") expect(saved).toEqual(member.bytes);
      else { const xml = new TextDecoder().decode(saved); expect(xml).toContain(result); expect(xml).toContain('<!--retain--><?original keep?>'); if (carrier === "choice" || carrier === "fallback") expect(xml).toContain('<f:inactive stamp="retain"/>'); }
    }
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);
