import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { readFile } from "node:fs/promises";
import { Volume } from "memfs";
import { build, type BuildResult } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { rewriteModuleSpecifiers } from "./package-safe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Build and rewrite once per test-file run; consumer builds and VMs stay separate.
let portableBuild: BuildResult;
const artifacts = new Volume();

it("exposes the complete default shell under browser conditions without Node builtins", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  expect(manifest.exports["./browser"]).toBeUndefined();
  expect(manifest.exports["./portable"]).toBeUndefined();
  expect(manifest.exports["."].browser).toBe("./dist/core.browser.js");
  expect(manifest.exports["."].types.browser).toBe("./dist/core.d.ts");
  const result = portableBuild;
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.filter(item => item.external).map(item => item.path))]).toEqual(["poe-code/safe-fs/core"]);
  expect(result.outputFiles!.some(output => output.path.endsWith("/core.browser.js"))).toBe(true);
});

async function bundlePublicConsumer(contents: string) {
  const directory = path.join(root, "packages/safe-bash");
  const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  const consumer = await build({
    stdin: { contents, resolveDir: root },
    bundle: true, write: false, platform: "browser", conditions: ["workerd", "worker", "browser"], format: "cjs", target: "es2022",
    external: ["@poe-platform/safe-fs/core"],
    plugins: [{
      name: "public-built-shell-entries",
      setup(builder) {
        builder.onResolve({ filter: /^@poe-platform\/safe-bash(?:\/commands\/(?:xml|yq|network|csplit))?$/ }, args => ({
          path: path.resolve(directory, manifest.exports[args.path === "@poe-platform/safe-bash" ? "." : `.${args.path.slice("@poe-platform/safe-bash".length)}`].browser),
          namespace: "built-shell",
        }));
        builder.onResolve({ filter: /^\./, namespace: "built-shell" }, args => ({
          path: path.resolve(path.dirname(args.importer), args.path), namespace: "built-shell",
        }));
        builder.onLoad({ filter: /.*/, namespace: "built-shell" }, args => ({
          contents: artifacts.readFileSync(args.path, "utf8").toString(), loader: "js",
        }));
      },
    }],
  });
  return consumer.outputFiles![0]!.text;
}

it.each([["xml", "createXmlCommands"], ["yq", "createYqCommands"], ["network", "createNetworkCommands"], ["csplit", "createCsplitCommands"]])("shares the public %s command factory across portable root and subpath entries", async (command, factory) => {
  const manifest = JSON.parse(await readFile(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  expect(manifest.exports[`./commands/${command}`]?.browser).toBe(`./dist/commands/${command}/index.browser.js`);
  expect(manifest.exports[`./commands/${command}`]?.workerd).toBe(`./dist/commands/${command}/index.browser.js`);
  const compiled = await bundlePublicConsumer(`
    import { ${factory} as fromRoot } from "@poe-platform/safe-bash";
    import { ${factory} as fromSubpath } from "@poe-platform/safe-bash/commands/${command}";
    export const shared = fromRoot === fromSubpath;
  `);
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
    require(name: string) {
      if (name !== "@poe-platform/safe-fs/core") throw new Error(name);
      return filesystem;
    },
  });
  const consumer = runInContext(`(function(){ const module = { exports: {} }; ${compiled}; return module.exports; })()`, sandbox);
  expect(consumer.shared).toBe(true);
});

