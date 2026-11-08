import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failedLstatTarget: undefined as string | undefined
}));

vi.mock("node:fs/promises", () => ({
  lstat: async (targetPath: string) => {
    if (targetPath === mocks.failedLstatTarget) {
      throw new Error("lstat denied");
    }

    return { isSymbolicLink: () => false };
  },
  mkdir: vi.fn(async () => undefined)
}));

const { assertRunArtifactPath } = await import("./artifact-path.js");

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("artifact path helpers", () => {
  beforeEach(() => {
    mocks.failedLstatTarget = undefined;
  });

  it("does not treat inherited lstat error codes as missing artifact ancestors", async () => {
    mocks.failedLstatTarget = "/repo/evals/runs";

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(assertRunArtifactPath("/repo/evals", "/repo/evals/runs/run-1"))
        .rejects.toThrow("lstat denied");
    });
  });
});
