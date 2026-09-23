import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["sdk", "cli"]) for (const kind of ["insert", "delete"] as const)
it(`tracked scalar ranges retain an unselected positional tab; strict=${strict}; route=${route}; kind=${kind}`, async () => {
  const retained = '<w:r><w:ptab w:alignment="left" w:relativeTo="margin" w:leader="none"/></w:r>';
  const input = await textFixture('<w:p>' + retained + '<w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict);
  const document = await api.openDocumentLocations(input, textContext);
  const select = document.range(document.at("paragraph", 1).token, 2, kind === "insert" ? 2 : 3).token;
  const options = { kind, select, author: "", timestamp: "2026-01-02T03:04:06Z", ...(kind === "insert" ? { text: "X" } : {}) };
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  if (route === "sdk") {
    await api.editDocumentRevisions(input, { ...options, output: "-" } as api.RevisionEditOptions, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx revisions add /input --kind ${kind} --select '${select}' --author '' --timestamp ${options.timestamp}${kind === "insert" ? " --text X" : ""} --output /output --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 1, errors: [] });
      memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  expect((await api.extractDocumentText(output, textContext, { view: "original" })).text).toBe("\tCoast");
  expect((await api.extractDocumentText(output, textContext)).text).toBe(kind === "insert" ? "\tCXoast" : "\tCast");
  const before = readPackage(input), after = readPackage(output);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(retained);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
