import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function run(source: string, bounded = false) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStreamFormatCommands()]) });
  try { return await shell.exec(source, bounded ? { limits: { maxExpansionBytes: 4096 } } : {}); }
  finally { await shell.dispose(); }
}

for (const [source, stdout] of [
  ['arr=global_scalar; f() { local arr; printf -v "arr[0]" "%s" local_elem; echo "in:<${arr[0]}>"; }; f; echo "out:<$arr>"; declare -p arr', 'in:<local_elem>\nout:<global_scalar>\ndeclare -- arr="global_scalar"\n'],
  ['unset arr; f() { local arr; printf -v "arr[0]" "%s" local_elem; }; f; echo "prefix:<${!arr*}>"; arr=scalar; declare -p arr', 'prefix:<>\ndeclare -- arr="scalar"\n'],
  ['unset arr; { read -a arr <<< "$((1/0))"; } 2>/dev/null || true; echo "prefix:<${!arr*}>"; arr=scalar; declare -p arr', 'prefix:<>\ndeclare -- arr="scalar"\n'],
  ['unset arr; read -a arr <<< "${!arr*}"; echo "len:<${#arr[@]}> prefix:<${!arr*}>"', 'len:<0> prefix:<arr>\n'],
  ['unset arr; read -a arr <<< ""; echo "prefix:<${!arr*}> at:<${!arr@}>"; declare -p arr', 'prefix:<arr> at:<arr>\ndeclare -a arr=()\n'],
  ['unset arr; read -a arr <<< "   "; echo "prefix:<${!arr*}> at:<${!arr@}>"; declare -p arr', 'prefix:<arr> at:<arr>\ndeclare -a arr=()\n'],
  ['declare -a arr; read -a arr <<< ""; echo "prefix:<${!arr*}> at:<${!arr@}>"', 'prefix:<arr> at:<arr>\n'],
  ['arr=(old values); read -a arr <<< ""; echo "len:<${#arr[@]}> prefix:<${!arr*}>"', 'len:<0> prefix:<arr>\n'],
] as const) {
  test(source, async () => {
    for (const bounded of [false, true]) for (const script of [source, `for _ in 1; do ${source}; done`]) {
      const result = await run(script, bounded);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout, `bounded=${bounded}, script=${script}`);
    }
  });
}

for (const [source, stdout] of [
  ['echo $(dirname /a/b); echo $(basename /a/b.txt .txt)', '/a\nb\n'],
  ['f() { local arr; arr=(1 2); }; for _ in 1; do f; done; echo "len=${#arr[@]} val=${arr[@]}"', 'len=0 val=\n'],
  ['f() { local arr; arr[0]=99; }; for _ in 1; do f; done; echo "len=${#arr[@]} val=${arr[@]}"', 'len=0 val=\n'],
  ['f() { local arr; read -a arr <<< "a b"; }; for _ in 1; do f; done; echo "len=${#arr[@]} val=${arr[@]}"', 'len=0 val=\n'],
  ['arr=(o1 o2); f() { local -a arr; arr=(in); }; for _ in 1; do f; done; echo "${arr[@]}"', 'o1 o2\n'],
  ['f() { local -a arr; arr=(one two); local -a arr; echo "${arr[@]}"; }; for _ in 1; do f; done', 'one two\n'],
  ['f() { local arr; for ((i=0;i<2;i++)); do arr+=(one); done; echo "${arr[@]}"; }; f; echo "len=${#arr[@]}"', 'one one\nlen=0\n'],
  ['arr=outer; f() { local arr; arr=(one two); }; f; echo "$arr"', 'outer\n'],
  ['arr=(outer); f() { local arr; arr=(inner); }; f; echo "${arr[@]}"', 'outer\n'],
  ['arr=(outer); f() { local x; for ((i=0;i<2;i++)); do arr[0]=inner; done; }; f; echo "${arr[@]}"', 'inner\n'],
  ['outer() { local -a arr; arr=(outer); inner() { local -a arr; arr=(inner); }; inner; echo "${arr[@]}"; }; outer; echo "len=${#arr[@]}"', 'outer\nlen=0\n'],
  ['arr=(a b c); IFS=:; x=${arr[*]}; echo "$x"', 'a:b:c\n'],
  ['arr=(a b c); IFS=:; x="${arr[*]}"; echo "$x"', 'a:b:c\n'],
  ['arr=(a b c); IFS=:; [[ ${arr[*]} == "a b c" ]] && echo ok; case ${arr[*]} in "a b c") echo ok;; esac', ''],
  ['arr=(a b c); IFS=:; [[ ${arr[*]} == "a:b:c" ]] && echo ok; case ${arr[*]} in "a:b:c") echo ok;; esac', 'ok\nok\n'],
  ['HOME=/home; arr=(/home/a /home/b); x=${arr[@]#~/}; echo "$x"', 'a b\n'],
  ['HOME=/home; arr=(/home/a /home/b); x=${arr[@]/~/X}; echo "$x"', 'X/a X/b\n'],
  ['IFS=:; HOME=/home; arr=(/home/a /home/b); x=${arr[*]#~/}; echo "$x"', 'a:b\n'],
  ['IFS=:; HOME=/home; arr=(/home/a /home/b); x="${arr[*]#~/}"; echo "$x"', 'a:b\n'],
  ['echo $(printf "😀abc\\n" | cut -c 1-2)', '😀a\n'],
  ['echo $(printf "😀abc" | cut -c 1-1)', '😀\n'],
] as const) {
  test(source, async () => {
    for (const bounded of [false, true]) {
      const result = await run(source, bounded);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout, `bounded=${bounded}`);
    }
  });
}

