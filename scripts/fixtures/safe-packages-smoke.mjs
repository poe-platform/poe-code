import assert from "node:assert/strict";
import "./safe-packages-realms.mjs";
import "./safe-packages-retained.mjs";
import "./safe-packages-date.mjs";
import "./safe-packages-object.mjs";
import "./safe-packages-indexed.mjs";
import "./safe-packages-named.mjs";
import { Budget, run } from "@poe-platform/safe-js";
import { FsError, createMemoryFileSystem, createReadOnlyFileSystem } from "@poe-platform/safe-fs";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs";
import { FsError as CoreFsError } from "@poe-platform/safe-js/fs/core";
import { FsError as NodeFsError } from "@poe-platform/safe-js/fs/node";
import { Shell, standardCommands, FsError as ShellFsError, createMountFileSystem } from "@poe-platform/safe-bash";

assert.equal(FsError, ShellFsError);
assert.equal(FsError, CompatibilityFsError);
assert.equal(FsError, CoreFsError);
assert.equal(FsError, NodeFsError);
for (const entry of ["@poe-platform/safe-bash", "@poe-platform/safe-bash/browser"]) {
  const { Shell: EntryShell, standardCommands: standard, browserCommands: browser } = await import(entry);
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
      const shell = new EntryShell({ fs }).use((standard ?? browser)());
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
  const shell = new Shell({ fs, limits: { maxInputBytes: 65_537, maxOutputBytes: 65_536 } }).use(standardCommands());
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
