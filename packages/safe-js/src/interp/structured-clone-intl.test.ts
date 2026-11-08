import { expect, it } from "vitest";
import { run } from "../run.js";

const names = ["Locale", "Collator", "DateTimeFormat", "DisplayNames", "ListFormat", "NumberFormat", "PluralRules", "RelativeTimeFormat"];

it.each(names.flatMap(name => [false, true].map(removePrototype => ({ name, removePrototype }))))("rejects Intl.$name private state before reading properties (null prototype: $removePrototype)", async ({ name, removePrototype }) => {
  const args = name === "DisplayNames" ? "'en',{type:'language'}" : "'en'";
  const source = `const value=new Intl.${name}(${args});let reads=0;Object.defineProperty(value,'payload',{enumerable:true,get(){reads++;return 1}});${removePrototype ? "Object.setPrototypeOf(value,null);" : ""}try{structuredClone(value);return ['accepted',reads]}catch(e){return [e.name,reads]}`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: ["DataCloneError", 0] });
});

it("still clones an ordinary object inheriting an Intl prototype", async () => {
  expect(await run("const value=Object.create(Intl.NumberFormat.prototype);value.answer=42;return structuredClone(value)"))
    .toMatchObject({ ok: true, returnValue: { answer: 42 } });
});
