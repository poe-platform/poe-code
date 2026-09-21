import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const route of ["sdk", "cli"] as const)
  it(`${route} fills nested template with admitted ${carrier} repeat ancestor properties; ${kind}; strict=${strict}`, async () => {
    const outerProperties = '<w:sdtPr><w:id w:val="1"/><w:tag w:val="groups"/><v:repeatingSection/></w:sdtPr>';
    const wrap = (value: string) => carrier === "process" ? `<u:bridge>${value}</u:bridge>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "u"}">${carrier === "choice" ? value : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : ""}</mc:Fallback></mc:AlternateContent>`;
    const field = '<w:sdt><w:sdtPr><w:id w:val="6"/><w:tag w:val="label"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>{{label}}</w:t></w:r></w:sdtContent></w:sdt>';
    const inner = `<w:sdt><w:sdtPr><w:id w:val="4"/><w:tag w:val="places"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="5"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${field}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
    const input = await textFixture(`<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:nested-repeat-ancestor" mc:Ignorable="u v" mc:ProcessContent="u:bridge">${wrap(outerProperties)}<w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Retained decoration</w:t></w:r></w:p>${inner}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`, {}, strict, { kind });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    const data = [{ values: [{ binding: "places", value: [{ values: [{ binding: "label", value: "Coast 海" }] }, { values: [{ binding: "label", value: "Dune 🌊" }] }] }] }];
    if (route === "sdk") await api.applyDocumentTemplate(input, { data, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", new TextEncoder().encode("Existing destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec(`docx template apply /input --data-json '${JSON.stringify(data)}' --output /output --force --json`);
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 1 });
        memory.writeFileSync("/output", await fs.readFile("/output"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    expect((await api.inspectDocumentControls(output, {}, textContext)).items.filter(item => item.tag === "label").map(item => item.value)).toEqual(["Coast 海", "Dune 🌊"]);
    const before = readPackage(input), after = readPackage(output);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    const xml = new TextDecoder().decode(after.get("word/document.xml"));
    expect(xml).toContain("Retained decoration"); expect(xml).toContain("<w:i/>");
    expect(xml).toContain(wrap(outerProperties));
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
