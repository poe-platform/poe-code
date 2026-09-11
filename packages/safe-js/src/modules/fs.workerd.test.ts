import { constants } from "node:os";
import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { makeFsModule } from "./fs.js";

vi.mock("node:util", async importOriginal => ({
  ...await importOriginal<typeof import("node:util")>(),
  getSystemErrorMap() { throw new Error("node:util getSystemErrorMap is not implemented"); }
}));
vi.mock("#safe-js-platform", () => import("../platform/workerd.js"));

it("uses the workerd errno constants for rooted adapter access denials", async () => {
  const adapter = createMemoryFileSystem();
  await adapter.mkdir("/root");
  const fs = makeFsModule({ adapter, root: "/root" });
  await expect(fs.readFile("/outside", "utf8")).rejects.toMatchObject({
    message: "EACCES: permission denied, open '/outside'",
    code: "EACCES", errno: -Math.abs(constants.errno.EACCES!), syscall: "open", path: "/outside"
  });
});
