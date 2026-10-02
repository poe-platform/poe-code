import { agentCommands } from "../../src/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { streamCommands } from "../../src/commands/streams.js";
import { setup } from "./helpers.js";

function createTestShell(options?: Parameters<typeof setup>[0]) {
  const env = setup(options);
  for (const plugin of [basicCommands(), streamCommands(), filesystemCommands(), predicateCommands()]) {
    for (const cmd of plugin) env.commands.register(cmd);
  }
  return env;
}

test("Bug #1: source / . / bash on /dev/null character device succeeds with exit 0", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec("source /dev/null; echo $?; . /dev/null; echo $?; bash /dev/null; echo $?");
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "0\n0\n0\n");
});

test("Bug #2: self-delimiting compound commands before reserved words without semicolons", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    while(read foo)do(echo "got:$foo")done <<< $'one\\ntwo'
    if(true)then(echo yes)else(echo no)fi
    for x in a b; do(echo "item:$x")done
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "got:\ngot:\nyes\nitem:a\nitem:b\n");
});

test("Bug #3: ANSI-C $'...' and locale $\"...\" quoting in here-document delimiters and words", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    foo=world
    echo $'hello '"$foo"
    cat <<-$'\\x45\\x4e\\x44'
	body1:$foo
	END
    cat <<-'EOF'
	body2:$foo
	EOF
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "hello world\nbody1:$foo\nbody2:$foo\n");
});

test("Bug #4: break and continue inside forked subshells exit the subshell without breaking enclosing loop", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    for x in 1 2 3; do
      (break; echo unreachable)
      r=$(continue; echo unreachable)
      echo "iter:$x:$?"
    done
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "iter:1:0\niter:2:0\niter:3:0\n");
});

test("Bug #5: printf format string preserves literal \\c while %b and echo -e stop output on \\c", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    printf '1 2!\\c3 4\\n'
    printf '%b\\n' 'ab\\ccd'
    echo ''
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "1 2!\\c3 4\nab\n");
});

test("Bug #6: $((cmd1); cmd2) disambiguates command substitution starting with subshell from arithmetic", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    echo $((echo first); echo second)
    echo "a$((echo one)
(echo two))b"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "first second\naone\ntwob\n");
});

