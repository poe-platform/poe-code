import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const keywords = ["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "{", "}", "!", "[[", "]]", "time", "select", "coproc"];

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
