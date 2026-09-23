import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const row of [169, 170]) for (const author of ["", "Archivist"])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact core-properties part witness R${row}; ${kind}; strict=${strict}; author=${author}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), timestamp = new Date("2001-02-03T04:05:06.900Z");
  const context = { ...textContext, author, timestamp, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    ...(row === 170 ? [{ operation: "model.opc.parts.coreprops.CorePropertiesPart.default.call", arguments: { ownerPackage: ref("package") }, resultHandle: "part" }] : [
      { operation: "model.document.Document.core_properties.get", receiver: ref("document"), arguments: {}, resultHandle: "materialized" },
      { operation: "model.opc.coreprops.CoreProperties.part.get", receiver: ref("materialized"), arguments: {}, resultHandle: "part" }
    ]),
    { operation: "model.opc.parts.coreprops.CorePropertiesPart.core_properties.get", receiver: ref("part"), arguments: {}, resultHandle: "core" },
    ...["title", "last_modified_by", "revision", "modified"].map(key => ({ operation: `model.opc.coreprops.CoreProperties.${key}.get`, receiver: ref("core"), arguments: {} }))
  ];
  const observe = (values: unknown[]) => expect(values.slice(-4)).toEqual(["Document", author, 1, "2001-02-03T04:05:06.000Z"]);
  if (route === "model") {
    const doc = await api.Document(input, context), owner = doc.part.package;
    const part = row === 170 ? api.CorePropertiesPartView.default(owner) : doc.core_properties.part;
    expect(part).toBeInstanceOf(api.CorePropertiesPartView);
    if (!(part instanceof api.CorePropertiesPartView)) throw new Error("Expected a native core-properties part.");
    const core = part.core_properties;
    expect(core).toBeInstanceOf(api.CoreProperties); expect(core.part).toBe(part); expect(part.package).toBe(owner);
    expect(core).toBe(part.core_properties); expect(core.element.serialize()).toEqual(part.element.serialize());
    observe([core.title, core.last_modified_by, core.revision, core.modified?.toISOString()]);
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", author, timestamp: "2001-02-03T04:05:06.900Z" }, { ...context, stdout: sink });
    observe(result.results.map(item => item.data));
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --timestamp 2001-02-03T04:05:06.900Z --author '${author}' --output /destination --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); observe(JSON.parse(result.stdout).data.results.map((item: { data: unknown }) => item.data));
      memory.writeFileSync("/output", await fs.readFile("/destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "_rels/.rels"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const reread = (await api.Document(output, context)).core_properties;
  observe([reread.title, reread.last_modified_by, reread.revision, reread.modified?.toISOString()]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
