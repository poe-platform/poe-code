import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { createPptxCommandEngine, createPresentation, mutateProperty, mutateTags, readProperties, readTags } from "pptx";
import { compileJsonSchema } from "toolcraft-schema";
import { SaxesParser } from "saxes";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
before(() => { const timer = globalThis.setTimeout; mock.method(globalThis, "setTimeout", ((fn: () => void, delay: number) => delay === 0 ? setImmediate(fn) : timer(fn, delay)) as typeof setTimeout); });
after(() => mock.restoreAll());

for (const security of [
  { name: "an orphan macro content type", part: "payload.bin", contentType: "application/vnd.ms-office.vbaProject" },
  { name: "an orphan macro part name", part: "ppt/vbaProject.bin", contentType: "application/octet-stream" },
  { name: "an orphan signature content type", part: "seal.xml", contentType: "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml" },
  { name: "an orphan signature directory", part: "_xmlsignatures/seal.xml", contentType: "application/xml" },
  { name: "an orphan classification label content type", part: "classification.xml", contentType: "application/vnd.ms-office.classificationlabels+xml" },
  { name: "presentation modification protection", part: undefined, contentType: undefined }
]) {
  test(`pptx property mutation refuses ${security.name} in an ordinary presentation suffix`, async () => {
    const parts = new Map<string, Uint8Array>(inspectZip(await createPresentation({ slides: [{ name: "Orchard" }] }, context)).map(member => [member.name, member.payload]));
    const target = security.part === undefined ? "ppt/presentation.xml" : "[Content_Types].xml";
    const document = parseXmlPart(parts.get(target)!, context.xmlLimits);
    const markup = security.part === undefined
      ? '<p:modifyVerifier xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" cryptProviderType="rsaAES"/>'
      : `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${security.part}" ContentType="${security.contentType}"/>`;
    parts.set(target, document.spliceChildren(document.root, document.root.children.length, 0, [markup]).bytes());
    if (security.part !== undefined) parts.set(security.part, new TextEncoder().encode('<opaque xmlns="urn:original:orchard"/>'));
    const bytes = storedArchive([...parts].map(([name, payload]) => ({ name, bytes: payload })));
    const volume = Volume.fromJSON({ "/work/orchard deck.pptx": Buffer.from(bytes) });
    const fs = new MemoryFileSystem();
    fs.readStream = async function* (path, options) { options?.signal?.throwIfAborted(); yield new Uint8Array(volume.readFileSync(path) as Buffer); };
    const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 262144 }) }));
    try {
      const result = await shell.exec("pptx properties set 'orchard deck.pptx' --name title --value Changed --output - --force");
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdoutBytes.length, 0);
      assert.ok(result.stderr.includes("unsupported-edit"), result.stderr);
      const dryRun = await shell.exec("pptx properties set 'orchard deck.pptx' --name title --value Changed --dry-run --json");
      assert.equal(dryRun.exitCode, 1, dryRun.stdout + dryRun.stderr);
      const envelope = JSON.parse(dryRun.stdout);
      assert.equal(envelope.errors[0].code, "unsupported-edit");
      assert.equal(envelope.affected, 0);
      assert.deepEqual(volume.readFileSync("/work/orchard deck.pptx"), Buffer.from(bytes));
      assert.deepEqual(volume.readdirSync("/work"), ["orchard deck.pptx"]);
    } finally { await shell.dispose(); }
  });
}

