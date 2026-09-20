import { Volume } from "memfs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, DocumentBudget, applyStyleModelBatch, createDocxInspectionCommandEngine, extractDocumentText, decodeLocation } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const)
it(`reads original admitted native carrier paths beyond the default depth; strict=${strict}; route=${route}`, async () => {
  const text = "Original 日本 עברית ẹ́ 🌊 𠀀", depth = 260;
  const body = `<w:p xmlns:f="urn:original:raised-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${"<f:pass>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:pass>".repeat(depth)}</w:p>`;
  const input = await textFixture(body, {}, strict), memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  if (route === "sdk") {
    const result = await extractDocumentText(new Uint8Array(memory.readFileSync("/input") as Buffer), {
      ...textContext, budget: new DocumentBudget({ xmlDepth: depth + 8 }, textContext.signal)
    });
    expect(result.text).toBe(text);
    const selected = result.segments.find(segment => segment.text === text)!;
    expect(selected.formatting.rtl).toBe(true);
    expect(selected.location.value.path.length).toBeGreaterThan(256);
    expect(decodeLocation(selected.location.token)).toEqual(selected.location.value);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: { xmlDepth: depth + 8 } }) }));
    try {
      const result = await shell.exec("docx text /input --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.data.text).toBe(text);
      expect(envelope.errors).toEqual([]);
      expect(envelope.affected).toBe(0);
      const selected = envelope.data.segments.find((segment: { text: string }) => segment.text === text);
      expect(selected.formatting.rtl).toBe(true);
      expect(decodeLocation(selected.location.token)).toEqual(selected.location.value);
      expect(await fs.readFile("/input")).toEqual(input);
      expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retain destination");
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const strict of [false, true])
it(`indexes original deep admitted carrier paths without a call-stack refusal; strict=${strict}`, async () => {
  const depth = 2048, text = "Deep 日本 עברית ẹ́ 🌊 𠀀";
  const body = `<w:p xmlns:f="urn:original:deep-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${"<f:pass>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:pass>".repeat(depth)}</w:p>`;
  const input = await textFixture(body, {}, strict), memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  const result = await extractDocumentText(new Uint8Array(memory.readFileSync("/input") as Buffer), {
    ...textContext, budget: new DocumentBudget({ xmlDepth: depth + 8 }, textContext.signal)
  });
  expect(result.text).toBe(text);
  expect(result.segments.some(segment => segment.text === text && segment.formatting.rtl === true)).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const strict of [false, true])
it(`projects original deep process content iteratively within its trusted ceiling; strict=${strict}`, async () => {
  const depth = 4096, text = "Projected 日本 עברית ẹ́ 🌊 𠀀";
  const body = `<w:p xmlns:f="urn:original:deep-projection" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:p">${"<f:p>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:p>".repeat(depth)}</w:p>`;
  const input = await textFixture(body, {}, strict), memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  const result = await extractDocumentText(new Uint8Array(memory.readFileSync("/input") as Buffer), {
    ...textContext, budget: new DocumentBudget({ xmlDepth: depth + 8 }, textContext.signal)
  });
  expect(result.text).toBe(text);
  expect(result.segments.some(segment => segment.text === text && segment.formatting.rtl === true)).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const strict of [false, true])
it(`reads original deep carriers in an isolated public Node process; strict=${strict}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-carrier-worker.ts", import.meta.url)), strict ? "strict" : "transitional"]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, xmlDepth: 4104, exactTextAndReadPurity: true });
});

for (const strict of [false, true]) for (const route of ["native", "typed", "cli", "replace", "cli-replace"])
for (const action of route.includes("replace") ? ["edit", "dry"] : ["read", "edit", "dry"])
it(`retains original isolated deep carrier publication semantics; strict=${strict}; route=${route}; action=${action}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-carrier-worker.ts", import.meta.url)), strict ? "strict" : "transitional", route, action]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, xmlDepth: 4104, exactTextAndReadPurity: true, route, action, exactPublicationAndRetention: true });
});

for (const strict of [false, true]) for (const route of ["native", "sdk", "typed", "cli"])
for (const depth of [250, 251])
it(`honors the original exact default depth boundary; strict=${strict}; route=${route}; depth=${depth}`, async () => {
  const text = "Boundary 日本 עברית ẹ́ 🌊 𠀀";
  const body = `<w:p xmlns:f="urn:original:default-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:p">${"<f:p>".repeat(depth)}<w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>${"</f:p>".repeat(depth)}</w:p>`;
  const input = await textFixture(body, {}, strict), memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {} }
  ];
  if (route === "cli") {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx text /input --json"), envelope = JSON.parse(result.stdout);
      expect(result.exitCode, result.stdout + result.stderr).toBe(depth === 250 ? 0 : 4);
      if (depth === 250) expect(envelope.data.text).toBe(text);
      else expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "limit-exceeded" }] });
      expect(await fs.readFile("/input")).toEqual(input);
      expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retain destination");
    } finally { await shell.dispose(); }
  } else {
    const perform = async () => {
      if (route === "native") return (await Document(input, textContext)).paragraphs[0]!.text;
      if (route === "typed") return (await applyStyleModelBatch(input, { version: 1, operations }, textContext)).results[1]!.value;
      return (await extractDocumentText(input, textContext)).text;
    };
    if (depth === 250) expect(await perform()).toBe(text);
    else await expect(perform()).rejects.toMatchObject({ code: "limit-exceeded" });
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const strict of [false, true]) for (const route of ["sdk", "cli"]) for (const action of ["read", "edit", "dry"])
it(`honors original deep native text-box story semantics; strict=${strict}; route=${route}; action=${action}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-box-carrier-worker.ts", import.meta.url)), strict ? "strict" : "transitional", route, action]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, route, action, exactStoryIsolationAndRetention: true });
});
