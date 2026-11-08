import { expect, it } from "vitest";
import { serializeFormAppearanceChunks } from "./form-appearance-chunks.js";

// Frozen compatibility oracle for the existing form appearance operators.
function legacy(text: string, options: { width: number; height: number; fontSize?: number; colorOp?: string; alignment?: number; maxLength?: number; comb?: boolean; password?: boolean }) {
  const escape = (s: string) => s.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const lines = (options.password ? "*".repeat(text.length) : text).replaceAll("\r\n", "\n").split("\n");
  const y = lines.length > 1 ? Math.max(4, options.height - 13) : 4;
  let ops: string;
  if (options.comb && options.maxLength && options.maxLength > 0 && lines.length === 1) {
    const cell = options.width / options.maxLength;
    ops = Array.from(lines[0]!).slice(0, options.maxLength).map((ch, i) => `1 0 0 1 ${Number((i * cell + Math.max(1, (cell - 6) / 2)).toFixed(2))} ${Math.round(y)} Tm (${escape(ch)}) Tj`).join(" ");
  } else {
    let previous = 0;
    ops = lines.map((line, i) => {
      const x = options.alignment === 1 ? Math.max(2, Math.round((options.width - line.length * 6) / 2)) : options.alignment === 2 ? Math.max(2, Math.round(options.width - line.length * 6 - 2)) : 2;
      const dx = i ? x - previous : x; previous = x;
      return `${dx} ${i ? -13 : Math.round(y)} Td (${escape(line)}) Tj`;
    }).join(" ");
  }
  return Buffer.from(`/Tx BMC q BT ${options.colorOp ? `${options.colorOp} ` : ""}/F1 ${options.fontSize ?? 11} Tf ${ops} ET Q EMC\n`);
}

for (const text of ["", "one", "one\r\ntwo\n", "\r\n\n", "(é)\\😀\ud800", "A".repeat(16383) + "😀\r\nend", "x\n".repeat(9000)]) {
  for (const mode of ["left", "center", "right", "comb", "fractional-comb", "password", "password-comb"]) {
    it(`preserves ${mode} appearance bytes for ${text.length} code units`, () => {
      const options = { width: 120, height: 40, fontSize: 9, colorOp: "0.1 0.2 0.3 rg", alignment: mode === "center" ? 1 : mode === "right" ? 2 : 0,
        comb: mode.includes("comb"), maxLength: mode === "fractional-comb" ? 3.5 : 7, password: mode.startsWith("password") };
      const chunks = [...serializeFormAppearanceChunks(text, options)];
      expect(Buffer.concat(chunks)).toEqual(legacy(text, options));
      for (const chunk of chunks) expect(chunk.buffer.byteLength).toBeLessThanOrEqual(16384);
    });
  }
}

it("owns yielded bytes and responds to cancellation while suspended", () => {
  const controller = new AbortController();
  const chunks = serializeFormAppearanceChunks("é".repeat(50000), { width: 120, height: 20, signal: controller.signal });
  const first = chunks.next().value as Uint8Array, saved = first.slice();
  expect(chunks.next().done).toBe(false); expect(first).toEqual(saved);
  controller.abort(new Error("appearance cancelled"));
  expect(() => chunks.next()).toThrow("appearance cancelled");
});

it("checks cancellation after the final chunk and before any output", () => {
  const controller = new AbortController();
  const chunks = serializeFormAppearanceChunks("", { width: 120, height: 20, signal: controller.signal });
  expect(chunks.next().done).toBe(false); controller.abort(new Error("stop"));
  expect(() => chunks.next()).toThrow("stop");
  expect(() => serializeFormAppearanceChunks("", { width: 120, height: 20, signal: controller.signal }).next()).toThrow("stop");
});

it("does not split, replace or enumerate the complete input to produce output", () => {
  // A proxy makes whole-input convenience operations observable without a heap-size assertion.
  const text = new Proxy(new String("a\n".repeat(100000)), { get(target, key) {
    if (["split", "replaceAll", Symbol.iterator].includes(key)) throw new Error("whole input operation");
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }) as unknown as string;
  const output = serializeFormAppearanceChunks(text, { width: 120, height: 20 });
  expect((output.next().value as Uint8Array).length).toBeLessThanOrEqual(16384);
  output.return();
});
