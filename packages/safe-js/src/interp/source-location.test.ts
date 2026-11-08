import { expect, it } from "vitest";
import { run } from "../run.js";

it.each(['throw new Error("mapped")', 'throw new TypeError("mapped")', 'missing'])("maps guest stack positions for %s with explicit host capability", async expression => {
  const result = await run(`try { ${expression}; } catch (error) { return error.stack; }`, {
    sourceLocation: () => ({ filename: "original.ts", line: 5, column: 3 }),
  });
  expect(result).toMatchObject({ ok: true, returnValue: expect.stringContaining("original.ts:5:3") });
});

it("maps asynchronous rejection stacks without changing other runs", async () => {
  const source = 'return await Promise.resolve().then(() => { missing; }).catch(error => error.stack)';
  const [mapped, ordinary] = await Promise.all([
    run(source, { sourceLocation: () => ({ filename: "original.ts", line: 5, column: 3 }) }),
    run(source),
  ]);
  expect(mapped).toMatchObject({ ok: true, returnValue: expect.stringContaining("original.ts:5:3") });
  expect(ordinary).toMatchObject({ ok: true, returnValue: expect.stringContaining("(line 1, column") });
});

it("supports diagnostic mapping with the module runner", async () => {
  const messages: unknown[] = [];
  await run('try { missing; } catch (error) { console.log(error.stack); }', {
    sourceType: "module", sourceLocation: () => ({ filename: "original.ts", line: 5, column: 3 }),
    sink: { log: value => { messages.push(value); }, error: () => {} },
  });
  expect(messages[0]).toEqual(expect.stringContaining("original.ts:5:3"));
});
