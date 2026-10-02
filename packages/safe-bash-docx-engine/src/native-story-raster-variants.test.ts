import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { storyRasterCases } from "../tests/fixtures/story-raster-variants.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const owners = ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"] as const;
const properties = ["content_type", "px_width", "px_height", "horz_dpi", "vert_dpi", "width", "height", "sha1", "blob"] as const;
const elements = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : elements(child))];

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const owner of owners)
for (const raster of storyRasterCases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains native ${owner} ${raster.name} metadata and owner-local images; strict=${strict}; kind=${kind}`, async () => {
  const { input, main, role, partname, relationships } = await nativeStoryFixture(owner, strict, kind, '<w:p><w:r><w:t>Retained coastal story</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/output": "" }), prefix = `model.parts.${owner}`, receiver = ref(main ? "main" : "owner");
  const descriptor = { kind: "bytes", base64: Buffer.from(raster.bytes).toString("base64") };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    ...(!main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${relationships}/${role}` }, resultHandle: "owner" }] : []),
    { operation: `${prefix}.get_or_add_image.call`, receiver, arguments: { imageDescriptor: descriptor }, resultHandle: "image" },
    { operation: `${prefix}.get_or_add_image.call`, receiver, arguments: { imageDescriptor: descriptor }, resultHandle: "same" },
    ...properties.map(name => ({ operation: `model.image.image.Image.${name}.get`, receiver: ref("image", 1), arguments: {} })),
    { operation: `${prefix}.new_pic_inline.call`, receiver, arguments: { imageDescriptor: descriptor }, resultHandle: "inline" },
    { operation: "model.XmlElementView.serialize.call", receiver: ref("inline"), arguments: {} }
  ];
  let values: unknown[], fragment: Uint8Array;
  if (route === "model") {
    const document = await api.Document(input, textContext);
    const part = (main ? document.part : document.part.part_related_by(`${relationships}/${role}`)) as api.StoryPart;
    const first = await part.get_or_add_image(raster.bytes), second = await part.get_or_add_image(raster.bytes);
    expect(first[0]).toBe(second[0]);
    const image = first[1];
    values = [image.content_type, image.px_width, image.px_height, image.horz_dpi, image.vert_dpi, { value: image.width.emu, unit: "emu" }, { value: image.height.emu, unit: "emu" }, image.sha1, { kind: "bytes", base64: Buffer.from(image.blob).toString("base64") }];
    fragment = (await part.new_pic_inline(raster.bytes)).serialize();
    expect(part.rels.at(first[0]).target_part.blob).toEqual(raster.bytes);
    await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    let results: { data: unknown }[];
    if (route === "sdk") {
      const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); results = [...batch.operationResults];
      await batch.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); results = JSON.parse(result.stdout).data.results; memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
      finally { await shell.dispose(); }
    }
    const start = main ? 1 : 2;
    expect((results[start]!.data as unknown[])[0]).toBe((results[start + 1]!.data as unknown[])[0]);
    values = results.slice(start + 2, start + 2 + properties.length).map(result => result.data);
    fragment = new Uint8Array(Buffer.from((results.at(-1)!.data as { base64: string }).base64, "base64"));
  }
  expect(values.slice(0, 3)).toEqual([raster.mime, raster.width, raster.height]);
  expect(values[3]).toBeCloseTo(raster.x, 8); expect(values[4]).toBeCloseTo(raster.y, 8);
  const width = Math.round(raster.width * 914400 / raster.x), height = Math.round(raster.height * 914400 / raster.y);
  expect(values.slice(5, 8)).toEqual([{ value: width, unit: "emu" }, { value: height, unit: "emu" }, createHash("sha1").update(raster.bytes).digest("hex")]);
  expect(values[8]).toEqual({ kind: "bytes", base64: Buffer.from(raster.bytes).toString("base64") });
  const drawing = xmlStructure(fragment), extent = elements(drawing).find(node => node.name.endsWith("}extent"))!;
  expect(extent.attributes).toEqual({ "{}cx": String(width), "{}cy": String(height) });
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), before = readPackage(input);
  const ownerRelationships = partname.slice(1, partname.lastIndexOf("/") + 1) + "_rels/" + partname.slice(partname.lastIndexOf("/") + 1) + ".rels";
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && name !== ownerRelationships) expect(after.get(name), name).toEqual(bytes);
  expect([...after.values()].filter(bytes => Buffer.from(bytes).equals(Buffer.from(raster.bytes)))).toHaveLength(1);
  const edges = elements(xmlStructure(after.get(ownerRelationships)!)).filter(node => node.attributes["{}Type"] === relationships + "/image");
  expect(edges).toHaveLength(1);
  const blip = elements(drawing).find(node => node.name.endsWith("}blip"))!;
  expect(blip.attributes[`{${relationships}}embed`]).toBe(edges[0]!.attributes["{}Id"]);
});
