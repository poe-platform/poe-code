import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { runtimeSetup } from "./helpers.js";

for (const bounded of [false, true]) {
  for (const [source, expected] of [
    ['declare +i OPTIND; OPTIND=1+1; getopts :ab v -a -b; printf "%s/%s" "$v" "$OPTIND"', "a/2"],
    ['declare +i OPTIND; OPTIND=1+1; printf %s "$OPTIND"', "1+1"],
    [':; printf "%s/%s" "${OPTIND@a}" "${OPTIND-unset}"', "i/1"],
    ['declare -i OPTIND; OPTIND=1+1; getopts :ab v -a -b; printf "%s/%s" "$v" "$OPTIND"', "b/3"],
    ['declare -i OPTIND; printf "%s/%s" "${OPTIND@a}" "${OPTIND-unset}"', "i/1"],
    ['declare -p OPTIND', 'declare -i OPTIND="1"\n'],
    ['declare +i OPTIND; declare -i OPTIND; OPTIND=1+1; printf "%s/%s" "${OPTIND@a}" "$OPTIND"', "i/2"],
    ['f(){ local OPTIND=1+1; printf "%s/%s;" "${OPTIND@a}" "$OPTIND"; }; f; printf "%s/%s" "${OPTIND@a}" "$OPTIND"', "/1+1;i/1"],
    ['f(){ local -I OPTIND; OPTIND=1+1; printf "%s/%s;" "${OPTIND@a}" "$OPTIND"; }; f; printf "%s/%s" "${OPTIND@a}" "$OPTIND"', "i/2;i/1"],
    ['unset OPTIND; OPTIND=1+1; printf "%s/%s" "${OPTIND@a}" "$OPTIND"', "/1+1"],
    ['declare +i OPTIND; bash -c \'printf "%s/%s" "${OPTIND@a}" "$OPTIND"\'', "i/1"],
    ['OPTIND+=1+1; printf %s "$OPTIND"', "3"],
  ] as const) {
    test(`OPTIND integer attribute: ${source} (bounded=${bounded})`, async () => {
      const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stdout, expected);
      assert.equal(native.stderr, "");
      const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
      try {
        for (let run = 0; run < 2; run++) {
          const result = await shell.exec(source);
          assert.equal(result.exitCode, native.status, result.stderr);
          assert.equal(result.stdout, native.stdout);
          assert.equal(result.stderr, native.stderr);
        }
      } finally { await shell.dispose(); }
    });
  }
}

