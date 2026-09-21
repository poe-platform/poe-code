import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, InputTypeError } from "./index.js";
import { textFixture, paragraph, w } from "../tests/fixtures/text.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { textContext } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";

it.each([
  '<w:evenAndOddHeaders w:future="retain"/>',
  '<w:evenAndOddHeaders><w:future/></w:evenAndOddHeaders>',
  '<w:evenAndOddHeaders>retain</w:evenAndOddHeaders>',
  '<w:evenAndOddHeaders w:val="unknown"/>'
])("rejects an affected unsupported header policy without changing settings: %s", async policy => {
  const input = await textFixture(paragraph("Coast"), {
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat/>${policy}</w:settings>` }
  });
  const document = await Document(input);
  const settings = document.settings, before = document.store.snapshot();
  expect(() => { settings.odd_and_even_pages_header_footer = false; }).toThrowError(
    expect.objectContaining({ code: "unsupported-edit" })
  );
  expect(document.store.snapshot()).toEqual(before);
  const batch = {
    version: 1 as const,
    operations: [
      { operation: "model.document.Document.settings.get", receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 }, arguments: {}, resultHandle: "settings" },
      { operation: "model.settings.Settings.odd_and_even_pages_header_footer.set", receiver: { resultHandle: "settings" }, arguments: { value: false } }
    ]
  };
  await expect(applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: "unsupported-edit" });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify(batch), "--output", "-", "--json", "--dry-run"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(volume.readFileSync("/out", "utf8") as string)).toMatchObject({
    ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }]
  });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});

it("creates and retains a single settings owner through the document getter", async () => {
  const document = await Document(await textFixture(paragraph("Coast")));
  const initial = document.store.snapshot();
  expect(initial.members.some((member) => member.name.endsWith("settings.xml"))).toBe(false);
  const settings = document.settings;
  expect(settings.odd_and_even_pages_header_footer).toBe(false);
  expect(document.settings).toBe(settings);
  expect(settings.part.content_type).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"
  );
  const volume = Volume.fromJSON({ "/document": "" });
  settings.odd_and_even_pages_header_footer = true;
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/document", bytes);
    }
  });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/document") as Buffer));
  expect(reopened.settings.odd_and_even_pages_header_footer).toBe(true);
  expect(document.paragraphs[0]?.text).toBe("Coast");
});

for (const present of [true, false]) {
  for (const assigned of [true, false]) {
    it(`retains unrelated settings while setting page header policy ${present}/${assigned}`, async () => {
      const bytes = await textFixture(paragraph("Body"), {
        settings: {
          kind: "settings",
          xml: `<w:settings xmlns:w="${w}"><w:compat/>${present ? "<w:evenAndOddHeaders/>" : ""}</w:settings>`
        }
      });
      const document = await Document(bytes);
      const settings = document.settings;
      expect(settings.odd_and_even_pages_header_footer).toBe(present);
      settings.odd_and_even_pages_header_footer = assigned;
      expect(settings.odd_and_even_pages_header_footer).toBe(assigned);
      expect(new TextDecoder().decode(settings.element.serialize())).toContain("compat");
      const before = document.store.snapshot();
      expect(() => {
        settings.odd_and_even_pages_header_footer = null as unknown as boolean;
      }).toThrow(InputTypeError);
      expect(document.store.snapshot()).toEqual(before);
    });
  }
}

it("declares and executes settings owner access through the shared typed batch", async () => {
  const bytes = await textFixture(paragraph("Body"));
  const result = await applyStyleModelBatch(
    bytes,
    {
      version: 1,
      operations: [
        {
          operation: "model.document.Document.settings.get",
          receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 },
          arguments: {},
          resultHandle: "settings"
        },
        {
          operation: "model.settings.Settings.odd_and_even_pages_header_footer.set",
          receiver: { resultHandle: "settings" },
          arguments: { value: true }
        },
        {
          operation: "model.settings.Settings.odd_and_even_pages_header_footer.get",
          receiver: { resultHandle: "settings" },
          arguments: {}
        }
      ]
    },
    textContext
  );
  expect(result.results[0]?.value).toEqual({
    id: "handle1",
    type: "Settings",
    owner: "document",
    revision: 0
  });
  expect(result.results.at(-1)?.value).toBe(true);
  expect(result.affected).toBe(2);
});

it("reads existing settings on a protected document without requesting mutation authority", async () => {
  const bytes = await textFixture(paragraph("Protected"), {
    settings: {
      kind: "settings",
      xml: `<w:settings xmlns:w="${w}"><w:documentProtection w:edit="readOnly" w:enforcement="1"/><w:evenAndOddHeaders/></w:settings>`
    }
  });
  const document = await Document(bytes);
  const before = document.store.snapshot();
  expect(document.settings.odd_and_even_pages_header_footer).toBe(true);
  expect(document.store.snapshot()).toEqual(before);
  expect(() => {
    document.settings.odd_and_even_pages_header_footer = false;
  }).toThrow();
  expect(document.store.snapshot()).toEqual(before);
});
