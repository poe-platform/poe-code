import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const schema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "inspect" } })!.data as api.DocxSchemaData;
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema.operations[0]!.result);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk-batch", "cli", "cli-batch"] as const)
for (const selection of ["package", "paragraph", "run", "section", "comment", "revision", "control", "field", "bookmark", "token", "missing-section", "missing-revision"] as const)
  it(`${route} inspection validates direct-only transport and resolves ${selection}; ${kind}; strict=${strict}`, async () => {
    const input = await textFixture('<w:p><w:bookmarkStart w:id="3" w:name="retained"/><w:r><w:t>Before</w:t></w:r><w:bookmarkEnd w:id="3"/><w:ins w:id="17" w:author="Coast" w:date="2026-03-04T05:06:07Z"><w:r><w:t>Inserted</w:t></w:r></w:ins><w:sdt><w:sdtPr><w:id w:val="29"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Controlled</w:t></w:r></w:sdtContent></w:sdt><w:fldSimple w:instr="DATE"><w:r><w:t>Stored date</w:t></w:r></w:fldSimple></w:p>', {
      comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="47" w:author="Coast"><w:p><w:r><w:t>Stored note</w:t></w:r></w:p></w:comment></w:comments>` },
      settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat/></w:settings>` }
    }, strict, { kind });
    const before = readPackage(input), document = await api.openDocumentLocations(input, textContext);
    const options = selection === "package" ? {} : selection === "token" ? { select: document.at("paragraph", 1).token } : selection === "run" ? { paragraph: 1, run: 1 } : selection === "missing-section" ? { section: 999 } : selection === "missing-revision" ? { revision: 2 } : { [selection]: 1 };
    const batch = { version: 1 as const, operations: [{ operation: "inspect" as const, arguments: options }] };
    const expectedFailure = selection.startsWith("missing-");
    const observe = (result: { data: unknown; locations: readonly api.Location[]; affected: number; warnings: unknown; errors: unknown; operation: string; ok: boolean; version: number }) => {
      const { id: ignoredId, ...direct } = result as typeof result & { id?: string };
      expect(validate(direct), JSON.stringify(validate.errors)).toBe(true);
      const data = result.data as api.InspectionData;
      expect(data.kind).toBe(kind); expect(data.dialect).toBe(strict ? "strict" : "transitional");
      expect(data.parts.map(part => part.name).sort()).toEqual([...before.keys()].map(name => "/" + name).sort());
      expect(data.counts.comments).toBe(1); expect(data.counts.controls).toBe(1);
      expect(data.annotations.some(annotation => annotation.kind === "ins" && annotation.id === "17")).toBe(true);
      expect(data.stories.map(story => story.kind)).toEqual(["body", "comments"]);
      expect(result.affected).toBe(0); expect(result.locations).toHaveLength(1);
      expect(result.locations[0]!.kind).toBe(selection === "section" ? "section" : selection === "package" || selection === "comment" ? "story" : selection === "token" ? "paragraph" : selection === "revision" ? "annotation" : selection);
      if (selection === "revision") expect(result.locations[0]!.value.path).toEqual([0, 0, 3]);
    };
    if (route === "sdk-batch") {
      await expect(api.executeDocumentBatch(new Uint8Array(), batch, {}, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "usage" });
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", encode("Retained destination")); await fs.writeFile("/ops", encode(JSON.stringify(batch)));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const flags = Object.entries(options).map(([key, value]) => `--${key} ${value}`).join(" ");
        const result = await shell.exec(route === "cli" ? `docx inspect /input ${flags} --json` : "docx batch /missing --ops-file /ops --json");
        const envelope = JSON.parse(result.stdout); expect(result.exitCode, result.stdout + result.stderr).toBe(route === "cli-batch" ? 2 : expectedFailure ? 1 : 0);
        if (route === "cli-batch") expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
        else
        if (expectedFailure) expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "missing-selection" }] });
        else observe(envelope);
        expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(encode("Retained destination"));
      } finally { await shell.dispose(); }
    }
    const memory = Volume.fromJSON({ "/input": Buffer.from(input) }); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
