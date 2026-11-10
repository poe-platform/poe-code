import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";
import { agentCommands, createMemoryFileSystem, Shell } from "../../src/core.js";
import { bashExecutable, modernBashSkip } from "../helpers/bash-oracle.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";

for (const name of ["FUNCNAME", "BASH_ARGV", "BASH_ARGC", "BASH_SOURCE", "BASH_LINENO", "GROUPS", "arr", "PIPESTATUS"]) {
  for (const option of ["-ra", "-r -a", "-u0 -ra"]) {
    test(`read ${option} ${name} preserves protected arrays and consumes one record`, async () => {
      const protectedArray = name !== "arr" && name !== "PIPESTATUS";
      const source = `f(){ before="\${${name}[*]}"; read ${option} ${name}; s=$?; after="\${${name}[*]}"; read -r next; printf '%s:%s\\n' "$s" "$next"; ${protectedArray ? '[[ "$before" = "$after" ]]' : "true"}; }; f <<< $'one two\\nnext'`;
      const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { LC_ALL: "C" }, timeout: 2000 });
      assert.ifError(native.error);
      assert.equal(native.status, 0);
      assert.equal(native.stdout, `${protectedArray ? 1 : 0}:next\n`);
      assert.equal(native.stderr, "");
      const { shell } = setup();
      for (const command of basicCommands()) shell.register(command);
      try {
        const result = await shell.exec(source);
        assert.equal(result.stdout, native.stdout);
        assert.equal(result.stderr, native.stderr);
        assert.equal(result.exitCode, native.status);
      } finally { await shell.dispose(); }
    });
  }
}

