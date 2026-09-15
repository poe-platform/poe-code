import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { Volume } from "memfs";

const originalArguments = process.argv;
afterEach(() => {
  process.argv = originalArguments;
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:fs");
  vi.resetModules();
});

describe("packed smoke build selection", () => {
  it("exercises the opt-in op plugin from the installed root artifact", async () => {
    const volume = Volume.fromJSON({}, "/smoke-owned/sdk");
    volume.mkdirSync("/smoke-owned/sdk", { recursive: true });
    const stop = new Error("packed runtime fixture ready");
    vi.doMock("node:child_process", () => ({
      execSync: vi.fn(() => ""),
      spawnSync: vi.fn((_binary: string, args: string[]) => {
        if (args[0]?.endsWith("safe-fs-smoke.mjs")) throw stop;
        return { status: 0, stdout: "", stderr: "" };
      })
    }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      mkdtempSync: vi.fn().mockReturnValueOnce("/smoke-owned/pack").mockReturnValueOnce("/smoke-owned/sdk"),
      readdirSync: vi.fn(() => ["poe-code.tgz"]),
      writeFileSync: volume.writeFileSync.bind(volume),
      rmSync: vi.fn()
    }));
    process.argv = [process.execPath, "scripts/smoke-test.ts", "--prebuilt"];
    await expect(import("./smoke-test.js")).rejects.toBe(stop);
    const source = volume.readFileSync("/smoke-owned/sdk/safe-fs-smoke.mjs", "utf8");
    expect(source).toContain('from "poe-code/safe-bash/commands/op"');
    expect(source).toContain("shell.use(opCommands(");
    expect(source).toContain('assert.equal(secret.stdout, "synthetic-secret\\n")');
  });

  it("retains npm installation errors in quiet smoke runs", async () => {
    const failure = new Error("npm error 404 unavailable package tarball");
    const execSync = vi.fn((command: string) => {
      if (command.startsWith("npm install ")) {
        throw command.includes("--silent") ? new Error("Command failed") : failure;
      }
      return "";
    });
    vi.doMock("node:child_process", () => ({ execSync, spawnSync: vi.fn() }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      mkdtempSync: vi.fn().mockReturnValueOnce("/smoke-owned/pack").mockReturnValueOnce("/smoke-owned/sdk"),
      readdirSync: vi.fn(() => ["poe-code.tgz"]),
      rmSync: vi.fn()
    }));
    process.argv = [process.execPath, "scripts/smoke-test.ts", "--prebuilt"];
    await expect(import("./smoke-test.js")).rejects.toBe(failure);
    expect(execSync).toHaveBeenLastCalledWith(
      `npm install "/smoke-owned/pack/poe-code.tgz" "typescript@${ts.version}" --loglevel=error`,
      { cwd: "/smoke-owned/sdk", stdio: "pipe" }
    );
  });

  it("runs the temporary installed CLI without mutating the global installation", async () => {
    const stop = new Error("installed CLI observed");
    const execSync = vi.fn(() => "");
    const spawnSync = vi.fn(() => {
      throw stop;
    });
    vi.doMock("node:child_process", () => ({ execSync, spawnSync }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      mkdtempSync: vi
        .fn()
        .mockReturnValueOnce("/smoke-owned/pack")
        .mockReturnValueOnce("/smoke-owned/sdk"),
      readdirSync: vi.fn(() => ["poe-code.tgz"]),
      rmSync: vi.fn()
    }));
    process.argv = [process.execPath, "scripts/smoke-test.ts", "--prebuilt"];
    await expect(import("./smoke-test.js")).rejects.toThrow(stop);
    expect(execSync.mock.calls.some(([command]) => String(command).includes(" -g "))).toBe(false);
    expect(spawnSync).toHaveBeenCalledWith(
      "/smoke-owned/sdk/node_modules/.bin/poe-code",
      ["--version"],
      expect.objectContaining({ cwd: "/smoke-owned/sdk", timeout: 30000 })
    );
  });

  it.each([false, true])("skips only the pack lifecycle when prebuilt=%s", async (prebuilt) => {
    const stop = new Error("packing observed");
    const execSync = vi.fn(() => {
      throw stop;
    });
    vi.doMock("node:child_process", () => ({ execSync, spawnSync: vi.fn() }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      mkdtempSync: vi.fn(() => "/smoke-owned")
    }));
    process.argv = [process.execPath, "scripts/smoke-test.ts", ...(prebuilt ? ["--prebuilt"] : [])];
    await expect(import("./smoke-test.js")).rejects.toThrow(stop);
    expect(execSync).toHaveBeenCalledWith(
      `npm pack --pack-destination "/smoke-owned" --silent${prebuilt ? " --ignore-scripts" : ""}`,
      { stdio: "pipe" }
    );
  });
});
