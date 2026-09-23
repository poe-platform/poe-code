import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const api = await compiledPublicRuntime as unknown as typeof compiledTypes;
import type { PropertyValue } from "./property-values.js";
import { textContext as fixtureContext, textFixture, w } from "../tests/fixtures/text.js";


const textContext = { limits: fixtureContext.limits, signal: fixtureContext.signal };

async function transcodeFixture(input: Uint8Array, codec: "utf8" | "utf16le" | "utf16be"): Promise<Uint8Array> {
  const archive = await api.readArchive(input, textContext), memory = Volume.fromJSON({ "/encoded": "" });
  const members = archive.members.map(member => {
    if (codec === "utf8") return member;
    const bytes = Buffer.from("\ufeff" + new TextDecoder().decode(member.bytes), "utf16le");
    if (codec === "utf16be") bytes.swap16();
    return { ...member, bytes: new Uint8Array(bytes) };
  });
  await api.writeArchive({ ...archive, members }, { async write(bytes: Uint8Array) { memory.appendFileSync("/encoded", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/encoded") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const route of ["sdk-batch", "cli", "cli-batch"] as const)
it(`settings ResourceRecord omits unlisted details and retains readonly native scalars/references; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const original = await transcodeFixture(await textFixture('<w:p><w:r><w:t>Body</w:t></w:r></w:p>', { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat><w:compatSetting w:name="layoutMode" w:uri="urn:layout" w:val="15"/></w:compat><w:updateFields w:val="false"/><w:embedTrueTypeFonts/><w:saveSubsetFonts w:val="0"/><w:documentProtection w:enforcement="0" w:hash="secret-hash" w:salt="secret-salt"/></w:settings>` } }, strict, { kind }), codec);
  const archive = await api.readArchive(original, textContext), owner = archive.members.find(member => member.name === "word/_rels/document.xml.rels")!, editor = new api.DocumentXmlEditor(owner.bytes);
  editor.insertChildren(editor.root, '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="z-audit" Type="urn:audit" Target="settings.xml"/><Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="a-audit" Type="urn:audit" Target="settings.xml"/>');
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ ...archive, members: archive.members.map(member => member === owner ? { ...member, bytes: editor.serialize() } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), batch = { version: 1 as const, operations: [{ operation: "settings.list", arguments: {} }] };
  let data: unknown;
  if (route === "sdk-batch") data = (await api.executeDocumentBatch(input, batch, { dryRun: true }, context)).results[0]!.data;
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec((route === "cli" ? "docx settings list /input" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run`) + " --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); data = route === "cli" ? envelope.data : envelope.data.results[0].data; expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const item = (data as { items: { location: compiledTypes.Location; details?: unknown; properties: PropertyValue[]; references: { owner: string; id: string }[] }[] }).items[0]!;
  expect(Object.hasOwn(item, "details")).toBe(false);
  expect(item.properties).toEqual(expect.arrayContaining([{ name: "updateFields", type: "boolean", value: false, writable: false, cached: false }, { name: "embedTrueTypeFonts", type: "boolean", value: true, writable: false, cached: false }, { name: "embedSystemFonts", type: "boolean", value: null, writable: false, cached: false }, { name: "saveSubsetFonts", type: "boolean", value: false, writable: false, cached: false }]));
  expect(item.properties.every(property => !property.writable && !property.cached)).toBe(true);
  expect(JSON.stringify(data)).toContain("layoutMode"); expect(JSON.stringify(data)).toContain("urn:layout"); expect(JSON.stringify(data)).not.toContain("secret-");
  expect(item.references.filter(reference => reference.owner === "/word/document.xml").map(reference => reference.id)).toEqual(["settings", "z-audit", "a-audit"]);
  const document = await api.openDocumentLocations(input, context); expect(document.resolve(item.location.token)).toEqual(item.location);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.statSync("/output").size).toBe(0);
});
