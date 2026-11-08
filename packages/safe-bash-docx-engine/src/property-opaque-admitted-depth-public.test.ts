import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { nativeRepeatTemplate } from "../tests/native-repeat-template.js";

const executeNative = nativeRepeatTemplate<{
  readonly input: string;
  readonly limits: typeof textContext.limits;
  readonly group: "core" | "extended" | "custom";
  readonly key: string;
  readonly route: string;
  readonly depth: number;
  readonly strict: boolean;
}>(new URL("../../safe-bash-command-docx/tests/tests/fixtures/property-opaque-native.mjs", import.meta.url));

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const group of ["core", "extended", "custom"] as const)
for (const route of group === "core" ? ["sdk", "sdk-batch", "cli", "cli-batch", "model", "model-sdk", "model-cli", "model-cli-quota"] : ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const depth of route === "model-cli-quota" ? [4096] : route.startsWith("model") ? [32, 4096] : [32, 4096, group === "custom" ? 8189 : 8190])
it(`native opaque property read/edit/preserve/refuse; strict=${strict}; kind=${kind}; group=${group}; route=${route}; depth=${depth}`, async () => {
  const files = readPackage(await textFixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Retained coast海🌊</w:t></w:r></w:p>', {}, strict, { kind }));
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const ns = group === "core" ? "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" : office + (strict ? group + "Properties" : group + "-properties");
  const name = `metadata/${group}.xml`, key = group === "core" ? "title" : group === "extended" ? "company" : "Audit";
  const scalar = group === "core" ? '<dc:title>Coast</dc:title>' : group === "extended" ? '<p:Company>Coast</p:Company>' : '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Audit"><v:lpwstr>Coast</v:lpwstr></p:property>';
  const opaque = (group === "custom" ? '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Future"><v:vector>' : '<p:Future>') + '<p:opaque>'.repeat(depth) + 'Never a scalar海🌊' + '</p:opaque>'.repeat(depth) + (group === "custom" ? '</v:vector></p:property>' : '</p:Future>');
  const xml = `<?audit before?><p:${group === "core" ? "coreProperties" : "Properties"} xmlns:p="${ns}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:v="${office}docPropsVTypes">${scalar}${opaque}<!--retain--></p:${group === "core" ? "coreProperties" : "Properties"}><?audit after?>`;
  const types = new DocumentXmlEditor(files.get("[Content_Types].xml")!), rels = new DocumentXmlEditor(files.get("_rels/.rels")!);
  types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${name}" ContentType="${group === "core" ? "application/vnd.openxmlformats-package.core-properties+xml" : `application/vnd.openxmlformats-officedocument.${group}-properties+xml`}"/>`);
  rels.insertChildren(rels.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="metadata" Type="${group === "core" ? "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" : office + "relationships/" + group + "-properties"}" Target="${name}"/>`);
  files.set("[Content_Types].xml", types.serialize()); files.set("_rels/.rels", rels.serialize()); files.set(name, new TextEncoder().encode(xml));
  const limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288, maxRetainedBytes: 536870912 }, memory = Volume.fromJSON({ "/input": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const result = await executeNative({
    input: Buffer.from(input).toString("base64"), limits, group, key, route, depth, strict
  }) as { ok: boolean; output?: string; errorStack?: string };
  expect(result, result.errorStack).toMatchObject({ ok: true, exactSourceAndRefusalDestination: true });
  if (route === "model-cli-quota") { expect(result).toMatchObject({ expectedLimit: "limit-exceeded", zeroPublication: true }); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); return; }
  const after = readPackage(new Uint8Array(Buffer.from(result.output!, "base64")));
  expect([...after.keys()]).toEqual([...files.keys()]);
  expect(new TextDecoder().decode(after.get(name))).toBe(xml.replace("Coast", "Shore"));
  for (const [part, bytes] of files) if (part !== name) expect(after.get(part), part).toEqual(bytes);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
