import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  destinationExists: false,
  access: vi.fn(async () => {
    if (!mocks.destinationExists) {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
  }),
  rm: vi.fn(async () => {
    mocks.destinationExists = false;
  }),
  clone: vi.fn(async () => undefined),
  revparse: vi.fn(async () => "sha\n")
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  mkdir: vi.fn(async () => undefined),
  rm: mocks.rm
}));

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => ({
    clone: mocks.clone,
    revparse: mocks.revparse
  }))
}));

const { cloneTarget } = await import("./clone.js");

describe("cloneTarget cleanup", () => {
  beforeEach(() => {
    mocks.destinationExists = false;
    mocks.access.mockClear();
    mocks.rm.mockClear();
    mocks.clone.mockReset().mockResolvedValue(undefined);
    mocks.revparse.mockReset().mockResolvedValue("sha\n");
  });

  it("names the unclonable target repo instead of letting git fail raw", async () => {
    await expect(
      cloneTarget({
        repo: "git+https://github.com/poe-platform/poe-code.git",
        ref: "main",
        dest: "/runs/placeholder-clone"
      })
    ).rejects.toThrow(
      'target.repo "git+https://github.com/poe-platform/poe-code.git" uses unsupported scheme "git+https".'
    );
    expect(mocks.clone).not.toHaveBeenCalled();
  });

  it("removes a newly created destination after clone failure", async () => {
    mocks.clone.mockImplementation(async () => {
      mocks.destinationExists = true;
      throw new Error("clone failed");
    });

    await expect(
      cloneTarget({ repo: "fixture", ref: "main", dest: "/runs/new-clone" })
    ).rejects.toThrow("clone failed");

    expect(mocks.rm).toHaveBeenCalledWith("/runs/new-clone", { recursive: true, force: true });
    expect(mocks.destinationExists).toBe(false);
  });

  it("does not remove a destination that existed before failure", async () => {
    mocks.destinationExists = true;
    mocks.clone.mockRejectedValue(new Error("clone failed"));

    await expect(
      cloneTarget({ repo: "fixture", ref: "main", dest: "/runs/existing-clone" })
    ).rejects.toThrow("clone failed");

    expect(mocks.rm).not.toHaveBeenCalled();
  });
});
