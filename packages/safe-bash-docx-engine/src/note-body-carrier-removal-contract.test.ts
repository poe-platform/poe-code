import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "cli"])
it(`note removal deletes transparent selected body but rejects inactive content deletion; strict=${strict}; ${kind}; ${carrier}; ${route}`, async () => {
  const paragraph = `<w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Owner é 海</w:t></w:r></w:p>`;
  const content = carrier === "direct" ? paragraph : carrier === "process" ? `<f:pass>${paragraph}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? paragraph : '<f:keep stamp="inert"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? paragraph : '<f:keep stamp="inert"/>'}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="8"/></w:r><w:r><w:t>Main é 海</w:t></w:r></w:p>`, { [kind + "s"]: { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:note-removal" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="8">${content}</w:${kind}></w:${kind}s>` } }, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }, reject = carrier === "choice" || carrier === "fallback";
  if (route === "sdk") { const result = api.editDocumentNotes(input, { operation: "notes.remove", options: { kind, note: 1, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout }); if (reject) await expect(result).rejects.toMatchObject({ code: "unsupported-edit" }); else await result; }
  else { const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["notes", "remove", "/input", "--kind", kind, "--note", "1", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(reject ? 1 : 0); if (reject) expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit"); }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  if (reject) { expect(volume.readFileSync("/out")).toHaveLength(0); return; }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), data = await api.inspectDocumentNotes(output, { operation: "notes.list", options: { kind } }, textContext);
  expect(data.items).toHaveLength(0); expect(data.separators).toHaveLength(2); expect((await api.extractDocumentText(output, textContext)).text).toBe("Main é 海");
  const before = readPackage(input), after = readPackage(output); for (const [name, bytes] of before) if (!["word/document.xml", `word/${kind}s.xml`].includes(name)) expect(after.get(name), name).toEqual(bytes);
  expect(new TextDecoder().decode(after.get(`word/${kind}s.xml`))).not.toContain('w:id="8"');
});
