import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, editDocumentNotes, inspectDocumentNotes, parseDocumentXml, readArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const enc = (text: string) => new TextEncoder().encode(text);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const declarations = `xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"`;
const carriers = ["direct", "choice", "fallback", "process"] as const;
const wrap = (value: string, carrier: typeof carriers[number]) => carrier === "direct" ? value : carrier === "process" ? `<f:pass>${value}</f:pass>` :
  `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? value : '<f:inactive stamp="retain"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : '<f:inactive stamp="retain"/>'}</mc:Fallback></mc:AlternateContent>`;

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const owner of ["document", "section"] as const) for (const level of ["container", "rules"] as const)
for (const route of ["sdk", "cli"] as const) it.each(carriers)(
  `F24 effective ${kind} ${owner} numbering ${level} %s retained on note edit; ${route} strict=${strict}`,
  async carrier => {
    const rules = ['<w:numFmt w:val="upperRoman"/>', '<w:numStart w:val="7"/>', '<w:numRestart w:val="eachPage"/>'];
    const properties = `<w:${kind}Pr>${rules.map(rule => level === "rules" ? wrap(rule, carrier) : rule).join("")}</w:${kind}Pr>`;
    const numbering = level === "container" ? wrap(properties, carrier) : properties;
    const part = kind + "s";
    const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="8"/></w:r></w:p><w:sectPr ${declarations}>${owner === "section" ? numbering : ""}</w:sectPr>`, {
      [part]: { kind: part, xml: `<w:${part} xmlns:w="${w}"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="8"><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Old 海</w:t></w:r></w:p></w:${kind}></w:${part}>` },
      settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}" ${declarations}><!--retain--><?original keep?>${owner === "document" ? numbering : ""}</w:settings>` }
    }, strict);
    const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    const cli = async (args: string[]) => createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: args.map(enc), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
      stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    const expected = { format: "upperRoman", start: 7, restart: "eachPage" };
    if (route === "sdk") {
      const data = await inspectDocumentNotes(input, { operation: "notes.list", options: { kind } }, textContext);
      expect(data.numbering.sections[0]![kind]).toEqual(expected);
      expect(data.numbering.document[kind]).toEqual(owner === "document" ? expected : { format: "decimal", start: 1, restart: "continuous" });
      const result = await editDocumentNotes(input, { operation: "notes.set", options: { kind, note: 1, text: "New 海", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
      expect(result.changes).toHaveLength(1);
    } else {
      expect((await cli(["notes", "list", "/input", "--kind", kind, "--json"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      expect(JSON.parse(volume.readFileSync("/out", "utf8") as string).data.numbering.sections[0][kind]).toEqual(expected);
      volume.writeFileSync("/out", "");
      expect((await cli(["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "New 海", "--output", "-"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = await readArchive(input, textContext), after = await readArchive(output, textContext);
    const omitAssignedParagraph = (xml: string) => {
      const note = xml.indexOf(`<w:${kind} w:id="8">`), start = xml.indexOf("<w:p", note), end = xml.indexOf("</w:p>", start);
      expect(note).toBeGreaterThanOrEqual(0); expect(start).toBeGreaterThan(note); expect(end).toBeGreaterThan(start);
      return xml.slice(0, start) + xml.slice(end + "</w:p>".length);
    };
    for (const member of before.members) {
      const saved = after.members.find(item => item.name === member.name)!.bytes;
      if (member.name === `word/${part}.xml`) {
        expect(omitAssignedParagraph(new TextDecoder().decode(saved))).toBe(omitAssignedParagraph(new TextDecoder().decode(member.bytes)));
        const root = parseDocumentXml(saved).root, note = root.children.find(node => node.attributes.some(attribute => attribute.localName === "id" && attribute.value === "8"))!;
        expect(note.children).toHaveLength(1);
        expect(note.children[0]!.children.flatMap(run => run.children).filter(node => node.namespace === root.namespace && node.localName === kind + "Ref")).toHaveLength(1);
      } else expect(saved).toEqual(member.bytes);
    }
    expect((await inspectDocumentNotes(output, { operation: "notes.list", options: { kind } }, textContext)).items[0]!.text).toBe("New 海");
    expect((await inspectDocumentNotes(output, { operation: "notes.list", options: { kind } }, textContext)).numbering.sections[0]![kind]).toEqual(expected);
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);
