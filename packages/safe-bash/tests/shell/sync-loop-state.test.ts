import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";

const cases = [
  ['assign default loop fallback', 'sp="hello world"; for ((i=0;i<2;i++)); do unset a; echo "${a:-was_unset}" "${a:=now_set}" $sp; done; echo "$a"', 'was_unset now_set hello world\nwas_unset now_set hello world\nnow_set\n'],
  ['assign default function arguments', 'f() { printf "%s|" "$@"; echo; }; unset a; sp="hello world"; f "${a:-was_unset}" "${a:=now_set}" $sp; echo "$a"', 'was_unset|now_set|hello|world|\nnow_set\n'],
  ['assign default split fallback', 'unset a; echo "${a:-was_unset}" ${a:=hello world}; echo "$a"', 'was_unset hello world\nhello world\n'],
  ['assign default later argument fallback', 'unset a; sp="hello world"; echo "${a:-was_unset}" "${a:=now_set}" $sp; echo "$a"', 'was_unset now_set hello world\nnow_set\n'],
  ['assign unset later argument fallback', 'unset a; sp="hello world"; printf "%s|" "${a-was_unset}" "${a=now_set}" $sp; echo; echo "$a"', 'was_unset|now_set|hello|world|\nnow_set\n'],
  ['assign default same word fallback', 'unset a; sp="hello world"; echo "${a:-was_unset}" "${a:=now_set}"$sp; echo "$a"', 'was_unset now_sethello world\nnow_set\n'],

  ['zero-iteration existing target', 'x=preserve_me; for ((j=5;j<2;j++)); do x=$((j+1)); done; echo "j=$j x=$x"', 'j=5 x=preserve_me\n'],
  ['zero-iteration unset target', 'unset x; for ((j=5;j<2;j++)); do x=$((j+1)); done; echo "j=$j x=${x-UNSET}"', 'j=5 x=UNSET\n'],
  ['zero-iteration unset reference', 'unset x; for ((j=5;j<2;j++)); do x=$((x+1)); done; echo "j=$j x=${x-UNSET}"', 'j=5 x=UNSET\n'],
  ['zero-iteration last argument', 'echo sentinel >/dev/null; for ((j=5;j<2;j++)); do x=$((j+1)); done; echo "$_:$?"', 'sentinel:0\n'],
  ['zero-iteration allexport', 'x=7; set -a; for ((j=2;j<2;j++)); do x=$((j+1)); done; set +a; declare -p x j', 'declare -- x="7"\ndeclare -x j="2"\n'],
  ['zero-iteration deferred target', 'x=preserve_me; for ((j=5;j<=2;j++)); do x="value_$j"; done; echo "j=$j x=$x"', 'j=5 x=preserve_me\n'],
  ['zero-iteration substitution target', 'x=preserve_me; for ((j=5;j<2;j++)); do x=$(echo $((j+1))); done; echo "j=$j x=$x"', 'j=5 x=preserve_me\n'],
  ['getopts diagnostics', 'OPTERR=0; run_opts() { local OPTIND=1 opt; while getopts "ab:" opt "$@"; do total=$((total+1)); done; }; total=0; for ((i=0;i<3;i++)); do if ((i==2)); then run_opts -a -x; else run_opts -a -b val; fi; done; echo "total=$total"', 'total=6\n'],
  ['getopts missing argument', 'OPTERR=0; total=0; f() { local OPTIND=1 opt; while getopts "ab:" opt "$@"; do total=$((total+1)); done; }; for ((i=0;i<3;i++)); do if ((i==2)); then f -a -b; else f -a -b val; fi; done; echo "$total"', '6\n'],
  ['getopts slice', 'set -- -x -a; getopts ":ab" opt "${@:2}"; echo "opt=$opt OPTARG=$OPTARG"', 'opt=a OPTARG=\n'],
  ['local array', 'arr=initial; f() { local -a arr=(x y); }; for ((i=0;i<2;i++)); do arr="iter_$i"; f; echo "$arr"; done', 'iter_0\niter_1\n'],
  ['exported local', 'OPTERR=0; export x=outer; f() { local x=inner; if ((i==1)); then getopts a opt -z; fi; }; for ((i=0;i<2;i++)); do f; done; declare -p x', 'declare -x x="outer"\n'],
  ['mapfile later scalar', 'total=0; for ((i=0;i<3;i++)); do total=$((total+1)); if ((i==2)); then unset arr; arr=scalar; fi; mapfile -t arr <<< "$i"; done; echo "$total:${arr[0]}"', '3:2\n'],
  ['mapfile scalar', 'arr=scalar; total=0; for ((i=0;i<3;i++)); do total=$((total+1)); mapfile -t arr <<< "$i"; done; echo "$total:${arr[0]}"', '3:2\n'],
  ['mapfile growing input', 'text=x; total=0; for ((i=0;i<3;i++)); do total=$((total+1)); if ((i==2)); then for ((j=0;j<300;j++)); do text+=$\'\\n\'x; done; fi; mapfile -t arr <<< "$text"; done; echo "$total:${#arr[@]}"', '3:301\n'],
] as const;
for (const [name, source, expected] of cases) {
  test(`sync loops preserve ${name}`, async () => {
    if (name.startsWith('zero-iteration') || name.startsWith('assign ')) {
      const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stderr, "");
      assert.equal(native.stdout, expected);
    }
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

for (const expansion of ["${@:2}", "${@#prefix}", "${@/a/b}", "${#@}", "$@", "${@}"]) {
  test(`getopts expands ${expansion} like Bash`, async () => {
    const source = `set -- -x -a; getopts ":ab" opt "${expansion}"; echo "$?:$opt:$OPTARG:$OPTIND"`;
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected.stdout);
      assert.equal(result.stderr, expected.stderr);
      assert.equal(result.exitCode, expected.status);
    } finally { await shell.dispose(); }
  });
}
for (const loop of [
  'for ((i=0;i<3;i++)); do BODY; done',
  'for i in 0 1 2; do BODY; done',
  'i=0; while ((i<3)); do BODY; ((i++)); done',
  'i=0; until ((i>=3)); do BODY; ((i++)); done',
]) {
  test(`local state survives ${loop.split(";")[0]}`, async () => {
    const source = 'arr=initial; export x=outer; f() { local -a arr=(x y); local x=inner; }; ' + loop.replace('BODY', 'arr="iter_$i"; f; echo "$arr"') + '; declare -p x';
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, 'iter_0\niter_1\niter_2\ndeclare -x x="outer"\n');
    } finally { await shell.dispose(); }
  });
}

