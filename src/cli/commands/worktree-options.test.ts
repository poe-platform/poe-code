import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { addWorktreeOptions } from "./worktree-options.js";

describe("addWorktreeOptions", () => {
  it("describes --worktree without a trailing period, like every sibling flag", () => {
    const command = addWorktreeOptions(new Command("run"));

    const worktreeOption = command.options.find((option) => option.long === "--worktree");

    expect(worktreeOption?.description).toBe(
      "Run in a managed git worktree and reconcile successful output"
    );
  });
});
