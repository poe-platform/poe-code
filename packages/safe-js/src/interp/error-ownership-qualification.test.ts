import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { Budget } from "./budget.js";
import { isSandboxClosure } from "./values.js";

it("does not coerce arbitrary host thrown records for diagnostics", async () => {
  const trace: string[] = [];
  const reason = {
    get name() { trace.push("name"); return "credential-marker"; },
    get message() { trace.push("message"); return "credential-marker"; },
    toString() { trace.push("toString"); return "credential-marker"; }
  };
  const result = await run("try{fail()}catch(e){return [e.name,e.message]}", { bindings: { fail() { throw reason; } } });
  expect(result.ok).toBe(true);
  expect(trace).toEqual([]);
  expect(JSON.stringify(result.returnValue)).not.toContain("credential-marker");
});

it.each(["name", "message", "stack", "cause", "errors", "code", "path"])(
  "does not evaluate host %s diagnostics during admission or replay", async key => {
    const trace: string[] = [];
    const error = new TypeError("public message");
    Object.defineProperty(error, key, { configurable: true, get() { trace.push(key); return "credential-marker"; } });
    const fail = () => { trace.push("host"); throw error; };
    const source = "try{await fail()}catch(e){return [e.name,e.message,e.stack,e.cause,e.errors,e.code,e.path]}";
    const original = await run(source, { bindings: { fail } });
    expect(original.ok).toBe(true);
    expect(trace).toEqual(["host"]);
    const snapshot = await dump(original);
    expect(snapshot).not.toContain("credential-marker");
    expect(snapshot).not.toContain("error-ownership-qualification.test.ts");
    const replayed = await run(source, { bindings: { fail }, snapshot: JSON.parse(snapshot) });
    expect(replayed.returnValue).toEqual(original.returnValue);
    expect(trace).toEqual(["host"]);
  }
);

it("retains an error subclass and cause aliases in original and replayed guest closures", async () => {
  const source = `class Child extends AggregateError{};const marker={};
    const e=new Child([marker,marker],'outer',{cause:marker});
    return ()=>[e instanceof Child,e instanceof AggregateError,e instanceof Error,e.errors[0]===e.cause,e.errors[1]===e.cause]`;
  const original = await run(source);
  const replayed = await run(source, { snapshot: JSON.parse(await dump(original)) });
  for (const result of [original, replayed]) {
    expect(isSandboxClosure(result.returnValue)).toBe(true);
    if (!isSandboxClosure(result.returnValue)) throw new Error("Expected closure");
    expect(await result.returnValue.call([])).toEqual([true, true, true, true, true]);
  }
});

it("allocates a borrowed constructor's error in its owner realm and preserves caller cause", async () => {
  const source = `return C=>{const t=[];const cause=new TypeError('caller');
    const options=new Proxy({}, {has(_,key){t.push('has:'+key);return true},get(_,key){t.push('get:'+key);return cause}});
    const e=new C('owner',options);return [Object.getPrototypeOf(e),e.cause===cause,t]}`;
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  const nativeOwner = runInNewContext("[Error,Error.prototype]");
  expect(nativeCaller(nativeOwner[0])).toEqual([nativeOwner[1], true, ["has:cause", "get:cause"]]);
  const caller = (await run(source)).returnValue;
  const owner = (await run("return [Error,Error.prototype]")).returnValue;
  if (!isSandboxClosure(caller) || !Array.isArray(owner)) throw new Error("Expected realm exports");
  const result = await caller.call([owner[0]]);
  expect(result).toEqual([owner[1], true, ["has:cause", "get:cause"]]);
  expect((result as unknown[])[0]).toBe(owner[1]);
});

it("keeps cancellation recovery under the original step budget", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = run(`try{entered();await new Promise(()=>{})}catch(e){while(true){}}finally{return 'escaped'}`, {
    signal: controller.signal, budget: new Budget({ maxSteps: 300 }), bindings: { entered }
  });
  await started;
  controller.abort(new Error("stop"));
  await expect(pending).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});
