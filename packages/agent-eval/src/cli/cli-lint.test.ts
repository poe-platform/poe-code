import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failedStatTarget: undefined as string | undefined,
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"],
  evalLint: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...args: unknown[]) =>
      mocks.fs.readFile(...(args as Parameters<typeof mocks.fs.readFile>)),
    readdir: (...args: unknown[]) =>
      mocks.fs.readdir(...(args as Parameters<typeof mocks.fs.readdir>)),
    stat: (...args: unknown[]) => {
      const [target] = args as Parameters<typeof mocks.fs.stat>;
      if (String(target) === mocks.failedStatTarget) {
        throw new Error("source stat denied");
      }

      return mocks.fs.stat(...(args as Parameters<typeof mocks.fs.stat>));
    }
  }
}));

vi.mock("../lint/lint.js", () => ({
  evalLint: mocks.evalLint
}));

const { renderLintResults, runLintCli } = await import("./lint.js");

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

describe("runLintCli", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "0";
    mocks.failedStatTarget = undefined;
    mocks.fs = createFsFromVolume(Volume.fromJSON(createSourceFiles(["smoke"]), "/")).promises;
    mocks.evalLint.mockReset();
    mocks.evalLint.mockResolvedValue({ evalId: "smoke", issues: [] });
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

  it("auto-selects a single eval when evalId is omitted", async () => {
    const exitCode = await runLintCli({});

    expect(exitCode).toBe(0);
    expect(mocks.evalLint).toHaveBeenCalledWith({
      sourceDir: "/repo/evals",
      evalId: "smoke"
    });
  });

  it("lints the current eval folder when evalId is .", async () => {
    vi.mocked(process.cwd).mockReturnValue("/repo/evals/smoke");

    const exitCode = await runLintCli({ evalId: "." });

    expect(exitCode).toBe(0);
    expect(mocks.evalLint).toHaveBeenCalledWith({
      sourceDir: "/repo/evals",
      evalId: "smoke"
    });
  });

  it("uses an explicit evalId without requiring eval discovery", async () => {
    mocks.fs = createFsFromVolume(Volume.fromJSON({ "/repo/evals/.keep": "" }, "/")).promises;
    mocks.evalLint.mockResolvedValue({
      evalId: "missing-eval",
      issues: [{ severity: "error", code: "E001", message: "eval.yaml is missing." }]
    });

    const exitCode = await runLintCli({ evalId: "missing-eval", sourceDir: "/repo/evals" });

    expect(exitCode).toBe(1);
    expect(mocks.evalLint).toHaveBeenCalledWith({
      sourceDir: "/repo/evals",
      evalId: "missing-eval"
    });
  });

  it("does not treat inherited stat error codes as missing source directories", async () => {
    mocks.failedStatTarget = "/repo/evals";

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(runLintCli({ sourceDir: "/repo/evals" })).resolves.toBe(1);
    });

    expect(stderr()).toContain("source stat denied");
    expect(mocks.evalLint).not.toHaveBeenCalled();
  });

  it("lints all evals when evalId is omitted and multiple evals exist", async () => {
    mocks.fs = createFsFromVolume(
      Volume.fromJSON(createSourceFiles(["alpha", "beta"]), "/")
    ).promises;
    mocks.evalLint.mockImplementation(async ({ evalId }) => ({ evalId, issues: [] }));

    const exitCode = await runLintCli({});

    expect(exitCode).toBe(0);
    expect(mocks.evalLint).toHaveBeenCalledTimes(2);
    expect(mocks.evalLint).toHaveBeenNthCalledWith(1, {
      sourceDir: "/repo/evals",
      evalId: "alpha"
    });
    expect(mocks.evalLint).toHaveBeenNthCalledWith(2, {
      sourceDir: "/repo/evals",
      evalId: "beta"
    });
  });

  it("returns 0 when only warnings are present", async () => {
    mocks.evalLint.mockResolvedValue({
      evalId: "smoke",
      issues: [{ severity: "warning", code: "W004", message: "Pin target.ref." }]
    });

    await expect(runLintCli({ evalId: "smoke" })).resolves.toBe(0);
  });

  it("returns 1 when any error is present", async () => {
    mocks.evalLint.mockResolvedValue({
      evalId: "smoke",
      issues: [{ severity: "error", code: "E002", message: "plan.md is missing." }]
    });

    await expect(runLintCli({ evalId: "smoke" })).resolves.toBe(1);
  });

  it("prints errors before warnings for each eval", async () => {
    mocks.evalLint.mockResolvedValue({
      evalId: "smoke",
      issues: [
        { severity: "warning", code: "W004", message: "Pin target.ref." },
        { severity: "error", code: "E002", message: "plan.md is missing." }
      ]
    });

    const exitCode = await runLintCli({ evalId: "smoke" });

    expect(exitCode).toBe(1);
    expect(stdout().indexOf("Errors")).toBeLessThan(stdout().indexOf("Warnings"));
    expect(stdout()).toContain("E002");
    expect(stdout()).toContain("W004");
  });

  it("renders one section per eval", () => {
    const output = renderLintResults([
      {
        evalId: "alpha",
        issues: [{ severity: "error", code: "E001", message: "eval.yaml is missing." }]
      },
      {
        evalId: "beta",
        issues: [{ severity: "warning", code: "W004", message: "Pin target.ref." }]
      }
    ]);

    expect(output).toContain("alpha");
    expect(output).toContain("beta");
    expect(output.indexOf("alpha")).toBeLessThan(output.indexOf("beta"));
  });
});

function createSourceFiles(evalIds: readonly string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const evalId of evalIds) {
    files[`/repo/evals/${evalId}/eval.yaml`] = "id: test\n";
  }
  return files;
}

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