for (const loop of [false, true]) test(`read -a FUNCNAME keeps the active function name (loop=${loop})`, async () => {
  const { shell } = setup();
  for (const command of basicCommands()) shell.register(command);
  try {
    const body = 'read -r -a FUNCNAME <<< "X Y"; echo "$?:${FUNCNAME[*]}";';
    const source = `f(){ ${loop ? `for ((i=0; i<3; i++)); do ${body} done;` : body} }; f`;
    const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { LC_ALL: "C" }, timeout: 2000 });
    assert.ifError(native.error);
    assert.equal(native.status, 0);
    assert.equal(native.stdout, "1:f\n".repeat(loop ? 3 : 1));
    assert.equal(native.stderr, "");
    const result = await shell.exec(source);
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const option of ["-u0", "-t1"]) {
  for (const [before, destinations, output] of [
    ["", "'a[1]'", "0|one two|three|"],
    ["declare -A a", "'a[key]'", "0|one two|three|"],
    ["declare -A a", "first 'a[key]'", "0|two|three|one"],
    ["", "first 'a[1]'", "0|two|three|one"],
    ["", "-a a 'unused[2]'", "0|two|three|"],
    ["i=0", "'a[i++]'", "0|one two|three|1"],
  ] as const) {
    test(`read ${option} accepts element destinations: ${destinations}`, async () => {
      const { shell, commands, fs } = setup();
      for (const command of basicCommands()) commands.register(command);
      await fs.writeFile("/data", Buffer.from("one two\nthree\n"));
      const element = before === "declare -A a" ? "key" : before === "i=0" ? "0" : "1";
      try {
        const source = `${before ? `${before}; ` : ""}{ read ${option} ${destinations}; rc=$?; read rest; printf '%s|%s|%s|%s' "$rc" "\${a[${element}]-unset}" "$rest" "${before === "i=0" ? "$i" : "$first"}"; }`;
        if (!modernBashSkip) {
          const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { input: "one two\nthree\n", encoding: "utf8", env: { LC_ALL: "C" }, timeout: 2000 });
          assert.ifError(native.error);
          assert.equal(native.status, 0);
          assert.equal(native.stdout, output);
          assert.equal(native.stderr, "");
        }
        const result = await shell.exec(`${source} </data`);
        assert.equal(result.stdout, output);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const [options, status] of [["", 2], ["-r", 2], ["-u0", 2], ["-t1", 2], ["REPLY", 1], ["-a REPLY", 1]] as const) {
  for (const input of ["one two\nthree\n", "one two", ""]) {
    test(`read ${options} preserves readonly REPLY and consumes input with Bash 5.3 status: ${JSON.stringify(input)}`, async t => {
      const { shell, fs, commands } = setup();
      t.after(() => shell.dispose());
      for (const command of basicCommands()) commands.register(command);
      await fs.writeFile("/data", new TextEncoder().encode(input));
      const result = await shell.exec(`readonly REPLY=old; { read ${options}; rc=$?; read rest; printf '%s|%s|%s' "$rc" "$REPLY" "$rest"; exit "$rc"; } </data`);
      assert.equal(result.stdout, `${status}|old|${input.includes("\n") ? "three" : ""}`);
      assert.equal(result.stderr, "shell: line 1: REPLY: readonly variable\n");
      assert.equal(result.exitCode, status);
    });
  }
}

for (const [label, source] of [
  ["readonly indexed condition", 'a=(old); readonly -a a; if read "a[0]" <<< new; then echo success; else echo recovered; fi; echo "first=${a[0]}"'],
  ["readonly indexed subscript side effect", 'a=(old); readonly -a a; i=0; if read "a[i++]" <<< new; then echo success; else echo "recovered:$?"; fi; echo "first=${a[0]} i=$i"'],
  ["writable indexed subscript side effect", 'a=(old); i=0; if read "a[i++]" <<< new; then echo success; else echo recovered; fi; echo "first=${a[0]} i=$i"'],
  ["readonly read array condition", 'a=(old); readonly -a a; if read -a a <<< new; then echo success; else echo "recovered:$?"; fi; echo "first=${a[0]}"'],
  ["readonly scalar subscript", 'readonly locked=old; read "locked[0]" <<< new; printf "continued:%s <%s>\\n" "$?" "$locked"'],
  ["readonly indexed member", 'readonly -a locked=(old keep); read "locked[0]" <<< new; printf "continued:%s <%s> <%s>\\n" "$?" "${locked[@]}"'],
  ["readonly associative member", 'declare -A locked=([key]=old); readonly locked; read "locked[key]" <<< new; printf "continued:%s <%s>\\n" "$?" "${locked[key]}"'],
  ["nameref to readonly member", 'readonly locked=old; declare -n ref="locked[0]"; read ref <<< new; printf "continued:%s <%s>\\n" "$?" "$locked"'],
  ["partial assignment and consumed record", 'readonly locked=old; read first "locked[0]" last; printf "continued:%s <%s> <%s> <%s>\\n" "$?" "$first" "$locked" "$last"; read tail; printf "tail:%s\\n" "$tail"'],
  ["errexit", 'set -e; readonly locked=old; read "locked[0]" <<< new; printf "unexpected\\n"'],
  ["handled failure", 'readonly locked=old; read "locked[0]" <<< new || printf "handled:%s\\n" "$?"; printf "continued:<%s>\\n" "$locked"'],
  ["readonly scalar control", 'readonly locked=old; read locked <<< new; printf "continued:%s <%s>\\n" "$?" "$locked"'],
  ["writable subscript control", 'read "open[0]" <<< new; printf "continued:%s <%s>\\n" "$?" "${open[0]}"'],
] as const) {
  test(`read destination failure matches Bash: ${label}`, { skip: modernBashSkip }, async () => {
    const { shell, commands } = setup({ extensions: [arraysExtension()] });
    for (const command of basicCommands()) commands.register(command);
    const stdin = "one two three\nTAIL\n";
    try {
      const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source, "shell"], { input: stdin, encoding: "utf8", env: { LC_ALL: "C" }, timeout: 10000 });
      assert.equal(native.error, undefined);
      assert.equal(native.signal, null);
      const result = await shell.exec(source, { stdin });
      assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, native.stderr);
      assert.equal(result.exitCode, native.status);
    } finally { await shell.dispose(); }
  });
}

