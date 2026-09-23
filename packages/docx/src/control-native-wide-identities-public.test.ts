import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const raw of ["4294967296", "-4294967296", "9007199254740993", " &#x9;+0001&#xA; ", " &#x9;-0001&#xA; "])
for (const operation of ["controls.list", "controls.set", "controls.repeat", "template.apply"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`native signed arbitrary-width control identities; strict=${strict}; kind=${kind}; raw=${raw}; operation=${operation}; route=${route}`, async () => {
  const stored = raw.split("&#x9;").join("\t").split("&#xA;").join("\n"), childId = String(BigInt(stored.trim()) + 10n);
  const field = `<w:sdt><w:sdtPr><w:id w:val="${childId}"/><w:tag w:val="coast"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>`;
  const input = await textFixture(`<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="${raw}"/><w:tag w:val="rows"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${field}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt><w:p><!--outside--><w:r><w:t>Retained</w:t></w:r></w:p>`, {}, strict, { kind });
  const before = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const records = ["First海🌊", "Second"].map(value => ({ values: [{ binding: "coast", value }] }));
  const arguments_ = operation === "controls.list" ? {} : operation === "controls.set" ? { control: 3, text: "First海🌊" } : operation === "controls.repeat" ? { control: 1, data: records } : { data: records };
  const batch = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
  let observed: unknown;
  if (route.startsWith("sdk")) {
    if (route === "sdk-batch") {
      const result = await api.executeDocumentBatch(input, batch, operation === "controls.list" ? {} : { output: "-" }, context);
      if (operation === "controls.list") observed = result.results[0]!.data;
    } else if (operation === "controls.list") observed = await api.inspectDocumentControls(input, {}, context);
    else if (operation === "controls.set") await api.editDocumentControls(input, { control: 3, text: "First海🌊", output: "-" }, context);
    else if (operation === "controls.repeat") await api.editDocumentControlRepeats(input, { control: 1, data: records, output: "-" }, context);
    else await api.applyDocumentTemplate(input, { data: records, output: "-" }, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const flags = operation === "controls.list" ? "" : operation === "controls.set" ? "--control 3 --text 'First海🌊'" : `${operation === "controls.repeat" ? "--control 1 " : ""}--data-json '${JSON.stringify(records)}'`;
      const result = await shell.exec((route === "cli" ? `docx ${operation.split(".").join(" ")} /input ${flags}` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`) + (operation === "controls.list" ? " --json" : " --output /destination --force --json"));
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      if (operation === "controls.list") {
        const data = JSON.parse(result.stdout).data; observed = route === "cli" ? data : data.results[0].data;
        expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained destination");
      } else memory.writeFileSync("/output", await fs.readFile("/destination"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (operation === "controls.list") {
    expect(observed).toMatchObject({ items: [{ id: stored, kind: "repeating-section" }, { id: "2", kind: "repeating-item" }, { id: childId, tag: "coast", value: "Old" }] });
    expect(memory.statSync("/output").size).toBe(0);
  } else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    const controls = (await api.inspectDocumentControls(output, {}, textContext)).items;
    expect(controls[0]!.id).toBe(stored);
    expect(controls.filter(item => item.tag === "coast").map(item => item.value)).toEqual(operation === "controls.set" ? ["First海🌊"] : ["First海🌊", "Second"]);
    expect(new Set(controls.map(item => BigInt(item.id!.trim()).toString())).size).toBe(controls.length);
    const xml = new TextDecoder().decode(after.get("word/document.xml"));
    expect(xml).toContain(`<w:id w:val="${raw}"/>`);
    expect(xml).toContain('<!--outside--><w:r><w:t>Retained</w:t></w:r>');
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    expect([...after.keys()]).toEqual([...before.keys()]);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
