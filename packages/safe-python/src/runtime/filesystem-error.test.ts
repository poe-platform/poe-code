import { expect, it, vi } from "vitest";
import { FsError } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { translateFileSystemError } from "./filesystem-error.js";
import { FileSystemAccess } from "./filesystem-access.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
it.each([
  ["ENOENT", "FileNotFoundError"], ["EEXIST", "FileExistsError"], ["EACCES", "PermissionError"], ["EPERM", "PermissionError"],
  ["ENOTDIR", "NotADirectoryError"], ["EISDIR", "IsADirectoryError"], ["EAGAIN", "BlockingIOError"], ["EINTR", "InterruptedError"],
  ["EPIPE", "BrokenPipeError"], ["ETIMEDOUT", "TimeoutError"], ["EIO", "OSError"]
] as const)("translates %s without using the host errno numbering", (code, name) => {
  const result = translateFileSystemError(new FsError(code, { path: "/x", dest: "/y" }), { errno: () => ({ number: 321, message: "guest error" }) }, budget());
  expect(result).toMatchObject({ name, errno: 321, strerror: "guest error", filename: "/x", filename2: "/y", message: "[Errno 321] guest error: '/x' -> '/y'" });
});
it("quotes filenames using Python repr rather than host interpolation", () => {
  const result = translateFileSystemError(new FsError("ENOENT", { path: "a'b\n😀" }), { errno: () => ({ number: 2, message: "missing" }) }, budget());
  expect(result.message).toBe('[Errno 2] missing: "a\'b\\n😀"');
});
it("keeps filename metadata absent when no path was supplied", () => {
  const result = translateFileSystemError(new FsError("EIO"), { errno: () => ({ number: 5, message: "I/O error" }) }, budget());
  expect(result.filename).toBeUndefined(); expect(result.filename2).toBeUndefined(); expect(result.message).toBe("[Errno 5] I/O error");
});
it("checks cancellation after guest errno-policy lookup", () => {
  const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal });
  expect(() => translateFileSystemError(new FsError("EIO"), { errno() { controller.abort(); return { number: 5, message: "error" }; } }, meter)).toThrow(ExecutionLimitError);
});
it("translates actual safe-fs failures only when the execution supplies a guest errno policy", async () => {
  const fs = createMemoryFileSystem(), access = new FileSystemAccess(fs, budget(), 100, undefined, { errno: () => ({ number: 2, message: "No such file or directory" }) });
  await expect(access.readFile("/missing")).rejects.toMatchObject({ name: "FileNotFoundError", errno: 2, filename: "/missing" });
  const fault = Error("host failure"); vi.spyOn(fs, "readFile").mockRejectedValue(fault);
  await expect(access.readFile("/missing")).rejects.toBe(fault);
});
it("does not consult the error policy after adapter cancellation", async () => {
  const controller = new AbortController(), fs = createMemoryFileSystem(), errno = vi.fn(() => ({ number: 5, message: "error" }));
  vi.spyOn(fs, "readFile").mockImplementation(async () => { controller.abort(); throw new FsError("EIO"); });
  const access = new FileSystemAccess(fs, budget(), 100, controller.signal, { errno });
  await expect(access.readFile("/x")).rejects.toBeInstanceOf(ExecutionLimitError); expect(errno).not.toHaveBeenCalled();
});