for (const [destinations, first, last] of [
  ["x bad-name", "one", "old"],
  ["x bad-name z", "one", "old"],
  ["bad-name x z", "old", "old"],
  ["x z bad-name", "one", "two"],
  ["x second z", "one", ""],
] as const) {
  test(`ordinary read validates destinations and assigns in order: ${destinations}`, { skip: modernBashSkip }, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    const source = `printf 'one two\\nnext\\n' | { x=old; z=old; read ${destinations}; rc=$?; read y; printf '%s|%s|%s|%s\\n' "$rc" "$x" "$y" "$z"; }`;
    try {
      const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { LC_ALL: "C" }, timeout: 10000 });
      assert.equal(native.error, undefined);
      assert.equal(native.status, 0);
      const expected = `${destinations.includes("bad-name") ? 1 : 0}|${first}|${destinations.startsWith("bad-name") ? "one two" : "next"}|${last}\n`;
      assert.equal(native.stdout, expected);
      const result = await shell.exec(source);
      assert.equal(result.exitCode, native.status);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, destinations.includes("bad-name") ? "shell: line 1: read: `bad-name': not a valid identifier\n" : "");
    } finally { await shell.dispose(); }
  });
}

test("ordinary read assigns partial EOF input before rejecting a later destination", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('x=old; read x bad-name; args "$?" "$x"; pass', { stdin: "one two" });
    assert.equal(result.stdout, '["1","one"]');
    assert.equal(result.stderr, "shell: line 1: read: `bad-name': not a valid identifier\n");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("ordinary read rejects invalid options before consuming input or assigning destinations", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('x=old; read -p; args "$?" "$x"; pass', { stdin: "one two\nnext\n" });
    assert.equal(result.stdout, '["2","old"]one two\nnext\n');
    assert.equal(result.stderr, "read: invalid variable name or unsupported option\n");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const target of ["items", "'items[0]'", "'fresh[0]'"]) {
  for (const initialize of ["", "IFS=original;", "unset IFS;"]) {
    test(`read restores temporary scalar prefixes after array target ${target}: ${initialize || "default IFS"}`, async () => {
      const { shell, commands } = setup();
      for (const command of basicCommands()) commands.register(command);
      const source = `${initialize} declare -a items=(one two); marker=original; IFS=: marker=temporary read ${target} <<< 'a:b'; printf '<%s>' "\${IFS+x}" "$IFS" "$marker" "\${items[@]}" "\${fresh[@]}"`;
      try {
        const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { LC_ALL: "C" }, timeout: 10000 });
        assert.equal(native.error, undefined);
        assert.equal(native.status, 0);
        const result = await shell.exec(source);
        assert.equal(result.stderr, native.stderr);
        assert.equal(result.exitCode, native.status);
        assert.equal(result.stdout, native.stdout);
      } finally { await shell.dispose(); }
    });
  }
}

