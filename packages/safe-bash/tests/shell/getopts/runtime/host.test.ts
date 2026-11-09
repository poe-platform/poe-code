import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Runtime } from "../../../../src/shell/runtime.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import type { ShellInvokeOptions } from "../../../../src/shell/types.js";
import { runtimeSetup } from "./helpers.js";

const runner = 'runner() { say "before:${OPTIND-unset}"; getopts abc opt -abc tail; say "after:$opt:$OPTIND"; envget OPTIND; say ""; }; ';

for (const [spec, args] of [
  ["'aé'", "-a"],
  ["':a'", "-éa"],
  ["'a'", "-éa"],
  ["'é:'", "-é"],
  ["':é🦊a'", "-é🦊a"],
  ["':é:'", "-é雪"],
  ["':é:'", "-é 雪"],
  ["':é:'", "-é"],
  ["$':\\xc3:'", "-é"],
  ["$':\\xffa'", "$'-\\xffa'"],
  ["$':\\xff:'", "$'-\\xff'"],
  ["$':\\xff:'", "$'-\\xffvalue'"],
  ["':a'", "$'-\\xff\\x80a'"],
] as const) {
  for (const route of ["explicit", "positional", "forwarded", "prefix", "loop"]) {
    for (const bounded of [false, true]) test(`getopts scans option bytes: ${spec}, ${args}, ${route}, bounded=${bounded}`, async () => {
      const { shell } = runtimeSetup();
      const report = 'printf "%s|%s|%s|%s\\n" "$?" "${o-unset}" "${OPTARG-unset}" "$OPTIND"';
      const scan = `${route === "prefix" ? "o=old " : ""}getopts ${spec} o${route === "explicit" ? ` ${args}` : route === "forwarded" ? ' "$@"' : ""}`;
      const source = `set -- ${args}; ${route === "loop" ? `while ${scan}; do ${report}; done; ${report}` : `for n in 1 2 3 4 5 6 7 8; do ${scan}; ${report}; done`}`;
      try {
        const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source, "shell"], { env: { ...process.env, LC_ALL: "C" } });
        assert.equal(native.status, 0, native.stderr.toString());
        const result = await shell.exec(source, bounded ? { limits: { maxExpansionBytes: 65536 } } : {});
        assert.equal(result.exitCode, native.status, result.stderr);
        assert.deepEqual(result.stdoutBytes, new Uint8Array(native.stdout));
        assert.deepEqual(result.stderrBytes, new Uint8Array(native.stderr));
      } finally { await shell.dispose(); }
    });
  }
}

for (const exported of [false, true]) for (const variant of ["omitted", "merge-empty", "replace-empty", "same-merge", "same-replace", "changed-merge", "changed-replace"] as const) {
  test(`D03 effective child binding: ${exported ? "exported" : "unexported"}/${variant}`, async () => {
    const { shell, commands } = runtimeSetup();
    const options: ShellInvokeOptions = variant === "omitted" ? {} : variant === "merge-empty" ? { env: {} } : variant === "replace-empty" ? { replaceEnv: true } : { env: { OPTIND: variant.startsWith("changed") ? "0" : "1" }, ...(variant.endsWith("replace") ? { replaceEnv: true } : {}) };
    commands.register({ name: "host", async execute(context) {
      await context.invoke!("runner", [], options);
      return context.invoke!("runner", [], options);
    } });
    const result = await shell.exec(runner + `getopts abc opt -abc tail; ${exported ? "export OPTIND; " : ""}host; getopts abc opt -abc tail; say "parent:$opt:$OPTIND"; envget OPTIND`);
    const removed = exported && variant === "replace-empty";
    const changed = variant.startsWith("changed");
    const promotion = variant.startsWith("same") || changed;
    const child = `before:${removed ? "unset" : changed ? "0" : "1"}\nafter:${removed || changed ? "a" : "b"}:1\n${promotion || exported && !removed ? "1" : "<unset>"}\n`;
    assert.equal(result.stdout, child + child + `parent:b:1\n${exported ? "1" : "<unset>"}`);
    assert.equal(result.stderr, "");
  });
}

test("absent-to-absent child overlay preserves a hidden cursor without fresh defaults", async () => {
  const { shell, commands } = runtimeSetup();
  commands.register({ name: "host", execute(context) { return context.invoke!("runner", [], { replaceEnv: true }); } });
  let writes = 0;
  const result = await shell.exec('runner() { say "${OPTIND-unset}"; getopts ab opt -zab; say "$opt"; }; unset OPTIND; getopts ab opt -zab; host; getopts ab opt -zab; say "$opt"', { stderr: { async write() { if (++writes === 1) throw new Error("intentional parser sink failure"); } } });
  assert.equal(result.stdout, "unset\na\na\n");
});

