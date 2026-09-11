import path from "node:path";
import { fileURLToPath } from "node:url";

import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

describe("SafeJS CLI entrypoint", () => {
  const filename = fileURLToPath(new URL("./cli.ts", import.meta.url));
  let originalArgv: string[];
  let originalExitCode: typeof process.exitCode;
  let output: string[];

  beforeEach(() => {
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    output = [];
    vi.resetModules();
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vol.reset();
    vol.fromJSON({ [filename]: "", "/bin/consumer.js": "" });
    vol.symlinkSync(filename, "/bin/poe-safejs");
    vol.symlinkSync(filename, "/bin/poe-safe-js");
    vol.symlinkSync("/bin/poe-safejs", "/bin/safejs-chain");
    vol.symlinkSync(filename, "/bin/safejs space # λ");
    vol.symlinkSync(path.dirname(filename), "/bin/safejs-directory");
  });

  afterEach(() => {
    vi.doUnmock("./run.js");
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vol.reset();
  });

  it("prints help without initializing the interpreter", async () => {
    vi.doMock("./run.js", () => {
      throw new Error("Help must not initialize the interpreter");
    });
    process.argv = [process.execPath, filename, "--help"];

    await import("./cli.js");

    expect(output.join("")).toContain("Usage: poe-safe-js");
    expect(process.exitCode).toBe(0);
  });

  it("treats a broken help output pipe as a clean exit", async () => {
    vi.doMock("./run.js", () => {
      throw new Error("Help must not initialize the interpreter");
    });
    vi.mocked(process.stdout.write).mockImplementation(() => {
      throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    });
    process.argv = [process.execPath, filename, "-h"];

    await import("./cli.js");

    expect(process.exitCode).toBe(0);
  });

  it.each([
    filename,
    "/bin/poe-safe-js",
    "/bin/poe-safejs",
    "/bin/safejs-chain",
    "/bin/safejs space # λ",
    "/bin/safejs-directory/cli.ts",
    path.relative(process.cwd(), "/bin/poe-safejs")
  ])("runs help when invoked through %s", async (entrypoint) => {
    process.argv = [process.execPath, entrypoint, "--help"];

    await import("./cli.js");

    expect(output.join("")).toContain("Usage: poe-safe-js");
    expect(output.join("")).toContain("Compatibility alias: poe-safejs");
    expect(process.exitCode).toBe(0);
  });

  it.each([undefined, "", "/bin/consumer.js", "/bin/missing.js"])(
    "does not start when imported by %s",
    async (entrypoint) => {
      process.argv = entrypoint === undefined ? [process.execPath] : [process.execPath, entrypoint];

      await import("./cli.js");

      expect(output).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    }
  );
});
