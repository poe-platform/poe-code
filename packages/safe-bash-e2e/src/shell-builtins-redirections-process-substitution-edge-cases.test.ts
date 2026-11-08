import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("shell builtins, parameter transformations, namerefs, getopts/getopt, select, PIPESTATUS, FDs, shopt & umask E2E edge cases", () => {
  it("1. parameter transformations (@Q, @E, @a, @A, @K, @k, @u, @U, @L) across scalars, sparse arrays, and associative arrays", async () => {
    await withE2EHarness(
      {
        env: { LC_ALL: "C.UTF-8" },
      },
      async (h) => {
        const res = await h.exec(`
plain="it's a test"
escaped='line1\\nline2\\t\\x41\\102'
mixed="hELLo"
declare -ir num=42
declare -a sparse=([1]="alpha" [4]="delta")
declare -A assoc=([first]="one" [second]="two")

printf 'Q=%s\\n' "\${plain@Q}"
printf 'E=%s\\n' "\${escaped@E}"
printf 'u=%s U=%s L=%s\\n' "\${mixed@u}" "\${mixed@U}" "\${mixed@L}"
printf 'num_a=%s\\n' "\${num@a}"
printf 'sparse_a=%s sparse_k=%s\\n' "\${sparse@a}" "\${sparse[*]@k}"
printf 'assoc_a=%s\\n' "\${assoc@a}"
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Q='it'\\''s a test'/);
        assert.match(res.stdout, /E=line1\nline2\tAB/);
        assert.match(res.stdout, /u=HELLo U=HELLO L=hello/);
        assert.match(res.stdout, /num_a=ir/);
        assert.match(res.stdout, /sparse_a=a sparse_k=1 alpha 4 delta/);
        assert.match(res.stdout, /assoc_a=A/);
      },
    );
  });

  it("2. case modification operators (^, ^^, ,, ,,) with character-class patterns, Unicode strings, and arrays", async () => {
    await withE2EHarness(
      {
        env: { LC_ALL: "C.UTF-8" },
      },
      async (h) => {
        const res = await h.exec(`
word="banana"
printf 'first=%s all=%s vowels=%s\\n' "\${word^}" "\${word^^}" "\${word^^[aeo]}"
upper="BANANA"
printf 'low1=%s lowall=%s low_b=%s\\n' "\${upper,}" "\${upper,,}" "\${upper,[B]}"
utf="éßİΣ"
printf 'utf_up=%s utf_down=%s\\n' "\${utf^^}" "\${utf,,}"
arr=("alpha" "BETA" "gAmMa")
printf 'arr_up=%s\\n' "\${arr[*]^^}"
printf 'arr_down=%s\\n' "\${arr[*],,}"
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "first=Banana all=BANANA vowels=bAnAnA",
            "low1=bANANA lowall=banana low_b=bANANA",
            "utf_up=ÉßİΣ utf_down=éßiσ",
            "arr_up=ALPHA BETA GAMMA",
            "arr_down=alpha beta gamma",
          ].join("\n") + "\n",
        );
      },
    );
  });

  it("3. substring slicing, negative offsets, array slicing, and prefix/suffix/pattern substitution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
str="0123456789abcdef"
printf 'slice1=%s slice_neg=%s slice_drop_end=%s\\n' "\${str:4:6}" "\${str: -6:4}" "\${str:2:-2}"

path="/usr/local/share/archive.tar.gz"
printf 'short_pre=%s long_pre=%s\\n' "\${path#*/}" "\${path##*/}"
printf 'short_suf=%s long_suf=%s\\n' "\${path%.*}" "\${path%%.*}"

text="foo_bar_foo_baz_foo"
printf 'one=%s all=%s anchor_start=%s anchor_end=%s\\n' \\
  "\${text/foo/X}" "\${text//foo/X}" "\${text/#foo/START}" "\${text/%foo/END}"

items=(zero one two three four five)
printf 'arr_slice=%s\\n' "\${items[*]:2:3}"
printf 'arr_neg=%s\\n' "\${items[*]: -2:2}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "slice1=456789 slice_neg=abcd slice_drop_end=23456789abcd",
          "short_pre=usr/local/share/archive.tar.gz long_pre=archive.tar.gz",
          "short_suf=/usr/local/share/archive.tar long_suf=/usr/local/share/archive",
          "one=X_bar_foo_baz_foo all=X_bar_X_baz_X anchor_start=START_bar_foo_baz_foo anchor_end=foo_bar_foo_baz_END",
          "arr_slice=two three four",
          "arr_neg=four five",
        ].join("\n") + "\n",
      );
    });
  });

  it("4. indirect expansion (!ref, !prefix*, !prefix@, !arr[@]) and default/assign/alternate expansions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
CFG_HOST="db.internal"
CFG_PORT="5432"
CFG_MODE="tls"
ptr="CFG_HOST"
printf 'indirect=%s\\n' "\${!ptr}"
printf 'prefix_names=%s\\n' "\${!CFG_*}"

empty=""
unset missing
printf 'colon_def=%s plain_def=%s\\n' "\${empty:-fallback}" "\${empty-fallback}"
printf 'missing_def=%s\\n' "\${missing-fallback2}"
printf 'assign=%s after=%s\\n' "\${assigned:=created_now}" "$assigned"
printf 'alt_set=%s alt_empty=%s\\n' "\${assigned:+is_present}" "\${empty:+is_present}"

declare -A map=([alpha]=10 [beta]=20 [gamma]=30)
keys=("\${!map[@]}")
printf 'key_count=%d\\n' "\${#keys[@]}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "indirect=db.internal",
          "prefix_names=CFG_HOST CFG_MODE CFG_PORT",
          "colon_def=fallback plain_def=",
          "missing_def=fallback2",
          "assign=created_now after=created_now",
          "alt_set=is_present alt_empty=",
          "key_count=3",
        ].join("\n") + "\n",
      );
    });
  });

  it("5. declare / local / readonly / export attributes (-i arithmetic, -l lowercase, -u uppercase, -f/-F functions)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
declare -i counter=10+5*2
counter+=3*4
declare -l lower_var="MiXeD_CaSe_123"
declare -u upper_var="MiXeD_CaSe_123"
printf 'counter=%d lower=%s upper=%s\\n' "$counter" "$lower_var" "$upper_var"

my_helper() {
  local -i local_sum="7 + 8"
  local -u local_tag="scoped_ok"
  printf 'inside:%d:%s\\n' "$local_sum" "$local_tag"
}
my_helper
declare -F my_helper
export -f my_helper
bash -c 'my_helper'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "counter=32 lower=mixed_case_123 upper=MIXED_CASE_123",
          "inside:15:SCOPED_OK",
          "my_helper",
          "inside:15:SCOPED_OK",
        ].join("\n") + "\n",
      );
    });
  });

  it("6. nameref variables (declare -n): chained references, += append, unset -n vs unset target, and self-ref rejection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
target="initial"
declare -n ref1=target
declare -n ref2=ref1
ref2="mutated"
ref1+="_appended"
printf 'target=%s ref1=%s ref2=%s\\n' "$target" "$ref1" "$ref2"

# Unsetting -n removes only the nameref alias, preserving target
unset -n ref1
printf 'after_unset_n_target=%s\\n' "$target"

# Rebind and unset target through nameref
declare -n ref3=target
unset ref3
printf 'after_unset_target=%s\\n' "\${target:-GONE}"

# Self-referential nameref is rejected with non-zero status
if declare -n self=self 2>/dev/null; then
  echo "UNEXPECTED_SELF_REF"
else
  echo "self_ref_rejected"
fi
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "target=mutated_appended ref1=mutated_appended ref2=mutated_appended",
          "after_unset_n_target=mutated_appended",
          "after_unset_target=GONE",
          "self_ref_rejected",
        ].join("\n") + "\n",
      );
    });
  });

  it("7. getopts builtin: bundled flags, option arguments, silent ':' error reporting, and OPTIND reset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
parse_args() {
  local OPTIND=1 opt
  while getopts ":ab:c" opt "$@"; do
    case "$opt" in
      a) printf 'A ' ;;
      b) printf 'B(%s) ' "$OPTARG" ;;
      c) printf 'C ' ;;
      :) printf 'MISSING(%s) ' "$OPTARG" ;;
      \\?) printf 'UNKNOWN(%s) ' "$OPTARG" ;;
    esac
  done
  shift $((OPTIND - 1))
  printf 'REST=[%s]\\n' "$*"
}

