import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";

it.each(["sync", "async"])("does not inspect host Proxy errors during %s delivery or replay", async kind => {
  const trace: string[] = [];
  const reason = new Proxy(new Error("private host diagnostic"), {
    getPrototypeOf(target) { trace.push("prototype"); return Reflect.getPrototypeOf(target); },
    getOwnPropertyDescriptor(target, key) { trace.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { trace.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); }
  });
  let calls = 0;
  const fail = kind === "sync" ? () => { calls++; throw reason; } : async () => { calls++; throw reason; };
  const source = "try{await fail()}catch(e){return [e.name,e.message,e.stack]}";
  const original = await run(source, { bindings: { fail } });
  expect(trace).toEqual([]);
  expect(original).toMatchObject({ ok: true, returnValue: ["Error", "Host operation failed.", "Error: Host operation failed.\n    at fail (line 1, column 11)"] });
  const replay = await run(source, { bindings: { fail }, snapshot: JSON.parse(await dump(original)) });
  expect(replay.returnValue).toEqual(original.returnValue);
  expect(trace).toEqual([]);
  expect(calls).toBe(1);
});

it.each(["sync", "async"])("projects a revoked host Proxy as an opaque %s error", async kind => {
  const { proxy, revoke } = Proxy.revocable(new Error("private host diagnostic"), {});
  revoke();
  const fail = kind === "sync" ? () => { throw proxy; } : async () => { throw proxy; };
  expect(await run("try{await fail()}catch(e){return [e.name,e.message]}", { bindings: { fail } }))
    .toMatchObject({ ok: true, returnValue: ["Error", "Host operation failed."] });
});
