import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const names of [
  ["prefix-\uf000", "prefix-\u{11000}"],
  ["prefix-\ue000", "prefix-\u{10000}"],
  ["prefix-A", "prefix-z", "prefix-é", "prefix-中", "prefix-\ufeff", "prefix-\uffff", "prefix-😀"],
] as const) {
  for (const pattern of ["prefix-*", "*/prefix-*", "**/prefix-*"]) {
    test(`filename expansion uses C UTF-8 byte order: ${pattern} ${names.join(",")}`, async () => {
      const { shell, fs, commands } = setup({ env: { LC_ALL: "C" } });
      commands.register(basicCommands().find(command => command.name === "printf")!);
      const directory = pattern === "prefix-*" ? "" : "nested/";
      if (directory) await fs.mkdir("/nested", { recursive: true });
      // Insert in reverse order so provider enumeration cannot supply the answer.
      for (const name of [...names].reverse()) await fs.writeFile(`/${directory}${name}`, new Uint8Array());
      try {
        const result = await shell.exec(`${pattern.startsWith("**") ? "shopt -s globstar; " : ""}printf '%s\\n' ${pattern}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(names.map(name => `${directory}${name}\n`).join("")));
      } finally { await shell.dispose(); }
    });
  }
}

for (const [source, expected] of [
  ["set -f; printf '<%s>' *.txt", "<*.txt>"],
  ["set -f; args *.txt; set +f; args *.txt", '["*.txt"]["alpha.txt"]'],
  ["set -o noglob; args *.txt; set +o noglob; args *.txt", '["*.txt"]["alpha.txt"]'],
  ["set -uf; args *.txt; set +uf; args *.txt", '["*.txt"]["alpha.txt"]'],
  ["set -f; value='*.txt other'; args $value {a,b}*.txt", '["*.txt","other","a*.txt","b*.txt"]'],
  ["set -f; (set +f; args *.txt); args *.txt", '["alpha.txt"]["*.txt"]'],
  ["set -f; args $(say '*.txt'); args \"$(set +f; args *.txt)\"; args *.txt", '["*.txt"]["[\\"alpha.txt\\"]"]["*.txt"]'],
  ["disable() { set -f; }; disable; eval 'args *.txt'", '["*.txt"]'],
  ["set -f; case alpha.txt in *.txt) say match;; esac; [[ alpha.txt == *.txt ]] && say conditional", "match\nconditional\n"],
  ["set -f; [[ -o noglob ]] && say enabled; case $- in *f*) say flag;; esac; set +f; [[ -o noglob ]] || say disabled", "enabled\nflag\ndisabled\n"],
] as const) {
  test(`noglob: ${source}`, async () => {
    const { shell, fs, commands } = setup();
    for (const command of basicCommands()) if (command.name === "printf") commands.register(command);
    await fs.writeFile("/alpha.txt", new TextEncoder().encode("a"));
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
}

test("noglob option listings reflect state", async () => {
  const { shell } = setup();
  const result = await shell.exec("set -f; set -o; set +o");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.includes("noglob\ton\n"));
  assert.ok(result.stdout.includes("set -o noglob\n"));
});

test("noglob matches native Bash expansion and pattern semantics", async () => {
  const source = String.raw`set -uf; value='*.txt other'; printf '<%s>' *.txt $value {a,b}*.txt; case alpha.txt in *.txt) printf match;; esac; [[ alpha.txt == *.txt ]] && printf conditional; set +uf; [[ -o noglob ]] || printf disabled`;
  const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], {
    cwd: "/", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, timeout: 2000,
  });
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  const { shell, fs, commands } = setup();
  for (const command of basicCommands()) if (command.name === "printf") commands.register(command);
  await fs.writeFile("/alpha.txt", new TextEncoder().encode("a"));
  const result = await shell.exec(source);
  assert.equal(result.exitCode, native.status);
  assert.deepEqual(result.stdoutBytes, new Uint8Array(native.stdout));
  assert.deepEqual(result.stderrBytes, new Uint8Array(native.stderr));
});
