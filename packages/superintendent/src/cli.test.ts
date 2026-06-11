import { beforeEach, describe, expect, it, vi } from "vitest";

const { isDirectExecutionMock, runCLIMock, superintendentGroupMock } = vi.hoisted(() => ({
  isDirectExecutionMock: vi.fn<(moduleUrl: string, argv: string[]) => Promise<boolean>>(),
  runCLIMock: vi.fn<() => Promise<void>>(),
  superintendentGroupMock: { name: "superintendent" }
}));

const originalArgv = [...process.argv];
const cliOptions = {
  controls: {
    debug: true,
    output: true,
    verbose: true,
    yes: true
  }
};

vi.mock("./direct-execution.js", () => ({
  isDirectExecution: isDirectExecutionMock
}));

vi.mock("toolcraft/cli", () => ({
  runCLI: runCLIMock
}));

vi.mock("./commands/index.js", () => ({
  superintendentGroup: superintendentGroupMock
}));

describe("superintendent CLI entry point", () => {
  beforeEach(() => {
    process.argv = [...originalArgv];
    isDirectExecutionMock.mockReset();
    isDirectExecutionMock.mockResolvedValue(false);
    runCLIMock.mockReset();
    runCLIMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("runs toolcraft with the superintendent command group", async () => {
    const { main } = await import("./cli.js");

    await main(["node", "superintendent", "run"]);

    expect(runCLIMock).toHaveBeenCalledTimes(1);
    expect(runCLIMock).toHaveBeenCalledWith(superintendentGroupMock, cliOptions);
  });

  it("normalizes --output markdown for toolcraft CLI parsing", async () => {
    runCLIMock.mockImplementation(async () => {
      expect(process.argv).toEqual([
        "node",
        "superintendent",
        "validate",
        "plan.md",
        "--output",
        "md"
      ]);
    });

    const { main } = await import("./cli.js");

    await main(["node", "superintendent", "validate", "plan.md", "--output", "markdown"]);

    expect(runCLIMock).toHaveBeenCalledTimes(1);
  });

  it("does not execute the CLI as a side effect of importing the module", async () => {
    await import("./cli.js");

    expect(runCLIMock).not.toHaveBeenCalled();
  });

  it("executes when isDirectExecution returns true", async () => {
    isDirectExecutionMock.mockResolvedValue(true);

    await import("./cli.js");

    expect(runCLIMock).toHaveBeenCalledTimes(1);
    expect(runCLIMock).toHaveBeenCalledWith(superintendentGroupMock, cliOptions);
  });
});
