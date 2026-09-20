import { Volume } from "memfs";
import { expect, it, vi } from "vitest";
import { Document } from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

for (const count of [64, 128, 256]) for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"])
it(`materializes original native run handles without scanning prior handles quadratically; strict=${strict}; carrier=${carrier}${count === 64 ? "" : `; count=${count}`}`, async () => {
  const runs = Array.from({ length: count }, (_, index) => `<w:r><w:t>Original ${index} 日本 עברית é 🌊</w:t></w:r>`).join("");
  const selected = carrier === "direct" ? runs : carrier === "process" ? `<f:pass>${runs}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? runs : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? runs : ""}</mc:Fallback></mc:AlternateContent>`;
  const f = await nativeStoryFixture("document.Document", strict, "docx", `<w:p xmlns:f="urn:original:handle-bounds" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${selected}</w:p><w:sectPr/>`);
  const memory = Volume.fromJSON({ "/input": Buffer.from(f.input) }), doc = await Document(new Uint8Array(memory.readFileSync("/input") as Buffer), textContext), p = doc.paragraphs[0]!;
  const values = Map.prototype.values;
  let handleVisits = 0;
  const observer = vi.spyOn(Map.prototype, "values").mockImplementation(function* (this: Map<unknown, unknown>) {
    for (const value of values.call(this)) {
      if (value && typeof value === "object" && "ref" in value && "node" in value && "identity" in value && "part" in value) handleVisits++;
      yield value;
    }
    return undefined;
  });
  try {
    const initialWork = p.store.context.budget.usage.work, first = p.runs, second = p.runs;
    expect(first).toHaveLength(count);
    expect(second).toHaveLength(count);
    expect(second.every((run, index) => run === first[index])).toBe(true);
    expect(first.map(run => run.text)).toEqual(Array.from({ length: count }, (_, index) => `Original ${index} 日本 עברית é 🌊`));
    expect(p.store.context.budget.usage.work - initialWork).toBeGreaterThanOrEqual(handleVisits);
    expect(handleVisits).toBeLessThanOrEqual(count * 8);
    expect(Buffer.from(memory.readFileSync("/input") as Buffer).equals(f.input)).toBe(true);
  } finally { observer.mockRestore(); }
});

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"])
for (const transition of ["format", "failed-change", "rollback", "remove", "rename"] as const)
it(`keeps cached native handles owner-bound and live across ${transition}; strict=${strict}; carrier=${carrier}`, async () => {
  const runs = '<w:r><w:t>Original 日本 עברית é 🌊</w:t></w:r><w:r><w:t>Retain second</w:t></w:r>';
  const selected = carrier === "direct" ? runs : carrier === "process" ? `<f:pass>${runs}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? runs : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? runs : ""}</mc:Fallback></mc:AlternateContent>`;
  const f = await nativeStoryFixture("document.Document", strict, "docx", `<w:p xmlns:f="urn:original:handle-lifecycle" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${selected}</w:p><w:sectPr/>`);
  const memory = Volume.fromJSON({ "/input": Buffer.from(f.input) }), doc = await Document(new Uint8Array(memory.readFileSync("/input") as Buffer), textContext), p = doc.paragraphs[0]!, first = p.runs, failure = new Error("Original rejected operation");
  if (transition === "format") { first[0]!.bold = true; expect(p.runs[0]).toBe(first[0]); expect(first[0]!.bold).toBe(true); }
  if (transition === "failed-change") {
    expect(() => p.store.change(p.ref.part, () => { expect(p.runs[0]).toBe(first[0]); throw failure; })).toThrow(failure);
    expect(p.runs[0]).toBe(first[0]);
  }
  if (transition === "rollback") {
    let transient: typeof first[number] | undefined;
    expect(() => p.store.transaction(() => { first[0]!.bold = true; transient = p.add_run("Uncommitted"); expect(p.runs.at(-1)).toBe(transient); throw failure; })).toThrow(failure);
    expect(p.runs[0]).toBe(first[0]); expect(p.runs).toHaveLength(2); expect(first[0]!.bold).toBeNull(); expect(() => transient!.text).toThrow("detached");
  }
  if (transition === "remove") { first[0]!.element.remove(); expect(p.runs).toHaveLength(1); expect(p.runs[0]).toBe(first[1]); expect(() => first[0]!.text).toThrow("detached"); }
  if (transition === "rename") { doc.part.partname = "/stories/renamed.xml"; expect(p.runs[0]).toBe(first[0]); expect(p.ref.part).toBe("/stories/renamed.xml"); expect(first[0]!.part).toBe(doc.part); }
  expect(p.runs.at(-1)).toBe(first[1]); expect(first[1]!.text).toBe("Retain second");
  if (transition !== "remove") expect(first[0]!.text).toBe("Original 日本 עברית é 🌊");
  expect(Buffer.from(memory.readFileSync("/input") as Buffer).equals(f.input)).toBe(true);
});