it("runs nested env/xargs, truncate and csplit through the public default browser entry", async () => {
  const consumer = await bundlePublicConsumer(await readFile(path.join(root, "scripts/fixtures/safe-packages-mixed-entry-runtime.mjs"), "utf8"));
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
    require(name: string) {
      if (name !== "@poe-platform/safe-fs/core") throw new Error(name);
      return filesystem;
    },
  });
  const publicConsumer = runInContext(`(function(){ const module = { exports: {} }; ${consumer}; return module.exports; })()`, sandbox);
  for (const options of [{}, { regexExecutor: publicConsumer.defaultEntry.createBoundedRegexProvider() }]) {
    const { results, failures } = await publicConsumer.runNestedCommands(publicConsumer.defaultEntry, options);
    for (const result of results) {
      expect(result, `${result.script}; internal errors: ${failures.join(", ")}`).toMatchObject({
        exitCode: 0, stdout: "2\n", stderr: "",
      });
    }
    expect(failures).toEqual([]);
  }
  const entry = publicConsumer.defaultEntry;
  expect(entry.MemoryFileSystem).toBe(filesystem.MemoryFileSystem);
  await publicConsumer.verifyTruncateCommands(entry);
  await publicConsumer.verifyCsplitCommands(entry);
  const argumentsFromBrowser = entry.createCommandArguments(["nested"]);
  expect(entry.getCommandArguments({ args: argumentsFromBrowser.args, argumentValues: argumentsFromBrowser })).toBe(argumentsFromBrowser);
  expect(() => entry.getCommandArguments({ args: argumentsFromBrowser.args, argumentValues: { ...argumentsFromBrowser } })).toThrow("Expected owned command arguments");
  expect(() => entry.getCommandArguments({ args: [...argumentsFromBrowser.args], argumentValues: argumentsFromBrowser })).toThrow(entry.CommandArgumentIdentityError);
  const bytesFromBrowser = argumentsFromBrowser.withValues([new Uint8Array([255, 0])]);
  expect(Array.from(entry.createCommandArguments(bytesFromBrowser.values).bytes(0))).toEqual([255, 0]);
});

it("builds the portable shell without Node workers, adapters, or duplicate filesystem identity", async () => {
  const result = portableBuild;
  const outputs = result.metafile!.outputs;
  const pending = Object.keys(outputs).filter(filename => filename.endsWith("/core.browser.js"));
  const reachable = new Set<string>();
  while (pending.length) {
    const filename = pending.pop()!;
    if (reachable.has(filename)) continue;
    reachable.add(filename);
    for (const imported of outputs[filename]!.imports) {
      if (!imported.external) pending.push(imported.path);
    }
  }
  const inputs = [...new Set([...reachable].flatMap(filename => Object.keys(outputs[filename]!.inputs)))];
  expect(inputs.some(input => input.includes("shell/shell.ts"))).toBe(true);
  expect(inputs.some(input => input.includes("commands/filesystem.ts"))).toBe(true);
  expect(inputs.some(input => input.includes("fs/real/") || input.includes("transport/owner.ts"))).toBe(false);
  expect(inputs.some(input => input.includes("safe-fs/src"))).toBe(false);
  const imports = [...reachable].flatMap(filename => outputs[filename]!.imports);
  expect([...new Set(imports.filter(item => item.external).map(item => item.path))]).toEqual(["poe-code/safe-fs/core"]);
  expect(result.outputFiles!.some(output => output.path.endsWith("core.browser.js"))).toBe(true);
});

