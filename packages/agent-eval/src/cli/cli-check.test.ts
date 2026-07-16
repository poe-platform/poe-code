import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../check/check.js";

const mocks = vi.hoisted(() => ({
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"],
  evalCheck: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...args: unknown[]) =>
      mocks.fs.readFile(...(args as Parameters<typeof mocks.fs.readFile>)),
    readdir: (...args: unknown[]) =>
      mocks.fs.readdir(...(args as Parameters<typeof mocks.fs.readdir>)),
    stat: (...args: unknown[]) => mocks.fs.stat(...(args as Parameters<typeof mocks.fs.stat>))
  }
}));

vi.mock("../check/check.js", () => ({
  evalCheck: mocks.evalCheck
}));

const { renderCheckResultTable, runCheckCli } = await import("./check.js");

describe("runCheckCli", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "0";
    mocks.fs = createFsFromVolume(Volume.fromJSON(createSourceFiles(["smoke"]), "/")).promises;
    mocks.evalCheck.mockReset();
    mocks.evalCheck.mockResolvedValue(checkResult({ passed: 1, total: 1 }));
    vi.spyOn(process, "cwd").mockReturnValue("/repo/evals");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    vi.restoreAllMocks();
  });

  it("uses process.cwd() as the default sourceDir", async () => {
    await runCheckCli({ evalId: "smoke" });

    expect(mocks.evalCheck).toHaveBeenCalledWith({
      sourceDir: "/repo/evals",
      evalId: "smoke"
    });
  });

  it("auto-selects a single eval when evalId is omitted", async () => {
    const exitCode = await runCheckCli({});

    expect(exitCode).toBe(0);
    expect(mocks.evalCheck).toHaveBeenCalledWith({
      sourceDir: "/repo/evals",
      evalId: "smoke"
    });
  });

  it("checks the current eval folder when evalId is .", async () => {
    vi.mocked(process.cwd).mockReturnValue("/repo/evals/smoke");

    const exitCode = await runCheckCli({ evalId: "." });

    expect(exitCode).toBe(0);
    expect(mocks.evalCheck).toHaveBeenCalledWith({
      sourceDir: "/repo/evals",
      evalId: "smoke"
    });
  });

  it("errors with a hint when multiple evals exist and evalId is omitted", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(createSourceFiles(["alpha", "beta"]), "/")
    ).promises;

    const error = await runCheckCli({}).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "UserError" });
    expect((error as Error).message).toContain("Multiple evals found. Pass an eval id to check.");
    expect((error as Error).message).toContain("Available eval ids: alpha, beta");
    expect(mocks.evalCheck).not.toHaveBeenCalled();
    expect(stderr()).toBe("");
  });

  it("reports an empty eval source as a user error instead of bare stderr text", async () => {
    mocks.fs = createFsFromVolume(Volume.fromJSON({ "/repo/evals/.keep": "" }, "/")).promises;

    await expect(runCheckCli({})).rejects.toMatchObject({
      name: "UserError",
      message: expect.stringContaining(
        'Eval source "/repo/evals" does not contain any first-level <id>/eval.yaml files.'
      )
    });
    expect(stderr()).toBe("");
  });

  it("returns 1 when any case fails", async () => {
    mocks.evalCheck.mockResolvedValue(checkResult({ passed: 1, total: 2 }));

    await expect(runCheckCli({ evalId: "smoke" })).resolves.toBe(1);
  });

  it("renders the per-case table for a fixed CheckResult fixture", () => {
    expect(
      renderCheckResultTable(
        checkResult({
          passed: 1,
          total: 2,
          cases: [
            { name: "creates file", passed: true, durationMs: 12 },
            { name: "updates docs", passed: false, durationMs: 8, message: "missing section" }
          ]
        })
      )
    ).toMatchSnapshot();
  });
});

function createSourceFiles(evalIds: readonly string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const evalId of evalIds) {
    files[`/repo/evals/${evalId}/eval.yaml`] = "id: test\n";
  }
  return files;
}

function checkResult(input: {
  passed: number;
  total: number;
  cases?: CheckResult["tests"]["cases"];
}): CheckResult {
  return {
    evalId: "smoke",
    cloneDir: "/repo/evals/runs/.check/smoke/2026-05-20T00-00-00-000Z/clone",
    tests: {
      passed: input.passed,
      total: input.total,
      cases:
        input.cases ??
        Array.from({ length: input.total }, (_, index) => ({
          name: `case ${index + 1}`,
          passed: index < input.passed,
          durationMs: 1
        }))
    },
    durationMs: 1234
  };
}

function stderr(): string {
  return vi
    .mocked(process.stderr.write)
    .mock.calls.map((call) => String(call[0]))
    .join("");
}
