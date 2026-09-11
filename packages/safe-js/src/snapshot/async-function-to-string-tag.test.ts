import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  { bound: false, deleted: true, tag: "Function" },
  { bound: true, deleted: true, tag: "Function" },
  { bound: true, deleted: false, tag: "AsyncFunction" }
])("restores async tags for bound=$bound deleted=$deleted", async ({ bound, deleted, tag }) => {
  const source = `const original=async()=>7;${deleted ? "delete Object.getPrototypeOf(original)[Symbol.toStringTag];" : ""}
    const fn=${bound ? "original.bind(null)" : "original"};await 0;
    return [Object.prototype.toString.call(fn),await fn(),Object.getPrototypeOf(fn)===Object.getPrototypeOf(original)];`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = JSON.parse(await dump(pending));
    const expected = { ok: true, returnValue: [`[object ${tag}]`, 7, true] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject(expected);
  } finally { await completed; }
});
