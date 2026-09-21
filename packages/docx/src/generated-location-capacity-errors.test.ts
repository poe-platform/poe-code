import { Volume } from "memfs";
import { expect, it, vi } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const fixtureIndex = vi.hoisted(() => ({ pathDepth: 0 }));
vi.mock("./location-index.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./location-index.js")>();
  return { ...actual, LocationIndex: class extends actual.LocationIndex {
    constructor(...args: ConstructorParameters<typeof actual.LocationIndex>) {
      super(...args);
      // Public original deep XML execution independently proves these addresses.
      // Replace only costly path indexing; retain admitted XML and real text nodes.
      for (const entry of this.entries) if (entry.kind === "run") {
        const path = entry.path;
        Object.defineProperty(entry, "path", { value: [...path,
          ...Array<number>(Math.max(0, fixtureIndex.pathDepth - path.length)).fill(0)] });
      }
    }
  } };
});

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const)
for (const boundary of ["normal", "canonical-bytes", "minimum-path"] as const)
it(`reports generated location capacity as a resource failure; strict=${strict}; route=${route}; boundary=${boundary}`, async () => {
  fixtureIndex.pathDepth = boundary === "normal" ? 32 : boundary === "canonical-bytes" ? 12288 : 13000;
  const text = "e\u0323\u0301 日本 \u2067אב\u2069 العربية 𠀀";
  const input = await textFixture(`<w:p><w:r><w:rPr><w:rtl/><w:lang w:val="ja-JP" w:bidi="he-IL"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`, {}, strict);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "Retain destination", "/stdout": "" });
  const before = Buffer.from(memory.readFileSync("/input") as Buffer), destination = Buffer.from(memory.readFileSync("/out") as Buffer);
  const budget = new api.DocumentBudget({ xmlDepth: 16384 }), ctx = { ...textContext, budget };
  if (route === "sdk") {
    const action = api.extractDocumentText(new Uint8Array(memory.readFileSync("/input") as Buffer), ctx);
    if (boundary === "normal") {
      const result = await action;
      expect(result.text).toBe(text);
      const selected = result.segments.find(segment => segment.text === text)!;
      expect(selected.formatting.rtl).toBe(true);
      expect(selected.location.value.path).toHaveLength(32);
      expect(api.decodeLocation(selected.location.token)).toEqual(selected.location.value);
    } else await expect(action).rejects.toMatchObject({ code: "limit-exceeded" });
  } else {
    const engine = api.createDocxInspectionCommandEngine({ limits: textContext.limits, documentLimits: { xmlDepth: 16384 } });
    const result = await engine.execute({ args: ["text", "/input", "--json"].map(arg => new TextEncoder().encode(arg)), cwd: "/", signal: ctx.signal,
      filesystem: { async readFile(path) { return new Uint8Array(memory.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { memory.appendFileSync("/stdout", bytes); } }, stderr: { async write() {} } });
    const envelope = JSON.parse(String(memory.readFileSync("/stdout")));
    expect(result.exitCode).toBe(boundary === "normal" ? 0 : 4);
    if (boundary === "normal") expect(envelope.data.text).toBe(text);
    else expect(envelope).toMatchObject({ ok: false, data: null, errors: [{ code: "limit-exceeded" }], affected: 0, locations: [] });
  }
  expect(Buffer.from(memory.readFileSync("/input") as Buffer)).toEqual(before);
  expect(Buffer.from(memory.readFileSync("/out") as Buffer)).toEqual(destination);
});
