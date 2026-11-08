import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const randomUUID = vi.hoisted(() => vi.fn<() => string>());

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { installCodeReviewAssets } = await import("./assets.js");

describe("code review asset atomic writes", () => {
  beforeEach(() => {
    vol.reset();
    randomUUID.mockReset();
  });

  it("does not remove a colliding asset creation temp symlink", async () => {
    randomUUID
      .mockReturnValueOnce("collision")
      .mockImplementation(() => "retry");
    const temporaryPath = "/repo/.poe-code/code-review/profiles/.generic.md.collision.tmp";
    vol.fromJSON({
      "/outside.tmp": "outside-state\n"
    });
    vol.mkdirSync("/repo/.poe-code/code-review/profiles", { recursive: true });
    vol.symlinkSync("/outside.tmp", temporaryPath);

    await expect(installCodeReviewAssets({ cwd: "/repo" })).resolves.toMatchObject({
      created: expect.arrayContaining(["/repo/.poe-code/code-review/profiles/generic.md"])
    });

    expect(vol.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(temporaryPath).isSymbolicLink()).toBe(true);
    expect(vol.readFileSync("/repo/.poe-code/code-review/profiles/generic.md", "utf8"))
      .toContain("# Generic");
  });

  it("does not remove a colliding asset overwrite temp symlink", async () => {
    randomUUID.mockReturnValue("collision");
    const temporaryPath = "/repo/.poe-code/code-review/profiles/.generic.md.collision.tmp";
    vol.fromJSON({
      "/outside.tmp": "outside-state\n",
      "/repo/.poe-code/code-review/profiles/generic.md": "# Existing\n"
    });
    vol.symlinkSync("/outside.tmp", temporaryPath);

    await expect(installCodeReviewAssets({ cwd: "/repo", force: true })).rejects.toThrow();

    expect(vol.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(temporaryPath).isSymbolicLink()).toBe(true);
    expect(vol.readFileSync("/repo/.poe-code/code-review/profiles/generic.md", "utf8"))
      .toBe("# Existing\n");
  });
});
