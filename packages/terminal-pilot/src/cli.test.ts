import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { realpathMock, runCLIMock, terminalPilotGroupMock } = vi.hoisted(() => ({
  realpathMock: vi.fn<(path: string) => Promise<string>>(),
  runCLIMock: vi.fn<() => Promise<void>>(),
  terminalPilotGroupMock: { name: "terminal-pilot" }
}));

const originalArgv = [...process.argv];
const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

vi.mock("node:fs/promises", () => ({
  realpath: realpathMock
}));

vi.mock("toolcraft/cli", () => ({
  runCLI: runCLIMock
}));

vi.mock("./commands/index.js", () => ({
  terminalPilotGroup: terminalPilotGroupMock
}));

describe("terminal-pilot CLI entry point", () => {
  beforeEach(() => {
    process.argv = [...originalArgv];
    realpathMock.mockReset();
    realpathMock.mockImplementation(async (target) => target);
    runCLIMock.mockReset();
    runCLIMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("runs cmdkit with the terminal-pilot command group", async () => {
    const { main } = await import("./cli.js");

    await main(["node", "terminal-pilot", "list-sessions"]);

    expect(runCLIMock).toHaveBeenCalledTimes(1);
    expect(runCLIMock).toHaveBeenCalledWith(terminalPilotGroupMock);
  });

  it("maps --json to cmdkit's output flag", async () => {
    let argvDuringRun: string[] = [];
    runCLIMock.mockImplementation(async () => {
      argvDuringRun = [...process.argv];
    });

    const { main } = await import("./cli.js");

    await main(["node", "terminal-pilot", "list-sessions", "--json"]);

    expect(argvDuringRun).toEqual([
      "node",
      "terminal-pilot",
      "list-sessions",
      "--output",
      "json"
    ]);
    expect(process.argv).toEqual(originalArgv);
  });

  it("does not execute the CLI as a side effect of importing the module", async () => {
    await import("./cli.js");

    expect(runCLIMock).not.toHaveBeenCalled();
  });

  it("executes when invoked through a symlinked bin path", async () => {
    process.argv = ["node", "/tmp/terminal-pilot-bin", "--help"];
    realpathMock.mockImplementation(async (target) => target === "/tmp/terminal-pilot-bin" ? cliPath : target);

    await import("./cli.js");

    expect(runCLIMock).toHaveBeenCalledTimes(1);
    expect(runCLIMock).toHaveBeenCalledWith(terminalPilotGroupMock);
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
