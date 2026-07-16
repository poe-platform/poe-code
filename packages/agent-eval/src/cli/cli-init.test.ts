import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evalInit: vi.fn()
}));

vi.mock("../init/init.js", () => ({
  evalInit: mocks.evalInit,
  validateInitName: (name: string) => {
    if (name === "bad_name") {
      throw new Error(
        "Eval name must be kebab-case: lowercase letters, digits, and dashes; start with a letter."
      );
    }
  }
}));

const { runInitCli } = await import("./init.js");

describe("runInitCli", () => {
  beforeEach(() => {
    mocks.evalInit.mockReset();
    mocks.evalInit.mockResolvedValue({
      evalDir: "/repo/evals/smoke-task",
      files: ["eval.yaml"]
    });
    vi.spyOn(process, "cwd").mockReturnValue("/repo/evals");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses process.cwd() as the default sourceDir", async () => {
    const exitCode = await runInitCli({ name: "smoke-task", kind: "pipeline" });

    expect(exitCode).toBe(0);
    expect(mocks.evalInit).toHaveBeenCalledWith({
      sourceDir: "/repo/evals",
      name: "smoke-task",
      kind: "pipeline",
      targetRepo: undefined,
      targetRef: undefined
    });
  });

  it("defaults kind to plan", async () => {
    await runInitCli({ name: "smoke-task", sourceDir: "/repo/custom" });

    expect(mocks.evalInit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: "/repo/custom",
        kind: "plan"
      })
    );
  });

  it("prints the resolved eval directory and next command hint", async () => {
    await runInitCli({ name: "smoke-task" });

    expect(stdout()).toContain("/repo/evals/smoke-task");
    expect(stdout()).toContain("next: poe-code eval check smoke-task");
  });

  it("refuses bad names before scaffolding", async () => {
    const exitCode = await runInitCli({ name: "bad_name" });

    expect(exitCode).toBe(1);
    expect(mocks.evalInit).not.toHaveBeenCalled();
    expect(stderr()).toContain(
      "Eval name must be kebab-case: lowercase letters, digits, and dashes; start with a letter."
    );
  });
});

function stdout(): string {
  return vi
    .mocked(process.stdout.write)
    .mock.calls.map((call) => String(call[0]))
    .join("");
}

function stderr(): string {
  return vi
    .mocked(process.stderr.write)
    .mock.calls.map((call) => String(call[0]))
    .join("");
}
