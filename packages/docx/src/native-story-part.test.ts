import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import * as api from "./index.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";
import type { BaseStyle, DocxEnumValue, Image } from "./index.js";

const enc = (value: string) => new TextEncoder().encode(value);
const owners = ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const owner of owners) for (const scenario of ["id", "style", "image"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} executes ${owner} ${scenario} in its native owner scope; strict=${strict}${kind === "docx" ? "" : "; kind=dotx"}`, async () => {
  const { input, main: isMain, role: storyRole, relationships: r } = await nativeStoryFixture(owner, strict, kind, '<w:p id="7"><w:r><w:t>Original coast</w:t></w:r></w:p>');
  const before = readPackage(input), memory = Volume.fromJSON({ "/output": "" });
  const ref = (resultHandle: string) => ({ resultHandle }), prefix = `model.parts.${owner}`;
  const operations: Record<string, unknown>[] = [{ operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" }];
  if (!isMain) operations.push({ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${r}/${storyRole}` }, resultHandle: "owner" });
  const receiver = ref(isMain ? "main" : "owner");
  const descriptor = { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") };
  if (scenario === "id") operations.push({ operation: `${prefix}.next_id.get`, receiver, arguments: {} });
  if (scenario === "style") operations.push(
    { operation: `${prefix}.get_style.call`, receiver, arguments: { styleId: null, styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "style" },
    { operation: "model.styles.style.BaseStyle.name.get", receiver: ref("style"), arguments: {} },
    { operation: `${prefix}.get_style_id.call`, receiver, arguments: { styleOrName: ref("style"), styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } } }
  );
  if (scenario === "image") operations.push(
    { operation: `${prefix}.get_or_add_image.call`, receiver, arguments: { imageDescriptor: descriptor } },
    { operation: `${prefix}.get_or_add_image.call`, receiver, arguments: { imageDescriptor: descriptor } }
  );
  if (route === "model") {
    const doc = await api.Document(input, textContext);
    const part = (isMain ? doc.part : doc.part.part_related_by(`${r}/${storyRole}`)) as api.XmlPartView & { next_id: number; get_style(id: string | null, type: DocxEnumValue<"WD_STYLE_TYPE">): BaseStyle; get_style_id(style: BaseStyle | string | null, type: DocxEnumValue<"WD_STYLE_TYPE">): string | null; get_or_add_image(bytes: Uint8Array): Promise<readonly [string, Image]> };
    if (scenario === "id") expect(part.next_id).toBe(8);
    if (scenario === "style") { expect(part.get_style).toBeTypeOf("function"); const style = part.get_style(null, api.WD_STYLE_TYPE.PARAGRAPH); expect(style.name).toBe("Normal"); expect(part.get_style_id(style, api.WD_STYLE_TYPE.PARAGRAPH)).toBeNull(); }
    if (scenario === "image") { expect(part.get_or_add_image).toBeTypeOf("function"); const first = await part.get_or_add_image(rasterPng()), second = await part.get_or_add_image(rasterPng()); expect(first[0]).toBe(second[0]); expect(first[1].blob).toEqual(rasterPng()); expect(part.rels.at(first[0]).target_part.blob).toEqual(rasterPng()); }
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (scenario === "id") expect(result.results.at(-1)!.value).toBe(8);
    if (scenario === "style") { expect(result.results.at(-2)!.value).toBe("Normal"); expect(result.results.at(-1)!.value).toBeNull(); }
    if (scenario === "image") expect((result.results.at(-1)!.value as unknown[])[0]).toBe((result.results.at(-2)!.value as unknown[])[0]);
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-file /ops --json${scenario === "id" ? "" : " --output /output"}`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const values = JSON.parse(result.stdout).data.results; if (scenario === "id") expect(values.at(-1).data).toBe(8); if (scenario === "style") { expect(values.at(-2).data).toBe("Normal"); expect(values.at(-1).data).toBeNull(); } if (scenario === "image") expect(values.at(-1).data[0]).toBe(values.at(-2).data[0]); memory.writeFileSync("/output", scenario === "id" ? input : await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && !name.endsWith(".rels")) expect(after.get(name), name).toEqual(bytes);
  if (scenario === "id") expect(after).toEqual(before);
  if (scenario === "image") expect([...after.values()].filter(bytes => Buffer.from(bytes).equals(Buffer.from(rasterPng())))).toHaveLength(1);
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Original coast");
});

for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
for (const member of ["element.get", "part.get", "next_id.get"] as const)
it(`${route} rejects a generic part handle whose actual role is a different native story for ${member}; strict=${strict}`, async () => {
  const input = await textFixture("<w:p/>", { wrong: { kind: "footer", xml: '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:ftr>' } }, strict);
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: { resultHandle: "main" }, arguments: { reltype: `${r}/footer` }, resultHandle: "wrong" },
    { operation: `model.parts.hdrftr.HeaderPart.${member}`, receiver: { resultHandle: "wrong" }, arguments: {} }
  ];
  if (route === "sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "usage" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode).toBe(2); expect(JSON.parse(result.stdout).errors[0].code).toBe("usage"); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
});