test("pptx properties and tags retain SDK values through shell quoting, schemas and dry runs", async () => {
  let bytes = await createPresentation({ slides: [{ name: "Garden" }] }, context);
  bytes = (await mutateProperty(bytes, "set", { name: "title", value: "", type: "string" }, context)).bytes;
  bytes = (await mutateTags(bytes, "add", { scope: "presentation", name: "Seed count", value: "twelve & one" }, context)).bytes;
  const volume = Volume.fromJSON({ "/work": null });
  volume.writeFileSync("/work/field deck.pptx", bytes);
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) { options?.signal?.throwIfAborted(); yield new Uint8Array(volume.readFileSync(path) as Buffer); };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 262144 }) }));
  try {
    const title = await shell.exec("pptx properties get 'field deck.pptx' --name title --json");
    assert.equal(title.exitCode, 0, title.stderr + title.stdout);
    assert.deepEqual(JSON.parse(title.stdout).data.properties, await readProperties(bytes, { name: "title" }, context));
    const tags = await shell.exec("pptx tags list 'field deck.pptx' --scope presentation --json");
    assert.equal(tags.exitCode, 0, tags.stderr + tags.stdout);
    assert.deepEqual(JSON.parse(tags.stdout).data.tags, await readTags(bytes, { scope: "presentation" }, context));
    const schema = await shell.exec("pptx schema tags list --json");
    assert.equal(compileJsonSchema(JSON.parse(schema.stdout).data.operations["tags.list"].result).validate(JSON.parse(tags.stdout)).ok, true);
    for (const command of [
      "properties set 'field deck.pptx' --name 'Survey date' --type date --value 2026-04-05T06:07:08Z --dry-run",
      "tags set 'field deck.pptx' --scope presentation --value '' --dry-run",
      "sanitize 'field deck.pptx' --remove properties --dry-run"
    ]) {
      const result = await shell.exec(`pptx ${command} --json`);
      assert.equal(result.exitCode, 0, result.stderr + result.stdout);
      assert.equal(JSON.parse(result.stdout).affected, 1);
      assert.equal(JSON.parse(result.stdout).data.dryRun, true);
    }
    const absent = await shell.exec("pptx properties remove 'field deck.pptx' --name missing --dry-run --json");
    assert.equal(absent.exitCode, 1);
    assert.equal(JSON.parse(absent.stdout).errors[0].code, "missing-selection");
    const invalid = await shell.exec("pptx properties set 'field deck.pptx' --name flag --type boolean --value yes --dry-run --json");
    assert.equal(invalid.exitCode, 2);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/field deck.pptx") as Buffer), bytes);
    const changed = await shell.exec("pptx properties set 'field deck.pptx' --name title --value 'Garden & field' --output -");
    assert.equal(changed.exitCode, 0, changed.stderr);
    const core = inspectZip(changed.stdoutBytes).find(entry => entry.name === "docProps/core.xml")!;
    let titleValue = "", inTitle = false;
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", node => { inTitle = node.uri === "http://purl.org/dc/elements/1.1/" && node.local === "title"; });
    parser.on("text", text => { if (inTitle) titleValue += text; });
    parser.on("closetag", () => { inTitle = false; });
    parser.write(new TextDecoder().decode(core.payload)).close();
    assert.equal(titleValue, "Garden & field");
    volume.writeFileSync("/work/field deck.pptx", changed.stdoutBytes);
    const tagEdit = await shell.exec("pptx tags set 'field deck.pptx' --scope presentation --value '' --output -");
    assert.equal(tagEdit.exitCode, 0, tagEdit.stderr);
    const tagPart = inspectZip(tagEdit.stdoutBytes).find(entry => entry.name === "ppt/tags/tag1.xml")!;
    const attrs: Array<{ namespace: string; attributes: Array<{ namespace: string; name: string; value: string }> }> = [];
    const tagParser = new SaxesParser({ xmlns: true });
    tagParser.on("opentag", node => { if (node.local === "tag") attrs.push({ namespace: node.uri, attributes: Object.values(node.attributes).map(a => ({ namespace: a.uri, name: a.local, value: a.value })) }); });
    tagParser.write(new TextDecoder().decode(tagPart.payload)).close();
    assert.deepEqual(attrs, [{ namespace: "http://schemas.openxmlformats.org/presentationml/2006/main", attributes: [
      { namespace: "http://www.w3.org/2000/xmlns/", name: "p", value: "http://schemas.openxmlformats.org/presentationml/2006/main" },
      { namespace: "", name: "name", value: "Seed count" },
      { namespace: "", name: "val", value: "" }
    ] }]);
    volume.writeFileSync("/work/field deck.pptx", tagEdit.stdoutBytes);
    const empty = await shell.exec("pptx tags get 'field deck.pptx' --scope presentation --json");
    assert.equal(empty.exitCode, 0, empty.stdout + empty.stderr);
    assert.equal(JSON.parse(empty.stdout).data.tags[0].value, "");
    const removed = await shell.exec("pptx tags remove 'field deck.pptx' --scope presentation --output -");
    assert.equal(removed.exitCode, 0, removed.stderr);
    const removedTagPart = inspectZip(removed.stdoutBytes).find(entry => entry.name === "ppt/tags/tag1.xml")!;
    let count = 0;
    const removeParser = new SaxesParser({ xmlns: true });
    removeParser.on("opentag", node => { if (node.local === "tag") count++; });
    removeParser.write(new TextDecoder().decode(removedTagPart.payload)).close();
    assert.equal(count, 0);
    volume.writeFileSync("/work/field deck.pptx", removed.stdoutBytes);
    const absentTag = await shell.exec("pptx tags get 'field deck.pptx' --scope presentation --json");
    assert.equal(absentTag.exitCode, 1);
  } finally { await shell.dispose(); }
});
