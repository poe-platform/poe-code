import assert from "node:assert/strict";
import { posix } from "node:path";
import { posixPath as contractPath } from "@poe-platform/safe-bash/contracts";
import { posixPath as indexedPath } from "@poe-platform/safe-bash/contracts/index";
import { posixPath as directPath } from "@poe-platform/safe-bash/contracts/path";
import { checksumWorkflows, defaultEntry, expectedAgentCommandNames, nullDeviceWorkflows, runNestedCommands, verifyCmpCommands, verifyFmtCommands, verifyShufCommands, verifyNumfmtCommands, verifyTruncateCommands, verifyZipCommands, verifyCsplitCommands, verifyPrCommands, verifyTsortCommands, verifyNullDeviceView } from "./safe-packages-mixed-entry-runtime.mjs";
import * as nodeEntry from "@poe-platform/safe-bash/node";
import { createNodeRegexProvider } from "@poe-platform/safe-bash/node";
import "./safe-packages-realms.mjs";
import "./safe-packages-retained.mjs";
import "./safe-packages-date.mjs";
import "./safe-packages-object.mjs";
import "./safe-packages-indexed.mjs";
import "./safe-packages-named.mjs";
import "./safe-packages-named-mutations.mjs";
import "./safe-packages-console-override.mjs";
import "./safe-packages-callback-phases.mjs";
import "./safe-packages-curl-output.mjs";
import { Budget, run } from "@poe-platform/safe-js";
import { FsError, createDeviceFileSystem, createMemoryFileSystem, createReadOnlyFileSystem } from "@poe-platform/safe-fs";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs";
import { FsError as CoreFsError } from "@poe-platform/safe-js/fs/core";
import { FsError as NodeFsError } from "@poe-platform/safe-js/fs/node";
import { Shell, agentCommands, createAgentCommands, FsError as ShellFsError, createMountFileSystem, posixPath, createBoundedRegexProvider } from "@poe-platform/safe-bash";

