import { beforeEach, describe, expect, it, vi } from "vitest";

function readStdout(stdoutWrite: ReturnType<typeof vi.spyOn>): string {
  return stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
}

const originalArgv = [...process.argv];

describe("superintendent CLI help", () => {
  beforeEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("shows root help when invoked without a command", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { main } = await import("./cli.js");

    await main(["node", "superintendent"]);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("superintendent");
    expect(output).toContain("Commands:");
    expect(output).toContain("run");
    expect(output).toContain("complete");
    expect(output).toContain("builder");
    expect(output).toContain("inspector");
    expect(output).toContain("install");
  }, 15000);

  it("renders help for the builder subcommands", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { main } = await import("./cli.js");

    await main(["node", "superintendent", "builder", "--help"]);

    const output = readStdout(stdoutWrite);
    expect(output).toContain("superintendent builder");
    expect(output).toContain("Builder commands.");
    expect(output).toContain("run");
  }, 15000);
});
