import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { textCommands } from "../../src/commands/text.js";

for (const delimiter of ["\n", "\0"]) {
  for (const mode of ["-s", "-u", "-rs"]) {
    for (const [key, separator, rows, sorted] of [
      ["2.1b,2.1b", "|", ["w| Q", "x| A", "y| M"], ["x| A", "y| M", "w| Q"]],
      ["2.1b,2.1", undefined, ["K  Q", "K A", "K   M"], mode === "-u" ? ["K  Q"] : ["K  Q", "K A", "K   M"]],
      ["2.1,2.1b", undefined, ["K  Q", "K A", "K   M"], ["K   M", "K  Q", "K A"]],
      ["2.1b,2.1b", undefined, ["K  Q", "K A", "K   M"], ["K A", "K   M", "K  Q"]],
      ["2.1,2.1", "|", ["w| Q", "x| A", "y| M"], mode === "-u" ? ["w| Q"] : ["w| Q", "x| A", "y| M"]],
      ["2.2,2.2", "|", ["w| Q", "x| A", "y| M"], mode === "-rs" ? ["w| Q", "y| M", "x| A"] : ["x| A", "y| M", "w| Q"]],
    ] as const) {
      test(`sort ${mode} ${key} with ${separator ?? "blank"} fields and ${delimiter === "\n" ? "LF" : "NUL"} records`, async context => {
        const input = rows.join(delimiter) + delimiter;
        const expected = sorted.join(delimiter) + delimiter;
        const fs = new MemoryFileSystem();
        await fs.mkdir("/work");
        await fs.writeFile("/work/records", new TextEncoder().encode(input));
        const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use({ name: "sort-test", setup(host) { for (const command of textCommands()) host.commands.register(command); } });
        context.after(() => shell.dispose());
        const result = await shell.exec(`sort ${mode} ${delimiter === "\0" ? "-z" : ""} ${separator ? "-t '|'" : ""} -k ${key} records > actual.bin`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "");
        assert.deepEqual(await fs.readFile("/work/actual.bin"), new TextEncoder().encode(expected));
        assert.deepEqual(await fs.readFile("/work/records"), new TextEncoder().encode(input));
      });
    }
  }
}

test("sort inherits global blank offsets only for keys without local modifiers", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/records", new TextEncoder().encode("w|\t Q\nx| A\ny|\tM\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use({ name: "sort-test", setup(host) {
    for (const command of textCommands()) host.commands.register(command);
  } });
  context.after(() => shell.dispose());
  for (const [key, expected] of [
    ["2.1,2.1", "x| A\ny|\tM\nw|\t Q\n"],
    ["2.1f,2.1", "w|\t Q\ny|\tM\nx| A\n"],
  ]) {
    const result = await shell.exec(`sort -bs -t '|' -k ${key} records`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});
