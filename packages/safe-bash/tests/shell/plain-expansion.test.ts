import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("alternate parameter operands preserve quoted positional arguments", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('set -- "a b" c; printf \'<%s>\' ${1+"$@"}; echo; for x in ${1+"$@"}; do echo "[$x]"; done; f(){ echo $#; }; f ${1+"$@"}; v=1; f ${v:+"x y" z}');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<a b><c>\n[a b]\n[c]\n2\n2\n");
});

for (const [source, expected] of [
  ['set --; f ${1+"$@"}', '0\n'],
  ['set -- "" "a b"; f ${1+"$@"}', '2\n<>\n<a b>\n'],
  ['set -- "" "a b"; f ${1:+"$@"}', '0\n'],
  ['set -- "a b" c; f pre${1+"$@"}post', '2\n<prea b>\n<cpost>\n'],
  ['set -- 1 2 3 4 5 6 7 8 9 ten; f ${10+"x y" z}', '2\n<x y>\n<z>\n'],
  ['set --; f ${1-"x y" z}', '2\n<x y>\n<z>\n'],
  ['set -- ""; f ${1:-"x y" z}', '2\n<x y>\n<z>\n'],
  ['set -- ""; f ${1-"x y" z}', '0\n'],
  ['set -- "a b"; f ${0+"$@"}', '1\n<a b>\n'],
  ['set -- "a b" c; v=1; f ${v:+${1+"$@"}}', '2\n<a b>\n<c>\n'],
] as const) test(`numbered alternate operand quoting: ${source}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`f(){ echo $#; for x; do printf '<%s>\\n' "$x"; done; }; ${source}`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("shell PID expands in temporary filenames and quoted pipelines", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('tmp=/work/tmp.$$; echo x > "$tmp"; cat "$tmp"; echo "pid=$$" | tr 0-9 N | cut -c1-5');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "x\npid=N\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/tmp.1")), "x\n");
});

test("shell PID remains stable across expansion contexts", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("set -u; echo $$ \"$$\" ${$} \"$BASHPID\"; for i in 1 2; do echo $$; done; (echo $$); echo \"$(echo $$)\"; echo '$$' \\$\\$");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "1 1 1 1\n1\n1\n1\n1\n$$ $$\n");
});

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
