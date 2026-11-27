import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { agentCommands, createMemoryFileSystem, Shell } from "../../src/core.js";

for (const middleware of [false, true]) {
  for (const maxExpansionBytes of [undefined, 65536]) {
    test(`function stack logging: middleware=${middleware}, budget=${maxExpansionBytes}`, async t => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/work");
      const shell = new Shell({ fs, cwd: "/work", limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } }).use(agentCommands());
      t.after(() => shell.dispose());
      if (middleware) shell.use((_context, next) => next());
      const result = await shell.exec('log() { echo "${FUNCNAME[1]}:${BASH_LINENO[0]}: $*"; }; f() { echo "${FUNCNAME[@]} | ${#FUNCNAME[@]} | ${BASH_LINENO[@]}"; log inner; }; f; log top');
      assert.equal(result.stdout, "f main | 2 | 1 0\nf:1: inner\nmain:1: top\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });

    test(`function call-site lines and restoration: middleware=${middleware}, budget=${maxExpansionBytes}`, async t => {
      const shell = new Shell({ fs: createMemoryFileSystem(), limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } }).use(agentCommands());
      t.after(() => shell.dispose());
      if (middleware) shell.use((_context, next) => next());
      const result = await shell.exec([
        'log() { echo "${FUNCNAME[*]}|${BASH_LINENO[*]}"; }',
        'outer() {',
        '  log',
        '  echo "$(log)"',
        '  (log)',
        '  for i in 1 2; do log; done',
        '  return 7',
        '}',
        'outer',
        'echo "status:$?"',
        'log',
        'echo "after:${FUNCNAME[*]}|${BASH_LINENO[*]}"',
      ].join("\n"));
      assert.equal(result.stdout, "log outer main|3 9 0\nlog outer main|4 9 0\nlog outer main|5 9 0\nlog outer main|6 9 0\nlog outer main|6 9 0\nstatus:7\nlog main|11 0\nafter:|0\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });

    for (const [name, source] of [
      ["scalar and indexed line expansions", [
        'f() {',
        '  for i in 1 2; do',
        '    ref=BASH_LINENO; local -n alias=BASH_LINENO',
        '    echo "$BASH_LINENO:${!ref}:$alias:${#BASH_LINENO[@]}:${!BASH_LINENO[*]}"',
        '    echo "$((BASH_LINENO)):$((BASH_LINENO[0])):$((BASH_LINENO[1])):${BASH_LINENO[-1]}"',
        '    value=$BASH_LINENO; printf "%s\\n" "$value" "${BASH_LINENO[@]:1}"',
        '    [[ -v BASH_LINENO[0] && -v FUNCNAME[1] ]] && echo present',
        '    for ((j=0;j<2;j++)); do n=$((BASH_LINENO+1)); echo "$n"; done',
        '  done',
        '}',
        'f',
      ].join("\n")],
      ["source inside a function", 'f() { source /dev/stdin <<\'SOURCE\'\necho "$FUNCNAME:${FUNCNAME[*]}|${BASH_LINENO[*]}"\nSOURCE\n}; f'],
      ["child command string", "bash -c 'f() { echo \"${FUNCNAME[*]}|${BASH_LINENO[*]}\"; (echo \"${FUNCNAME[*]}|${BASH_LINENO[*]}\"); }; f'"],
      ["child standard input", "bash -s <<'SOURCE'\nf() { echo \"${FUNCNAME[*]}|${BASH_LINENO[*]}\"; }; f\nSOURCE"],
    ] as const) {
      test(`function stack ${name}: middleware=${middleware}, budget=${maxExpansionBytes}`, async t => {
        const native = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash", ["--noprofile", "--norc", "-c", 'exec "$BASH" /dev/stdin <<< "$1"', "bash", source], { encoding: "utf8", env: { LC_ALL: "C" }, timeout: 2000 });
        assert.ifError(native.error);
        assert.equal(native.status, 0, native.stderr);
        const shell = new Shell({ fs: createMemoryFileSystem(), limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } }).use(agentCommands());
        t.after(() => shell.dispose());
        if (middleware) shell.use((_context, next) => next());
        const result = await shell.exec(source);
        assert.equal(result.stdout, native.stdout);
        assert.equal(result.stderr, native.stderr);
        assert.equal(result.exitCode, native.status);
      });
    }
  }
}
