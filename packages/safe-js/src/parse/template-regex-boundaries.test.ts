import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "return `${/'/.test(\"'\")}`;",
  "return `${/\"/.test('\"')}`;",
  "return `${/}/.test('}')}`;",
  "return `${/{/.test('{')}`;",
  "return `${/`/.test('x')}`;",
  "return `${/[}'\"`]/.test('}')}`;",
  "return `${/\\//.test('/')}`;",
  "return `head${/}/.test('}')}middle${6 / 2}tail`;",
  "return `${`inner${/}/.test('}')}`}outer`;",
  "const tag=(parts,...values)=>[Array.from(parts),Array.from(parts.raw),values]; return tag`a${/}/.test('}')}b${6 / 2}c`;",
  "return `${6 /* } ' ` */ / 2}`;",
  "return `${6 // } ' `\n / 2}`;",
  "return `${({value: /}/.test('}')}).value}`;"
])("preserves template substitution boundaries: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
