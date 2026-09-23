import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const raw of ["-7", "4294967296", "9007199254740991", "9007199254740993", "-9007199254740993", " &#x9;+001&#xA; ", "-0"])
for (const action of ["retain-and-track", "accept", "reject"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`native revision integer identity is retained or decided; strict=${strict}; kind=${kind}; raw=${raw}; action=${action}; route=${route}`, async () => {
  const input = await textFixture(`<w:p><w:ins w:id="${raw}" w:author="Archive" w:date="2026-01-02T03:04:05Z"><w:r><w:t>Native</w:t></w:r></w:ins></w:p><w:p><!--outside--><w:r><w:t>Coast</w:t></w:r></w:p>`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), before = readPackage(input);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const operation = action === "retain-and-track" ? "text.replace" : action === "accept" ? "revisions.accept" : "revisions.reject";
  const options = action === "retain-and-track" ? { find: "Coast", with: "Shore", all: true, trackChanges: true, author: "Current", timestamp: "2026-03-04T05:06:07Z" } : { revision: 1 };
  expect((await api.inspectDocumentRevisions(input, {}, textContext)).items[0]!.id).toBe(raw.includes("&#") ? " \t+001\n " : raw);
  if (route === "sdk") {
    if (action === "retain-and-track") await api.replaceDocumentText(input, { find: "Coast", with: "Shore", all: true, trackChanges: true, author: "Current", timestamp: "2026-03-04T05:06:07Z", output: "-" }, context);
    else await api.editDocumentRevisionDecisions(input, { operation, options: { ...options, output: "-" } } as Parameters<typeof api.editDocumentRevisionDecisions>[1], context);
  } else if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation, arguments: options }] }, { output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec((route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation, arguments: options }] })}'` : action === "retain-and-track" ? 'docx text replace /input --find Coast --with Shore --all --track-changes --author Current --timestamp 2026-03-04T05:06:07Z' : `docx revisions ${action} /input --revision 1`) + " --output /output --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  const revisions = await api.inspectDocumentRevisions(output, {}, textContext);
  expect(revisions.items).toHaveLength(action === "retain-and-track" ? 3 : 0);
  if (action === "retain-and-track") {
    expect(revisions.items[0]!.id).toBe(raw.includes("&#") ? " \t+001\n " : raw);
    expect(new Set(revisions.items.map(item => BigInt(item.id!))).size).toBe(3);
    expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(`w:id="${raw}"`);
  }
  expect((await api.extractDocumentText(output, textContext, { view: "final" })).text).toBe(action === "reject" ? "\nCoast" : action === "accept" ? "Native\nCoast" : "Native\nShore");
  expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain('<!--outside-->');
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect([...after.keys()]).toEqual([...before.keys()]); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
