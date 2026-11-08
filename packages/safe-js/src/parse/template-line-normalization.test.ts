import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { parse } from "./parser.js";

const lines = ["\r", "\r\n", "\n", "\u2028", "\u2029"];

it.each(lines.flatMap(line => [false, true].map(escaped => ({ line, escaped }))))(
  "normalizes template raw/cooked values for $line (continuation: $escaped)", async ({ line, escaped }) => {
    const separator = (escaped ? "\\" : "") + line;
    const literal = "`a" + separator + "b${1}c" + separator + "d${2}e" + separator + "f`";
    const source = "const tag=(parts,...values)=>[Array.from(parts),Array.from(parts.raw),values];return tag" + literal;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(()=>{" + source + "})()") });
  }
);

it.each(lines)("preserves literal versus escaped line endings in String.raw: %s", async line => {
  const source = "return String.raw`\\r\\n\\u000d\\u000a" + line + "\\" + line + "`";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(()=>{" + source + "})()") });
});

it.each(["\r", "\r\n"])("normalizes raw text even when cooked escapes are invalid: %s", async line => {
  const source = "const tag=parts=>[parts[0],parts.raw[0]];return tag`\\xZ" + line + "end`";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(()=>{" + source + "})()") });
});

it("preserves source offsets for normalized raw text", () => {
  expect(parse("String.raw`a\r\nb`")).toMatchObject({ quasi: { quasis: [{
    value: { raw: "a\nb", cooked: "a\nb" },
    span: { start: { offset: 11 }, end: { offset: 15 } }
  }] } });
});

it.each(["\r", "\r\n"])("preserves normalized template text and identity through replay: %s", async line => {
  const source = "const seen=[];const tag=p=>{seen.push(p);return p.raw[0]};function text(){return tag`a" + line + "b`};const first=text();await 0;return [first,text(),seen[0]===seen[1]]";
  const first = await run(source);
  expect(first).toMatchObject({ ok: true, returnValue: ["a\nb", "a\nb", true] });
  expect(await run(source, { snapshot: JSON.parse(await dump(first)) })).toMatchObject({ ok: true, returnValue: first.returnValue });
});
