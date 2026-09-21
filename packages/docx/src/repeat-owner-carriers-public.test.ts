import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const site of ["properties", "declarations"] as const)
for (const mode of ["unlocked", "bound", "locked"] as const)
for (const shape of ["block", "row"] as const) for (const route of ["sdk", "cli"] as const)
  it(`${route} repeat ${shape} respects ${mode} owner ${site} in ${carrier}; ${kind}; strict=${strict}`, async () => {
    const wrap = (value: string) => carrier === "process" ? `<u:bridge>${value}</u:bridge>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "u"}">${carrier === "choice" ? value : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : ""}</mc:Fallback></mc:AlternateContent>`;
    const metadata = '<v:repeatingSection/>' + (mode === "bound" ? '<w:dataBinding w:storeItemID="original-store" w:xpath="/record/value"/>' : mode === "locked" ? '<w:lock w:val="sdtContentLocked"/>' : "");
    const properties = `<w:sdtPr><w:id w:val="1"/>${site === "declarations" ? wrap(metadata) : metadata}</w:sdtPr>`;
    const field = '<w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="name"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Original</w:t></w:r></w:sdtContent></w:sdt>';
    const paragraph = `<w:p>${field}</w:p>`;
    const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:repeat-owner" mc:Ignorable="u v" mc:ProcessContent="u:bridge">${site === "properties" ? wrap(properties) : properties}<w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent>${shape === "row" ? `<w:tr><w:tc>${paragraph}</w:tc></w:tr>` : paragraph}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
    const input = await textFixture(shape === "row" ? `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region}</w:tbl>` : region, {}, strict, { kind });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    const data = [{ values: [{ binding: "name", value: "Coast" }] }, { values: [{ binding: "name", value: "Dune" }] }];
    const rejected = mode !== "unlocked";
    if (route === "sdk") {
      const pending = api.editDocumentControlRepeats(input, { control: 1, data, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
      if (rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); else expect((await pending).changed).toBe(true);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", new TextEncoder().encode("Existing destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec(`docx controls repeat /input --control 1 --data-json '${JSON.stringify(data)}' --output /output --force --json`);
        expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
        if (rejected) {
          expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "unsupported-edit" }] });
          expect(await fs.readFile("/output")).toEqual(new TextEncoder().encode("Existing destination"));
        } else memory.writeFileSync("/output", await fs.readFile("/output"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    if (rejected) expect(output).toHaveLength(0);
    else {
      expect((await api.inspectDocumentControls(output, {}, textContext)).items.filter(item => item.tag === "name").map(item => item.value)).toEqual(["Coast", "Dune"]);
      const before = readPackage(input), after = readPackage(output);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
      expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(site === "properties" ? wrap(properties) : properties);
      expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain("<w:i/>");
    }
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
