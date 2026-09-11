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
  expect(error.message).toBe("ESPIPE: invalid seek, lseek '/pipe'");
  expect(toFsError(error)).toBe(error);
});
