import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { FsError } from "@poe-code/safe-fs/contracts";
import { FileSystemAccess } from "./filesystem-access.js";
import { ExecutionBudget } from "./execution-budget.js";

function budget(): ExecutionBudget {
  return new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
}

describe("injected safe-fs access", () => {
  it("reads, overwrites, exclusively creates, and appends on the memory adapter", async () => {
    const fs = createMemoryFileSystem();
    const access = new FileSystemAccess(fs, budget(), 16);
    await access.writeFile("/data", new Uint8Array([1, 2]), true);
    await expect(access.writeFile("/data", new Uint8Array([9]), true)).rejects.toMatchObject({ code: "EEXIST" });
    await access.appendFile("/data", new Uint8Array([3]));
    expect([...await access.readFile("/data")]).toEqual([1, 2, 3]);
    await access.writeFile("/data", new Uint8Array([4]));
    expect([...await access.readFile("/data")]).toEqual([4]);
  });

  it("enforces bounded reads and reserves adapter output before reading", async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/data", new Uint8Array([1, 2, 3]));
    const read = vi.spyOn(fs, "readFile");
    const limited = new FileSystemAccess(fs, budget(), 2);
    await expect(limited.readFile("/data")).rejects.toMatchObject({ code: "EFBIG" });
    read.mockClear();
    const exhausted = new FileSystemAccess(fs, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1 }), 2);
    await expect(exhausted.readFile("/data")).rejects.toMatchObject({ reason: "allocation" });
    expect(read).not.toHaveBeenCalled();
  });

  it("defends against an adapter violating its read limit and copies returned buffers", async () => {
    const fs = createMemoryFileSystem(), data = new Uint8Array([1, 2]);
    vi.spyOn(fs, "readFile").mockResolvedValue(data);
    const access = new FileSystemAccess(fs, budget(), 2);
    const result = await access.readFile("/data");
    data[0] = 9;
    expect([...result]).toEqual([1, 2]);
    await expect(new FileSystemAccess(fs, budget(), 1).readFile("/data")).rejects.toMatchObject({ code: "EFBIG" });
  });

  it("snapshots write inputs before asynchronous capability resolution", async () => {
    const fs = Object.assign(createMemoryFileSystem(), { capabilitiesFor: vi.fn(async () => ({})) });
    const access = new FileSystemAccess(fs, budget(), 16);
    const data = new Uint8Array([1, 2]);
    const pending = access.writeFile("/data", data);
    data.fill(9);
    await pending;
    expect([...await fs.readFile("/data")]).toEqual([1, 2]);
  });

  it("honors selected-path readonly and unsupported capabilities before mutation", async () => {
    const fs = Object.assign(createMemoryFileSystem(), { capabilitiesFor: vi.fn(async () => ({})) });
    const write = vi.spyOn(fs, "writeFile");
    vi.spyOn(fs, "capabilitiesFor").mockResolvedValue({ readOnly: true, write: true });
    const access = new FileSystemAccess(fs, budget(), 16);
    await expect(access.writeFile("/data", new Uint8Array([1]))).rejects.toMatchObject({ code: "EROFS" });
    expect(write).not.toHaveBeenCalled();
    vi.spyOn(fs, "capabilitiesFor").mockResolvedValue({ append: false });
    const append = vi.spyOn(fs, "appendFile");
    await expect(access.appendFile("/data", new Uint8Array([1]))).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(append).not.toHaveBeenCalled();
  });

  it("lets the adapter decide unknown capabilities and preserves its faults", async () => {
    const fs = Object.assign(createMemoryFileSystem(), { capabilitiesFor: vi.fn(async () => ({})) });
    vi.spyOn(fs, "capabilitiesFor").mockResolvedValue({});
    const access = new FileSystemAccess(fs, budget(), 16);
    await access.writeFile("/data", new Uint8Array([1]));
    const fault = new FsError("EACCES", { path: "/data" });
    vi.spyOn(fs, "readFile").mockRejectedValue(fault);
    await expect(access.readFile("/data")).rejects.toBe(fault);
  });

  it("does not let selected-path metadata weaken a global readonly declaration", async () => {
    const fs = Object.assign(createMemoryFileSystem(), { capabilitiesFor: vi.fn(async () => ({})) });
    Object.defineProperty(fs, "capabilities", { value: { readOnly: true } });
    const write = vi.spyOn(fs, "writeFile");
    await expect(new FileSystemAccess(fs, budget(), 16).writeFile("/data", new Uint8Array([1]))).rejects.toMatchObject({ code: "EROFS" });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["read", "write", "exclusiveCreate", "append"] as const)("honors globally unsupported %s despite contradictory path metadata", async capability => {
    const fs = Object.assign(createMemoryFileSystem(), { capabilitiesFor: vi.fn(async () => ({ [capability]: true })) });
    Object.defineProperty(fs, "capabilities", { value: { [capability]: false } });
    const access = new FileSystemAccess(fs, budget(), 16);
    const result = capability === "read" ? access.readFile("/data")
      : capability === "append" ? access.appendFile("/data", new Uint8Array([1]))
      : access.writeFile("/data", new Uint8Array([1]), capability === "exclusiveCreate");
    await expect(result).rejects.toMatchObject({ code: "ENOTSUP" });
  });

  it("reports cancellation after a completed write without pretending to roll it back", async () => {
    const fs = createMemoryFileSystem(), controller = new AbortController();
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (path, bytes, options) => {
      await write(path, bytes, options);
      controller.abort();
    });
    const access = new FileSystemAccess(fs, budget(), 16, controller.signal);
    await expect(access.writeFile("/data", new Uint8Array([1]))).rejects.toMatchObject({ reason: "cancelled" });
    expect([...await fs.readFile("/data")]).toEqual([1]);
  });

  it("forwards cancellation and prevents calls when already aborted", async () => {
    const fs = createMemoryFileSystem(), controller = new AbortController();
    const access = new FileSystemAccess(fs, budget(), 16, controller.signal);
    const read = vi.spyOn(fs, "readFile").mockImplementation(async (_path, options) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      return new Uint8Array([1]);
    });
    await expect(access.readFile("/data")).rejects.toMatchObject({ reason: "cancelled" });
    read.mockClear();
    await expect(access.readFile("/data")).rejects.toMatchObject({ reason: "cancelled" });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects embedded NUL before invoking filesystem operations", async () => {
    const fs = Object.assign(createMemoryFileSystem(), { capabilitiesFor: vi.fn(async () => ({})) });
    const resolve = vi.spyOn(fs, "capabilitiesFor");
    await expect(new FileSystemAccess(fs, budget(), 16).readFile("/bad\0path")).rejects.toMatchObject({ name: "ValueError" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid read limit %s", limit => {
    expect(() => new FileSystemAccess(createMemoryFileSystem(), budget(), limit)).toThrow(RangeError);
  });
});
