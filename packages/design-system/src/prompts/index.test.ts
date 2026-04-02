import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as clack from "@clack/prompts";
import { confirmOrCancel, PromptCancelledError } from "./index.js";
import * as cancelPrimitive from "./primitives/cancel.js";

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

const clackConfirm = vi.mocked(clack.confirm);
const primitiveCancel = vi.mocked(cancelPrimitive.cancel);
const primitiveIsCancel = vi.mocked(cancelPrimitive.isCancel);

describe("confirmOrCancel", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
