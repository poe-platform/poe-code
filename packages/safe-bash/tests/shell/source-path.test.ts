import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { Shell } from "../../src/shell/index.js";
import { ShellLimitError } from "../../src/shell/types.js";

for (const command of ["source", "."]) {
  for (const operand of [
    "/dev/stdin blue <<< 'selected=$1; return 7'",
    "/dev/fd/0 blue <<< 'selected=$1; return 7'",
    "/dev/fd/3 blue 3< helper",
    "/dev/fd/4 blue 3< helper 4<&3",
    "/dev/stdin blue < helper",
    "./helper blue",
    "<(printf '%s\\n' 'selected=$1; return 7') blue",
  ]) {
    test(`${command} loads ${operand} in the caller`, async t => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/helper", new TextEncoder().encode("selected=$1; return 7"));
      const shell = new Shell({ fs }).use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`set -- parent; selected=old; ${command} ${operand}; printf '%s:%s:%s\\n' "$?" "$selected" "$1"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "7:blue:parent\n");
    });
  }

  test(`${command} uses supplied stdin and preserves arguments when none are supplied`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`set -- parent; ${command} /dev/stdin; echo "$?:$selected:$1"`, {
      stdin: "selected=$1; return 7",
    });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "7:parent:parent\n");
  });

  test(`${command} rejects closed descriptor operands`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`selected=old; ${command} /dev/fd/3 3<&-; echo "$?:$selected"`);
    assert.equal(result.stdout, "1:old\n");
    assert.notEqual(result.stderr, "");
  });

  test(`${command} bounds descriptor source bytes`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const script = `${command} /dev/stdin`;
    const stdin = "selected=é";
    const maxSourceBytes = Buffer.byteLength(script) + Buffer.byteLength(stdin);
    assert.equal((await shell.exec(script, { stdin, limits: { maxSourceBytes } })).exitCode, 0);
    await assert.rejects(shell.exec(script, { stdin, limits: { maxSourceBytes: maxSourceBytes - 1 } }),
      error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
  });

  test(`${command} collects streamed source before decoding UTF-8`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`${command} /dev/stdin; echo "$selected"`, {
      stdin: { async *[Symbol.asyncIterator]() {
        const chunk = new Uint8Array(1);
        for (const byte of new TextEncoder().encode("selected=é")) {
          chunk[0] = byte;
          yield chunk;
        }
      } },
    });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "é\n");
  });

  test(`${command} preserves cancellation while collecting source`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const controller = new AbortController();
    const reason = new Error("cancel source input");
    await assert.rejects(shell.exec(`${command} /dev/stdin`, {
      signal: controller.signal,
      stdin: { async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode("selected=old");
        controller.abort(reason);
        throw reason;
      } },
    }), error => error === reason);
  });
}

test("sourcepath survives snapshots and remains isolated across subshells", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("shopt -u sourcepath", { onState() {} });
  assert.equal(result.state?.options?.sourcepath, false);
  const restored = await shell.exec("(shopt -s sourcepath); shopt -p sourcepath; bash -c 'shopt -p sourcepath'", { state: result.state });
  assert.equal(restored.stderr, "");
  assert.equal(restored.stdout, "shopt -u sourcepath\nshopt -s sourcepath\n");
});

// Expected results verified with GNU Bash 5.3.20.
for (const command of [".", "source"]) {
  for (const [options, filename, before, expected] of [
    ["-p two", "helper", "", "two"],
    ["-p two:one", "helper", "", "two"],
    ["-p missing:one", "helper", "", "one"],
    ["-ptwo", "helper", "", "two"],
    ["-p one -p two --", "helper", "", "two"],
    ["-p ''", "helper", "", "cwd"],
    ["-p missing", "./helper", "", "cwd"],
    ["-p two", "helper", "shopt -u sourcepath;", "two"],
    ["", "helper", "shopt -u sourcepath;", "cwd"],
  ]) {
    test(`${command} ${options} ${filename} after ${before}`, async t => {
      const fs = new MemoryFileSystem();
      for (const directory of ["one", "two"]) await fs.mkdir(`/${directory}`);
      for (const [path, value] of [["/helper", "cwd"], ["/one/helper", "one"], ["/two/helper", "two"]]) {
        await fs.writeFile(path!, new TextEncoder().encode(`value=${value}:$1; return 7`));
      }
      const shell = new Shell({ fs }).use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`PATH=one:two; set -- original; ${before}
        ${command} ${options} ${filename} 'two words'; echo "$?:$value:$1:$PATH"
        shopt -s sourcepath; ${command} helper again; echo "$?:$value:$1:$PATH"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `7:${expected}:two words:original:one:two\n7:one:again:original:one:two\n`);
    });
  }

  test(`${command} explicit missing path never falls back to PATH or cwd`, async t => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/one");
    for (const path of ["/helper", "/one/helper"]) await fs.writeFile(path, new TextEncoder().encode("value=loaded"));
    const shell = new Shell({ fs }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`PATH=one; value=original; ${command} -p missing helper; echo "$?:$value"; ${command} helper; echo "$?:$value"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1:original\n0:loaded\n");
    assert.ok(result.stderr.includes(`${command}: helper: file not found`));
  });

  for (const args of ["-p", "-p two", "-ptwo", "-x"]) {
    test(`${command} rejects incomplete or invalid options: ${args}`, async t => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`${command} ${args}`);
      assert.equal(result.exitCode, 2);
      assert.notEqual(result.stderr, "");
    });
  }
}
