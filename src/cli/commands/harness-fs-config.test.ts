import path from "node:path";
import { Command } from "commander";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";

const sdk = vi.hoisted(() => ({
  parseFsConfig: vi.fn(),
  resolveFsConfig: vi.fn(),
  makeFsModule: vi.fn(),
  readFile: vi.fn(),
  runHarnessPair: vi.fn(),
  runWithOptionalWorktree: vi.fn()
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

vi.mock("../../../packages/safe-js/src/modules/fs.js", () => ({
  makeFsModule: sdk.makeFsModule
}));

vi.mock("../../../packages/safe-js/src/modules/fs-config.js", () => ({
  parseFsConfig: sdk.parseFsConfig,
  resolveFsConfig: sdk.resolveFsConfig
}));

vi.mock("@poe-code/safe-fs", () => {
  throw new Error("CLI configuration tests must not load mutable filesystem adapters.");
});

vi.mock("@poe-code/safe-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/safe-js")>()),
  makeLogModule: () => ({})
}));

vi.mock("@poe-code/agent-harness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/agent-harness")>()),
  runHarnessPair: sdk.runHarnessPair
}));

vi.mock("toolcraft-design", async (importOriginal) => ({
  ...(await importOriginal<typeof import("toolcraft-design")>()),
  withSpinner: async <Value>(options: { fn: () => Promise<Value> }) => options.fn()
}));

vi.mock("../../sdk/worktree.js", () => ({
  runWithOptionalWorktree: sdk.runWithOptionalWorktree
}));

vi.mock("../../sdk/spawn.js", () => ({
  spawn: vi.fn(() => {
    throw new Error("Filesystem CLI tests must not spawn an agent.");
  })
}));

vi.mock("../../providers/index.js", () => ({ getDefaultProviders: () => [] }));

const { registerHarnessCommand } = await import("./harness.js");

type HarnessRunOptions = Parameters<typeof import("@poe-code/agent-harness").runHarnessPair>[1];

const adapter = Object.freeze({ identity: "SDK-owned adapter" });
const configPath = "/repo/config/filesystem.json";
const memoryConfig = { adapter: { type: "memory", options: {} } };

function createInvocation() {
  const readFile = vi.fn(fs.promises.readFile);
  const stat = vi.fn(fs.promises.stat);
  const writeFile = vi.fn(fs.promises.writeFile);
  const filesystem = { ...fs.promises, readFile, stat, writeFile };
  const logs: string[] = [];
  const container = createCliContainer({
    fs: filesystem as unknown as FileSystem,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd: "/repo", homeDir: "/home/test" },
    logger: (message) => logs.push(message),
    commandRunner: vi.fn().mockRejectedValue(new Error("Unexpected command execution"))
  });
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (message) => logs.push(message),
    writeErr: (message) => logs.push(message)
  });
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  registerHarnessCommand(program, container);
  return { program, readFile, stat, writeFile, logs };
}

