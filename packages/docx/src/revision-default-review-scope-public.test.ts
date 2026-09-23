import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const scope of [undefined, "all-stories", "body"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`dedicated revision inventory does not hide non-body review; strict=${strict}; kind=${kind}; scope=${scope}; route=${route}`, async () => {
  const revision = (id: number, value: string) => `<w:p><w:ins w:id="${id}" w:author="Archive"><w:r><w:t>${value}</w:t></w:r></w:ins></w:p>`;
  const input = await textFixture('<w:p><w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="headerA"/></w:sectPr>', {
    headerA: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${revision(2, "Header")}</w:hdr>` },
    footnotes: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="1">${revision(3, "Footnote")}</w:footnote></w:footnotes>` },
    endnotes: { kind: "endnotes", xml: `<w:endnotes xmlns:w="${w}"><w:endnote w:id="1">${revision(4, "Endnote")}</w:endnote></w:endnotes>` },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Archive">${revision(5, "Comment")}</w:comment></w:comments>` }
  }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), options = scope === undefined ? {} : { scope }, context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, batch = { version: 1 as const, operations: [{ operation: "revisions.list", arguments: options }] };
  let ids: unknown[];
  if (route === "sdk") ids = (await api.inspectDocumentRevisions(input, options, context)).items.map(item => item.id);
  else if (route === "sdk-batch") { const result = await api.executeDocumentBatch(input, batch, { dryRun: true }, context); ids = (result.results[0]!.data as { items: { properties: { name: string; value: unknown }[] }[] }).items.map(item => item.properties.find(property => property.name === "id")!.value); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec((route === "cli" ? `docx revisions list /input${scope === undefined ? "" : ` --scope ${scope}`}` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run`) + " --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0); const result = JSON.parse(response.stdout), data = route === "cli" ? result.data : result.data.results[0].data; ids = data.items.map((item: { properties: { name: string; value: unknown }[] }) => item.properties.find(property => property.name === "id")!.value);
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(ids).toEqual(scope === "body" ? [] : ["2", "3", "4", "5"]);
  expect(memory.statSync("/output").size).toBe(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
