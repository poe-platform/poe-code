import { describe, expect, it, vi } from "vitest";
import { Budget } from "./interp/budget.js";
import { createRealm } from "./realm.js";
import { run } from "./run.js";
import { makeFsModule } from "./modules/fs.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

describe("unlimited host grants", () => {
  it("accepts Infinity for every Budget limit", () => {
    const budget = new Budget({ maxSteps: Infinity, maxCallDepth: Infinity,
      stringLength: Infinity, arrayLength: Infinity, dataSize: Infinity,
      regexSourceLength: Infinity, regexCompileAllocations: Infinity, deadline: Infinity });
    for (const limit of Object.values(budget.limits)) expect(limit).toBeUndefined();
    expect(budget.deadline).toBeUndefined();
  });
  it("accepts Infinity for all realm limits", async () => {
    const realm = createRealm({ limits: { extensions: Infinity, hostObjects: Infinity,
      callbacks: Infinity, guestReferences: Infinity, cleanups: Infinity, nestedEvaluations: Infinity } });
    await realm.close();
  });
  it("uses an unlimited default Budget in run", async () => {
    const depths: Array<number | undefined> = [];
    const enterCall = Budget.prototype.enterCall;
    const observer = vi.spyOn(Budget.prototype, "enterCall").mockImplementation(function (this: Budget) {
      depths.push(this.limits.maxCallDepth);
      return enterCall.call(this);
    });
    try {
      expect((await run("function f() { return 42; } return f();")).returnValue).toBe(42);
      expect(depths.length).toBeGreaterThan(0);
      expect(depths.every(depth => depth === undefined)).toBe(true);
    } finally {observer.mockRestore();}
  });
  it("uses an unlimited default Budget in realms", async () => {
    const depths: Array<number | undefined> = [];
    const acquireOwner = Budget.prototype.acquireRealmOwner;
    const observer = vi.spyOn(Budget.prototype, "acquireRealmOwner").mockImplementation(function (this: Budget) {
      depths.push(this.limits.maxCallDepth);
      return acquireOwner.call(this);
    });
    try {
      const realm = createRealm();
      await realm.close();
      expect(depths).toEqual([undefined]);
    } finally {observer.mockRestore();}
  });
  it("enforces explicitly configured adapter read limits", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/value", new TextEncoder().encode("abcdef"));
    await expect(makeFsModule({ adapter: fs, readFileMaxBytes: 5 }).readFile("/value", "utf8")).rejects.toMatchObject({ code: "EFBIG" });
    await expect(makeFsModule({ adapter: fs, hostReadMemoryLimit: 40 }).readFile("/value", "utf8")).rejects.toMatchObject({ code: "EFBIG" });
    expect(() => makeFsModule({ adapter: fs, readFileMaxBytes: -1 })).toThrow("Filesystem read limits");
  });
  it.each([{}, { hostReadMemoryLimit: Infinity, readFileMaxBytes: Infinity }])("reads beyond the former implicit adapter read cap with %j", async limits => {
    const fs = new MemoryFileSystem();
    const contents = "a".repeat(500_000);
    await fs.writeFile("/large", new TextEncoder().encode(contents));
    const module = makeFsModule({ adapter: fs, ...limits });
    expect(await module.readFile("/large", "utf8")).toBe(contents);
  });
});
