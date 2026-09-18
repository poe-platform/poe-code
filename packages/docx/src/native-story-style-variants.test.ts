import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
const owners = ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"] as const;
const cases = ["id-null", "id-empty", "id-custom", "id-missing", "id-wrong-kind", "id-false", "id-zero", "id-omitted", "name-null", "name-default", "name-custom", "name-owner", "name-missing", "name-wrong-kind", "name-false", "name-zero", "name-omitted", "invalid-enum"] as const;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of owners) for (const route of ["model", "sdk", "shell"] as const)
for (const choice of cases)
it(`${route} resolves native ${owner} style ${choice}; ${kind} strict=${strict}`, async () => {
  const fixture = await nativeStoryFixture(owner, strict, kind, '<w:p><w:r><w:t>Style ledger</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), seed = await api.Document(fixture.input, textContext);
  const custom = seed.styles.add_style("Ledger Paragraph", api.WD_STYLE_TYPE.PARAGRAPH), character = seed.styles.add_style("Ledger Character", api.WD_STYLE_TYPE.CHARACTER);
  await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input), byId = choice.startsWith("id-"), method = byId ? "get_style" : "get_style_id";
  const value = choice.endsWith("null") ? null : choice.endsWith("false") ? false : choice.endsWith("zero") ? 0 : choice.endsWith("omitted") ? undefined : choice.endsWith("empty") ? "" : choice.endsWith("missing") ? "Missing Ledger" : choice.endsWith("default") ? "Normal" : choice.endsWith("wrong-kind") ? (byId ? character.style_id : character.name) : choice.endsWith("owner") ? ref("style") : byId ? custom.style_id : custom.name;
  const invalid = choice.endsWith("false") || choice.endsWith("zero") || choice.endsWith("omitted") || choice === "invalid-enum" || choice === "name-missing" || choice === "name-wrong-kind";
  const expected = byId ? choice === "id-custom" ? custom.name : "Normal" : ["name-null", "name-default"].includes(choice) ? null : custom.style_id;
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    ...(!fixture.main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${fixture.relationships}/${fixture.role}` }, resultHandle: "owner" }] : []),
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: custom.name }, resultHandle: "style" },
    { operation: `model.parts.${owner}.${method}.call`, receiver: ref(fixture.main ? "main" : "owner"), arguments: { ...(value === undefined ? {} : { [byId ? "styleId" : "styleOrName"]: value }), styleType: choice === "invalid-enum" ? null : { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, ...(byId ? { resultHandle: "selected" } : {}) },
    ...(byId ? [{ operation: "model.styles.style.BaseStyle.name.get", receiver: ref("selected"), arguments: {} }] : [])
  ];
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const code = choice === "name-missing" ? "missing-selection" : "usage";
  if (route === "model") {
    const doc = await api.Document(input, context), part = (fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)) as api.StoryPart;
    const read = () => byId ? part.get_style(value as string | null, api.WD_STYLE_TYPE.PARAGRAPH).name : part.get_style_id((choice === "name-owner" ? doc.styles.at("Ledger Paragraph") : value) as api.BaseStyle | string | null, choice === "invalid-enum" ? null as never : api.WD_STYLE_TYPE.PARAGRAPH);
    if (invalid) expect(read).toThrow(choice === "name-missing" ? api.MissingKeyError : TypeError); else expect(read()).toBe(expected);
    await doc.save(sink); expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(before);
  } else if (route === "sdk") {
    const pending = api.applyStyleModelBatch(input, { version: 1, operations }, context);
    if (invalid) await expect(pending).rejects.toMatchObject({ code });
    else { const result = await pending; expect(result.results.at(-1)!.value).toBe(expected); expect(result.affected).toBe(0); await result.save(sink); expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(before); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("retained")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json"), envelope = JSON.parse(response.stdout);
      expect(response.exitCode, response.stdout + response.stderr).toBe(invalid ? code === "usage" ? 2 : 1 : 0); expect(envelope.affected).toBe(0);
      if (invalid) { expect(envelope).toMatchObject({ ok: false, data: null, errors: [{ code }] }); expect(await fs.readFile("/output")).toEqual(enc("retained")); }
      else { expect(envelope.data.results.at(-1).data).toBe(expected); expect(readPackage(await fs.readFile("/output"))).toEqual(before); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const owner of owners)
it(`rejects foreign native ${owner} styles with unchanged package bytes; ${kind} strict=${strict}`, async () => {
  const fixture = await nativeStoryFixture(owner, strict, kind, "<w:p/>"), doc = await api.Document(fixture.input, textContext), foreign = (await api.Document(fixture.input, textContext)).styles.add_style("Foreign Ledger", api.WD_STYLE_TYPE.PARAGRAPH), part = (fixture.main ? doc.part : doc.part.part_related_by(`${fixture.relationships}/${fixture.role}`)) as api.StoryPart;
  const before = doc.part.package.parts.map(part => [String(part.partname), part.blob]);
  expect(() => part.get_style_id(foreign, api.WD_STYLE_TYPE.PARAGRAPH)).toThrow(api.OwnershipError);
  expect(doc.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
});
