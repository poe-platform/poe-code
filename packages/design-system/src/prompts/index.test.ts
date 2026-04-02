import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as clack from "@clack/prompts";
import { confirmOrCancel, PromptCancelledError } from "./index.js";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: vi.fn(),
  cancel: vi.fn(),
  log: {},
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  spinner: vi.fn()
}));

const clackConfirm = vi.mocked(clack.confirm);
const clackIsCancel = vi.mocked(clack.isCancel);

describe("confirmOrCancel", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clackIsCancel.mockReturnValue(false);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("returns true when user confirms", async () => {
    clackConfirm.mockResolvedValueOnce(true as any);

    await expect(
      confirmOrCancel({ message: "Proceed?" })
    ).resolves.toBe(true);
  });

  it("returns false when user declines", async () => {
    clackConfirm.mockResolvedValueOnce(false as any);

    await expect(
      confirmOrCancel({ message: "Proceed?" })
    ).resolves.toBe(false);
  });

  it("throws PromptCancelledError when user cancels", async () => {
    const cancelled = Symbol("cancelled");
    clackConfirm.mockResolvedValueOnce(cancelled as any);
    clackIsCancel.mockReturnValue(true);

    await expect(
      confirmOrCancel({ message: "Proceed?" })
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("Operation cancelled."));
  });
});
