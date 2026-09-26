import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { readFile } from "node:fs/promises";
import { createFsFromVolume, Volume } from "memfs";
import { build, type BuildResult } from "esbuild";
import { beforeAll, expect, it } from "vitest";
import { resolveBrowserOpBuild, resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { publishBundleOutputs } from "./publish-bundle.mjs";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Build shared artifacts once per test-file run; each probe gets a fresh VM.
let portableBuild: BuildResult;
let filesystemBuild: BuildResult;
let browserFixtureBuild: BuildResult;
const artifacts = new Volume();

it("publishes the op entry and live compression chunks in one browser output graph", async () => {
  const options = resolveBrowserShellBuild(root);
  const volume = Volume.fromJSON({ [path.join(options.outdir, "chunks/stale.js")]: "old" });
  await publishBundleOutputs(portableBuild, {
    outdir: options.outdir, entryPoints: Object.values(options.entryPoints), workingDirectory: root,
  }, createFsFromVolume(volume).promises);
  expect(volume.existsSync(path.join(options.outdir, "commands/op/index.browser.js"))).toBe(true);
  expect(volume.existsSync(path.join(options.outdir, "chunks/stale.js"))).toBe(false);
  const imports = Object.values(portableBuild.metafile!.outputs).flatMap(output => output.imports).filter(item => !item.external);
  expect(imports.some(item => path.basename(item.path).startsWith("zstd-"))).toBe(true);
  for (const item of imports) expect(volume.existsSync(path.resolve(root, item.path)), item.path).toBe(true);
});

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
        builder.onResolve({ filter: /^poe-code\/safe-fs\/core$/ }, () => ({ path: "@poe-platform/safe-fs/core", external: true }));
        builder.onResolve({ filter: /^@poe-platform\/safe-bash(?:\/commands\/(?:xml|yq|network|node|csplit|pr|tsort|factor|getopt|hexdump|iconv|line-endings|llm(?:\/providers)?))?$/ }, args => ({
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

let browserProbeBundle: string;

function createBrowserProbes(): typeof import("./fixtures/safe-packages-browser-probes.mjs") {
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
    URL, FormData, Blob, Response, btoa, atob,
    require(name: string) {
      if (name !== "@poe-platform/safe-fs/core") throw new Error(name);
      return filesystem;
    },
  });
  return runInContext(`(function(){ const module = { exports: {} }; ${browserProbeBundle}; return module.exports; })()`, sandbox);
}

const commandFactories = [["node", "nodeCommands"], ["node", "createNodeCommands"], ["node", "createNodeCommand"], ["xml", "createXmlCommands"], ["yq", "createYqCommands"], ["network", "createNetworkCommands"], ["llm", "createLlmCommands"], ["llm", "llmCommands"], ["llm", "createOpenAiProvider"], ["llm", "createElevenLabsProvider"], ["csplit", "createCsplitCommands"], ["pr", "createPrCommands"], ["tsort", "createTsortCommands"], ["factor", "createFactorCommands"], ["getopt", "createGetoptCommands"], ["hexdump", "createHexdumpCommands"], ["iconv", "createIconvCommands"], ["line-endings", "createDos2unixCommand"], ["line-endings", "createUnix2dosCommand"], ["line-endings", "createLineEndingCommands"], ["line-endings", "lineEndingCommands"]];
let factoryIdentity: boolean[];

it.each(commandFactories.map(([command, factory], index) => [command, factory, index] as const))("shares the public %s command factory across portable root and subpath entries", async (command, _factory, index) => {
  const manifest = JSON.parse(await readFile(path.join(root, "packages/safe-bash/package.json"), "utf8"));
  expect(manifest.exports[`./commands/${command}`]?.browser).toBe(`./dist/commands/${command}/index.browser.js`);
  expect(manifest.exports[`./commands/${command}`]?.workerd).toBe(`./dist/commands/${command}/index.browser.js`);
  expect(factoryIdentity[index]).toBe(true);
});

it.each(["nodeCommands", "safeJsCommands"])("registers only sandboxed node through the portable %s API", async factory => {
  const result = await createBrowserProbes().runNode(factory);
  expect(result.shared).toBe(true);
  expect(result.names).toEqual(["node"]);
  expect(result.result).toMatchObject({ exitCode: 0, stdout: "3\n", stderr: "" });
  expect(result.missing).toMatchObject({ exitCode: 127, stdout: "" });
  expect(result.sources).toEqual([expect.stringContaining("console.log((\n1 + 2\n));")]);
  expect(result.imports).toEqual([{ names: expect.arrayContaining(["fs/promises", "node:fs/promises"]), aliases: true }]);
});

it("runs injected llm providers and binary pipelines through the browser command subpath", async () => {
  const { result, requests } = await createBrowserProbes().runInjectedLlm();
  expect(result).toMatchObject({ exitCode: 0, stdout: "/wCA\n", stderr: "" });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ model: "describe", prompt: "caption", attachments: [{ mimeType: "image/png" }] });
  expect(requests[1]).toMatchObject({ model: "voice", prompt: "a fox\n" });
});

