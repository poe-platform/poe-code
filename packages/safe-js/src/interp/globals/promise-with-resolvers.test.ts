import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it("creates an externally resolvable Promise capability", async () => {
  const result = await run(`const {promise,resolve,reject}=Promise.withResolvers();
    resolve(42);reject(17);return await promise;`);
  expect(result.returnValue).toBe(42);
});

it("preserves subclass construction in withResolvers", async () => {
  const result = await run(`class Child extends Promise {};
    const {promise,resolve}=Child.withResolvers();resolve(42);
    return promise instanceof Child && (await promise)===42;`);
  expect(result.returnValue).toBe(true);
});

it("exposes native method and result property metadata", async () => {
  const result = await run(`const method=Object.getOwnPropertyDescriptor(Promise,"withResolvers");
    const capability=Promise.withResolvers();capability.resolve();
    return Promise.withResolvers.name==="withResolvers" && Promise.withResolvers.length===0 &&
      method.writable && method.configurable && !method.enumerable &&
      Object.keys(capability).join(",")==="promise,resolve,reject" &&
      Object.keys(capability).every(key=>{const d=Object.getOwnPropertyDescriptor(capability,key);
        return d.writable && d.configurable && d.enumerable});`);
  expect(result.returnValue).toBe(true);
});

it("supports generic constructors returning ordinary objects", async () => {
  const result = await run(`const resolved=[],rejected=[];
    function Custom(executor){executor(value=>resolved.push(value),reason=>rejected.push(reason));this.label=42}
    const capability=Promise.withResolvers.call(Custom);
    capability.resolve(1);capability.reject(2);
    return capability.promise instanceof Custom && capability.promise.label===42 &&
      resolved[0]===1 && rejected[0]===2;`);
  expect(result.returnValue).toBe(true);
});

it.each(["undefined", "null", "1", "{}", "()=>{}"])("rejects nonconstructible receivers: %s", async receiver => {
  const result = await run(`if(typeof Promise.withResolvers!=="function")return false;
    try{Promise.withResolvers.call(${receiver});return false}
    catch(error){return error instanceof TypeError}`);
  expect(result.returnValue).toBe(true);
});

it("rejects constructors that do not initialize both resolver functions", async () => {
  const result = await run(`if(typeof Promise.withResolvers!=="function")return false;
    function Invalid(executor){executor(()=>{},1)}
    try{Promise.withResolvers.call(Invalid);return false}catch(error){return error instanceof TypeError}`);
  expect(result.returnValue).toBe(true);
});

it("rejects with the original reason", async () => {
  const result = await run(`const capability=Promise.withResolvers(), reason={label:42};
    capability.reject(reason);try{await capability.promise;return false}catch(error){return error===reason}`);
  expect(result.returnValue).toBe(true);
});

it("assimilates thenables and locks settlement after the first resolver call", async () => {
  const result = await run(`const capability=Promise.withResolvers();
    capability.resolve({then(resolve){resolve(42)}});capability.resolve(17);capability.reject(1);
    return await capability.promise;`);
  expect(result.returnValue).toBe(42);
});

it("preserves constructor exceptions without wrapping them in a promise", async () => {
  const result = await run(`const reason={label:42};function Custom(){throw reason}
    try{Promise.withResolvers.call(Custom);return false}catch(error){return error===reason}`);
  expect(result.returnValue).toBe(true);
});

it.each(["pending", "completed"])("preserves resolver capabilities through %s replay", async mode => {
  const source = `const capability=Promise.withResolvers();await 0;
    capability.resolve(42);return await capability.promise;`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: 42 });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: 42 });
  } finally { await completed; }
});
