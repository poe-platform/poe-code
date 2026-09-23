import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";

for (const reason of [null, false, 0, -0, "", Number.NaN]) {
  it(`generic mount capability query preserves cancellation reason ${Object.is(reason, -0) ? "-0" : String(reason)}`, async () => {
    const backing = createMemoryFileSystem();
    const controller = new AbortController();
    const query = vi.fn(async () => { controller.abort(reason); return backing.capabilities; });
    const leaf = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return query;
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = createMountFileSystem({ root: leaf });
    try { await fs.capabilitiesFor("/new", { signal: controller.signal }); expect.fail("expected cancellation"); }
    catch (error) { expect(Object.is(error, reason)).toBe(true); }
    expect(query).toHaveBeenCalledTimes(1);
    try { await fs.capabilitiesFor("/new", { signal: controller.signal }); expect.fail("expected pre-abort"); }
    catch (error) { expect(Object.is(error, reason)).toBe(true); }
    expect(query).toHaveBeenCalledTimes(1);
    expect(await backing.readdir("/")).toEqual([]);
  });
}