test("Bug #7: backtick command substitution inside double quotes strips escaped double quotes", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    echo "\`echo \\"hello\\"\`"
    echo "\`echo \\\\\\"hello\\\\\\"\`"
    echo \`echo \\"hello\\"\`
    cat <<EOF
\`echo \\"hello\\"\`
EOF
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, 'hello\n"hello"\n"hello"\n"hello"\n');
});

test("Bug #8: line continuations (\\<newline>) inside $, $(...), $((...)), and ${...}", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    'echo $(( 15 /\\\n 3 ))\n' +
    'echo $(( 15 / 3 )\\\n)\n' +
    'echo $(\\\n( 15 / 3 ))\n' +
    'echo $\\\n(( 14 / 2 ))\n' +
    'echo $\\\n(printf "%d\\n" $(( 4 + 2 )) )\n' +
    'foo=bar; echo $\\\n{foo}\n' +
    'foo=bar; echo ${\\\nf\\\noo}\n' +
    'foo=bar; echo $\\\nf\\\noo\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "5\n5\n5\n7\n6\nbar\nbar\nbar\n");
});

test("Bug #9: line continuations (\\<newline>) after #, !, array subscripts, and inside multi-char parameter operators", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    'foo=hello; ref=foo; arr=(a b c); unset missing; set -- one two\n' +
    'echo "${#\\\nfoo}" "${!\\\nref}" "${arr[1]\\\n}" "${arr[\\\n1\\\n]}" "${#arr[\\\n@\\\n]}" "${missing:\\\n-fallback}" "${#\\\n@}"\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "5 hello b b 3 fallback 2\n");
});

test("Bug #10: (( ... )) and for (( ... )) with \\<newline> between parentheses and quoted ; or ) inside substitutions", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    '(( a = 3 + 4 )\\\n); echo "$a"\n' +
    '(\\\n( b = 5 + 6 )); echo "$b"\n' +
    '(\\\n( c = 10 + 20 )\\\n); echo "$c"\n' +
    'for (\\\n( i=0; i<2; i++ )\\\n); do echo "$i"; done\n' +
    'for (( j=`true; echo 1`; j<3; j++ )); do echo "j=$j"; done\n' +
    'for (( k=$(printf ")" >/dev/null; echo 1); k<3; k++ )); do echo "k=$k"; done\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "7\n11\n30\n0\n1\nj=1\nj=2\nk=1\nk=2\n");
});

test("Bug #11: bracket glob patterns with out-of-order empty ranges ([z-ab], [!z-a]) and leading-] ranges ([]-z])", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    'case b in [z-ab]) echo match_b ;; *) echo no ;; esac\n' +
    'case x in [!z-a]) echo match_neg ;; *) echo no ;; esac\n' +
    'case a in [z-a]) echo no ;; *) echo empty_range_ok ;; esac\n' +
    '[[ b == [z-ab] ]]; echo $?\n' +
    '[[ x == [!z-a] ]]; echo $?\n' +
    's="abc"; echo "${s//[z-ab]/X}"\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "match_b\nmatch_neg\nempty_range_ok\n0\n0\naXc\n");
});

test("Bug #12: intToStr(-1) fast SMI arithmetic expansion returns '-1' instead of empty string ''", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    'a=1; b=2; echo $(( a - b )) $(( (a - b) ? a + b : a - b ))\n' +
    'a=-1; b=0; echo $(( a + b )) $(( a * 1 ))\n' +
    'printf "<%s><%s>\\n" $(( 1 - 2 )) $(( 0 - 1 ))\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "-1 3\n-1 -1\n<-1><-1>\n");
});

test("Bug #13: printf %d/%i fast-path preserves octal leading-zero parsing (010, -010, +010) and invalid octal diagnostics (08)", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    'echo "$(printf "%d" 010) $(printf "%i" -010) $(printf "%d" +010)"\n' +
    'printf "%d %i %d\\n" 010 -010 +010\n' +
    'printf "%d\\n" 08 2>/dev/null; echo "rc=$?"\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "8 -8 8\n8 -8 8\n0\nrc=1\n");
});

test("Bug #14: intToStr cache does not collide 64-bit products (e.g. 65535 * 65537 = 2^32 - 1) with 32-bit negative integers (-1)", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    'echo "$(( 65535 * 65537 )) $(( 0 - 1 ))"\n' +
    'a=-100000; echo "$(( 65536 * 65536 - 100000 )) $(( a ))"\n' +
    'z=0; echo "$(( -z )) $(( 0 / -5 )) $(( 0 % -5 ))"\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "4294967295 -1\n4294867296 -100000\n0 0 0\n");
});

test("Bug #15: cached integer for-loop + echo fast-path does not double-mutate state when loop result is negative", async () => {
  const { shell } = createTestShell({ env: { acc: "1" } });
  const script = "s=0; for x in {1..3}; do acc=$((acc - x)); done; echo $acc";
  const res1 = await shell.exec(script);
  const res2 = await shell.exec(script);
  const res3 = await shell.exec(script);
  assert.equal(res1.stdout, "-5\n");
  assert.equal(res2.stdout, "-5\n");
  assert.equal(res3.stdout, "-5\n");
});

test("Bug #16: synchronous for and arithmetic-for loops preserve tilde expansion (~), formatted printf substitutions (%04d), and negative echo substitutions", async () => {
  const { shell } = createTestShell({ env: { HOME: "/home/user" } });
  const res = await shell.exec(
    'sum=0\n' +
    'for (( i=0; i<5; i++ )); do\n' +
    '  sum=$(( sum + i ))\n' +
    '  msg_arith=~/$i\n' +
    'done\n' +
    'for i in {1..3}; do\n' +
    '  msg_fmt=$(printf "%04d" "$i")\n' +
    '  msg_tilde=~/$i\n' +
    '  msg_neg=$(echo $((0 - i)))\n' +
    'done\n' +
    'echo "sum=$sum arith=$msg_arith fmt=$msg_fmt tilde=$msg_tilde neg=$msg_neg"\n'
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "sum=10 arith=/home/user/4 fmt=0003 tilde=/home/user/3 neg=-3\n");
});


test("Bug #17: _cachedConstArgs / _cachedFastSingle and redirect targets respect set -f/+f, set +B/-B, tilde expansion, and backslash escapes", async () => {
  const { shell } = createTestShell({ env: { HOME: "/tmp/myhome" } });
  const res = await shell.exec(
    "mkdir -p /tmp/myhome\n" +
    "echo one > a1b\n" +
    "echo two > a2b\n" +
    "echo lit > \"a*b\"\n" +
    "fn_wc() { head -n 1 a*b; }\n" +
    "set -f\n" +
    "fn_wc\n" +
    "set +f\n" +
    "fn_wc\n" +
    "head -n 1 a1b > ~/out.txt\n" +
    "cat /tmp/myhome/out.txt\n"
  );
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    "lit\n==> a*b <==\nlit\n\n==> a1b <==\none\n\n==> a2b <==\ntwo\none\n"
  );
});

test("Bug #18: synchronous loop redirect fast-path normalizes paths containing //, /./, or /../ in variable suffixes", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    "mkdir -p /tmp/dir/sub\n" +
    "sub=\"/out.txt\"\n" +
    "rel=\"./sub/../rel.txt\"\n" +
    "for i in 1 2; do\n" +
    "  echo \"val-$i\" > \"/tmp/dir/$sub\"\n" +
    "  echo \"rel-$i\" > \"/tmp/dir/$rel\"\n" +
    "done\n" +
    "cat /tmp/dir/out.txt /tmp/dir/rel.txt\n"
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "val-2\nrel-2\n");
});


test("Bug #19: integer loop register fast-paths do not overwrite read-only variables (unset, empty, -0) or 0-iteration arithmetic-for body targets", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    "unset x z k\n" +
    "y=hello\n" +
    "e=\"\"\n" +
    "neg=\"-0\"\n" +
    "for (( i = 5; i < 3; i++ )); do\n" +
    "  x=$(( i + 1 ))\n" +
    "  y=$(( i + 2 ))\n" +
    "  z=$(( z + i ))\n" +
    "done\n" +
    "for j in {1..3}; do\n" +
    "  acc=$(( j + k + e + neg ))\n" +
    "done\n" +
    "echo \"i=$i x=${x-UNSET} y=$y z=${z-UNSET} acc=$acc k=${k-UNSET} k_val=$k e_val=$e neg_val=$neg\"\n"
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "i=5 x=UNSET y=hello z=UNSET acc=3 k=UNSET k_val= e_val= neg_val=-0\n");
});


test("Bug #20: fastValueWord and fastValueWords do not evaluate mutating arithmetic expressions multiple times when later parts or words fall back", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    "x=0\n" +
    "echo \"$(( x += 1 ))${y:-_suffix}\" \"x=$x\"\n" +
    "echo \"$(( x += 1 ))\" \"${y:-_suffix}\" \"x=$x\"\n" +
    "[ -f \"$(( x += 1 ))\" ]; echo \"status=$? x=$x\"\n"
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "1_suffix x=1\n2 _suffix x=2\nstatus=1 x=3\n");
});


test("Bug #21: double-quoted ${var:=~} / ${var=~} / ${var:?~} suppresses tilde expansion while unquoted ${var:=~:~} expands initial tilde before colon", async () => {
  const { shell } = createTestShell({ env: { HOME: "/home/alice" } });
  const res = await shell.exec(
    "unset x y z a\n" +
    "echo \"1:${x:-~}\" \"2:${y:=~}\" \"3:$y\" \"4:${z=~}\" \"5:$z\"\n" +
    "echo ${a:=~:~} \"$a\"\n"
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "1:~ 2:~ 3:~ 4:~ 5:~\n/home/alice:~ /home/alice:~\n");
});


test("Bug #22: test and [ treat trailing binary-operator tokens (=, !=, -eq) as unary operands when preceded by a unary operator", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(
    "test -f =; echo \"1:$?\"\n" +
    "[ -e != ]; echo \"2:$?\"\n" +
    "test ! -n =; echo \"3:$?\"\n" +
    "[ ! -z != ]; echo \"4:$?\"\n" +
    "test ! -f =; echo \"5:$?\"\n" +
    "test -n x -a -f =; echo \"6:$?\"\n" +
    "test -n x -o -f =; echo \"7:$?\"\n"
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "1:1\n2:1\n3:1\n4:0\n5:0\n6:1\n7:0\n");
});

test("23. return inside subshells (...) and command substitutions $(...) within functions only exits the subshell", async () => {
  const env = createTestShell();
  const result = await env.shell.exec([
    "f() {",
    "  (return 5; echo unreachable_sub)",
    "  echo \"sub:$?\"",
    "  local out",
    "  out=$(echo captured; return 7; echo unreachable_cmdsub)",
    "  echo \"cmdsub:$out:$?\"",
    "  (trap 'echo sub_trap:$?' EXIT; return 9)",
    "  echo \"trap_after:$?\"",
    "}",
    "f",
    "echo \"final:$?\"",
  ].join("\n"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "sub:5\ncmdsub:captured:7\nsub_trap:9\ntrap_after:9\nfinal:0\n");
});

test("24. case fallthrough (;& and ;;&) into an empty clause resets case exit status to 0", async () => {
  const env = createTestShell();
  const result = await env.shell.exec([
    "case a in a) false ;& b) ;; esac",
    "echo \"s1:$?\"",
    "case a in a) false ;;& *) ;; esac",
    "echo \"s2:$?\"",
    "case a in a) false ;;& b) ;; esac",
    "echo \"s3:$?\"",
  ].join("\n"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "s1:0\ns2:0\ns3:1\n");
});

test("25. arithmetic-for function call with unquoted induction variable arguments executes body and updates caller globals", async () => {
  const env = createTestShell();
  const res = await env.shell.exec(`
    fn() { local a=$1 b=$2; res=$((a + b)); }
    for ((i=0; i<10; i++)); do fn $i $((i+1)); done
    echo "$res|$i"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.trim(), "19|10");
});

