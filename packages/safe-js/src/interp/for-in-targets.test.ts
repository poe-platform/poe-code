import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "const target={};const seen=[];for(target.key in {a:1,b:2})seen.push(target.key);return seen",
  "const seen=[];for(const [first] in {ab:1,cd:2})seen.push(first);return seen",
  "const seen=[];for(const {length} in {ab:1,c:2})seen.push(length);return seen",
  "let first;const seen=[];for([first] in {ab:1,cd:2})seen.push(first);return seen"
])("supports JavaScript for-in binding targets: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
});
