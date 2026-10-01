import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/shell.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";

const loops = [
  ["brace range", "for i in {1..3}", ""],
  ["array", 'items=(1 2 3); for i in "${items[@]}"', ""],
  ["seq", "for i in $(seq 1 3)", ""],
  ["arithmetic for", "for ((i=1; i<=3; i++))", ""],
  ["while", "i=0; while ((i<3))", "((i+=1)); "],
  ["until", "i=0; until ((i>=3))", "((i+=1)); "],
] as const;

async function assertBashMatch(shell: Shell, source: string, env: Record<string, string> = {}): Promise<void> {
  const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], {
    encoding: "utf8", env: { PATH: process.env.PATH, ...env },
  });
  assert.equal(expected.error, undefined);
  assert.equal(expected.signal, null);
  const result = await shell.exec(source, { env });
  assert.equal(result.stdout, expected.stdout, source);
  assert.equal(result.stderr, expected.stderr, source);
  assert.equal(result.exitCode, expected.status, source);
}

for (const [name, header, prefix] of loops) {
  test(`${name} preserves echo stdout and the final argument`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    await assertBashMatch(shell, `${header}; do ${prefix}echo "hello_$i"; done; echo "last=$_"`);
  });

  for (const body of [
    "[[ $i == 9 ]]",
    '[[ "$i" == "9" ]]',
    "((i == 9))",
    "if [[ $i == 3 ]]; then ((0)); else ((1)); fi",
    "if [[ $i == 9 ]]; then ((0)); fi",
    "[[ $i == 9 ]] && ((1))",
    "[[ $i == 9 ]] || ((0))",
    "[[ $i == 9 ]] || ((1))",
    "if ((i<3)); then ((1)); else ((0)); fi",
    "if ((i<3)); then ((0)); fi",
    "case $i in 3) ((0));; *) ((1));; esac",
    "for j in 1 2; do ((0)); done",
    "for ((j=0; j<2; j++)); do ((0)); done",
  ]) {
    test(`${name} preserves the exit status of ${body}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
      context.after(() => shell.dispose());
      const source = `${header}; do ${prefix}${body}; done`;
      await assertBashMatch(shell, source);
      await assertBashMatch(shell, `${source}; echo "status=$? pipe=\${PIPESTATUS[*]}"`);
    });
  }

  for (const [body, expected] of [
    ["echo a > /result; echo b >> /result", "a\nb\n"],
    ["echo a > /result || echo b >> /result", "a\n"],
    ["echo a > /result && echo b >> /result", "a\nb\n"],
    ["[[ $i == 9 ]] || echo a > /result || echo b >> /result", "a\n"],
    ["[[ $i == 9 ]] && echo a > /result; echo b >> /result", "b\nb\nb\n"],
    ["[[ $i == 9 ]] && echo a > /result || echo b >> /result", "b\nb\nb\n"],
    ["echo a > /result || echo b >> /result && echo c >> /result", "a\nc\n"],
  ]) {
    test(`${name} preserves redirected list effects: ${body}`, async context => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(standardCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`${header}; do ${prefix}${body}; done`);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "");
      assert.equal(result.exitCode, 0);
      assert.equal(new TextDecoder().decode(await fs.readFile("/result")), expected);
    });
  }

  test(`${name} expands redirected output after the preceding command completes`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`${header}; do ${prefix}((0)); echo "before_$?" > /result; echo "after_$?" >> /result; done`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/result")), "before_1\nafter_0\n");
  });

  test(`${name} re-expands each redirect target with the preceding status`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`${header}; do ${prefix}((0)); echo a > "/result_$?"; echo b >> "/result_$?"; done`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/result_1")), "a\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/result_0")), "b\nb\nb\n");
  });
}

for (const header of ["for i in", "for ((i=0; i<0; i++))"]) {
  test(`empty loop returns success without evaluating its body: ${header}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    await assertBashMatch(shell, `value=before; false; ${header}; do value=after; ((0)); done; echo "$?:\${PIPESTATUS[*]}:$value"`);
  });
}