assert.equal(FsError, ShellFsError);
assert.equal(FsError, CompatibilityFsError);
assert.equal(FsError, CoreFsError);
assert.equal(FsError, NodeFsError);
await verifyNullDeviceView({ createMemoryFileSystem, createDeviceFileSystem });
for (const paths of [posixPath, nodeEntry.posixPath, contractPath, indexedPath, directPath]) {
  assert.equal(paths, posix);
  assert.equal(paths.sep, "/");
  assert.equal(paths.delimiter, ":");
  assert.equal(paths.normalize("/a/../b"), "/b");
  assert.equal(paths.format(paths.parse("/a/file.txt")), "/a/file.txt");
}
for (const [entry, options] of [[defaultEntry, {}], [nodeEntry, { regexExecutor: createNodeRegexProvider() }]]) {
  assert.deepEqual(entry.createAgentCommands().map(command => command.name).sort(), expectedAgentCommandNames);
  const nested = await runNestedCommands(entry, options);
  assert.deepEqual(nested.failures, []);
  for (const result of nested.results) {
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2\n");
    assert.equal(result.stderr, "");
  }
}
assert.equal(defaultEntry.Shell, nodeEntry.Shell);
assert.equal(defaultEntry.ShellLimitError, nodeEntry.ShellLimitError);
assert.equal(defaultEntry.FsError, nodeEntry.FsError);
assert.equal(defaultEntry.MemoryFileSystem, nodeEntry.MemoryFileSystem);
assert.equal(defaultEntry.createCommandArguments, nodeEntry.createCommandArguments);
const carrier = defaultEntry.createCommandArguments(["nested"]);
assert.equal(nodeEntry.getCommandArguments({ args: carrier.args, argumentValues: carrier }), carrier);
assert.throws(() => nodeEntry.getCommandArguments({ args: carrier.args, argumentValues: { ...carrier } }), /Expected owned command arguments/);
assert.throws(() => nodeEntry.getCommandArguments({ args: [...carrier.args], argumentValues: carrier }), defaultEntry.CommandArgumentIdentityError);
const bytes = carrier.withValues([new Uint8Array([255, 0])]);
assert.deepEqual(Array.from(nodeEntry.createCommandArguments(bytes.values).bytes(0)), [255, 0]);
for (const provider of [undefined, createNodeRegexProvider()]) {
  const fs = new defaultEntry.MemoryFileSystem();
  await fs.mkdir("/notes");
  await fs.writeFile("/notes/report.txt", new TextEncoder().encode("report\n"));
  const shell = new defaultEntry.Shell({ fs }).use(nodeEntry.agentCommands({ regexExecutor: provider }));
  try {
    const report = await shell.exec("printf /notes/report.txt | xargs cat");
    assert.equal(report.exitCode, 0, report.stderr);
    assert.equal(report.stdout, "report\n");
    const environment = await shell.exec("env NOTE=local env");
    assert.equal(environment.exitCode, 0, environment.stderr);
    assert.ok(environment.stdout.split("\n").includes("NOTE=local"));
    assert.equal((await shell.exec("printf hello | xargs node")).exitCode, 127);
    const matched = await shell.exec(provider === undefined ? "printf 'abc\\n' | egrep '^abc$'" : "printf 'Abc\\n' | grep -i abc");
    assert.equal(matched.exitCode, 0, matched.stderr);
    assert.equal(matched.stdout, provider === undefined ? "abc\n" : "Abc\n");
    for (const [script, stdout, exitCode] of [
      ["expr abc : 'a.*'", "3\n", 0],
      ["expr abc : 'a\\(.\\)c'", "b\n", 0],
      ["expr ba : a", "0\n", 1],
    ]) {
      const expression = await shell.exec(script);
      assert.equal(expression.exitCode, exitCode, expression.stderr);
      assert.equal(expression.stdout, stdout, script);
      assert.equal(expression.stderr, "", script);
    }
  } finally { await shell.dispose(); }
}
await verifyCmpCommands(defaultEntry);
await verifyCmpCommands(nodeEntry);
await verifyFmtCommands(defaultEntry);
await verifyFmtCommands(nodeEntry);
await verifyShufCommands(defaultEntry);
await verifyShufCommands(nodeEntry);
await verifyNumfmtCommands(defaultEntry);
await verifyNumfmtCommands(nodeEntry);
await verifyTruncateCommands(defaultEntry);
await verifyTruncateCommands(nodeEntry);
await verifyZipCommands(defaultEntry);
await verifyZipCommands(nodeEntry);
await verifyCsplitCommands(defaultEntry);
await verifyCsplitCommands(nodeEntry);
await verifyPrCommands(defaultEntry);
await verifyPrCommands(nodeEntry);
await verifyTsortCommands(defaultEntry);
await verifyTsortCommands(nodeEntry);
assert.deepEqual(createAgentCommands().map(command => command.name).sort(), expectedAgentCommandNames);
const boundedShell = new Shell({ fs: createMemoryFileSystem() }).use(
  agentCommands({ regexExecutor: createBoundedRegexProvider() }),
);
try {
  for (const [script, expected] of [...checksumWorkflows, ...nullDeviceWorkflows]) {
    const result = await boundedShell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected, script);
    assert.equal(result.stderr, "", script);
  }
  for (const script of ["env jq -nc '1+1'", "printf '\"1+1\"' | xargs jq -nc"]) {
    const result = await boundedShell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2\n");
    assert.equal(result.stderr, "");
  }
} finally { await boundedShell.dispose(); }
for (const entry of ["@poe-platform/safe-bash", "@poe-platform/safe-bash/node"]) {
  const { Shell: EntryShell, agentCommands: commands } = await import(entry);
  for (const boxed of [false, true]) {
    for (const mode of ["disabled", "missing", "unsupported"]) {
      const backend = createMemoryFileSystem();
      await backend.writeFile("/note", new TextEncoder().encode("hello\n"));
      Object.defineProperty(backend, "capabilities", { value: { streamingRead: mode === "unsupported" ? undefined : false } });
      backend.readStream = mode === "missing" ? undefined : (path) => ({ [Symbol.asyncIterator]: () => ({
        async next() { throw new FsError("ENOTSUP", { syscall: "readStream", path }); },
      }) });
      const fs = createMountFileSystem({ root: createReadOnlyFileSystem(createMemoryFileSystem()), mounts: {
        "/data": boxed ? createReadOnlyFileSystem(backend) : backend,
        "/scratch": createMemoryFileSystem(),
      } });
      const shell = new EntryShell({ fs }).use(commands());
      try {
        for (const [script, expected] of [
          ["cat /data/note", "hello\n"], ["cat < /data/note", "hello\n"],
          ["read -r value < /data/note; printf '%s' \"$value\"", "hello"],
          ["printf '%s' \"$(< /data/note)\"", "hello"],
        ]) {
          const output = await shell.exec(script);
          assert.equal(output.stderr, "", `${entry}, ${mode}, boxed=${boxed}: ${script}`);
          assert.equal(output.exitCode, 0);
          assert.equal(output.stdout, expected);
        }
        assert.equal((await shell.exec("wc -c < /data/note", { limits: { maxInputBytes: 6, maxOutputBytes: 4 } })).stdout.trim(), "6");
        const oversized = await shell.exec("cat < /data/note", { limits: { maxInputBytes: 5 } });
        assert.equal(oversized.exitCode, 1);
        assert.match(oversized.stderr, /EFBIG|file too large/i);
      } finally { await shell.dispose(); }
    }
  }
}
const result = await run("return values.map(value => value * 2);", {
  bindings: { values: [2, 3] }, budget: new Budget({ maxSteps: 1000 }),
});
assert.equal(result.ok, true);
assert.deepEqual(result.returnValue, [4, 6]);
for (const entry of ["@poe-platform/safe-js", "@poe-platform/safe-js/core"]) {
  const { Budget: EntryBudget, run: execute } = await import(entry);
  const functionResult = await execute(`
    function Counter(value) { this.value = value; }
    Counter.label = "counter";
    Counter.fn = Counter.prototype = { read: function () { return this.value; } };
    function Child(value) { Counter.call(this, value); }
    Child.prototype = Object.create(Counter.prototype, {
      constructor: { value: Child, writable: true, configurable: true }
    });
    const child = new Child(7);
    const Bound = Child.bind(null, 9);
    const arrow = () => 1;
    arrow.label = "arrow";
    let denied = false;
    try { new arrow(); } catch (error) { denied = true; }
    return [Counter.label, child.read(), child instanceof Child,
      child instanceof Counter, Counter.fn === Counter.prototype,
      child.constructor === Child, new Bound().read(), arrow.label,
      denied, Counter.constructor, Array.constructor, Object.keys(Child.prototype).length];
  `, { budget: new EntryBudget({ maxSteps: 10_000, dataSize: 100_000 }) });
  assert.equal(functionResult.ok, true, entry);
  assert.deepEqual(functionResult.returnValue, ["counter", 7, true, true, true, true, 9, "arrow", true, undefined, undefined, 0], entry);
}
for (const streaming of [true, false]) {
  const fs = createMemoryFileSystem();
  if (!streaming) Object.defineProperty(fs, "readStream", { value: undefined });
  await fs.writeFile("/large", new Uint8Array(65_537));
  const shell = new Shell({ fs, limits: { maxInputBytes: 65_537, maxOutputBytes: 65_536 } }).use(agentCommands());
  try {
    const output = await shell.exec("wc -c < /large");
    assert.equal(output.exitCode, 0, output.stderr);
    assert.equal(output.stdout.trim(), "65537");
  } finally { await shell.dispose(); }
}
const source = createMemoryFileSystem();
const target = createMemoryFileSystem();
await source.writeFile("/input", new Uint8Array([42]));
const write = target.writeStream.bind(target);
target.writeStream = async (path, bytes, options) => {
  assert.ok(!Object.hasOwn(options, "exclusive"));
  await write(path, bytes, options);
};
const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": source, "/target": target } });
await mounted.copyFile("/source/input", "/target/copy", { exclusive: true });
assert.deepEqual(await target.readFile("/copy"), new Uint8Array([42]));
console.log("Scoped SafeJS, shell, canonical filesystem, copy options and input limits passed");
