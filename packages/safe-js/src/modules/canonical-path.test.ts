import { expect, it } from "vitest";
import { vi } from "vitest";
import { makeFsModule, type FsImplementation } from "./fs.js";
import { resolveCanonicalPath } from "./canonical-path.js";

const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
function chain(length: number) {
  return {
    async realpath(path: string) { if (path === "/") return path; throw missing(); },
    async readlink(path: string) {
      const index = Number(path.slice(2));
      if (path.startsWith("/l") && index < length) return `/l${index + 1}`;
      throw missing();
    }
  };
}
it("follows more than 32 dangling symlinks by default", async () => {
  await expect(resolveCanonicalPath(chain(50), "/l0")).resolves.toBe("/l50");
});
it("enforces explicit symlink limits at the boundary", async () => {
  await expect(resolveCanonicalPath(chain(3), "/l0", 3)).resolves.toBe("/l3");
  await expect(resolveCanonicalPath(chain(3), "/l0", 2)).rejects.toMatchObject({ code: "ELOOP" });
});
it("detects actual cycles independently of the optional quota", async () => {
  await expect(resolveCanonicalPath({ ...chain(0), async readlink() { return "/l0"; } }, "/l0"))
    .rejects.toMatchObject({ code: "ELOOP" });
});

it("threads the public filesystem module quota into root checks", async () => {
  const targetStat = { dev: 1, ino: 1 };
  const writeFile = vi.fn(async () => undefined);
  const fs = { ...chain(50), stat: async () => targetStat, writeFile } as unknown as FsImplementation;
  await expect(makeFsModule({ fs, root: "/" }).writeFile("/l0", "ok")).resolves.toBeUndefined();
  expect(writeFile).toHaveBeenCalledOnce();
  await expect(makeFsModule({ fs, root: "/", maxSymlinkFollows: 32 }).writeFile("/l0", "ok"))
    .rejects.toMatchObject({ code: "ELOOP" });
  expect(writeFile).toHaveBeenCalledOnce();
});
