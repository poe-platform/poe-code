import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseEvalScript } from "./parser.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["a?.b`x`", "a?.b.c`x`", "a?.b()`x`", "a?.[0]`x`", "a?.()`x`"])(
  "rejects a tagged template continuing an optional chain: %s", expression => {
    for (const prefix of ["", "'use strict';"]) {
      const source = prefix + "var a=null;" + expression;
      expect(() => new Script(source)).toThrow(SyntaxError);
      expect(() => parseEvalScript(source)).toThrow();
      expect(() => lint(source)).toThrow("Tagged templates are not allowed in optional chains");
    }
  }
);

it.each(["(a?.b)`x`", "a.b`x`", "a?.b('x')"])(
  "preserves valid chain boundaries and ordinary tags: %s", async expression => {
    expect(await run(`const a={b(){return 7}};return ${expression}`))
      .toMatchObject({ ok: true, returnValue: 7 });
  }
);

it("rejects eval before executing any guest side effect", async () => {
  const source = `const trace=[];await 0;try { eval("trace.push('ran'); var a=null;a?.b\u0060x\u0060"); }
    catch (error) { trace.push(error instanceof SyntaxError); }return trace;`;
  let pending = run(source);
  for (let cycle = 0; cycle < 3; cycle++) {
    const settled = pending.catch(error => error);
    try {
      const saved = JSON.parse(await dump(pending));
      expect(await settled).toMatchObject({ ok: true, returnValue: [true] });
      pending = run(source, { snapshot: restore(saved, { source }) });
    } finally { await settled; }
  }
  expect(await pending).toMatchObject({ ok: true, returnValue: [true] });
  const saved = JSON.parse(await dump(pending));
  expect(await run(source, { snapshot: restore(saved, { source }) }))
    .toMatchObject({ ok: true, returnValue: [true] });
});