it("bundles the complete portable preset with one owned-argument identity", async () => {
  const options = resolveBrowserShellBuild(root);
  expect(options.entryPoints).toEqual({
    "core.browser": path.join(root, "packages/safe-bash/src/core.browser.ts"),
    "commands/xml/index.browser": path.join(root, "packages/safe-bash/src/commands/xml/index.ts"),
    "commands/yq/index.browser": path.join(root, "packages/safe-bash/src/commands/yq/index.ts"),
    "commands/network/index.browser": path.join(root, "packages/safe-bash/src/commands/network/public.ts"),
    "commands/csplit/index.browser": path.join(root, "packages/safe-bash/src/commands/csplit/index.ts"),
  });
  const result = portableBuild;
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  for (const imported of imports.filter(item => item.external)) {
    expect(imported.path).toBe("poe-code/safe-fs/core");
  }
  const compiled = await bundlePublicConsumer('export * from "@poe-platform/safe-bash";');
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
    require(name: string) {
      if (name !== "@poe-platform/safe-fs/core") throw new Error(name);
      return filesystem;
    },
  });
  const portable = runInContext(`(function(){ const module = { exports: {} }; ${compiled}; return module.exports; })()`, sandbox) as BrowserShell;
  expect(portable.posixPath).toBe(filesystem.posixPath);
  expect(portable.posixPath.join("/a", "..", "b")).toBe("/b");
  const names = portable.createAgentCommands().map(command => command.name).sort();
  expect(names).toHaveLength(101);
  expect(names).toEqual([
    "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
    "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
    "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
    "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha512sum", "sha384sum", "sha256sum", "sha224sum", "sha1sum",
    "md5sum", "cksum", "gzip", "gunzip", "zcat", "bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "zstd", "unzstd", "zstdcat", "cmp", "fmt", "shuf", "numfmt", "diff", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "zip", "unzip",
    "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
    "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint", "csplit",
  ].sort());
  const commands = new portable.CommandRegistry();
  const plugin = portable.agentCommands({ regexExecutor: portable.createBoundedRegexProvider() });
  try {
    await plugin.setup({ commands, use() {}, registerFileSystem() {} });
    expect(commands.list().map(command => command.name).sort()).toEqual(names);
  } finally { await plugin.dispose?.(); }
  const fs = new filesystem.MemoryFileSystem();
  const shell = new portable.Shell({ fs }).use(
    portable.agentCommands(),
  );
  try {
    for (const script of ["env jq -nc '1+1'", "printf '\"1+1\"' | xargs jq -nc"]) {
      const result = await shell.exec(script);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe("2\n");
      expect(result.stderr).toBe("");
    }
    for (const [script, expected] of [
      ["printf abc | sha256sum", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\u0020\u0020-\n"],
      ["printf abc | gzip | zcat", "abc"],
      ["printf abc > /note; tar -czf /notes.tgz note; rm /note; tar -xzf /notes.tgz; cat /note", "abc"],
      ["timeout 1 true", ""],
      ["expr abc : 'a.*'", "3\n"],
    ]) {
      const result = await shell.exec(script!);
      expect(result, script).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    }
    const temporary = await shell.exec("mktemp /temporary.XXXXXX");
    expect(temporary).toMatchObject({ exitCode: 0, stderr: "" });
    expect(temporary.stdout).toMatch(/^\/temporary\.[A-Za-z0-9]{6}\n$/u);
    expect((await fs.stat(temporary.stdout.trim())).mode & 0o777).toBe(0o600);
  } finally { await shell.dispose(); }
});

type BrowserShell = typeof import("../packages/safe-bash/src/core.js");
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
  portableBuild = await build(resolveBrowserShellBuild(root));
  for (const output of portableBuild.outputFiles!.filter(output => output.path.endsWith(".js"))) {
    artifacts.mkdirSync(path.dirname(output.path), { recursive: true });
    artifacts.writeFileSync(output.path, rewriteModuleSpecifiers(output.path, output.text, specifier =>
      specifier === "poe-code/safe-fs/core" ? "@poe-platform/safe-fs/core" : specifier));
  }
  const compiled = await bundlePublicConsumer('export * from "@poe-platform/safe-bash";');
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
  });
  filesystem = runInContext(`(function(){ const module = { exports: {} }; ${producer.outputFiles![0]!.text}; return module.exports; })()`, sandbox) as CoreFs;
  sandbox.canonical = filesystem;
  browser = runInContext(`(function(){ const module = { exports: {} }; const require = name => { if (name !== "@poe-platform/safe-fs/core") throw new Error(name); return canonical; }; ${compiled}; return module.exports; })()`, sandbox) as BrowserShell;
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
  const shell = new browser.Shell({ fs }).use(browser.agentCommands());
  try {
    expect(browser.createAgentCommands().map(command => command.name).sort()).toEqual(expect.arrayContaining([
      "[", "basename", "cat", "cp", "cut", "dirname", "echo", "false", "head", "ln", "ls", "mkdir", "mv", "printf",
      "pwd", "readlink", "realpath", "rm", "rmdir", "sort", "tail", "tee", "test", "touch", "tr", "true", "uniq", "wc",
    ]));
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
      .use(browser.agentCommands()).use(browser.agentCommands({ replace }));
    try {
      if (replace) expect((await shell.exec("echo replaced")).stdout).toBe("replaced\n");
      else await expect(shell.exec("echo replaced")).rejects.toThrow("Command already registered");
    } finally { await shell.dispose(); }
  }
});

