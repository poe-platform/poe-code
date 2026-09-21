import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
type Carrier = "direct" | "choice" | "fallback" | "process" | "ignored" | "inactive";
function wrap(carrier: Carrier, value: string): string {
  if (carrier === "direct") return value;
  if (carrier === "process" || carrier === "ignored") return `<u:${carrier === "process" ? "bridge" : "ignored"}>${value}</u:${carrier === "process" ? "bridge" : "ignored"}>`;
  return `<mc:AlternateContent><mc:Choice Requires="${carrier === "fallback" ? "u" : "w"}">${carrier === "choice" ? value : ""}</mc:Choice><mc:Fallback>${carrier === "choice" ? "" : value}</mc:Fallback></mc:AlternateContent>`;
}
function settings(strict: boolean, content: string): string {
  return `<w:settings xmlns:w="${strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w}" xmlns:mc="${mc}" xmlns:u="urn:original:raw-settings" mc:Ignorable="u" mc:ProcessContent="u:bridge">${content}<w:compat><w:compatSetting w:name="retained" w:uri="urn:original:compat" w:val="15"/></w:compat><!--retain--><?audit exact?></w:settings>`;
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "ignored", "inactive"] as const)
for (const change of ["set", "remove", "invalid", "duplicate", "other-setting"] as const)
for (const route of ["sdk", "cli"] as const)
  it(`${route} raw field-update ${change} in ${carrier}; ${kind}; strict=${strict}`, async () => {
    const beforeXml = settings(strict, wrap(carrier, '<w:updateFields w:val="0"/>'));
    const changed = change === "set" ? '<w:updateFields w:val="1"/>' : change === "remove" ? "" : change === "invalid" ? '<w:updateFields w:val="maybe"/>' : change === "duplicate" ? '<w:updateFields w:val="0"/><w:updateFields w:val="1"/>' : '<w:updateFields w:val="0"/><w:embedTrueTypeFonts w:val="1"/>';
    const afterXml = settings(strict, wrap(carrier, changed));
    const input = await textFixture('<w:p><w:r><w:t>Retained 海 🌊</w:t></w:r></w:p>', { settings: { kind: "settings", xml: beforeXml } }, strict, { kind });
    const allowed = !["ignored", "inactive"].includes(carrier) && ["set", "remove"].includes(change);
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    if (route === "sdk") {
      const operation = api.replaceDocumentXmlPart(input, encode(afterXml), { part: "/word/settings.xml", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
      if (allowed) await expect(operation).resolves.toMatchObject({ changed: true });
      else { await expect(operation).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.readFileSync("/output")).toHaveLength(0); }
    } else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", input); await fs.writeFile("/replacement", encode(afterXml)); await fs.writeFile("/output", encode("Existing destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec("docx xml set /input --part /word/settings.xml --file /replacement --output /output --force --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(allowed ? 0 : 1);
        if (allowed) memory.writeFileSync("/output", await fs.readFile("/output"));
        else { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(encode("Existing destination")); }
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    if (allowed) {
      const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
      expect((await api.inspectDocumentSettings(output, {}, textContext)).items[0]!.details.updateFields).toBe(change === "set" ? true : null);
      const before = readPackage(input), after = readPackage(output);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [name, bytes] of before) expect(after.get(name), name).toEqual(name === "word/settings.xml" ? encode(afterXml) : bytes);
    }
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const route of ["sdk", "cli"] as const)
  it(`${route} raw field-update retains inactive unknown content in ${carrier}; ${kind}; strict=${strict}`, async () => {
    const inactive = wrap("inactive", '<w:updateFields w:val="opaque"/><u:metadata u:secret="retained"/>');
    const beforeXml = settings(strict, wrap(carrier, '<w:updateFields w:val="0"/>') + inactive);
    const afterXml = settings(strict, wrap(carrier, '<w:updateFields w:val="1"/>') + inactive);
    const input = await textFixture("<w:p/>", { settings: { kind: "settings", xml: beforeXml } }, strict, { kind });
    const memory = Volume.fromJSON({ "/output": "" });
    if (route === "sdk") await api.replaceDocumentXmlPart(input, encode(afterXml), { part: "/word/settings.xml", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", encode(afterXml));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const result = await shell.exec("docx xml set /input --part /word/settings.xml --file /replacement --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
      finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    const before = readPackage(input), after = readPackage(output);
    for (const [name, bytes] of before) expect(after.get(name), name).toEqual(name === "word/settings.xml" ? encode(afterXml) : bytes);
    expect((await api.inspectDocumentSettings(output, {}, textContext)).items[0]!.details.updateFields).toBe(true);
  });