parse_args -ac -b "hello world" -- -x pos1 pos2
parse_args -z -b
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "A C B(hello world) REST=[-x pos1 pos2]",
          "UNKNOWN(z) MISSING(b) REST=[]",
        ].join("\n") + "\n",
      );
    });
  });

  it("8. getopt command: short and long options (--long), optional arguments, and eval set -- workflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
PARSED=$(getopt -o vf:o:: --long verbose,file:,output:: -n 'deploy.sh' -- -v --file "config prod.yml" --output=dist arg1 "arg 2")
eval set -- "$PARSED"

VERBOSE=0
FILE=""
OUT=""
while true; do
  case "$1" in
    -v|--verbose) VERBOSE=1; shift ;;
    -f|--file) FILE="$2"; shift 2 ;;
    -o|--output) OUT="\${2:-default_out}"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
printf 'V=%d FILE=[%s] OUT=[%s] POS=[%s|%s]\\n' "$VERBOSE" "$FILE" "$OUT" "$1" "$2"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "V=1 FILE=[config prod.yml] OUT=[dist] POS=[arg1|arg 2]\n",
      );
    });
  });

  it("9. select menu compound command: PS3 prompt, invalid choice handling, REPLY tracking, and multi-column display", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
PS3="Choose env> "
COLUMNS=40
select env in "dev" "staging" "prod" "quit"; do
  if [ -z "$env" ]; then
    printf 'invalid:%s\\n' "$REPLY"
    continue
  fi
  printf 'selected:%s(reply=%s)\\n' "$env" "$REPLY"
  if [ "$env" = "prod" ]; then
    break
  fi
done <<'SELECT_IN'
99
3
SELECT_IN
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "invalid:99\nselected:prod(reply=3)\n");
      assert.match(res.stderr, /1\) dev/);
      assert.match(res.stderr, /3\) prod/);
      assert.match(res.stderr, /Choose env> /);
    });
  });

  it("10. PIPESTATUS array across multi-stage pipelines, negated pipelines, and pipefail", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
(exit 3) | (exit 0) | (exit 7) | (exit 0)
printf 'status=%d pipes=%s\\n' "$?" "\${PIPESTATUS[*]}"

! (exit 2) | (exit 5)
printf 'neg_status=%d neg_pipes=%s\\n' "$?" "\${PIPESTATUS[*]}"

set -o pipefail
! (exit 0) | (exit 9) | (exit 0)
printf 'pipefail_neg=%d pf_pipes=%s\\n' "$?" "\${PIPESTATUS[*]}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "status=0 pipes=3 0 7 0",
          "neg_status=0 neg_pipes=2 5",
          "pipefail_neg=0 pf_pipes=0 9 0",
        ].join("\n") + "\n",
      );
    });
  });

  it("11. file descriptor manipulation: exec 3> 4<, stdout/stderr swap (3>&1 1>&2 2>&3), &>, and <> read-write", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
{
  printf 'line-one\\n' >&3
  printf 'line-two\\n' >&3
} 3> /workspace/fd3.log

{
  read -r first_line <&4
  read -r second_line <&4
} 4< /workspace/fd3.log
printf 'read4=%s,%s\\n' "$first_line" "$second_line"

# Swap stdout and stderr for a compound block via descriptor 3
SWAPPED=$( { { printf 'to-stdout'; printf 'to-stderr' >&2; } 3>&1 1>&2 2>&3 3>&-; } 2>/workspace/orig_out.txt )
printf 'swapped_captured=%s orig_out=%s\\n' "$SWAPPED" "$(cat /workspace/orig_out.txt)"

# Combined &> redirection
{ printf 'both-out\\n'; printf 'both-err\\n' >&2; } &> /workspace/combined.log
wc -l < /workspace/combined.log | tr -d ' '
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "read4=line-one,line-two",
          "swapped_captured=to-stderr orig_out=to-stdout",
          "2",
        ].join("\n") + "\n",
      );
    });
  });

  it("12. set -C (noclobber) blocks '>' on existing regular files while allowing '>|', '>>', and '/dev/null'", async () => {
    await withE2EHarness(
      {
        mountDev: true,
      },
      async (h) => {
        const res = await h.exec(`
set -C
printf 'v1\\n' > /workspace/protected.txt
if printf 'v2\\n' > /workspace/protected.txt 2>/dev/null; then
  echo "UNEXPECTED_CLOBBER"
else
  echo "clobber_blocked"
fi
cat /workspace/protected.txt

# Force overwrite with >|
printf 'v2_forced\\n' >| /workspace/protected.txt
# Append with >>
printf 'v3_appended\\n' >> /workspace/protected.txt
# Writing to /dev/null still allowed under noclobber
printf 'discarded\\n' > /dev/null
cat /workspace/protected.txt
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          ["clobber_blocked", "v1", "v2_forced", "v3_appended"].join("\n") + "\n",
        );
      },
    );
  });

  it("13. shopt options: nullglob, failglob, dotglob, extglob, globstar, nocaseglob, and shopt -p/-q/-o", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /workspace/globtest/sub/deep
touch /workspace/globtest/.hidden /workspace/globtest/Alpha.TXT /workspace/globtest/beta.md /workspace/globtest/sub/deep/nested.txt
cd /workspace/globtest

# nullglob
shopt -s nullglob
empty_matches=(*.nonexistent)
printf 'nullglob_count=%d\\n' "\${#empty_matches[@]}"
shopt -u nullglob

# dotglob
shopt -s dotglob
all_entries=(*)
shopt -u dotglob
printf 'dotglob_has_hidden=%s\\n' "$(printf '%s\\n' "\${all_entries[@]}" | grep '^\\.hidden$')"

# nocaseglob
shopt -s nocaseglob
txt_matches=(*.txt)
shopt -u nocaseglob
printf 'nocase=%s\\n' "\${txt_matches[*]}"

# globstar
shopt -s globstar
deep_txt=(**/*.txt)
shopt -u globstar
printf 'globstar_count=%d\\n' "\${#deep_txt[@]}"

# extglob
shopt -s extglob
ext_matches=(@(Alpha.TXT|beta.md))
printf 'extglob=%s\\n' "\${ext_matches[*]}"
shopt -q extglob && echo "extglob_active"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "nullglob_count=0",
          "dotglob_has_hidden=.hidden",
          "nocase=Alpha.TXT",
          "globstar_count=1",
          "extglob=Alpha.TXT beta.md",
          "extglob_active",
        ].join("\n") + "\n",
      );
    });
  });

  it("14. pushd, popd, dirs (-v, -p, -c, +N), cd -, and pwd (-L vs -P) across symlinked directories", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /workspace/real_dir/child /workspace/other
ln -s /workspace/real_dir /workspace/sym_dir

cd /workspace/sym_dir/child
printf 'logical=%s physical=%s\\n' "$(pwd -L)" "$(pwd -P)"

pushd /workspace/other >/dev/null
pushd /tmp >/dev/null
dirs -p | tr '\\n' '|'
printf '\\n'
popd >/dev/null
pwd -L
cd - >/dev/null
pwd -P
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "logical=/workspace/sym_dir/child physical=/workspace/real_dir/child",
          "/tmp|/workspace/other|/workspace/sym_dir/child|",
          "/workspace/other",
          "/tmp",
        ].join("\n") + "\n",
      );
    });
  });

  it("15. hash, type (-t, -a, -P), command (-v, -V), builtin, and which (-a, -s) command resolution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
my_echo() { printf 'fn:%s\\n' "$*"; }
printf 'type_fn=%s type_cd=%s type_grep=%s\\n' "$(type -t my_echo)" "$(type -t cd)" "$(type -t grep)"
printf 'cmd_v=%s\\n' "$(command -v my_echo)"
builtin echo "from-builtin-echo"

mkdir -p /usr/local/bin
printf '#!/bin/sh\necho custom\n' > /usr/local/bin/custom_tool
chmod +x /usr/local/bin/custom_tool
hash -p /usr/local/bin/custom_tool custom_tool
hash -t custom_tool
hash -d custom_tool
which -s custom_tool && echo "which_custom_ok"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "type_fn=function type_cd=builtin type_grep=file",
          "cmd_v=my_echo",
          "from-builtin-echo",
          "/usr/local/bin/custom_tool",
          "which_custom_ok",
        ].join("\n") + "\n",
      );
    });
  });

  it("16. umask octal and symbolic modes (-S, -p) and file/directory creation mode enforcement", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
umask 0027
umask
umask -S
touch /workspace/umask_file.txt
mkdir /workspace/umask_dir
stat -c '%a' /workspace/umask_file.txt /workspace/umask_dir

umask u=rwx,g=,o=
umask
touch /workspace/strict_file.txt
stat -c '%a' /workspace/strict_file.txt
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["0027", "u=rwx,g=rx,o=", "640", "750", "0077", "600"].join("\n") + "\n",
      );
    });
  });

  it("17. let builtin and (( )) arithmetic: bases (2#, 8#, 16#, 36#), bitwise ops, ternary, comma, and ++/--", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
let "a = 2#10110" "b = 16#1f" "c = 8#77"
let "d = (a < b ? b : a) << 1"
(( e = 10, f = ++e + e++ ))
printf 'a=%d b=%d c=%d d=%d e=%d f=%d\\n' "$a" "$b" "$c" "$d" "$e" "$f"

# let returns 1 when last expression evaluates to 0, 0 when non-zero
if let "zero_val = 5 - 5"; then
  echo "UNEXPECTED_TRUE"
else
  echo "let_zero_is_exit_1"
fi
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["a=22 b=31 c=63 d=62 e=12 f=22", "let_zero_is_exit_1"].join("\n") + "\n",
      );
    });
  });

  it("18. source (.) with positional parameter overrides, return status from sourced files, and nested eval", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/lib.sh": `
printf 'lib_args=[%s](%d)\\n' "$*" "$#"
EXPORTED_FROM_LIB="loaded_$1"
if [ "$2" = "early" ]; then
  return 42
fi
printf 'lib_completed\\n'
`,
        },
      },
      async (h) => {
        const res = await h.exec(`
set -- caller_one caller_two
source /workspace/lib.sh sub_a normal
printf 'after1: caller=[%s] var=%s\\n' "$*" "$EXPORTED_FROM_LIB"

source /workspace/lib.sh sub_b early
RET=$?
printf 'after2: ret=%d caller=[%s] var=%s\\n' "$RET" "$*" "$EXPORTED_FROM_LIB"

dyn_name="EXPORTED_FROM_LIB"
eval "printf 'eval_indirect=%s\\n' \\"\\$$dyn_name\\""
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "lib_args=[sub_a normal](2)",
            "lib_completed",
            "after1: caller=[caller_one caller_two] var=loaded_sub_a",
            "lib_args=[sub_b early](2)",
            "after2: ret=42 caller=[caller_one caller_two] var=loaded_sub_b",
            "eval_indirect=loaded_sub_b",
          ].join("\n") + "\n",
        );
      },
    );
  });

  it("19. dos2unix and unix2dos line-ending conversions on files and pipelines", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
printf 'alpha\\r\\nbeta\\r\\ngamma\\r\\n' > /workspace/crlf.txt
wc -c < /workspace/crlf.txt | tr -d ' '
dos2unix /workspace/crlf.txt
wc -c < /workspace/crlf.txt | tr -d ' '
unix2dos < /workspace/crlf.txt | wc -c | tr -d ' '
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "20\n17\n20\n");
    });
  });

  it("20. timeout command: normal exit code forwarding, deadline expiration (124), --preserve-status, and -s KILL (137)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
timeout 5s sh -c 'printf "fast_ok\\n"; exit 7'
printf 'fast_exit=%d\\n' "$?"

timeout 0.03s sleep 2
printf 'expired_exit=%d\\n' "$?"

timeout -s KILL 0.03s sleep 2
printf 'kill_exit=%d\\n' "$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["fast_ok", "fast_exit=7", "expired_exit=124", "kill_exit=137"].join("\n") +
          "\n",
      );
    });
  });
});
