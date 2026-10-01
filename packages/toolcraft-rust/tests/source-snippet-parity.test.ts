import { afterEach, describe, expect, it } from "vitest";
import * as native from "../dist/source-snippet.js";
import * as reference from "../../toolcraft/src/source-snippet.js";
import * as nativeDesign from "toolcraft-design-rust";
import * as referenceDesign from "toolcraft-design";

const originalTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
const forceColor = process.env.FORCE_COLOR;
const noColor = process.env.NO_COLOR;

afterEach(() => {
  if (originalTTY) Object.defineProperty(process.stderr, "isTTY", originalTTY);
  else Reflect.deleteProperty(process.stderr, "isTTY");
  if (forceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = forceColor;
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  nativeDesign.resetOutputFormatCache();
  referenceDesign.resetOutputFormatCache();
});

function capture(render: typeof reference.renderSourceSnippet, options: reference.SourceSnippetOptions) {
  try { return { output: render(options) }; }
  catch (error) { return { error: [(error as Error).name, (error as Error).message] }; }
}

describe("native source snippets", () => {
  it("preserves line endings, UTF-16 and numeric edge cases", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
    for (const source of ["", "a\r\nb\rc\n\ud800", "\t😀\u0000\nlast\n"]) {
      for (const line of [-5, -0, 1.9, 4, 100, NaN, Infinity, -Infinity]) {
        for (const context of [undefined, -1, 0, 1.8, NaN, Infinity]) {
          for (const column of [undefined, -1, 0, 2.9, NaN, Infinity]) {
            const options = { source, line, context, column, filePath: "a\ud800.ts" };
            expect(capture(native.renderSourceSnippet, options)).toEqual(capture(reference.renderSourceSnippet, options));
          }
        }
      }
    }
  });

  it("preserves property-read and styling order, including changing column getters", () => {
    const render = (lib: typeof reference | typeof native) => {
      const reads: string[] = [];
      let column = 0;
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, get() { reads.push("tty"); return false; } });
      const options = new Proxy({
        source: "a\nb\nc", line: 2, context: 1, filePath: "source.ts",
        get column() { return [3.5, 5, 4.6, undefined][column++]; }
      }, { get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); } });
      return { output: lib.renderSourceSnippet(options), reads };
    };
    expect(render(native)).toEqual(render(reference));
  });

  it("uses matching terminal, Markdown and JSON styling", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    nativeDesign.resetOutputFormatCache();
    referenceDesign.resetOutputFormatCache();
    const options = { source: "first\nsecond", line: 2, column: 3, filePath: "source.ts" };
    for (const tty of [false, true]) {
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: tty });
      for (const format of ["terminal", "markdown", "json"] as const) {
        expect(nativeDesign.withOutputFormat(format, () => native.renderSourceSnippet(options)))
          .toBe(referenceDesign.withOutputFormat(format, () => reference.renderSourceSnippet(options)));
      }
    }
  });

  it("preserves arbitrary exceptions from each option getter", () => {
    for (const property of ["source", "line", "context", "filePath", "column"]) {
      for (const thrown of [undefined, null, false, 0, Symbol("failure"), { toString() { throw new Error("must not stringify"); } }]) {
        for (const lib of [native, reference]) {
          const options = { source: "one", line: 1, filePath: "source.ts", column: 1 };
          Object.defineProperty(options, property, { get() { throw thrown; } });
          let caught = false;
          try { lib.renderSourceSnippet(options); }
          catch (error) { caught = true; expect(error).toBe(thrown); }
          expect(caught).toBe(true);
        }
      }
    }
  });
});
