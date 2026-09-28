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

for (const [label, source] of [
  [
    "$(if ...) and $(case ...) pure command substitutions in sync loop",
    "out1=; out2=; for ((i=1; i<=12; i++)); do t1=$(if ((i % 2 == 0)); then echo \"e$i\"; else echo \"o$i\"; fi); m=$((i % 3)); t2=$(case \"$m\" in (0) echo \"z$i\" ;; (1) echo \"n$i\" ;; (*) echo \"w$i\" ;; esac); out1+=\"$t1,\"; out2+=\"$t2,\"; done; printf \"%s|%s\\n\" \"$out1\" \"$out2\"",
  ],
  [
    "[[ $s =~ $pat ]] unquoted variable pattern and $(while ...)/$(for ...) subshells in sync loop",
    "pat=\"^([0-9]+):([a-z]+)$\"; rsum=0; for ((i=1; i<=10; i++)); do s=\"$i:xyz\"; if [[ \"$s\" =~ $pat ]]; then ((rsum += BASH_REMATCH[1])); fi; done; j=0; s1=$(while ((j<4)); do printf \"%d,\" \"$((10+j))\"; ((j++)); done); k=99; for ((i=1; i<=3; i++)); do s2=$(for ((k=0; k<3; k++)); do printf \"%d,\" \"$((i+k))\"; done); done; printf \"%d|%s|%s:%d|%s:%d\\n\" \"$rsum\" \"${BASH_REMATCH[2]}\" \"$s1\" \"$j\" \"$s2\" \"$k\"",
  ],
] as const) {
  test(`wave 93 sync loop parity: ${label}`, async () => {
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

for (const [label, source] of [
  [
    "for x in ${s//:/ } and arr=( ${s//:/ } ) unquoted parameter expansion splitting in sync loop",
    "s=\"a:b:c:d\"; cnt=0; sum=0; for ((i=1; i<=10; i++)); do for x in ${s//:/ }; do ((cnt++)); done; arr=( ${s//:/ } ); sum=$((sum + ${#arr[@]})); done; top=0; for y in ${s//:/ }; do ((top++)); done; printf \"%d|%d|%s|%d\\n\" \"$cnt\" \"$sum\" \"${arr[2]}\" \"$top\"",
  ],
  [
    "$(echo $s | tr : space) and $(tr : _ <<< $s) character set translation in sync loop",
    "s=\"a:b:c\"; for ((i=1; i<=10; i++)); do p1=$(echo \"$s\" | tr : \" \"); p2=$(tr : _ <<< \"$s\"); done; printf \"%s|%s\\n\" \"$p1\" \"$p2\"",
  ],
] as const) {
  test(`wave 94 sync loop parity: ${label}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    const { createStandardCommands } = await import("../../src/commands/index.js");
    const commands = new CommandRegistry(createStandardCommands());
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, bash.status, result.stderr);
      assert.equal(result.stderr, bash.stderr);
      assert.equal(result.stdout, bash.stdout);
    } finally { await shell.dispose(); }
  });
}

for (const [label, source] of [
  [
    "$(uniq <<< $s), $(uniq -d <<< $s), and $(uniq -u <<< $s) in sync loop",
    "printf -v s \"a\\na\\nb\\nc\\nc\"; for ((i=1; i<=10; i++)); do u1=$(uniq <<< \"$s\"); u2=$(uniq -d <<< \"$s\"); u3=$(uniq -u <<< \"$s\"); done; printf \"%s|%s|%s\\n\" \"$u1\" \"$u2\" \"$u3\"",
  ],
  [
    "unset arr[i] unquoted and unset \"arr[$i]\" quoted array element unsets in sync loop",
    "arr=(); for ((i=0; i<20; i++)); do arr[i]=\"v$i\"; done; for ((i=0; i<10; i+=2)); do unset arr[i]; done; for ((i=10; i<20; i+=2)); do unset \"arr[$i]\"; done; printf \"%d|%s|%s|%s\\n\" \"${#arr[@]}\" \"${arr[1]}\" \"${arr[2]-unset}\" \"${arr[12]-unset}\"",
  ],
] as const) {
  test(`wave 95 sync loop parity: ${label}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    const { createStandardCommands } = await import("../../src/commands/index.js");
    const commands = new CommandRegistry(createStandardCommands());
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, bash.status, result.stderr);
      assert.equal(result.stderr, bash.stderr);
      assert.equal(result.stdout, bash.stdout);
    } finally { await shell.dispose(); }
  });
}

