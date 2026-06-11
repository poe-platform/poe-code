import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTerminalPilotGroupMock, realpathMock, runCLIMock, terminalPilotGroupMock } =
  vi.hoisted(() => ({
    createTerminalPilotGroupMock: vi.fn(),
    realpathMock: vi.fn<(path: string) => Promise<string>>(),
    runCLIMock: vi.fn<() => Promise<void>>(),
    terminalPilotGroupMock: { name: "terminal-pilot" }
  }));

const originalArgv = [...process.argv];
const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
const cliOptions = {
  controls: {
    debug: true,
    output: true,
    verbose: true,
    yes: true
  }
};

vi.mock("node:fs/promises", () => ({
  realpath: realpathMock
}));

vi.mock("toolcraft/cli", () => ({
  runCLI: runCLIMock
}));

vi.mock("./commands/index.js", () => ({
  createTerminalPilotGroup: createTerminalPilotGroupMock
}));

describe("terminal-pilot CLI entry point", () => {
  beforeEach(async () => {
    const { resetTheme } = await import("toolcraft-design");
    resetTheme();
    process.argv = [...originalArgv];
    realpathMock.mockReset();
    realpathMock.mockImplementation(async (target) => target);
    createTerminalPilotGroupMock.mockReset().mockReturnValue(terminalPilotGroupMock);
    runCLIMock.mockReset();
    runCLIMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("configures the terminal-pilot brand on import", async () => {
    await import("./cli.js");
    const { getThemeConfig } = await import("toolcraft-design");

    expect(getThemeConfig()).toEqual({ brand: "green", label: "Terminal Pilot" });
  });

  it("runs toolcraft with the terminal-pilot command group", async () => {
    const { main } = await import("./cli.js");

    await main(["node", "terminal-pilot", "list-sessions"]);

    expect(createTerminalPilotGroupMock).toHaveBeenCalledOnce();
    expect(runCLIMock).toHaveBeenCalledTimes(1);
    expect(runCLIMock).toHaveBeenCalledWith(terminalPilotGroupMock, cliOptions);
  });

  it("maps --json to toolcraft's output flag", async () => {
    let argvDuringRun: string[] = [];
    runCLIMock.mockImplementation(async () => {
      argvDuringRun = [...process.argv];
    });

    const { main } = await import("./cli.js");

    await main(["node", "terminal-pilot", "list-sessions", "--json"]);

    expect(argvDuringRun).toEqual(["node", "terminal-pilot", "list-sessions", "--output", "json"]);
    expect(process.argv).toEqual(originalArgv);
  });

  it("does not execute the CLI as a side effect of importing the module", async () => {
    await import("./cli.js");

    expect(runCLIMock).not.toHaveBeenCalled();
  });

  it("executes when invoked through a symlinked bin path", async () => {
    process.argv = ["node", "/tmp/terminal-pilot-bin", "--help"];
    realpathMock.mockImplementation(async (target) =>
      target === "/tmp/terminal-pilot-bin" ? cliPath : target
    );

    await import("./cli.js");

    expect(createTerminalPilotGroupMock).toHaveBeenCalledOnce();
    expect(runCLIMock).toHaveBeenCalledTimes(1);
    expect(runCLIMock).toHaveBeenCalledWith(terminalPilotGroupMock, cliOptions);
    expect(process.argv).toEqual(["node", "/tmp/terminal-pilot-bin", "--help"]);
  });

  it("preserves an explicit --output flag", async () => {
    let argvDuringRun: string[] = [];
    runCLIMock.mockImplementation(async () => {
      argvDuringRun = [...process.argv];
    });

    const { main } = await import("./cli.js");

    await main(["node", "terminal-pilot", "list-sessions", "--output", "md", "--json"]);

    expect(argvDuringRun).toEqual([
      "node",
      "terminal-pilot",
      "list-sessions",
      "--output",
      "md",
      "--json"
    ]);
    expect(process.argv).toEqual(originalArgv);
  });
});
