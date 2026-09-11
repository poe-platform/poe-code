import { describe, expect, it } from "vitest";
import { PythonSource, PythonSyntaxError } from "./source.js";

describe("Python source cursor", () => {
  it("retains explicitly attributed diagnostic lines without file normalization",()=>{
    const error=new PythonSyntaxError("bad","x",{offset:0,line:1,column:0});
    expect(error.withSourceLine("\ufeffpass")).toBe(error);
    error.withSource("different");error.withSourceLine("replacement");
    expect(error.sourceLine).toBe("\ufeffpass");
  });
  it("charges an explicit diagnostic line before publishing it",()=>{
    const error=new PythonSyntaxError("bad","x",{offset:0,line:1,column:0});
    expect(()=>error.withSourceLine("line",{checkpoint(){throw Error("denied");}})).toThrow("denied");
    expect(error.sourceLine).toBeUndefined();
  });
  it("captures only the diagnostic source line with normalized physical newlines", () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const prefix = "first" + newline;
      const error = new PythonSyntaxError("bad", "input.py", { offset: prefix.length + 2, line: 2, column: 1 });
      expect(error.withSource(prefix + "𝒙 = nope" + newline + "last")).toBe(error);
      expect(error.sourceLine).toBe("𝒙 = nope\n");
      error.withSource("different");
      expect(error.sourceLine).toBe("𝒙 = nope\n");
    }
  });

  it("snapshots optional end positions independently from caller mutations", () => {
    const end = { offset: 6, line: 1, column: 5 };
    const error = new PythonSyntaxError("bad", "input.py", { offset: 2, line: 1, column: 1 }, end);
    end.column = 99;
    expect(error.endPosition).toEqual({ offset: 6, line: 1, column: 5 });
    expect(error.sourceLine).toBeUndefined();
  });

  it("normalizes physical newlines while preserving original source offsets", () => {
    const source = new PythonSource("a\r\nb\rc\nd", "example.py");
    const observations = [];
    while (!source.done) {
      observations.push([source.position, source.advance()]);
    }
    expect(observations).toEqual([
      [{ offset: 0, line: 1, column: 0 }, "a"],
      [{ offset: 1, line: 1, column: 1 }, "\n"],
      [{ offset: 3, line: 2, column: 0 }, "b"],
      [{ offset: 4, line: 2, column: 1 }, "\n"],
      [{ offset: 5, line: 3, column: 0 }, "c"],
      [{ offset: 6, line: 3, column: 1 }, "\n"],
      [{ offset: 7, line: 4, column: 0 }, "d"]
    ]);
    expect(source.position).toEqual({ offset: 8, line: 4, column: 1 });
  });

  it("counts Unicode code points in columns and UTF-16 units in offsets", () => {
    const source = new PythonSource("\uFEFF𝒙 = '🙂'");
    expect(source.position).toEqual({ offset: 1, line: 1, column: 0 });
    expect(source.peek()).toBe("𝒙");
    expect(source.advance()).toBe("𝒙");
    expect(source.position).toEqual({ offset: 3, line: 1, column: 1 });
    expect(source.peek()).toBe(" ");
  });

  it("provides normalized lookahead without changing the cursor", () => {
    const source = new PythonSource("a\r\n🙂\rb");
    expect([0, 1, 2, 3, 4, 5].map((distance) => source.peek(distance)))
      .toEqual(["a", "\n", "🙂", "\n", "b", ""]);
    expect(source.position).toEqual({ offset: 0, line: 1, column: 0 });
    expect(() => source.peek(-1)).toThrow(RangeError);
    expect(() => source.peek(0.5)).toThrow(RangeError);
    expect(() => source.peek(Infinity)).toThrow(RangeError);
  });

  it("keeps EOF stable", () => {
    const source = new PythonSource("");
    expect(source.done).toBe(true);
    expect(source.advance()).toBe("");
    expect(source.advance()).toBe("");
    expect(source.position).toEqual({ offset: 0, line: 1, column: 0 });
  });

  it("rejects NUL even in comments or string contents with a precise location", () => {
    expect(() => new PythonSource("# comment\r\n'🙂\0'", "nul.py"))
      .toThrow(expect.objectContaining({
        name: "SyntaxError",
        filename: "nul.py",
        position: { offset: 14, line: 2, column: 2 }
      }));
  });

  it("builds source diagnostics from a snapshot of the current position", () => {
    const source = new PythonSource("x\ny", "program.py");
    source.advance();
    const error = source.error("unexpected token");
    source.advance();
    expect(error).toBeInstanceOf(PythonSyntaxError);
    expect(error).toBeInstanceOf(SyntaxError);
    expect(error.message).toBe("unexpected token");
    expect(error.filename).toBe("program.py");
    expect(error.position).toEqual({ offset: 1, line: 1, column: 1 });
  });
});
