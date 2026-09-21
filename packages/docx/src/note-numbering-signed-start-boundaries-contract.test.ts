import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const owner of ["document", "section"] as const) for (const raw of [" &#x9;+000&#xA; ", "-2", "-9007199254740991", "+9007199254740991"])
for (const carrier of ["direct", "choice", "fallback", "process"]) for (const route of ["sdk", "cli"])
it(`stored native note numbering start ${raw} is exact read-only metadata; ${kind}; ${owner}; ${carrier}; ${route}; strict=${strict}`, async () => {
  const expected = { format: "upperRoman", start: raw.includes("000") ? 0 : Number(raw), restart: "eachSect" };
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:note-start" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const rules = `<w:${kind}Pr><!--numbering--><?rule keep?><w:numFmt w:val="upperRoman"/><w:numStart w:val="${raw}"/><w:numRestart w:val="eachSect"/></w:${kind}Pr>`;
  const inactive = '<f:inert stamp="retained"/>', numbering = carrier === "direct" ? rules : carrier === "process" ? `<f:pass>${rules}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? rules : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? rules : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="3"/></w:r></w:p><w:sectPr ${attrs}>${owner === "section" ? numbering : ""}</w:sectPr>`, {
    [kind + "s"]: { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="3"><!--note--><?body keep?><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:${kind}Ref/></w:r><w:r><w:t>Old é 海</w:t></w:r></w:p></w:${kind}></w:${kind}s>` },
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}" ${attrs}>${owner === "document" ? numbering : ""}</w:settings>` }
  }, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "", "/model": "" });
  const model = await api.Document(input, textContext);
  await model.save({ async write(b) { volume.appendFileSync("/model", b); } });
  expect(readPackage(new Uint8Array(volume.readFileSync("/model") as Buffer))).toEqual(readPackage(input));
  const cli = async (args: string[]) => api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(p) { return new Uint8Array(volume.readFileSync(p) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(b) { volume.appendFileSync("/out", b); } }, stderr: { async write(b) { volume.appendFileSync("/err", b); } }
  });
  const observe = (data: api.NoteReadData) => {
    expect(data.items[0]).toMatchObject({ id: 3, text: "Old é 海" });
    expect(data.numbering.sections[0]![kind]).toEqual(expected);
    expect(data.numbering.document[kind]).toEqual(owner === "document" ? expected : { format: "decimal", start: 1, restart: "continuous" });
  };
  if (route === "sdk") {
    observe(await api.inspectDocumentNotes(input, { operation: "notes.list", options: { kind } }, textContext));
    await api.editDocumentNotes(input, { operation: "notes.set", options: { kind, note: 1, text: "New é 海", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(b) { volume.appendFileSync("/out", b); } } });
  } else {
    expect((await cli(["notes", "list", "/input", "--kind", kind, "--json"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    observe(JSON.parse(volume.readFileSync("/out", "utf8") as string).data);
    volume.writeFileSync("/out", "");
    expect((await cli(["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "New é 海", "--output", "-"])).exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  expect(after.size).toBe(before.size);
  for (const [part, bytes] of before) if (part !== `word/${kind}s.xml`) expect(after.get(part), part).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get(`word/${kind}s.xml`));
  expect(xml).toContain('<!--note--><?body keep?>');
  expect(xml).toContain('<w:pPr><w:keepNext/></w:pPr>');
  expect(xml).toContain(`<w:${kind}Ref`);
  const data = await api.inspectDocumentNotes(output, { operation: "notes.list", options: { kind } }, textContext);
  expect(data.items[0]!.text).toBe("New é 海"); expect(data.numbering.sections[0]![kind]).toEqual(expected);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
