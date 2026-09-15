import { expect, it } from "vitest";
import { scanPercentFormat } from "./percent-format-scan.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  return { meter, v, scan: (text: string) => scanPercentFormat(v.string(text).value, meter) };
}
it("scans literals and directives using Python code-point offsets", () => {
  const { scan } = fixture();
  expect([...scan("😀 %05.2ls!")]).toEqual([
    { kind: "literal", start: 0, end: 2 }, { kind: "begin", offset: 2 },
    { kind: "flags", alternate: false, zero: true, left: false, space: false, sign: false },
    { kind: "width", value: 5n }, { kind: "precision", value: 2n },
    { kind: "conversion", code: 115, offset: 8 }, { kind: "literal", start: 9, end: 10 }
  ]);
});
it("emits escaped percent as a literal without beginning a conversion", () => {
  const { scan } = fixture();
  expect([...scan("%%x%%")]).toEqual([{ kind: "literal", start: 0, end: 1 }, { kind: "literal", start: 2, end: 3 }, { kind: "literal", start: 3, end: 4 }]);
});
it("signals mapping eligibility before scanning balanced mapping keys", () => {
  const { scan } = fixture(), events = [...scan("%((a)b)#- +00s")];
  expect(events.slice(0, 3)).toEqual([{ kind: "begin", offset: 0 }, { kind: "mapping-start", offset: 1 }, { kind: "mapping-key", start: 2, end: 6 }]);
  expect(events[3]).toEqual({ kind: "flags", alternate: true, zero: true, left: true, space: true, sign: true });
  const incomplete = scan("%("); expect(incomplete.next().value.kind).toBe("begin"); expect(incomplete.next().value.kind).toBe("mapping-start");
  expect(() => incomplete.next()).toThrow("incomplete format key");
});
it("yields dynamic operands before reporting later incomplete format errors", () => {
  const { scan } = fixture();
  for (const [text, kind] of [["%*", "width"], ["%.*", "precision"]] as const) {
    const cursor = scan(text); cursor.next(); cursor.next();
    expect(cursor.next().value).toEqual({ kind, value: "*" });
    expect(() => cursor.next()).toThrow("incomplete format");
  }
});
it("keeps raw conversion codes so argument validation can precede unsupported-code errors", () => {
  const { scan } = fixture();
  expect([...scan("%lls")].at(-2)).toEqual({ kind: "conversion", code: 108, offset: 2 });
  expect([...scan("%5%")].at(-1)).toEqual({ kind: "conversion", code: 37, offset: 2 });
  expect([...scan("%.s")].find(event => event.kind === "precision")).toEqual({ kind: "precision", value: 0n });
});
it("enforces signed-size width and C-int precision limits during scanning", () => {
  const { scan } = fixture();
  expect([...scan("%9223372036854775807s")].find(event => event.kind === "width")).toEqual({ kind: "width", value: 9223372036854775807n });
  expect([...scan("%.2147483647s")].find(event => event.kind === "precision")).toEqual({ kind: "precision", value: 2147483647n });
  expect(() => [...scan("%9223372036854775808s")]).toThrow("width too big");
  expect(() => [...scan("%.2147483648s")]).toThrow("precision too big");
  expect(() => [...scan("%")]).toThrow("incomplete format");
});
it("shares directive scanning with immutable bytes without decoding literal data", () => {
  const { v, meter } = fixture(), bytes = v.bytes(Uint8Array.of(255, 37, 115, 0));
  const events = [...scanPercentFormat(bytes.value, meter)];
  expect(events[0]).toEqual({ kind: "literal", start: 0, end: 1 });
  expect(events.at(-2)).toEqual({ kind: "conversion", code: 115, offset: 2 });
  expect(events.at(-1)).toEqual({ kind: "literal", start: 3, end: 4 });
});
it("stops metered scanning without materializing a full token list", () => {
  const { v } = fixture(), source = v.string("x".repeat(100)).value;
  const cursor = scanPercentFormat(source, new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 10000 }));
  expect(() => cursor.next()).toThrow(ExecutionLimitError);
});
