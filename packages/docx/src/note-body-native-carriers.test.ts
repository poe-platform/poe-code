import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, editDocumentNotes, inspectDocumentNotes, readArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const enc = (text: string) => new TextEncoder().encode(text);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const route of ["sdk", "cli"] as const) it.each(["direct", "choice", "fallback", "process"] as const)(
  `F24 active ${kind} body %s has the same reference owner and preserves all parts; ${route} strict=${strict}`,
  async carrier => {
    const part = kind + "s", note = `<w:${kind} w:id="8"><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Owner é 海</w:t></w:r></w:p></w:${kind}>`;
    const body = carrier === "direct" ? note : carrier === "process" ? `<f:pass>${note}</f:pass>` :
      `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? note : '<f:retain stamp="untouched"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? note : '<f:retain stamp="untouched"/>'}</mc:Fallback></mc:AlternateContent>`;
    const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="8"/></w:r></w:p>`, {
      [part]: { kind: part, xml: `<w:${part} xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><!--retain--><?original keep?>${body}</w:${part}>` }
    }, strict), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    const cli = async (args: string[]) => createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: args.map(enc), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
      stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    if (route === "sdk") {
      const data = await inspectDocumentNotes(input, { operation: "notes.list", options: { kind } }, textContext);
      expect(data.items).toHaveLength(1); expect(data.items[0]).toMatchObject({ id: 8, text: "Owner é 海" }); expect(data.items[0]!.references).toHaveLength(1);
      const result = await editDocumentNotes(input, { operation: "notes.set", options: { kind, note: 1, text: "Owner é 海", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
      expect(result.changed).toBe(false); expect(result.changes).toHaveLength(0);
    } else {
      expect((await cli(["notes", "list", "/input", "--kind", kind, "--json"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const data = JSON.parse(volume.readFileSync("/out", "utf8") as string).data;
      expect(data.items).toHaveLength(1); expect(data.items[0]).toMatchObject({ id: 8, text: "Owner é 海" }); expect(data.items[0].references).toHaveLength(1);
      volume.writeFileSync("/out", "");
      expect((await cli(["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "Owner é 海", "--output", "-"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = await readArchive(input, textContext), after = await readArchive(output, textContext);
    expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);