test("getopts respects quoted positional transformation", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec('set -- -x -a; getopts ":ab" opt "${@@Q}"; echo "$?:$opt:$OPTARG:$OPTIND"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "1:?::1\n");
  } finally { await shell.dispose(); }
});

const deferredExpansionCases = [
  ["associative subscript", 'declare -A map=([k0]=alpha [k1]=beta); v=unused', 'k="k$j"', '${map[$k]}', 'alpha,beta,'],
  ["indexed subscript", 'arr=(alpha beta)', 'k="$j"', '${arr[$k]}', 'alpha,beta,'],
  ["default", 'v=""', 'k="item$j"', '${v:-$k}', 'item0,item1,'],
  ["assign default", 'v=""', 'k="item$j"; v=""', '${v:=$k}', 'item0,item1,'],
  ["alternate", 'v=set', 'k="item$j"', '${v:+$k}', 'item0,item1,'],
  ["replacement", 'v=a-b', 'k="x$j"', '${v/-/$k}', 'ax0b,ax1b,'],
  ["pattern", 'v=k0-k1', 'k="k$j"', '${v/$k/X}', 'X-k1,k0-X,'],
  ["prefix", 'v=k0-k1', 'k="k$j"', '${v#$k}', '-k1,k0-k1,'],
  ["suffix", 'v=k0-k1', 'k="k$j"', '${v%$k}', 'k0-k1,k0-,'],
  ["substring offset", 'v=abc', 'k="$j"', '${v:$k:1}', 'a,b,'],
  ["substring length", 'v=abc', 'k="$j"', '${v:0:$k}', ',a,'],
  ["nested default", 'v=""; missing=""', 'k="item$j"', '${v:-${missing:-$k}}', 'item0,item1,'],
] as const;