it("runs both reference llm transports without Node globals in a browser consumer", async () => {
  const result = await createBrowserProbes().runReferenceLlm();
  expect(result.audio).toMatchObject({ exitCode: 0, stdout: "/wCA\n", stderr: "" });
  expect(result.image).toMatchObject({ exitCode: 0, stdout: "iVBORw==\n", stderr: "" });
  expect(result.requests).toEqual([
    "https://api.openai.com/v1/chat/completions",
    "https://api.elevenlabs.io/v1/text-to-speech/speaker?output_format=mp3_44100_128",
    "https://api.openai.com/v1/images/edits",
  ]);
  expect(result.disposed).toBe(3);
  expect(result.temperature).toBe(0.7);
});

let mixedConsumer: typeof import("./fixtures/safe-packages-mixed-entry-runtime.mjs");


it("runs nested env/xargs through the public default browser entry", async () => {
  const publicConsumer = mixedConsumer;
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
  const argumentsFromBrowser = entry.createCommandArguments(["nested"]);
  expect(entry.getCommandArguments({ args: argumentsFromBrowser.args, argumentValues: argumentsFromBrowser })).toBe(argumentsFromBrowser);
  expect(() => entry.getCommandArguments({ args: argumentsFromBrowser.args, argumentValues: { ...argumentsFromBrowser } })).toThrow("Expected owned command arguments");
  expect(() => entry.getCommandArguments({ args: [...argumentsFromBrowser.args], argumentValues: argumentsFromBrowser })).toThrow(entry.CommandArgumentIdentityError);
  const bytesFromBrowser = argumentsFromBrowser.withValues([new Uint8Array([255, 0])]);
  expect(Array.from(entry.createCommandArguments(bytesFromBrowser.values).bytes(0))).toEqual([255, 0]);
});

it.each(["verifyTruncateCommands", "verifyCsplitCommands", "verifyPrCommands", "verifyTsortCommands", "verifyFactorCommands", "verifyGetoptCommands", "verifyHexdumpCommands"] as const)("executes %s through the public default browser entry", async verify => {
  await mixedConsumer[verify](mixedConsumer.defaultEntry);
});

