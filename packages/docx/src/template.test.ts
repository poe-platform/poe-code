import { expect, it } from "vitest";
import { Volume } from "memfs";
import { textContext, textFixture, run, paragraph } from "../tests/fixtures/text.js";
import { extractDocumentText } from "./text.js";
import { readArchive } from "./archive.js";
import { validateDocumentArchive } from "./validation.js";
import { inspectDocumentControls } from "./controls.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";

const field = (tag: string, type = '<w:text/>', content = run(`{{${tag}}}`)) => `<w:sdt><w:sdtPr><w:id w:val="30"/><w:tag w:val="${tag}"/>${type}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const region = (tag: string, blocks: string) => `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="10"/><w:tag w:val="${tag}"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="20"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent>${blocks}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
const record = (binding: string, value: unknown) => ({ values: [{ binding, value }] });
async function apply(body: string | Uint8Array, data: unknown, limits = {}) {
  const module = await import("./index.js");
  expect(module).toHaveProperty("applyDocumentTemplate");
  const fs = Volume.fromJSON({ "/out": "" });
  const result = await (module as unknown as { applyDocumentTemplate: (input: Uint8Array, options: unknown, context: unknown) => Promise<unknown> }).applyDocumentTemplate(
    typeof body === "string" ? await textFixture(body) : body, { data, output: "-" },
    { ...textContext, budget: new module.DocumentBudget(limits, textContext.signal, async () => {}), encoding: { order: "input", compression: "store" }, stdout: { async write(bytes: Uint8Array) { fs.appendFileSync("/out", bytes); } } });
  return { result, bytes: new Uint8Array(fs.readFileSync("/out") as Uint8Array) };
}
it("fills explicit split-run literal controls and preserves unrelated brace text and stories", async () => {
  const input = await textFixture(paragraph('{{name}} outside') + `<w:p>${field("name", '<w:text/>', '<w:r><w:rPr><w:b/></w:rPr><w:t>{{na</w:t></w:r>'+run('me}}'))}</w:p>`, { header1: { kind: "header", xml: '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+paragraph('Header {{name}}')+'</w:hdr>' } });
  const { bytes } = await apply(input, record("name", "日本語 — مرحبا é & <"));
  expect((await extractDocumentText(bytes, textContext)).text).toBe('{{name}} outside\n日本語 — مرحبا é & <');
  const before = await readArchive(input, textContext), after = await readArchive(bytes, textContext);
  expect(after.members.find(m => m.name === "word/header1.xml")!.bytes).toEqual(before.members.find(m => m.name === "word/header1.xml")!.bytes);
  expect(new TextDecoder().decode(after.members.find(m => m.name === "word/document.xml")!.bytes)).toContain('<w:b/>');
});
it.each(["row", "block"])("expands explicit %s template arrays and retains empty refillable items", async kind => {
  const body = kind === "row" ? `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region("people", `<w:tr><w:tc><w:p>${field("name")}</w:p></w:tc></w:tr>`)}</w:tbl>` : region("people", `<w:p>${field("name")}</w:p>`);
  const filled = await apply(body, [record("name", "Élodie"), record("name", "東京")]);
  expect((await extractDocumentText(filled.bytes, textContext)).text).toBe('Élodie\n東京');
  expect(validateDocumentArchive(await readArchive(filled.bytes, textContext)).valid).toBe(true);
  const empty = await apply(filled.bytes, []);
  expect((await inspectDocumentControls(empty.bytes, {}, textContext)).items.filter(item => item.kind === "repeating-item")).toHaveLength(1);
  expect((await extractDocumentText(empty.bytes, textContext)).text).toBe('');
  expect((await extractDocumentText((await apply(empty.bytes, [record("name", "Return")])).bytes, textContext)).text).toBe('Return');
});
it("expands nested declared sections and remaps contained bookmark references per item", async () => {
  const inner = region("places", `<w:p><w:bookmarkStart w:id="4" w:name="place"/>${field("label")}<w:bookmarkEnd w:id="4"/><w:hyperlink w:anchor="place">${run(' jump')}</w:hyperlink></w:p>`);
  const body = region("people", `<w:p>${field("name")}</w:p>` + inner);
  const data = [ { values: [{ binding: "name", value: "海" }, { binding: "places", value: [record("label", "湾"), record("label", "港")] }] }, { values: [{ binding: "name", value: "نور" }, { binding: "places", value: [record("label", "شاطئ")] }] } ];
  const { bytes } = await apply(body, data);
  expect((await extractDocumentText(bytes, textContext)).text).toBe('海\n湾 jump\n港 jump\nنور\nشاطئ jump');
  expect(validateDocumentArchive(await readArchive(bytes, textContext)).valid).toBe(true);
  const controls = (await inspectDocumentControls(bytes, {}, textContext)).items;
  expect(new Set(controls.map(item => item.id)).size).toBe(controls.length);
});
it.each([
  { values: [] }, record("extra", "x"), { values: [{ binding: "name", value: "a" }, { binding: "name", value: "b" }] }, record("name", 1), record("name", null), record("name", { expression: "2 + 2" }),
])("refuses invalid original scalar record %j before publication", async data => {
  await expect(apply(`<w:p>${field("name")}</w:p>`, data)).rejects.toMatchObject({ code: "usage" });
});
it("rejects ambiguous top-level repeat arrays and conflicting duplicate declarations", async () => {
  await expect(apply(region("a", `<w:p>${field("name")}</w:p>`) + region("b", `<w:p>${field("name")}</w:p>`), [])).rejects.toMatchObject({ code: "ambiguous-selection" });
  await expect(apply(`<w:p>${field("name")}${field("name", '<w:date/>')}</w:p>`, record("name", "2025-01-01"))).rejects.toMatchObject({ code: "usage" });
});
it("admits zero-field empty records without changing unrelated content", async () => {
  const { bytes } = await apply(paragraph('Keep {{unknown}}'), { values: [] });
  expect((await extractDocumentText(bytes, textContext)).text).toBe('Keep {{unknown}}');
});
it("refuses inserted-node and item cardinality overruns", async () => {
  const body = region("people", `<w:p>${field("name")}</w:p>`);
  await expect(apply(body, [record("name", "a")], { insertedNodes: 0 })).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(apply(body, Array.from({ length: 1001 }, () => record("name", "a")))).rejects.toMatchObject({ code: "limit-exceeded" });
});
it("implements shared CLI data-file and dry-run output without publication", async () => {
  const input = await textFixture(`<w:p>${field("name")}</w:p>`), fs = Volume.fromJSON({ '/data.json': JSON.stringify(record('name', 'Привет')), '/out': '' });
  const before = fs.toJSON();
  const result = await createDocxInspectionCommandEngine(textContext).execute({ args: ['template', 'apply', '-', '--data-file', '/data.json', '--dry-run', '--json'].map(s => new TextEncoder().encode(s)), cwd: '/', filesystem: { async readFile(path) { return new Uint8Array(fs.readFileSync(path) as Uint8Array); } }, stdin: { async *[Symbol.asyncIterator]() { yield input; } }, stdout: { async write(bytes) { fs.appendFileSync('/out', bytes); } }, stderr: { async write() {} }, signal: textContext.signal });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(String(fs.readFileSync('/out')))).toMatchObject({ operation: 'template.apply', ok: true, affected: 1, data: { dryRun: true, output: null } });
  expect(fs.readFileSync('/data.json').toString()).toBe(before['/data.json']);
});
it("supports nested row templates in sections, empty children and varied prior item counts", async () => {
  const rows = `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region("rows", `<w:tr><w:tc><w:p>${field("label")}</w:p></w:tc></w:tr>`)}</w:tbl>`;
  const body = region("groups", `<w:p>${field("name")}</w:p>${rows}`);
  const data = [{ values: [{ binding: "name", value: "First" }, { binding: "rows", value: [record("label", "One"), record("label", "Two")] }] }, { values: [{ binding: "name", value: "Second" }, { binding: "rows", value: [] }] }];
  const first = await apply(body, data);
  expect((await extractDocumentText(first.bytes, textContext)).text).toBe('First\nOne\nTwo\nSecond\n');
  const second = await apply(first.bytes, data);
  expect((await extractDocumentText(second.bytes, textContext)).text).toBe('First\nOne\nTwo\nSecond\n');
  const empty = await apply(second.bytes, []);
  expect((await inspectDocumentControls(empty.bytes, {}, textContext)).items.filter(item => item.kind === "repeating-item")).toHaveLength(2);
  expect((await extractDocumentText(empty.bytes, textContext)).text).toBe('\n');
});
it("accepts four declared repeat levels and refuses a fifth", async () => {
  const nested = (levels: number) => {
    let body = `<w:p>${field("label")}</w:p>`, data: unknown = record("label", "Leaf");
    for (let level = levels; level > 0; level--) { body = region(`level${level}`, body); data = record(`level${level}`, [data]); }
    return { body, data };
  };
  const allowed = nested(4);
  expect((await extractDocumentText((await apply(allowed.body, allowed.data)).bytes, textContext)).text).toBe('Leaf');
  const refused = nested(5);
  await expect(apply(refused.body, [])).rejects.toMatchObject({ code: 'limit-exceeded' });
});
it("preserves false and empty text and uses declared choice/date display semantics", async () => {
  const check = '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="1"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>';
  const choice = '<w:dropDownList><w:listItem w:value="harbor" w:displayText="Harbor label"/></w:dropDownList>';
  const date = '<w:date><w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="en-GB"/></w:date>';
  const body = `<w:p>${field('name')}${field('checked', check)}${field('choice', choice)}${field('day', date)}</w:p>`;
  const { bytes } = await apply(body, { values: [{ binding: 'name', value: '' }, { binding: 'checked', value: false }, { binding: 'choice', value: 'harbor' }, { binding: 'day', value: '2024-02-29' }] });
  expect((await extractDocumentText(bytes, textContext)).text).toBe('☐Harbor label29/02/2024');
});
it("fills compatible duplicate scalar declarations but refuses missing nested fields", async () => {
  expect((await extractDocumentText((await apply(`<w:p>${field('name')}${field('name')}</w:p>`, record('name', 'Echo'))).bytes, textContext)).text).toBe('EchoEcho');
  await expect(apply(region('people', region('places', `<w:p>${field('label')}</w:p>`)), [record('places', [record('wrong', 'x')])])).rejects.toMatchObject({ code: 'usage' });
});
it("rejects bound/locked/opaque and crossing-reference templates with no output writes", async () => {
  const cases = [
    `<w:p>${field('name').replace('<w:text/>', '<w:lock w:val="sdtContentLocked"/><w:text/>')}</w:p>`,
    `<w:p>${field('name').replace('<w:text/>', '<w:dataBinding w:storeItemID="store" w:xpath="/x"/><w:text/>')}</w:p>`,
    region('people', `<w:p>${field('name')}<w:future/></w:p>`),
    region('people', `<w:p><w:bookmarkStart w:id="1" w:name="target"/>${field('name')}<w:bookmarkEnd w:id="1"/></w:p>`) + `<w:p><w:hyperlink w:anchor="target">${run('Outside')}</w:hyperlink></w:p>`,
  ];
  const { applyDocumentTemplate } = await import('./index.js');
  for (const body of cases) {
    let writes = 0;
    const data = body.includes('repeatingSection') ? [record('name', 'New')] : record('name', 'New');
    await expect(applyDocumentTemplate(await textFixture(body), { data: data as never, output: '-' }, { ...textContext, encoding: { order: 'input', compression: 'store' }, stdout: { async write() { writes++; } } })).rejects.toMatchObject({ code: 'unsupported-edit' });
    expect(writes).toBe(0);
  }
});
it("advertises template apply with its recursive schema and bounded feature subset", async () => {
  const { getDocxDiscovery } = await import('./discovery.js');
  const { parseDocxArguments } = await import('./command.js');
  const schema = getDocxDiscovery(parseDocxArguments(['schema', 'template', 'apply'].map(value => new TextEncoder().encode(value))))!.data as import('./discovery.js').DocxSchemaData;
  expect(schema.operations[0]).toMatchObject({ id: 'template.apply', support: 'edit', featureIds: ['F47'] });
  expect(JSON.stringify(schema.operations[0]!.input)).toContain('DeclaredTemplateRecord');
});
it("refuses conflicting schemas in later prior nested items instead of silently dropping them", async () => {
  const first = region('places', `<w:p>${field('label')}</w:p>`);
  const innerItem = first.slice(first.indexOf('<w:sdt><w:sdtPr><w:id w:val="20"/>'), first.lastIndexOf('</w:sdtContent></w:sdt>'));
  const second = first.slice(0, first.lastIndexOf('</w:sdtContent></w:sdt>')) + innerItem.replace('<w:text/>', '<w:date/>') + '</w:sdtContent></w:sdt>';
  const outer = region('people', `<w:p>${field('name')}</w:p>` + first);
  const prototype = outer.slice(outer.indexOf('<w:sdt><w:sdtPr><w:id w:val="20"/>'), outer.lastIndexOf('</w:sdtContent></w:sdt>'));
  const body = outer.slice(0, outer.lastIndexOf('</w:sdtContent></w:sdt>')) + prototype.replace(first, second) + '</w:sdtContent></w:sdt>';
  const data = [{ values: [{ binding: 'name', value: 'New' }, { binding: 'places', value: [record('label', 'Bay')] }] }];
  await expect(apply(body, data)).rejects.toMatchObject({ code: 'usage' });
});
it("enforces cumulative nested record limits before any transport output", async () => {
  const body = region('groups', region('rows', `<w:p>${field('label')}</w:p>`));
  await expect(apply(body, [record('rows', [record('label', 'a'), record('label', 'b')]), record('rows', [record('label', 'c')])], { matches: 4 })).rejects.toMatchObject({ code: 'limit-exceeded' });
});
it("reports only bounded record template capability and preserves legacy nested-repeat refusal", async () => {
  const { getDocxDiscovery } = await import('./discovery.js'), { parseDocxArguments } = await import('./command.js');
  expect(getDocxDiscovery(parseDocxArguments([new TextEncoder().encode('capabilities')]))!.data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: 'F47', level: 'edit', subsets: expect.arrayContaining([expect.objectContaining({ name: 'record-template-filling', level: 'edit' })]) })]) });
  const { editDocumentControlRepeats } = await import('./index.js');
  await expect(editDocumentControlRepeats(await textFixture(region('outer', region('inner', `<w:p>${field('name')}</w:p>`))), { control: 1, data: [], dryRun: true }, { ...textContext, encoding: { order: 'input', compression: 'store' } })).rejects.toMatchObject({ code: 'unsupported-edit' });
});
it("validates post-expansion nested comment bodies and exact bookmark destinations", async () => {
  const { parseDocumentXml } = await import('./index.js');
  const inner = region('places', `<w:p><w:bookmarkStart w:id="4" w:name="destination"/><w:commentRangeStart w:id="5"/>${field('label')}<w:commentRangeEnd w:id="5"/><w:r><w:commentReference w:id="5"/></w:r><w:bookmarkEnd w:id="4"/><w:hyperlink w:anchor="destination">${run(' go')}</w:hyperlink></w:p>`);
  const input = await textFixture(region('people', inner), { comments: { kind: 'comments', xml: '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="5" w:author="Survey team" w:date="2025-01-02T00:00:00Z">'+paragraph('Original annotation')+'</w:comment></w:comments>' } });
  const { bytes } = await apply(input, [record('places', [record('label', 'A'), record('label', 'B')]), record('places', [record('label', 'C')])]);
  const archive = await readArchive(bytes, textContext);
  const all = (node: ReturnType<typeof parseDocumentXml>['root']): ReturnType<typeof parseDocumentXml>['root'][] => [node, ...node.children.flatMap(all)];
  const nodes = all(parseDocumentXml(archive.members.find(m => m.name === 'word/document.xml')!.bytes).root), comments = all(parseDocumentXml(archive.members.find(m => m.name === 'word/comments.xml')!.bytes).root).filter(n => n.localName === 'comment');
  const attr = (node: typeof nodes[number], name: string) => node.attributes.find(a => a.localName === name)!.value;
  const names = nodes.filter(n => n.localName === 'bookmarkStart').map(n => attr(n, 'name'));
  expect(names).toHaveLength(3); expect(new Set(names).size).toBe(3);
  for (const node of nodes.filter(n => n.localName === 'hyperlink')) expect(names).toContain(attr(node, 'anchor'));
  const refs = nodes.filter(n => n.localName === 'commentReference').map(n => attr(n, 'id'));
  expect(new Set(refs).size).toBe(3);
  for (const id of refs) expect(comments.filter(n => attr(n, 'id') === id)).toHaveLength(1);
  for (const comment of comments) expect(attr(comment, 'author')).toBe('Survey team');
  expect(validateDocumentArchive(archive).valid).toBe(true);
});
it("refuses native repeat templates inside undeclared or locked enclosing controls", async () => {
  const repeat = region('people', `<w:p>${field('name')}</w:p>`);
  for (const lock of ['', '<w:lock w:val="sdtContentLocked"/>']) {
    const body = `<w:sdt><w:sdtPr><w:richText/>${lock}</w:sdtPr><w:sdtContent>${repeat}</w:sdtContent></w:sdt>`;
    await expect(apply(body, [record('name', 'New')])).rejects.toMatchObject({ code: 'unsupported-edit' });
  }
});
it("preserves nested inline PNG media while remapping drawing IDs and owner-local relationships", async () => {
  const { rasterPng } = await import('../tests/fixtures/raster.js');
  const { writeArchive, parseDocumentXml } = await import('./index.js');
  const drawing = '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="9" name="Survey pixel"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9" name="Survey pixel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  const base = await readArchive(await textFixture(region('people', region('places', `<w:p>${field('name')}<w:r>${drawing}</w:r></w:p>`))), textContext), media = rasterPng();
  const archive = { ...base, members: [...base.members.map(member => member.name === 'word/_rels/document.xml.rels' ? { ...member, bytes: new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/></Relationships>') } : member.name === '[Content_Types].xml' ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')) } : member), { name: 'word/media/pixel.png', bytes: media, directory: false, modified: new Date('2025-01-01T00:00:00Z') }] };
  const fs = Volume.fromJSON({ '/input': '' });
  await writeArchive(archive, { async write(bytes) { fs.appendFileSync('/input', bytes); } }, { order: 'input', compression: 'store' }, textContext);
  const input = new Uint8Array(fs.readFileSync('/input') as Uint8Array), data = [record('places', [record('name', 'A'), record('name', 'B')]), record('places', [record('name', 'C')])];
  const { bytes } = await apply(input, data), final = await readArchive(bytes, textContext);
  expect(final.members.find(m => m.name === 'word/media/pixel.png')!.bytes).toEqual(media);
  const nodes = (root: ReturnType<typeof parseDocumentXml>['root']): ReturnType<typeof parseDocumentXml>['root'][] => [root, ...root.children.flatMap(nodes)];
  const all = nodes(parseDocumentXml(final.members.find(m => m.name === 'word/document.xml')!.bytes).root);
  const ids = all.filter(n => ['docPr', 'cNvPr'].includes(n.localName)).map(n => n.attributes.find(a => a.localName === 'id')!.value);
  expect(ids).toHaveLength(6); expect(new Set(ids).size).toBe(6);
  const embeds = all.filter(n => n.localName === 'blip').map(n => n.attributes.find(a => a.localName === 'embed')!.value);
  expect(new Set(embeds).size).toBe(3);
  const relationships = parseDocumentXml(final.members.find(m => m.name === 'word/_rels/document.xml.rels')!.bytes).root.children;
  for (const id of embeds) expect(relationships.filter(n => n.attributes.some(a => a.localName === 'Id' && a.value === id))).toHaveLength(1);
  expect(validateDocumentArchive(final).valid).toBe(true);
  await expect(apply(input, data, { embeddedMediaBytes: media.length - 1 })).rejects.toMatchObject({ code: 'limit-exceeded' });
});
it("rejects cancellation and semantic failures before output transport and surfaces sink failure", async () => {
  const { applyDocumentTemplate, DocumentBudget } = await import('./index.js');
  const input = await textFixture(`<w:p>${field('day', '<w:date/>')}</w:p>`), controller = new AbortController();
  controller.abort('Stopped'); let writes = 0;
  const context = { ...textContext, encoding: { order: 'input', compression: 'store' } as const, stdout: { async write() { writes++; } } };
  await expect(applyDocumentTemplate(input, { data: record('day', '2025-01-01') as never, output: '-' }, { ...context, signal: controller.signal, budget: new DocumentBudget({}, controller.signal) })).rejects.toMatchObject({ code: 'cancelled' });
  await expect(applyDocumentTemplate(input, { data: record('day', '2025-02-30') as never, output: '-' }, context)).rejects.toMatchObject({ code: 'usage' });
  expect(writes).toBe(0);
  await expect(applyDocumentTemplate(input, { data: record('day', '2025-01-01') as never, output: '-' }, { ...context, stdout: { async write() { throw new Error('Sink unavailable'); } } })).rejects.toMatchObject({ code: 'sink-failure' });
});
it("preflights scalar formats in later discarded nested prototypes", async () => {
  const first = region('places', `<w:p>${field('day', '<w:date/>')}</w:p>`);
  const item = first.slice(first.indexOf('<w:sdt><w:sdtPr><w:id w:val="20"/>'), first.lastIndexOf('</w:sdtContent></w:sdt>'));
  const second = first.slice(0, first.lastIndexOf('</w:sdtContent></w:sdt>')) + item.replace('<w:date/>', '<w:date><w:dateFormat w:val="longDate"/></w:date>') + '</w:sdtContent></w:sdt>';
  const outer = region('people', first), outerItem = outer.slice(outer.indexOf('<w:sdt><w:sdtPr><w:id w:val="20"/>'), outer.lastIndexOf('</w:sdtContent></w:sdt>'));
  const body = outer.slice(0, outer.lastIndexOf('</w:sdtContent></w:sdt>')) + outerItem.replace(first, second) + '</w:sdtContent></w:sdt>';
  await expect(apply(body, [record('places', [record('day', '2025-01-01')])])).rejects.toMatchObject({ code: 'unsupported-edit' });
});
it("keeps CLI and SDK recursive record schemas identical and finite-number mappings truthful", async () => {
  const { getDocxOperationSchema } = await import('./operation-json-schema.js');
  const cli = getDocxOperationSchema('template.apply', 'cli'), sdk = getDocxOperationSchema('template.apply');
  expect(cli.properties!.dataJson).toEqual(sdk.properties!.data);
  expect(cli.$defs).toEqual(sdk.$defs);
  const terminal = sdk.$defs!.DeclaredTemplateRecord4!.properties!.values!.items as import('./operation-json-schema.js').DocxJsonSchema;
  expect(terminal.properties!.value!.anyOf).toContainEqual({ type: 'number' });
});
it("refuses malformed native item containers in later discarded nested regions", async () => {
  const inner = region('places', `<w:p>${field('name')}</w:p>`);
  const malformed = inner.slice(0, inner.lastIndexOf('</w:sdtContent></w:sdt>')) + paragraph('Unwrapped prior block') + '</w:sdtContent></w:sdt>';
  const outer = region('people', inner), item = outer.slice(outer.indexOf('<w:sdt><w:sdtPr><w:id w:val="20"/>'), outer.lastIndexOf('</w:sdtContent></w:sdt>'));
  const body = outer.slice(0, outer.lastIndexOf('</w:sdtContent></w:sdt>')) + item.replace(inner, malformed) + '</w:sdtContent></w:sdt>';
  await expect(apply(body, [record('places', [record('name', 'Bay')])])).rejects.toMatchObject({ code: 'unsupported-edit' });
});