for (const [name, setup, assignment, expansion, expected] of deferredExpansionCases) {
  test(`arithmetic loops retain dependencies in ${name}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const source = `${setup}; acc=""; for ((j=0;j<2;j++)); do ${assignment}; m=${expansion}; acc="\${acc}\${m},"; done; echo "$acc"`;
      // macOS ships Bash 3, which has no associative arrays. Keep that case's
      // explicit expected bytes; compare the remaining syntax with host Bash.
      if (name !== "associative subscript") {
        const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
        assert.equal(bash.status, 0, bash.stderr);
        assert.equal(bash.stdout, `${expected}\n`);
      }
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${expected}\n`);
    } finally { await shell.dispose(); }
  });
}

for (const [name, source, expected] of [
  ["read before assignment", 'v=""; k=old; acc=""; for ((j=0;j<2;j++)); do m=${v:-$k}; k="item$j"; acc="${acc}${m},"; done; echo "$acc|$k|$m"', 'old,item0,|item1|item0\n'],
  ["later overwrite", 'v=""; acc=""; for ((j=0;j<2;j++)); do k="item$j"; m=${v:-$k}; k=last; acc="${acc}${m},"; done; echo "$acc|$k|$m"', 'item0,item1,|last|item1\n'],
  ["expanded assignment target", 'v=""; arr=(); for ((j=0;j<2;j++)); do k="$j"; arr[${v:-$k}]="item$j"; done; echo "${arr[0]}|${arr[1]}|$k"', 'item0|item1|1\n'],
  ["zero iterations", 'v=""; k=old; m=old; for ((j=0;j<0;j++)); do k="item$j"; m=${v:-$k}; done; echo "$k|$m"', 'old|old\n'],
] as const) {
  test(`arithmetic loop dependency ordering: ${name}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    assert.equal(bash.stdout, expected);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

for (const loop of ['for ((j=0;j<2;j++))', 'for j in {0..1}', 'for ((j=0;j<1;j++))', 'for j in 0']) {
  for (const body of [
    'm="${!ZZ*}"; ZZx="item$j"; acc="${acc}${m}|"',
    'm="${!ZZ@}"; ZZx="item$j"; acc="${acc}${m}|"',
    'y=$(( ++x ))',
    'y=$(( $j + ++x ))',
    'y=$(( x-- ))',
    'y=$(( x=4 ))',
    'y=$(( x+=2 ))',
    'y=$(( $j + (x+=2) ))',
    'y=$(( arr[$j] ))',
    'y=$(( $j + x ))',
    'y=$(( ${j} + (x+=2) ))',
    'a="$?"; k="$j"',
    'k="$j"; a="$?"',
    'k=$((j+1)); a="$?"',
    'a="$?"',
  ]) {
    test(`sync loop command semantics: ${loop} ${body}`, async () => {
      const source = `unset ZZx; ZZa=1; acc=""; x=0; y=initial; arr=(4 5); false; ${loop}; do ${body}; done; printf '%s\\n' "$acc|$x|$y|$a|$k"`;
      const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
      assert.equal(bash.status, 0, bash.stderr);
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
      try {
        const result = await shell.exec(source);
        assert.equal(result.exitCode, bash.status, result.stderr);
        assert.equal(result.stderr, bash.stderr);
        assert.equal(result.stdout, bash.stdout);
      } finally { await shell.dispose(); }
    });
  }
}

for (const [label, source] of [
  [
    "while getopts standard options and positional args",
    "set -- -a alpha -b -c -a beta -- tail1 tail2; OPTIND=1; out=; while getopts \"a:bc\" opt; do case \"$opt\" in a) out+=\"A:$OPTARG;\" ;; b) out+=\"B;\" ;; c) out+=\"C;\" ;; esac; done; shift $((OPTIND - 1)); printf '%s|%s|%s|%s\\n' \"$out\" \"$OPTIND\" \"$opt\" \"$*\"",
  ],
  [
    "while getopts silent mode unknown option and missing argument",
    "set -- -a ok -x -a; OPTIND=1; out=; while getopts \":a:bc\" opt \"$@\"; do out+=\"$opt:${OPTARG-unset};\"; done; printf '%s|%s|%s\\n' \"$out\" \"$OPTIND\" \"$opt\"",
  ],
  [
    "while getopts explicit arguments list and break",
    "OPTIND=1; out=; while getopts \"a:bc\" opt -b -a stop -c; do out+=\"$opt:${OPTARG-none};\"; if [[ \"$opt\" == a ]]; then break; fi; done; printf '%s|%s|%s\\n' \"$out\" \"$OPTIND\" \"$opt\"",
  ],

  [
    "compound array assignment and reset inside sync loop",
    "out=; for i in 1 2 3; do arr=(\"x_$i\" \"y_$i\"); arr+=(\"z_$i\"); out+=\"${arr[0]},${arr[1]},${arr[2]},${#arr[@]};\"; arr=(); out+=\"${#arr[@]};\"; done; printf '%s\\n' \"$out\"",
  ],
  [
    "printf -- leading-dash format in stdout, -v, and substitution for-loop",
    "i=outer; sub=$(for i in 1 2 3; do printf -- \"-%s:%d\\n\" \"item\" \"$i\"; done); out=; for k in 1 2; do printf -v v -- \"--k=%02d\" \"$k\"; out+=\"$v;\"; done; printf '%s|%s|%s\\n' \"$i\" \"${sub//$'\\n'/,}\" \"$out\"",
  ],
] as const) {
  test(`wave 90 sync loop parity: ${label}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, bash.status, result.stderr);
      assert.equal(result.stderr, bash.stderr);
      assert.equal(result.stdout, bash.stdout);
    } finally { await shell.dispose(); }
  });
}