it("bundles the opt-in op plugin with browser crypto and no Node implementation", async () => {
  const result = await build(resolveBrowserOpBuild(root));
  expect(result.outputFiles!.some(output => output.path.endsWith("/commands/op/index.browser.js"))).toBe(true);
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs).toContain("packages/safe-bash-command-op/src/crypto.ts");
  expect(inputs.some(input => input.endsWith("crypto-node.ts") || input.endsWith("node-host.ts"))).toBe(false);
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  expect([...new Set(imports.filter(item => item.external).map(item => item.path))]).toEqual(["poe-code/safe-fs/core"]);
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
    "commands/media/index.browser": path.join(root, "packages/safe-bash/src/commands/media/index.ts"),
    "commands/docx/index.browser": path.join(root, "packages/safe-bash/src/commands/docx/index.ts"),
    "commands/python/index.browser": path.join(root, "packages/safe-bash/src/commands/python/index.ts"),
    "commands/python/worker.browser": path.join(root, "packages/safe-bash/src/commands/python/worker.ts"),
    "commands/op/index.browser": path.join(root, "packages/safe-bash/src/commands/op/index.ts"),
    "commands/llm/index.browser": path.join(root, "packages/safe-bash/src/commands/llm/index.ts"),
    "commands/llm/providers/index.browser": path.join(root, "packages/safe-bash/src/commands/llm/providers/index.ts"),
    "core.browser": path.join(root, "packages/safe-bash/src/core.browser.ts"),
    "commands/xml/index.browser": path.join(root, "packages/safe-bash/src/commands/xml/index.ts"),
    "commands/yq/index.browser": path.join(root, "packages/safe-bash/src/commands/yq/index.ts"),
    "commands/network/index.browser": path.join(root, "packages/safe-bash/src/commands/network/public.ts"),
    "commands/node/index.browser": path.join(root, "packages/safe-bash/src/commands/node/browser.ts"),
    "commands/csplit/index.browser": path.join(root, "packages/safe-bash/src/commands/csplit/index.ts"),
    "commands/pr/index.browser": path.join(root, "packages/safe-bash/src/commands/pr/index.ts"),
    "commands/tsort/index.browser": path.join(root, "packages/safe-bash/src/commands/tsort/index.ts"),
    "commands/factor/index.browser": path.join(root, "packages/safe-bash/src/commands/factor/index.ts"),
    "commands/getopt/index.browser": path.join(root, "packages/safe-bash/src/commands/getopt/index.ts"),
    "commands/hexdump/index.browser": path.join(root, "packages/safe-bash/src/commands/hexdump/index.ts"),
    "commands/iconv/index.browser": path.join(root, "packages/safe-bash/src/commands/iconv/index.ts"),
    "commands/line-endings/index.browser": path.join(root, "packages/safe-bash/src/commands/line-endings/index.ts"),
  });
  const result = portableBuild;
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  for (const imported of imports.filter(item => item.external)) {
    expect(imported.path).toBe("poe-code/safe-fs/core");
  }
  expect(browser.posixPath).toBe(filesystem.posixPath);
  expect(browser.posixPath.join("/a", "..", "b")).toBe("/b");
  const names = browser.createAgentCommands().map(command => command.name).sort();
  expect(names).toHaveLength(110);
  expect(names).toEqual([
    "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
    "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
    "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
    "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha512sum", "sha384sum", "sha256sum", "sha224sum", "sha1sum",
    "md5sum", "cksum", "gzip", "gunzip", "zcat", "bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "zstd", "unzstd", "zstdcat", "cmp", "fmt", "shuf", "numfmt", "diff", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "zip", "unzip",
    "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
    "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint", "csplit", "pr", "tsort", "factor", "getopt", "hexdump", "hd", "iconv", "dos2unix", "unix2dos",
  ].sort());
  const commands = new browser.CommandRegistry();
  const plugin = browser.agentCommands({ regexExecutor: browser.createBoundedRegexProvider() });
  try {
    await plugin.setup({ commands, use() {}, registerFileSystem() {} });
    expect(commands.list().map(command => command.name).sort()).toEqual(names);
  } finally { await plugin.dispose?.(); }
  const fs = new filesystem.MemoryFileSystem();
  const shell = new browser.Shell({ fs }).use(
    browser.agentCommands(),
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
let browserRealm: ReturnType<typeof createContext>;
let filesystem: CoreFs;

beforeAll(async () => {
  filesystemBuild = await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, "packages/safe-fs/src/core.ts")],
    bundle: true, write: false, platform: "browser", conditions: ["workerd", "worker", "browser"],
    format: "cjs", target: "es2022",
  });
});

beforeAll(async () => {
  portableBuild = await build({...resolveBrowserShellBuild(root), sourcemap: false, minify: true});
});

beforeAll(async () => {
  for (const output of portableBuild.outputFiles!.filter(output => output.path.endsWith(".js"))) {
    artifacts.mkdirSync(path.dirname(output.path), { recursive: true });
    artifacts.writeFileSync(output.path, output.contents);
  }
});

beforeAll(async () => {
  const compiled = await bundlePublicConsumer(`
    export * from "@poe-platform/safe-bash";
    ${commandFactories.map(([command, factory], index) => `
      import { ${factory} as root${index} } from "@poe-platform/safe-bash";
      import { ${factory} as leaf${index} } from "@poe-platform/safe-bash/commands/${command}";
    `).join("\n")}
    export const factoryIdentity = [${commandFactories.map((_, index) => `root${index} === leaf${index}`).join(",")}];
  `);
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
    URL, FormData, Blob, Response, btoa, atob,
  });
  expect(runInContext("typeof Buffer", sandbox)).toBe("undefined");
  filesystem = runInContext(`(function(){ const module = { exports: {} }; ${filesystemBuild.outputFiles![0]!.text}; return module.exports; })()`, sandbox) as CoreFs;
  sandbox.canonical = filesystem;
  browser = runInContext(`(function(){ const module = { exports: {} }; const require = name => { if (name !== "@poe-platform/safe-fs/core") throw new Error(name); return canonical; }; ${compiled}; return module.exports; })()`, sandbox) as BrowserShell;
  browserRealm = sandbox;
  sandbox.browser = browser;
  factoryIdentity = (browser as BrowserShell & { factoryIdentity: boolean[] }).factoryIdentity;
  expect(runInContext("typeof Buffer + ':' + typeof process + ':' + typeof setImmediate + ':' + typeof require", sandbox)).toBe("function:undefined:undefined:undefined");
  expect(runInContext("Buffer.from('é').toString('hex')", sandbox)).toBe("c3a9");
  expect(runInContext("Buffer.prototype.utf8Slice.call(new Uint8Array([195, 169]), 0, 2)", sandbox)).toBe("é");
});