for (const body of [
  "case x in y) ((1));; esac",
  "for j in; do ((1)); done",
  "for ((j=0; j<0; j++)); do ((1)); done",
]) {
  test(`an empty compound body preserves the previous pipeline vector: ${body}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    await assertBashMatch(shell, `false | true; for i in {1..2}; do ${body}; done; echo "$?:\${PIPESTATUS[*]}"`);
  });
}

for (const body of [
  "if ((i==1)); then ((0)); fi",
  "[[ \"$i\" == \"1\" ]]",
  "j=0; while ((j<1)); do ((j+=1)); done",
  "j=0; until ((j>=1)); do ((j+=1)); ((0)); done",
  "if ((i==2)); then continue; fi",
  "if ((i==2)); then break; fi",
]) {
  test(`pipeline completion preserves the last argument: ${body}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    await assertBashMatch(shell, `for i in {1..2}; do echo marker; ${body}; done; echo "arg=$_ status=$? pipe=\${PIPESTATUS[*]}"`);
  });
}

for (const header of ["while [[ -v \"$ref\" ]]", "until [[ ! -v \"$ref\" ]]"]) {
  test(`a variable-presence condition can require full evaluation after an iteration: ${header}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    await assertBashMatch(shell, `value=defined; ref=value; count=0; ${header}; do
      ((count+=1)); if ((count==2)); then break; fi; ref='value[0+0]'
    done; echo "$count"`);
  });
}

test("a function call publishes its aggregate status after the inner loop condition", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  await assertBashMatch(shell, 'f() { j=0; until ((j>=1)); do ((j+=1)); ((0)); done; }; for i in {1..2}; do f argument; done; echo "$?:${PIPESTATUS[*]}:$_"');
});

for (const env of [{ LANG: "en_US.UTF-8" }, { LC_ALL: "C" }, { LC_ALL: "C.UTF-8" }] as const) {
  for (const operand of ["a", "é"]) {
    test(`loop comparisons preserve positive and negative results: ${JSON.stringify(env)}, ${operand}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
      context.after(() => shell.dispose());
      await assertBashMatch(shell, `x=${operand}; for i in {1..2}; do
        if [[ $x < b ]]; then r1=yes; else r1=no; fi
        if [[ ! ($x < b) ]]; then r2=yes; else r2=no; fi
        echo "$r1:$r2"
      done`, env);
    });
  }
}

for (const [name, header, prefix] of loops) {
  test(`${name} fully evaluates variable-presence subscripts`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    await assertBashMatch(shell, `value=defined; ${header}; do ${prefix}
      if [[ -v "value[0+0]" ]]; then result=yes; else result=no; fi
      if [[ ! -v "value[0+0]" ]]; then inverse=yes; else inverse=no; fi
      echo "$result:$inverse"
    done`);
    await assertBashMatch(shell, `value=defined; ${header}; do ${prefix}[[ -v "value[0+0]" ]]; done`);
  });

  test(`${name} evaluates arithmetic conditional operands fully`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    await assertBashMatch(shell, `value=1; ${header}; do ${prefix}
      if [[ $value -eq 7 ]]; then result=yes; else result=no; fi
      if [[ ! ($value -eq 7) ]]; then inverse=yes; else inverse=no; fi
      echo "$result:$inverse"; value='1+2*3'
    done`);
  });

  test(`${name} preserves here-string substitution output and prior effects`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
    context.after(() => shell.dispose());
    for (const command of createStructuredCommands()) shell.commands.register(command);
    const source = `s='hello world'; ${header}; do ${prefix}
      echo "before_$i"
      out=$(grep 'h.*o' <<< "$s" | wc -l)
      a=$(jq '.[0]' <<< '[10,20]')
      c=$(sort -n <<< '2')
      d=$(sed '1d' <<< "$s")
      echo "out=[$out] a=[$a] c=[$c] d=[$d]"
      s='hello world
hello again'
    done`;
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "before_1\nout=[1] a=[10] c=[2] d=[]\nbefore_2\nout=[2] a=[10] c=[2] d=[hello again]\nbefore_3\nout=[2] a=[10] c=[2] d=[hello again]\n");
  });
}

test("loop file predicates preserve results when synchronous filesystem admission is unavailable", async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/present", new TextEncoder().encode("data"));
  const shell = new Shell({ fs, limits: { maxFileSystemOperations: 20 } }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`for i in {1..2}; do
    if [[ -f /present ]]; then a=yes; else a=no; fi
    if [[ ! -f /present ]]; then b=yes; else b=no; fi
    if [[ -f /missing ]]; then c=yes; else c=no; fi
    echo "$a:$b:$c"
  done`);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "yes:no:no\nyes:no:no\n");
  assert.equal(result.exitCode, 0);
});
