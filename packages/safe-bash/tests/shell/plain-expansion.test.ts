import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const wrap of [(s: string) => s, (s: string) => `for i in 1 2; do ${s}; done`, (s: string) => `f() { ${s}; }; f; f`, (s: string) => `echo "$(${s})"`]) {
  test(`plain case patterns expand home: ${wrap("case")}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const source = `HOME=/home/alice; ${wrap('case /home/alice/foo in (~/foo) echo matched ;; (*) echo wrong ;; esac')}`;
    const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(expected.error, undefined);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, expected.status);
    assert.equal(result.stdout, expected.stdout);
  });
}

for (const target of ["~/out", "~", "/{a,b}.txt", "/*.log", "/existing.lo?", "/existing.[l]og"]) {
  test(`plain redirect expands ${target} on repeated execution`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/home/alice", { recursive: true });
    await fs.writeFile("/in.txt", new TextEncoder().encode("line1\nline2\n"));
    await fs.writeFile("/existing.log", new TextEncoder().encode("old\n"));
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`HOME=/home/alice; for i in 1 2; do head -n 1 /in.txt > ${target}; done`);
    if (target === "~" || target.includes("{")) {
      assert.equal(result.exitCode, 1);
    } else {
      assert.equal(result.exitCode, 0);
      assert.equal(new TextDecoder().decode(await fs.readFile(target === "~/out" ? "/home/alice/out" : "/existing.log")), "line1\n");
    }
  });
}

for (const [subject, pattern] of [["/home/alice", "~"], ["/", "~+"], ["/old", "~-"], ["~/foo", '"~/foo"'], ["x~y", "x~y"]]) {
  test(`case preserves tilde semantics for ${pattern}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`HOME=/home/alice; OLDPWD=/old; for i in 1 2; do case '${subject}' in ${pattern}) echo matched ;; *) echo wrong ;; esac; done`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "matched\nmatched\n");
  });
}
