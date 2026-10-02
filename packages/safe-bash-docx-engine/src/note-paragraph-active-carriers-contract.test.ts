import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "cli"])
it(`note whole-text assignment edits active paragraph and retains carrier; strict=${strict}; ${kind}; ${carrier}; ${route}`, async () => {
  const paragraph = `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:${kind}Ref/></w:r><w:r><w:t>Old é 海</w:t></w:r></w:p>`;
  const content = carrier === "direct" ? paragraph : carrier === "process" ? `<f:pass>${paragraph}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? paragraph : '<f:keep stamp="inert"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? paragraph : '<f:keep stamp="inert"/>'}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="8"/></w:r></w:p>`, { [kind + "s"]: { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:note-paragraph" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="8"><!--note--><?owner retain?>${content}</w:${kind}></w:${kind}s>` } }, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  expect((await api.inspectDocumentNotes(input, { operation: "notes.get", options: { kind, note: 1 } }, textContext)).items[0]!.text).toBe("Old é 海");
  if (route === "sdk") await api.editDocumentNotes(input, { operation: "notes.set", options: { kind, note: 1, text: "New é 海", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
  else { const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "New é 海", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0); }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), current = await api.inspectDocumentNotes(output, { operation: "notes.get", options: { kind, note: 1 } }, textContext);
  expect(current.items[0]!.text).toBe("New é 海"); expect(current.items[0]!.references).toHaveLength(1); expect(current.separators).toHaveLength(2);
  const before = readPackage(input), after = readPackage(output); for (const [name, bytes] of before) if (name !== `word/${kind}s.xml`) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get(`word/${kind}s.xml`)); expect(xml).toContain('<!--note--><?owner retain?>'); expect(xml).toContain('<w:pPr><w:keepNext/></w:pPr>'); expect(xml).toContain(`<w:${kind}Ref/>`);
  if (carrier === "choice" || carrier === "fallback") expect(xml).toContain('<f:keep stamp="inert"/>');
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
