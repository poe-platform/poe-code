import { expect, it } from "vitest";
import { FsError, isErrnoCode, toFsError } from "../src/contracts/errors.js";

it("preserves a genuine nonseekable-descriptor error", () => {
  const original = { code: "ESPIPE", syscall: "lseek", path: "/pipe" };
  const error = toFsError(original);
  expect(isErrnoCode("ESPIPE")).toBe(true);
  expect(error).toMatchObject({ code: "ESPIPE", syscall: "lseek", path: "/pipe", cause: original });
});

it("constructs illegal-seek errors without changing their canonical identity", () => {
  const error = new FsError("ESPIPE", { syscall: "lseek", path: "/pipe" });
  expect(error.message).toBe("ESPIPE: illegal seek, lseek '/pipe'");
  expect(toFsError(error)).toBe(error);
});

it("supports >85 character legal paths and enforces 255-byte limits without global Buffer", async () => {
  const { MemoryFileSystem } = await import("../src/fs/memory/index.js");
  const { createDeviceFileSystem } = await import("../src/fs/devices/index.js");
  const savedBuffer = globalThis.Buffer;
  // @ts-expect-error simulate browser runtime without global Buffer
  delete globalThis.Buffer;
  try {
    const mem = new MemoryFileSystem();
    const devFs = createDeviceFileSystem(mem);
    const legal86 = "/" + "a".repeat(86);
    await devFs.writeFile(legal86, Uint8Array.of(1));
    expect(await devFs.readFile(legal86)).toEqual(Uint8Array.of(1));
    const symlink86 = "/" + "b".repeat(86);
    await devFs.symlink(legal86, symlink86);
    expect(await devFs.readFile(symlink86)).toEqual(Uint8Array.of(1));
    const tooLongAscii = "/" + "a".repeat(256);
    await expect(devFs.writeFile(tooLongAscii, Uint8Array.of(1))).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    const tooLongMultibyte = "/" + "€".repeat(86); // 86 * 3 = 258 bytes
    await expect(devFs.writeFile(tooLongMultibyte, Uint8Array.of(1))).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    expect(mem.canonicalizeMissingTarget("/" + "m".repeat(86))).toBe("/" + "m".repeat(86));
    expect(() => mem.canonicalizeMissingTarget(tooLongMultibyte)).toThrow(/ENAMETOOLONG/);
  } finally {
    globalThis.Buffer = savedBuffer;
  }
});
