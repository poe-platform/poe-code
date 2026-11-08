import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parse } from "./parser.js";
import { run } from "../run.js";

const escapes = ["\\8", "\\9", "\\08", "\\09", "\\1", "\\7"];
const positions = [
  (escape: string) => `\`${escape}\``,
  (escape: string) => `\`${escape}\${1}tail\``,
  (escape: string) => `\`head\${1}${escape}\${2}tail\``,
  (escape: string) => `\`head\${1}${escape}\``
];

it.each(escapes)("rejects untagged invalid decimal escape %s in every quasi", escape => {
  for (const position of positions) {
    const source = position(escape);
    expect(() => runInNewContext(source)).toThrow();
    expect(() => parse(source)).toThrow();
  }
});

it.each(escapes)("preserves tagged raw text and undefined cooked value for %s", async escape => {
  for (const position of positions) {
    const source = `const tag=(parts,...values)=>[Array.from(parts),Array.from(parts.raw),values];return tag${position(escape)}`;
    const expected = runInNewContext(`(function(){${source}})()`);
    expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
  }
});

it.each(["\\\\8", "\\\\9", "\\0", "\\x38", "\\u0039"])("keeps valid escaped text %s", async escape => {
  const source = `return \`${escape}\``;
  expect(await run(source)).toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});