for (const [label, source] of [
  [
    "read -r -n and -rn with delimiter and IFS splitting in sync loop",
    "s=\"ab cd:ef\"; out=\"\"; for ((i=0; i<10; i++)); do read -r -n 4 a b <<< \"$s\"; read -rn 3 c <<< \"$s\"; out+=\"$a|$b|$c,\"; done; printf \"%s\\n\" \"$out\"",
  ],
  [
    "sparse indexed compound array assignment arr=([2]=... [5]=...) in sync loop",
    "for ((i=1; i<=10; i++)); do arr=([2]=\"$i\" [5]=\"$((i*3))\"); done; printf \"%s|%s|%s\\n\" \"${arr[2]}\" \"${arr[5]}\" \"${!arr[*]}\"",
  ],
] as const) {
  test(`wave 96 sync loop parity: ${label}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    const { createStandardCommands } = await import("../../src/commands/index.js");
    const commands = new CommandRegistry(createStandardCommands());
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, bash.status, result.stderr);
      assert.equal(result.stderr, bash.stderr);
      assert.equal(result.stdout, bash.stdout);
    } finally { await shell.dispose(); }
  });
}

test("wave 96 sync loop: read -r -N exact chars, ${var@U}/${var@L}/${var@u}, and associative compound map=([a]=... [b]=...)", async () => {
  const { createStandardCommands } = await import("../../src/commands/index.js");
  const commands = new CommandRegistry(createStandardCommands());
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  try {
    const script = [
      "s=$'ab\\ncd'",
      "declare -A map",
      "for ((i=1; i<=10; i++)); do",
      "  read -r -N 4 a b <<< \"$s\"",
      "  w=\"helloWorld$i\"",
      "  u=\"${w@U}\"; l=\"${w@L}\"; c=\"${w@u}\"",
      "  map=([a]=\"$u\" [b]=\"$l\" [c]=\"$c\")",
      "done",
      "printf \"%s|%s|%s|%s|%s\\n\" \"${a//$'\\n'/NL}\" \"$b\" \"${map[a]}\" \"${map[b]}\" \"${map[c]}\"",
    ].join("\n");
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "abNLc||HELLOWORLD10|helloworld10|HelloWorld10\n");
  } finally {
    await shell.dispose();
  }
});

for (const [label, source] of [
  [
    "$(sort -u), $(sort -n), $(sort -rn), $(head -c N), and $(tail -c N) in sync loop",
    "printf -v s \"10\\n2\\n10\\n1\"; out=\"\"; for ((i=1; i<=10; i++)); do u=$(sort -u <<< \"$s\"); n=$(sort -n <<< \"$s\"); rn=$(sort -rn <<< \"$s\"); h=$(head -c 3 <<< \"abcdef\"); t=$(tail -c 4 <<< \"abcdef\"); out+=\"$u|$n|$rn|$h|$t;\"; done; printf \"%s\\n\" \"$out\"",
  ],
  [
    "${!prefix*} variable name expansion and $(rev <<< $s) in sync loop",
    "pfx_b=1; pfx_a=2; pfx_c=3; s=\"abcdef\"; out=\"\"; for ((i=1; i<=10; i++)); do k=\"${!pfx_*}\"; r=$(rev <<< \"$s\"); out+=\"$k|$r;\"; done; printf \"%s\\n\" \"$out\"",
  ],
] as const) {
  test(`wave 97 sync loop parity: ${label}`, async () => {
    const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(bash.status, 0, bash.stderr);
    const { createStandardCommands } = await import("../../src/commands/index.js");
    const { createStreamFormatCommands } = await import("../../src/commands/stream-format/index.js");
    const commands = new CommandRegistry([...createStandardCommands(), ...createStreamFormatCommands()]);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, bash.status, result.stderr);
      assert.equal(result.stderr, bash.stderr);
      assert.equal(result.stdout, bash.stdout);
    } finally { await shell.dispose(); }
  });
}

test("wave 97 sync loop: ${var@Q} quoting transform with spaces, quotes, and control chars", async () => {
  const { createStandardCommands } = await import("../../src/commands/index.js");
  const commands = new CommandRegistry(createStandardCommands());
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  try {
    const script = [
      "s1=\"hello world\"",
      "s2=\"it's\"",
      "s3=$'line1\\nline2\\t!'",
      "for ((i=1; i<=10; i++)); do",
      "  q1=\"${s1@Q}\"; q2=\"${s2@Q}\"; q3=\"${s3@Q}\"",
      "done",
      "printf \"%s|%s|%s\\n\" \"$q1\" \"$q2\" \"$q3\"",
    ].join("\n");
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "'hello world'|'it'\\''s'|$'line1\\nline2\\t!'\n");
  } finally {
    await shell.dispose();
  }
});

test("wave 98 sync loop: cut ranges, sed custom delimiters/anchors, grep -E alternation, and awk literal concat", async () => {
  const { createStandardCommands } = await import("../../src/commands/index.js");
  const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
  const commands = new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  try {
    const script = [
      's_cut="a:b:c:d"',
      's_sed="a/b/a"',
      's_anc="foobar"',
      's_awk="foo:bar:baz"',
      "s_grep=$'cat\\ndog\\nbat'",
      "for ((i=1; i<=10; i++)); do",
      '  c1=$(cut -c1-3 <<< "$s_cut")',
      '  c2=$(cut -d: -f2- <<< "$s_cut")',
      '  c3=$(cut -d: -f1-2 <<< "$s_cut")',
      '  c4=$(cut -d: -f-2 <<< "$s_cut")',
      '  d1=$(sed "s#a#b#g" <<< "$s_sed")',
      '  d2=$(sed "s/^foo/baz/" <<< "$s_anc")',
      '  d3=$(sed "s/bar$/qux/" <<< "$s_anc")',
      '  a1=$(awk -F: \'{print $1 ":" $2}\' <<< "$s_awk")',
      '  g1=$(grep -E "cat|bat" <<< "$s_grep")',
      '  p1=$(printf "%s\\n" "$s_sed" | sed "s#a#b#g" | cut -d/ -f1-2)',
      "done",
      'printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n" "$c1" "$c2" "$c3" "$c4" "$d1" "$d2" "$d3" "$a1" "${g1//$' + "'\\n'" + '/,}" "$p1"',
    ].join("\n");
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a:b|b:c:d|a:b|a:b|b/b/b|bazbar|fooqux|foo:bar|cat,bat|b/b\n");
  } finally {
    await shell.dispose();
  }
});

test("wave 99 sync loop: POSIX tr classes, jq array/iter/length/keys filters, sed d/-n p, and cut -s", async () => {
  const { createStandardCommands } = await import("../../src/commands/index.js");
  const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
  const { createStructuredCommands } = await import("../../src/commands/structured/index.js");
  const commands = new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands(), ...createStructuredCommands()]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  try {
    const script = [
      'j=\'{"items":[{"name":"alpha"},{"name":"beta"}]}\'',
      "s_lines=$'hdr\\nrow1\\nrow2'",
      's_tr="hello_world 123"',
      "s_cut=$'no_delim\\na:b:c'",
      "for ((i=1; i<=10; i++)); do",
      '  j1=$(jq -r ".items[1].name" <<< "$j")',
      '  j2=$(jq -r ".items[].name" <<< "$j")',
      '  j3=$(jq -r ".items | length" <<< "$j")',
      '  j4=$(jq -r "keys[]" <<< "$j")',
      '  d1=$(sed "1d" <<< "$s_lines")',
      '  d2=$(sed -n "2p" <<< "$s_lines")',
      '  t1=$(tr "[:lower:]" "[:upper:]" <<< "$s_tr")',
      '  t2=$(tr -d "[:space:]" <<< "$s_tr")',
      '  t3=$(tr -d "[:digit:]" <<< "$s_tr")',
      '  c1=$(cut -s -d: -f2 <<< "$s_cut")',
      "done",
      'printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n" "$j1" "${j2//$' + "'\\n'" + '/,}" "$j3" "$j4" "${d1//$' + "'\\n'" + '/,}" "$d2" "$t1" "$t2" "$t3" "$c1"',
    ].join("\n");
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "beta|alpha,beta|2|items|row1,row2|row1|HELLO_WORLD 123|hello_world123|hello_world |b\n");
  } finally {
    await shell.dispose();
  }
});

test("wave 100 sync loop: multi-stage pipeline sort -u, head -c, cut ranges, awk concat, grep -E, rev, and unsupported sed regex fallback", async () => {
  const { createStandardCommands } = await import("../../src/commands/index.js");
  const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
  const commands = new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  try {
    const script = [
      's_abc="abcdef"',
      's_col="a:b:c:d"',
      's_awk="foo:bar:baz"',
      "s_sort=$'b\\na\\nb'",
      "s_grep=$'cat\\ndog\\nbat'",
      's_re="abc123"',
      "for ((i=1; i<=10; i++)); do",
      '  p_sort=$(printf "%s\\n" "$s_sort" | sort -u)',
      '  p_head=$(printf "%s\\n" "$s_abc" | head -c 3)',
      '  p_cut=$(printf "%s\\n" "$s_col" | cut -d: -f2-)',
      '  p_awk=$(printf "%s\\n" "$s_awk" | awk -F: \'{print $1 ":" $2}\')',
      '  p_grep=$(printf "%s\\n" "$s_grep" | grep -E "cat|bat")',
      '  p_rev=$(printf "%s\\n" "$s_abc" | rev)',
      '  p_sed=$(printf "%s\\n" "$s_re" | sed "s/[a-z]/X/g")',
      "done",
      'printf "%s|%s|%s|%s|%s|%s|%s\\n" "${p_sort//$' + "'\\n'" + '/,}" "$p_head" "$p_cut" "$p_awk" "${p_grep//$' + "'\\n'" + '/,}" "$p_rev" "$p_sed"',
    ].join("\n");
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a,b|abc|b:c:d|foo:bar|cat,bat|fedcba|XXX123\n");
  } finally {
    await shell.dispose();
  }
});

test("wave 101 sync loop: basename --/-a/-s, dirname --/multi-arg, and wc -m/-L", async () => {
  const { createStandardCommands } = await import("../../src/commands/index.js");
  const commands = new CommandRegistry(createStandardCommands());
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  try {
    const script = [
      'p="/a/b/c.ts"',
      'dash_p="-dir/file.txt"',
      "s_lines=$'ab\\nabcdef\\nabc'",
      "for ((i=1; i<=10; i++)); do",
      '  b1=$(basename -- "$p")',
      '  b2=$(basename -- "$dash_p" .txt)',
      '  b3=$(basename -a -s .ts /x/a.ts /y/b.ts)',
      '  d1=$(dirname -- "$dash_p")',
      '  d2=$(dirname /x/a /y/b)',
      '  w1=$(wc -m <<< "$s_lines")',
      '  w2=$(wc -L <<< "$s_lines")',
      "done",
      'printf "%s|%s|%s|%s|%s|%s|%s\\n" "$b1" "$b2" "${b3//$' + "'\\n'" + '/,}" "$d1" "${d2//$' + "'\\n'" + '/,}" "${w1// /}" "${w2// /}"',
    ].join("\n");
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "c.ts|file|a,b|-dir|/x,/y|14|6\n");
  } finally {
    await shell.dispose();
  }
});

test("wave 102 sync loop: grep -Eo [0-9]+, multi-expression sed (; and -e -e), nl <<< here-string, and ASCII tr preservation", async () => {
  const { createStandardCommands } = await import("../../src/commands/index.js");
  const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
  const commands = new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  try {
    const script = [
      's_num="id=42,cnt=7"',
      's_sed="a-c-a"',
      "s_nl=$'alpha\\nbeta'",
      's_utf="héllo"',
      "for ((i=1; i<=10; i++)); do",
      '  g1=$(grep -Eo "[0-9]+" <<< "$s_num")',
      '  d1=$(sed "s/a/b/g; s/c/d/g" <<< "$s_sed")',
      '  d2=$(sed -e "s/a/b/g" -e "s/c/d/g" <<< "$s_sed")',
      '  n1=$(nl <<< "$s_nl")',
      '  t1=$(tr a-z A-Z <<< "$s_utf")',
      "done",
      'printf "%s|%s|%s|%s|%s\\n" "${g1//$' + "'\\n'" + '/,}" "$d1" "$d2" "${n1//$' + "'\\n'" + '/,}" "$t1"',
    ].join("\n");
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "42,7|b-d-b|b-d-b|     1\talpha,     2\tbeta|HéLLO\n");
  } finally {
    await shell.dispose();
  }
});
