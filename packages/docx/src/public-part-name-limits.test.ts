import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, getDocumentXml, readDocumentArchive, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const spelling of ["ascii", "unicode", "escaped"] as const) for (const route of ["package", "model", "sdk", "shell"] as const) for (const boundary of ["below", "exact", "above"] as const) it(`${route} ${spelling} member path bytes ${boundary}; ${kind} strict=${strict}`, async () => {
  const literal = spelling === "ascii" ? "reports/" + "a".repeat(24) + ".xml" : "reports/" + "海".repeat(8) + ".xml";
  const name = spelling === "escaped" ? literal.split("海").join("%E6%B5%B7") : literal;
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const main = new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Byte boundary</w:t></w:r></w:p></w:body></w:document>`);
  const parts = new Map(Object.entries({
    "[Content_Types].xml": new TextEncoder().encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/></Types>`),
    "_rels/.rels": new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="${name}"/></Relationships>`),
    [name]: main
  }));
  const memory = Volume.fromJSON({"/input": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) { memory.appendFileSync("/input", bytes); }}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const context = {...textContext, limits: {...textContext.limits, maxPathBytes: new TextEncoder().encode(name).length + (boundary === "below" ? -1 : boundary === "above" ? 1 : 0)}};
  if (route === "shell") {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: context.limits})})).exec(`docx xml get /input --part '/${name}' --raw > /raw`);
    expect(result.exitCode, result.stderr).toBe(boundary === "below" ? 4 : 0);
    expect(result.stdout).toBe(""); if (boundary !== "below") expect(await fs.readFile("/raw")).toEqual(main);
    expect(await fs.readFile("/input")).toEqual(original);
  } else {
    const pending = route === "package" ? readDocumentArchive(input, context) : route === "model" ? Document(input, context) : getDocumentXml(input, context, {part: "/" + name, raw: true});
    if (boundary === "below") await expect(pending).rejects.toMatchObject({code: "limit-exceeded"});
    else {
      const result = await pending;
      if (result instanceof Uint8Array) expect(result).toEqual(main);
      else if ("paragraphs" in result) { expect(result.part.blob).toEqual(main); expect(String(result.part.partname)).toBe("/" + literal); }
      else if ("package" in result) {
        expect(result.package.getPart("/" + literal).bytes).toEqual(main);
        expect(result.package.getPart("/" + name).name).toBe(name);
        if (spelling === "unicode") expect(result.package.getPart("/" + literal.split("海").join("%E6%B5%B7")).bytes).toEqual(main);
        expect(() => result.package.getPart("/" + "a".repeat(context.limits.maxPathBytes + 1))).toThrowError(expect.objectContaining({code: "limit-exceeded"}));
      }
    }
  }
  expect(input).toEqual(original); expect(memory.readFileSync("/input")).toEqual(Buffer.from(original));
});
