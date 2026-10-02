import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

// The pinned ST_ContentType schema rejects DEL, C1 controls and non-Latin-1;
// RFC 7231/7230 additionally restrict quoted pairs to HTAB/SP/VCHAR/obs-text.
for (const [point, admitted] of [[9, true], [10, false], [13, false], [32, true], [126, true], [127, false], [128, false], [159, false], [160, true], [233, true], [255, true], [256, false]] as const)
for (const escaped of [false, true]) for (const strict of [false, true])
for (const kind of ["docx", "dotx"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${admitted ? "admits" : "rejects"} quoted media U+${point.toString(16)} escaped=${escaped}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), contentType = 'application/xml; label="' + (escaped ? "\\" : "") + String.fromCharCode(point) + '"';
  const value = contentType.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("\t", "&#9;").replaceAll("\n", "&#10;").replaceAll("\r", "&#13;");
  const parts = readPackage(await textFixture('<w:p/>', {}, strict));
  let declarations = new TextDecoder().decode(parts.get("[Content_Types].xml"));
  if (kind === "dotx") declarations = declarations.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
  parts.set("[Content_Types].xml", encode(declarations.replace("</Types>", `<Override PartName="/records/audit.xml" ContentType="${value}"/></Types>`)));
  parts.set("records/audit.xml", encode("<audit/>"));
  const memory = Volume.fromJSON({"/input": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") {
    if (admitted) expect(await Document(input, textContext)).toBeDefined();
    else await expect(Document(input, textContext)).rejects.toMatchObject({code: "invalid-package"});
  } else if (route === "sdk") {
    if (admitted) expect((await inspectDocument(input, textContext)).parts.find(p => p.name === "/records/audit.xml")?.contentType).toBe(contentType);
    else await expect(inspectDocument(input, textContext)).rejects.toMatchObject({code: "invalid-package"});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx inspect /input --json");
    expect(result.exitCode).toBe(admitted ? 0 : 1);
    const json = JSON.parse(result.stdout);
    if (admitted) expect(json.data.parts.find((p: {name: string}) => p.name === "/records/audit.xml").contentType).toBe(contentType);
    else expect(json).toMatchObject({ok: false, data: null, affected: 0, errors: [expect.objectContaining({code: "invalid-package"})]});
    expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
