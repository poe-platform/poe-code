import assert from "node:assert/strict";
import { posix } from "node:path";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "@poe-code/safe-js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };

for (const name of ["path", "node:path"]) {
  for (const loading of ["require", "default", "named", "namespace"]) {
    test(`node loads ${name} through ${loading}`, async () => {
      const source = loading === "require" ? `const path = require("${name}"); console.log(path.join("a", "b"));`
        : loading === "default" ? `import path from "${name}"; console.log(path.join("a", "b"));`
        : loading === "namespace" ? `import * as path from "${name}"; console.log(path.join("a", "b"));`
        : `import {join} from "${name}"; console.log(join("a", "b"));`;
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
      try {
        const result = await shell.exec(`node --input-type=module -e '${source}' a b`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "a/b\n");
        assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
  }
}

test("node path methods match POSIX Node using the virtual cwd", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/virtual-work", { recursive: true });
  const shell = new Shell({ fs, cwd: "/virtual-work" }).use(nodeCommands({ runtime }));
  const cases: readonly [string, readonly string[]][] = [
    ["join", ["a", "..", "b/"]], ["join", []], ["normalize", ["../a//b/../"]],
    ["resolve", []], ["resolve", ["a", "/b", "../c"]], ["relative", ["a/b", "../c"]],
    ["basename", ["a/file.txt", ".txt"]], ["basename", ["a/a", "a"]],
    ["dirname", ["//a"]], ["extname", [".profile"]], ["extname", ["a.txt"]],
    ["isAbsolute", ["/a"]], ["isAbsolute", ["a"]],
  ];
  try {
    for (const [method, args] of cases) {
      const source = `const path = require("node:path"); console.log(path.posix.${method}(${args.map(value => JSON.stringify(value)).join(",")}));`;
      const result = await shell.exec(`node -e '${source}'`);
      const expected = method === "resolve" ? posix.resolve("/virtual-work", ...args)
        : method === "relative" ? posix.relative(posix.resolve("/virtual-work", args[0]!), posix.resolve("/virtual-work", args[1]!))
        : (posix[method as keyof typeof posix] as (...values: string[]) => unknown)(...args);
      assert.equal(result.exitCode, 0, `${method}: ${result.stderr}`);
      assert.equal(result.stdout, `${expected}\n`, `${method}(${args})`);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("node path imports retain execution limits and reject other modules", async () => {
  for (const [limits, source, exitCode] of [
    [{ maxSteps: 2000 }, 'import path from "node:path"; while (true) { path.join("a", "b"); }', 124],
    [{ maxOutputBytes: 2 }, 'console.log(require("path").join("a", "b"))', 124],
    [{}, 'require("node:child_process")', 1],
    [{}, 'import child from "node:child_process";', 2],
  ] as const) {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime, limits }));
    try {
      const result = await shell.exec(`node -e '${source}'`);
      assert.equal(result.exitCode, exitCode, result.stderr);
    } finally { await shell.dispose(); }
  }
});

test("node path calls preserve the caller's cancellation reason", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel path call");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime: {
    ...runtime,
    run(source, options) {
      const path = options.modules.path!;
      const join = path.join as (...args: string[]) => string;
      path.join = declareHostOperation((...args: string[]) => {
        const value = join(...args);
        controller.abort(reason);
        return value;
      }, "read-side-effect");
      return run(source, options);
    },
  } }));
  try {
    await assert.rejects(shell.exec('node -e \'import {join} from "path"; console.log(join("a", "b"));\'', { signal: controller.signal }), error => error === reason);
  } finally { await shell.dispose(); }
});

test("node path rejects missing or non-string arguments like Node", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
  try {
    for (const call of ["normalize()", "normalize(1)", "resolve(null)", "relative()", "join(1)"]) {
      const result = await shell.exec(`node -e 'const path = require("path"); path.${call};'`);
      assert.equal(result.exitCode, 1, call);
      assert.equal(result.stdout, "");
    }
  } finally { await shell.dispose(); }
});
