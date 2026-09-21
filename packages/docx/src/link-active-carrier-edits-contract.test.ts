import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const link = '<w:hyperlink w:anchor="Harbor" w:history="0"><!--link--><?label keep?><w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>海 é עברית</w:t></w:r></w:hyperlink>';
const wrap = (carrier: string) => carrier === "direct" ? link : carrier === "process" ? `<f:pass>${link}</f:pass>` :
  `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? link : '<f:inactive stamp="untouched"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? link : '<f:inactive stamp="untouched"/>'}</mc:Fallback></mc:AlternateContent>`;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const action of ["set", "unwrap", "delete"] as const) for (const route of ["sdk", "cli"])
it(`active link ${action} retains paragraph owner and carriers; ${kind}; strict=${strict}; ${carrier}; ${route}`, async () => {
  const body = `<w:p xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><w:t>Before </w:t></w:r><!--before--><?owner keep?>${wrap(carrier)}<w:r><w:t> After</w:t></w:r></w:p><w:sectPr/>`;
  const {input} = await nativeStoryFixture("document.DocumentPart", strict, kind, body);
  const doc = await api.Document(input, textContext);
  expect(doc.paragraphs[0]!.hyperlinks[0]!.fragment).toBe("Harbor");
  const volume = Volume.fromJSON({"/input": Buffer.from(input), "/out": "", "/err": ""});
  const operation = action === "set" ? "links.set" : "links.remove";
  const sink = {async write(bytes: Uint8Array) {volume.appendFileSync("/out", bytes);}};
  if (route === "sdk") {
    const result = await api.editDocumentLinks(input, {operation, options: {link: 1, output: "-", ...(action === "set" ? {bookmark: "Arrival"} : {deleteContent: action === "delete"})}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    expect(result.changes).toHaveLength(1);
    if (action !== "set") expect(result.changes[0]!.after).toMatchObject({kind: "paragraph", value: {path: [0, 0]}, positions: {paragraph: 1}});
  }
  else {
    const result = await api.createDocxInspectionCommandEngine({limits: textContext.limits}).execute({
      args: ["links", action === "set" ? "set" : "remove", "/input", "--link", "1", "--output", "-", ...(action === "set" ? ["--bookmark", "Arrival"] : action === "delete" ? ["--delete-content"] : [])].map(s => new TextEncoder().encode(s)),
      cwd: "/", signal: textContext.signal, filesystem: {async readFile(path) {return new Uint8Array(volume.readFileSync(path) as Buffer);}}, stdin: {async *[Symbol.asyncIterator]() {}}, stdout: sink, stderr: {async write(bytes) {volume.appendFileSync("/err", bytes);}}
    });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const after = await api.Document(output, textContext);
  expect(after.paragraphs[0]!.text).toBe(action === "delete" ? "Before  After" : "Before 海 é עברית After");
  expect(after.paragraphs[0]!.hyperlinks.length).toBe(action === "set" ? 1 : 0);
  if (action === "set") {
    const h = after.paragraphs[0]!.hyperlinks[0]!; expect(h.fragment).toBe("Arrival"); expect(h.runs[0]!.bold).toBe(true); expect(h.runs[0]!.font.rtl).toBe(true);
  }
  const beforeParts = readPackage(input), afterParts = readPackage(output);
  expect(afterParts.size).toBe(beforeParts.size);
  for (const [name, bytes] of beforeParts) if (name !== "word/document.xml") expect(afterParts.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(afterParts.get("word/document.xml"));
  expect(xml).toContain('<!--before--><?owner keep?>');
  if (action !== "delete") expect(xml).toContain('<!--link--><?label keep?>');
  if (carrier === "choice" || carrier === "fallback") expect(xml).toContain('<f:inactive stamp="untouched"/>');
  if (carrier === "process") expect(xml).toContain('<f:pass>');
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