beforeAll(async () => {
  browserProbeBundle = await bundlePublicConsumer(await readFile(path.join(root, "scripts/fixtures/safe-packages-browser-probes.mjs"), "utf8"));
});

beforeAll(async () => {
  const consumer = await bundlePublicConsumer(await readFile(path.join(root, "scripts/fixtures/safe-packages-mixed-entry-runtime.mjs"), "utf8"));
  const sandbox = createContext({
    TextEncoder, TextDecoder, TypeError, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
    require(name: string) {
      if (name !== "@poe-platform/safe-fs/core") throw new Error(name);
      return filesystem;
    },
  });
  mixedConsumer = runInContext(`(function(){ const module = { exports: {} }; ${consumer}; return module.exports; })()`, sandbox);
});

beforeAll(async () => {
  const directory = path.join(root, "packages/safe-bash");
  const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  browserFixtureBuild = await build({
    entryPoints: [path.join(root, "scripts/fixtures/safe-packages-browser.mjs")],
    bundle: true, write: false, metafile: true, platform: "browser",
    conditions: ["workerd", "worker", "browser"], format: "esm", target: "es2022",
    plugins: [{
      name: "maintained-browser-fixture-entries",
      setup(builder) {
        builder.onResolve({ filter: /^@poe-platform\/safe-bash(?:\/.*)?$/ }, args => ({
          path: path.resolve(directory, manifest.exports[args.path === "@poe-platform/safe-bash" ? "." : `.${args.path.slice("@poe-platform/safe-bash".length)}`].browser),
          namespace: "evaluated-shell",
        }));
        builder.onLoad({ filter: /.*/, namespace: "evaluated-shell" }, args => {
          const output = portableBuild.metafile!.outputs[path.relative(root, args.path)];
          if (!output) throw new Error(`Missing browser entry: ${args.path}`);
          for (const name of output.exports) {
            if (!(name in browser)) throw new Error(`Missing evaluated browser export: ${name}`);
          }
          return { contents: output.exports.map(name => `export const ${name} = globalThis.browser.${name};`).join("\n"), loader: "js" };
        });
        builder.onResolve({ filter: /^@poe-platform\/(?:safe-fs\/core|safe-js\/fs\/core)$/ }, () => ({ path: "core", namespace: "evaluated-fs" }));
        builder.onLoad({ filter: /.*/, namespace: "evaluated-fs" }, () => ({
          contents: Object.keys(filesystem).map(name => `export const ${name} = globalThis.canonical.${name};`).join("\n"), loader: "js",
        }));
        builder.onResolve({ filter: /^@poe-platform\/safe-fs\/testing\/atomic$/ }, () => ({
          path: path.join(root, "packages/safe-fs/src/testing/atomic-filesystem.ts"),
        }));
      },
    }],
  });
});

it("executes the maintained browser fixture with all top-level workflows in a Node VM", async () => {
  const result = browserFixtureBuild;
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.exports)).toEqual([]);
  const sandbox = browserRealm;
  Object.assign(sandbox, { URL, TypeError, console });
  factoryIdentity = (browser as BrowserShell & { factoryIdentity: boolean[] }).factoryIdentity;
  expect(runInContext("typeof Buffer + ':' + typeof process + ':' + typeof require", sandbox)).toBe("function:undefined:undefined");
  await runInContext(`(async () => { ${result.outputFiles![0]!.text} })()`, sandbox);
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

it.each([{ maxCommands: 1 }, { maxOutputBytes: 2 }])("enforces portable command/output budget %j", async limits => {
  const shell = new browser.Shell({ fs: new filesystem.MemoryFileSystem(), limits }).use(browser.agentCommands());
  try { await expect(shell.exec("echo first; echo second")).rejects.toBeInstanceOf(browser.ShellLimitError); }
  finally { await shell.dispose(); }
});

it("enforces the loop budget in the portable runtime", async () => {
  const looping = new browser.Shell({ fs: new filesystem.MemoryFileSystem(), limits: { maxLoopIterations: 3 } });
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
      host.commands.register({ name: "wait-for-cancellation", execute(context) {
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
          start();
        });
      } });
    },
  });
  const stopped = new Error("stop browser execution");
  const running = shell.exec("wait-for-cancellation", { signal: controller.signal });
  const rejected = expect(running).rejects.toBe(stopped);
  await started;
  controller.abort(stopped);
  await rejected;
  await shell.dispose();
});


it("portable network factories require transport injection and preserve HTTP header validation", async () => {
  const consumer = createBrowserProbes();
  expect(await consumer.probeNetwork()).toEqual({ refused: true, valid: 0, invalid: 2, value: 2, multipart: 0, requests: 2, output: [111, 107, 111, 107] });
});
