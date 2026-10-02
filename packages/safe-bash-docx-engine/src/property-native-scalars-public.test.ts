import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
const enc = (value: string) => new TextEncoder().encode(value), dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const widths = [
  ["i1", "127", "128"], ["i2", "32767", "32768"], ["i4", "2147483647", "2147483648"], ["int", "2147483647", "2147483648"],
  ["i8", "9007199254740991", "9007199254740992"], ["ui1", "255", "256"], ["ui2", "65535", "65536"],
  ["ui4", "4294967295", "4294967296"], ["uint", "4294967295", "4294967296"], ["ui8", "9007199254740991", "9007199254740992"]
] as const;
const fields = [
  ...widths.map(([variant, maximum, outside]) => ({ group: "custom" as const, key: "Audit", variant, type: "integer", token: "+007", value: 7, maximum, outside, cached: false })),
  ...["r4", "r8", "decimal"].map(variant => ({ group: "custom" as const, key: "Audit", variant, type: "number", token: "+007.50", value: 7.5, maximum: "12.5", outside: variant === "decimal" ? "1e2" : "INF", cached: false })),
  { group: "custom" as const, key: "Audit", variant: "bool", type: "boolean", token: "true", value: true, maximum: "false", outside: "on", cached: false },
  { group: "core" as const, key: "revision", variant: "revision", type: "integer", token: "+007", value: 7, maximum: "9007199254740991", outside: "9007199254740992", cached: false },
  ...[["pages", "Pages"], ["words", "Words"], ["characters", "Characters"], ["charactersWithSpaces", "CharactersWithSpaces"], ["lines", "Lines"], ["paragraphs", "Paragraphs"], ["totalTime", "TotalTime"]].map(([key, variant]) => ({ group: "extended" as const, key: key!, variant: variant!, type: "integer", token: "+007", value: 7, maximum: "2147483647", outside: "2147483648", cached: true }))
];
async function fixture(strict: boolean, kind: "docx" | "dotx", group: "core" | "extended" | "custom", variant: string, raw: string, pid = "2") {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Unrelated 海🌊</w:t></w:r></w:p>', {}, strict, { kind }));
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const namespace = group === "core" ? "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" : office + (strict ? group + "Properties" : group + "-properties");
  const name = "native/metadata.xml", scalar = group === "custom" ? `<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid}" name="Audit"><v:${variant}>${raw}</v:${variant}></p:property>` : `<p:${variant}>${raw}</p:${variant}>`;
  const retained = group === "custom" ? '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="4" name="Opaque"><v:vector size="1" baseType="lpwstr"><v:lpwstr>Keep海🌊</v:lpwstr></v:vector></p:property>' : '<f:opaque xmlns:f="urn:original:inert">Keep海🌊</f:opaque>';
  const xml = `<p:${group === "core" ? "coreProperties" : "Properties"} xmlns:p="${namespace}" xmlns:v="${office}docPropsVTypes">${scalar}${retained}<!--native retain--><?audit exact?></p:${group === "core" ? "coreProperties" : "Properties"}>`;
  parts.set(name, enc(xml));
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!); types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${name}" ContentType="application/vnd.openxmlformats-${group === "core" ? "package.core" : "officedocument." + group}-properties+xml"/>`); parts.set("[Content_Types].xml", types.serialize());
  const rels = new api.DocumentXmlEditor(parts.get("_rels/.rels")!); rels.insertChildren(rels.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="nativeMetadata" Type="${group === "core" ? "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" : office + "relationships/" + group + "-properties"}" Target="${name}"/>`); parts.set("_rels/.rels", rels.serialize());
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/input") as Buffer), parts, name, xml, memory };
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const field of fields)
for (const route of ["sdk", "cli"] as const) for (const form of ["canonical", "xml-whitespace", "maximum", "outside", "unicode-whitespace", "internal-whitespace"] as const)
it(`native property scalar; strict=${strict}; kind=${kind}; group=${field.group}; variant=${field.variant}; route=${route}; form=${form}`, async () => {
  const raw = form === "canonical" ? field.token : form === "xml-whitespace" ? " &#x9;" + field.token + "&#xA; " : form === "maximum" ? field.maximum : form === "outside" ? field.outside : form === "unicode-whitespace" ? "&#xA0;" + field.token : field.token.slice(0, 1) + " " + field.token.slice(1);
  const valid = ["canonical", "xml-whitespace", "maximum"].includes(form), expected = !valid ? null : form === "maximum" ? field.type === "boolean" ? false : Number(field.maximum) : field.value;
  const { input, parts, name, xml, memory } = await fixture(strict, kind, field.group, field.variant, raw), key = field.group + ":" + field.key;
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: sink };
  const data = await api.inspectDocumentProperties(input, { name: key }, context);
  expect(data.items[0]).toMatchObject({ support: !valid ? "preserve" : field.cached ? "read" : "edit", properties: [{ type: field.type, value: expected, writable: valid && !field.cached, cached: field.cached }] });
  const assigned = valid ? expected as number | boolean : field.value;
  if (route === "sdk") {
    const pending = api.editDocumentProperties(input, { operation: "properties.set", name: key, value: assigned, output: "-" }, context);
    if (valid && !field.cached) { const result = await pending; expect(result.changed).toBe(false); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input); }
    else await expect(pending).rejects.toMatchObject({ code: field.cached ? "usage" : "unsupported-edit" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = enc("Retained destination"); await fs.writeFile("/destination", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const read = await shell.exec(`docx properties get /input --name ${key} --json`); expect(read.exitCode, read.stdout + read.stderr).toBe(0); expect(JSON.parse(read.stdout).data.item.properties[0].value).toBe(expected);
      const result = await shell.exec(`docx properties set /input --name ${key} --value ${assigned} --output /destination --force --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(valid && !field.cached ? 0 : field.cached ? 2 : 1);
      if (valid && !field.cached) { expect(JSON.parse(result.stdout).affected).toBe(0); memory.writeFileSync("/output", await fs.readFile("/destination")); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input); }
      else { expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: field.cached ? "usage" : "unsupported-edit" }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (!valid || field.cached) expect(memory.statSync("/output").size).toBe(0);
  memory.writeFileSync("/output", "");
  await api.editDocumentProperties(input, { operation: "properties.set", name: "core:title", value: "Unrelated title", output: "-" }, context);
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); if (field.group === "core") expect(dec(saved.get(name)!)).toContain(xml.slice(0, xml.lastIndexOf("</p:"))); else expect(dec(saved.get(name)!)).toBe(xml);
  for (const [part, bytes] of parts) if (!["[Content_Types].xml", "_rels/.rels", ...(field.group === "core" ? [name] : [])].includes(part)) expect(saved.get(part), part).toEqual(bytes);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const pid of ["2", "+002", " &#x9;+002&#xA; ", "2147483647", "2147483648", "&#xA0;2", "2 0"])
it(`native custom property ID; strict=${strict}; kind=${kind}; pid=${pid}`, async () => {
  const valid = ["2", "+002", " &#x9;+002&#xA; ", "2147483647"].includes(pid), { input, parts, name, memory } = await fixture(strict, kind, "custom", "i4", "7", pid);
  const pending = api.editDocumentProperties(input, { operation: "properties.set", name: "custom:Audit", value: 8, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
  if (!valid) { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0); }
  else { await pending; const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); expect(dec(saved.get(name)!)).toContain(`pid="${pid}"`); expect(dec(saved.get(name)!)).toContain('<v:i4>8</v:i4>'); for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part), part).toEqual(bytes); }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
