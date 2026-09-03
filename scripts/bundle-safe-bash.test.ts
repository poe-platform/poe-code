import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build, transform } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

it("builds the portable shell without Node workers, adapters, or duplicate filesystem identity", async () => {
  const options = resolveBrowserShellBuild(root);
  const result = await build(options);
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(input => input.includes("shell/shell.ts"))).toBe(true);
  expect(inputs.some(input => input.includes("commands/filesystem.ts"))).toBe(true);
  expect(inputs.some(input => input.includes("fs/real/") || input.includes("transport/owner.ts"))).toBe(false);
  expect(inputs.some(input => input.includes("safe-fs/src"))).toBe(false);
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.filter(item => item.external).map(item => item.path))]).toEqual(["poe-code/safe-fs/core"]);
  expect(result.outputFiles!.some(output => output.path.endsWith("browser.js"))).toBe(true);
});

type BrowserShell = typeof import("../packages/safe-bash/src/browser.js");
type CoreFs = typeof import("../packages/safe-fs/src/core.js");
let browser: BrowserShell;
let filesystem: CoreFs;

beforeAll(async () => {
  const producer = await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, "packages/safe-fs/src/core.ts")],
    bundle: true, write: false, platform: "browser", conditions: ["workerd", "worker", "browser"],
    format: "cjs", target: "es2022",
  });
  const consumer = await build(resolveBrowserShellBuild(root));
  const compiled = await transform(consumer.outputFiles!.find(output => output.path.endsWith("browser.js"))!.text, { format: "cjs" });
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto,
  });
  filesystem = runInContext(`(function(){ const module = { exports: {} }; ${producer.outputFiles![0]!.text}; return module.exports; })()`, sandbox) as CoreFs;
  sandbox.canonical = filesystem;
  browser = runInContext(`(function(){ const module = { exports: {} }; const require = name => { if (name !== "poe-code/safe-fs/core") throw new Error(name); return canonical; }; ${compiled.code}; return module.exports; })()`, sandbox) as BrowserShell;
  expect(runInContext("typeof Buffer + ':' + typeof process + ':' + typeof setImmediate", sandbox)).toBe("undefined:undefined:undefined");
});

it("runs filesystem pipelines with canonical identity and injected mounts", async () => {
  expect(browser.FsError).toBe(filesystem.FsError);
  expect(browser.MemoryFileSystem).toBe(filesystem.MemoryFileSystem);
  const source = new filesystem.MemoryFileSystem();
  const memory = new filesystem.MemoryFileSystem();
  await source.writeFile("/note", new TextEncoder().encode("hello\n"));
  const fs = filesystem.createMountFileSystem({ root: new filesystem.MemoryFileSystem(), mounts: {
    "/input": filesystem.createReadOnlyFileSystem(source), "/memory": memory,
  } });
  const shell = new browser.Shell({ fs }).use(browser.browserCommands());
  try {
    expect(browser.createBrowserCommands().map(command => command.name).sort()).toEqual([
      "[", "basename", "cat", "cp", "cut", "dirname", "echo", "false", "head", "ln", "ls", "mkdir", "mv", "printf",
      "pwd", "readlink", "realpath", "rm", "rmdir", "sort", "tail", "tee", "test", "touch", "tr", "true", "uniq", "wc",
    ]);
    expect((await shell.exec("cat /input/note | tr a-z A-Z")).stdout).toBe("HELLO\n");
    expect((await shell.exec("printf saved > /memory/state; cat /memory/state")).stdout).toBe("saved");
    expect(Array.from((await shell.exec("printf '\\377\\000'")).stdoutBytes)).toEqual([255, 0]);
    await fs.writeFile("/run.sh", new TextEncoder().encode("cat /memory/state"));
    expect((await shell.exec("sh /run.sh")).stdout).toBe("saved");
    expect((await shell.exec("printf forbidden > /input/note")).exitCode).not.toBe(0);
    const matched = await shell.exec("[[ abc123 =~ ^([a-z]+)([0-9]+)$ ]] && printf '%s:%s' \"${BASH_REMATCH[1]}\" \"${BASH_REMATCH[2]}\"");
    expect(matched.exitCode).toBe(0);
    expect(matched.stdout).toBe("abc:123");
    expect(matched.stderr).toBe("");
  } finally { await shell.dispose(); }
  await expect(shell.exec("echo closed")).rejects.toThrow();
});

it("rejects duplicate portable registration unless replacement is explicit", async () => {
  for (const replace of [false, true]) {
    const shell = new browser.Shell({ fs: new filesystem.MemoryFileSystem() })
      .use(browser.browserCommands()).use(browser.browserCommands({ replace }));
    try {
      if (replace) expect((await shell.exec("echo replaced")).stdout).toBe("replaced\n");
      else await expect(shell.exec("echo replaced")).rejects.toThrow("Command already registered");
    } finally { await shell.dispose(); }
  }
});

it("enforces command and output budgets in the portable runtime", async () => {
  for (const limits of [{ maxCommands: 1 }, { maxOutputBytes: 2 }]) {
    const shell = new browser.Shell({ fs: new filesystem.MemoryFileSystem(), limits }).use(browser.browserCommands());
    try { await expect(shell.exec("echo first; echo second")).rejects.toBeInstanceOf(browser.ShellLimitError); }
    finally { await shell.dispose(); }
  }
  const looping = new browser.Shell({ fs: new filesystem.MemoryFileSystem(), limits: { maxLoopIterations: 300 } });
  try { await expect(looping.exec("while :; do :; done")).rejects.toBeInstanceOf(browser.ShellLimitError); }
  finally { await looping.dispose(); }
});

it("cancels active custom commands and disposes the shell", async () => {
  const controller = new AbortController();
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const shell = new browser.Shell({ fs: new filesystem.MemoryFileSystem() }).use({
    name: "wait-for-cancellation",
    setup(host) {
      host.commands.register({ name: "wait", execute(context) {
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
          start();
        });
      } });
    },
  });
  const stopped = new Error("stop browser execution");
  const running = shell.exec("wait", { signal: controller.signal });
  const rejected = expect(running).rejects.toBe(stopped);
  await started;
  controller.abort(stopped);
  await rejected;
  await shell.dispose();
});
