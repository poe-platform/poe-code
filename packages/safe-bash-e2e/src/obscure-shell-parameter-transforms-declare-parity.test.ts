import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell parameter transformations, declare -p/+attr/-g, array elementwise ops, and $- deep parity matrix", () => {
  it("01. ${var@A} assignment statement transform on plain scalars, attributed scalars, declared-unset vars, and unset vars", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
plain="hello world"
declare -irx count=42
declare -l low="MiXeD"
declare -i uninit_num
unset missing_var

printf 'plain=<%s>\\n' "\${plain@A}"
printf 'count=<%s>\\n' "\${count@A}"
printf 'low=<%s>\\n' "\${low@A}"
printf 'uninit=<%s>\\n' "\${uninit_num@A}"
printf 'missing=<%s>\\n' "\${missing_var@A}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "plain=<plain='hello world'>",
          "count=<declare -irx count='42'>",
          "low=<declare -l low='mixed'>",
          "uninit=<declare -i uninit_num>",
          "missing=<>",
        ].join("\n") + "\n",
      );
    });
  });

  it("02. ${arr[@]@A} and ${assoc[@]@A} assignment statement transform on sparse indexed and associative arrays", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -a sparse=([1]="one" [4]="four \\$dollar")
declare -Ar assoc=([alpha]="first val" [beta]="second")

printf 'sparse=<%s>\\n' "\${sparse[@]@A}"
printf 'assoc=<%s>\\n' "\${assoc[@]@A}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          'sparse=<declare -a sparse=([1]="one" [4]="four \\$dollar")>',
          'assoc=<declare -Ar assoc=(["alpha"]="first val" ["beta"]="second")>',
        ].join("\n") + "\n",
      );
    });
  });

  it("03. ${arr[@]@K} vs ${arr[@]@k} on sparse indexed arrays, associative arrays, and scalars", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -a sparse=([2]="two words" [7]='quote"here')
declare -A map=([alpha]="one 1" [beta]="two 2")
scalar="hello world"

printf 'sparse_at_k=<%s>\\n' "\${sparse[@]@k}"
printf 'sparse_star_k=<%s>\\n' "\${sparse[*]@k}"
printf 'sparse_K=<%s>\\n' "\${sparse[@]@K}"
printf 'map_star_k=<%s>\\n' "\${map[*]@k}"
printf 'map_K=<%s>\\n' "\${map[@]@K}"
printf 'scalar_k=<%s>\\n' "\${scalar@k}"
printf 'scalar_K=<%s>\\n' "\${scalar@K}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "sparse_at_k=<2>",
          "sparse_at_k=<two words>",
          "sparse_at_k=<7>",
          'sparse_at_k=<quote"here>',
          'sparse_star_k=<2 two words 7 quote"here>',
          'sparse_K=<2 "two words" 7 "quote\\"here">',
          "map_star_k=<alpha one 1 beta two 2>",
          'map_K=<\'alpha\' "one 1" \'beta\' "two 2">',
          "scalar_k=<hello world>",
          "scalar_K=<'hello world'>",
        ].join("\n") + "\n",
      );
    });
  });

  it("04. ${var@Q} ANSI-C quoting of control characters (\\a, \\b, \\t, \\n, \\v, \\f, \\r, \\E, octal) and single quotes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
sq="it's fine"
ctrl=$'\\a\\b\\t\\n\\v\\f\\r\\e\\x01\\x7f'
slash_ctrl=$'a\\\\b\\'c\\n'

printf 'sq=%s\\n' "\${sq@Q}"
printf 'ctrl=%s\\n' "\${ctrl@Q}"
printf 'slash_ctrl=%s\\n' "\${slash_ctrl@Q}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "sq='it'\\''s fine'",
          "ctrl=$'\\a\\b\\t\\n\\v\\f\\r\\E\\001\\177'",
          "slash_ctrl=$'a\\\\b\\'c\\n'",
        ].join("\n") + "\n",
      );
    });
  });

  it("05. ${var@E} ANSI-C escape decoding including \\?, \\e/\\E, \\cX control chars, octal, and hex", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
raw='A\\tB\\?C\\x44\\105\\cA'
decoded="\${raw@E}"
printf '%s' "$decoded" | od -An -tx1 | tr -s ' ' | sed 's/^ //; s/ $//'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "41 09 42 3f 43 44 45 01");
    });
  });

  it("06. ${var@P} prompt escape decoding combined with parameter and arithmetic expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
who="ops"
tmpl='[\\t] user=$who sum=$((3 + 4))\\nend'
printf '<%s>\\n' "\${tmpl@P}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "<[\t] user=ops sum=7\nend>\n");
    });
  });

  it("07. double-quoted \"${arr[@]@Q}\", \"${arr[@]@U}\", \"${arr[@]@u}\", \"${arr[@]@L}\", \"${arr[@]@E}\" preserve separate elements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
arr=("hello world" "it's" $'line1\\nline2')
printf 'Q:<%s>\\n' "\${arr[@]@Q}"

words=("alpha beta" "gAmMa DeLtA")
printf 'U:<%s>\\n' "\${words[@]@U}"
printf 'u:<%s>\\n' "\${words[@]@u}"
printf 'L:<%s>\\n' "\${words[@]@L}"

esc=('x\\ty' 'a\\nb')
printf 'E:<%s>\\n' "\${esc[@]@E}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Q:<'hello world'>",
          "Q:<'it'\\''s'>",
          "Q:<$'line1\\nline2'>",
          "U:<ALPHA BETA>",
          "U:<GAMMA DELTA>",
          "u:<Alpha beta>",
          "u:<GAmMa DeLtA>",
          "L:<alpha beta>",
          "L:<gamma delta>",
          "E:<x\ty>",
          "E:<a\nb>",
        ].join("\n") + "\n",
      );
    });
  });

  it("08. unquoted/scalar ${arr[*]@Q} and ${arr[*]@u} transform each array element individually before joining", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
items=("one" "two" "three")
phrases=("first item" "second item")
printf 'Q_join=%s\\n' "\${items[*]@Q}"
printf 'u_join=%s\\n' "\${phrases[*]@u}"
printf 'U_join=%s\\n' "\${phrases[*]@U}"
printf 'L_join=%s\\n' "\${phrases[*]@L}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Q_join='one' 'two' 'three'",
          "u_join=First item Second item",
          "U_join=FIRST ITEM SECOND ITEM",
          "L_join=first item second item",
        ].join("\n") + "\n",
      );
    });
  });

  it("09. double-quoted \"${arr[@]#prefix}\", \"${arr[@]%suffix}\", \"${arr[@]/pat/rep}\", and \"${arr[@]^^}\" with dynamic operand variables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
files=("src/my file.txt" "src/other doc.txt")
pre="src/"
suf=".txt"
rep="_"
printf 'strip_pre:<%s>\\n' "\${files[@]#$pre}"
printf 'strip_suf:<%s>\\n' "\${files[@]%$suf}"
printf 'replace:<%s>\\n' "\${files[@]/ /$rep}"
printf 'upper:<%s>\\n' "\${files[@]^^[a-z]}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "strip_pre:<my file.txt>",
          "strip_pre:<other doc.txt>",
          "strip_suf:<src/my file>",
          "strip_suf:<src/other doc>",
          "replace:<src/my_file.txt>",
          "replace:<src/other_doc.txt>",
          "upper:<SRC/MY FILE.TXT>",
          "upper:<SRC/OTHER DOC.TXT>",
        ].join("\n") + "\n",
      );
    });
  });

  it("10. positional parameters \"${@#prefix}\", \"${@/%suf/NEW}\", \"${@@Q}\", and \"${@@U}\" preserve argument boundaries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
run_pos() {
  printf 'Q:<%s>\\n' "\${@@Q}"
  printf 'U:<%s>\\n' "\${@@U}"
  printf 'pre:<%s>\\n' "\${@#pre_}"
  printf 'rep:<%s>\\n' "\${@/%_end/_DONE}"
}
run_pos "pre_hello world_end" "pre_foo bar_end"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Q:<'pre_hello world_end'>",
          "Q:<'pre_foo bar_end'>",
          "U:<PRE_HELLO WORLD_END>",
          "U:<PRE_FOO BAR_END>",
          "pre:<hello world_end>",
          "pre:<foo bar_end>",
          "rep:<pre_hello world_DONE>",
          "rep:<pre_foo bar_DONE>",
        ].join("\n") + "\n",
      );
    });
  });

  it("11. declare -p on plain scalars, attributed scalars, declared-uninitialized variables, and missing variables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
plain="hello"
declare -ix count=15
declare -lr const_low="ABC"
declare -i uninit_var
unset does_not_exist

declare -p plain count const_low uninit_var
if declare -p does_not_exist 2>/workspace/err.txt; then
  echo "UNEXPECTED_OK"
else
  rc=$?
  grep -q "declare: does_not_exist: not found" /workspace/err.txt && printf 'missing_rc=%d err=not_found\\n' "$rc"
fi
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          'declare -- plain="hello"',
          'declare -ix count="15"',
          'declare -lr const_low="abc"',
          "declare -i uninit_var",
          "missing_rc=1 err=not_found",
        ].join("\n") + "\n",
      );
    });
  });

  it("12. declare -p on sparse indexed arrays and associative arrays with special characters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -a arr=([0]="first" [3]='quote"and$dollar')
declare -A map=([alpha]="one" [beta]="two words")

declare -p arr map
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          'declare -a arr=([0]="first" [3]="quote\\"and\\$dollar")',
          'declare -A map=(["alpha"]="one" ["beta"]="two words")',
        ].join("\n") + "\n",
      );
    });
  });

  it("13. declare +i, +l, +u, +x attribute removal and mutually exclusive -l / -u flags", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -i num=10
num="2+3"
printf 'int_eval=%s attr=%s\\n' "$num" "\${num@a}"

declare +i num
num="2+3"
printf 'after_plus_i=%s attr=%s\\n' "$num" "\${num@a}"

declare -l word="HeLLo"
printf 'low=%s attr=%s\\n' "$word" "\${word@a}"

declare -u word
word="HeLLo"
printf 'switched_up=%s attr=%s\\n' "$word" "\${word@a}"

declare +u word
word="HeLLo"
printf 'cleared_case=%s attr=%s\\n' "$word" "\${word@a}"

declare -x exp_var="shared"
printf 'exp_before=%s\\n' "\${exp_var@a}"
declare +x exp_var
printf 'exp_after=%s child=<%s>\\n' "\${exp_var@a}" "$(sh -c 'printf "%s" "$exp_var"')"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "int_eval=5 attr=i",
          "after_plus_i=2+3 attr=",
          "low=hello attr=l",
          "switched_up=HELLO attr=u",
          "cleared_case=HeLLo attr=",
          "exp_before=x",
          "exp_after= child=<>",
        ].join("\n") + "\n",
      );
    });
  });

  it("14. $- special parameter reflects active shell option flags across set -/+ and set -o/+o", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
printf 'initial=%s\\n' "$-"
set -euC
printf 'after_euC=%s\\n' "$-"
set -f -a
printf 'after_fa=%s\\n' "$-"
set +e +f +a
printf 'after_clear=%s\\n' "$-"
set +o noclobber +u
printf 'final=%s\\n' "$-"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "initial=B",
          "after_euC=euBC",
          "after_fa=aefuBC",
          "after_clear=uBC",
          "final=B",
        ].join("\n") + "\n",
      );
    });
  });

  it("15. declare inside a function scopes locally by default while declare -g mutates global variables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
outer="global_before"
test_scope() {
  declare outer="local_shadow"
  declare scoped_only="temp"
  declare -g global_created="from_func"
  declare -g -i global_math=10+15
  printf 'in_func: outer=%s scoped=%s\\n' "$outer" "$scoped_only"
}
test_scope
printf 'after_func: outer=%s scoped=<%s> created=%s math=%s math_attr=%s\\n' \\
  "$outer" "\${scoped_only:-}" "$global_created" "$global_math" "\${global_math@a}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "in_func: outer=local_shadow scoped=temp",
          "after_func: outer=global_before scoped=<> created=from_func math=25 math_attr=i",
        ].join("\n") + "\n",
      );
    });
  });

  it("16. associative array single-element operations (#, %, /, ^^, @Q, ${#map[k]}) with literal and variable keys", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -A map=([route]="/api/v1/users.json" [label]="heLLo world")
k="route"
lbl="label"

printf 'len=%d\\n' "\${#map[$k]}"
printf 'strip_pre=%s\\n' "\${map[$k]#/api/}"
printf 'strip_pre_long=%s\\n' "\${map[$k]##*/}"
printf 'strip_suf=%s\\n' "\${map[$k]%.json}"
printf 'rep=%s\\n' "\${map[$k]/v1/v2}"
printf 'up=%s low=%s\\n' "\${map[$lbl]^^}" "\${map[$lbl],,}"
printf 'quote=%s\\n' "\${map[$lbl]@Q}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "len=18",
          "strip_pre=v1/users.json",
          "strip_pre_long=users.json",
          "strip_suf=/api/v1/users",
          "rep=/api/v2/users.json",
          "up=HELLO WORLD low=hello world",
          "quote='heLLo world'",
        ].join("\n") + "\n",
      );
    });
  });

  it("17. indirect variable expansion ${!ptr} with transforms (@Q, @a, @A) and nameref ${!ref} target inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -ir target_num=99
ptr="target_num"
declare -n ref="target_num"

printf 'ptr_val=%s ptr_a=%s ptr_Q=%s ptr_A=<%s>\\n' "\${!ptr}" "\${!ptr@a}" "\${!ptr@Q}" "\${!ptr@A}"
printf 'ref_val=%s ref_bang=%s ref_a=%s\\n' "$ref" "\${!ref}" "\${ref@a}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "ptr_val=99 ptr_a=ir ptr_Q='99' ptr_A=<declare -ir target_num='99'>",
          "ref_val=99 ref_bang=target_num ref_a=ir",
        ].join("\n") + "\n",
      );
    });
  });

  it("18. export -n removes export attribute while preserving value, and readonly -p lists readonly declarations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
export SERVICE_NAME="billing"
printf 'before_child=<%s> attr=%s\\n' "$(sh -c 'printf "%s" "$SERVICE_NAME"')" "\${SERVICE_NAME@a}"
export -n SERVICE_NAME
printf 'after_n_val=%s after_child=<%s> attr=%s\\n' "$SERVICE_NAME" "$(sh -c 'printf "%s" "$SERVICE_NAME"')" "\${SERVICE_NAME@a}"

readonly RO_ONE="alpha"
declare -ir RO_TWO=77
readonly -p | grep -E 'RO_(ONE|TWO)='
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "before_child=<billing> attr=x",
          "after_n_val=billing after_child=<> attr=",
          'declare -r RO_ONE="alpha"',
          'declare -r RO_TWO="77"',
        ].join("\n") + "\n",
      );
    });
  });

  it("19. append assignment += with declare -i (arithmetic sum), declare -l/-u (case conversion), and arrays", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -i total=10
total+=5*3
declare -i total+=5

declare -u upper="hello"
upper+="_world"

declare -l lower="HELLO"
lower+="_WORLD"

arr=("a" "b")
arr+=("c d")

printf 'total=%d upper=%s lower=%s arr_len=%d arr_last=<%s>\\n' \\
  "$total" "$upper" "$lower" "\${#arr[@]}" "\${arr[2]}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "total=30 upper=HELLO_WORLD lower=hello_world arr_len=3 arr_last=<c d>\n",
      );
    });
  });

  it("20. double-quoted array and positional slices \"${arr[@]:offset:len}\" and \"${@:offset:len}\" with negative offsets and arithmetic", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
arr=("zero 0" "one 1" "two 2" "three 3" "four 4")
idx=1
printf 'arr_slice:<%s>\\n' "\${arr[@]:idx+1:2}"
printf 'arr_neg:<%s>\\n' "\${arr[@]: -2:2}"

slice_pos() {
  printf 'pos_slice:<%s>\\n' "\${@:2:2}"
  printf 'pos_neg:<%s>\\n' "\${@: -2:1}"
}
slice_pos "p1 a" "p2 b" "p3 c" "p4 d"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "arr_slice:<two 2>",
          "arr_slice:<three 3>",
          "arr_neg:<three 3>",
          "arr_neg:<four 4>",
          "pos_slice:<p2 b>",
          "pos_slice:<p3 c>",
          "pos_neg:<p3 c>",
        ].join("\n") + "\n",
      );
    });
  });
});