it("enforces command and output budgets in the portable runtime", async () => {
  for (const limits of [{ maxCommands: 1 }, { maxOutputBytes: 2 }]) {
    const shell = new browser.Shell({ fs: new filesystem.MemoryFileSystem(), limits }).use(browser.agentCommands());
    try { await expect(shell.exec("echo first; echo second")).rejects.toBeInstanceOf(browser.ShellLimitError); }
    finally { await shell.dispose(); }
  }
  const looping = new browser.Shell({ fs: new filesystem.MemoryFileSystem(), limits: { maxLoopIterations: 300 } });
  try { await expect(looping.exec("while :; do :; done")).rejects.toBeInstanceOf(browser.ShellLimitError); }
  finally { await looping.dispose(); }
});

it("enforces structural parse admission in the portable runtime", async () => {
  expect(browser.cloudflareWorkerLimits.maxParseUnits).toBe(65_536);
  expect(() => browser.parseShell(":", 0, { maxParseUnits: 0 })).toThrow(browser.ShellLimitError);
  expect(browser.parseShell(":", 0)).toEqual(browser.parseShell(":"));
  const shell = new browser.Shell({ fs: new filesystem.MemoryFileSystem(), limits: { maxParseUnits: 32 } });
  try {
    await expect(shell.exec(`: ${"w ".repeat(32)}`)).rejects.toMatchObject({ name: "ShellLimitError", limit: "maxParseUnits" });
    expect((await shell.exec(":")).exitCode).toBe(0);
  } finally { await shell.dispose(); }
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

it("portable network factories require transport injection and preserve HTTP header validation", async () => {
  const compiled = await bundlePublicConsumer(`
    import { createNetworkCommands, createMemoryFileSystem, toByteSource } from "@poe-platform/safe-bash";
    export async function probe() {
      let refused = false;
      try { createNetworkCommands({ authorize: () => true }); } catch { refused = true; }
      const fs = createMemoryFileSystem();
      const requests = [];
      const commands = createNetworkCommands({ authorize: () => true, transport: async request => {
        requests.push(request);
        return { status: 200, statusText: "OK", headers: [], body: toByteSource("ok"), async dispose() {} };
      } });
      const output = [];
      const context = { command: "curl", args: ["-H", "X-Test: allowed", "https://example.test/file"], fs, cwd: "/", env: {},
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: { async write(bytes) { output.push(...bytes); } }, stderr: { async write() {} } };
      const valid = await commands[0].execute(context);
      const invalid = await commands[0].execute({ ...context, args: ["-H", "Bad Name: nope", "https://example.test/file"] });
      const value = await commands[0].execute({ ...context, args: ["-H", "X-Test: bad\\u0001", "https://example.test/file"] });
      const multipart = await commands[0].execute({ ...context, args: ["-F", "field=value", "https://example.test/file"] });
      return { refused, valid: valid.exitCode, invalid: invalid.exitCode, value: value.exitCode, multipart: multipart.exitCode, requests: requests.length, output };
    }
  `);
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance, URL,
    require(name: string) { if (name !== "@poe-platform/safe-fs/core") throw new Error(name); return filesystem; },
  });
  const consumer = runInContext(`(function(){ const module = { exports: {} }; ${compiled}; return module.exports; })()`, sandbox);
  expect(await consumer.probe()).toEqual({ refused: true, valid: 0, invalid: 2, value: 2, multipart: 0, requests: 2, output: [111, 107, 111, 107] });
});
