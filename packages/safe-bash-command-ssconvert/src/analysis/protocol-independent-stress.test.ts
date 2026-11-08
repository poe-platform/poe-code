import { describe, expect, it } from "vitest";
import { prepareToolTest, toolBoolean, toolDouble, toolInteger } from "./protocol.js";
import type { CapabilityContext, Diagnostic } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const book: Workbook = { sheets: [{ id: "s", name: "Input", cells: [] }] };
function context(diagnostics: Diagnostic[] = [], controller = new AbortController()): CapabilityContext {
  return { signal: controller.signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
    own() {}, async diagnostic(diagnostic) { diagnostics.push(diagnostic); } };
}

describe("independent analysis protocol stress", () => {
  it("distinguishes GenericB missing #REF inputs from explicitly malformed null inputs", async () => {
    const missing = await prepareToolTest(book, ["f-test"], context());
    expect(missing.toolOptions?.x).toEqual({ kind: "error", value: "#REF!" });
    expect(missing.toolOptions?.y).toEqual({ kind: "error", value: "#REF!" });
    expect(Object.isFrozen(missing.toolOptions?.x)).toBe(true);
    for (const text of ["", "bogus"]) {
      const malformed = await prepareToolTest(book, ["f-test", `x:${text}`], context());
      expect(malformed.toolOptions?.x).toBeNull();
      expect(malformed.toolOptions?.y).toEqual({ kind: "error", value: "#REF!" });
    }
    const valid = await prepareToolTest(book, ["f-test", "x:A1:A2", "y:B1:B2"], context());
    expect(valid.toolOptions?.x).toEqual({ sheet: "s", startRow: 0, startColumn: 0, endRow: 1, endColumn: 0 });
    expect(valid.toolOptions?.y).toEqual({ sheet: "s", startRow: 0, startColumn: 1, endRow: 1, endColumn: 1 });
  });
  it("rejects measured native nonfinite double properties and preserves their defaults", async () => {
    for (const [text, rendering] of [["nan", "nan"], ["NaN(payload)", "nan"], ["-nan", "-nan"],
      ["-NaN(payload)", "-nan"], ["inf", "inf"], ["-infinity", "-inf"]]) {
      const diagnostics: Diagnostic[] = [];
      const result = await prepareToolTest(book, ["anova", `alpha:${text}`], context(diagnostics));
      expect(result.toolOptions?.properties.alpha).toBe(0.05);
      expect(diagnostics.map(item => item.message)).toEqual([
        `value "${rendering}" of type 'gdouble' is invalid or out of range for property 'alpha' of type 'gdouble'`
      ]);
    }
  });
  it("matches measured native fixed-six decimal double diagnostics", async () => {
    for (const [text, rendering] of [["2", "2.000000"], ["-.1", "-0.100000"], ["-.0078125", "-0.007812"],
      ["1e100", "10000000000000000159028911097599180468360808563945281389781327557747838772170381060813469985856815104.000000"]]) {
      const diagnostics: Diagnostic[] = [];
      await prepareToolTest(book, ["anova", `alpha:${text}`], context(diagnostics));
      expect(diagnostics[0]?.message).toBe(`value "${rendering}" of type 'gdouble' is invalid or out of range for property 'alpha' of type 'gdouble'`);
    }
  });
  it("matches captured GObject int and enum range diagnostic bodies", async () => {
    const diagnostics: Diagnostic[] = [];
    const result = await prepareToolTest(book, ["moving-average", "interval:-1", "group-by:4junk"], context(diagnostics));
    expect(result.toolOptions?.properties.interval).toBe(1);
    expect(result.toolOptions?.properties["group-by"]).toBe(1);
    expect(diagnostics.map(item => item.message)).toEqual([
      'value "((gnm_tool_group_by_t) 4)" of type \'gnm_tool_group_by_t\' is invalid or out of range for property \'group-by\' of type \'gnm_tool_group_by_t\'',
      'value "-1" of type \'gint\' is invalid or out of range for property \'interval\' of type \'gint\''
    ]);
  });

  it("models fill-series implicit setter flags and later canonical flag overrides", async () => {
    const implicit = await prepareToolTest(book, ["fill-series", "step-value:2", "stop-value:9"], context());
    expect(implicit.toolOptions?.properties["is-step-set"]).toBe(true);
    expect(implicit.toolOptions?.properties["is-stop-set"]).toBe(true);
    const explicit = await prepareToolTest(book, ["fill-series", "is-step-set:no", "is-stop-set:no",
      "step-value:2", "stop-value:9"], context());
    expect(explicit.toolOptions?.properties["is-step-set"]).toBe(false);
    expect(explicit.toolOptions?.properties["is-stop-set"]).toBe(false);
  });

  it("retains flags when GObject rejects setter values", async () => {
    const result = await prepareToolTest(book, ["fill-series", "step-value:inf", "stop-value:-inf"], context());
    expect(result.toolOptions?.properties["step-value"]).toBe(1);
    expect(result.toolOptions?.properties["is-step-set"]).toBe(false);
    expect(result.toolOptions?.properties["is-stop-set"]).toBe(false);
  });

  it("uses captured LP64 atoi prefix, saturation and signed-int narrowing", () => {
    for (const [input, result] of [["", 0], [" +12.5tail", 12], ["-0x12", 0], ["1e4", 1],
      ["2147483648", -2147483648], ["4294967295", -1], ["4294967296", 0],
      ["9223372036854775808", -1], ["-9223372036854775809", 0]] as const) {
      expect(toolInteger(input), input).toBe(result);
    }
  });

  it("accepts exactly native lowercase truth tokens and C atof prefixes", () => {
    for (const input of ["yes", "y", "true", "1"]) expect(toolBoolean(input), input).toBe(true);
    for (const input of ["YES", "True", " yes", "1tail", "", "on"]) expect(toolBoolean(input), input).toBe(false);
    for (const [input, result] of [["  +.5tail", 0.5], ["-0x1.8p+2suffix", -6],
      ["1e+bad", 1], ["invalid", 0], ["-INFtail", -Infinity]] as const) expect(toolDouble(input), input).toBe(result);
    expect(Number.isNaN(toolDouble("NaN(payload)"))).toBe(true);
    expect(Object.is(toolDouble("-0"), -0)).toBe(true);
    for (const text of ["-0xg", "-0x", "-0x.p2"]) expect(Object.is(toolDouble(text), -0), text).toBe(true);
    expect(Object.is(toolDouble("-."), 0)).toBe(true);
  });

  it("sets unsigned values from signed atoi and ignores noncanonical names", async () => {
    const result = await prepareToolTest(book, ["sampling", "size:-1", "row_major:yes", "row-major:TRUE"], context());
    expect(result.toolOptions?.properties.size).toBe(4294967295);
    expect(result.toolOptions?.properties["row-major"]).toBe(false);
  });

  it("rejects signed and whitespace enum numerals before analysis", async () => {
    for (const value of ["+1", "-1", " 1", "COL", ""]) {
      const diagnostics: Diagnostic[] = [];
      await expect(prepareToolTest(book, ["moving-average", `group-by:${value}`], context(diagnostics)))
        .rejects.toThrow("Analysis tool failed");
      expect(diagnostics.map(item => item.message)).toEqual([`Cannot parse "${value}" as value for "group-by"`]);
    }
  });

  it("preserves warning order, duplicate replacement and colon-containing strings", async () => {
    const diagnostics: Diagnostic[] = [];
    const result = await prepareToolTest(book, ["auto-expression", "bad", "bad2", "function:OLD",
      "function:SUM:tail", "unknown:ignored"], context(diagnostics));
    expect(result.toolOptions?.properties.function).toBe("SUM:tail");
    expect(diagnostics.map(item => item.message)).toEqual(['Ignoring tool test argument "bad"', 'Ignoring tool test argument "bad2"']);
  });

  it("selects sheets case insensitively and avoids output-name collisions", async () => {
    const source: Workbook = { activeSheet: "s", sheets: [...book.sheets,
      { id: "other", name: "Other", cells: [] }, { id: "prior", name: "moving average (1)", cells: [] }] };
    const result = await prepareToolTest(source, ["moving-average", "sheet:oTHER", "data:A1:A2"], context());
    expect(result.toolOptions?.sheet).toBe("other");
    expect(result.toolOptions?.data?.sheet).toBe("other");
    expect(result.toolOptions?.outputSheetName).toBe("Moving Average (2)");
    expect(source.sheets).toHaveLength(3);
  });

  it("matches measured native malformed, whitespace and reversed-range handling", async () => {
    for (const text of ["", "bogus", "=A1:A4", " A1:A4 "]) {
      const diagnostics: Diagnostic[] = [];
      const result = await prepareToolTest(book, ["moving-average", `data:${text}`], context(diagnostics));
      expect(result.toolOptions?.data, text).toBeUndefined();
      expect(diagnostics, text).toEqual([]);
    }
    const result = await prepareToolTest(book, ["moving-average", "data:A4:A1"], context());
    expect(result.toolOptions?.data).toEqual({ sheet: "s", startRow: 0, startColumn: 0, endRow: 3, endColumn: 0 });
  });

  it("uses exact source-defined output names including dynamic names", async () => {
    for (const [tool, options, name] of [
      ["auto-expression", [], "Auto Expression"], ["one-mean-test", [], "Student-t Test"],
      ["advanced-filter", [], "Advanced Filter"], ["kaplan-meier", [], "Kaplan-Meier Estimates"],
      ["anova2", ["replication:2"], "Two Factor ANOVA with Replication"],
      ["chi-squared-test", [], "Test of Homogeneity"],
      ["chi-squared-test", ["independence:y"], "Test of Independence"]] as const) {
      const result = await prepareToolTest(book, [tool, ...options], context());
      expect(result.toolOptions?.outputSheetName).toBe(`${name} (1)`);
    }
  });

  it("propagates exact cancellation reason during properties", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(prepareToolTest(book, ["moving-average"], context([], controller))).rejects.toBe(reason);
  });

  it("preserves cancellation precedence after an awaited malformed diagnostic before unknown-tool dispatch", async () => {
    const controller = new AbortController(), reason = new Error("abort diagnostic");
    const ctx = { ...context([], controller), async diagnostic() { controller.abort(reason); } };
    await expect(prepareToolTest(book, ["unknown", "bad"], ctx)).rejects.toBe(reason);
  });
});
