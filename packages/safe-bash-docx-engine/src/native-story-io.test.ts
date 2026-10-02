import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, DocumentBudget, CancellationError, ResourceLimitError, type StoryPart } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const method of ["get_or_add_image", "new_pic_inline"] as const)
for (const owner of ["document.DocumentPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"])
it(`preserves ${owner} concurrent edits during ${method} source admission; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture(owner, strict, kind, "<w:p/>");
  const doc = await Document(fixture.input, textContext), part = (fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)) as StoryPart;
  const memory = Volume.fromJSON({ "/output": "" });
  let closed = false;
  const source = { async *open() { try { doc.paragraphs[0]!.text = "Intervening coast"; yield rasterPng(); } finally { closed = true; } } };
  const pending = part[method](source); expect(pending).toBeInstanceOf(Promise);
  await expect(pending).rejects.toMatchObject({ code: "conflict" }); expect(closed).toBe(true);
  await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  const before = readPackage(fixture.input), after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(doc.paragraphs[0]!.text).toBe("Intervening coast");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const method of ["get_or_add_image", "new_pic_inline"] as const)
for (const scenario of ["cancel", "media-limit", "malformed", "source-failure"] as const)
it(`${method} rejects ${scenario} with settled source and owned input; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const before = input.slice(), controller = new AbortController(), memory = Volume.fromJSON({ "/output": "" });
  const doc = await Document(input, { ...textContext, signal: controller.signal, ...(scenario === "media-limit" ? { budget: new DocumentBudget({ embeddedMediaBytes: rasterPng().length - 1 }, controller.signal) } : {}) });
  let closed = false;
  const source = { async *open() { try {
    if (scenario === "cancel") controller.abort(new Error("stop admission"));
    if (scenario === "source-failure") throw new Error("injected source failure");
    yield scenario === "malformed" ? Uint8Array.of(1, 2, 3) : rasterPng();
  } finally { closed = true; } } };
  const pending = doc.part[method](source);
  if (scenario === "cancel") await expect(pending).rejects.toBeInstanceOf(CancellationError);
  else if (scenario === "media-limit") await expect(pending).rejects.toBeInstanceOf(ResourceLimitError);
  else if (scenario === "source-failure") await expect(pending).rejects.toThrow("injected source failure");
  else await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(closed).toBe(true); expect(input).toEqual(before);
  if (scenario !== "cancel") {
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const existing of [4294967294, 4294967295])
it(`bounds detached drawing allocation after ID ${existing}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p id="${existing}"/>`), doc = await Document(input, textContext);
  const memory = Volume.fromJSON({ "/output": "" }), pending = doc.part.new_pic_inline(rasterPng());
  if (existing === 4294967295) await expect(pending).rejects.toBeInstanceOf(ResourceLimitError);
  else {
    const fragment = await pending, original = doc.part.blob;
    fragment.set_attribute({ namespaceURI: "", localName: "audit" }, "detached");
    expect(new TextDecoder().decode(fragment.serialize())).toContain('audit="detached"'); expect(doc.part.blob).toEqual(original);
  }
  await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)), before = readPackage(input);
  if (existing === 4294967295) expect(after).toEqual(before);
  else { expect(after.get("word/document.xml")).toEqual(before.get("word/document.xml")); expect(doc.inline_shapes.length).toBe(0); }
});
