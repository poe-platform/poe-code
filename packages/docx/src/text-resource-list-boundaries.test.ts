import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const resource of ["paragraphs", "runs"] as const) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} enforces ${resource} list owner, stale, missing and exact token boundaries; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>One</w:t></w:r><w:r><w:t>Two</w:t></w:r></w:p><w:p><w:r><w:t>Three</w:t></w:r></w:p>'), locations = await api.openDocumentLocations(input, textContext, "inventory"), opposite = locations.list(resource === "paragraphs" ? "run" : "paragraph")[0]!.token, selected = locations.list(resource === "paragraphs" ? "paragraph" : "run")[0]!.token, other = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Other</w:t></w:r></w:p>'), stale = (await api.openDocumentLocations(other.input, textContext, "inventory")).list(resource === "paragraphs" ? "paragraph" : "run")[0]!.token;
  const read = resource === "paragraphs" ? api.inspectDocumentParagraphs : api.inspectDocumentRuns;
  const cases = [{ options: { select: selected }, texts: [resource === "paragraphs" ? "OneTwo" : "One"] }, { options: { paragraph: 1, ...(resource === "runs" ? { run: 2 } : {}) }, texts: [resource === "paragraphs" ? "OneTwo" : "Two"] }, { options: { select: opposite }, code: "missing-selection" }, { options: { select: stale }, code: "stale-selection" }, { options: { paragraph: 99 }, code: "missing-selection" }];
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = route.startsWith("shell") ? new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })) : undefined;
  try { for (const entry of cases) {
    const batch = { version: 1, operations: [{ operation: `${resource}.list`, arguments: entry.options }] };
    if (!shell) { const result = route === "sdk" ? read(input, entry.options, textContext) : api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input", compression: "store" } }); if (entry.code) await expect(result).rejects.toMatchObject({ code: entry.code }); else { const value = await result, data = "items" in value ? value : value.results[0]!.data as api.TextResourceListData; expect(data.items.map(i => i.text)).toEqual(entry.texts); } }
    else { const flags = Object.entries(entry.options).map(([key, value]) => `--${key} ${value}`).join(" "), result = await shell.exec(route === "shell" ? `docx ${resource} list /input ${flags} --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --json`), envelope = JSON.parse(result.stdout); expect(result.exitCode, result.stdout + result.stderr).toBe(entry.code ? 1 : 0); if (entry.code) expect(envelope).toMatchObject({ data: null, affected: 0, errors: [{ code: entry.code }] }); else { const data = route === "shell" ? envelope.data : envelope.data.results[0].data; expect(data.items.map((i: { text: string }) => i.text)).toEqual(entry.texts); } }
  } expect(await fs.readFile("/input")).toEqual(input); } finally { await shell?.dispose(); }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const resource of ["paragraphs", "runs"] as const)
it(`bounds aggregate ${resource} list output exactly and cancels without partial records; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>One</w:t></w:r><w:r><w:t>Two</w:t></w:r></w:p><w:p><w:r><w:t>Three</w:t></w:r></w:p>'), read = resource === "paragraphs" ? api.inspectDocumentParagraphs : api.inspectDocumentRuns, expected = await read(input, {}, textContext), size = new TextEncoder().encode(JSON.stringify(expected)).length;
  expect(await read(input, { limit: [{ name: "serializedOutput", value: size }] }, textContext)).toEqual(expected);
  await expect(read(input, { limit: [{ name: "serializedOutput", value: size - 1 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(read(input, { limit: [{ name: "matches", value: expected.items.length - 1 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
  const controller = new AbortController(); controller.abort(); await expect(read(input, {}, { ...textContext, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
});
