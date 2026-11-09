import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { standardCommands } from "../../src/commands/index.js";

const keywords = ["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "{", "}", "!", "[[", "]]", "time", "select", "coproc"];

for (const name of ["tool", "pinned"]) {
  test(`hash -p controls execution and lookup for ${name}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/a");
    await fs.mkdir("/b");
    await fs.writeFile("/a/tool", new TextEncoder().encode("#!/bin/sh\nprintf 'A\\n'"), { mode: 0o755 });
    await fs.writeFile("/b/tool", new TextEncoder().encode("#!/bin/sh\nprintf 'B\\n'"), { mode: 0o755 });
    const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()), env: { PATH: "/a" } });
    context.after(() => shell.dispose());
    const result = await shell.exec(`hash -p /b/tool ${name}; hash -t ${name}; command -v ${name}; type -P ${name}; ${name}; command ${name}; hash -r; command -v tool; type -P tool; tool`);
    assert.equal(result.stdout, "/b/tool\n/b/tool\n/b/tool\nB\nB\n/a/tool\n/a/tool\nA\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const command of ["type -t", "type", "command -v", "command -V"]) {
  test(`${command} discovers shell keywords`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const result = await shell.exec(`${command} ${keywords.map(word => `'${word}'`).join(" ")}`);
    const expected = keywords.map(word => command === "type -t" ? "keyword" : command === "command -v" ? word : `${word} is a shell keyword`).join("\n") + "\n";
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("keyword discovery also works in sh and precedes functions without changing execution", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([{ name: "time", execute: () => ({ exitCode: 23 }) }]) });
  const result = await shell.exec("function time { :; }; type -t time; command -v time; type -f time; sh -c 'command -v if for while; command -V case'; command time");
  assert.equal(result.stdout, "keyword\ntime\ntime is a shell keyword\nif\nfor\nwhile\ncase is a shell keyword\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 23);
});

test("keywords precede PATH executables while path-only and all discovery retain them", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/time", new TextEncoder().encode("#!/bin/sh\nprintf external"), { mode: 0o755 });
  const shell = new Shell({ fs, env: { PATH: "/bin" } });
  const result = await shell.exec("type time; type -t time; command -v time; command -V time; type -a time; type -p time; type -P time; type -ap time");
  assert.equal(result.stdout, "time is a shell keyword\nkeyword\ntime\ntime is a shell keyword\ntime is a shell keyword\ntime is /bin/time\n/bin/time\n/bin/time\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("hash builtin supports -r, -p, -t, -d, and type discovery", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/mytool", new TextEncoder().encode("#!/bin/sh\n"), { mode: 0o755 });
  const shell = new Shell({ fs, env: { PATH: "/bin" } });
  const result = await shell.exec("type -t hash; hash -r; hash mytool; hash -t mytool; hash -d mytool; hash -r");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "builtin\n/bin/mytool\n");
});

for (const change of ["earlier", "removed", "denied"] as const) {
  for (const reset of ["hash -r", "hash -d tool"]) test(`automatic command hashing retains the target when ${change} until ${reset}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/a");
    await fs.mkdir("/b");
    await fs.writeFile("/b/tool", new TextEncoder().encode("#!/bin/sh\nprintf B"), { mode: 0o755 });
    const commands = new CommandRegistry(basicCommands());
    commands.register({ name: "change", execute: async () => {
      await fs.writeFile("/a/tool", new TextEncoder().encode("#!/bin/sh\nprintf A"), { mode: 0o755 });
      if (change === "removed") await fs.unlink("/b/tool");
      if (change === "denied") await fs.chmod("/b/tool", 0o644);
      return { exitCode: 0 };
    } });
    const shell = new Shell({ fs, commands, env: { PATH: "/a:/b" } });
    context.after(() => shell.dispose());
    const result = await shell.exec(`tool; change; command -v tool; tool; printf ':%s\\n' $?; hash; hash -t tool; ${reset}; tool; hash -r; tool`);
    assert.equal(result.stdout, `B/b/tool\n${change === "earlier" ? "B:0" : change === "removed" ? ":127" : ":126"}\nhits\tcommand\n   2\t/b/tool\n/b/tool\nAA`);
    assert.equal(result.exitCode, 0);
    if (change === "earlier") assert.equal(result.stderr, "");
    else assert.ok(result.stderr.includes("/b/tool"));
  });
}

