import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, editDocumentFields, inspectDocumentFields, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const enc = (text: string) => new TextEncoder().encode(text);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const definitions = ["PAGE", "NUMPAGES", "REF Harbor", "PAGEREF Harbor", "SEQ Figure", 'TOC \\o "1-3"'] as const;
for (const strict of [false, true]) for (const form of ["simple", "complex"] as const)
for (const level of ["field", "result"] as const) for (const route of ["sdk", "cli"] as const)
for (const definition of definitions) it.each(["direct", "choice", "fallback", "process"] as const)(
  `F22-F23 ${definition} ${form} ${level} %s caches edit without flattening compatibility; ${route} strict=${strict}`,
  async carrier => {
    const wrap = (xml: string) => carrier === "direct" ? xml : carrier === "process" ? `<f:pass>${xml}</f:pass>` :
      `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? xml : '<f:inactive stamp="retain"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? xml : '<f:inactive stamp="retain"/>'}</mc:Fallback></mc:AlternateContent>`;
    const text = '<w:t>Old 海</w:t>', result = `<w:r><w:rPr><w:b/></w:rPr>${level === "result" ? wrap(text) : text}</w:r>`;
    const instruction = definition.split('"').join("&quot;");
    const field = form === "simple" ? `<w:fldSimple w:instr=" ${instruction} " w:dirty="0">${result}</w:fldSimple>` :
      `<w:r><w:fldChar w:fldCharType="begin" w:dirty="0"/></w:r><w:r><w:instrText> ${instruction} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><!--retain--><?original keep?>${level === "field" ? wrap(field) : field}</w:p>`, {}, strict);
    const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    expect((await inspectDocumentFields(input, {}, textContext)).items[0]!.result).toBe("Old 海");
    if (route === "sdk") {
      const data = await editDocumentFields(input, { operation: "fields.set", options: { field: 1, result: "New 海", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
      expect(data.changes).toHaveLength(1);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["fields", "set", "/input", "--field", "1", "--result", "New 海", "--output", "-"].map(enc), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = await readArchive(input, textContext), after = await readArchive(output, textContext);
    for (const member of before.members) expect(after.members.find(item => item.name === member.name)!.bytes).toEqual(
      member.name === "word/document.xml" ? enc(new TextDecoder().decode(member.bytes).replace("Old 海", "New 海")) : member.bytes
    );
    expect((await inspectDocumentFields(output, {}, textContext)).items[0]).toMatchObject({ instruction: ` ${definition} `, result: "New 海", update: false });
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);
