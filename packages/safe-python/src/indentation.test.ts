import { describe, expect, it } from "vitest";
import { PythonSource } from "./source.js";
import { Indentation } from "./indentation.js";

describe("Python indentation", () => {
  it("emits one indent per new level and all dedents when leaving nested suites", () => {
    const indentation = new Indentation();
    const source = new PythonSource("x");
    expect(indentation.accept("", source)).toEqual([]);
    expect(indentation.accept("    ", source)).toEqual(["INDENT"]);
    expect(indentation.accept("       ", source)).toEqual(["INDENT"]);
    expect(indentation.accept("       ", source)).toEqual([]);
    expect(indentation.accept("", source)).toEqual(["DEDENT", "DEDENT"]);
    expect(indentation.finish()).toEqual([]);
  });

  it("flushes remaining suites at EOF exactly once", () => {
    const indentation = new Indentation();
    const source = new PythonSource("");
    indentation.accept("  ", source);
    indentation.accept("    ", source);
    expect(indentation.finish()).toEqual(["DEDENT", "DEDENT"]);
    expect(indentation.finish()).toEqual([]);
  });

  it("rejects dedents to a level that never existed without corrupting the stack", () => {
    const indentation = new Indentation();
    const source = new PythonSource("  x", "indent.py");
    indentation.accept("    ", source);
    expect(() => indentation.accept("  ", source)).toThrow(expect.objectContaining({
      name: "IndentationError", filename: "indent.py",
      position: { offset: 0, line: 1, column: 0 }
    }));
    expect(indentation.finish()).toEqual(["DEDENT"]);
  });

  it("expands tabs at eight-column stops", () => {
    const indentation = new Indentation();
    const source = new PythonSource("");
    expect(indentation.accept(" \t", source)).toEqual(["INDENT"]);
    expect(indentation.accept(" \t ", source)).toEqual(["INDENT"]);
    expect(indentation.accept(" \t", source)).toEqual(["DEDENT"]);
  });

  it.each([
    ["\t", "        "],
    ["        ", "\t "],
    [" \t", "\t"],
    ["  ", "\t"]
  ])("rejects ambiguous tabs/spaces from %j to %j", (first, second) => {
    const indentation = new Indentation();
    const source = new PythonSource("");
    indentation.accept(first, source);
    expect(() => indentation.accept(second, source)).toThrow(expect.objectContaining({
      name: "TabError"
    }));
    expect(indentation.finish()).toEqual(["DEDENT"]);
  });

  it("checks tab ambiguity on dedent as well", () => {
    const indentation = new Indentation();
    const source = new PythonSource("");
    indentation.accept("\t", source);
    indentation.accept("\t    ", source);
    expect(() => indentation.accept("        ", source)).toThrow(expect.objectContaining({
      name: "TabError"
    }));
    expect(indentation.finish()).toEqual(["DEDENT", "DEDENT"]);
  });

  it("resets both indentation measures on form feed", () => {
    const indentation = new Indentation();
    const source = new PythonSource("");
    expect(indentation.accept(" \t\f  ", source)).toEqual(["INDENT"]);
    expect(indentation.accept("  ", source)).toEqual([]);
    expect(indentation.accept("\f", source)).toEqual(["DEDENT"]);
  });
});
