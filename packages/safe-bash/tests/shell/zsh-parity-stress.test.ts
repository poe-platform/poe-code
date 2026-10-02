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
      if [[ $s == "a*b?c[1]" && $s != "aXbYc1" ]]; then
        ((matched++))
      fi
    done
    echo "$matched"
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

test("32. sync sort secondary key -f folds only ASCII a-z and supports start-field modifiers (-k2n,2)", async () => {
  const { shell } = setup();
  shell.use(agentCommands());
  const res = await shell.exec(String.raw`
    u1=$(printf "1 é\n1 É\n1 a\n1 A\n" | sort -u -k1,1 -k2,2f)
    n1=$(printf "a:10\na:2\n" | sort -t: -k1,1 -k2n,2)
    printf "<%s><%s>\n" "$u1" "$n1"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "<1 a\n1 É\n1 é><a:2\na:10>\n");
});

test("33. sync uniq empty-input flag validation, join multi -o and conflicting options, comm conflicting delimiters, and expr +0/+1 semantics", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());

  const scripts = [
    ": > /empty; x=$(uniq --group -c < /empty); echo \"$?:$x\"",
    ": > /empty; x=$(uniq -D -c < /empty); echo \"$?:$x\"",
    "printf \"1 a\\n2 b\\n\" > /j1; printf \"1 X\\n2 Y\\n\" > /j2; x=$(join -o 1.1 -o 1.2 -o 2.2 /j1 /j2); echo \"$?:$x\"",
    "printf \"1 a\\n\" > /j1; printf \"1 X\\n\" > /j2; x=$(join -1 1 -1 2 /j1 /j2); echo \"$?:$x\"",
    "printf \"1 a\\n\" > /j1; printf \"1 X\\n\" > /j2; x=$(join -o auto -o 1.1 /j1 /j2); echo \"$?:$x\"",
    "printf \"1:a\\n\" > /j1; printf \"1:X\\n\" > /j2; x=$(join -t : -t , /j1 /j2); echo \"$?:$x\"",
    "printf \"1 a\\n\" > /j1; printf \"1 X\\n\" > /j2; x=$(join -e A -e B /j1 /j2); echo \"$?:$x\"",
    "printf \"a\\nb\\n\" > /c1; printf \"b\\nc\\n\" > /c2; x=$(comm --output-delimiter=: --output-delimiter=, /c1 /c2); echo \"$?:$x\"",
    "x=$(expr +0); echo \"$?:$x\"",
    "x=$(expr +1 + 2); echo \"$?:$x\"",
    "x=$(expr +20 \\< +3); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
    assert.equal(rSync.stderr, rAsync.stderr, `stderr mismatch for ${script}`);
  }
});

test("34. sync bc evaluates scale, ibase, and obase assignments and reads in the active ibase", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
  const scripts = [
    "x=$(bc <<< \"ibase=16; obase=10; FF\"); echo \"$?:$x\"",
    "x=$(bc <<< \"ibase=16; scale=A; 1/3\"); echo \"$?:$x\"",
    "x=$(bc <<< \"ibase=16; scale=10; 1/3\"); echo \"$?:$x\"",
    "x=$(bc <<< \"ibase=16; ibase=A; 10\"); echo \"$?:$x\"",
    "x=$(bc <<< \"scale=4; scale; ibase=16; ibase; obase=8; obase\"); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
    assert.equal(rSync.stderr, rAsync.stderr, `stderr mismatch for ${script}`);
  }
});

test("35. sync xxd negative seek address calculation, stdin seek errors, and od repeated - stdin operands", async () => {
  const { shell, fs: fsMem } = setup();
  shell.use(agentCommands());
  await fsMem.writeFile("/f", new TextEncoder().encode("0123456789\n"));

  const r1 = await shell.exec("xxd -s -3 /f");
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "00000008: 3839 0a                                  89.\n");

  const r2 = await shell.exec("xxd -s -3 <<< \"hello\"");
  assert.equal(r2.exitCode, 2);

  const r3 = await shell.exec("xxd -s -20 /f");
  assert.equal(r3.exitCode, 4);

  const r4 = await shell.exec("xxd -s 20 <<< \"hi\"");
  assert.equal(r4.exitCode, 4);

  const r5 = await shell.exec("od -An -tx1 - - <<< \"ab\"");
  assert.equal(r5.exitCode, 0);
  assert.equal(r5.stdout, " 61 62 0a\n");
});

test("36. sync expand/unexpand multi -t tablists, column -e vs -L and JSON column validation, and numfmt scale rounding boundaries", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
  const scripts = [
    "x=$(expand -t 4 -t 8 <<< $'a\\tb\\tc'); echo \"$?:$x\"",
    "x=$(expand -t 4 -t 6,10 <<< $'a\\tb\\tc'); echo \"$?:$x\"",
    "x=$(expand -t 8 -t 4 <<< $'a\\tb'); echo \"$?:$x\"",
    "x=$(unexpand -t 4 -t 8 <<< '    a    b'); echo \"$?:$x\"",
    "x=$(unexpand -t 8 -t 4 <<< '        a'); echo \"$?:$x\"",
    "x=$(column -t -e <<< $'a b\\n\\nc d'); echo \"$?:$x\"",
    "x=$(column -t -L <<< $'a b\\n   \\nc d'); echo \"$?:$x\"",
    "x=$(column -J -N col1 <<< 'a b'); echo \"$?:$x\"",
    "x=$(numfmt --to=si 9999); echo \"$?:$x\"",
    "x=$(numfmt --to=si 999500); echo \"$?:$x\"",
    "x=$(numfmt --to=iec 10239); echo \"$?:$x\"",
    "x=$(numfmt --to=iec 1048064); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("55. sync vs async parity for apply_patch, html-to-markdown, and xq semantics", async () => {
  const scripts = [
    "mkdir -p /ap55; cd /ap55; printf \"old\\n\" > a.txt; printf \"existing\\n\" > b.txt; p=\$'*** Begin Patch\\n*** Update File: a.txt\\n*** Move to: b.txt\\n@@\\n-old\\n+new\\n*** End Patch'; x=\$(apply_patch \"\$p\" 2>/dev/null; echo \$?); y=\$(cat b.txt); echo \"\$x|\$y\"",
    "mkdir -p /ap55b; cd /ap55b; printf \"line1\\r\\nline2\\r\\n\" > crlf.txt; p=\$'*** Begin Patch\\n*** Update File: crlf.txt\\n@@\\n-line1\\n+mod1\\n*** End Patch'; apply_patch \"\$p\" >/dev/null; od -An -tx1 crlf.txt | tr -d ' \\n'; echo",
    "a=\$(html-to-markdown <<< $'<p>\\n  hello\\n  world\\n</p>'); b=\$(html-to-markdown <<< '<p>line1<br>line2</p>'); echo \"\$a|\$b\"",
    "mkdir -p /xq55; cd /xq55; printf '<root><x>42</x></root>' > doc.xml; xq -n 'inputs.root.x' doc.xml",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("54. sync vs async parity for pr, iconv, dos2unix, and chmod semantics", async () => {
  const scripts = [
    "mkdir -p /pr54; cd /pr54; printf \"from_file\\n\" > -- -f.txt; touch -d 2020-01-02T03:04:05Z -- -f.txt; a=\$(pr -t <<< \"from_stdin\"); b=\$(pr -t -- -f.txt <<< \"from_stdin\"); c=\$(pr -D \"%Y-%m-%d\" -- -f.txt | head -n 4); echo \"\$a|\$b|\$c\"",
    "mkdir -p /ic54; cd /ic54; a=\$(iconv -f UTF-8 -t ASCII -o - <<< \"hello\"); b=\$(test -e - && echo exists || echo none); echo \"\$a|\$b\"",
    "mkdir -p /d2u54; cd /d2u54; a=\$(dos2unix - <<< $'hi\\r\\n'); b=\$(dos2unix -qe <<< $'hi\\r\\n' 2>/dev/null; echo \$?); echo \"\$a|\$b\"",
    "mkdir -p /ch54; cd /ch54; printf \"hi\" > a.txt; chmod 644 a.txt; x=\$(chmod -c 600 a.txt missing.txt 2>/dev/null; echo \$?); echo \"\$x\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("53. sync vs async parity for unzip, tar, and du semantics", async () => {
  const scripts = [
    "mkdir -p /uz53; cd /uz53; printf \"orig\\n\" > hello.txt; zip -q a.zip hello.txt; printf \"changed\\n\" > hello.txt; a=\$(unzip -q a.zip 2>/dev/null; echo \$?); b=\$(cat hello.txt); c=\$(unzip -Z1 -o a.zip 2>/dev/null; echo \$?); d=\$(unzip -p a.zip -d sub 2>/dev/null; echo \$?); echo \"\$a|\$b|\$c|\$d\"",
    "mkdir -p /tar53; cd /tar53; printf \"hello\\n\" > f.txt; tar -cf a.tar f.txt; h=\$(tar --help | head -n 2); v=\$(tar -xvOf a.tar 2>&1); echo \"\$h|\$v\"",
    "mkdir -p /du53; cd /du53; printf \"hello\" > f.txt; ln -s f.txt l.txt; a=\$(du --apparent-size -H l.txt); b=\$(du -b -t human-readable f.txt 2>/dev/null; echo \$?); c=\$(DU_BLOCK_SIZE=invalid du --apparent-size f.txt); echo \"\$a|\$b|\$c\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("37. sync tr indefinite/octal repeat counts, awk BEGIN NR=0, and jq -j pipeline newline suppression", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
  const scripts = [
    "x=$(tr 'abc' '[x*]y' <<< 'abc'); echo \"$?:$x\"",
    "x=$(tr 'abcdefghij' '[x*010]yz' <<< 'abcdefghij'); echo \"$?:$x\"",
    "x=$(awk 'BEGIN { print NR }'); echo \"$?:$x\"",
    "x=$(awk 'BEGIN { print NR, NF }' <<< 'a b c'); echo \"$?:$x\"",
    "x=$(echo '{\"a\":\"x\",\"b\":\"y\"}' | jq -j '.a, .b' | wc -c); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("38. sync ls -U lexical directory order, symlink-to-dir operand dereference, -L child dereference, and -f/-v/--sort=version", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
  const init = `
    mkdir -p /dir/sub
    printf "hello world long\n" > /dir/v10.txt
    printf "hi\n" > /dir/v2.txt
    ln -s /dir/sub /dir/linkdir
    ln -s /dir/v10.txt /dir/linkfile
  `;
  await syncSh.exec(init);
  await asyncSh.exec(init);
  const scripts = [
    "x=$(ls -U -r /dir); echo \"$?:$x\"",
    "x=$(ls /dir/linkdir); echo \"$?:$x\"",
    "x=$(ls -p /dir/linkdir); echo \"$?:$x\"",
    "x=$(ls -d /dir/linkdir); echo \"$?:$x\"",
    "x=$(ls -F /dir/linkdir); echo \"$?:$x\"",
    "x=$(ls -LF /dir); echo \"$?:$x\"",
    "x=$(ls -LR /dir); echo \"$?:$x\"",
    "x=$(ls -f /dir); echo \"$?:$x\"",
    "x=$(ls -v /dir); echo \"$?:$x\"",
    "x=$(ls --sort=version /dir); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("39. sync grep -q -c/-L suppression, -h/-H and -l/-L option precedence, and multi-file rev without trailing newline", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
  const init = `
    mkdir -p /dir
    printf "alpha\n" > /dir/a.txt
    printf "one\n" > /dir/b.txt
    printf "ab" > /dir/no_nl.txt
    printf "cd\nef\n" > /dir/with_nl.txt
  `;
  await syncSh.exec(init);
  await asyncSh.exec(init);
  const scripts = [
    "x=$(grep -q -c \"z\" <<< \"alpha\"); echo \"$?:$x\"",
    "x=$(grep -q -c \"z\" /dir/a.txt); echo \"$?:$x\"",
    "x=$(grep -h -H \"a\" <<< \"alpha\"); echo \"$?:$x\"",
    "x=$(grep --with-filename --no-filename \"a\" /dir/a.txt); echo \"$?:$x\"",
    "x=$(grep --no-filename --with-filename \"a\" /dir/a.txt); echo \"$?:$x\"",
    "x=$(grep --files-with-matches --files-without-match \"a\" /dir/a.txt /dir/b.txt); echo \"$?:$x\"",
    "x=$(grep --files-without-match --files-with-matches \"a\" /dir/a.txt /dir/b.txt); echo \"$?:$x\"",
    "x=$(grep -q -L \"z\" /dir/a.txt); echo \"$?:$x\"",
    "x=$(rev /dir/no_nl.txt /dir/with_nl.txt); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("40. sync strings per-file radix offsets (-t d/-t x), strings -s pipeline newline suppression, and multi-file tac without trailing newline", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
  const init = `
    mkdir -p /dir
    printf "alpha\nbeta\n" > /dir/a.txt
    printf "gamma\ndelta\n" > /dir/b.txt
    printf "only_one" > /dir/no_nl.txt
    printf "first\nsecond\n" > /dir/c.txt
  `;
  await syncSh.exec(init);
  await asyncSh.exec(init);
  const scripts = [
    "x=$(strings -t d /dir/a.txt /dir/b.txt); echo \"$?:$x\"",
    "x=$(strings -t x /dir/a.txt /dir/b.txt); echo \"$?:$x\"",
    "x=$(printf \"hello\\nworld\\n\" | strings -s \":\" | wc -c); echo \"$?:$x\"",
    "x=$(tac /dir/no_nl.txt /dir/c.txt); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("41. sync seq -w discarded fractional width, leading-zero width, negative zero (-0), and base64 -w 0 newline suppression", async () => {
  const syncSh = setup().shell.use(agentCommands());
  const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
  const init = `
    mkdir -p /dir
    printf "hello" > /dir/a.txt
  `;
  await syncSh.exec(init);
  await asyncSh.exec(init);
  const scripts = [
    "x=$(seq -w 1 1 9.9); echo \"$?:$x\"",
    "x=$(seq -w 1 005); echo \"$?:$x\"",
    "x=$(seq -0 1 2); echo \"$?:$x\"",
    "x=$(printf \"hello\" | base64 -w 0 | wc -c); echo \"$?:$x\"",
    "x=$(base64 -w 0 /dir/a.txt | wc -c); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("42. sync cat/head/tail/wc repeated - stdin consumption, mv -n -f precedence, and cp/mv/ln non-normalized same-file protection", async () => {
  const scripts = [
    "x=$(cat - - <<< \"hello\"); echo \"$?:$x\"",
    "x=$(head -n 1 - - <<< \"hello\"); echo \"$?:$x\"",
    "x=$(tail -n 1 - - <<< \"hello\"); echo \"$?:$x\"",
    "x=$(wc -c - - <<< \"hello\"); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"new\" > /dir/a.txt; printf \"old\" > /dir/b.txt; x=$(mv -n -f /dir/a.txt /dir/b.txt); echo \"$?:$(cat /dir/b.txt)\"",
    "mkdir -p /dir; printf \"hello\" > /dir/a.txt; x=$(cp /dir/./a.txt /dir/a.txt); echo \"$?:$(cat /dir/a.txt)\"",
    "mkdir -p /dir; printf \"hello\" > /dir/a.txt; x=$(mv /dir/./a.txt /dir/a.txt); echo \"$?:$(cat /dir/a.txt 2>/dev/null)\"",
    "mkdir -p /dir; printf \"hello\" > /dir/a.txt; x=$(ln -f /dir/./a.txt /dir/a.txt); echo \"$?:$(cat /dir/a.txt 2>/dev/null)\"",
    "mkdir -p /dir; printf \"1\" > /dir/a.txt; printf \"2\" > /dir/b.txt; printf \"3\" > /dir/c.txt; x=$(cp /dir/a.txt /dir/b.txt /dir/c.txt); echo \"$?:$(cat /dir/b.txt)\"",
    "mkdir -p /dir; printf \"1\" > /dir/a.txt; printf \"2\" > /dir/b.txt; printf \"3\" > /dir/c.txt; x=$(mv /dir/a.txt /dir/b.txt /dir/c.txt); echo \"$?:$(cat /dir/b.txt)\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("43. sync commands respect exported-only environment boundaries (stat QUOTING_STYLE, df DF_BLOCK_SIZE, mktemp TMPDIR, and pre-set-a variables in envsubst/getopt/cal)", async () => {
  const scripts = [
    "mkdir -p /dir; printf \"hello\" > /dir/a.txt; QUOTING_STYLE=literal; x=$(stat -c %N /dir/a.txt); echo \"$?:$x\"",
    "DF_BLOCK_SIZE=1M; x=$(df /); echo \"$?:$x\"",
    "mkdir -p /dir; TMPDIR=/dir; x=$(mktemp -u); echo \"$?:${x%/tmp.*}\"",
    "FOO=secret; set -a; x=$(envsubst <<< \"\\$FOO\"); echo \"$?:$x\"",
    "POSIXLY_CORRECT=1; set -a; x=$(getopt -o ab -- -a foo -b); echo \"$?:$x\"",
    "SOURCE_DATE_EPOCH=0; set -a; x=$(cal); y=$(cal -m 1 1970); echo \"$?:$([[ \"$x\" == \"$y\" ]] && echo eq || echo ne)\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }

});

test("44. sync vs async parity for find -printf (%h trailing slash, %H root, %m error) and fd (directory slash, --prune, -L follow)", async () => {
  const scripts = [
    "mkdir -p /dir/sub /target; printf \"hello\\n\" > /dir/sub/a.txt; printf \"world\\n\" > /target/in-target.txt; ln -s /target /dir/linkdir; x=$(find /dir/ -maxdepth 0 -printf \"%h|%f|%H\"); y=$(find /dir/sub/ -maxdepth 0 -printf \"%h|%f|%H\"); echo \"$x::$y\"",
    "mkdir -p /dir; x=$(find /dir -maxdepth 0 -printf \"%m\\n\" 2>/dev/null); echo \"$?:$x\"",
    "mkdir -p /dir/sub; printf \"hello\\n\" > /dir/sub/a.txt; x=$(fd -t d . /dir); echo \"$?:$x\"",
    "mkdir -p /dir/sub /target; printf \"hello\\n\" > /dir/sub/a.txt; printf \"world\\n\" > /target/in-target.txt; ln -s /target /dir/linkdir; x=$(fd --prune . /dir); echo \"$?:$x\"",
    "mkdir -p /dir/sub /target; printf \"hello\\n\" > /dir/sub/a.txt; printf \"world\\n\" > /target/in-target.txt; ln -s /target /dir/linkdir; x=$(fd -L in-target.txt /dir); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});

test("45. sync vs async parity for tree (charset, root dir count, multi -P, symlink -d, trailing slash), rg (-w/-x, -l/-c, -e order, repeated -), and cmp/diff/diff3 extra operand rejection", async () => {
  const scripts = [
    "mkdir -p /dir; printf \"hi\" > /dir/a.txt; x=$(tree /dir); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"hi\" > /dir/a.txt; x=$(tree -J /dir); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"1\" > /dir/a.txt; printf \"2\" > /dir/b.md; x=$(tree -P \"*.txt\" -P \"*.md\" /dir); echo \"$?:$x\"",
    "mkdir -p /dir /target; ln -s /target /dir/linkdir; x=$(tree -d /dir); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"hi\" > /dir/a.txt; x=$(tree /dir/); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"foo\\nfoo\\n\" > /dir/a.txt; x=$(rg -l -c foo /dir/a.txt); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"foo\\n\" > /dir/a.txt; x=$(rg --files-without-match -l foo /dir/a.txt); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"foo_line\\n\" > /dir/a.txt; x=$(rg /dir/a.txt -e foo <<< \"other\"); echo \"$?:$x\"",
    "x=$(rg foo - - <<< \"foo\"); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"same\\n\" > /dir/a.txt; x=$(cmp /dir/a.txt /dir/a.txt /dir/a.txt); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"same\\n\" > /dir/a.txt; x=$(diff /dir/a.txt /dir/a.txt /dir/a.txt); echo \"$?:$x\"",
    "mkdir -p /dir; printf \"same\\n\" > /dir/a.txt; x=$(diff3 /dir/a.txt /dir/a.txt /dir/a.txt /dir/a.txt); echo \"$?:$x\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});



test("46. sync vs async parity for diff (-e missing newline, --strip-trailing-cr, -Z -B, --no-dereference), diff3 pipeline newline, and yq default Mike Farah YAML vs JSON", async () => {
  const scripts = [
    'mkdir -p /dir; printf "abc" > /dir/a.txt; printf "abc" > /dir/b.txt; x=$(diff -e /dir/a.txt /dir/b.txt 2>/dev/null); echo "$?:$x"',
    'mkdir -p /dir; printf "hello\r" > /dir/a.txt; printf "hello" > /dir/b.txt; x=$(diff --strip-trailing-cr /dir/a.txt /dir/b.txt); echo "$?:$x"',
    'mkdir -p /dir; printf "a\n   \nb\n" > /dir/a.txt; printf "a\nb\n" > /dir/b.txt; x=$(diff -Z -B /dir/a.txt /dir/b.txt); echo "$?:$x"',
    'mkdir -p /dir; printf "same\n" > /dir/a.txt; ln -s /dir/a.txt /dir/link.txt; x=$(diff --no-dereference /dir/link.txt /dir/a.txt); echo "$?:$x"',
    'mkdir -p /dir; printf "l1\nl2\n" > /dir/a.txt; x=$(diff3 -m /dir/a.txt /dir/a.txt /dir/a.txt | wc -l); y=$(diff3 -m /dir/a.txt /dir/a.txt /dir/a.txt | wc -c); echo "$x:$y"',
    'mkdir -p /dir; printf "a: 1\nb: hello\n" > /dir/data.yaml; x=$(yq "." /dir/data.yaml); y=$(yq -o json "." /dir/data.yaml); echo "$x|$y"',
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});


test("47. sync vs async parity for less repeated -, pr/unrtf pipeline newlines, file symlink default -h vs -L and -f -, and xan single-col empty/alignment", async () => {
  const scripts = [
    'x=$(less - - <<< "hello"); echo "$?:$x"',
    'mkdir -p /dir; printf "line1\nline2\n" > /dir/a.txt; x=$(pr -t /dir/a.txt | wc -l); y=$(pr -t /dir/a.txt | wc -c); echo "$x:$y"',
    'x=$(pr -t - - <<< "hello"); echo "$?:$x"',
    'mkdir -p /dir; printf "{\\rtf1\\ansi hello}" > /dir/doc.rtf; x=$(unrtf --text /dir/doc.rtf | wc -l); y=$(unrtf --text /dir/doc.rtf | wc -c); echo "$x:$y"',
    'mkdir -p /dir; printf "hello\n" > /dir/a.txt; ln -s /dir/a.txt /dir/link.txt; x=$(file /dir/link.txt); y=$(file -L /dir/link.txt); echo "$x|$y"',
    'mkdir -p /dir; printf "hello\n" > /dir/a.txt; x=$(file -f - <<< $"/dir/a.txt\n-"); echo "$?:$x"',
    'mkdir -p /dir; printf "a,b\n,1\n" > /dir/c.csv; x=$(xan select a /dir/c.csv); echo "$?:$x"',
    'mkdir -p /dir; printf "a,b\n1\n2,3\n" > /dir/bad.csv; x=$(xan count -c /dir/bad.csv 2>/dev/null); echo "$?:$x"',
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});


test("48. sync vs async parity for csvgrep -f pythonRstrip/empty lines, csvstack --filenames <stdin>/empty rows/surplus cells, and csvjoin --right/null keys", async () => {
  const scripts = [
    'mkdir -p /dir; printf "foo  \n\nbar\r\n" > /dir/pats.txt; printf "k,v\nfoo,1\n,2\nbar,3\nbaz,4\n" > /dir/in.csv; x=$(csvgrep -c k -f /dir/pats.txt /dir/in.csv); echo "$?:$x"',
    'mkdir -p /dir; printf "a,b\n1,2\n" > /dir/f1.csv; x=$(csvstack --filenames - /dir/f1.csv <<< $"a,b\n3,4\n"); echo "$?:$x"',
    'mkdir -p /dir; printf "a,b\n1,2\n\n3,4\n" > /dir/f1.csv; x=$(csvstack /dir/f1.csv); echo "$?:$x"',
    'mkdir -p /dir; printf "a,b\n1,2,3\n" > /dir/bad.csv; x=$(csvstack /dir/bad.csv 2>/dev/null); echo "$?:$x"',
    'mkdir -p /dir; printf "id,lval\n1,L1\n,LN\n" > /dir/l.csv; printf "id,rval\n1,R1\n2,R2\n,RN\n" > /dir/r.csv; x=$(csvjoin --right -c "id, id" /dir/l.csv /dir/r.csv); y=$(csvjoin -c id /dir/l.csv /dir/r.csv); echo "$?:$x|$y"',
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});


test("49. sync vs async parity for htmlq -r multiple/self removal, shuf -r -n 0 random-source, html-to-markdown links/escaping/multi-file/repeated -, and dos2unix BOM/convmode/flags", async () => {
  const scripts = [
    'x=$(htmlq -r span div <<< "<div class="a"><span>1</span><b>ok</b><span>2</span></div>"); y=$(htmlq -r .skip div <<< "<div class="skip">a</div><div>b</div>"); echo "$x|$y"',
    'x=$(shuf -r -n 0 --random-source=/nonexistent 2>/dev/null); echo "$?:$x"',
    'x=$(html-to-markdown <<< "<p><a href="https://example.com">click</a> and foo_bar</p>"); y=$(html-to-markdown - - <<< "<p>hello</p>"); echo "$x|$y"',
    'mkdir -p /dir; printf "<ul><li>a</li>" > /dir/p1.html; printf "<li>b</li></ul>" > /dir/p2.html; x=$(html-to-markdown /dir/p1.html /dir/p2.html); echo "$?:$x"',
    'x=$(printf "\xef\xbb\xbfhello\r\n" | dos2unix | wc -c); y=$(printf "\xef\xbb\xbfhello\n" | unix2dos | wc -c); z=$(dos2unix -c mac <<< "hi" 2>/dev/null; echo $?); echo "$x:$y:$z"',
    'mkdir -p /dir; printf "hello\r\n" > /dir/in.txt; x=$(dos2unix -q -O -n /dir/in.txt /dir/out.txt); y=$(cat /dir/out.txt | wc -c); echo "$x|$y"',
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});


test("50. sync vs async parity for du child sorting/symlinks/exclude paths, tree root symlinks/space escaping, and which --all/--silent rejection", async () => {
  const scripts = [
    'mkdir -p /dir/z /dir/a; printf "hello" > /dir/z/f; printf "world" > /dir/a/f; x=$(du -b /dir); echo "$?:$x"',
    'mkdir -p /dir; printf "01234567890123456789" > /dir/target.txt; ln -s /dir/target.txt /dir/link.txt; x=$(du -b -a /dir); echo "$?:$x"',
    'mkdir -p /dir/sub; printf "12345" > /dir/sub/skip.txt; printf "12" > /dir/sub/keep.txt; x=$(du -b --exclude="sub/skip.txt" /dir); y=$(du -b --exclude="dir" /dir); echo "$x|$y"',
    'mkdir -p /dir; printf "hi" > "/dir/a b.txt"; ln -s /dir /link_dir; x=$(tree /link_dir); y=$(tree /dir); echo "$x|$y"',
    'mkdir -p /bin; printf "#!/bin/sh\n" > /bin/mycmd; chmod +x /bin/mycmd; export PATH=/bin; x=$(which -a mycmd); y=$(which --all mycmd 2>/dev/null; echo $?); echo "$x|$y"',
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});


test("51. sync vs async parity for ls, realpath, readlink, rg, and fd semantics", async () => {
  const scripts = [
    "mkdir -p /ls51; printf z > /ls51/z; printf a > /ls51/!bang; x=\$(ls /ls51 -f); y=\$(ls -m /ls51 2>/dev/null; echo \$?); echo \"\$x|\$y\"",
    "mkdir -p /rp51; printf z > /rp51/z; a=\$(realpath -s -e /rp51/missing 2>/dev/null; echo \$?); b=\$(realpath -L /rp51/missing/.. 2>/dev/null; echo \$?); c=\$(realpath -m /rp51/z/child); d=\$(readlink -m /rp51/z/..); echo \"\$a|\$b|\$c|\$d\"",
    "mkdir -p /rg51; printf \"alpha\\nbeta\\n\" > /rg51/rg.txt; a=\$(rg -m 0 alpha /rg51/rg.txt; echo \$?); b=\$(rg -o \"a*\" <<< \"a\"); echo \"\$a|\$b\"",
    "mkdir -p /fd51/sub /fd51/emptydir; : > /fd51/sub/empty.txt; printf notempty > /fd51/sub/full.txt; printf \"*.log\\n\" > /fd51/.gitignore; printf ignored > /fd51/sub/skip.log; a=\$(fd -t f -t e . /fd51); b=\$(fd . /fd51/sub); echo \"\$a|\$b\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});


test("52. sync vs async parity for split, csplit, truncate, and dd semantics", async () => {
  const scripts = [
    "mkdir -p /sp52; cd /sp52; printf \"hello\\nworld\\n\" > xaa; x=\$(split -l 1 xaa 2>/dev/null; echo \$?); echo \"\$x:\$(cat xaa)\"",
    "mkdir -p /cs52; cd /cs52; printf \"foo\\r\\nbar\\n\" > in.txt; x=\$(csplit in.txt \"/foo\$/\" 2>/dev/null; echo \$?); y=\$(csplit in.txt \"/bar/ 1\" 2>/dev/null; echo \$?); echo \"\$x|\$y\"",
    "mkdir -p /tr52/d; printf \"hello\" > /tr52/f; a=\$(truncate --version); b=\$(truncate -o -s 1 /tr52/f 2>/dev/null; echo \$?); c=\$(truncate -c -s 0 /tr52/d 2>/dev/null; echo \$?); echo \"\$a|\$b|\$c\"",
    "mkdir -p /dd52; cd /dd52; a=\$(dd conv=ucase, status=none <<< \"hi\" 2>/dev/null; echo \$?); b=\$(dd bs=2*2 status=none <<< \"hi\" 2>/dev/null; echo \$?); c=\$(dd of=- status=none <<< \"hi\"); echo \"\$a|\$b|\$c:\$(cat -)\"",
  ];
  for (const script of scripts) {
    const syncSh = setup().shell.use(agentCommands());
    const asyncSh = setup().shell.use(agentCommands()).use(async (_ctx, next) => next());
    const rSync = await syncSh.exec(script);
    const rAsync = await asyncSh.exec(script);
    assert.equal(rSync.exitCode, rAsync.exitCode, `exitCode mismatch for ${script}`);
    assert.equal(rSync.stdout, rAsync.stdout, `stdout mismatch for ${script}`);
  }
});
