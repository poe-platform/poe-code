import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const operation of ["revisions.accept", "revisions.reject"] as const)
for (const selection of ["default-all", "all-stories", "headers", "body-ordinal", "paragraph-ordinal", "header-token"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`revision decision selection authority; strict=${strict}; kind=${kind}; operation=${operation}; selection=${selection}; route=${route}`, async () => {
  const revision = (id: number, text: string) => `<w:p><w:ins w:id="${id}" w:author="Archive"><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
  const input = await textFixture(revision(99, "First海🌊") + revision(7, "Second") + '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="headerA"/></w:sectPr>', {
    headerA: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${revision(2, "Header")}</w:hdr>` },
    footnotes: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="1">${revision(3, "Footnote")}</w:footnote></w:footnotes>` },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="5" w:author="Archive">${revision(5, "Comment")}</w:comment></w:comments>` }
  }, strict, { kind });
  const original = (await api.inspectDocumentRevisions(input, { scope: "all-stories" }, textContext)).items;
  const selectedIds = selection === "default-all" ? ["99", "7"] : selection === "all-stories" ? ["99", "7", "2", "3", "5"] : selection === "body-ordinal" || selection === "paragraph-ordinal" ? ["7"] : ["2"];
  const options = selection === "default-all" ? { all: true } : selection === "all-stories" ? { all: true, scope: "all-stories" as const } : selection === "headers" ? { all: true, scope: "headers" as const } : selection === "body-ordinal" ? { scope: "body" as const, revision: 2 } : selection === "paragraph-ordinal" ? { paragraph: 2, revision: 1 } : { select: original.find(item => item.id === "2")!.location.token };
  const batch = { version: 1 as const, operations: [{ operation, arguments: options }] };
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  let observed: unknown;
  if (route === "sdk") observed = await api.editDocumentRevisionDecisions(input, { operation, options: { ...options, output: "-" } }, context);
  else if (route === "sdk-batch") observed = (await api.executeDocumentBatch(input, batch, { output: "-" }, context)).results[0]!.data;
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const flags = selection === "default-all" ? "--all" : selection === "all-stories" ? "--all --scope all-stories" : selection === "headers" ? "--all --scope headers" : selection === "body-ordinal" ? "--scope body --revision 2" : selection === "paragraph-ordinal" ? "--paragraph 2 --revision 1" : `--select ${options.select}`;
      const result = await shell.exec((route === "cli" ? `docx ${operation.split(".").join(" ")} /input ${flags}` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`) + " --output /destination --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const data = JSON.parse(result.stdout).data; observed = route === "cli" ? data : data.results[0].data;
      memory.writeFileSync("/output", await fs.readFile("/destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect((observed as api.RevisionDecisionData).changes.map(change => change.revision.id)).toEqual(selectedIds);
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
  expect((await api.inspectDocumentRevisions(output, { scope: "all-stories" }, textContext)).items.map(item => item.id)).toEqual(["99", "7", "2", "3", "5"].filter(id => !selectedIds.includes(id)));
  const changedParts = new Set(original.filter(item => selectedIds.includes(item.id!)).map(item => item.location.value.part.slice(1)));
  for (const [name, bytes] of before) if (!changedParts.has(name)) expect(after.get(name), name).toEqual(bytes);
  for (const item of original) {
    const label = item.id === "99" ? "First海🌊" : item.id === "7" ? "Second" : item.id === "2" ? "Header" : item.id === "3" ? "Footnote" : "Comment";
    const xml = new TextDecoder().decode(after.get(item.location.value.part.slice(1)));
    expect(xml.includes(label)).toBe(operation === "revisions.accept" || !selectedIds.includes(item.id!));
  }
  expect([...after.keys()]).toEqual([...before.keys()]); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
