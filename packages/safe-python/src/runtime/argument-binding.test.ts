import { describe, expect, it } from "vitest";
import { bindArguments, type CallParameter } from "./argument-binding.js";
import { ExecutionBudget } from "./execution-budget.js";

const parameters: readonly CallParameter[] = [
  { name: "a", kind: "positional-only" },
  { name: "b", kind: "positional-or-keyword" },
  { name: "args", kind: "var-positional" },
  { name: "c", kind: "keyword-only" },
  { name: "kw", kind: "var-keyword" }
];

describe("Python function argument binding", () => {
  it("binds all parameter kinds and keeps positional-only names in kwargs", () => {
    const result = bindArguments("f", parameters, [1, 2, 3, 4], new Map([["a", 10], ["c", 5], ["args", 6]]));
    expect(result.values).toEqual(new Map([["a", 1], ["b", 2], ["c", 5]]));
    expect(result.varPositional).toEqual([3, 4]);
    expect(result.varKeywords).toEqual(new Map([["a", 10], ["args", 6]]));
  });

  it("uses evaluated defaults by identity and distinguishes undefined from missing", () => {
    const value = {}, defaults = new Map<string, unknown>([["b", undefined], ["c", value]]);
    const result = bindArguments("f", parameters, [null], new Map(), defaults);
    expect(result.values.has("b")).toBe(true);
    expect(result.values.get("b")).toBeUndefined();
    expect(result.values.get("c")).toBe(value);
    expect(result.varPositional).toEqual([]);
    expect(result.varKeywords.size).toBe(0);
    defaults.set("c", "changed");
    expect(bindArguments("f", parameters, [null], new Map(), defaults).values.get("c")).toBe("changed");
  });

  it("rejects a duplicate positional/keyword binding before missing arguments", () => {
    expect(() => bindArguments("f", parameters, [1, 2], new Map([["b", 3]]))).toThrow("f() got multiple values for argument 'b'");
  });

  it("reports positional-only keywords in declaration order without kwargs", () => {
    const signature: CallParameter[] = [{ name: "a", kind: "positional-only" }, { name: "b", kind: "positional-only" }];
    expect(() => bindArguments("f", signature, [], new Map([["b", 2], ["a", 1]]))).toThrow("f() got some positional-only arguments passed as keyword arguments: 'a, b'");
  });

  it("rejects unexpected names literally without normalizing mapping keys", () => {
    const signature: CallParameter[] = [{ name: "K", kind: "positional-or-keyword" }];
    expect(() => bindArguments("f", signature, [], new Map([["K", 1]]))).toThrow("f() got an unexpected keyword argument 'K'");
  });

  it("suggests similar eligible keyword parameters", () => {
    const signature: CallParameter[] = [{ name: "k0", kind: "keyword-only" }];
    expect(() => bindArguments("f", signature, [], new Map([["kw", 1]]))).toThrow("f() got an unexpected keyword argument 'kw'. Did you mean 'k0'?");
    const positionalOnly: CallParameter[] = [{ name: "keyword", kind: "positional-only" }];
    expect(() => bindArguments("f", positionalOnly, [1], new Map([["keywrod", 2]]))).toThrow(/^f\(\) got an unexpected keyword argument 'keywrod'$/);
  });

  it("formats missing positional and keyword-only argument lists", () => {
    const signature: CallParameter[] = ["a", "b", "c"].map(name => ({ name, kind: "positional-or-keyword" }));
    expect(() => bindArguments("f", signature, [], new Map())).toThrow("f() missing 3 required positional arguments: 'a', 'b', and 'c'");
    expect(() => bindArguments("f", signature, [1], new Map())).toThrow("f() missing 2 required positional arguments: 'b' and 'c'");
    expect(() => bindArguments("f", parameters, [1, 2], new Map())).toThrow("f() missing 1 required keyword-only argument: 'c'");
  });

  it("reports excess positional arguments after keyword validation", () => {
    const signature: CallParameter[] = [{ name: "a", kind: "positional-or-keyword" }, { name: "b", kind: "keyword-only" }];
    expect(() => bindArguments("f", signature, [1, 2], new Map([["b", 3]]))).toThrow("f() takes 1 positional argument but 2 positional arguments (and 1 keyword-only argument) were given");
    expect(() => bindArguments("f", signature, [1, 2], new Map([["x", 3]]))).toThrow("f() got an unexpected keyword argument 'x'");
    expect(() => bindArguments("f", signature, [1, 2], new Map(), new Map([["a", 0]]))).toThrow("f() takes from 0 to 1 positional arguments but 2 were given");
  });

  it("leaves caller collections unchanged and aborts on exhausted budgets", () => {
    const args = Object.freeze([1, 2]), kw = new Map([["c", 3]]);
    const result = bindArguments("f", parameters, args, kw);
    expect(result.values.get("c")).toBe(3);
    expect(kw).toEqual(new Map([["c", 3]]));
    expect(() => bindArguments("f", parameters, args, kw, new Map(), new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
  });
});
