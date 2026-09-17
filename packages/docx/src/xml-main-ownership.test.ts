import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const relationships = (edges: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${edges}</Relationships>`;
const edge = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
type Action = "move-native" | "move-unrelated" | "remove-unrelated" | "no-op";
async function fixture(strict: boolean, kind: "docx" | "dotx", unrelatedFirst: boolean, action: Action) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const mainType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const root = (changed: boolean) => {
    const main = edge("native", `${r}/officeDocument`, changed && action === "move-native" ? "records/alternate.xml" : "reports/original.xml");
    const unrelated = changed && action === "remove-unrelated" ? "" : edge("unrelated", "urn:original:archive/officeDocument", changed && action === "move-unrelated" ? "records/alternate.xml" : "reports/original.xml");
    return encode(relationships(unrelatedFirst ? unrelated + main : main + unrelated));
  };
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/reports/original.xml" ContentType="${mainType}"/><Override PartName="/records/alternate.xml" ContentType="${mainType}"/></Types>`)],
    ["_rels/.rels", root(false)],
    ["reports/original.xml", encode(`<n:document xmlns:n="${w}"><n:body><n:p><n:r><n:t>Original owner</n:t></n:r></n:p></n:body></n:document>`)],
    ["records/alternate.xml", encode(`<n:document xmlns:n="${w}"><n:body><n:p><n:r><n:t>Different owner</n:t></n:r></n:p></n:body></n:document>`)]
  ]);
  const volume = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(volume.readFileSync("/archive") as Buffer), replacement: root(true), parts };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const unrelatedFirst of [false, true]) for (const route of ["sdk", "cli"] as const) for (const action of ["move-native", "move-unrelated", "remove-unrelated", "no-op"] as const) for (const dryRun of action === "move-native" ? [false, true] : [false]) it(`${route} ${action} ${kind} strict=${strict} unrelatedFirst=${unrelatedFirst} dryRun=${dryRun}`, async () => {
  const { input, replacement, parts } = await fixture(strict, kind, unrelatedFirst, action), original = input.slice();
  const admitted = await Document(input, textContext);
  expect(String(admitted.part.partname)).toBe("/reports/original.xml");
  expect(admitted.paragraphs[0]!.text).toBe("Original owner");
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/replacement": Buffer.from(replacement), "/out": "", "/err": "", "/preexisting": "untouched" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "sdk") {
    const pending = replaceDocumentXmlPart(input, replacement, { part: "/_rels/.rels", ...(dryRun ? { dryRun } : { output: "-" }) }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
    if (action === "move-native") await expect(pending).rejects.toMatchObject({ code: "unsupported-edit", message: "XML replacement cannot rebind the main document part." });
    else expect(await pending).toMatchObject({ changed: action !== "no-op", dryRun: false, output: { path: "-" } });
  } else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["xml", "set", "/input", "--part", "/_rels/.rels", "--file", "/replacement", ...(dryRun ? ["--dry-run"] : ["--output", "-"])].map(encode), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { expect(["/input", "/replacement"]).toContain(path); return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdin: { [Symbol.asyncIterator]() { throw new Error("Unexpected stdin acquisition"); } }, stdout,
      stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    if (action === "move-native") { expect(result.exitCode).toBe(1); expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit"); }
    else expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  if (action === "move-native") expect(volume.readFileSync("/out")).toHaveLength(0);
  else {
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    expect(readPackage(output)).toEqual(new Map([...parts].map(([name, bytes]) => [name, name === "_rels/.rels" ? replacement : bytes])));
    const reloaded = await Document(output, textContext);
    expect(String(reloaded.part.partname)).toBe("/reports/original.xml");
    expect(reloaded.paragraphs.map(paragraph => paragraph.text)).toEqual(["Original owner"]);
  }
  expect(input).toEqual(original); expect(volume.readFileSync("/input")).toEqual(Buffer.from(original)); expect(volume.readFileSync("/replacement")).toEqual(Buffer.from(replacement)); expect(volume.readFileSync("/preexisting", "utf8")).toBe("untouched");
});