for (const option of ["-u 0", "-u0", "-u +00", "-p SYNTHETIC_PROMPT", "-pSYNTHETIC_PROMPT", "-p ''", "-s", "-rsu0", "-n9 -s -p prompt -u0"]) {
  test(`default read nonterminal option consumes one record: ${option}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`read ${option} first; code=$?; read -r rest; args "$first" "$rest"; exit "$code"`, { stdin: "abcd\nTAIL\n" });
      assert.equal(result.stdout, '["abcd","TAIL"]');
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", `read ${option} first; code=$?; read -r rest; printf '["%s","%s"]' "$first" "$rest"; exit "$code"`], { input: "abcd\nTAIL\n", encoding: "utf8", env: { LC_ALL: "C", TZ: "UTC" }, timeout: 10000 });
      assert.equal(native.error, undefined);
      assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, native.stderr);
      assert.equal(result.exitCode, native.status);
    } finally { await shell.dispose(); }
  });
}

test("default read nonterminal options assign partial input and report EOF", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('read -su0 -p prompt value; args "$?" "$value"', { stdin: "partial" });
    assert.equal(result.stdout, '["1","partial"]');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("default read nonterminal options preserve input on malformed or unsupported options", async () => {
  const usage = "read: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n";
  for (const [option, status, diagnostic] of [
    ["-u", 2, `shell: line 1: read: -u: option requires an argument\n${usage}`],
    ["-p", 2, "read: invalid variable name or unsupported option\n"],
    ["-u1", 1, "shell: line 1: read: 1: read error: Bad file descriptor\n"],
    ["-unope", 1, "shell: line 1: read: nope: invalid file descriptor specification\n"],
    ["-u0 -Z", 2, `shell: line 1: read: -Z: invalid option\n${usage}`],
  ] as const) {
    const { shell } = setup();
    try {
      const result = await shell.exec(`value=old; read ${option}; args "$?" "$value"; pass`, { stdin: "untouched" });
      assert.equal(result.stdout, `["${status}","old"]untouched`, option);
      assert.equal(result.stderr, diagnostic, option);
    } finally { await shell.dispose(); }
  }
});

test("agentCommands default read assigns array fields in a VFS script", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/read.sh", new TextEncoder().encode('read -a a; printf "<%s>" "${a[@]}"'));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("bash /read.sh", { stdin: "a b:c\n" });
    assert.equal(result.stdout, "<a><b:c>");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const [label, source, stdin, stdout] of [
  ["reported default profile", 'read -a a; printf "<%s>" "${a[@]}"', "a b:c\n", "<a><b:c>"],
  ["attached option and ignored operands", 'ignored=old; read -raitems ignored; args "${items[@]}" "$ignored" "$?"', "a\\ b c\n", JSON.stringify(["a\\", "b", "c", "old", "0"])],
  ["escaped separators and empty fields", 'IFS=, read -a items; args "${items[@]}"', "a\\,b,,c,\n", '["a,b","","c"]'],
  ["replaces previous members", 'items=(old stale); read -a items; args "${items[@]}"', "new\n", '["new"]'],
  ["clears at EOF", 'items=(old stale); read -a items; args "$?" "${items[@]}"', "", '["1"]'],
  ["assigns partial EOF record", 'read -a items; args "$?" "${items[@]}"', "a b", '["1","a","b"]'],
  ["restores local binding", 'items=(outer saved); f() { local -a items; read -a items; args "${items[@]}"; }; f; args "${items[@]}"', "a b\n", '["a","b"]["outer","saved"]'],
  ["leaves unread tail", 'read -a items; args "${items[@]}"; pass', "a b\nTAIL", '["a","b"]TAIL'],
  ["ignores later invalid extra operand", 'read -a items good invalid-name; args "${items[@]}"', "a b\n", '["a","b"]'],
  ["empty IFS retains whole record", 'IFS= read -a items; args "${items[@]}"', " a b \n", '[" a b "]'],
] as const) {
  test(`default read array: ${label}`, async () => {
    const { shell } = setup();
    for (const command of basicCommands()) shell.register(command);
    try {
      const result = await shell.exec(source, { stdin });
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const options of ["-a items", "-raitems", "-N 8 -a items"]) {
  test(`default read array validates the first extra destination before consuming input: ${options}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`items=(old saved); read ${options} bad-name; args "$?" "\${items[@]}"; pass`, { stdin: "one two\nthree\n" });
      assert.equal(result.stdout, '["1","old","saved"]one two\nthree\n');
      assert.equal(result.stderr, "shell: line 1: read: `bad-name': not a valid identifier\n");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

test("default read array preserves readonly members after consuming the record", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('readonly -a items=(old); read -a items; args "$?" "${items[@]}"; pass', { stdin: "new\nTAIL" });
    assert.equal(result.stdout, '["1","old"]TAIL');
    assert.match(result.stderr, /items: readonly variable/u);
  } finally { await shell.dispose(); }
});

for (const [options, status, rest, members, invalidName] of [
  ["-a bad-name", 1, "three", "old", "bad-name"],
  ["-abad-name", 1, "three", "old", "bad-name"],
  ["-a ''", 1, "three", "old", ""],
  ["-a 'items[0]'", 1, "three", "old", "items[0]"],
  ["-N 2 -a bad-name", 1, "e two", "old", "bad-name"],
  ["-n 0 -a bad-name", 1, "one two", "old", "bad-name"],
  ["-a items bad-name", 1, "one two", "old", "bad-name"],
  ["-a bad-name other-bad", 1, "one two", "old", "other-bad"],
  ["-a items", 0, "three", "one two", undefined],
  ["-a items ignored bad-name", 0, "three", "one two", undefined],
] as const) {
  test(`read array validation consumes the correct record: ${options}`, async () => {
    const { shell, commands, fs } = setup();
    for (const command of basicCommands()) commands.register(command);
    const source = `items=(old); { read ${options}; rc=$?; read rest; printf '%s|%s|%s' "$rc" "$rest" "\${items[*]}"; }`;
    const diagnostic = invalidName === undefined ? "" : `shell: line 1: read: \`${invalidName}': not a valid identifier\n`;
    const expected = `${status}|${rest}|${members}`;
    try {
      const native = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source, "shell"], { input: "one two\nthree\n", encoding: "utf8", env: { LC_ALL: "C" }, timeout: 10000 });
      assert.equal(native.error, undefined);
      assert.equal(native.status, 0);
      assert.equal(native.stdout, expected);
      assert.equal(native.stderr, diagnostic);
      await fs.writeFile("/data", new TextEncoder().encode("one two\nthree\n"));
      const result = await shell.exec(`${source} <data`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, diagnostic);
    } finally { await shell.dispose(); }
  });
}

