import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, editDocumentFields, inspectDocumentFields, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
for (const strict of [false, true]) for (const form of ["simple", "complex"] as const)
for (const present of [false, true]) for (const level of ["field", "result"] as const)
for (const route of ["sdk", "cli"] as const) it.each(["direct", "choice", "fallback", "process"] as const)(`F22 native update flag ${form} present=${present} ${level} ${route} strict=${strict} %s`, async carrier => {
  const wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : '<f:keep stamp="inactive"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : '<f:keep stamp="inactive"/>'}</mc:Fallback></mc:AlternateContent>`;
  const text = '<w:t>Harbor é 海</w:t>', result = `<w:r><w:rPr><w:b/></w:rPr>${level === "result" ? wrap(text) : text}</w:r>`, flag = present ? ' w:dirty="0"' : "";
  const field = form === "simple" ? `<w:fldSimple w:instr=" PAGE "${flag}>${result}</w:fldSimple>` : `<w:r><w:fldChar w:fldCharType="begin"${flag}/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><!--retain--><?original flag?>${level === "field" ? wrap(field) : field}</w:p>`, {}, strict), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "sdk") await editDocumentFields(input, { operation: "fields.set", options: { field: 1, update: true, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
  else {
    const r = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["fields", "set", "/input", "--field", "1", "--update", "true", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    expect(r.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  expect((await inspectDocumentFields(output, {}, textContext)).items[0]).toMatchObject({ instruction: " PAGE ", result: "Harbor é 海", update: true, locked: false });
  for (const m of before.members) if (m.name !== "word/document.xml") expect(after.members.find(n => n.name === m.name)!.bytes).toEqual(m.bytes);
  const xml = new TextDecoder().decode(after.members.find(m => m.name === "word/document.xml")!.bytes);
  expect(xml).toContain('<!--retain--><?original flag?>'); expect(xml).toContain(result);
  if (carrier === "choice" || carrier === "fallback") expect(xml).toContain('<f:keep stamp="inactive"/>');
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