describe("Harness CLI filesystem configuration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vol.reset();
    vol.fromJSON({
      "/repo/nested/harness.md": "---\nkind: test\nversion: 1\n---\n",
      "/repo/nested/harness.ajs": "export default () => true;\n",
      [configPath]: JSON.stringify(memoryConfig)
    });
    sdk.parseFsConfig.mockImplementation(JSON.parse);
    sdk.resolveFsConfig.mockResolvedValue({ adapter });
    sdk.readFile.mockResolvedValue("from configured filesystem");
    sdk.makeFsModule.mockReturnValue({ readFile: sdk.readFile });
    sdk.runWithOptionalWorktree.mockImplementation(async (input) => ({
      value: await input.run({ worktreeCwd: input.worktree === true ? "/worktree" : "/repo" })
    }));
    sdk.runHarnessPair.mockImplementation(async (filepath: string, options: HarnessRunOptions) => {
      const modules = options.modulesFor(
        {},
        {
          kind: "test",
          version: 1,
          filename: filepath,
          dirname: path.dirname(filepath),
          body: ""
        }
      );
      const registry = modules instanceof Map ? modules : new Map(Object.entries(modules));
      const filesystem = registry.get("fs");
      const exports =
        filesystem instanceof Map ? filesystem : new Map(Object.entries(filesystem ?? {}));
      const readFile = exports.get("readFile");
      return {
        ok: true,
        returnValue:
          typeof readFile === "function"
            ? await readFile("marker.txt", "utf8")
            : "no filesystem requested"
      };
    });
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it.each([
    { args: ["--fs"], root: "/repo/nested" },
    { args: ["--fs", "--fs-root", "roots"], root: "/repo/roots" },
    { args: ["--fs", "--fs-root", "/srv/legacy"], root: "/srv/legacy" },
    {
      args: ["--fs", "--fs-root", "roots", "--worktree", "--agent", "test"],
      root: "/worktree/roots"
    }
  ])("preserves legacy host-root wiring for $args", async ({ args, root }) => {
    const invocation = createInvocation();

    await invocation.program.parseAsync([
      "node",
      "cli",
      "harness",
      "run",
      "nested/harness.md",
      ...args
    ]);

    expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith({ root });
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(sdk.parseFsConfig).not.toHaveBeenCalled();
    expect(sdk.readFile).toHaveBeenCalledExactlyOnceWith("marker.txt", "utf8");
    expect(invocation.logs.join("\n")).toContain("from configured filesystem");
  });

  it("does not grant filesystem access just because a config file exists", async () => {
    const invocation = createInvocation();

    await invocation.program.parseAsync(["node", "cli", "harness", "run", "nested/harness.md"]);

    expect(sdk.runHarnessPair).toHaveBeenCalledOnce();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(invocation.readFile).not.toHaveBeenCalled();
  });

  it("previews a configured adapter without constructing it in dry-run mode", async () => {
    const invocation = createInvocation();
    await invocation.program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "harness",
      "run",
      "nested/harness.md",
      "--fs-config",
      configPath
    ]);
    expect(sdk.parseFsConfig).toHaveBeenCalledOnce();
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.runHarnessPair).not.toHaveBeenCalled();
    expect(invocation.logs.join("\n")).toContain('adapter "memory"');
  });

  it("still rejects a legacy root without --fs before host reads", async () => {
    const invocation = createInvocation();

    await expect(
      invocation.program.parseAsync([
        "node",
        "cli",
        "harness",
        "run",
        "nested/harness.md",
        "--fs-root",
        "roots"
      ])
    ).rejects.toThrow("--fs-root requires --fs");
    expect(invocation.readFile).not.toHaveBeenCalled();
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(sdk.runWithOptionalWorktree).not.toHaveBeenCalled();
  });

  it.each([memoryConfig, { adapter: { type: "real", options: { root: "/srv/project" } } }])(
    "resolves $adapter.type through the SDK and exposes its module",
    async (config) => {
      const source = JSON.stringify(config);
      vol.writeFileSync(configPath, source);
      const invocation = createInvocation();

      await invocation.program.parseAsync([
        "node",
        "cli",
        "harness",
        "run",
        "nested/harness.md",
        "--fs-config",
        "config/filesystem.json"
      ]);

      expect(sdk.parseFsConfig).toHaveBeenCalledExactlyOnceWith(source);
      expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(config);
      expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith({ adapter });
      expect(sdk.makeFsModule.mock.calls[0]![0].adapter).toBe(adapter);
      expect(invocation.readFile).toHaveBeenCalledExactlyOnceWith(configPath, "utf8");
      expect(sdk.readFile).toHaveBeenCalledExactlyOnceWith("marker.txt", "utf8");
      expect(invocation.logs.join("\n")).toContain("from configured filesystem");
    }
  );

  it.each([
    { root: "/work" },
    { root: "/work", cwd: "/work/nested" },
    { root: "/work", cwd: "/elsewhere" },
    { cwd: "/elsewhere" }
  ])("preserves SDK virtual paths %j unchanged during worktree mapping", async (paths) => {
    const config = {
      adapter: { type: "real", options: { root: "/repo/data" } },
      ...paths
    };
    const resolved = { adapter, ...paths };
    vol.writeFileSync(configPath, JSON.stringify(config));
    sdk.resolveFsConfig.mockResolvedValue(resolved);
    const invocation = createInvocation();

    await invocation.program.parseAsync([
      "node",
      "cli",
      "harness",
      "run",
      "nested/harness.md",
      "--fs-config",
      configPath,
      "--worktree",
      "--agent",
      "test"
    ]);

    expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(config);
    expect(sdk.makeFsModule).toHaveBeenCalledExactlyOnceWith(resolved);
    expect(sdk.makeFsModule.mock.calls[0]![0]).toBe(resolved);
    expect(sdk.runHarnessPair.mock.calls[0]![0]).toBe("/worktree/nested/harness.md");
    expect(sdk.makeFsModule.mock.calls[0]![0]).not.toHaveProperty("fs");
  });

  it.each(["readonly", "mount", "overlay", "s3", "webdav", "future-adapter"])(
    "passes opaque %s options to the SDK without CLI backend interpretation",
    async (type) => {
      const config = { adapter: { type, options: { sdkOwned: { nested: [1, "value"] } } } };
      vol.writeFileSync(configPath, JSON.stringify(config));
      const invocation = createInvocation();

      await invocation.program.parseAsync([
        "node",
        "cli",
        "harness",
        "run",
        "nested/harness.md",
        "--fs-config",
        configPath
      ]);

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

    await expect(
      invocation.program.parseAsync(["node", "cli", "harness", "run", "nested/harness.md", ...args])
    ).rejects.toThrow("cannot be combined");
    expect(invocation.readFile).not.toHaveBeenCalled();
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(invocation.writeFile).not.toHaveBeenCalled();
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.runWithOptionalWorktree).not.toHaveBeenCalled();
    expect(sdk.runHarnessPair).not.toHaveBeenCalled();
  });

  it("rejects repeated --fs-config before reading either file", async () => {
    const invocation = createInvocation();

    await expect(
      invocation.program.parseAsync([
        "node",
        "cli",
        "harness",
        "run",
        "nested/harness.md",
        "--fs-config",
        configPath,
        "--fs-config",
        "/other.json"
      ])
    ).rejects.toThrow("only once");
    expect(invocation.readFile).not.toHaveBeenCalled();
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(sdk.runHarnessPair).not.toHaveBeenCalled();
  });

  it("reports malformed JSON before snapshot or harness I/O", async () => {
    vol.writeFileSync(configPath, "{");
    const invocation = createInvocation();

    await expect(
      invocation.program.parseAsync([
        "node",
        "cli",
        "harness",
        "run",
        "nested/harness.md",
        "--fs-config",
        configPath
      ])
    ).rejects.toThrow();
    expect(sdk.parseFsConfig).toHaveBeenCalledExactlyOnceWith("{");
    expect(invocation.readFile).toHaveBeenCalledExactlyOnceWith(configPath, "utf8");
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(sdk.resolveFsConfig).not.toHaveBeenCalled();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.runWithOptionalWorktree).not.toHaveBeenCalled();
    expect(sdk.runHarnessPair).not.toHaveBeenCalled();
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

    await expect(
      invocation.program.parseAsync([
        "node",
        "cli",
        "harness",
        "run",
        "nested/harness.md",
        "--fs-config",
        configPath
      ])
    ).rejects.toThrow(message);
    expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(config);
    expect(invocation.readFile).toHaveBeenCalledExactlyOnceWith(configPath, "utf8");
    expect(invocation.stat).not.toHaveBeenCalled();
    expect(invocation.writeFile).not.toHaveBeenCalled();
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.runWithOptionalWorktree).not.toHaveBeenCalled();
    expect(sdk.runHarnessPair).not.toHaveBeenCalled();
  });

  it("reports asynchronous adapter construction failure without falling back to host fs", async () => {
    const failure = Object.assign(new Error("Configured filesystem cannot be opened"), {
      code: "EACCES"
    });
    sdk.resolveFsConfig.mockRejectedValue(failure);
    const invocation = createInvocation();

    await expect(
      invocation.program.parseAsync([
        "node",
        "cli",
        "harness",
        "run",
        "nested/harness.md",
        "--fs-config",
        configPath
      ])
    ).rejects.toBe(failure);
    expect(sdk.resolveFsConfig).toHaveBeenCalledExactlyOnceWith(memoryConfig);
    expect(sdk.makeFsModule).not.toHaveBeenCalled();
    expect(sdk.readFile).not.toHaveBeenCalled();
    expect(sdk.runHarnessPair).not.toHaveBeenCalled();
  });
});
