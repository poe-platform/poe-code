import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
import { makeFsModule } from "./fs.js";

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/grant/input": "allowed", "/outside/input": "outside" });
});
afterEach(() => { vi.restoreAllMocks(); vol.reset(); });

it("control: rejects an escaping symlink present during root checks", async () => {
  vol.unlinkSync("/grant/input");
  vol.symlinkSync("/outside/input", "/grant/input");
  await expect(makeFsModule({ root: "/grant" }).readFile("input", "utf8"))
    .rejects.toMatchObject({ code: "EACCES" });
});

it("qualifies the documented race: a host swap after checks is outside root isolation", async () => {
  const read = fs.promises.readFile.bind(fs.promises);
  vi.spyOn(fs.promises, "readFile").mockImplementation(async (...args) => {
    vol.unlinkSync("/grant/input");
    vol.symlinkSync("/outside/input", "/grant/input");
    return read(...args);
  });
  await expect(makeFsModule({ root: "/grant" }).readFile("input", "utf8"))
    .resolves.toBe("outside");
});
