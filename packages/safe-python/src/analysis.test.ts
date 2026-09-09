import { describe, expect, it, vi } from "vitest";
import { analyzeModule, parseModule, PythonSyntaxError } from "./index.js";

describe("public module analysis", () => {
  it("returns the syntax tree and lexical owners without executing source", () => {
    const result = analyzeModule("def outer(x):\n def inner(): return x + missing\n return inner\nraise RuntimeError('not executed')");
    expect(result.module.kind).toBe("module");
    expect(result.scopes.scope.node).toBe(result.module);
    const outer = result.scopes.children[0], inner = outer.children[0];
    expect(outer.scope.node).toBe(result.module.body[0]);
    expect(inner.bindings.get("x")).toEqual({ kind: "free", owner: outer.scope });
    expect(inner.bindings.get("missing")).toEqual({ kind: "global", owner: result.scopes.scope });
    expect(outer.cells.has("x")).toBe(true);
    expect([...result.futureFeatures]).toEqual([]);
  });

  it("reports declared future features and applies their parser behavior", () => {
    const result = analyzeModule('"doc"\nfrom __future__ import annotations, barry_as_FLUFL as compatibility\nx = 1 <> 2');
    expect([...result.futureFeatures]).toEqual(["annotations", "barry_as_FLUFL"]);
    expect(result.module.body[2]).toMatchObject({ kind: "assignment", value: { kind: "comparison" } });
    expect(() => analyzeModule("from __future__ import barry_as_FLUFL\nx = 1 != 2")).toThrow(PythonSyntaxError);
  });

  it.each([
    ["x =", "syntax"],
    ["from __future__ import unknown", "future"],
    ["pass\nfrom __future__ import annotations", "placement"],
    ["return 1", "control flow"],
    ["await task", "expression context"],
    ["def f():\n x=1\n global x", "declaration"],
    ["def f(): nonlocal missing", "resolution"]
  ])("rejects %s during %s validation with source attribution", source => {
    let error: unknown;
    try { analyzeModule(source, { filename: "example.py" }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(PythonSyntaxError);
    expect(error).toMatchObject({ filename: "example.py", position: { line: expect.any(Number), column: expect.any(Number) } });
  });

  it("keeps syntax-only parsing available", () => {
    expect(parseModule("return 1").body[0].kind).toBe("return");
    expect(() => analyzeModule("return 1")).toThrow(PythonSyntaxError);
  });

  it("does not resolve or execute discarded type syntax", () => {
    const result = analyzeModule("type Alias[T: missing_bound()] = missing_value()\ndef f[T](x: missing_annotation()) -> missing_return():\n local: missing_local()\n return x");
    expect([...result.scopes.bindings.keys()]).toEqual(["f"]);
    expect([...result.scopes.children[0].bindings.keys()]).toEqual(["x", "local"]);
  });

  it("forwards lexer callbacks once despite speculative parsing", () => {
    const onComment = vi.fn(), onWarning = vi.fn();
    const source = "match = '\\q' # comment\n";
    parseModule(source, { onComment, onWarning });
    const comments = onComment.mock.calls.slice(), warnings = onWarning.mock.calls.slice();
    expect(comments).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    onComment.mockClear();
    onWarning.mockClear();
    analyzeModule(source, { onComment, onWarning });
    expect(onComment.mock.calls).toEqual(comments);
    expect(onWarning.mock.calls).toEqual(warnings);
  });

  it("does not leak future state between analyses", () => {
    analyzeModule("from __future__ import barry_as_FLUFL\nx = 1 <> 2");
    expect(() => analyzeModule("x = 1 <> 2")).toThrow(PythonSyntaxError);
    expect(analyzeModule("x = 1 != 2").futureFeatures.size).toBe(0);
  });
});
