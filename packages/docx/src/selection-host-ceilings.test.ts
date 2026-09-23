import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true])
for (const route of ["locations", "sdk-text", "sdk-table", "sdk-batch", "cli-text", "cli-table", "cli-batch"] as const)
it(`${route} preserves admitted host ceilings through selection; strict=${strict}`, async () => {
  const text = "Original 日本 עברית é 🌊", replacement = "Revised 日本 עברית é 🌊";
  const input = await textFixture(`<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`, {}, strict);
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }); memory.writeFileSync("/input", input);
  const original = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const limit = [{ name: "xmlDepth" as const, value: 512 }];
  const context = { ...textContext, budget: new api.DocumentBudget({ xmlDepth: 1024 }), encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const batch = { version: 1, operations: [{ operation: "tables.set", arguments: { table: 1, cell: "A1", text: replacement } }] };
  const read = route === "locations" || route.endsWith("text");
  if (route === "locations") {
    const document = await api.openDocumentLocations(original, context);
    const invocation = { operation: "tables.get", inputs: ["document"], options: { table: 1, limit } };
    expect(api.resolveDocxSelection(document, invocation)[0]!.positions.table).toBe(1);
    expect(document.text({ limit }).text).toBe(text);
  } else if (route === "sdk-text") expect((await api.extractDocumentText(original, context, { limit })).text).toBe(text);
  else if (route === "sdk-table") await api.editDocumentTables(original, { operation: "tables.set", options: { table: 1, cell: "A1", text: replacement, limit, output: "-" } }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(original, batch, { limit, output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", original);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: { xmlDepth: 1024 } }) }));
    try {
      const command = route === "cli-text" ? "docx text /input" : route === "cli-table" ? `docx tables set /input --table 1 --cell A1 --text '${replacement}'` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
      const result = await shell.exec(command + " --limit xmlDepth=512 --json" + (read ? "" : " --output /output"));
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.errors).toEqual([]);
      if (read) expect(envelope.data.text).toBe(text);
      else memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  if (!read) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    expect((await api.Document(output, textContext)).tables[0]!.cell(0, 0).text).toBe(replacement);
    const before = readPackage(original), after = readPackage(output);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name)).toEqual(bytes);
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});

for (const strict of [false, true])
for (const route of ["sdk-text", "sdk-table", "sdk-batch", "cli-text", "cli-table", "cli-batch"] as const)
for (const boundary of ["host-at", "host-over", "input-over"] as const)
it(`${route} enforces ${boundary} independently of selection defaults; strict=${strict}`, async () => {
  const text = "Boundary 日本 עברית é 🌊";
  const input = await textFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`, {}, strict);
  const memory = Volume.fromJSON({ "/input": "", "/destination": "Retained destination" }); memory.writeFileSync("/input", input);
  const original = new Uint8Array(memory.readFileSync("/input") as Buffer), retained = new Uint8Array(memory.readFileSync("/destination") as Buffer);
  const limit = [{ name: "xmlDepth" as const, value: boundary === "host-at" ? 1024 : boundary === "host-over" ? 1025 : 1 }];
  const context = { ...textContext, budget: new api.DocumentBudget({ xmlDepth: 1024 }), encoding: { order: "input" as const, compression: "store" as const } };
  const batch = { version: 1, operations: [{ operation: "tables.set", arguments: { table: 1, cell: "A1", text: "Changed" } }] };
  const code = boundary === "host-over" ? "usage" : boundary === "input-over" ? "limit-exceeded" : undefined;
  if (route.startsWith("sdk-")) {
    const result = route === "sdk-text" ? api.extractDocumentText(original, context, { limit }) : route === "sdk-table" ? api.editDocumentTables(original, { operation: "tables.set", options: { table: 1, cell: "A1", text: "Changed", limit, dryRun: true } }, context) : api.executeDocumentBatch(original, batch, { limit, dryRun: true }, context);
    if (code) await expect(result).rejects.toMatchObject({ code });
    else {
      const data = await result;
      if ("text" in data) expect(data.text).toBe(text);
      else if ("publication" in data) { expect(data.publication!.dryRun).toBe(true); expect(data.publication!.output).toBe(null); }
      else { expect(data.changed).toBe(true); expect(data.dryRun).toBe(true); expect(data.output).toBe(null); }
    }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", original); await fs.writeFile("/destination", retained);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: { xmlDepth: 1024 } }) }));
    try {
      const command = route === "cli-text" ? "docx text /input" : route === "cli-table" ? "docx tables set /input --table 1 --cell A1 --text Changed --dry-run --output /destination --force" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run --output /destination --force`;
      const result = await shell.exec(command + ` --limit xmlDepth=${limit[0]!.value} --json`), envelope = JSON.parse(result.stdout);
      expect(result.exitCode, result.stdout + result.stderr).toBe(code === "usage" ? 2 : code ? 4 : 0);
      if (code) expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code }] });
      else { expect(envelope.ok).toBe(true); expect(envelope.errors).toEqual([]); if (route === "cli-text") expect(envelope.data.text).toBe(text); else expect(route === "cli-batch" ? envelope.data.publication.output : envelope.data.output).toBe(null); }
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(retained);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
  expect(new Uint8Array(memory.readFileSync("/destination") as Buffer)).toEqual(retained);
});