for (const ifs of [":", ""]) for (const expression of ['${a[*]}', '"${a[*]}"', '${a[@]}', '"${a[@]}"', '"${!a[@]}"']) {
  for (const route of ["assignment", "here-string"]) {
    const source = `a=([2]=x [10]=y); IFS='${ifs}'; ` + (route === "assignment"
      ? `value=${expression}; printf '%s|%s' "$value" "$IFS"`
      : `IFS= read -r value <<<${expression}; printf '%s|%s' "$value" "$IFS"`);
    const expected = expression === '"${!a[@]}"' ? `2${ifs || " "}10`
      : expression.includes("[*]") ? `x${ifs}y` : "x y";
    test(`scalar ${route} joins ${expression} with IFS=${JSON.stringify(ifs)}`, async () => {
      for (const bounded of [false, true]) {
        const result = await run(source, bounded);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, `${expected}|${ifs}`, `bounded=${bounded}`);
      }
    });
  }
}

for (const expression of ['"${a[*]}"', '"${!a[@]}"']) test(`read prefix preserves raw IFS for ${expression}`, async () => {
  for (const bounded of [false, true]) {
    const result = await run(`a=([2]=x [10]=y); IFS=$'\\xff'; IFS= read -r value <<<${expression}; printf '%s|%s' "$value" "$IFS"`, bounded);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    const expected = expression.includes("!") ? [50, 255, 49, 48, 124, 255] : [120, 255, 121, 124, 255];
    assert.deepEqual([...result.stdoutBytes], expected, `bounded=${bounded}`);
  }
});

for (const bounded of [false, true]) {
  for (const [ifs, expected] of [[":", "a:b:c"], ["", "abc"], ["|:", "a|b|c"]] as const) {
    test(`plain array star scalar joining: IFS=${JSON.stringify(ifs)}, bounded=${bounded}`, async () => {
      const result = await run(`arr=(a b c); IFS='${ifs}'; x=\${arr[*]}; printf '<%s>' "$x"; [[ \${arr[*]} == "$x" ]] && printf yes; case \${arr[*]} in "$x") printf yes;; esac`, bounded);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `<${expected}>yesyes`);
    });
  }
  for (const [operand, expected] of [
    ['${arr[*]#p}', 'ax:bx:cx'],
    ['${arr[*]%x}', 'pa:pb:pc'],
    ['${arr[*]/p/X}', 'Xax:Xbx:Xcx'],
    ['${arr[*]^^}', 'PAX:PBX:PCX'],
    ['${arr[*]:1:2}', 'pbx:pcx'],
    ['${arr[@]#p}', 'ax:bx:cx'],
    ['${arr[@]/p/X}', 'Xax Xbx Xcx'],
    ['"${arr[@]/p/X}"', 'Xax:Xbx:Xcx'],
    ['"${arr[@]:1:2}"', 'pbx:pcx'],
    ['${arr[@]@U}', 'PAX:PBX:PCX'],
  ] as const) {
    test(`modified array scalar joining: ${operand}, bounded=${bounded}`, async () => {
      const result = await run(`arr=(pax pbx pcx); IFS=:; x=${operand}; printf '<%s>' "$x"`, bounded);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `<${expected}>`);
    });
  }
  test(`modified array joining preserves raw IFS and empty members, bounded=${bounded}`, async () => {
    const result = await run("LC_ALL=C; arr=($'\\xff' '' b); IFS=$'\\xfe'; x=${arr[*]#q}; printf '%s' \"$x\"", bounded);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual([...result.stdoutBytes], [255, 254, 254, 98]);
  });
}

