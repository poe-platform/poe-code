import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createDocxInspectionCommandEngine, validateDocument, writeArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const route of ["sdk", "shell"])
it.each([["external-invalid", false], ["external-empty", true], ["internal-fragment", true],
  ["literal-tag", false], ["opc-declaration", false], ["generic-declaration", true]] as const)(`${route} validates %s without repair; ${kind} strict=${strict}`, async (scenario, valid) => {
  const parts = readPackage(await textFixture('<w:p/>', {}, strict));
  let types = new TextDecoder().decode(parts.get("[Content_Types].xml")!);
  if (kind === "dotx") types = types.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
  if (scenario.startsWith("external") || scenario === "internal-fragment") {
    const target = scenario === "external-invalid" ? "https://example.invalid/%GG" : scenario === "external-empty" ? "" : "#%FF";
    const name = "word/_rels/document.xml.rels";
    parts.set(name, enc(new TextDecoder().decode(parts.get(name)!).replace("</Relationships>", `<Relationship Id="audit" Type="urn:original:audit" Target="${target}" TargetMode="${scenario.startsWith("external") ? "External" : "Internal"}"/></Relationships>`)));
  } else if (scenario === "opc-declaration") {
    parts.set("_rels/.rels", new Uint8Array(Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-16LE"?>' + new TextDecoder().decode(parts.get("_rels/.rels")!), "utf16le")));
  } else {
    const name = scenario === "literal-tag" ? "assets/coast-\u{E0001}.xml" : "assets/generic.xml";
    types = types.replace("</Types>", `<Override PartName="/${name}" ContentType="application/xml"/></Types>`);
    parts.set(name, scenario === "literal-tag" ? enc('<original/>') : new Uint8Array(Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-16LE"?><original/>', "utf16le")));
  }
  parts.set("[Content_Types].xml", enc(types));
  const memory = Volume.fromJSON({ "/input": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") {
    const result = await validateDocument(input, textContext);
    expect(result.valid).toBe(valid); expect(result.profile).toBe("core-v1");
    expect(result.diagnostics.length > 0).toBe(!valid);
    expect(result.checks).toContainEqual({ id: "container", status: "passed" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", enc("retain"));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx validate /input --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(valid ? 0 : 1);
    const envelope = JSON.parse(result.stdout);
    expect(envelope).toMatchObject({ version: 1, operation: "validate", ok: valid, affected: 0 });
    if (valid) expect(envelope).toMatchObject({ data: { valid: true, profile: "core-v1" }, errors: [] });
    else { expect(envelope.data).toBeNull(); expect(envelope.errors).toContainEqual(expect.objectContaining({ code: "invalid-package" })); }
    expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/sentinel")).toEqual(enc("retain"));
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  expect(readPackage(input)).toEqual(parts);
});