test("default read array rejects malformed options without consuming input", async () => {
  for (const option of ["-a", "-a bad-name -Z"]) {
    const { shell } = setup();
    try {
      const result = await shell.exec(`read ${option}; args "$?"; pass`, { stdin: "untouched" });
      assert.equal(result.stdout, '["2"]untouched');
      assert.match(result.stderr, /read:/u);
    } finally { await shell.dispose(); }
  }
});

test("default read array enforces indexed field admission", async () => {
  const { shell } = setup({ limits: { maxExpansionFields: 8 } });
  try {
    const result = await shell.exec("read -a items", { stdin: "x ".repeat(32) + "\n" });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /indexed array: private (?:Map slot|metadata) limit exceeded/u);
  } finally { await shell.dispose(); }
});

test("default read array admits fields within a sufficient finite budget", async () => {
  const { shell } = setup({ limits: { maxExpansionFields: 512 } });
  try {
    const result = await shell.exec('read -a items; args "${#items[@]}"', { stdin: "x ".repeat(32) + "\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["32"]');
  } finally { await shell.dispose(); }
});

test("while IFS=: read -r fields work in synchronous ((...)) arithmetic on first and subsequent records", async () => {
  const { shell, fs: vfs } = setup();
  try {
    await vfs.writeFile("/data.txt", Buffer.from("item_1:1:2\nitem_2:2:4\nitem_3:3:6\n"));
    const result = await shell.exec("total=0; while IFS=: read -r k v1 v2; do ((total += v1 + v2)); done < /data.txt; args \"$total\"");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "[\"18\"]");
  } finally { await shell.dispose(); }
});

test("while IFS=, read -r -d \";\" and glob/bracket prefix/suffix trims match bash in tight loops", async () => {
  const { shell, fs: vfs } = setup();
  try {
    await vfs.writeFile("/delim.txt", Buffer.from("123:alpha:abc,10;456:beta:xyz,20;789:gamma:def,30;"));
    const result = await shell.exec(`
      total=0
      acc=""
      while IFS=, read -r -d ";" k v; do
        a="\${k#[0-9]*:}"
        b="\${a%:[a-z]*}"
        ((total += v))
        acc="\${acc}\${b}:"
      done < /delim.txt
      args "$total" "$acc"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "[\"60\",\"alpha:beta:gamma:\"]");
  } finally { await shell.dispose(); }
});

test("arithmetic-for echo producer into pipeline with read and awk matches bash", async () => {
  const { shell } = setup();
  shell.use(agentCommands());
  try {
    const result = await shell.exec(`
      for ((i=1; i<=50; i++)); do
        echo "dept_$((i % 4)):$((i * 10))"
      done | awk -F: '{sum[$1]+=$2} END {for (k in sum) print k ":" sum[k]}' | sort
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "dept_0:3120\ndept_1:3250\ndept_2:3380\ndept_3:3000\n");
  } finally { await shell.dispose(); }
});

test("recursive function with local command substitutions and arithmetic comparisons matches bash", async () => {
  const { shell } = setup();
  shell.use(agentCommands());
  try {
    const result = await shell.exec(`
      fib() {
        if (( $1 <= 1 )); then
          echo $1
        else
          local a=$(fib $(( $1 - 1 )))
          local b=$(fib $(( $1 - 2 )))
          echo $((a + b))
        fi
      }
      fib 10
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "55\n");
  } finally { await shell.dispose(); }
});