test("26. fast-forwarded glob loop enforces maxFileSystemOperations budget instead of treating pattern as literal", async () => {
  const env = createTestShell({ limits: { maxFileSystemOperations: 25 } });
  await env.shell.exec("mkdir -p /work && touch /work/f_1.txt /work/f_2.txt /work/f_3.txt");
  await assert.rejects(
    () =>
      env.shell.exec(`
        for ((r=0; r<20; r++)); do
          for f in /work/f_*.txt; do
            :
          done
        done
      `),
    /maxFileSystemOperations/
  );
});

test("27. static case fast-forward respects shopt nocasematch, declare -u/-l attributes, and namerefs", async () => {
  const env = createTestShell();
  const res = await env.shell.exec(`
    shopt -s nocasematch
    x="FOO"
    for ((i=0; i<5; i++)); do
      case "$x" in
        foo) out="matched_nocase" ;;
        *) out="missed" ;;
      esac
    done
    declare -n ref=target
    shopt -u nocasematch
    y="bar"
    for ((i=0; i<5; i++)); do
      case "$y" in
        bar) ref="via_nameref" ;;
      esac
    done
    echo "$out|$target"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.trim(), "matched_nocase|via_nameref");
});

test("28. hoisted arithmetic-for loop plan invalidates when scalar target variable becomes an array between calls", async () => {
  const env = createTestShell();
  const res = await env.shell.exec([
    "run_scalar() { for ((i=0; i<5; i++)); do x=\"scalar_$i\"; done; }",
    "run_case() { k=foo; for ((i=0; i<3; i++)); do case \"$k\" in foo) z=\"hit\" ;; esac; done; }",
    "run_scalar",
    "run_case",
    "echo \"before:$x|$z\"",
    "unset x z",
    "x=(first second third)",
    "z=(a b c)",
    "run_scalar",
    "run_case",
    "echo \"after:${x[0]}|${x[1]}|${x[2]}|${z[0]}|${z[1]}|${z[2]}\"",
  ].join("\n"));
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.trim(), "before:scalar_4|hit\nafter:scalar_4|second|third|hit|b|c");
});

test("29. synchronous memory glob expansion matches filenames in (pattern, name) order and respects dotglob, nocaseglob, and GLOBIGNORE", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    mkdir -p /tmp/sb_glob_test
    touch /tmp/sb_glob_test/F_1.TXT /tmp/sb_glob_test/f_2.txt /tmp/sb_glob_test/.dot.txt /tmp/sb_glob_test/skip.txt
    out1=""; for f in /tmp/sb_glob_test/f_*.txt; do out1+="$f,"; done
    shopt -s nocaseglob
    out2=""; for f in /tmp/sb_glob_test/f_*.txt; do out2+="$f,"; done
    shopt -u nocaseglob
    shopt -s dotglob
    out3=""; for f in /tmp/sb_glob_test/*.txt; do out3+="$f,"; done
    shopt -u dotglob
    GLOBIGNORE="*/skip.txt"
    out4=""; for f in /tmp/sb_glob_test/*.txt; do out4+="$f,"; done
    echo "1:$out1"
    echo "2:$out2"
    echo "3:$out3"
    echo "4:$out4"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    "1:/tmp/sb_glob_test/f_2.txt,\n" +
    "2:/tmp/sb_glob_test/F_1.TXT,/tmp/sb_glob_test/f_2.txt,\n" +
    "3:/tmp/sb_glob_test/.dot.txt,/tmp/sb_glob_test/f_2.txt,/tmp/sb_glob_test/skip.txt,\n" +
    "4:/tmp/sb_glob_test/.dot.txt,/tmp/sb_glob_test/f_2.txt,\n"
  );
});

test("30. synchronous loop conditional [[ str == \"quoted*meta?chars[1]\" ]] escapes quoted glob metacharacters accurately", async () => {
  const { shell } = createTestShell();
  const res = await shell.exec(`
    s="a*b?c[1]"
    matched=0
    for ((i = 0; i < 10; i++)); do
      if [[ \$s == "a*b?c[1]" && \$s != "aXbYc1" ]]; then
        ((matched++))
      fi
    done
    echo "\$matched"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "10\n");
});

