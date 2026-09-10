import { expect, it } from "vitest";
import { isSandboxPromise } from "../../src/interp/values.js";
import { createTest262Realm } from "./realm.js";

it("shares lexical state across scripts but isolates test realms", async () => {
  const first = createTest262Realm();
  const second = createTest262Realm();
  try {
    await first.evaluate("let retained=7;Object.prototype.marker=1");
    expect(await first.evaluate("retained")).toMatchObject({ status: "normal", value: 7 });
    expect(await second.evaluate('[typeof retained,({}).marker]'))
      .toMatchObject({ status: "normal", value: ["undefined", undefined] });
  } finally { await first.dispose(); await second.dispose(); }
});

it("distinguishes parse and runtime errors without losing the thrown value", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate("globalThis.touched=true;return 1"))
      .toMatchObject({ status: "throw", phase: "parse", error: { name: "SyntaxError" } });
    expect(await realm.evaluate("typeof touched")).toMatchObject({ status: "normal", value: "undefined" });
    expect(await realm.evaluate("globalThis.touched=true;throw 42"))
      .toEqual({ status: "throw", phase: "runtime", error: 42 });
    expect(await realm.evaluate("touched")).toMatchObject({ status: "normal", value: true });
  } finally { await realm.dispose(); }
});

it("does not classify a resource limit as a guest negative-test error", async () => {
  const realm = createTest262Realm({ maxSteps: 10 });
  try {
    expect(await realm.evaluate("while(true){}"))
      .toMatchObject({ status: "host-error" });
  } finally { await realm.dispose(); }
});

it("cancels pending work and refuses evaluation after disposal", async () => {
  const realm = createTest262Realm();
  const result = await realm.evaluate("async function pending(){await new Promise(()=>{})} pending()");
  if (result.status !== "normal" || !isSandboxPromise(result.value)) throw new Error("Missing Promise");
  const outcome = result.value.promise.then(() => "fulfilled", () => "rejected");
  await realm.dispose();
  expect(await outcome).toBe("rejected");
  await realm.dispose();
  expect(await realm.evaluate("1")).toMatchObject({ status: "host-error" });
});

it("provides ordinary non-enumerable host bindings and same-realm evalScript", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`let retained=7;
      [$262.global===globalThis,Object.getPrototypeOf($262)===Object.prototype,
       $262.evalScript("retained++"),retained,
       Object.getOwnPropertyDescriptor(globalThis,"$262").enumerable,
       Object.getOwnPropertyDescriptor(globalThis,"$262").writable,
       Object.getOwnPropertyDescriptor(globalThis,"print").configurable]`))
      .toMatchObject({ status: "normal", value: [true, true, 7, 8, false, true, true] });
  } finally { await realm.dispose(); }
});

it("creates independent child realms with their own host API", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`let retained=7;const child=$262.createRealm();
      [child.global!==globalThis,child.evalScript("typeof retained"),
       child.evalScript("$262.global===globalThis"),child.evalScript("Object")!==Object]`))
      .toMatchObject({ status: "normal", value: [true, "undefined", true, true] });
  } finally { await realm.dispose(); }
});

it("propagates primitive evalScript throws to the guest caller", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate('try{$262.evalScript("throw 42")}catch(error){error}'))
      .toMatchObject({ status: "normal", value: 42 });
  } finally { await realm.dispose(); }
});

it("converts printed arguments using guest semantics", async () => {
  const messages: string[] = [];
  const realm = createTest262Realm({}, message => { messages.push(message); });
  try {
    expect(await realm.evaluate('print({toString(){return "converted"}});print("done",42)'))
      .toMatchObject({ status: "normal" });
    expect(messages).toEqual(["converted", "done"]);
  } finally { await realm.dispose(); }
});

it("cancels work in child realms when their owning test realm is disposed", async () => {
  const realm = createTest262Realm();
  const result = await realm.evaluate('$262.createRealm().evalScript("async function pending(){await new Promise(()=>{})} pending()")');
  if (result.status !== "normal" || !isSandboxPromise(result.value)) throw new Error("Missing child Promise");
  const outcome = result.value.promise.then(() => "fulfilled", () => "rejected");
  await realm.dispose();
  expect(await outcome).toBe("rejected");
});

it.each(["missing", "missing++"])("classifies an uncaught reference failure as a runtime throw: %s", async source => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(source)).toMatchObject({ status: "throw", phase: "runtime" });
  } finally { await realm.dispose(); }
});

it("initializes a child realm before its Function constructor is used", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`const other=$262.createRealm().global;
      const C=new other.Function();C.prototype=null;
      Object.getPrototypeOf(Array.of.call(C,1,2,3))===other.Object.prototype`))
      .toMatchObject({ status: "normal", value: true });
  } finally { await realm.dispose(); }
});
