import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, DocumentBudget, createDocxInspectionCommandEngine, inspectDocument, readArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { zip64Document } from "../tests/fixtures/zip64-members.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const compression of ["store", "deflate"] as const) for (const route of ["archive-sdk", "model", "sdk", "shell"] as const) for (const limit of ["maxArchiveBytes", "maxEntryBytes", "maxTotalBytes", "maxMembers", "maxPathBytes", "maxDepth", "maxExtraBytes", "maxCommentBytes"] as const) for (const boundary of ["below", "exact", "above"] as const) it(`${route} ${limit} ${boundary} admitted size; ${kind} strict=${strict} ${compression}`, async () => {
  const fixture = zip64Document({ strict, kind, compression, fields: "both", descriptor: "signed" });
  const input = new Uint8Array(fixture.input.length + 3); input.set(fixture.input); input.set([31, 137, 245], fixture.input.length); new DataView(input.buffer).setUint16(fixture.input.length - 2, 3, true);
  const thresholds = { maxArchiveBytes: input.length, maxEntryBytes: Math.max(...[...fixture.parts.values()].map(bytes => bytes.length)), maxTotalBytes: [...fixture.parts.values()].reduce((total, bytes) => total + bytes.length, 0), maxMembers: fixture.parts.size, maxPathBytes: Math.max(...[...fixture.parts.keys()].map(name => new TextEncoder().encode(name).length)), maxDepth: Math.max(...[...fixture.parts.keys()].map(name => name.split('/').length)), maxExtraBytes: 28, maxCommentBytes: 3 };
  const context = { ...textContext, limits: { ...textContext.limits, maxExtraBytes: 128, [limit]: thresholds[limit] + (boundary === "below" ? -1 : boundary === "above" ? 1 : 0) } };
  const before = input.slice(), memory = Volume.fromJSON({ '/input': Buffer.from(input), '/sentinel': 'retain' });
  if (route === "shell") {
    const fs = new MemoryFileSystem(); await fs.writeFile('/input', input); await fs.writeFile('/sentinel', new TextEncoder().encode('retain'));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: context.limits }) })).exec('docx inspect /input --json');
    expect(result.exitCode, result.stderr).toBe(boundary === 'below' ? 4 : 0);
    const envelope = JSON.parse(result.stdout);
    if (boundary === 'below') expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [expect.objectContaining({ code: 'limit-exceeded' })] });
    else expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [], data: { kind, dialect: strict ? 'strict' : 'transitional', counts: { paragraphs: 1 } } });
    expect(await fs.readFile('/input')).toEqual(input); expect(new TextDecoder().decode(await fs.readFile('/sentinel'))).toBe('retain');
  } else {
    const pending = route === 'model' ? Document(input, context) : route === 'sdk' ? inspectDocument(input, context) : readArchive(input, context);
    if (boundary === 'below') await expect(pending).rejects.toMatchObject({ code: 'limit-exceeded' });
    else {
      const result = await pending;
      if ('members' in result) { expect(new Map(result.members.map(m => [m.name, m.bytes]))).toEqual(fixture.parts); expect(result.comment).toEqual(Uint8Array.of(31, 137, 245)); }
      else if ('paragraphs' in result) { expect(result.paragraphs[0]!.text).toBe('Wide member'); expect(result.part.blob).toEqual(fixture.parts.get('reports/body.xml')); }
      else { expect(result.kind).toBe(kind); expect(result.dialect).toBe(strict ? 'strict' : 'transitional'); expect(result.counts.paragraphs).toBe(1); expect(result.parts).toHaveLength(fixture.parts.size); }
    }
  }
  expect(input).toEqual(before); expect(memory.readFileSync('/input')).toEqual(Buffer.from(input)); expect(memory.readFileSync('/sentinel', 'utf8')).toBe('retain');
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const compression of ["store", "deflate"] as const) for (const route of ["model", "sdk", "shell-host", "shell-option"] as const) for (const xmlDepth of [4, 5, 6]) it(`${route} keeps explicit XML depth ${xmlDepth} independent of ZIP path depth 2; ${kind} strict=${strict} ${compression}`, async () => {
  const { input } = zip64Document({ strict, kind, compression, fields: "both", descriptor: "signed" });
  const limits = { ...textContext.limits, maxDepth: 2, maxExtraBytes: 128 };
  const before = input.slice();
  if (route === 'model' || route === 'sdk') {
    const context = { ...textContext, limits, budget: new DocumentBudget({ xmlDepth }) };
    const pending = route === 'model' ? Document(input, context) : inspectDocument(input, context);
    if (xmlDepth < 5) await expect(pending).rejects.toMatchObject({ code: 'limit-exceeded' });
    else { const result = await pending; if ('paragraphs' in result) expect(result.paragraphs[0]!.text).toBe('Wide member'); else expect(result.counts.paragraphs).toBe(1); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile('/input', input);
    const engine = createDocxInspectionCommandEngine({ limits, ...(route === 'shell-host' ? { documentLimits: { xmlDepth } } : {}) });
    const result = await new Shell({ fs }).use(docxCommands({ engine })).exec('docx inspect /input --json' + (route === 'shell-option' ? ' --limit xmlDepth=' + xmlDepth : ''));
    expect(result.exitCode, result.stderr).toBe(xmlDepth < 5 ? 4 : 0);
    expect(JSON.parse(result.stdout)).toMatchObject(xmlDepth < 5 ? { ok: false, data: null, affected: 0, errors: [expect.objectContaining({ code: 'limit-exceeded' })] } : { ok: true, affected: 0, errors: [], data: { kind, counts: { paragraphs: 1 } } });
    expect(await fs.readFile('/input')).toEqual(input);
  }
  expect(input).toEqual(before);
});
