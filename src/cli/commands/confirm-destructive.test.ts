import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedLogger } from "../logger.js";

const designSystemMocks = vi.hoisted(() => ({
  confirmOrCancel: vi.fn()
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    confirmOrCancel: designSystemMocks.confirmOrCancel
  };
});

const { confirmDestructive } = await import("./confirm-destructive.js");

function createLogger(warnings: string[]): ScopedLogger {
  return { warn: (message: string) => warnings.push(message) } as unknown as ScopedLogger;
}

function setStdinTTY(value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  return () => {
    if (original === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
      return;
    }
    Object.defineProperty(process.stdin, "isTTY", original);
  };
}

describe("confirmDestructive", () => {
  beforeEach(() => {
    designSystemMocks.confirmOrCancel.mockReset().mockResolvedValue(true);
  });

  it("skips the prompt when --yes is passed", async () => {
    const warnings: string[] = [];

    await confirmDestructive({
      logger: createLogger(warnings),
      flags: { dryRun: false, assumeYes: true },
      action: "logout",
      summary: ["Removes configuration for ALL configured agents: codex"],
      message: "Remove everything?"
    });

    expect(designSystemMocks.confirmOrCancel).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it("skips the prompt when --dry-run is passed", async () => {
    const restore = setStdinTTY(false);
    try {
      await confirmDestructive({
        logger: createLogger([]),
        flags: { dryRun: true, assumeYes: false },
        action: "runtime templates clear",
        summary: ["docker abc123"],
        message: "Clear entries?"
      });
    } finally {
      restore();
    }

    expect(designSystemMocks.confirmOrCancel).not.toHaveBeenCalled();
  });

  it("prints the blast radius and requires --yes without an interactive TTY", async () => {
    const warnings: string[] = [];
    const restore = setStdinTTY(false);

    try {
      await expect(
        confirmDestructive({
          logger: createLogger(warnings),
          flags: { dryRun: false, assumeYes: false },
          action: "logout",
          summary: ["Removes configuration for ALL configured agents: codex, goose"],
          message: "Remove everything?"
        })
      ).rejects.toThrow("logout requires --yes when running without an interactive TTY.");
    } finally {
      restore();
    }

    expect(warnings.join("\n")).toContain("cannot be undone");
    expect(warnings.join("\n")).toContain(
      "Removes configuration for ALL configured agents: codex, goose"
    );
    expect(designSystemMocks.confirmOrCancel).not.toHaveBeenCalled();
  });

  it("prompts on a TTY and cancels when the user declines", async () => {
    designSystemMocks.confirmOrCancel.mockResolvedValue(false);
    const restore = setStdinTTY(true);

    try {
      await expect(
        confirmDestructive({
          logger: createLogger([]),
          flags: { dryRun: false, assumeYes: false },
          action: "logout",
          summary: [],
          message: "Remove everything?"
        })
      ).rejects.toThrow("Operation cancelled.");
    } finally {
      restore();
    }

    expect(designSystemMocks.confirmOrCancel).toHaveBeenCalledWith({
      message: "Remove everything?",
      initialValue: false
    });
  });

  it("proceeds on a TTY when the user confirms", async () => {
    const restore = setStdinTTY(true);

    try {
      await confirmDestructive({
        logger: createLogger([]),
        flags: { dryRun: false, assumeYes: false },
        action: "worktree remove",
        summary: [],
        message: "Remove worktree wt?"
      });
    } finally {
      restore();
    }

    expect(designSystemMocks.confirmOrCancel).toHaveBeenCalledTimes(1);
  });
});
