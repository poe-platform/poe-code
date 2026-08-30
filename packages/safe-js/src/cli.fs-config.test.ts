import { fs, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSink } from "../test/sinks.js";

const sdk = vi.hoisted(() => ({
  parseFsConfig: vi.fn(),
  resolveFsConfig: vi.fn(),
  makeFsModule: vi.fn(),
  readFile: vi.fn()
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

vi.mock("./modules/fs.js", () => ({ makeFsModule: sdk.makeFsModule }));

vi.mock("./modules/fs-config.js", () => ({
  parseFsConfig: sdk.parseFsConfig,
  resolveFsConfig: sdk.resolveFsConfig
}));

vi.mock("@poe-code/safe-fs", () => {
  throw new Error("CLI configuration tests must not load mutable filesystem adapters.");
});

const { runCli } = await import("./cli.js");

const adapter = Object.freeze({ identity: "SDK-owned adapter" });
const scriptPath = "/repo/scripts/script.ajs";
const configPath = "/repo/config/filesystem.json";
const memoryConfig = { adapter: { type: "memory", options: {} } };

function createInvocation() {
  const stdout = createSink();
  const stderr = createSink();
  const readFile = vi.fn(async (filepath: string, encoding: "utf8") =>
    String(await fs.promises.readFile(filepath, encoding))
  );
  const stat = vi.fn(async (filepath: string) => fs.promises.stat(filepath));
  const writeFile = vi.fn(async () => undefined);
  return { cwd: "/repo", stdout, stderr, readFile, stat, writeFile };
}

describe("SafeJS CLI filesystem configuration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vol.reset();
    vol.fromJSON({
      [scriptPath]:
        'import { readFile } from "fs";\nreturn await readFile("marker.txt", "utf8");\n',
      [configPath]: JSON.stringify(memoryConfig)
    });
    sdk.parseFsConfig.mockImplementation(JSON.parse);
    sdk.resolveFsConfig.mockResolvedValue({ adapter });
    sdk.readFile.mockResolvedValue("from configured filesystem");
    sdk.makeFsModule.mockReturnValue({ readFile: sdk.readFile });
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it.each([
    { args: ["--fs"], root: "/repo/scripts" },
    { args: ["--fs", "--fs-root", "roots"], root: "/repo/roots" },
    { args: ["--fs", "--fs-root", "/srv/legacy"], root: "/srv/legacy" }
  ])("preserves legacy host-root wiring for $args", async ({ args, root }) => {
    const invocation = createInvocation();

    expect(await runCli([...args, "scripts/script.ajs"], invocation)).toBe(0);
    expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith({ root });
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(sdk.parseFsConfig).not.toHaveBeenCalled();
    expect(invocation.stderr.output()).toBe("");
    expect(JSON.parse(invocation.stdout.output())).toEqual({
      ok: true,
      returnValue: "from configured filesystem"
    });
  });

  it("does not grant filesystem access just because a config file exists", async () => {
    vol.writeFileSync(scriptPath, 'return "no filesystem requested";');
    const invocation = createInvocation();

    expect(await runCli(["scripts/script.ajs"], invocation)).toBe(0);
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(invocation.readFile).toHaveBeenCalledExactlyOnceWith(scriptPath, "utf8");
  });

  it("still rejects a legacy root without --fs before host reads", async () => {
    const invocation = createInvocation();

    expect(await runCli(["--fs-root", "roots", "scripts/script.ajs"], invocation)).toBe(1);
    expect(invocation.stderr.output()).toContain("--fs-root requires --fs");
    expect(invocation.readFile).not.toHaveBeenCalled();
    expect(invocation.stat).not.toHaveBeenCalled();
  });

  it.each([memoryConfig, { adapter: { type: "real", options: { root: "/srv/project" } } }])(
    "resolves $adapter.type through the SDK and exposes its module",
    async (config) => {
      const source = JSON.stringify(config);
      vol.writeFileSync(configPath, source);
      const invocation = createInvocation();

      const exitCode = await runCli(
        ["--fs-config", "config/filesystem.json", "scripts/script.ajs"],
        invocation
      );

      expect(exitCode, invocation.stderr.output()).toBe(0);
      expect(sdk.parseFsConfig).toHaveBeenCalledExactlyOnceWith(source);
      expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(config);
      expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith({ adapter });
      expect(sdk.makeFsModule.mock.calls[0]![0].adapter).toBe(adapter);
      expect(invocation.readFile).toHaveBeenCalledWith(configPath, "utf8");
      expect(sdk.readFile).toHaveBeenCalledWith("marker.txt", "utf8");
      expect(JSON.parse(invocation.stdout.output())).toEqual({
        ok: true,
        returnValue: "from configured filesystem"
      });
    }
  );

  it.each([
    { root: "/work" },
    { root: "/work", cwd: "/work/nested" },
    { root: "/work", cwd: "/elsewhere" },
    { cwd: "/elsewhere" }
  ])("forwards SDK virtual paths %j independently of the real host root", async (paths) => {
    const config = {
      adapter: { type: "real", options: { root: "/srv/project" } },
      ...paths
    };
    const resolved = { adapter, ...paths };
    sdk.resolveFsConfig.mockResolvedValue(resolved);
    vol.writeFileSync(configPath, JSON.stringify(config));
    const invocation = createInvocation();

    expect(
      await runCli(["--fs-config", configPath, "scripts/script.ajs"], invocation),
      invocation.stderr.output()
    ).toBe(0);
    expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(config);
    expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith(resolved);
    expect(sdk.makeFsModule.mock.calls[0]![0]).toBe(resolved);
    expect(sdk.makeFsModule.mock.calls[0]![0]).not.toHaveProperty("fs");
  });

  it.each(["readonly", "mount", "overlay", "s3", "webdav", "future-adapter"])(
    "passes opaque %s options to the SDK without CLI backend interpretation",
    async (type) => {
      const config = { adapter: { type, options: { sdkOwned: { nested: [1, "value"] } } } };
      vol.writeFileSync(configPath, JSON.stringify(config));
      const invocation = createInvocation();

      expect(
        await runCli(["--fs-config", configPath, "scripts/script.ajs"], invocation),
        invocation.stderr.output()
      ).toBe(0);
      expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(config);
      expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith({ adapter });
    }
  );

  it.each([
    ["--fs-config", configPath, "--fs"],
    ["--fs", "--fs-config", configPath],
    ["--fs-root", "roots", "--fs-config", configPath]
  ])("rejects mixed configuration %j before any filesystem I/O", async (...args) => {
    const invocation = createInvocation();

    expect(await runCli([...args, "scripts/script.ajs"], invocation)).toBe(1);
    expect(invocation.stderr.output()).toContain("--fs-config");
    expect(invocation.stderr.output()).toContain("cannot be combined");
    expect(invocation.readFile).not.toHaveBeenCalled();
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(invocation.writeFile).not.toHaveBeenCalled();
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
  });

  it("rejects repeated --fs-config before reading either file", async () => {
    const invocation = createInvocation();

    expect(
      await runCli(
        ["--fs-config", configPath, "--fs-config", "/other.json", "scripts/script.ajs"],
        invocation
      )
    ).toBe(1);
    expect(invocation.stderr.output()).toContain("--fs-config");
    expect(invocation.stderr.output()).toContain("only once");
    expect(invocation.readFile).not.toHaveBeenCalled();
    expect(invocation.stat).not.toHaveBeenCalled();
  });

  it("reports malformed JSON before reading or statting the script", async () => {
    vol.writeFileSync(configPath, "{");
    const invocation = createInvocation();

    expect(await runCli(["--fs-config", configPath, "scripts/script.ajs"], invocation)).toBe(1);
    expect(sdk.parseFsConfig).toHaveBeenCalledExactlyOnceWith("{");
    expect(invocation.readFile).toHaveBeenCalledExactlyOnceWith(configPath, "utf8");
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(invocation.stdout.output()).toBe("");
  });

  it.each([
    { config: { adapter: { type: "unknown" } }, message: "Unknown filesystem adapter: unknown" },
    {
      config: { adapter: { type: "real", options: { root: "relative-host" } } },
      message: "adapter.options.root must be an absolute host directory"
    },
    {
      config: { ...memoryConfig, root: "relative-virtual" },
      message: "root must be an absolute virtual path"
    }
  ])("reports SDK validation failure: $message", async ({ config, message }) => {
    vol.writeFileSync(configPath, JSON.stringify(config));
    sdk.resolveFsConfig.mockRejectedValue(new TypeError(message));
    const invocation = createInvocation();

    expect(await runCli(["--fs-config", configPath, "scripts/script.ajs"], invocation)).toBe(1);
    expect(invocation.stderr.output()).toContain(message);
    expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(config);
    expect(invocation.readFile).toHaveBeenCalledExactlyOnceWith(configPath, "utf8");
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(invocation.writeFile).not.toHaveBeenCalled();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(invocation.stdout.output()).toBe("");
  });

  it("does not silently lose explicit config when modulesFor supplies other modules", async () => {
    const invocation = createInvocation();

    expect(
      await runCli(["--fs-config", configPath, "scripts/script.ajs"], {
        ...invocation,
        modulesFor: () => ({ custom: { value: 1 } })
      }),
      invocation.stderr.output()
    ).toBe(0);
    expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith({ adapter });
    expect(sdk.readFile).toHaveBeenCalledWith("marker.txt", "utf8");
  });

  it("reports asynchronous adapter construction failure without falling back to host fs", async () => {
    const failure = Object.assign(new Error("Configured filesystem cannot be opened"), {
      code: "EACCES"
    });
    sdk.resolveFsConfig.mockRejectedValue(failure);
    const invocation = createInvocation();

    expect(await runCli(["--fs-config", configPath, "scripts/script.ajs"], invocation)).toBe(1);
    expect(invocation.stderr.output()).toContain(failure.message);
    expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(memoryConfig);
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.readFile).not.toHaveBeenCalled();
    expect(invocation.stdout.output()).toBe("");
  });

  it("rejects an existing fs module instead of replacing it with configured access", async () => {
    const existingReadFile = vi.fn();
    const invocation = createInvocation();

    expect(
      await runCli(["--fs-config", configPath, "scripts/script.ajs"], {
        ...invocation,
        modulesFor: () => ({ fs: { readFile: existingReadFile } })
      })
    ).toBe(1);
    expect(invocation.stderr.output()).toContain("fs");
    expect(invocation.stderr.output()).toContain("already registered");
    expect(existingReadFile).not.toHaveBeenCalled();
    expect(sdk.readFile).not.toHaveBeenCalled();
    expect(invocation.stdout.output()).toBe("");
  });
});
