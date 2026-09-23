import assert from "node:assert/strict";
import { SourceMap } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "../../../safe-js/src/index.js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };
const map = { version: 3, file: "compiled.js", sources: ["original.ts"], sourcesContent: [""], names: [], mappings: "AAIE", sourceRoot: "src/" };
const program = 'try { throw new Error("mapped"); } catch (error) { console.log(error.stack); }';

for (const selector of ["--eval 'console.log(3)'", "--print '3'", "-"]) {
  test(`node --enable-source-maps accepts ${selector} with native output`, async () => {
    const args = selector === "-" ? ["-"] : selector.startsWith("--eval") ? ["--eval", "console.log(3)"] : ["--print", "3"];
    const native = spawnSync(process.execPath, ["--enable-source-maps", ...args], { input: "console.log(3)", encoding: "utf8" });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
    try {
      const result = await shell.exec(`node --enable-source-maps ${selector}`, { stdin: "console.log(3)" });
      assert.equal(result.exitCode, native.status, result.stderr);
      assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, native.stderr);
    } finally { await shell.dispose(); }
  });
}

for (const inline of [false, true]) {
  test(`node maps guest Error and ReferenceError stacks using ${inline ? "inline" : "VFS"} maps`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const directive = inline ? "data:application/json;base64," + Buffer.from(JSON.stringify(map)).toString("base64") : "compiled.js.map";
    await fs.writeFile("/work/compiled.js", Buffer.from(program + '\n//# sourceMappingURL=' + directive));
    await fs.writeFile("/work/compiled.js.map", Buffer.from(JSON.stringify(map)));
    const shell = new Shell({ fs, cwd: "/work" }).use(nodeCommands({ runtime }));
    try {
      const enabled = await shell.exec("node --enable-source-maps compiled.js");
      assert.equal(enabled.exitCode, 0, enabled.stderr);
      const nativePosition = new SourceMap(map).findEntry(0, 12);
      assert.ok("originalSource" in nativePosition);
      const original = `/work/src/${nativePosition.originalSource}:${nativePosition.originalLine + 1}:${nativePosition.originalColumn + 1}`;
      assert.ok(enabled.stdout.includes(original), enabled.stdout);
      const disabled = await shell.exec("node compiled.js");
      assert.equal(disabled.exitCode, 0, disabled.stderr);
      assert.equal(disabled.stdout.includes("original.ts"), false);
      await fs.writeFile("/work/compiled.js", Buffer.from('try { missing; } catch (error) { console.log(error.stack); }\n//# sourceMappingURL=' + directive));
      const reference = await shell.exec("node compiled.js --enable-source-maps");
      assert.equal(reference.stdout.includes("original.ts"), false, "flags after the file are guest arguments");
      const mapped = await shell.exec("node --enable-source-maps compiled.js");
      assert.equal(mapped.exitCode, 0, mapped.stderr);
      assert.ok(mapped.stdout.includes("/work/src/original.ts:5:3"), mapped.stdout);
    } finally { await shell.dispose(); }
  });
}

test("node ignores missing, malformed and remote source maps and retains original guest positions", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/invalid.map", Buffer.from('{"version":3,"sources":["wrong.ts"],"mappings":"!"}'));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    for (const directive of ["missing.map", "invalid.map", "https://example.com/map", "data:application/json;base64,bm90IGpzb24="]) {
      await fs.writeFile("/compiled.js", Buffer.from(program + '\n//# sourceMappingURL=' + directive));
      const result = await shell.exec("node --enable-source-maps compiled.js");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes("/compiled.js:1:"), result.stdout);
      assert.equal(result.stdout.includes("wrong.ts"), false);
    }
  } finally { await shell.dispose(); }
});

test("source-map reads preserve caller cancellation and map byte limits", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/compiled.js", Buffer.from(program + '\n//# sourceMappingURL=compiled.map'));
  await fs.writeFile("/compiled.map", Buffer.from(JSON.stringify({ ...map, sourcesContent: ["x".repeat(1024)] })));
  const bounded = new Shell({ fs }).use(nodeCommands({ runtime, limits: { maxSourceBytes: 256 } }));
  try {
    const result = await bounded.exec("node --enable-source-maps compiled.js");
    assert.equal(result.exitCode, 124, result.stderr);
    assert.equal(result.stdout, "");
  } finally { await bounded.dispose(); }
  const controller = new AbortController();
  const reason = new Error("cancel map read");
  const readStream = fs.readStream.bind(fs);
  fs.readStream = (path, options) => {
    if (path.endsWith(".map")) controller.abort(reason);
    return readStream(path, options);
  };
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    await assert.rejects(shell.exec("node --enable-source-maps compiled.js", { signal: controller.signal }), error => error === reason);
  } finally { await shell.dispose(); }
});

test("source-map directives inside multiline strings are ignored", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/compiled.js", Buffer.from('const text = `\n//# sourceMappingURL=compiled.map\n`;\n' + program));
  await fs.writeFile("/compiled.map", Buffer.from(JSON.stringify({ ...map, mappings: "AAAA;AAAA;AAAA;AAAA" })));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec("node --enable-source-maps compiled.js");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.includes("original.ts"), false, result.stdout);
    assert.ok(result.stdout.includes("/compiled.js:4:"), result.stdout);
  } finally { await shell.dispose(); }
});

test("decoded source-map entries obey the invocation array limit", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/compiled.js", Buffer.from('console.log(3);\n//# sourceMappingURL=compiled.map'));
  await fs.writeFile("/compiled.map", Buffer.from(JSON.stringify({ ...map, mappings: Array.from({ length: 101 }, () => "AAAA").join(";") })));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime, limits: { arrayLength: 100 } }));
  try {
    const result = await shell.exec("node --enable-source-maps compiled.js");
    assert.equal(result.exitCode, 124, result.stderr);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("quoted characters inside regular expressions do not hide real map comments", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/compiled.js", Buffer.from("const pattern = /'/;\n" + program + '\n//# sourceMappingURL=compiled.map'));
  await fs.writeFile("/compiled.map", Buffer.from(JSON.stringify({ ...map, mappings: ";AAIE" })));
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec("node --enable-source-maps compiled.js");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("/src/original.ts:5:3"), result.stdout);
  } finally { await shell.dispose(); }
});

test("resolved source-map filenames obey data admission before running the engine", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/compiled.js", Buffer.from('console.log(3);\n//# sourceMappingURL=compiled.map'));
  await fs.writeFile("/compiled.map", Buffer.from(JSON.stringify({
    ...map, sourceRoot: "r".repeat(10000) + "/", sources: Array.from({ length: 100 }, (_, index) => `${index}.ts`),
    mappings: ["AAAA", ...Array.from({ length: 99 }, () => "ECAA")].join(","),
  })));
  let runs = 0;
  const shell = new Shell({ fs }).use(nodeCommands({ runtime: { ...runtime, async run() { runs++; return { ok: true }; } },
    limits: { arrayLength: 1000, dataSize: 1024 * 1024 } }));
  try {
    const result = await shell.exec("node --enable-source-maps compiled.js");
    assert.equal(result.exitCode, 124, result.stderr);
    assert.equal(runs, 0);
  } finally { await shell.dispose(); }
});
