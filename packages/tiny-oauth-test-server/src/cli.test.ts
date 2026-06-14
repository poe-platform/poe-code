import { afterEach, describe, expect, it } from "vitest";
import "tiny-http-mcp-server/testing";
import { runCli } from "./cli.js";

interface CapturedOutput {
  stdout: string;
  stderr: string;
  io: {
    stdout: {
      write(chunk: string): boolean;
    };
    stderr: {
      write(chunk: string): boolean;
    };
  };
}

function createCapturedOutput(): CapturedOutput {
  const output: CapturedOutput = {
    stdout: "",
    stderr: "",
    io: {
      stdout: {
        write(chunk: string) {
          output.stdout += chunk;
          return true;
        },
      },
      stderr: {
        write(chunk: string) {
          output.stderr += chunk;
          return true;
        },
      },
    },
  };

  return output;
}

describe("tiny-oauth-test-server CLI", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  it("shows help with -h and --help", async () => {
    const shortOutput = createCapturedOutput();
    const longOutput = createCapturedOutput();

    const shortExitCode = await runCli(["-h"], shortOutput.io);
    const longExitCode = await runCli(["--help"], longOutput.io);

    expect(shortExitCode).toBe(0);
    expect(longExitCode).toBe(0);
    expect(shortOutput.stdout).toContain("Usage: tiny-oauth-test-server [options]");
    expect(shortOutput.stdout).toContain("--static-client");
    expect(longOutput.stdout).toContain("-h, --help");
  });

  it("prints the startup contract for smoke testing", async () => {
    const output = createCapturedOutput();

    const exitCode = await runCli(["--port", "0", "--hostname", "127.0.0.1"], {
      ...output.io,
      waitForShutdown: async (shutdown) => {
        cleanups.add(shutdown);
        await shutdown();
        cleanups.delete(shutdown);
      },
    });

    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("tiny-oauth-test-server 0.1.0");
    expect(output.stdout).toContain("Bound URL: http://127.0.0.1:");
    expect(output.stdout).toContain("Issuer: http://127.0.0.1:");
    expect(output.stdout).toContain(
      "Authorization server metadata URL: http://127.0.0.1:"
    );
    expect(output.stdout).toContain(
      "Issue token curl: curl -sS -X POST http://127.0.0.1:"
    );
    expect(output.stdout).toContain("/testing/issue-token");
    expect(output.stderr).toBe("");
  });

  it("prints the served metadata path for a pathful issuer", async () => {
    const output = createCapturedOutput();

    await runCli(["--port", "0", "--hostname", "127.0.0.1", "--issuer", "http://127.0.0.1:43219/oauth"], {
      ...output.io,
      waitForShutdown: async (shutdown) => {
        await shutdown();
      }
    });

    expect(output.stdout).toContain(
      "Authorization server metadata URL: http://127.0.0.1:43219/.well-known/oauth-authorization-server/oauth"
    );
  });
});
