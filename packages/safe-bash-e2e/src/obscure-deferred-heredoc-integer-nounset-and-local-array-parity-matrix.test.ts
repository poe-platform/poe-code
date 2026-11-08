import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness, type E2EHarnessOptions } from "./harness.js";

const createE2EHarness = (opts: E2EHarnessOptions = {}) => SafeBashE2EHarness.create(opts);

describe("obscure deferred heredoc, indirect parameter, integer nounset, arithmetic quote, and local array parity matrix", () => {
  it("1. deferred heredoc parses preceding commands before failing on malformed $(...) inside heredoc body", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        ": >before",
        "cat <<EOF",
        "$(: >inside; (",
        "EOF",
        'printf "cat=%d\\n" "$?"',
        ": >after",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "cat=1\n");
    assert.equal(
      res.stderr,
      "shell: command substitution: line 4: unexpected EOF while looking for matching `)'\n",
    );
    assert.equal(await h.exists("/work/before"), true);
    assert.equal(await h.exists("/work/inside"), false);
    assert.equal(await h.exists("/work/after"), true);
  });

  it("2. deferred heredoc sets $?=2 and continues expanding after malformed backtick substitution", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "cat <<EOF",
        "`echo hi; (` status:$?",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, " status:2\n");
    assert.equal(
      res.stderr,
      "shell: command substitution: line 2: syntax error: unexpected end of file\n",
    );
  });

  it("3. deferred heredoc preserves verbatim body when delimiter is single, double, or backslash quoted", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "cat <<'EOF'",
        "$(echo $( (",
        "`echo hi; (`",
        "EOF",
        "cat <<\\EOF",
        "$((1 + ))",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "$(echo $( (\n`echo hi; (`\n$((1 + ))\n");
    assert.equal(res.stderr, "");
  });

  it("4. deferred heredoc line folding and dash-stripped tabs preserve diagnostic line numbers", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res1 = await h.exec(
      [
        "cat <<EOF",
        "$(echo hi\\",
        "there; (",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res1.exitCode, 1);
    assert.equal(res1.stdout, "");
    assert.equal(
      res1.stderr,
      "shell: command substitution: line 3: unexpected EOF while looking for matching `)'\n",
    );

    const res2 = await h.exec(
      [
        "cat <<-EOF",
        "\t$(echo hi",
        "\t(",
        "\tEOF",
      ].join("\n"),
    );
    assert.equal(res2.exitCode, 1);
    assert.equal(res2.stdout, "");
    assert.equal(
      res2.stderr,
      "shell: command substitution: line 4: unexpected EOF while looking for matching `)'\n",
    );
  });

  it("5. deferred heredoc reports inner syntax token errors before running prior statements inside $(...)", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "cat <<EOF",
        "$(echo before; if then fi)",
        "EOF",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 1);
    assert.equal(res.stdout, "");
    assert.equal(
      res.stderr,
      "shell: command substitution: line 2: syntax error near unexpected token `then'\nshell: command substitution: line 2: `echo before; if then fi)'\n",
    );
  });

  it("6. indirect parameter expansion resolves positional parameters, array elements, and special params while rejecting malformed forms", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const ok = await h.exec(
      [
        "set -- alpha beta",
        "arr=(zero one two)",
        "p=2; i='arr[1]'; all='arr[*]'; c='#'; s='*'",
        'printf "%s|%s|%s|%s|%s\\n" "${!p}" "${!i}" "${!all}" "${!c}" "${!s}"',
      ].join("\n"),
    );
    assert.equal(ok.exitCode, 0);
    assert.equal(ok.stdout, "beta|one|zero one two|2|alpha beta\n");
    assert.equal(ok.stderr, "");

    const bad = await h.exec('bad="not valid"; echo "${!bad}"');
    assert.equal(bad.exitCode, 1);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /invalid variable name|bad substitution/);

    const badBang = await h.exec("cat <<EOF\nhead ${bad!} tail\nEOF");
    assert.equal(badBang.exitCode, 1);
    assert.equal(badBang.stdout, "");
    assert.equal(badBang.stderr, "shell: line 1: head ${bad!} tail\n: bad substitution\n");
  });

  it("7. inline input fatal expansion errors abort special builtins with 127 and fail external commands with 127", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const ext = await h.exec('cat <<<"${missing:?stop}"\nprintf "status=%d\\n" "$?"');
    assert.equal(ext.exitCode, 0);
    assert.equal(ext.stdout, "status=127\n");
    assert.equal(ext.stderr, "shell: line 1: missing: stop\n");

    const spec = await h.exec(': <<<"${missing:?stop}"\necho unreachable');
    assert.equal(spec.exitCode, 127);
    assert.equal(spec.stdout, "");
    assert.equal(spec.stderr, "shell: line 1: missing: stop\n");
  });

  it("8. inline input limits enforce maxExpansionBytes across here-strings and unquoted heredocs", async () => {
    const h = await createE2EHarness({
      cwd: "/work",
      limits: { maxExpansionBytes: 8 },
    });
    await assert.rejects(
      () => h.exec("x=123456789; cat <<<$x"),
      /maxExpansionBytes/,
    );
    await assert.rejects(
      () => h.exec("x=123456789\ncat <<EOF\n$x\nEOF"),
      /maxExpansionBytes/,
    );
  });

  it("9. single-quote and double-quote tokens inside (( ... )) and $(( ... )) reject with Bash operand diagnostics", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const sq = await h.exec("(( '5' == 5 )); echo status:$?");
    assert.equal(sq.exitCode, 0);
    assert.equal(sq.stdout, "status:1\n");
    assert.equal(
      sq.stderr,
      "shell: line 1: ((: '5' == 5 : syntax error: operand expected (error token is \"'5' == 5 \")\n",
    );

    const dq = await h.exec('echo $(( "1+2" ))');
    assert.equal(dq.exitCode, 0);
    assert.equal(dq.stdout, "3\n");
    assert.equal(dq.stderr, "");

    const bsq = await h.exec("echo $(( \\'5\\' == 5 ))");
    assert.equal(bsq.exitCode, 1);
    assert.equal(bsq.stdout, "");
    assert.equal(
      bsq.stderr,
      "shell: line 1: \\'5\\' == 5 : syntax error: operand expected (error token is \"\\'5\\' == 5 \")\n",
    );
  });

  it("10. quoted arithmetic operators report invalid arithmetic operator while quotes inside ${...} remain valid", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const op = await h.exec("(( 1 '2' )); echo status:$?");
    assert.equal(op.exitCode, 0);
    assert.equal(op.stdout, "status:1\n");
    assert.equal(
      op.stderr,
      "shell: line 1: ((: 1 '2' : syntax error: invalid arithmetic operator (error token is \"'2' \")\n",
    );

    const valid = await h.exec('unset x; (( ${x:-"5"} == 5 )); echo status:$?');
    assert.equal(valid.exitCode, 0);
    assert.equal(valid.stdout, "status:0\n");
    assert.equal(valid.stderr, "");
  });

  it("11. integer attribute assignments strip quotes during word expansion before arithmetic evaluation", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const ok = await h.exec(
      [
        "declare -i x",
        'x="1+2"',
        'printf "dq=%s status=%d\\n" "$x" "$?"',
      ].join("\n"),
    );
    assert.equal(ok.exitCode, 0);
    assert.equal(ok.stdout, "dq=3 status=0\n");
    assert.equal(ok.stderr, "");

    const bad = await h.exec(
      [
        "declare -i x",
        'x="\'5\'"',
      ].join("\n"),
    );
    assert.equal(bad.exitCode, 1);
    assert.equal(bad.stdout, "");
    assert.equal(
      bad.stderr,
      "shell: line 2: '5': syntax error: operand expected (error token is \"'5'\")\n",
    );
  });

  it("12. recursive arithmetic evaluation preserves side effects before failure and formats outer error token", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        'a=0; b="foo bar"',
        "(( a++, x = b ))",
        'printf "status=%d a=%s x=%s\\n" "$?" "$a" "${x-<unset>}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "status=1 a=1 x=<unset>\n");
    assert.equal(
      res.stderr,
      'shell: line 2: ((: a++, x = b : arithmetic syntax error in expression (error token is ", x = b ")\n',
    );
  });

  it("13. arithmetic variable recursion reports cycle diagnostic cleanly without crashing", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec("a=b; b=a; (( a )); echo status:$?");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "status:1\n");
    assert.match(res.stderr, /Arithmetic variable recursion/);
  });

  it("14. integer attribute assignment under set -u aborts parent shell with 127 and exits subshell with 1", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const parent = await h.exec(
      [
        "set -u",
        "declare -i n=missing || echo recovered",
        "echo unreachable",
      ].join("\n"),
    );
    assert.equal(parent.exitCode, 127);
    assert.equal(parent.stdout, "");
    assert.equal(parent.stderr, "shell: line 2: missing: unbound variable\n");

    const sub = await h.exec(
      [
        "set -u",
        "out=$(declare -i n=missing; echo unreachable)",
        'printf "sub=%d out=%s\\n" "$?" "$out"',
      ].join("\n"),
    );
    assert.equal(sub.exitCode, 0);
    assert.equal(sub.stdout, "sub=1 out=\n");
    assert.equal(sub.stderr, "shell: line 2: missing: unbound variable\n");
  });

  it("15. integer array element and compound assignments under set -u abort before mutating target", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const elem = await h.exec(
      [
        "set -u",
        "declare -ia a=(10)",
        "( a[0]+=missing )",
        'printf "elem=%d a0=%s\\n" "$?" "${a[0]}"',
      ].join("\n"),
    );
    assert.equal(elem.exitCode, 0);
    assert.equal(elem.stdout, "elem=1 a0=10\n");
    assert.equal(elem.stderr, "shell: line 3: missing: unbound variable\n");

    const comp = await h.exec(
      [
        "set -u",
        "declare -ia a=(10)",
        "( a=(1 missing 3) )",
        'printf "comp=%d a=%s\\n" "$?" "${a[*]}"',
      ].join("\n"),
    );
    assert.equal(comp.exitCode, 0);
    assert.equal(comp.stdout, "comp=1 a=10\n");
    assert.equal(comp.stderr, "shell: line 3: missing: unbound variable\n");
  });

  it("16. integer assignment with recursive unbound variable reports inner variable name under set -u", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "set -u",
        "expr='missing + 1'",
        "declare -i n=expr",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 127);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, "shell: line 3: missing: unbound variable\n");
  });

  it("17. set -a allexport exports scalar and bare-array writes in arithmetic and readonly but not subscript writes", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "arr=()",
        "arr2=()",
        "arr3=()",
        "set -a",
        "(( arr[0]=7 ))",
        "(( arr2=8 ))",
        "readonly arr3=9",
        "set +a",
        "declare -p arr arr2 arr3",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        'declare -a arr=([0]="7")',
        'declare -ax arr2=([0]="8")',
        'declare -arx arr3=([0]="9")',
        "",
      ].join("\n"),
    );
    assert.equal(res.stderr, "");
  });

  it("18. local without -I starts fresh even with += and restores caller array and attributes on return", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "declare -ai arr=(10 20)",
        "f() {",
        "  local -u arr+=new",
        "  declare -p arr",
        "}",
        "f",
        "declare -p arr",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        'declare -u arr="NEW"',
        'declare -ai arr=([0]="10" [1]="20")',
        "",
      ].join("\n"),
    );
    assert.equal(res.stderr, "");
  });

  it("19. local -I inherits caller array values and attributes including append and re-transformation", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "arr=(foo bar)",
        "f() {",
        "  local -Iu arr+=(baz)",
        "  declare -p arr",
        "}",
        "f",
        "declare -p arr",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        'declare -au arr=([0]="foo" [1]="bar" [2]="BAZ")',
        'declare -a arr=([0]="foo" [1]="bar")',
        "",
      ].join("\n"),
    );
    assert.equal(res.stderr, "");
  });

  it("20. function definitions accept keyword names like time and coproc while preserving keyword discovery", async () => {
    const h = await createE2EHarness({ cwd: "/work" });
    const res = await h.exec(
      [
        "function time { echo custom-time; }",
        "type -t time",
        "command -v time",
        "type -f time",
        "sh -c 'command -v if for while; command -V case'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "keyword",
        "time",
        "time is a shell keyword",
        "if",
        "for",
        "while",
        "case is a shell keyword",
        "",
      ].join("\n"),
    );
    assert.equal(res.stderr, "");
  });
});
