import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type { PropertyValue } from "./property-values.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const depth of [512, 4096]) for (const route of ["snapshot", "resource", "cli"] as const)
for (const capacity of ["default", "raised", "insufficient"] as const)
it(`inventories inert settings at admitted depth; strict=${strict}; kind=${kind}; depth=${depth}; route=${route}; capacity=${capacity}`, async () => {
  const input = await textFixture("<w:p/>", { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat>${"<w:x>".repeat(depth)}<w:leaf w:stored="海"/>${"</w:x>".repeat(depth)}</w:compat></w:settings>` } }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), context = { ...textContext, budget: new api.DocumentBudget({ xmlDepth: 8192, ...(capacity === "insufficient" ? { retainedBytes: 1 } : capacity === "raised" ? { retainedBytes: 1024 * 1024 * 1024 } : {}) }, textContext.signal) };
  let properties: readonly PropertyValue[] | undefined;
  const refused = capacity === "insufficient" || route === "cli" && depth === 4096 && capacity === "default";
  if (route === "snapshot" || route === "resource") {
    const run = () => route === "snapshot" ? api.inspectDocumentSettings(input, {}, context) : api.inspectDocumentSettings(input, {}, context, "resource");
    if (refused) await expect(run()).rejects.toMatchObject({ code: "limit-exceeded" });
    else if (route === "snapshot") { const item = (await api.inspectDocumentSettings(input, {}, context)).items[0]!; expect(item.details.entries).toHaveLength(depth + 2); expect(item.details.entries.at(-1)).toMatchObject({ localName: "leaf", path: Array(depth + 2).fill(0), attributes: [expect.objectContaining({ localName: "stored", value: "海" })] }); }
    else properties = (await api.inspectDocumentSettings(input, {}, context, "resource")).items[0]!.properties;
  } else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs, limits: { maxOutputBytes: 67108864 } }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: { xmlDepth: 8192, ...(capacity === "raised" ? { retainedBytes: 1024 * 1024 * 1024 } : {}) } }) }));
    try { const result = await shell.exec("docx settings list /input --json" + (capacity === "insufficient" ? " --limit retainedBytes=1" : "")); expect(result.exitCode, result.stderr).toBe(refused ? 4 : 0); const envelope = JSON.parse(result.stdout); if (refused) expect(envelope.errors[0].code).toBe("limit-exceeded"); else properties = envelope.data.items[0].properties; expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  if (properties) { expect(properties).toContainEqual({ name: "entryCount", type: "integer", value: depth + 2, writable: false, cached: false }); expect(properties).toContainEqual({ name: `settings[${Array(depth + 2).fill(0).join(".")}].localName`, type: "string", value: "leaf", writable: false, cached: false }); expect(properties).toContainEqual({ name: `settings[${Array(depth + 2).fill(0).join(".")}].attributes[0].value`, type: "string", value: "海", writable: false, cached: false }); }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.statSync("/output").size).toBe(0);
});
