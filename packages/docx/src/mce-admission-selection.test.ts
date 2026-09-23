import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, readArchive, readDocumentArchive, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

async function fixture(body: string, stories: Parameters<typeof textFixture>[1], strict: boolean, kind: "docx" | "dotx") {
  const bytes = await textFixture(body, stories, strict);
  if (kind === "docx") return bytes;
  const parts = readPackage(bytes);
  parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({"/input": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  return new Uint8Array(volume.readFileSync("/input") as Buffer);
}

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const alternate = (requires: string, inner = "", fallback?: string) => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${requires}">${inner}</mc:Choice>${fallback === undefined ? "" : `<mc:Fallback>${fallback}</mc:Fallback>`}</mc:AlternateContent>`;
const rejected = [
  { name: "unknown namespace", xml: alternate("f") },
  { name: "mixed requirements", xml: alternate("w f") },
  { name: "nested active unmatched alternative", xml: alternate("w", alternate("f")) }
];

for (const kind of ["docx", "dotx"] as const) for (const strict of [false, true]) for (const part of ["main", "styles", "header"] as const) for (const route of ["model", "archive", "sdk", "cli", "shell"] as const) it.each(rejected)(
  `${strict ? "Strict" : "Transitional"} ${route} rejects $name in ${part}${kind === "dotx" ? "; dotx" : ""}`,
  async ({ xml }) => {
    const input = await fixture(part === "main" ? xml : '<w:p/>', part === "main" ? {} : {
      [part]: { kind: part, xml: `<w:${part === "header" ? "hdr" : "styles"} xmlns:w="${w}">${xml}</w:${part === "header" ? "hdr" : "styles"}>` }
    }, strict, kind);
    if (route === "model") await expect(Document(input, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
    else if (route === "archive") await expect(readDocumentArchive(input, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
    else if (route === "sdk") await expect(inspectDocument(input, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
    else if (route === "shell") {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input.bin", input);
      const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx inspect /input.bin");
      expect(result.exitCode).toBe(1); expect(result.stderr).toContain("unsupported-profile"); expect(result.stdout).toBe(""); expect(await fs.readFile("/input.bin")).toEqual(input);
    }
    else {
      const volume = Volume.fromJSON({ "/out": "", "/err": "", "/input.docx": Buffer.from(input) });
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["inspect", "/input.docx"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode).toBe(1);
      expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-profile");
      expect(volume.readFileSync("/out")).toHaveLength(0);
      expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    }
  }
);

for (const kind of ["docx", "dotx"] as const) for (const strict of [false, true]) it.each([
  { name: "eligible empty choice", xml: alternate("w") },
  { name: "eligible empty fallback", xml: alternate("f", "", "") },
  { name: "unmatched alternative in an inactive choice", xml: alternate("f", alternate("f"), "") },
  { name: "unmatched alternative in an ignored wrapper", xml: `<f:skip xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f">${alternate("f")}</f:skip>` }
])(`preserves ${strict ? "Strict" : "Transitional"} $name${kind === "dotx" ? "; dotx" : ""}`, async ({ xml }) => {
  const input = await fixture(xml + '<w:p><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict, kind);
  const doc = await Document(input, textContext);
  expect(doc.paragraphs.map(paragraph => paragraph.text)).toEqual(["Original"]);
  expect((await inspectDocument(input, textContext)).counts).toMatchObject({ paragraphs: 1, runs: 1 });
  const volume = Volume.fromJSON({ "/out": "", "/cli": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["inspect", "/input.docx", "--json"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/cli", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  expect(JSON.parse(volume.readFileSync("/cli", "utf8") as string)).toMatchObject({ affected: 0, data: { counts: { paragraphs: 1, runs: 1 } } });
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.bin", input);
  const shellResult = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx inspect /input.bin --json");
  expect(shellResult.exitCode, shellResult.stderr).toBe(0);
  expect(JSON.parse(shellResult.stdout)).toMatchObject({affected: 0, data: {kind, counts: {paragraphs: 1, runs: 1}}});
  expect(await fs.readFile("/input.bin")).toEqual(input);
  await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  const saved = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await Document(saved, textContext)).paragraphs.map(paragraph => paragraph.text)).toEqual(["Original"]);
  const before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
  expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
});

for (const kind of ["docx", "dotx"] as const) for (const strict of [false, true]) it(`rolls back ${strict ? "Strict" : "Transitional"} XML insertion with an unmatched active alternative${kind === "dotx" ? "; dotx" : ""}`, async () => {
  const input = await fixture('<w:p xmlns:f="urn:original:future"><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict, kind);
  const doc = await Document(input, textContext), before = doc.element.serialize(), body = doc.paragraphs[0]!.element;
  expect(() => body.insert(0, { kind: "element", name: { namespaceURI: mc, localName: "AlternateContent" }, children: [
    { kind: "element", name: { namespaceURI: mc, localName: "Choice" }, attributes: [{ name: { namespaceURI: "", localName: "Requires" }, value: "f" }] }
  ] })).toThrowError(expect.objectContaining({ code: "unsupported-profile" }));
  expect(doc.element.serialize()).toEqual(before);
  expect(doc.paragraphs[0]!.text).toBe("Original");
});
