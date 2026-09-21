import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const batchSchema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "batch" } })!.data as api.DocxSchemaData;
const resultVariants = batchSchema.operations[0]!.result.oneOf![0]!.properties!.data!.properties!.results!.items as api.DocxJsonSchema;
const resultValidator = new Ajv2020({ strict: false, validateFormats: false });
const record = (value: string) => ({ values: [{ binding: "coast", value }] });
const scalar = '<w:sdt><w:sdtPr><w:text/><w:tag w:val="coast"/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Prototype</w:t></w:r></w:sdtContent></w:sdt>';
const repeat = `<w:sdt xmlns:x="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><x:repeatingSection/><w:tag w:val="rows"/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><x:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${scalar}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
const cases = ["control-fill", "repeat", "template", "comment-add", "comment-edit", "comment-remove", "revision-accept", "revision-reject", "rollback"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const scenario of cases) for (const route of ["sdk", "cli"] as const)
  it(`${route} ordered ${scenario} stages review/control effects once; ${kind}; strict=${strict}`, async () => {
    const input = await textFixture(`<w:p><w:r><w:t>Retained 海 🌊</w:t></w:r></w:p><w:p><w:ins w:id="7" w:author="Original" w:date="2026-03-04T05:06:07Z"><w:r><w:rPr><w:b/></w:rPr><w:t>Inserted</w:t></w:r></w:ins></w:p><w:p>${scalar}</w:p><w:p><w:commentRangeStart w:id="4"/><w:r><w:t>Anchor</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r></w:p>${repeat}`, {
      comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="4" w:author="Original" w:date="2026-03-04T05:06:07Z"><w:p><w:r><w:t>Retained note</w:t></w:r></w:p></w:comment></w:comments>` },
      settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:updateFields w:val="0"/><!--retain--><?audit exact?></w:settings>` }
    }, strict, { kind });
    const locations = await api.openDocumentLocations(input, textContext);
    const operations: (api.DocxBatchItem & { readonly id?: string })[] = scenario === "control-fill" || scenario === "rollback" ? [
      { operation: "controls.set", arguments: { control: 1, text: "Filled\t海\n🌊" } },
      { operation: "controls.list", arguments: { control: 1 } },
      ...(scenario === "rollback" ? [{ id: "missing-control", operation: "controls.set" as const, arguments: { control: 999, text: "Denied" } }] : [])
    ] : scenario === "repeat" ? [
      { operation: "controls.repeat", arguments: { control: 2, data: [record("First"), record("Second")] } },
      { operation: "controls.list", arguments: {} }
    ] : scenario === "template" ? [
      { operation: "template.apply", arguments: { data: { values: [{ binding: "coast", value: "Singleton" }, { binding: "rows", value: [record("First"), record("Second")] }] } } },
      { operation: "controls.list", arguments: {} }
    ] : scenario === "comment-add" ? [
      { operation: "comments.add", arguments: { select: locations.range(locations.at("paragraph", 1).token, 0, [..."Retained 海 🌊"].length).token, author: "", timestamp: "2026-03-04T05:06:07Z", initials: null, text: "Added note" } },
      { operation: "comments.list", arguments: {} }
    ] : scenario === "comment-edit" || scenario === "comment-remove" ? [
      { operation: "comments.set", arguments: { comment: 1, text: "Changed note 海 🌊" } },
      { operation: "comments.get", arguments: { comment: 1 } },
      ...(scenario === "comment-remove" ? [{ operation: "comments.remove" as const, arguments: { comment: 1 } }] : []),
      { operation: "comments.list", arguments: {} }
    ] : [
      { operation: "revisions.add", arguments: { paragraph: 1, kind: "insert", text: "Added", author: "", timestamp: "2026-03-04T05:06:07Z" } },
      { operation: "revisions.list", arguments: {} },
      { operation: scenario === "revision-accept" ? "revisions.accept" : "revisions.reject", arguments: { revision: 1 } },
      { operation: "text.get", arguments: {} }
    ];
    operations.push({ operation: "settings.list", arguments: {} });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    let data: api.DocumentBatchData | undefined;
    let writes = 0;
    if (route === "sdk") {
      const execution = api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { writes++; memory.appendFileSync("/output", bytes); } } });
      if (scenario === "rollback") { await expect(execution).rejects.toMatchObject({ code: "missing-selection", operationIndex: 2, operationId: "missing-control" }); expect(writes).toBe(0); }
      else { data = await execution; expect(writes).toBe(1); }
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", encode("Existing destination")); await fs.writeFile("/operations", encode(JSON.stringify({ version: 1, operations })));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec("docx batch /input --ops-file /operations --output /output --force --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(scenario === "rollback" ? 1 : 0);
        const envelope = JSON.parse(result.stdout);
        if (scenario === "rollback") { expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "missing-selection", operationIndex: 2, operationId: "missing-control" }] }); expect(await fs.readFile("/output")).toEqual(encode("Existing destination")); }
        else { expect(envelope.ok).toBe(true); data = envelope.data; memory.writeFileSync("/output", await fs.readFile("/output")); }
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    if (data) {
      for (const result of data.results) {
        const schema = resultVariants.oneOf!.find(variant => variant.properties?.id && variant.properties.operation?.const === result.operation)!;
        expect(schema, result.operation).toBeDefined();
        expect(resultValidator.validate(schema, result), JSON.stringify(resultValidator.errors)).toBe(true);
      }
      expect(data.results.map(result => result.operation)).toEqual(operations.map(operation => operation.operation));
      expect(data.results.at(-1)).toMatchObject({ affected: 0, data: { items: [{ details: { updateFields: false } }] } });
      const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [name, bytes] of before) if (!["word/document.xml", "word/comments.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
      if (scenario === "comment-add") {
        expect((await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, textContext)).items).toMatchObject([{ text: "Retained note" }, { text: "Added note", author: "", initials: null, timestamp: "2026-03-04T05:06:07Z" }]);
      } else if (scenario === "comment-edit" || scenario === "comment-remove") {
        expect(data.results[1]).toMatchObject({ data: { items: [{ text: "Changed note 海 🌊" }] } });
        expect((await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, textContext)).items.map(item => item.text)).toEqual(scenario === "comment-remove" ? [] : ["Changed note 海 🌊"]);
      } else if (scenario === "revision-accept" || scenario === "revision-reject") {
        expect((await api.inspectDocumentRevisions(output, {}, textContext)).items).toHaveLength(1);
        expect((await api.extractDocumentText(output, textContext, { view: "final" })).text).toContain(scenario === "revision-accept" ? "Retained 海 🌊Added" : "Retained 海 🌊");
        if (scenario === "revision-reject") expect((await api.extractDocumentText(output, textContext, { view: "final" })).text).not.toContain("Added");
        expect((await api.extractDocumentText(output, textContext, { view: "original" })).text).not.toContain("Inserted");
      } else {
        const controls = (await api.inspectDocumentControls(output, {}, textContext)).items;
        expect(controls.filter(control => control.tag === "coast").map(control => control.value)).toEqual(scenario === "control-fill" ? ["Filled\t海\n🌊", "Prototype"] : scenario === "repeat" ? ["Prototype", "First", "Second"] : ["Singleton", "First", "Second"]);
      }
      expect((await api.readDocumentArchive(output, textContext)).dialect).toBe(strict ? "strict" : "transitional");
    }
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
