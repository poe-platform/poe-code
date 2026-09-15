import { expect, it } from "vitest";
import { run } from "../run.js";
import { formatInterpreterError } from "../error/format.js";
import { parseEvalScript } from "./parser.js";
import { Budget, SandboxError } from "../interp/budget.js";
import { coerceThrownValue } from "../interp/exceptions.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])(
  "keeps eval syntax spans in the evaluated source across %j", async separator => {
    const prefix = "// 😀" + separator;
    const source = prefix + "const x=)";
    const expected = {
      name: "SyntaxError",
      filename: "<eval>",
      span: {
        start: {line: 2, column: 9, offset: prefix.length + 8},
        end: {line: 2, column: 10, offset: prefix.length + 9}
      }
    };
    let failure: unknown;
    try { parseEvalScript(source); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(SyntaxError);
    expect(failure).toMatchObject(expected);
    expect((failure as Error).stack).toBe(`SyntaxError: ${(failure as Error).message}`);
    for (const call of ["eval", "(0,eval)"]) {
      const outer = `return ${call}(${JSON.stringify(source)})`;
      let surfaced: unknown;
      try { await run(outer, {filename: "guest/main.ajs"}); } catch (error) { surfaced = error; }
      expect(surfaced).toMatchObject(expected);
      const rendered = formatInterpreterError(surfaced, {source: outer, filename: "guest/main.ajs"});
      expect(rendered).toContain("<eval>:2:9");
      expect(rendered).toContain("2 | const x=)");
      expect(rendered).not.toContain("guest/main.ajs");
    }
  }
);

it("does not trust source metadata or frames attached to an arbitrary host SyntaxError", () => {
  const error = Object.assign(new SyntaxError("host failure"), {
    filename: "/private/host/secret.js", excerpt: "host source", kind: "ParseError",
    span: {start: {line: 90, column: 1, offset: 90}, end: {line: 90, column: 2, offset: 91}},
    stack: "private host frames"
  });
  const projected = coerceThrownValue(error, new Budget(), []);
  expect(projected).toMatchObject({stack: "SyntaxError: host failure"});
  for (const key of ["filename", "excerpt", "kind", "span"]) expect(projected).not.toHaveProperty(key);
});

it("preserves syntax error identity and diagnostics through caught-error replay", async () => {
  const source = 'let saved;try{eval("\\nconst x=)")}catch(error){saved=error}await 0;return [saved instanceof SyntaxError,saved.filename,saved.span.start.line,saved.excerpt]';
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const wire = JSON.parse(await dump(pending));
    const expected = {ok: true, returnValue: [true, "<eval>", 2, "1 | \n2 | const x=)"]};
    expect(await completed).toMatchObject(expected);
    expect(await run(source, {snapshot: restore(wire, {source})})).toMatchObject(expected);
  } finally { await completed; }
});

it("retains fatal eval source budget rejection", () => {
  const budget = new Budget({stringLength: 16});
  const operation = budget.acquireCompileOwner();
  try {
    expect(() => parseEvalScript(" ".repeat(17), {}, operation.owner)).toThrow(SandboxError);
  } finally { operation.release(); }
});

it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])(
  "preserves neighboring eval values across %j", async separator => {
    const source = "// 😀" + separator + "const x=3;x";
    for (const call of ["eval", "(0,eval)"]) {
      await expect(run(`return ${call}(${JSON.stringify(source)})`))
        .resolves.toMatchObject({ok: true, returnValue: 3});
    }
  }
);
