import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createMountFileSystem, FsError, type FileSystem } from "../../src/index.js";
import { run } from "./helpers.js";
import { evaluateCommandSupport } from "../../src/contracts/command-requirements.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";

function inject(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target;
    const value = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

test("mv declares its atomic no-replace requirement for capability inspection", () => {
  const command = filesystemCommands().find(command => command.name === "mv")!;
  for (const [capability, expected] of [[true, "supported"], [false, "unsupported"], [undefined, "unknown"]] as const) {
    const capabilities: FileSystem["capabilities"] = { stat: true, rename: true, ...(capability === undefined ? {} : { atomicRenameNoReplace: capability }) };
    const support = evaluateCommandSupport(command, capabilities);
    assert.equal(support.modes.find(mode => mode.id === "no-replace")?.status, expected);
  }
});

test("public mv -n preserves a destination published after its final stat", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/source", Buffer.from("source"));
  const injected = inject(fs, {
    capabilities: { ...fs.capabilities, atomicRenameNoReplace: true },
    rename: async (source, target, options) => {
      await fs.writeFile(target, Buffer.from("concurrent destination"));
      await fs.rename(source, target, options);
    },
  });
  const shell = new Shell({ fs: injected }).use(agentCommands());
  try {
    const result = await shell.exec("mv -nv /source /target");
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await fs.readFile("/target")).toString(), "concurrent destination");
    assert.equal(Buffer.from(await fs.readFile("/source")).toString(), "source");
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

for (const capability of [undefined, false]) test(`mv -n refuses unguaranteed rename: ${capability}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/source", Buffer.from("source"));
  let renames = 0;
  const { atomicRenameNoReplace: omitted, ...otherCapabilities } = fs.capabilities;
  void omitted;
  const capabilities: FileSystem["capabilities"] = {
    ...otherCapabilities, ...(capability === false ? { atomicRenameNoReplace: false } : {}),
  };
  const injected = inject(fs, { capabilities, rename: async () => { renames++; } });
  const result = await run("mv", ["-n", "/source", "/target"], { fs: injected });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  assert.equal(renames, 0);
  assert.equal(Buffer.from(await fs.readFile("/source")).toString(), "source");
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("mv -n propagates intent and signal and refuses cross-device fallback", async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController();
  await fs.writeFile("/source", Buffer.from("source"));
  let copies = 0;
  let received: Parameters<FileSystem["rename"]>[2];
  const injected = inject(fs, {
    capabilities: { ...fs.capabilities, atomicRenameNoReplace: true },
    rename: async (_source, _target, options) => {
      received = options;
      throw new FsError("EXDEV");
    },
    copyFile: async () => { copies++; },
  });
  const result = await run("mv", ["-n", "/source", "/target"], { fs: injected, signal: controller.signal });
  assert.equal(result.exitCode, 1);
  assert.equal(received?.noReplace, true);
  assert.equal(received?.signal, controller.signal);
  assert.equal(copies, 0);
  assert.equal(Buffer.from(await fs.readFile("/source")).toString(), "source");
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("mv -n does not swallow EEXIST-shaped cancellation", async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reason = new FsError("EEXIST");
  await fs.writeFile("/source", Buffer.from("source"));
  const injected = inject(fs, {
    capabilities: { ...fs.capabilities, atomicRenameNoReplace: true },
    rename: async () => { controller.abort(reason); throw reason; },
  });
  await assert.rejects(run("mv", ["-n", "/source", "/target"], { fs: injected, signal: controller.signal }), error => error === reason);
  assert.equal(Buffer.from(await fs.readFile("/source")).toString(), "source");
});

test("mv -n admits the selected mount and moves to an absent destination", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/source", Buffer.from("source"));
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": base } });
  const result = await run("mv", ["-n", "/data/source", "/data/target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await base.readFile("/target")).toString(), "source");
  await assert.rejects(base.stat("/source"), { code: "ENOENT" });
});

test("mv -n rechecks admission when an existing preflight destination disappears", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/source", Buffer.from("source"));
  await base.writeFile("/target", Buffer.from("target"));
  let renames = 0;
  const fs = inject(base, {
    capabilities: { ...base.capabilities, atomicRenameNoReplace: false },
    lstat: async (path, options) => {
      const stat = await base.lstat(path, options);
      if (path === "/target") await base.rm(path);
      return stat;
    },
    rename: async () => { renames++; },
  });
  const result = await run("mv", ["-n", "/source", "/target"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  assert.equal(renames, 0);
  assert.equal(Buffer.from(await base.readFile("/source")).toString(), "source");
});

test("mv -n honors path-specific refusal despite affirmative global capabilities", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/source", Buffer.from("source"));
  let renames = 0;
  const fs = inject(base, {
    capabilities: { ...base.capabilities, atomicRenameNoReplace: true },
    capabilitiesFor: async () => ({ ...base.capabilities, atomicRenameNoReplace: false }),
    rename: async () => { renames++; },
  });
  const result = await run("mv", ["-n", "/source", "/target"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  assert.equal(renames, 0);
  assert.equal(Buffer.from(await base.readFile("/source")).toString(), "source");
});
