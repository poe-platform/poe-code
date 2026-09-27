import { Volume } from "memfs";
import { expect, it } from "vitest";
import { writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";

const api = await compiledPublicRuntime;
const { Shell, MemoryFileSystem, docxCommands } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(
  `export { Shell, MemoryFileSystem } from ${JSON.stringify(new URL("../../safe-bash/dist/index.js", import.meta.url).href)};` +
  `export { docxCommands } from ${JSON.stringify(new URL("../../safe-bash/dist/commands/docx/index.js", import.meta.url).href)};`
).toString("base64")}`) as typeof import("@poe-platform/safe-bash") & typeof import("@poe-platform/safe-bash/commands/docx");

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const depth of [32, 4096])
it(`native opaque control fill rejects atomically at depth${depth}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const parts = readPackage(await textFixture("<w:p/>", {}, strict, { kind }));
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const control = (id: number, body: string) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:text/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Coast</w:t>${body}</w:r></w:sdtContent></w:sdt>`;
  const opaque = "<f:opaque>".repeat(depth) + '<w:t>Never activated</w:t>' + "</f:opaque>".repeat(depth);
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${word}" xmlns:f="urn:original:inert-control" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p>${control(31, "")}</w:p><w:p>${control(32, opaque)}</w:p></w:body></w:document>`));
  const memory = Volume.fromJSON({ "/input": "" });
  const limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288 };
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const saved = input.slice(), signal = new AbortController().signal;
  const documentLimits = { xmlDepth: 8192 };
  const budget = () => new api.DocumentBudget(documentLimits, signal);
  memory.writeFileSync("/output", "");
  const context = { limits, signal, budget: budget(), encoding: { order: "input", compression: "store" } as const,
    stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const ops = { version: 1 as const, operations: [{ operation: "controls.set", arguments: { all: true, text: "Shore" } }] };
  const observed = await api.inspectDocumentControls(input, {}, { limits, signal, budget: budget() });
  expect(observed.items.map(item => item.value)).toEqual(["Coast", "Coast"]);
  if (route === "sdk") {
    await expect(api.editDocumentControls(input, { all: true, text: "Shore", output: "-" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  } else if (route === "sdk-batch") {
    await expect(api.executeDocumentBatch(input, ops, { output: "-" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  } else {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", input);
    await fs.writeFile("/output", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const command = route === "cli" ? "docx controls set /input --all --text Shore --output /output --force --json"
        : "docx batch /input --ops-json " + JSON.stringify(JSON.stringify(ops)) + " --output /output --force --json";
      const result = await shell.exec(command);
      expect(result.exitCode, result.stdout + result.stderr).not.toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.affected).toBe(0);
      expect(envelope.errors[0].code).toBe("unsupported-edit");
      expect(await fs.readFile("/input")).toEqual(saved);
      expect(new TextDecoder().decode(await fs.readFile("/output"))).toBe("Retained destination");
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(saved);
  expect(memory.statSync("/output").size).toBe(0);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
