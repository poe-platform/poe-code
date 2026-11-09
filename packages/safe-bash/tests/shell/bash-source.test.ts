import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { Shell } from "../../src/shell/index.js";

for (const middleware of [false, true]) {
  for (const [inner, outerArgs, innerArgs, outerValue, callerValue] of [
    ["set -- inner", "", "", "inner", "inner"],
    ["set -- inner", "", " temp", "inner", "inner"],
    ["set -- inner", " outer", "", "inner", "inner"],
    ["set -- inner", " outer", " temp", "inner", "entry"],
    ["shift", "", "", "", ""],
    ["shift", "", " temp", "entry", "entry"],
    ["shift", " outer", "", "", "entry"],
    ["shift", " outer", " temp", "outer", "entry"],
    [":", "", "", "entry", "entry"],
    [":", "", " temp", "entry", "entry"],
    [":", " outer", "", "outer", "entry"],
    [":", " outer", " temp", "outer", "entry"],
  ]) {
    test(`nested source positionals: ${inner}, outer args=${outerArgs}, inner args=${innerArgs}, middleware=${middleware}`, async t => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/inner", new TextEncoder().encode(inner));
      await fs.writeFile("/outer", new TextEncoder().encode(`. /inner${innerArgs}; echo "outer=<$1>"`));
      const shell = new Shell({ fs }).use(standardCommands());
      t.after(() => shell.dispose());
      if (middleware) shell.use((_context, next) => next());
      const result = await shell.exec(`set -- entry; . /outer${outerArgs}; echo "caller=<$1>"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `outer=<${outerValue}>\ncaller=<${callerValue}>\n`);
    });
  }

  for (const [before, inner, innerArgs, after, outerValue, callerValue] of [
    ["set -- before", ":", "", ":", "before", "entry"],
    ["set -- before", ":", " temp", ":", "before", "entry"],
    ["set -- before", "set -- inner", "", ":", "inner", "inner"],
    ["set -- before", "set -- inner", " temp", ":", "inner", "entry"],
    [":", "set -- inner", "", "set -- after", "after", "after"],
    [":", "set -- inner", " temp", "set -- after", "after", "after"],
  ]) {
    test(`source positional changes around nesting: ${before}, ${inner}, args=${innerArgs}, ${after}, middleware=${middleware}`, async t => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/inner", new TextEncoder().encode(inner));
      await fs.writeFile("/outer", new TextEncoder().encode(`${before}; . /inner${innerArgs}; ${after}; echo "outer=<$1>"`));
      const shell = new Shell({ fs }).use(standardCommands());
      t.after(() => shell.dispose());
      if (middleware) shell.use((_context, next) => next());
      const result = await shell.exec('set -- entry; . /outer outer; echo "caller=<$1>"');
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `outer=<${outerValue}>\ncaller=<${callerValue}>\n`);
    });
  }

  test(`BASH_SOURCE loads siblings and retains function definition paths, middleware=${middleware}`, async t => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work/lib", { recursive: true });
    await fs.writeFile("/work/lib/defaults.sh", new TextEncoder().encode("answer=42"));
    await fs.writeFile("/work/lib/load.sh", new TextEncoder().encode(`
      here=\${BASH_SOURCE[0]%/*}; . "$here/defaults.sh"
      load() { local here=\${BASH_SOURCE[0]%/*}; . "$here/defaults.sh"; echo "$FUNCNAME:\${BASH_SOURCE[0]}:$answer"; }
      printf 'source=%s\\n' "\${BASH_SOURCE[0]}"
    `));
    const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands());
    t.after(() => shell.dispose());
    if (middleware) shell.use((_context, next) => next());
    const result = await shell.exec(`
      source ./lib/load.sh
      printf 'rc=%s answer=%s\\n' "$?" "$answer"
      answer=; load
      printf 'after=<%s>\\n' "\${BASH_SOURCE[*]}"
    `);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "source=./lib/load.sh\nrc=0 answer=42\nload:./lib/load.sh:42\nafter=<>\n");
  });

  test(`BASH_SOURCE restores nested sources and persists with session functions, middleware=${middleware}`, async t => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/lib", { recursive: true });
    await fs.writeFile("/main", new TextEncoder().encode('source /lib/outer; echo "main:${BASH_SOURCE[*]}"'));
    await fs.writeFile("/lib/outer", new TextEncoder().encode(`
      echo "outer:\${BASH_SOURCE[*]}"
      . /lib/inner
      echo "returned:$?:\${BASH_SOURCE[*]}"
      retained() { echo "retained:\${BASH_SOURCE[*]}"; }
    `));
    await fs.writeFile("/lib/inner", new TextEncoder().encode('echo "inner:${BASH_SOURCE[*]}"; return 3'));
    const shell = new Shell({ fs }).use(standardCommands());
    t.after(() => shell.dispose());
    if (middleware) shell.use((_context, next) => next());
    const session = shell.createSession();
    t.after(() => session.dispose());
    const sourced = await session.exec("source /lib/outer");
    assert.equal(sourced.stderr, "");
    assert.equal(sourced.exitCode, 0);
    assert.equal(sourced.stdout, "outer:/lib/outer\ninner:/lib/inner /lib/outer\nreturned:3:/lib/outer\n");
    const later = await session.exec('retained; echo "after:${BASH_SOURCE[*]}"; bash /main; echo "child:${BASH_SOURCE[*]}"');
    assert.equal(later.stderr, "");
    assert.equal(later.exitCode, 0);
    assert.equal(later.stdout, "retained:/lib/outer\nafter:\nouter:/lib/outer /main\ninner:/lib/inner /lib/outer /main\nreturned:3:/lib/outer /main\nmain:/main\nchild:\n");
  });

  for (const maxExpansionBytes of [undefined, 65536]) {
    test(`BASH_SOURCE array expansion matches Bash, middleware=${middleware}, budget=${maxExpansionBytes}`, async t => {
      const input = `
        echo "source:$BASH_SOURCE:\${BASH_SOURCE[0]}:\${#BASH_SOURCE[@]}"
        f() {
          for i in 1 2; do
            a=("\${BASH_SOURCE[@]}")
            echo "$i:\${a[*]}:\${BASH_SOURCE[*]}:\${!BASH_SOURCE[*]}:\${#BASH_SOURCE[@]}"
            echo "\${BASH_SOURCE[-1]}:\${BASH_SOURCE[@]:1}:\${BASH_SOURCE[0]%/*}:\${BASH_SOURCE[1]:-missing}"
            ref=BASH_SOURCE; echo "\${!ref}"
            [[ -v BASH_SOURCE[0] ]] && echo present
            echo "sub:$(echo "\${BASH_SOURCE[*]}")"
            (echo "group:\${BASH_SOURCE[*]}")
          done
        }
        f
        return 7
      `;
      const source = `source /dev/stdin; echo "rc:$?"; f; echo "after:\${BASH_SOURCE[*]}:\${#BASH_SOURCE[@]}"`;
      const nativeSource = source.replace("source /dev/stdin;", `source /dev/stdin <<'SOURCE'\n${input}\nSOURCE\n`);
      const native = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash", ["--noprofile", "--norc", "-c", nativeSource], { encoding: "utf8", timeout: 2000 });
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stderr, "");
      const fs = new MemoryFileSystem();
      await fs.mkdir("/dev", { recursive: true });
      await fs.writeFile("/dev/stdin", new TextEncoder().encode(input));
      const shell = new Shell({ fs, limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } }).use(standardCommands());
      t.after(() => shell.dispose());
      if (middleware) shell.use((_context, next) => next());
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, native.status);
      assert.equal(result.stdout, native.stdout);
    });
  }
}
