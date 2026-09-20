import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { DocumentBudget, createDocumentArchive, createDocxInspectionCommandEngine, documentDialects, inspectDocument, parseDocumentXml, writeDocumentArchive } from "./index.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { DocumentSession } from "./document-session.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { collectShapeCarriers } from "./shape-carriers.js";

const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024 };
const signal = new AbortController().signal;

it.each(["transitional", "strict"] as const)("reserves linear shape census ancestry for a nonshape story in %s", dialect => {
  const namespace = documentDialects[dialect].w;
  const root = parseDocumentXml(new TextEncoder().encode(`<w:document xmlns:w="${namespace}">${"<w:customXml>".repeat(128)}<w:p><w:r><w:t>Original 海 עברית 🌊</w:t></w:r></w:p>${"</w:customXml>".repeat(128)}</w:document>`)).root;
  const budget = new DocumentBudget({ retainedBytes: 32768 }, signal);
  const census = collectShapeCarriers(root, dialect, budget, new Map());
  expect(census).toEqual({ carriers: [], rawCarriers: [], bodyRoots: new Set() });
  expect(budget.usage.retainedBytes).toBeLessThanOrEqual(32768);
});

for (const dialect of ["transitional", "strict"] as const) for (const kind of ["docx", "dotx"] as const)
it(`inspects an original minimal ${kind} selected paragraph under unchanged 500000-byte ceilings in ${dialect}`, async () => {
  const archive = await createDocumentArchive({ kind, dialect }, { limits, signal });
  const memory = Volume.fromJSON({ "/input": "", "/destination": "Original retained destination" });
  await writeDocumentArchive(archive, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "name", compression: "store" }, { limits, signal });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = memory.toJSON();
  const inventory = await inspectDocument(input, { limits, signal });
  expect(inventory.counts.paragraphs).toBe(1);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Original retained destination"));
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits }) }));
  try {
    const result = await shell.exec("docx inspect /input --paragraph 1 --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 0, errors: [], data: { counts: { paragraphs: 1 } }, locations: [{ kind: "paragraph", positions: { paragraph: 1 } }] });
    expect(await fs.readFile("/input")).toEqual(input);
    expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Original retained destination");
  } finally { await shell.dispose(); }
  expect(memory.toJSON()).toEqual(before);
});

it("reuses admitted XML for original invalid-grid SDK and selected CLI inventory without editing admission", async () => {
  const { bytes } = await createDocumentFixture("museum", "invalid-grid");
  const memory = Volume.fromJSON({ "/input": Buffer.from(bytes), "/destination": "Original retained destination" });
  const before = memory.toJSON();
  const inventory = await inspectDocument(new Uint8Array(memory.readFileSync("/input") as Buffer), { limits, signal });
  expect(inventory.counts.tables).toBe(2);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", bytes);
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits }) }));
  try {
    const result = await shell.exec("docx inspect /input --paragraph 1 --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 0, errors: [], data: { counts: { tables: 2 } }, locations: [{ kind: "paragraph", positions: { paragraph: 1 } }] });
    expect(await fs.readFile("/input")).toEqual(bytes);
  } finally { await shell.dispose(); }
  expect(memory.toJSON()).toEqual(before);
});

it("inspects the current original staged archive instead of reacquiring its baseline", async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original baseline 海</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/publication": "Original destination" });
  const before = memory.toJSON(), budget = new DocumentBudget({}, signal);
  const session = await DocumentSession.open(new Uint8Array(memory.readFileSync("/input") as Buffer), { ...textContext, budget, encoding: { order: "input", compression: "store" } });
  await session.stage({ ...session.baseline, members: session.baseline.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("</w:body>", '<w:p><w:r><w:t>Current staged עברית 🌊</w:t></w:r></w:p></w:body>')) } : member) });
  const inventory = await inspectDocument(input, session.context);
  expect(inventory.counts.paragraphs).toBe(2);
  expect(inventory.stories[0]!.location.value.generation).toBe(1);
  expect(budget.usage.compressedInput).toBe(input.length);
  expect(session.generation).toBe(1);
  expect(memory.toJSON()).toEqual(before);
});
