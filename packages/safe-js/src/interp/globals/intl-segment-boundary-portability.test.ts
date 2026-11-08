import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["A😀", "Aé"])("keeps containing and iteration boundaries consistent for %s", async text => {
  expect(await run(`const text=${JSON.stringify(text)};const s=new Intl.Segmenter('en').segment(text);
    return [[...s].map(p=>[p.segment,p.index]),s.containing(1).index,s.containing(1).segment];`))
    .toMatchObject({ ok: true, returnValue: [[["A", 0], [text.slice(1), 1]], 1, text.slice(1)] });
});

it("restores a partially consumed iterator at a supplementary-character boundary", async () => {
  const source = `const s=new Intl.Segmenter('en').segment('A😀');const i=s[Symbol.iterator]();
    i.next();await 0;return [i.next().value.segment,i.next().done,s.containing(1).index];`;
  const first = await run(source);
  expect(first).toMatchObject({ ok: true, returnValue: ["😀", true, 1] });
  expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
    .toMatchObject({ ok: true, returnValue: ["😀", true, 1] });
});
