import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { extensionState, type ShellExtension } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

for (const prefix of ["", "command ", "builtin "]) test(`extension declaration expansion: ${prefix || "direct"}`, async context => {
  const observed: string[][] = [];
  const extension: ShellExtension = { name: "declarations", create: () => ({ builtins: [{
    name: "record", expansion: "declaration", execute(command) {
      observed.push(command.argumentValues.map(value => Buffer.from(shellValueBytes(value)).toString("hex")));
      return 0;
    } }, {
      name: "ordinary", execute(command) {
        observed.push(command.argumentValues.map(value => Buffer.from(shellValueBytes(value)).toString("hex")));
        return 0;
      },
    }] }) };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension] });
  context.after(() => shell.dispose());
  const result = await shell.exec(`value=$'\\xff z'; ${prefix}record name=$value; ordinary name=$value`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(observed, [["6e616d653dff207a"], ["6e616d653dff", "7a"]]);
});

test("captured builtin declaration metadata preserves its original receiver", async context => {
  let reads = 0;
  class Builtin {
    readonly name = "record";
    readonly #status = 3;
    get expansion(): "declaration" | "ordinary" { return ++reads === 1 ? "declaration" : "ordinary"; }
    execute() { return this.#status; }
  }
  const builtin = new Builtin();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "captured", create: () => ({ builtins: [builtin] }) }] });
  context.after(() => shell.dispose());
  const result = await shell.exec("record; record");
  assert.equal(result.exitCode, 3, result.stderr);
  assert.equal(reads, 1);
});

test("invalid builtin expansion metadata is rejected", () => {
  assert.throws(() => extensionState([{ name: "invalid", create: () => ({ builtins: [{ name: "record", expansion: "unknown" as "ordinary", execute: () => 0 }] }) }]), /expansion/u);
});

test("default declaration behavior and absence of optional builtins remain intact", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(`value='a b'; export name=$value; printf '<%s>' "$name"; command -v record`);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "<a b>");
  assert.equal(result.stderr, "");
});
