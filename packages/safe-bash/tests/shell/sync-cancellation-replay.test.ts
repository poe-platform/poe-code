import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { agentCommands, MemoryFileSystem, Shell } from "../../src/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const originalReplayCases = [
  ["group", 'x=0; v="a b"; { x=$((x+1)); echo "ran:$x"; echo $v; }; echo "final:$x"', "ran:1\na b\nfinal:1\n"],
  ["if", 'x=0; v="a b"; if [ $x -eq 0 ]; then x=$((x+1)); echo "ran:$x"; echo $v; fi; echo "final:$x"', "ran:1\na b\nfinal:1\n"],
  ["case", 'x=0; v="a b"; case "ok" in ok) x=$((x+1)); echo "ran:$x"; echo $v ;; esac; echo "final:$x"', "ran:1\na b\nfinal:1\n"],
  ["eval", 'x=0; v="a b"; eval \'x=$((x+1)); echo "ran:$x"; echo $v\'; echo "final:$x"', "ran:1\na b\nfinal:1\n"],
  ["function arguments", 'f() { x=$((x+1)); echo "ran:$x:$1"; echo $v; }; x=0; v="a b"; f arg1; echo "final:$x"', "ran:1:arg1\na b\nfinal:1\n"],
  ["while duplicate", 'i=0; v="hello"; while [ $i -lt 5 ]; do echo "iter:$i"; if [ $i -eq 3 ]; then v="a b c"; fi; echo $v; i=$((i + 1)); done', "iter:0\nhello\niter:1\nhello\niter:2\nhello\niter:3\na b c\niter:4\na b c\n"],
  ["while skip", 'i=0; v="hello"; while [ $i -lt 5 ]; do i=$((i + 1)); echo "iter:$i"; if [ $i -eq 3 ]; then v="a b c"; fi; echo $v; done', "iter:1\nhello\niter:2\nhello\niter:3\na b c\niter:4\na b c\niter:5\na b c\n"],
] as const;

for (const [name, source, expected] of [
  ...originalReplayCases,
  ...originalReplayCases.filter(([name]) => name.startsWith("while")).map(([name, source, expected]) =>
    [name.replace("while", "until"), source.replace("while [ $i -lt 5 ]", "until [ $i -ge 5 ]"), expected] as const),
]) {
  test(`original replay control: ${name}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.ifError(native.error);
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stdout, expected);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
}

for (const [kind, source] of [
  ["while", "i=0; while ((i<300000)); do ((i++)); done"],
  ["until", "i=0; until ((i>=300000)); do ((i++)); done"],
  ["while pipeline", "i=0; while ((i<300000)); do ((i++)); done | pass"],
  ["until pipeline", "i=0; until ((i>=300000)); do ((i++)); done | pass"],
  ["arithmetic for", "for ((i=0;i<300000;i++)); do :; done"],
] as const) {
  for (const cancellation of ["timer", "timeout"] as const) {
    test(`${kind} observes 30ms ${cancellation} cancellation before completing`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const controller = new AbortController();
      const signal = cancellation === "timeout" ? AbortSignal.timeout(30) : controller.signal;
      const timer = cancellation === "timer" ? setTimeout(() => controller.abort(false), 30) : undefined;
      const started = performance.now();
      try {
        await assert.rejects(shell.exec(source, { signal }), error => signal.aborted && error === signal.reason);
        assert.ok(performance.now() - started < 2000, "cancellation must not wait for the complete loop");
        assert.equal((await shell.exec("say recovered")).stdout, "recovered\n");
      } finally { clearTimeout(timer); }
    });
  }
}

for (const terminator of [";&", ";;&"]) {
  for (const redirect of ["", ">/result"]) {
    test(`case ${terminator} retains completed effects across fallback ${redirect}`, async context => {
      const { shell, fs, commands } = setup();
      for (const command of basicCommands()) commands.register(command);
      context.after(() => shell.dispose());
      const nextPattern = terminator === ";&" ? "unmatched" : "yes";
      const body = `case yes in yes) ((count+=1)); echo prefix; x=1; x=(1 2) ${terminator} ${nextPattern}) ((count+=1)); echo tail;; esac`;
      const source = `${"true; ".repeat(40)}count=0; unset x; ${body} ${redirect}; echo "count=$count:x=\${x[1]}"`;
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${redirect ? "" : "prefix\ntail\n"}count=2:x=2\n`);
      if (redirect) assert.equal(new TextDecoder().decode(await fs.readFile("/result")), "prefix\ntail\n");
    });
  }
}

