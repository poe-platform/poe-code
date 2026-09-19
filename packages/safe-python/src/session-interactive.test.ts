import { describe, expect, it } from "vitest";
import { PythonSession } from "./index.js";
function fixture() {
  const output: string[] = [];
  const s = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n], output: { write: text => output.push(text), flush() {} } });
  return { s, output };
}
function scalar(s: PythonSession, source: string) {
  const result = s.eval(source);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw Error("evaluation failed");
  return result.value.primitive;
}
describe("parser-backed interactive sessions", () => {
  it("collects suites without executing until terminal newline", () => {
    const { s, output } = fixture();
    expect(s.interactive("if True:")).toEqual({ status: "incomplete" });
    expect(s.interactive("if True:\n value=41")).toEqual({ status: "incomplete" });
    expect(s.globals.get("value")).toBeUndefined();
    expect(s.interactive("if True:\n value=41\n value+1\n")).toEqual({ status: "ok" });
    expect(output.join("")).toBe("42\n");
    expect(scalar(s, "value")).toBe(41n);
  });
  it("collects brackets, triple strings and explicit line continuations", () => {
    const { s, output } = fixture();
    for (const source of ["(", "[1,", "text='''start", "f'''start", "f'''{1", "1 + \\", "1 + \\\n", "try:\n pass\n"]) {
      expect(s.interactive(source), source).toEqual({ status: "incomplete" });
    }
    expect(s.interactive("(1+\n2)")).toEqual({ status: "ok" });
    expect(s.interactive("'''start\nend'''")).toEqual({ status: "ok" });
    expect(output.join("")).toBe("3\n'start\\nend'\n");
  });
  it("prints every semicolon expression, suppresses None and retains builtin underscore", () => {
    const { s, output } = fixture();
    expect(s.interactive("1; None; 'text'")).toEqual({ status: "ok" });
    expect(output.join("")).toBe("1\n'text'\n");
    expect(scalar(s, "_")).toBe("text");
    expect(s.interactive("x=1; x+1")).toEqual({ status: "ok" });
    expect(output.join("")).toBe("1\n'text'\n2\n");
    expect(s.interactive("repr=lambda x:'overridden'; 'literal'")).toEqual({ status: "ok" });
    expect(output.join("")).toBe("1\n'text'\n2\n'literal'\n");
  });
  it("distinguishes invalid syntax and multiple single-input statements from incomplete input", () => {
    const { s, output } = fixture();
    for (const source of ["if True", "x =", "'unterminated", "(1 2)", "x=1\ny=2"]) {
      expect(s.interactive(source), source).toMatchObject({ status: "diagnostic" });
    }
    expect(output).toEqual([]);
    expect(s.interactive("42")).toEqual({ status: "ok" });
    expect(s.interactive("1/0")).toMatchObject({ status: "exception" });
    expect(s.interactive("# blank")).toEqual({ status: "ok" });
  });
  it("does not display expressions from called function bodies or ordinary exec", () => {
    const { s, output } = fixture();
    expect(s.interactive("def f():\n 42\n return 7\n")).toEqual({ status: "ok" });
    expect(s.interactive("f()")).toEqual({ status: "ok" });
    expect(s.exec("9")).toEqual({ status: "ok" });
    expect(output.join("")).toBe("7\n");
  });
});

it("collects nested suites at synthetic EOF dedents", () => {
  const { s } = fixture();
  expect(s.interactive("class E(Exception):\n def __str__(self):")).toEqual({ status: "incomplete" });
  expect(s.interactive("class E(Exception):\n def __str__(self):\nvalue=1")).toMatchObject({ status: "diagnostic" });
  expect(s.interactive("class E(Exception):\n def __str__(self):\n  return 'message'")).toEqual({ status: "incomplete" });
  expect(s.interactive("class E(Exception):\n def __str__(self):\n  return 'message'\n")).toEqual({ status: "ok" });
  expect(scalar(s, "str(E())")).toBe("message");
});