test("hash reset, PATH assignment and subshells preserve Bash cache ownership", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", new TextEncoder().encode("#!/bin/sh\n:"), { mode: 0o755 });
  const shell = new Shell({ fs, env: { PATH: "/bin" } });
  context.after(() => shell.dispose());
  const result = await shell.exec("tool; (hash -r); hash -t tool; (tool); hash; PATH=$PATH; hash -t tool");
  assert.equal(result.stdout, "/bin/tool\nhits\tcommand\n   1\t/bin/tool\n");
  assert.equal(result.exitCode, 1);
});

for (const mutation of ["hash -d saved", "hash -r", "hash -p /bin/other saved"]) {
  for (const context of ["subshell", "command substitution", "function subshell"]) {
    test(`${context} keeps ${mutation} separate from the parent hash table`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { PATH: "/bin" } }).use(standardCommands());
      const child = `hash -t saved; ${mutation}; hash -t saved 2>/dev/null; printf 'child=%s\\n' "$?"; hash -p /bin/tool child`;
      const run = context === "subshell" ? `(${child})`
        : context === "command substitution" ? `printf '%s\\n' "$(${child})"`
        : `f() { local value=local; (${child}); }; f`;
      const result = await shell.exec(`hash -p /bin/tool saved; ${run}; hash -t saved; printf 'parent=%s\\n' "$?"; hash -t child 2>/dev/null; printf 'added=%s\\n' "$?"`);
      const changed = mutation.startsWith("hash -p") ? "/bin/other\nchild=0\n" : "child=1\n";
      assert.equal(result.stdout, `/bin/tool\n${changed}/bin/tool\nparent=0\nadded=1\n`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

test("nested subshells copy the immediate parent's hash table", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const result = await shell.exec("hash -p /outer saved; (hash -p /inner saved; (hash -d saved); hash -t saved); hash -t saved");
  assert.equal(result.stdout, "/inner\n/outer\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("brace groups and functions mutate the current shell's hash table", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  const result = await shell.exec("hash -p /bin/tool saved; { hash -d saved; }; hash -t saved 2>/dev/null; printf 'deleted=%s\\n' \"$?\"; hash -p /bin/tool saved; f() { hash -r; }; f; hash -t saved 2>/dev/null; printf 'reset=%s\\n' \"$?\"");
  assert.equal(result.stdout, "deleted=1\nreset=1\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const [name, target] of [
  ["saved", "/tool dir/tool"],
  ["saved tool", "/tool dir/tool's name"],
  ["saved'tool", "/tool\tdir/tool\nname"],
  ["saved; :", '/$HOME/$(echo expanded)/`echo expanded`/"tool"\\*?[ab]'],
]) {
  test(`hash -l survives a save/source round trip for ${JSON.stringify([name, target])}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { NAME: name!, TARGET: target! } });
    const result = await shell.exec('hash -p "$TARGET" "$NAME"; hash -l >table; hash -r; . ./table; hash -t "$NAME"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${target}\n`);
  });
}

for (const mutation of ["hash -d saved", "hash -r", "hash -p /bin/other saved"]) {
  for (const context of ["subshell", "command substitution", "function subshell"]) {
    test(`${context} keeps ${mutation} separate from the parent hash table`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { PATH: "/bin" } }).use(standardCommands());
      const child = `hash -t saved; ${mutation}; hash -t saved 2>/dev/null; printf 'child=%s\\n' "$?"; hash -p /bin/tool child`;
      const run = context === "subshell" ? `(${child})`
        : context === "command substitution" ? `printf '%s\\n' "$(${child})"`
        : `f() { local value=local; (${child}); }; f`;
      const result = await shell.exec(`hash -p /bin/tool saved; ${run}; hash -t saved; printf 'parent=%s\\n' "$?"; hash -t child 2>/dev/null; printf 'added=%s\\n' "$?"`);
      const changed = mutation.startsWith("hash -p") ? "/bin/other\nchild=0\n" : "child=1\n";
      assert.equal(result.stdout, `/bin/tool\n${changed}/bin/tool\nparent=0\nadded=1\n`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

test("nested subshells copy the immediate parent's hash table", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const result = await shell.exec("hash -p /outer saved; (hash -p /inner saved; (hash -d saved); hash -t saved); hash -t saved");
  assert.equal(result.stdout, "/inner\n/outer\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("brace groups and functions mutate the current shell's hash table", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  const result = await shell.exec("hash -p /bin/tool saved; { hash -d saved; }; hash -t saved 2>/dev/null; printf 'deleted=%s\\n' \"$?\"; hash -p /bin/tool saved; f() { hash -r; }; f; hash -t saved 2>/dev/null; printf 'reset=%s\\n' \"$?\"");
  assert.equal(result.stdout, "deleted=1\nreset=1\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