const wrappers = {
  group: (body: string) => `{ ${body}; }`,
  if: (body: string) => `if true; then ${body}; fi`,
  case: (body: string) => `case yes in yes) ${body};; esac`,
  eval: (body: string) => `eval '${body}'`,
  function: (body: string) => `f() { ${body}; }; f`,
};

for (const header of ["for ((i=0;i<2;i++))", "for i in {1..2}"]) {
  for (const body of ["echo ~", "if ((1)); then echo ~; fi"]) {
    test(`bounded loop retains tilde expansion: ${header} ${body}`, async context => {
      const { shell, commands } = setup({ env: { HOME: "/home" } });
      for (const command of basicCommands()) commands.register(command);
      context.after(() => shell.dispose());
      const result = await shell.exec(`${header}; do ${body}; done`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "/home\n/home\n");
    });
  }
}

for (const [name, wrap] of Object.entries(wrappers)) {
  for (const kind of ["while", "until"]) {
    for (const transition of [1, 2050]) {
      test(`${name} in ${kind} preserves progress at iteration ${transition}`, async context => {
        const { shell, commands } = setup();
        for (const command of basicCommands()) commands.register(command);
        context.after(() => shell.dispose());
        const condition = kind === "while" ? `i<${transition + 1}` : `i>=${transition + 1}`;
        const body = wrap('((hits+=1)); echo prefix; x=1; x=(1 2); echo "x=${x[1]}"');
        const source = `${"true; ".repeat(40)}i=0; count=0; hits=0; unset x; ${kind} ((${condition})); do ((i+=1)); ((count+=1)); if ((i==${transition})); then ${body}; fi; done; echo "$i:$count:$hits"`;
        const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
        assert.ifError(native.error);
        assert.equal(native.status, 0, native.stderr);
        assert.equal(native.stdout, `prefix\nx=2\n${transition + 1}:${transition + 1}:1\n`);
        const result = await shell.exec(source);
        assert.equal(result.exitCode, native.status, result.stderr);
        assert.equal(result.stderr, native.stderr);
        assert.equal(result.stdout, native.stdout);
      });
    }
  }
}

for (const kind of ["while", "until"]) {
  test(`${kind} yields without an external signal and preserves arithmetic state`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    let yielded = false;
    const timer = setImmediate(() => { yielded = true; });
    try {
      const condition = kind === "while" ? "i<3000" : "i>=3000";
      const result = await shell.exec(`i=0; count=0; ${kind} ((${condition})); do ((i+=1)); ((count+=i)); done; say "$i:$count"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "3000:4501500\n");
      assert.equal(yielded, true, "a long loop must give other event-loop work a turn");
    } finally { clearImmediate(timer); }
  });

  for (const control of ["break", "continue", "return 7"]) {
    for (const redirect of ["", ">/result"]) {
      test(`${kind} preserves ${control} after fallback ${redirect}`, async context => {
        const { shell, commands, fs } = setup();
        for (const command of basicCommands()) commands.register(command);
        context.after(() => shell.dispose());
        const condition = kind === "while" ? "i<3" : "i>=3";
        const source = `${"true; ".repeat(40)}marker=outer; i=0; count=0; unset x; f() { local marker=inner; ${kind} ((${condition})); do ((i+=1)); ((count+=1)); echo "prefix:$i"; if ((i==2)); then x=1; x=(1 2); ${control}; fi; echo "tail:$i"; done; }; f ${redirect}; echo "$?:$i:$count:$marker:\${x[1]}"`;
        const loopOutput = control === "continue" ? "prefix:1\ntail:1\nprefix:2\nprefix:3\ntail:3\n" : "prefix:1\ntail:1\nprefix:2\n";
        const summary = control === "continue" ? "0:3:3:outer:2\n" : `${control === "return 7" ? 7 : 0}:2:2:outer:2\n`;
        const result = await shell.exec(source);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, `${redirect ? "" : loopOutput}${summary}`);
        if (redirect) assert.equal(new TextDecoder().decode(await fs.readFile("/result")), loopOutput);
      });
    }
  }
}
