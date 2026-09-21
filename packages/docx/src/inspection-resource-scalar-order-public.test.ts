import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["parts", "font-tables", "themes"] as const) for (const route of ["sdk", "cli"] as const)
  it(`${route} package inspection orders native ${resource} by Unicode scalar; ${kind}; strict=${strict}`, async () => {
    const seed = await textFixture('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>', {}, strict, { kind });
    const archive = await api.readArchive(seed, textContext), files = readPackage(seed);
    const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
    const drawing = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
    const type = resource === "font-tables" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml" : resource === "themes" ? "application/vnd.openxmlformats-officedocument.theme+xml" : "application/xml";
    const xml = resource === "font-tables" ? `<w:fonts xmlns:w="${namespace}"><w:font w:name="Original coast"/></w:fonts>` : resource === "themes" ? `<a:theme xmlns:a="${drawing}" name="Original coast"><a:themeElements><a:clrScheme name="Stored"/><a:fontScheme name="Stored"><a:majorFont/><a:minorFont/></a:fontScheme></a:themeElements></a:theme>` : '<resource xmlns="urn:original:inert"/>';
    const names = ["🌊", "豈"], types = new api.DocumentXmlEditor(files.get("[Content_Types].xml")!);
    types.insertChildren(types.root, names.map(name => `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/resources/${name}.xml" ContentType="${type}"/>`).join(""));
    files.set("[Content_Types].xml", types.serialize()); for (const name of names) files.set(`resources/${name}.xml`, encode(xml));
    const memory = Volume.fromJSON({ "/input": "" });
    await api.writeArchive({ ...archive, members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
    let data: api.InspectionData;
    if (route === "sdk") data = await api.inspectDocument(input, textContext);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const result = await shell.exec("docx inspect /input --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); data = JSON.parse(result.stdout).data; expect(await fs.readFile("/input")).toEqual(input); }
      finally { await shell.dispose(); }
    }
    const observed = resource === "parts" ? data.parts.filter(part => part.name.startsWith("/resources/")).map(part => part.name) : resource === "font-tables" ? data.fontResources.fontTables.map(table => table.part) : data.fontResources.themes.map(theme => theme.part);
    expect(observed).toEqual(["/resources/豈.xml", "/resources/🌊.xml"]);
  });