test("31. sync command substitution sed append-before-quit, escaped dollar, grep -H prefixes, echo -e, non-ASCII printf width, and realpath --relative-to", async () => {
  const { shell } = setup();
  shell.use(agentCommands());
  const res = await shell.exec(String.raw`
    mkdir -p /tmp/sb_sync_31/a/b/c
    printf "alpha 10 foo\nbeta 2 bar\ngamma 100 baz\nbeta 2 bar\n" > /tmp/sb_sync_31/data.txt
    printf "a\nb\nc\n" > /tmp/sb_sync_31/abc.txt
    printf "foo\$bar\nfoo\$\n" > /tmp/sb_sync_31/dollar.txt
    s1=$(sed -e "1a AFTER" -e "1q" /tmp/sb_sync_31/data.txt)
    s2=$(sed -n -e "1a AFTER" -e "1q" /tmp/sb_sync_31/data.txt)
    s3=$(sed "s/foo\\\$/REPL/" /tmp/sb_sync_31/dollar.txt)
    s4=$(sed -E "s/foo\\\$/REPL/" /tmp/sb_sync_31/dollar.txt)
    g1=$(grep -H -n "beta" /tmp/sb_sync_31/data.txt)
    g2=$(grep -H -c "beta" /tmp/sb_sync_31/data.txt)
    g3=$(grep -H -n -C 1 "b" /tmp/sb_sync_31/abc.txt)
    e1=$(echo -e "line1\nline2\ttab\cignored")
    p1=$(printf "%6s\n" "é")
    r1=$(realpath --relative-to=/tmp/sb_sync_31/a /tmp/sb_sync_31/a/b/c)
    r2=$(realpath --relative-base=/tmp/sb_sync_31/a /tmp/sb_sync_31/a/b/c)
    printf "<%s><%s><%s><%s><%s><%s><%s><%s><%s><%s><%s>\n" "$s1" "$s2" "$s3" "$s4" "$g1" "$g2" "$g3" "$e1" "$p1" "$r1" "$r2"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "<alpha 10 foo\nAFTER><AFTER><REPLbar\nREPL><REPLbar\nREPL>" +
    "</tmp/sb_sync_31/data.txt:2:beta 2 bar\n/tmp/sb_sync_31/data.txt:4:beta 2 bar>" +
    "</tmp/sb_sync_31/data.txt:2>" +
    "</tmp/sb_sync_31/abc.txt-1-a\n/tmp/sb_sync_31/abc.txt:2:b\n/tmp/sb_sync_31/abc.txt-3-c>" +
    "<line1\nline2\ttab><    é><b/c><b/c>\n"
  );
});
