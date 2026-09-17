import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { createDocxInspectionCommandEngine, encodeLocation, getDocumentXml, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const parameter of ["", ";audit=coast", '; audit="coast; dune"'] as const)
for (const change of ["noop", "zoom", "field-update", "replace-global", "remove-global"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} ${change} preserves global math with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", m = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : "http://schemas.openxmlformats.org/officeDocument/2006/math", encode = (text: string) => new TextEncoder().encode(text);
  const math = '<m:mathPr><m:mathFont m:val="Original Coast"/><!--keep--></m:mathPr>', xml = `<w:settings xmlns:w="${w}" xmlns:m="${m}"><w:zoom w:percent="100"/><w:updateFields w:val="false"/>${math}<?keep settings?></w:settings>`, type = "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml" + parameter;
  const replacement = encode(change === "noop" ? xml : change === "field-update" ? xml.replace('w:val="false"', 'w:val="true"') : change === "zoom" ? xml.replace('w:percent="100"', 'w:percent="125"') : change === "replace-global" ? xml.replace("Original Coast", "Changed Coast") : xml.replace(math, "")), rejected = change === "zoom" || change === "replace-global" || change === "remove-global";
  const parts = readPackage(await chartFixture({strict, definitions: [], resources: [{name: "audit/settings.xml", type, bytes: xml}]})); parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const value = {version: 1 as const, sourceSha256: createHash("sha256").update(input).digest("hex"), generation: 0, part: "/audit/settings.xml", story: "/audit/settings.xml", path: [2], range: null};
  const location = {kind: "part", token: encodeLocation(value), value, positions: {}};
  if (route === "sdk") {
    expect(await getDocumentXml(input, chartContext, {part: "/audit/settings.xml", raw: true})).toEqual(encode(xml));
    const edit = replaceDocumentXmlPart(input, replacement, {part: "/audit/settings.xml", output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
    if (rejected) await expect(edit).rejects.toMatchObject({code: "unsupported-edit", ...(change === "zoom" ? {} : {location, locations: [location]})}); else expect((await edit).changed).toBe(change !== "noop");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement.xml", replacement); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
    const read = await shell.exec("docx xml get /input --part /audit/settings.xml --raw > /raw"); expect(read.exitCode, read.stderr).toBe(0); expect(await fs.readFile("/raw")).toEqual(encode(xml));
    if (rejected && change !== "zoom") {const diagnosed = await shell.exec("docx xml set /input --part /audit/settings.xml --file /replacement.xml --dry-run --json"); expect(diagnosed.exitCode, diagnosed.stderr).toBe(1); expect(JSON.parse(diagnosed.stdout)).toMatchObject({ok: false, data: null, affected: 0, locations: [location], errors: [{code: "unsupported-edit", location: location.token}]});}
    const edit = await shell.exec("docx xml set /input --part /audit/settings.xml --file /replacement.xml --output - > /output"); expect(edit.exitCode, edit.stderr).toBe(rejected ? 1 : 0); if (rejected) expect(edit.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  if (rejected) expect(output.length).toBe(0); else {const saved = readPackage(output); for (const [name, bytes] of parts) expect(saved.get(name), name).toEqual(name === "audit/settings.xml" ? replacement : bytes);}
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
