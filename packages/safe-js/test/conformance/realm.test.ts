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