for (const stage of ['head -n 1', 'tail -n 1', 'rev']) {
  for (const [flag, count] of [['-c', '3'], ['-l', '0']] as const) {
    test(`${stage} preserves an unterminated line before wc ${flag}`, async () => {
      const result = await run(`echo $(printf "abc" | ${stage} | wc ${flag})`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${count}\n`);
    });
  }
}

test('cut rejects decreasing ranges inside substitution', async () => {
  for (const source of ['x=$(printf "abc" | cut -c 4-2); echo $?', 'printf "abc" | cut -c 4-2; echo $?']) {
    const result = await run(source);
    assert.equal(result.stdout, '1\n');
    assert.ok(result.stderr.startsWith("cut: invalid decreasing range"));
  }
});

test('shell operations work without host Buffer or path globals', async () => {
  const buffer = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  const path = Object.getOwnPropertyDescriptor(globalThis, 'path');
  Reflect.deleteProperty(globalThis, 'Buffer');
  Reflect.deleteProperty(globalThis, 'path');
  try {
    for (const [source, stdout] of [
      ['echo $(dirname /a/b); echo $(basename /a/b.txt .txt)', '/a\nb\n'],
      ['trap "x=1" EXIT; trap -p', "trap -- 'x=1' EXIT\n"],
      ['eval "f() { :; }"; f; echo ok', 'ok\n'],
      ['for i in 1 2; do printf "%s" é; done', 'éé'],
      ['echo $(printf "%s" é)', 'é\n'],
      ['LC_ALL=C; x=abc; echo ${x:1:1}', 'b\n'],
      ['read x <<< "abc"; echo "$x"', 'abc\n'],
      [`read x <<< "${'a'.repeat(100)}"; echo "$x"`, `${'a'.repeat(100)}\n`],
      [`mapfile -t arr <<< "${'a'.repeat(100)}"; echo "${'${arr[0]}'}"`, `${'a'.repeat(100)}\n`],
      ['x=$(for i in 1 2; do echo x; done); echo "$x"', 'x\nx\n'],
      ['x=$(f() { echo ok; }; f); echo "$x"', 'ok\n'],
    ] as const) {
      const result = await run(source);
      assert.equal(result.exitCode, 0, source);
      assert.equal(result.stderr, '', source);
      assert.equal(result.stdout, stdout, source);
    }
  } finally {
    if (buffer) Object.defineProperty(globalThis, 'Buffer', buffer);
    if (path) Object.defineProperty(globalThis, 'path', path);
  }
});

for (const command of ["read -a", "mapfile -t", "readarray -t"]) {
  for (const initial of ["arr=scalar", "unset arr"]) {
    for (const loop of ["for ((i=0;i<2;i++))", "while ((n<2))", "until ((n>=2))"]) {
      test(`${command} converts ${initial} once per ${loop} iteration`, async () => {
        const input = initial === "arr=scalar" ? "a b" : "${x:=init} ${arr:=hello world}";
        const source = `${initial}; unset x; n=0; ${loop}; do n=$((n+1)); ${command} arr <<< "${input}"; done; echo "n=$n x=$x arr=(\${arr[*]})"`;
        const expected = initial === "arr=scalar" ? "n=2 x= arr=(a b)\n" : command === "read -a" ? "n=2 x=init arr=(init init)\n" : "n=2 x=init arr=(init init hello world)\n";
        const result = await run(source);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
      });
    }
  }
}

for (const values of ["1 2", ""]) {
  for (const local of [false, true]) {
    test(`recycled ${local ? "local" : "global"} array (${values}) is unassigned`, async () => {
      const source = local
        ? `f() { local -a arr=(${values}); }; g() { local -a arr; echo "prefix:<\${!arr*}> at:<\${!arr@}>"; }; f; g`
        : `for ((i=0;i<1;i++)); do arr=(${values}); unset arr; declare -a arr; done; echo "prefix:<\${!arr*}> at:<\${!arr@}>"`;
      const result = await run(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "prefix:<> at:<>\n");
    });
  }
}

for (const command of ["read -a", "mapfile -t", "readarray -t"]) {
  test(`${command} replaces cached scalar values and marks an empty result assigned`, async () => {
    for (const bounded of [false, true]) {
      const source = `arr=scalar; cached=$arr; ${command} arr <<< ""; echo "cached=$cached value=<$arr> prefix=<\${!arr*}> at=<\${!arr@}>"`;
      const result = await run(source, bounded);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "cached=scalar value=<> prefix=<arr> at=<arr>\n");
    }
  });
}

for (const promotion of ["arr=(x y)", "arr[1]=y", 'read -a arr <<< "x y"', 'mapfile -t arr <<< "x y"', 'readarray -t arr <<< "x y"']) {
  for (const initial of ["arr=scalar", "unset arr"]) {
    test(`plain local restores ${initial} after ${promotion}`, async () => {
      const inspect = 'printf "<%s|%s|%s|%s>\\n" "$arr" "${arr[*]}" "${#arr[@]}" "${!arr*}"';
      const outer = initial === "arr=scalar" ? "<scalar|scalar|1|arr>\n" : "<||0|>\n";
      for (const bounded of [false, true]) {
        for (const body of [promotion, `: | cat; ${promotion}`, `${promotion}; return 7`]) {
          const definition = `f() { local arr; ${body}; };`;
          for (const [call, expected] of [
            ["f", outer],
            ["for _ in 1 2; do f; done", outer],
            [`g() { local arr=middle; f; ${inspect}; }; g`, `<middle|middle|1|arr>\n${outer}`],
          ]) {
            const source = `${initial}; ${definition} ${call}; ${inspect}`;
            const result = await run(source, bounded);
            assert.equal(result.exitCode, 0, source);
            assert.equal(result.stderr, "", source);
            assert.equal(result.stdout, expected, `bounded=${bounded}, script=${source}`);
          }
        }
      }
    });
  }
}
