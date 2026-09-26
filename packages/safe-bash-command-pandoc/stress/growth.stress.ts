import { expect, it } from "vitest";
import { createExecutionContext, createFormatRegistry, PandocError, convert } from "../src/index.js";
import type { Limits } from "../src/index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const sizes = [256, 512, 1024, 2048] as const;
const cases: readonly [string, string, (size: number) => string][] = [
  ["delimiter", "commonmark", n => "*".repeat(n) + "original" + "*".repeat(n)],
  ["bracket", "commonmark", n => "[".repeat(n) + "original" + "]".repeat(n)],
  ["dangling", "commonmark", n => "[original][missing]\n\n".repeat(n / 16)],
  ["attributes", "html", n => '<p title="' + "a".repeat(n) + '">original</p>'],
  ["entities", "html", n => '<p>' + "&amp;".repeat(n) + '</p>'],
  ["rst-search", "rst", n => "[".repeat(n) + "original"],
  ["latex-expansion", "latex", n => '\\newcommand{\\a}{' + "a".repeat(n) + '}\\a'],
  ["rtf-run", "rtf", n => '{\\rtf1 ' + "a".repeat(n) + '}'],
  ["json-string", "json", n => JSON.stringify({ "pandoc-api-version": [1,23,1,2], meta: {},
    blocks: [{ t: "Para", c: [{ t: "Str", c: "a".repeat(n) }] }] })]
];

// Explicit measurement lane, outside the ordinary unit inventory. These are
// allocation/work reservations, not heap/RSS or elapsed-time guarantees.
it.each(cases)("measures capped original %s growth", async (name, from, generate) => {
  const measurements: { size: number; work: number; retained: number; cpuMicros: number; outcome: string }[] = [];
  for (const size of sizes) {
    const text = generate(size), bytes = encode(text);
    // Search-heavy inputs can be quadratic; a linear work envelope must reject
    // them instead of silently reporting successful unlimited fallback work.
    const limits: Partial<Limits> = { work: 64 * bytes.length + 4096,
      retainedBytes: 256 * bytes.length + 65536 };
    const context = createExecutionContext("read", { limits, yield: async () => {} });
    const usage = { work: 0, retainedBytes: 0 };
    const charge = context.charge.bind(context);
    context.charge = (key, amount) => {
      charge(key, amount);
      if (key === "work" || key === "retainedBytes") usage[key] += amount;
    };
    const selection = createFormatRegistry().resolve(from, "read");
    const start = process.cpuUsage();
    let outcome = "ok";
    try { await selection.reader!.read({ bytes, text }, context, selection); }
    catch (error) {
      if (!(error instanceof PandocError) || error.code !== "E_LIMIT") throw error;
      outcome = "E_LIMIT";
    } finally { await context.close(); }
    const cpu = process.cpuUsage(start);
    expect(usage.work).toBeLessThanOrEqual(limits.work!);
    expect(usage.retainedBytes).toBeLessThanOrEqual(limits.retainedBytes!);
    measurements.push({ size, work: usage.work, retained: usage.retainedBytes,
      cpuMicros: cpu.user + cpu.system, outcome });
    // Exercise the SDK with the same admitted public budgets. Rejection is an
    // accepted bounded outcome; a different parser error is not.
    try {
      await convert([{ bytes }], { from, to: "plain" }, { limits, yield: async () => {} });
    } catch (error) {
      if (!(error instanceof PandocError) || error.code !== "E_LIMIT") throw error;
    }
  }
  for (let i = 1; i < measurements.length; i++) {
    // Fourfold slack for doubling includes fixed overhead and rejected prefixes.
    expect(measurements[i]!.work).toBeLessThanOrEqual(4 * measurements[i - 1]!.work + 4096);
    expect(measurements[i]!.retained).toBeLessThanOrEqual(4 * measurements[i - 1]!.retained + 65536);
  }
  console.info(JSON.stringify({ name, from, measurements }));
});
