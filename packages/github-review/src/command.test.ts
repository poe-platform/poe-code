import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { defaultCommandRunner } from "./command.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: "diff", stderr: "" }))
}));

describe("defaultCommandRunner", () => {
  it("allows large GitHub CLI output buffers for PR diffs", () => {
    defaultCommandRunner("gh", ["pr", "diff", "123"]);

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
      "gh",
      ["pr", "diff", "123"],
      expect.objectContaining({ maxBuffer: 50 * 1024 * 1024 })
    );
  });
});
