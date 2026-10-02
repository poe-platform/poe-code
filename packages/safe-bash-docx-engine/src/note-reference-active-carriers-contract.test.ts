import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const action of ["set", "remove", "renumber"] as const) for (const route of ["sdk", "cli"])
it(`active ${kind} reference ${carrier} retains run owner during ${action}; strict=${strict}; ${route}`, async () => {
  const reference = `<w:${kind}Reference w:id="8"/>`;
  const wrapped = carrier === "direct" ? reference : carrier === "process" ? `<f:pass>${reference}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? reference : '<f:inactive stamp="retain"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? reference : '<f:inactive stamp="retain"/>'}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><!--run--><?owner keep?>${wrapped}<w:t>Retained</w:t></w:r></w:p><w:sectPr/>`, {
    [kind + "s"]: {kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="8"><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Old Sea</w:t></w:r></w:p></w:${kind}></w:${kind}s>`}
  }, strict);
  const data = await api.inspectDocumentNotes(input, {operation: "notes.list", options: {kind}}, textContext);
  expect(data.items[0]!.references).toHaveLength(1);
  const volume = Volume.fromJSON({"/input": Buffer.from(input), "/out": "", "/err": ""});
  const request: api.NoteEditRequest = action === "set"
    ? {operation: "notes.set", options: {kind, note: 1, output: "-", text: "New Sea"}}
    : action === "renumber"
      ? {operation: "notes.add", options: {kind, paragraph: 1, output: "-", text: "Added Sea", renumber: "document-order"}}
      : {operation: "notes.remove", options: {kind, note: 1, output: "-"}};
  if (route === "sdk") await api.editDocumentNotes(input, request, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {volume.appendFileSync("/out", bytes);}}});
  else {
    const result = await api.createDocxInspectionCommandEngine({limits: textContext.limits}).execute({
      args: ["notes", action === "set" ? "set" : action === "renumber" ? "add" : "remove", "/input", "--kind", kind, ...(action === "renumber" ? ["--paragraph", "1"] : ["--note", "1"]), "--output", "-", ...(action === "set" ? ["--text", "New Sea"] : action === "renumber" ? ["--renumber", "document-order", "--text", "Added Sea"] : [])].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
      filesystem: {async readFile(path) {return new Uint8Array(volume.readFileSync(path) as Buffer);}}, stdin: {async *[Symbol.asyncIterator]() {}}, stdout: {async write(bytes) {volume.appendFileSync("/out", bytes);}}, stderr: {async write(bytes) {volume.appendFileSync("/err", bytes);}}
    }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), afterData = await api.inspectDocumentNotes(output, {operation: "notes.list", options: {kind}}, textContext);
  expect(afterData.items).toHaveLength(action === "set" ? 1 : action === "renumber" ? 2 : 0);
  if (action === "set") {expect(afterData.items[0]!.text).toBe("New Sea"); expect(afterData.items[0]!.references).toHaveLength(1);}
  if (action === "renumber") expect(afterData.items.map(n => [n.id, n.text, n.references.length])).toEqual([[1, "Old Sea", 1], [2, "Added Sea", 1]]);
  expect((await api.extractDocumentText(output, textContext)).text).toBe("Retained");
  const before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== `word/${kind}s.xml` && (action === "set" || name !== "word/document.xml")) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml).toContain('<!--run--><?owner keep?>');
  if (carrier === "choice" || carrier === "fallback") expect(xml).toContain('<f:inactive stamp="retain"/>');
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
