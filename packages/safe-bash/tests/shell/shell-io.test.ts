import "./bom-capture.cases.js";
import "./here-string.cases.js";
import "./pipeline-effects.cases.js";
import "./read-fields.cases.js";
import "./read-options.cases.js";

import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const move of ['mv "$base/active" "$base/active-moved"', ':']) {
  test(`relative operands and redirections retain the working directory: ${move}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    const destination = move === ':' ? 'active' : 'active-moved';
    const result = await shell.exec(`
      base=$PWD
      mkdir active
      echo one > active/marker
      cd active
      ${move}
      cat marker
      echo two > marker
      cat "$base/${destination}/marker"
      pwd -P
    `);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `one\ntwo\n/${destination}\n`);
    assert.equal(result.exitCode, 0);
  });
}

test("ancestor renames retain cwd independently of logical PWD and reused paths", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  const result = await shell.exec(`
    mkdir -p /parent/active
    echo original > /parent/active/marker
    cd /parent/active
    (mv /parent /moved)
    mkdir -p /parent/active
    echo replacement > /parent/active/marker
    cat marker
    echo updated > marker
    cat /moved/active/marker /parent/active/marker
    printf '%s\\n' "$PWD"
    pwd
    pwd -P
    printf '%s\\n' "$(pwd)"
    cd ..
    pwd -P
  `);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "original\nupdated\nreplacement\n/parent/active\n/parent/active\n/moved/active\n/parent/active\n/parent\n");
  assert.equal(result.exitCode, 0);
});

test("a host rename and repeated moves preserve a symlink-entered cwd", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  shell.commands.register({ name: "host-move", async execute() {
    await fs.rename("/active", "/moved");
    await fs.rename("/moved", "/final");
    return { exitCode: 0 };
  } });
  const result = await shell.exec(`
    mkdir /active
    ln -s /active /alias
    cd /alias
    host-move
    echo retained > marker
    cat < marker
    cat /final/marker
    pwd -P
    pwd -L
  `);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "retained\nretained\n/final\n/alias\n");
  assert.equal(result.exitCode, 0);
});

test("explicit cd rebinds a moved cwd even when the pathname matches the saved path", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  const result = await shell.exec(`
    mkdir /active
    cd /active
    mv /active /moved
    cd .
    pwd
    echo "$PWD"
    mkdir /active
    echo replacement > /active/marker
    cd /active
    cat marker
    pwd -P
  `);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "/moved\n/moved\nreplacement\n/active\n");
  assert.equal(result.exitCode, 0);
});

test("directory tracking preserves missing and virtual cwd behavior and pure builtin budgets", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  for (const [source, options, expected] of [
    ["pwd", { cwd: "/missing" }, "/missing\n"],
    ["cd /dev; pwd; echo hi > null; pwd -P", {}, "/dev\n/dev\n"],
    ["pwd; echo hi", { limits: { maxFileSystemOperations: 0 } }, "/\nhi\n"],
    ["bash -c 'mkdir /active; cd /active; mv /active /moved; echo retained > marker; cat marker; pwd -P'", {}, "retained\n/moved\n"],
  ] as const) {
    const result = await shell.exec(source, options);
    assert.equal(result.stderr, "", source);
    assert.equal(result.stdout, expected, source);
    assert.equal(result.exitCode, 0, source);
  }
});
