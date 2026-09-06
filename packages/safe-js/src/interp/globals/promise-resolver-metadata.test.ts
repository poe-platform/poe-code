import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it.each(["resolve", "reject"])("exposes native Promise %s function metadata", async name => {
  const result = await run(`let resolver;new Promise((resolve,reject)=>{resolver=${name};resolve()});
    return resolver.name==="" && resolver.length===1 &&
      Object.getOwnPropertyNames(resolver).join(",")==="length,name";`);
  expect(result.returnValue).toBe(true);
});

it.each(["resolve", "reject"])("uses standard configurable metadata on %s", async name => {
  const result = await run(`const capability=Promise.withResolvers(), resolver=capability.${name};
    const length=Object.getOwnPropertyDescriptor(resolver,"length");
    const name=Object.getOwnPropertyDescriptor(resolver,"name");
    if(length.value!==1 || length.writable || length.enumerable || !length.configurable ||
      name.value!=="" || name.writable || name.enumerable || !name.configurable)return false;
    Object.defineProperty(resolver,"name",{value:"changed"});
    Object.defineProperty(resolver,"length",{value:7});
    capability.resolve(42);
    return resolver.name==="changed" && resolver.length===7 && (await capability.promise)===42;`);
  expect(result.returnValue).toBe(true);
});

it.each(["pending", "completed"])("preserves resolver metadata mutations across %s replay", async mode => {
  const source = `const capability=Promise.withResolvers();
    Object.defineProperty(capability.resolve,"name",{value:"custom"});await 0;
    capability.resolve(42);return capability.resolve.name==="custom" && (await capability.promise)===42;`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: true });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: true });
  } finally { await completed; }
});

it("does not permit resolver state in arbitrary snapshot roots", async () => {
  const result = await run(`const capability=Promise.withResolvers();capability.resolve(42);
    Object.defineProperty(capability.resolve,"name",{value:"custom"});return 42;`);
  expect(() => serializeSafeJSSnapshot({ ...result.snapshot })).toThrow("Guest function properties");
});

it("replays resolver metadata without repeating completed host effects", async () => {
  const source = `const capability=Promise.withResolvers();
    Object.defineProperty(capability.resolve,"length",{value:7});await read();
    capability.resolve(42);return capability.resolve.length===7 && (await capability.promise)===42;`;
  let calls = 0;
  const bindings = { read: async () => { calls++; return 1; } };
  const pending = run(source, { bindings });
  expect(await pending).toMatchObject({ ok: true, returnValue: true });
  const snapshot = restore(JSON.parse(await dump(pending)), { source });
  expect(await run(source, { snapshot, bindings })).toMatchObject({ ok: true, returnValue: true });
  expect(calls).toBe(1);
});
