import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const)
for (const field of ["body-id", "reference-id", "document-start", "section-start"] as const)
for (const route of ["sdk", "cli"] as const)
it(`note integer XML whitespace and explicit sign are read and preserved; ${kind}; strict=${strict}; ${field}; ${route}`, async () => {
  const raw = " &#x9;+003&#xA; ";
  const props = `<w:${kind}Pr><w:numFmt w:val="upperRoman"/><w:numStart w:val="${field.endsWith("start") ? raw : "3"}"/><w:numRestart w:val="eachSect"/></w:${kind}Pr>`;
  const input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="${field === "reference-id" ? raw : "3"}"/></w:r></w:p><w:sectPr>${field === "section-start" ? props : ""}</w:sectPr>`, {
    [kind + "s"]: {kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="${field === "body-id" ? raw : "3"}"><!--note--><?owner keep?><w:p><w:r><w:${kind}Ref/></w:r><w:r><w:t>Old é 海</w:t></w:r></w:p></w:${kind}></w:${kind}s>`},
    settings: {kind: "settings", xml: `<w:settings xmlns:w="${w}">${field === "document-start" ? props : ""}</w:settings>`}
  }, strict);
  const volume = Volume.fromJSON({"/input": Buffer.from(input), "/out": "", "/err": ""});
  const cli = async (args: string[]) => api.createDocxInspectionCommandEngine({limits: textContext.limits}).execute({
    args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: {async readFile(path) {return new Uint8Array(volume.readFileSync(path) as Buffer);}}, stdin: {async *[Symbol.asyncIterator]() {}},
    stdout: {async write(bytes) {volume.appendFileSync("/out", bytes);}}, stderr: {async write(bytes) {volume.appendFileSync("/err", bytes);}}
  });
  if (route === "sdk") {
    const data = await api.inspectDocumentNotes(input, {operation: "notes.list", options: {kind}}, textContext);
    expect(data.items[0]).toMatchObject({id: 3, text: "Old é 海"}); expect(data.items[0]!.references).toHaveLength(1);
    if (field.endsWith("start")) expect(data.numbering.sections[0]![kind]).toEqual({format: "upperRoman", start: 3, restart: "eachSect"});
    await api.editDocumentNotes(input, {operation: "notes.set", options: {kind, note: 1, text: "New é 海", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {volume.appendFileSync("/out", bytes);}}});
  } else {
    expect((await cli(["notes", "list", "/input", "--kind", kind, "--json"])).exitCode).toBe(0);
    const data = JSON.parse(volume.readFileSync("/out", "utf8") as string).data;
    expect(data.items[0]).toMatchObject({id: 3, text: "Old é 海"}); expect(data.items[0].references).toHaveLength(1);
    if (field.endsWith("start")) expect(data.numbering.sections[0][kind]).toEqual({format: "upperRoman", start: 3, restart: "eachSect"});
    volume.writeFileSync("/out", ""); expect((await cli(["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "New é 海", "--output", "-"])).exitCode).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  expect(after.size).toBe(before.size); for (const [name, bytes] of before) if (name !== `word/${kind}s.xml`) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get(`word/${kind}s.xml`));
  expect(xml).toContain('<!--note--><?owner keep?>');
  if (field === "body-id") expect(xml).toContain(`w:id="${raw}"`);
  expect((await api.inspectDocumentNotes(output, {operation: "notes.list", options: {kind}}, textContext)).items[0]!.text).toBe("New é 海");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
