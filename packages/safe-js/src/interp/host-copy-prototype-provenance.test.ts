import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyToSandbox } from "./values.js";
import { hasNullObjectPrototype } from "./object-model.js";

it.each([false, true])(
  "retains semantic nullPrototype=%s when copied data is imported again",
  async (nullPrototype) => {
    const original = nullPrototype ? Object.assign(Object.create(null), { n: 7 }) : { n: 7 };
    const first = deepCopyToSandbox(original);
    const second = deepCopyToSandbox(first);
    expect(hasNullObjectPrototype(second as object)).toBe(nullPrototype);
    expect(
      await run("return [Object.getPrototypeOf(value)===null,value.n];", {
        bindings: { value: first }
      })
    ).toMatchObject({ ok: true, returnValue: [nullPrototype, 7] });
  }
);

it.each([false, true])(
  "copies guest ordinary data without mistaking its backing storage for nullPrototype=%s",
  async (nullPrototype) => {
    const first = await run(`return ${nullPrototype ? "Object.create(null)" : "({})"};`);
    expect(first.ok).toBe(true);
    expect(
      await run("return Object.getPrototypeOf(value)===null;", {
        bindings: { value: first.returnValue }
      })
    ).toMatchObject({ ok: true, returnValue: nullPrototype });
  }
);
