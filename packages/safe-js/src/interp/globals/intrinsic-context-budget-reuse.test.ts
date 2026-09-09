import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { isSandboxClosure } from "../values.js";

it.each([
  {name:"eval",call:'C("marker")'},
  {name:"Function",call:'C("return marker")()'}
])("uses the current $name global context after budget reuse", async ({name,call}) => {
  const budget = new Budget();
  expect((await run(`globalThis.marker=1;return ${name}`,{budget})).ok).toBe(true);
  const owner = await run(`globalThis.marker=2;return ${name}`,{budget});
  const caller = await run(`return C=>${call}`);
  expect(owner.ok).toBe(true);
  expect(caller.ok).toBe(true);
  if (!isSandboxClosure(owner.returnValue) || !isSandboxClosure(caller.returnValue)) throw new Error("Expected exports");
  expect(await caller.returnValue.call([owner.returnValue],{stack:[],thisValue:undefined})).toBe(2);
});

it.each(["eval","Function"].flatMap(name=>["C","C.bind(null)","new Proxy(C,{})"].map(target=>({name,target}))))(
  "retains reused $name context through replay and $target", async ({name,target}) => {
    const budget = new Budget();
    expect((await run("globalThis.marker=1",{budget})).ok).toBe(true);
    const source = `globalThis.marker=2;const C=${name};globalThis.${name}=undefined;await 0;return C`;
    const original = await run(source,{budget});
    expect(original.ok).toBe(true);
    const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
    expect(replayed.ok).toBe(true);
    const caller = (await run(`return C=>(${target})(${JSON.stringify(name === "eval" ? "marker" : "return marker")})${name === "Function" ? "()" : ""}`)).returnValue;
    if (!isSandboxClosure(caller)) throw new Error("Expected caller");
    for (const result of [original,replayed]) {
      expect(await caller.call([result.returnValue],{stack:[],thisValue:undefined})).toBe(2);
    }
  }
);
