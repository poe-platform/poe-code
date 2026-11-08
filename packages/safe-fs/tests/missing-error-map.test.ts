import { constants } from "node:os";
import { expect, it, vi } from "vitest";

vi.mock("node:util", () => ({ getSystemErrorMap: undefined }));

it("loads without getSystemErrorMap and retains native errno values", async () => {
  const { platform } = await import("../src/platform/node.js");
  const native = await vi.importActual<typeof import("node:util")>("node:util");
  const { isErrnoCode } = await import("../src/contracts/errors.js");
  for (const [errno, [code]] of native.getSystemErrorMap()) {
    if (isErrnoCode(code) && code !== "EOPNOTSUPP") expect(platform.errno(code)).toBe(errno);
  }
  expect(platform.errno("ENOENT")).toBe(-Math.abs(constants.errno.ENOENT!));
  expect(platform.errno("EINVAL")).toBe(-Math.abs(constants.errno.EINVAL!));
  expect(platform.errno("EOPNOTSUPP")).toBe(platform.errno("ENOTSUP"));
  expect(() => platform.errno("NOT_AN_ERRNO")).toThrow("Unsupported platform errno");
});