test("OPTIND integer attributes persist across session turns", async () => {
  const { shell } = runtimeSetup();
  try {
    const session = shell.createSession();
    for (const [declaration, expected] of [[":", "i/2"], ["declare +i OPTIND", "/1+1"], ["declare -i OPTIND", "i/2"]] as const) {
      assert.equal((await session.exec(declaration)).exitCode, 0);
      const result = await session.exec('OPTIND=1+1; printf "%s/%s" "${OPTIND@a}" "$OPTIND"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

for (const [source, line, prefix] of [
  ["getopts ':a' OPTIND rest\nprintf done", 1, "getopts: "],
  ["declare -i n\ngetopts ':a' n rest\nprintf done", 2, "getopts: "],
  ["command getopts ':a' OPTIND rest\nprintf done", 1, "getopts: "],
  ["builtin getopts ':a' OPTIND rest\nprintf done", 1, "getopts: "],
  ["declare -i n\nn='?'\nprintf done", 2, ""],
  ["OPTIND='?'\nprintf done", 1, ""],
] as const) {
  test(`integer destination failure identifies its source: ${source}`, async () => {
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    assert.equal(native.status, 1, native.stderr);
    assert.equal(native.stdout, "");
    assert.ok(native.stderr.startsWith(`bash: line ${line}: ${prefix}?: `), native.stderr);
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, native.status);
      assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, `shell: line ${line}: ${prefix}?: arithmetic syntax error: operand expected (error token is "?")\n`);
    } finally { await shell.dispose(); }
  });
}

for (const bounded of [false, true]) {
  test(`getopts loop retains exported OPTARG until EOF (bounded=${bounded})`, async () => {
    const source = `export OPTARG=7
set -- -a -b 2+3
while getopts ab: o; do
  if [ "$o" = b ]; then break; fi
done
declare -p OPTARG
getopts ab: o
OPTARG=after
declare -p OPTARG`;
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    assert.equal(native.status, 0, native.stderr);
    const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, native.stdout);
    } finally { await shell.dispose(); }
  });
  for (const declaration of ["declare -i", "export", "declare"]) {
    for (const first of ["-a", "--", "-x", "-b"]) {
      test(`getopts preserves OPTARG attributes only for a successful flag (${declaration}, ${first}, bounded=${bounded})`, async () => {
        const source = `${declaration} OPTARG=7
getopts ab: o ${first}
printf '%s|%s|%s|%s\\n' "$?" "$o" "\${OPTARG-unset}" "$OPTIND"
OPTIND=1
getopts ab: o -b 2+3
printf '%s|%s|%s|%s\\n' "$?" "$o" "$OPTARG" "$OPTIND"
declare -p OPTARG`;
        const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
        assert.equal(native.status, 0, native.stderr);
        const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
        try {
          const result = await shell.exec(source);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout, native.stdout);
          if (first === "-a" || first === "--") assert.equal(result.stderr, "");
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const bounded of [false, true]) {
  for (const declaration of ["declare -a", "declare -A"]) {
    for (const assignment of ["getopts b: opt -b new", "OPTARG=new"]) {
      test(`${assignment} preserves ${declaration} OPTARG siblings (bounded=${bounded})`, async () => {
        const source = `${declaration} OPTARG=([0]=old [1]=keep)
${assignment}
printf '%s|%s|%s\\n' "$?" "\${OPTARG[0]-unset}" "\${OPTARG[1]-unset}"`;
        const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
        assert.equal(native.status, 0, native.stderr);
        assert.equal(native.stderr, "");
        assert.equal(native.stdout, "0|new|keep\n");
        const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
        try {
          const result = await shell.exec(source);
          assert.equal(result.stdout, native.stdout);
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, 0);
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const bounded of [false, true]) {
  for (const command of ["getopts --help", "getopts --help ab flag -a", "command getopts --help", "builtin getopts --help"]) {
    test(`${command} prints Bash help without changing option state (bounded=${bounded})`, async () => {
      const source = `flag=old; OPTARG=old
${command}
printf 'status=%s flag=%s OPTARG=%s OPTIND=%s\\n' "$?" "$flag" "$OPTARG" "$OPTIND"`;
      const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stderr, "");
      assert.ok(native.stdout.startsWith("getopts: getopts optstring name [arg ...]\n"));
      assert.ok(native.stdout.endsWith("status=2 flag=old OPTARG=old OPTIND=1\n"));
      const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
      try {
        const result = await shell.exec(source);
        assert.equal(result.stdout, native.stdout);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }

  test(`getopts help preserves an active option cluster (bounded=${bounded})`, async () => {
    const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
    try {
      const result = await shell.exec('set -- -ab; getopts ab flag; OPTARG=old; getopts --help >/help; printf "%s:%s:%s:%s\\n" "$?" "$flag" "$OPTARG" "$OPTIND"; getopts ab flag; printf "%s:%s:%s\\n" "$?" "$flag" "$OPTIND"');
      assert.equal(result.stdout, "2:a:old:1\n0:b:2\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const command of ["getopts", "getopts a", "getopts -h", "getopts -h ab flag -a"]) {
  test(`${command} remains a usage error`, async () => {
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(command);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("getopts: usage: getopts optstring name [arg ...]\n"));
      assert.equal(result.exitCode, 2);
    } finally { await shell.dispose(); }
  });
}

test("getopts delimiter treats --help as the option string", async () => {
  const { shell } = runtimeSetup();
  try {
    const result = await shell.exec('getopts -- --help flag -h; printf "%s:%s:%s\\n" "$?" "$flag" "$OPTIND"');
    assert.equal(result.stdout, "0:h:2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

interface FrozenCase {
  id: string;
  productScript: string;
  expectation: { stdout: string };
  env?: Record<string, string>;
  fixtures?: string[];
}

for (const delimiter of ["--", '"--"', '"$delimiter"']) {
  test(`getopts recognizes expanded leading delimiter ${delimiter}`, async () => {
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(`delimiter=--; getopts ${delimiter} a opt -a; say "$?:$opt:$OPTIND"`);
      assert.equal(result.stdout, "0:a:2\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

const frozen: { scripts: FrozenCase[] } = await import(new URL("../../getopts-independent-20260827/stage2/corpus.mjs", import.meta.url).href);

for (const command of ["getopts", "command getopts", "builtin getopts"]) {
  for (const readonly of [false, true]) {
    test(`${command} distinguishes assignment failure from end of options (readonly=${readonly})`, async () => {
      const { shell } = runtimeSetup();
      try {
        const result = await shell.exec(`${readonly ? "readonly " : ""}o=old
set -- -b value -a
for n in 1 2 3; do
  ${command} ab: o
  printf '%s:%s:%s:%s\\n' "$?" "\${o-unset}" "\${OPTARG-unset}" "$OPTIND"
done`);
        assert.equal(result.stdout, readonly
          ? "2:old:value:3\n2:old:unset:4\n1:old:unset:4\n"
          : "0:b:value:3\n0:a:unset:4\n1:?:unset:4\n");
        assert.equal(result.stderr, readonly ? "shell: line 4: o: readonly variable\n".repeat(3) : "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const item of frozen.scripts.filter(item => ["N01", "N02", "N03", "N06", "N07", "N08", "N09", "N10", "N11", "N16"].includes(item.id))) {
  test(`frozen nonfailure stdout profile ${item.id}, not native diagnostic byte parity`, async () => {
    const { shell, fs } = runtimeSetup();
    await fs.mkdir("/fixtures");
    for (const file of item.fixtures ?? []) await fs.writeFile(`/${file}`, readFileSync(new URL(`../../getopts-independent-20260827/stage2/${file}`, import.meta.url)));
    const result = await shell.exec(item.productScript, item.env ? { env: item.env } : {});
    assert.equal(result.stdout, item.expectation.stdout);
    assert.equal(result.exitCode, 0, result.stderr);
  });
}

test("temporary OPTIND restoration resets the scanner like Bash", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('getopts abc opt -abc; say "$opt"; OPTIND=1 getopts abc opt -abc; say "$opt"; getopts abc opt -abc; say "$opt"; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "a\na\na\nb\n");
  assert.equal(result.stderr, "");
});

for (const arrays of [false, true]) {
  for (const [name, source, expected] of [
    ["direct prefix", 'OPTIND=1 getopts abc: k -c arg; printf "%s:%s:%s\\n" "$k" "$OPTARG" "$OPTIND"', "c:arg:3\n"],
    ["separate assignment", 'OPTIND=1; getopts abc: k -c arg; echo "$k:$OPTARG:$OPTIND"', "c:arg:3\n"],
    ["command prefix", 'OPTIND=7; OPTIND=1 command getopts abc: k -c arg; echo "$k:$OPTARG:$OPTIND"', "c:arg:3\n"],
    ["builtin prefix", 'OPTIND=7; OPTIND=1 builtin getopts abc: k -c arg; echo "$k:$OPTARG:$OPTIND"', "c:arg:3\n"],
    ["helper prefix", 'set -- -ab -c val; getopts abc: k; f(){ getopts abc: k; }; OPTIND=1 f -c other; getopts abc: k; echo "$k:$OPTIND"', "a:1\n"],
    ["helper local", 'set -- -ab -c val; getopts abc: k; f(){ local OPTIND=1; getopts abc: k; }; f -c other; getopts abc: k; echo "$k:$OPTIND"', "b:2\n"],
    ["helper restores prefix cursor with outer index 2", 'OPTIND=2; f(){ getopts ab k; }; OPTIND=1 f -ab; echo "$OPTIND"; getopts ab k -ab; echo "$k:$OPTIND"', "2\na:1\n"],
    ["prefix without scan retains outer cluster above index 1", 'getopts abc k -a -bc; getopts abc k -a -bc; OPTIND=1 :; getopts abc k -a -bc; echo "$k:$OPTIND"', "c:3\n"],
    ["end of options publishes index", 'OPTIND=7; OPTIND=1 getopts abc k --; echo "$?:$k:$OPTIND"', "1:?:2\n"],
    ["missing argument publishes index", 'OPTIND=7; OPTIND=1 getopts :c: k -c; echo "$?:$k:$OPTARG:$OPTIND"', "0:::c:2\n"],
    ["non-scanning prefix", 'getopts abc k -abc; OPTIND=9 :; getopts abc k -abc; echo "$k:$OPTIND"', "a:1\n"],
  ] as const) {
    test(`OPTIND command scope: ${name} (arrays=${arrays})`, async () => {
      const { shell } = runtimeSetup({ extensions: arrays ? [arraysExtension()] : [] });
      try {
        const result = await shell.exec(source);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

test("N05 correction retains function-entry snapshot and repeated local reset", async () => {
  const { shell } = runtimeSetup();
  const item = frozen.scripts.find(item => item.id === "N05")!;
  const expected = item.expectation.stdout.replace("repeated-local|0|b|1|", "repeated-local|0|a|1|");
  assert.equal((await shell.exec(item.productScript)).stdout, expected);
});

for (const source of [
  'OPTIND=1', 'OPTIND=$OPTIND', 'export OPTIND=1', 'readonly OPTIND=1',
  'read OPTIND <<< 1', 'read -r OPTIND <<< 1', 'for OPTIND in 1; do :; done',
  '((OPTIND=1))', ': $((OPTIND=1))', 'unset OPTIND; : "${OPTIND:=1}"',
]) {
  test(`successful origin synchronizes after store: ${source}`, async () => {
    const { shell } = runtimeSetup();
    const result = await shell.exec(`getopts abc opt -abc; ${source}; getopts abc opt -abc; say "$opt:$OPTIND"`);
    assert.equal(result.stdout, "a:1\n");
    if (source.startsWith("readonly")) assert.match(result.stderr, /OPTIND: readonly variable/u);
    else assert.equal(result.stderr, "");
  });
}

test("successful EOF read store resets even though read returns one", async () => {
  const { shell, fs } = runtimeSetup();
  await fs.writeFile("/input", new TextEncoder().encode("1"));
  const result = await shell.exec('getopts abc opt -abc; getopts abc opt -abc; read OPTIND < /input; say "$?"; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "1\na\n");
});

for (const [name, source, expected] of [
  ["indexed array", "a=(7 8); OPTIND=a", "7"],
  ["associative array", "declare -A a=([0]=7 [other]=8); OPTIND=a", "7"],
  ["missing element zero", "a=([1]=8); OPTIND=a", "0"],
  ["recursive array value", "a=(b); b=(7); OPTIND=a", "7"],
  ["explicit subscript", "a=(7 8); OPTIND='a[1]'", "8"],
  ["array mutation", "a=(7 8); OPTIND='a++'; printf '%s:' \"${a[0]}\"", "8:7"],
  ["getopts indexed array result", "a=(7 8); getopts a OPTIND -a", "7"],
  ["getopts associative array result", "declare -A a=([0]=7); getopts a OPTIND -a", "7"],
  ["scanner reset", "a=(1); getopts ab flag -ab; OPTIND=a; getopts ab flag -ab; printf '%s:' \"$flag\"", "a:1"],
] as const) {
  test(`OPTIND arithmetic resolves ${name} like Bash`, async () => {
    const script = `${source}; printf '%s\\n' "$OPTIND"`;
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", script], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stdout, `${expected}\n`);
    assert.equal(native.stderr, "");
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, native.status, result.stderr);
      assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, native.stderr);
    } finally { await shell.dispose(); }
  });
}

test("scalar integer binding is fresh, lost by unset/local, and restored afterward", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('OPTIND="1+1"; say "$OPTIND"; unset OPTIND; OPTIND="1+1"; say "$OPTIND"; getopts ab opt -a -b; say "$opt:$OPTIND"; bash -c \'OPTIND="1+1"; f() { local OPTIND="1+1"; say "$OPTIND"; }; f; say "$OPTIND"\'');
  assert.equal(result.stdout, "2\n1+1\na:2\n1+1\n2\n");
});

for (const [value, expected] of [["0", "a"], ["-1", "a"], ["0x2", "b"], ["4294967297", "a"], ["99", "?"]] as const) {
  test(`integer index profile ${value}`, async () => {
    const { shell } = runtimeSetup();
    assert.equal((await shell.exec(`OPTIND=${value}; getopts ab opt -a -b; say "$opt"`)).stdout, `${expected}\n`);
  });
}

test("invalid octal assignment remains fatal while integer declarations succeed", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('OPTIND=08; say unreachable');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, 'shell: line 1: 08: value too great for base (error token is "08")\n');
  const declaration = await shell.exec("type -t declare");
  assert.equal(declaration.exitCode, 0);
  assert.equal(declaration.stdout, "builtin\n");
  const integer = await shell.exec('declare -i value=1; say "$value"');
  assert.equal(integer.exitCode, 0);
  assert.equal(integer.stdout, "1\n");
  assert.equal(integer.stderr, "");
});


for (const [name, source, expected] of [
  [
    "octal integer",
    "OPTIND=010; say \"$OPTIND\"",
    "8\n"
  ],
  [
    "spaced octal integer",
    "OPTIND=\" 010 \"; say \"$OPTIND\"",
    "8\n"
  ],
  [
    "unset octal text",
    "unset OPTIND; OPTIND=010; say \"$OPTIND\"",
    "010\n"
  ],
  [
    "unset invalid octal text",
    "unset OPTIND; OPTIND=08; say \"$OPTIND\"",
    "08\n"
  ],
  [
    "local octal text",
    "f(){ local OPTIND=010; say \"$OPTIND\"; }; f",
    "010\n"
  ],
  [
    "local invalid octal text",
    "f(){ local OPTIND=08; say \"$OPTIND\"; }; f",
    "08\n"
  ],
  [
    "local decimal loses integer binding",
    "f(){ local OPTIND=1; OPTIND=\"1+1\"; say \"$OPTIND\"; }; f; OPTIND=\"1+1\"; say \"$OPTIND\"",
    "1+1\n2\n"
  ],
  [
    "declared octal integer",
    "declare OPTIND=010; say \"$OPTIND\"",
    "8\n"
  ],
  [
    "canonical decimal integer",
    "OPTIND=2; say \"$OPTIND\"",
    "2\n"
  ],
  [
    "function-loop prefix once",
    "f(){ for i in 1 2; do echo \"before:$i\"; OPTIND=010; echo \"$OPTIND\"; done; }; f",
    "before:1\n8\nbefore:2\n8\n"
  ],
  [
    "prospective nameref loop prefix once",
    "f(){ for i in 1 2; do echo \"before:$i\"; local -n ref=OPTIND; ref=010; echo \"$OPTIND\"; done; }; f",
    "before:1\n8\nbefore:2\n8\n"
  ]
] as const) {
  test(`OPTIND assignment spelling and binding: ${name}`, async () => {
    const { shell } = runtimeSetup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

test("invalid octal global declaration remains fatal", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec("declare OPTIND=08; say unreachable");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /08: value too great for base/u);
});

test("fresh defaults preserve inherited export bits while clones do not initialize", async () => {
  const { shell } = runtimeSetup();
  assert.equal((await shell.exec('say "$OPTIND:$OPTERR"; envget OPTIND OPTERR; getopts a opt -a')).stdout, "1:1\n<unset>|<unset>");
  assert.equal((await shell.exec('say "$OPTIND:$OPTERR"; envget OPTIND OPTERR', { env: { OPTIND: "9", OPTERR: "0" } })).stdout, "1:1\n1|1");
  assert.equal((await shell.exec('OPTIND=9; OPTERR=0; export OPTIND OPTERR; bash -c \'say "$OPTIND:$OPTERR"; envget OPTIND OPTERR\'')).stdout, "1:1\n1|1");
  assert.equal((await shell.exec('getopts a opt -a; say "$OPTIND"')).stdout, "2\n");
  assert.equal((await shell.exec('say "$OPTIND"')).stdout, "1\n");
});

test("registry collision, functions and command bypass retain regular builtin discovery", async () => {
  const { shell, commands } = runtimeSetup();
  await shell.exec(":");
  commands.register({ name: "getopts", execute() { throw new Error("registry must not execute"); } });
  const names = commands.list().map(command => command.name);
  const result = await shell.exec('type -t getopts; getopts a opt -a; say "$opt"; getopts() { say shadow; }; getopts; OPTIND=1; command getopts a opt -a; say "$opt"');
  assert.equal(result.stdout, "builtin\na\nshadow\na\n");
  assert.deepEqual(commands.list().map(command => command.name), names);
});

test("groups/source/eval share state while pipelines, substitutions and subshells clone", async () => {
  const { shell, fs } = runtimeSetup();
  await fs.writeFile("/source", new TextEncoder().encode('getopts abcdef opt -abcdef; say "$opt"'));
  const result = await shell.exec('getopts abcdef opt -abcdef; (getopts abcdef opt -abcdef; say "$opt"); getopts abcdef opt -abcdef | pass; say "$(getopts abcdef opt -abcdef; say "$opt")"; { getopts abcdef opt -abcdef; say "$opt"; }; . /source; eval \'getopts abcdef opt -abcdef; say "$opt"\'; say "$opt"');
  assert.equal(result.stdout, "b\nb\nb\nc\nd\nd\n");
});

test("prefix function redirection scratch and substitution installation isolate metadata", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('getopts abc opt -abc; f() { getopts abc opt -abc; say "$opt"; }; OPTIND=1 f <<< "$(getopts abc opt -abc; say "$opt")"; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "a\na\n");
});