test("wave 90 sync loop parity: mapfile -t and readarray -t here-string inside sync loop", async () => {
  const source = "nl=$'\\n'; out=; for i in 1 2 3; do mapfile -t arr <<< \"r${i}_0${nl}r${i}_1${nl}r${i}_2\"; readarray -t <<< \"m${i}_a${nl}m${i}_b\"; out+=\"${arr[0]}:${arr[2]}:${#arr[@]}:${MAPFILE[1]}:${#MAPFILE[@]};\"; done; printf '%s\\n' \"$out\"";
  const fastShell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  const refShell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()), limits: { maxExpansionBytes: 65536 } });
  try {
    const [fastRes, refRes] = await Promise.all([fastShell.exec(source), refShell.exec(source)]);
    assert.equal(fastRes.exitCode, 0, fastRes.stderr);
    assert.equal(fastRes.stderr, "");
    assert.equal(fastRes.stdout, "r1_0:r1_2:3:m1_b:2;r2_0:r2_2:3:m2_b:2;r3_0:r3_2:3:m3_b:2;\n");
    assert.equal(fastRes.stdout, refRes.stdout);
  } finally {
    await fastShell.dispose();
    await refShell.dispose();
  }
});

for (const [label, source] of [
  [
    "while [[ =~ ]] anchored ERE with comma, star, and BASH_REMATCH captures",
    "rest=\"10,20,30,\"; sum=0; while [[ \"$rest\" =~ ^([0-9]+),(.*)$ ]]; do ((sum += BASH_REMATCH[1])); rest=\"${BASH_REMATCH[2]}\"; done; printf '%d|%s\\n' \"$sum\" \"$rest\"",
  ],
  [
    "while [[ =~ ]] unanchored ERE fallback preserves BASH_REMATCH",
    "rest=\"a1b2c3\"; sum=0; while [[ \"$rest\" =~ ([0-9]) ]]; do ((sum += BASH_REMATCH[1])); rest=\"${rest#*${BASH_REMATCH[1]}}\"; done; printf '%d|%s\\n' \"$sum\" \"$rest\"",
  ],
  [
    "while [[ -n ]] and while [ -n ] unary string predicates",
    "s=\"abcd\"; o1=; while [[ -n \"$s\" ]]; do o1+=\"${s:0:1}.\"; s=\"${s:1}\"; done; t=\"xyz\"; o2=; while [ -n \"$t\" ]; do o2+=\"${t:0:1}.\"; t=\"${t:1}\"; done; printf '%s|%s\\n' \"$o1\" \"$o2\"",
  ],
  [
    "unset indexed array element assignment uarr[i]=v in loop",
    "unset uarr; for ((i=0; i<4; i++)); do uarr[i]=\"v_$i\"; uarr[i]+=\":$((i*2))\"; done; printf '%s|%d\\n' \"${uarr[*]}\" \"${#uarr[@]}\"",
  ],
] as const) {
  test(`wave 91 sync loop parity: ${label}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    const commands = new CommandRegistry([...basicCommands(), ...predicateCommands()]);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, bash.status, result.stderr);
      assert.equal(result.stderr, bash.stderr);
      assert.equal(result.stdout, bash.stdout);
    } finally { await shell.dispose(); }
  });
}

test("wave 91 sync loop parity: associative array element append map[k]+=v", async () => {
  const source = "declare -A m; for k in a b a c b a; do m[$k]+=\"x\"; done; printf '%s|%s|%s\\n' \"${m[a]}\" \"${m[b]}\" \"${m[c]}\"";
  const fastShell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  const refShell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()), limits: { maxExpansionBytes: 65536 } });
  try {
    const [fastRes, refRes] = await Promise.all([fastShell.exec(source), refShell.exec(source)]);
    assert.equal(fastRes.exitCode, 0, fastRes.stderr);
    assert.equal(fastRes.stderr, "");
    assert.equal(fastRes.stdout, "xxx|xx|x\n");
    assert.equal(fastRes.stdout, refRes.stdout);
  } finally {
    await fastShell.dispose();
    await refShell.dispose();
  }
});

for (const [label, source] of [
  [
    "read -r -d : and while IFS= read -r -d : here-strings in sync loop",
    "s=\"a:b:c:\"; out=; while IFS= read -r -d : tok; do out+=\"[$tok]\"; done <<< \"$s\"; r2=; for x in \"k1:v1\" \"k2:v2\" \"no_colon\"; do read -r -d : k <<< \"$x\"; r2+=\"$k/$?;\"; done; printf '%s|%s\\n' \"$out\" \"$r2\"",
  ],
  [
    "while ((i < n && j > 0)) compound arithmetic condition and trim with BASH_REMATCH",
    "i=0; j=6; sum=0; while ((i < 6 && j > 0)); do ((sum += i + j)); ((i++)); ((j--)); done; rest=\"a12b34c56\"; rsum=0; while [[ \"$rest\" =~ ([0-9]+) ]]; do ((rsum += BASH_REMATCH[1])); rest=\"${rest#*${BASH_REMATCH[1]}}\"; done; printf '%d|%d|%s\\n' \"$sum\" \"$rsum\" \"$rest\"",
  ],
] as const) {
  test(`wave 92 sync loop parity: ${label}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    const commands = new CommandRegistry([...basicCommands(), ...predicateCommands()]);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, bash.status, result.stderr);
      assert.equal(result.stderr, bash.stderr);
      assert.equal(result.stdout, bash.stdout);
    } finally { await shell.dispose(); }
  });
}
