import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocument, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const)
for (const valid of [false, true])
it(`${route} retains exact relationship type encoding or rejects a relative IRI; ${encoding} ${kind} strict=${strict} valid=${valid}`, async () => {
  const encode = (source: string) => new TextEncoder().encode(source);
  const parts = readPackage(await textFixture('<w:p/>', {}, strict));
  const type = valid ? "CUSTOM:原形%2fCase?海" : "相対/path";
  const source = new TextDecoder().decode(parts.get("word/_rels/document.xml.rels")!).replace("</Relationships>", `<Relationship Id="audit" Type="${type}" Target=""/></Relationships>`);
  let bytes = encode(source);
  if (encoding === "UTF-8-BOM") bytes = new Uint8Array([239, 187, 191, ...bytes]);
  if (encoding.startsWith("UTF-16")) { const data = Buffer.from("\ufeff" + source, "utf16le"); if (encoding === "UTF-16BE") data.swap16(); bytes = new Uint8Array(data); }
  parts.set("word/_rels/document.xml.rels", bytes);
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  if (route === "model") {
    if (valid) { const model = await Document(input, textContext); expect(model.part.rels.at("audit").reltype).toBe(type); await model.save(sink); }
    else await expect(Document(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  } else if (route === "sdk") {
    const pending = createDocument({ template: input }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    if (valid) await pending; else await expect(pending).rejects.toMatchObject({ code: "invalid-package" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", encode("sentinel"));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx create --template /input --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(valid ? 0 : 1);
    if (valid) volume.writeFileSync("/output", await fs.readFile("/output"));
    else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] }); expect(await fs.readFile("/output")).toEqual(encode("sentinel")); }
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (valid) { const output = new Uint8Array(volume.readFileSync("/output") as Buffer); expect(readPackage(output)).toEqual(parts); expect((await Document(output, textContext)).part.rels.at("audit").reltype).toBe(type); }
  else expect(volume.readFileSync("/output")).toHaveLength(0);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
