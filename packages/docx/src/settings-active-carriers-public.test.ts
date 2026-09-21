import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "ignored", "inactive"] as const)
for (const value of ["1", "0", "invalid"] as const) for (const route of ["sdk", "cli"] as const)
  it(`${route} reads active settings booleans ${value} in ${carrier}; ${kind}; strict=${strict}`, async () => {
    const declaration = `<w:updateFields w:val="${value}"/><w:embedTrueTypeFonts w:val="${value}"/><w:embedSystemFonts w:val="${value}"/><w:saveSubsetFonts w:val="${value}"/><w:compat><w:compatSetting w:name="layoutMode" w:uri="urn:original:layout" w:val="15"/></w:compat>`;
    const body = carrier === "direct" ? declaration : carrier === "process" || carrier === "ignored" ? `<u:${carrier === "process" ? "bridge" : "ignored"}>${declaration}</u:${carrier === "process" ? "bridge" : "ignored"}>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "fallback" ? "u" : "w"}">${carrier === "choice" ? declaration : ""}</mc:Choice><mc:Fallback>${carrier === "choice" ? "" : declaration}</mc:Fallback></mc:AlternateContent>`;
    const input = await textFixture('<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>', { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:settings-carrier" mc:Ignorable="u" mc:ProcessContent="u:bridge">${body}<!--retain--><?audit exact?></w:settings>` } }, strict, { kind });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    let data: api.SettingsListData;
    if (route === "sdk") {
      data = await api.inspectDocumentSettings(input, {}, textContext);
      await api.replaceDocumentText(input, { find: "Retained body", with: "Changed body", first: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const read = await shell.exec("docx settings list /input --json");
        expect(read.exitCode, read.stdout + read.stderr).toBe(0); data = JSON.parse(read.stdout).data;
        const result = await shell.exec("docx text replace /input --find 'Retained body' --with 'Changed body' --first --output /output --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        memory.writeFileSync("/output", await fs.readFile("/output"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    const hidden = carrier === "ignored" || carrier === "inactive";
    const expected = hidden || value === "invalid" ? null : value === "1";
    expect(data.items).toHaveLength(1);
    expect(data.items[0]!.details).toMatchObject({ updateFields: expected, fontEmbedding: { embedTrueTypeFonts: expected, embedSystemFonts: expected, saveSubsetFonts: expected } });
    const xml = new api.DocumentXmlEditor(readPackage(input).get("word/settings.xml")!);
    const entries = data.items[0]!.details.entries.filter(entry => ["updateFields", "embedTrueTypeFonts", "embedSystemFonts", "saveSubsetFonts", "compat", "compatSetting"].includes(entry.localName));
    expect(entries).toHaveLength(6);
    for (const entry of entries) {
      expect(entry.status).toBe(hidden ? "opaque" : "stored");
      let node = xml.root; for (const index of entry.path) node = node.children[index]!;
      expect(node.localName).toBe(entry.localName); expect(node.namespace).toBe(entry.namespace);
    }
    const before = readPackage(input), after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const duplicate of [false, true]) for (const route of ["sdk", "cli"] as const)
  it(`${route} distinguishes active duplicates from inactive settings lookalikes; duplicate=${duplicate}; ${kind}; strict=${strict}`, async () => {
    const input = await textFixture("<w:p/>", { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:updateFields w:val="1"/><mc:AlternateContent><mc:Choice Requires="w">${duplicate ? '<w:updateFields w:val="0"/>' : ""}</mc:Choice><mc:Fallback><w:updateFields w:val="0"/></mc:Fallback></mc:AlternateContent></w:settings>` } }, strict, { kind });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input) });
    let data: api.SettingsListData;
    if (route === "sdk") data = await api.inspectDocumentSettings(input, {}, textContext);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec("docx settings list /input --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        data = JSON.parse(result.stdout).data; expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    expect(data.items[0]!.details.updateFields).toBe(duplicate ? null : true);
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
