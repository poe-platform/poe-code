import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, editDocumentNotes, inspectDocumentNotes, readArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const enc = (text: string) => new TextEncoder().encode(text);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const reference of [false, true]) for (const route of ["sdk", "cli"] as const)
for (const renumber of ["preserve", "document-order"] as const)
it(`F24 inactive ${kind} IDs remain reserved and inert references retain their body; reference=${reference} ${renumber} ${route} strict=${strict}`, async () => {
  const part = kind + "s";
  const inactive = `<w:${kind} w:id="1"><w:p><w:r><w:t>Inactive 海</w:t></w:r></w:p></w:${kind}>`;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f"><w:r><w:${kind}Reference w:id="8"/></w:r>${reference ? `<mc:AlternateContent><mc:Choice Requires="f"><w:r><w:${kind}Reference w:id="1"/></w:r></mc:Choice><mc:Fallback/></mc:AlternateContent>` : ""}</w:p>`, {
    [part]: { kind: part, xml: `<w:${part} xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f"><mc:AlternateContent><mc:Choice Requires="w"><w:${kind} w:id="8"><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Active é</w:t></w:r></w:p></w:${kind}></mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent></w:${part}>` }
  }, strict), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "sdk") {
    expect((await inspectDocumentNotes(input, { operation: "notes.list", options: { kind } }, textContext)).items.map(note => note.id)).toEqual([8]);
    const pending = editDocumentNotes(input, { operation: "notes.add", options: { kind, paragraph: 1, text: "New 海", renumber, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    if (reference && renumber === "document-order") await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
    else await pending;
  } else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["notes", "add", "/input", "--kind", kind, "--paragraph", "1", "--text", "New 海", "--renumber", renumber, "--output", "-"].map(enc), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
      stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(reference && renumber === "document-order" ? 1 : 0);
    if (reference && renumber === "document-order") expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit");
  }
  if (reference && renumber === "document-order") { expect(volume.readFileSync("/out", "utf8")).toBe(""); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); return; }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), data = await inspectDocumentNotes(output, { operation: "notes.list", options: { kind } }, textContext);
  expect(data.items.map(note => note.id)).toEqual(renumber === "preserve" ? [2, 8] : [2, 3]);
  expect(data.items.find(note => note.id === (renumber === "preserve" ? 2 : 3))!.text).toBe("New 海");
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const member of before.members) {
    const saved = after.members.find(item => item.name === member.name)!.bytes;
    if (member.name === `word/${part}.xml`) expect(new TextDecoder().decode(saved)).toContain(`<mc:Fallback>${inactive}</mc:Fallback>`);
    else if (member.name !== "word/document.xml") expect(saved).toEqual(member.bytes);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
