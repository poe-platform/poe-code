import { expect, it, vi } from "vitest";
import { createRealm } from "./realm.js";
import { runResources } from "./interp/resources.js";
import { defineExtension } from "./extensions.js";

it("does not expose the internal cleanup detach handle to extensions", async () => {
  const close = vi.fn();
  const extension = defineExtension({manifest:{version:1,name:"cleanup-shorthand"},
    setup(context) {
      expect(context.onCleanup(close)).toBeUndefined();
      return {};
    }});
  const realm = createRealm({extensions:[extension]});
  try {
    expect(await realm.evaluate("return 7")).toMatchObject({ok:true,returnValue:7});
  } finally { await realm.close(); }
  expect(close).toHaveBeenCalledTimes(1);
});

it("detaches a rolled-back operation's cleanup from a persistent realm", async () => {
  const close = vi.fn(async () => {});
  let detach: (() => void) | void;
  const realm = createRealm({bindings:{install:() => {
    detach = runResources.getStore()!.add(close);
  }}});
  try {
    expect(await realm.evaluate("install();return 1")).toMatchObject({ok:true,returnValue:1});
    expect(typeof detach).toBe("function");
    detach!();
  } finally { await realm.close(); }
  expect(close).not.toHaveBeenCalled();
});

it("detaches the exact registration when the same cleanup function was registered twice", async () => {
  const calls: string[] = [];
  const first = async () => {calls.push("first");};
  const middle = async () => {calls.push("middle");};
  let detach: (() => void) | void;
  const realm = createRealm({bindings:{install:() => {
    const owner = runResources.getStore()!;
    owner.add(first);
    owner.add(middle);
    detach = owner.add(first);
  }}});
  try {
    expect(await realm.evaluate("install();return 1")).toMatchObject({ok:true,returnValue:1});
    detach!();
  } finally { await realm.close(); }
  expect(calls).toEqual(["middle","first"]);
});

it("poisons a realm with the original owned-job failure", async () => {
  const failure = new Error("finalization cleanup failed");
  const realm = createRealm({bindings:{report:() => {
    runResources.getStore()!.reportError!(failure);
  }}});
  try {
    await expect(realm.evaluate("report();return 7")).rejects.toBe(failure);
    await expect(realm.evaluate("return 8")).rejects.toBe(failure);
  } finally { await realm.close(); }
});
