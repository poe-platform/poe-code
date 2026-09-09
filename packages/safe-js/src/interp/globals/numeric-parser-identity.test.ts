import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";

describe.each(["parseInt", "parseFloat"])("%s intrinsic identity", name => {
  it.each([
    `return Number.${name}===${name}`,
    `${name}.extra=7;return Number.${name}.extra`,
    `Number.${name}.extra=9;return ${name}.extra`,
    `const original=Number.${name};globalThis.${name}=()=>7;return [Number.${name}===original,Number.${name}===globalThis.${name}]`,
    `return [${name}.length,Number.${name}.length,${name}.bind(null,'12').length]`
  ])("matches native behavior and replay: %s", async body => {
    const source = `await 0;${body}`;
    const expected = await runInNewContext(`(async()=>{${source}})()`, {}, { timeout: 1000 });
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: JSON.parse(await dump(result)) }))
      .toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not share mutations across runs", async () => {
    expect(await run(`${name}.extra=7;return Number.${name}.extra`))
      .toMatchObject({ ok: true, returnValue: 7 });
    expect(await run(`return [Number.${name}===${name},${name}.extra]`))
      .toMatchObject({ ok: true, returnValue: [true, undefined] });
  });

  it("creates fresh parser functions when a budget is reused", async () => {
    const budget = new Budget();
    const first = await run(`${name}.extra=7;return ${name}`, { budget });
    const second = await run(`return ${name}`, { budget });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.returnValue).not.toBe(first.returnValue);
    expect(await run(`return [Number.${name}===${name},${name}.extra]`, { budget }))
      .toMatchObject({ ok: true, returnValue: [true, undefined] });
  });
});