test("forwarded exported omission removes child only, unexported omission survives", async () => {
  for (const exported of [false, true]) {
    const { shell, commands } = runtimeSetup();
    commands.register({ name: "host", execute(context) { delete context.env.OPTIND; return context.invoke!("runner", []); } });
    const result = await shell.exec(runner + `getopts abc opt -abc tail; ${exported ? "export OPTIND; " : ""}host; getopts abc opt -abc tail; say "$opt"`);
    assert.equal(result.stdout, exported ? "before:unset\nafter:a:1\n<unset>\nb\n" : "before:1\nafter:b:1\n<unset>\nb\n");
  }
});

test("undefined environment value is invalid, never a removal sentinel", async () => {
  const { shell, commands } = runtimeSetup();
  commands.register({ name: "host", async execute(context) {
    await assert.rejects(context.invoke!("getopts", ["abc", "opt", "-abc"], { replaceEnv: true, env: { OPTIND: undefined } as unknown as Record<string, string> }), TypeError);
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec('getopts abc opt -abc; host; getopts abc opt -abc; say "$opt"')).stdout, "b\n");
});

test("unchanged middleware copies do not reset and literal invoke is not re-expanded", async () => {
  const { shell, commands } = runtimeSetup();
  const seen: string[] = [];
  shell.use(async (context, next) => { seen.push(context.command); context.env = { ...context.env }; return next(); });
  commands.register({ name: "host", execute(context) { return context.invoke!("getopts", ["a:", "literal", "-a", "$(say forbidden)"]); } });
  const result = await shell.exec('getopts abc opt -abc; export OPTIND; host; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "b\n");
  assert.equal(seen.filter(name => name === "getopts").length, 3);
  assert.equal(seen.filter(name => name === "say").length, 1);
});

test("direct middleware pairs hidden restoration with actual visible restoration", async () => {
  const { shell } = runtimeSetup();
  let count = 0;
  shell.use(async (context, next) => {
    if (context.command === "getopts" && ++count === 2) context.env.OPTIND = "1";
    return next();
  });
  const result = await shell.exec('getopts abcd opt -a -b; export OPTIND; getopts abcd opt -abc; say "$OPTIND"; getopts abcd opt -acd -b; say "$opt:$OPTIND"');
  assert.equal(result.stdout, "2\nb:3\n");
});

test("direct middleware does not unconditionally restore after visible publication differs", async () => {
  const { shell } = runtimeSetup();
  let count = 0;
  shell.use(async (context, next) => {
    if (context.command === "getopts" && ++count === 3) context.env.OPTIND = "0";
    return next();
  });
  const result = await shell.exec('getopts abc opt -abc; getopts abc opt -abc; export OPTIND; getopts abc opt -abc; say "$opt"; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "a\nb\n");
});

test("same Budget object and existing command admission, no scanner ticks or loop charges", async () => {
  const { shell } = runtimeSetup();
  const original = Runtime.prototype.builtin;
  const budgets: Runtime["budget"][] = [];
  Runtime.prototype.builtin = async function (...args) {
    if (args[0].command !== "getopts") return original.apply(this, args);
    budgets.push(this.budget);
    const before = { commands: this.budget.commands, iterations: this.budget.iterations, sourceBytes: this.budget.sourceBytes };
    const result = await original.apply(this, args);
    assert.deepEqual({ commands: this.budget.commands, iterations: this.budget.iterations, sourceBytes: this.budget.sourceBytes }, before);
    return result;
  };
  try {
    assert.equal((await shell.exec('getopts a opt -a; command getopts a opt -a', { limits: { maxCommands: 3 } })).exitCode, 1);
    assert.equal(budgets.length, 2);
    assert.equal(budgets[0], budgets[1]);
    assert.equal(budgets[0]!.commands, 3);
    await assert.rejects(shell.exec('getopts a opt -a; command getopts a opt -a', { limits: { maxCommands: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxCommands");
  } finally { Runtime.prototype.builtin = original; }
});

test("per-word byte ceilings do not become an aggregate argv byte pool", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('getopts a opt -aaaaaa -aaaaaa -aaaaaa', { limits: { maxExpansionBytes: 7, maxExpansionFields: 8, maxCommands: 1 } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
});

for (const mode of ["bytes", "fields"] as const) {
  test(`middleware bypass still observes shared ${mode} limit`, async () => {
    const { shell } = runtimeSetup();
    shell.use(async (context, next) => {
      if (context.command === "getopts") Object.assign(context, { args: mode === "bytes" ? ["a", "opt", "-" + "a".repeat(100)] : ["a", "opt", ...Array.from({ length: 20 }, () => "-a")] });
      return next();
    });
    await assert.rejects(shell.exec('getopts a opt -a', { limits: { maxExpansionBytes: 16, maxExpansionFields: 8 } }), error => error instanceof ShellLimitError && error.limit === (mode === "bytes" ? "maxExpansionBytes" : "maxExpansionFields"));
  });
}

test("shared output and loop failures retain their existing limit identities", async () => {
  const { shell } = runtimeSetup();
  for (const [source, limits, limit] of [
    ['getopts a opt -z', { maxOutputBytes: 0 }, "maxOutputBytes"],
    ['while getopts a opt -a -a; do :; done', { maxLoopIterations: 1 }, "maxLoopIterations"],
  ] as const) await assert.rejects(shell.exec(source, { limits }), error => error instanceof ShellLimitError && error.limit === limit);
});

test("caller timeout signal is observed at real helper checkpoints, no new deadline API", { timeout: 2000 }, async () => {
  const { shell } = runtimeSetup();
  const controller = new AbortController();
  const reason = new Error("caller timer");
  let timer: ReturnType<typeof setTimeout> | undefined;
  shell.use(async (context, next) => {
    if (context.command === "getopts") {
      Object.assign(context, { args: ["a".repeat(100_000), "opt", "-a"] });
      timer = setTimeout(() => controller.abort(reason), 0);
    }
    return next();
  });
  try { await assert.rejects(shell.exec('getopts a opt -a', { signal: controller.signal }), error => error === reason); }
  finally { clearTimeout(timer); await shell.dispose(); }
});

for (const value of ["a\\xffb", "a\\x80b", "ASCII", "雪🙂"]) {
  for (const attached of [false, true]) {
    for (const route of ["explicit", "positional", "function", "forwarded", "loop"]) {
      for (const bounded of [false, true]) test(`getopts preserves argument bytes: ${route}, attached=${attached}, bounded=${bounded}, ${value}`, async () => {
        const { shell } = runtimeSetup();
        const args = attached ? `-b$'${value}'` : `-b $'${value}'`;
        const report = 'printf "%s:%s:%s:" "$?" "$flag" "$OPTIND"; printf "%s" "$OPTARG"';
        const source = route === "explicit" ? `getopts b: flag ${args}; ${report}`
          : route === "function" ? `f() { getopts b: flag; ${report}; }; f ${args}`
          : route === "forwarded" ? `set -- ${args}; getopts b: flag "$@"; ${report}`
          : route === "loop" ? `set -- ${args}; while getopts b: flag; do ${report}; done`
          : `set -- ${args}; getopts b: flag; ${report}`;
        try {
          const result = await shell.exec(source, bounded ? { limits: { maxExpansionBytes: 65536 } } : {});
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          const bytes = value === "a\\xffb" ? [97, 255, 98] : value === "a\\x80b" ? [97, 128, 98] : new TextEncoder().encode(value);
          assert.deepEqual(result.stdoutBytes, Uint8Array.from([...new TextEncoder().encode(`0:b:${attached ? 2 : 3}:`), ...bytes]));
          const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { env: { ...process.env, LC_ALL: "C" } });
          assert.equal(native.status, result.exitCode, native.stderr?.toString());
          assert.deepEqual(new Uint8Array(native.stdout), result.stdoutBytes);
          assert.equal(native.stderr.length, 0);
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const args of ["-ab$'\\xff' -b $'\\x80'", "-ab $'\\xff' -b$'\\x80'"]) {
  test(`getopts preserves distinct bytes across cached clustered scans: ${args}`, async () => {
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(`set -- ${args}; while getopts ab: flag; do if [ "$flag" = b ]; then printf '%s' "$OPTARG"; fi; done`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 128));
    } finally { await shell.dispose(); }
  });
}

test("changing to a Unicode specification retains the cluster cursor and Unicode argument values", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('getopts ab opt -ab; getopts é opt -a; say "$?:$opt:$OPTIND"; getopts ab opt -ab; say "$opt"; OPTIND=1; getopts a: opt -a "雪🙂"; say "$OPTARG"');
  const native = spawnSync("bash", ["--noprofile", "--norc", "-c", 'getopts ab opt -ab; getopts é opt -a; printf "%s:%s:%s\\n" "$?" "$opt" "$OPTIND"; getopts ab opt -ab; printf "%s\\n" "$opt"; OPTIND=1; getopts a: opt -a "雪🙂"; printf "%s\\n" "$OPTARG"'], { env: { ...process.env, LC_ALL: "C" } });
  assert.deepEqual(result.stdoutBytes, new Uint8Array(native.stdout));
  assert.equal(result.stderr, "shell: illegal option -- a\n");
});
