import { afterEach, describe, expect, it, vi } from "vitest";

const { readMergedDocumentMock, readMergedDocumentReadonlyMock } = vi.hoisted(() => ({
  readMergedDocumentMock: vi.fn(async () => {
    throw new Error("mutating reader called");
  }),
  readMergedDocumentReadonlyMock: vi.fn(async () => ({ plan: { plan_directory: "docs/plans" } }))
}));

vi.mock("@poe-code/poe-code-config/core", () => ({
  planConfigScope: { schema: {} },
  readMergedDocument: readMergedDocumentMock,
  readMergedDocumentReadonly: readMergedDocumentReadonlyMock,
  resolveConfigPath: (homeDir: string) => `${homeDir}/.poe-code/config.json`,
  resolveProjectConfigPath: (cwd: string) => `${cwd}/.poe-code/config.json`,
  resolveScope: (_schema: unknown, plan: unknown) => plan
}));

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("superintendent plan-path command", () => {
  it("reads configuration without triggering repair writes", async () => {
    process.env.HOME = "/home/test";
    vi.spyOn(process, "cwd").mockReturnValue("/tmp");
    const { planPathCommand } = await import("./plan-path.js");

    await expect(planPathCommand.handler({} as never)).resolves.toEqual({
      planDirectory: "/tmp/docs/plans"
    });
    expect(readMergedDocumentReadonlyMock).toHaveBeenCalledOnce();
    expect(readMergedDocumentMock).not.toHaveBeenCalled();
  });
});
