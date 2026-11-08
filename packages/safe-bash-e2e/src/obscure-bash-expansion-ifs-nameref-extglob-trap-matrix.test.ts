import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure bash expansion, IFS, nameref, extglob, and trap matrix", () => {
  it("1. double-quoted array prefix/suffix stripping (${arr[@]#pat}, ${arr[@]##pat}, ${arr[@]%pat}, ${arr[@]%%pat}) preserves element boundaries", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'arr=("pre_one two_suf" "pre_three_suf")',
        'printf "<%s>\\n" "${arr[@]#pre_}"',
        'echo "---"',
        'printf "<%s>\\n" "${arr[@]%_suf}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "<one two_suf>\n<three_suf>\n---\n<pre_one two>\n<pre_three>\n",
    );
  });

  it("2. double-quoted array pattern replacement (${arr[@]/pat/rep}, ${arr[@]//pat/rep}) preserves element boundaries", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'arr=("a_b_a one" "a_c_a two")',
        'printf "<%s>\\n" "${arr[@]/a/X}"',
        'echo "---"',
        'printf "<%s>\\n" "${arr[@]//a/X}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "<X_b_a one>\n<X_c_a two>\n---\n<X_b_X one>\n<X_c_X two>\n",
    );
  });

  it("3. double-quoted array case conversion (${arr[@]^}, ${arr[@]^^}, ${arr[@],}, ${arr[@],,}) preserves interior whitespace per element", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'arr=("hello world" "foo bar")',
        'printf "<%s>\\n" "${arr[@]^}"',
        'echo "---"',
        'printf "<%s>\\n" "${arr[@]^^}"',
        'echo "---"',
        'u=("HELLO WORLD" "FOO BAR")',
        'printf "<%s>\\n" "${u[@],}"',
        'echo "---"',
        'printf "<%s>\\n" "${u[@],,}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "<Hello world>\n<Foo bar>\n---\n<HELLO WORLD>\n<FOO BAR>\n---\n<hELLO WORLD>\n<fOO BAR>\n---\n<hello world>\n<foo bar>\n",
    );
  });

  it("4. double-quoted prefix and suffix around ${arr[@]} attach to first and last elements", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'arr=("one two" "three four" "five")',
        'printf "<%s>\\n" "START:${arr[@]}:END"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "<START:one two>\n<three four>\n<five:END>\n",
    );
  });

  it("5. double-quoted array slicing (${arr[@]:offset:length}) with positive and negative offsets", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'arr=("zero 0" "one 1" "two 2" "three 3")',
        'printf "<%s>\\n" "${arr[@]:1:2}"',
        'echo "---"',
        'printf "<%s>\\n" "${arr[@]: -2:2}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "<one 1>\n<two 2>\n---\n<two 2>\n<three 3>\n");
  });

  it("6. IFS mixed whitespace and non-whitespace field splitting preserves empty fields only for non-whitespace delimiters", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'IFS=" :,"',
        's="  a : : b , c  "',
        'set -- $s',
        'printf "%d:" "$#"',
        'printf "<%s>" "$@"',
        'printf "\\n"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "4:<a><><b><c>\n");
  });

  it("7. IFS='' disables word splitting while preserving positional parameter boundaries", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'IFS=""',
        'v="alpha   beta   gamma"',
        'set -- "first item" "second item"',
        'printf "<%s>\\n" $v "$@" "$*"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "<alpha   beta   gamma>\n<first item>\n<second item>\n<first itemsecond item>\n",
    );
  });

  it("8. extglob patterns !(a|b), +(a|b), @(a|b), ?(a|b), *(a|b) in [[ == ]], case, and parameter expansion", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "shopt -s extglob",
        'v="aaabbbccc"',
        'echo "${v##+(a)}|${v%%+(c)}|${v//+(b)/B}"',
        '[[ "def" == !(abc|xyz) ]] && echo "neg-match"',
        '[[ "abc" == !(abc|xyz) ]] || echo "neg-reject"',
        'for w in "foo" "bar" "baz"; do',
        "  case $w in",
        '    @(foo|bar)) echo "hit:$w" ;;',
        '    *) echo "miss:$w" ;;',
        "  esac",
        "done",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "bbbccc|aaabbb|aaaBccc\nneg-match\nneg-reject\nhit:foo\nhit:bar\nmiss:baz\n",
    );
  });

  it("9. chained namerefs (declare -n) targeting scalar variables and array elements with mutation", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'arr=(10 20 30)',
        'declare -n ref1="arr[1]"',
        'declare -n ref2="ref1"',
        'ref2=99',
        'echo "${arr[0]},${arr[1]},${arr[2]}|${!ref1}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "10,99,30|arr[1]\n");
  });

  it("10. arithmetic evaluation with comma operator, nested ternary, arbitrary bases (2#..36#..64#), and bitwise shifts", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'echo $(( a = 3, b = a * 4, b > 10 ? b + 1 : b - 1 ))',
        'echo $(( 2#101101 + 8#77 + 16#ff + 36#z ))',
        'x=5; (( x <<= 3, x |= 3, x ^= 1 ))',
        'echo "$x"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "13\n398\n42\n");
  });

  it("11. negative substring length ${var:offset:-len} and negative array index ${arr[-1]}", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        's="0123456789"',
        'arr=(alpha beta gamma delta)',
        'echo "${s:2:-2}|${s: -6:-2}|${arr[-1]}|${arr[-3]}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "234567|4567|delta|beta\n");
  });

  it("12. parameter transformation operators ${var@Q}, ${var@U}, ${var@u}, ${var@L}, and ${var@a}", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'v="hello world"',
        'declare -r ro="const"',
        'declare -a myarr=(1 2)',
        'declare -A mymap=([k]=v)',
        'echo "${v@U}|${v@u}|${v@L}|${ro@a}|${myarr@a}|${mymap@a}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "HELLO WORLD|Hello world|hello world|r|a|A\n");
  });

  it("13. prefix variable name discovery ${!prefix*} and ${!prefix@} alongside associative array keys ${!map[@]}", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        ' export3_a=1; export3_b=2; export3_c=3',
        'printf "<%s>\\n" "${!export3_@}"',
        'declare -A m=([x]=10 [y]=20)',
        'echo "count:${#m[@]}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "<export3_a>\n<export3_b>\n<export3_c>\ncount:2\n");
  });

  it("14. PIPESTATUS array and set -o pipefail with negated and multi-stage pipelines", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'set -o pipefail',
        'sh -c "exit 3" | sh -c "exit 0" | sh -c "exit 7" | cat',
        'echo "rc=$? ps=${PIPESTATUS[0]},${PIPESTATUS[1]},${PIPESTATUS[2]},${PIPESTATUS[3]}"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "rc=7 ps=3,0,7,0\n");
  });

  it("15. trap RETURN across nested function calls and trap EXIT on shell termination", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'trap \'echo "EXIT_TRAP"\' EXIT',
        'f() { trap \'echo "RET_F"; trap - RETURN\' RETURN; echo "IN_F"; }',
        'g() { echo "IN_G"; f; echo "AFTER_F"; }',
        'g',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "IN_G\nIN_F\nRET_F\nAFTER_F\nEXIT_TRAP\n");
  });

  it("16. process substitution <(...) with comm and paste across sorted streams", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'comm -12 <(printf "c\\na\\nb\\n" | sort) <(printf "b\\nd\\na\\n" | sort)',
        'echo "---"',
        'paste -d: <(printf "k1\\nk2\\n") <(printf "v1\\nv2\\n")',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "a\nb\n---\nk1:v1\nk2:v2\n");
  });

  it("17. heredoc with tab stripping (<<-EOF) and quoted vs unquoted heredoc expansion", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'X=42',
        'cat <<-EOF',
        '\t\tline1=$X',
        '\tline2=$((X + 8))',
        '\tEOF',
        'cat <<-\'EOF\'',
        '\t\tliteral=$X',
        '\tEOF',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "line1=42\nline2=50\nliteral=$X\n");
  });

  it("18. read -d custom delimiter, -n character count, and -a array population with custom IFS", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'IFS=":" read -r -d ";" -a parts <<< "alpha:beta:gamma;ignored"',
        'printf "<%s>" "${parts[@]}"',
        'printf "\\n"',
        'read -r -n 4 prefix <<< "abcdefgh"',
        'echo "prefix=$prefix"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "<alpha><beta><gamma>\nprefix=abcd\n");
  });

  it("19. mapfile / readarray with -t, -s skip, -n count, and -O origin index", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        'arr=("keep0" "keep1")',
        "mapfile -t -s 1 -n 2 -O 2 arr <<< $'drop0\\nl1\\nl2\\ndrop3'",
        'printf "<%s>" "${arr[@]}"',
        'printf "\\n"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "<keep0><keep1><l1><l2>\n");
  });

  it("20. ANSI-C quoting $'...' hex, octal, control escapes, and printf %b / %q roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "s=$'\\x41\\102\\t\\n'",
        'printf "%s" "$s" | od -An -tx1 | tr -s " " | sed "s/^ //; s/ $//"',
        'printf "%b\\n" "\\x48\\x69\\t\\0101"',
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "41 42 09 0a\nHi\tA\n");
  });
});
