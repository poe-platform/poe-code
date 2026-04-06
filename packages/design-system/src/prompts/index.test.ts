import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn()
}));

vi.mock("./primitives/cancel.js", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn()
}));

describe("confirmOrCancel", () => {
  let clackConfirm: Mock;
  let primitiveCancel: Mock;
  let primitiveIsCancel: Mock;
  let confirmOrCancel: typeof import("./index.js").confirmOrCancel;
  let PromptCancelledError: typeof import("./index.js").PromptCancelledError;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    const clack = await import("@clack/prompts");
    const cancelPrimitive = await import("./primitives/cancel.js");
    ({ confirmOrCancel, PromptCancelledError } = await import("./index.js"));
    clackConfirm = vi.mocked(clack.confirm);
    primitiveCancel = vi.mocked(cancelPrimitive.cancel);
    primitiveIsCancel = vi.mocked(cancelPrimitive.isCancel);
    vi.clearAllMocks();
    primitiveIsCancel.mockReturnValue(false);
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
    primitiveIsCancel.mockReturnValue(true);

    await expect(
      confirmOrCancel({ message: "Proceed?" })
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(primitiveCancel).toHaveBeenCalledWith("Operation cancelled.");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
