import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("shell builtins trap, getopts, printf, read, mapfile, declare, pushd/popd, shopt, and command discovery matrix", () => {
  it("1. getopts parses clustered flags, attached and separate option arguments, silent mode (:), and resets via OPTIND=1", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
parse_cli() {
  local OPTIND=1 opt out=""
  while getopts ":ab:o:" opt "$@"; do
    case "$opt" in
      a) out="\${out}A;" ;;
      b) out="\${out}B=\${OPTARG};" ;;
      o) out="\${out}O=\${OPTARG};" ;;
      :) out="\${out}MISSING=\${OPTARG};" ;;
      \\?) out="\${out}UNKNOWN=\${OPTARG};" ;;
    esac
  done
  shift $((OPTIND - 1))
  printf '%sREST=%s\\n' "$out" "$*"
}

parse_cli -abhello -o world -z pos1 pos2
parse_cli -a -b
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "A;B=hello;O=world;UNKNOWN=z;REST=pos1 pos2\nA;MISSING=b;REST=\n",
      );
    });
  });

  it("2. getopts inside nested functions with local OPTIND preserves the outer caller cursor across interleaved parsing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
inner_parse() {
  local OPTIND=1 opt
  while getopts ":x:y" opt "$@"; do
    printf 'inner:%s=%s\\n' "$opt" "\${OPTARG:-}"
  done
}

outer_parse() {
  local OPTIND=1 opt
  while getopts ":f:v" opt "$@"; do
    printf 'outer:%s=%s\\n' "$opt" "\${OPTARG:-}"
    inner_parse -x sub -y
  done
  shift $((OPTIND - 1))
  printf 'outer-tail:%s\\n' "$*"
}

outer_parse -f config.toml -v -- target1 target2
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "outer:f=config.toml",
          "inner:x=sub",
          "inner:y=",
          "outer:v=",
          "inner:x=sub",
          "inner:y=",
          "outer-tail:target1 target2",
          "",
        ].join("\n"),
      );
    });
  });

  it("3. trap EXIT runs cleanup handlers on normal termination and explicit exit while preserving exit status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
(
  trap 'printf "cleanup-status=%d\\n" "$?"' EXIT
  printf "work-step-1\\n"
  exit 42
)
printf "subshell-exit=%d\\n" "$?"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "work-step-1\ncleanup-status=42\nsubshell-exit=42\n",
      );
    });
  });

  it("4. trap ERR and trap RETURN fire across functions and sourced scripts with set -E and set -T", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/lib.sh",
        "printf 'in-lib:%s\\n' \"$1\"\nreturn 0\n",
      );

      const res = await h.exec(
        `
set -T
trap 'printf "on-return\\n"' RETURN

helper() {
  printf "in-helper\\n"
  return 0
}

helper
source /workspace/lib.sh arg1
trap - RETURN
helper
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "in-helper",
          "on-return",
          "in-lib:arg1",
          "on-return",
          "in-helper",
          "",
        ].join("\n"),
      );
    });
  });

  it("5. trap DEBUG inspects BASH_COMMAND before simple commands and trap -p prints registered handlers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
log=()
trap 'log+=("$BASH_COMMAND")' DEBUG
x=10
y=$((x + 5))
trap - DEBUG
printf 'count=%d first=%s second=%s y=%d\\n' "\${#log[@]}" "\${log[0]}" "\${log[1]}" "$y"
trap 'echo bye' EXIT
trap -p EXIT
trap - EXIT
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /count=3 first=x=10 second=y=\$\(\(x \+ 5\)\) y=15/);
      assert.match(res.stdout, /trap -- 'echo bye' EXIT/);
    });
  });

  it("6. read splits fields via IFS, handles backslash line continuation vs -r raw mode, and populates REPLY by default", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
IFS=':' read a b rest <<< "alpha:beta:gamma:delta"
printf 'a=%s b=%s rest=%s\\n' "$a" "$b" "$rest"

read -r raw_line <<'IN_EOF'
path\\to\\file\\
second
IN_EOF
printf 'raw=%s\\n' "$raw_line"

read cooked_line <<'IN_EOF'
joined\\
_line
IN_EOF
printf 'cooked=%s\\n' "$cooked_line"

read <<< "  preserved_in_reply  "
printf 'reply=[%s]\\n' "$REPLY"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "a=alpha b=beta rest=gamma:delta",
          "raw=path\\to\\file\\",
          "cooked=joined_line",
          "reply=[  preserved_in_reply  ]",
          "",
        ].join("\n"),
      );
    });
  });

  it("7. read -a populates indexed arrays, read -d uses custom and NUL delimiters, and read -n / -N reads exact char counts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
IFS=',' read -r -a items <<< "rust,wasm,bash,vfs"
printf 'count=%d second=%s last=%s\\n' "\${#items[@]}" "\${items[1]}" "\${items[3]}"

printf 'rec1\\0rec2\\0' > /workspace/nul.bin
{
  IFS= read -r -d '' r1
  IFS= read -r -d '' r2
} < /workspace/nul.bin
printf 'r1=%s r2=%s\\n' "$r1" "$r2"

read -r -N 4 prefix <<< "abcdefgh"
printf 'prefix=%s\\n' "$prefix"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "count=4 second=wasm last=vfs",
          "r1=rec1 r2=rec2",
          "prefix=abcd",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. read -u reads from custom file descriptors opened with exec and closes cleanly", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/stream.txt", "first-line\nsecond-line\nthird-line\n");

      const res = await h.exec(
        `
{
  read -r -u 3 l1
  read -r -u 3 l2
} 3< /workspace/stream.txt
printf 'l1=%s l2=%s\\n' "$l1" "$l2"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "l1=first-line l2=second-line\n");
    });
  });

  it("9. mapfile and readarray support -t, -d custom delimiter, -s skip, -n count, and -O origin index", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/lines.txt", "zero\none\ntwo\nthree\nfour\n");

      const res = await h.exec(
        `
arr=("head")
mapfile -t -s 1 -n 3 -O 2 arr < /workspace/lines.txt
printf 'idx0=%s idx2=%s idx3=%s idx4=%s len=%d\\n' "\${arr[0]}" "\${arr[2]}" "\${arr[3]}" "\${arr[4]}" "\${#arr[@]}"

readarray -t -d ':' fields < <(printf 'k1:k2:k3:')
printf 'fields=%s|%s|%s\\n' "\${fields[0]}" "\${fields[1]}" "\${fields[2]}"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "idx0=head idx2=one idx3=two idx4=three len=4\nfields=k1|k2|k3\n",
      );
    });
  });

  it("10. mapfile -C callback -c quantum invokes shell callbacks with index and line during array loading", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
cb_log=()
on_chunk() {
  cb_log+=("$1:\${2%$'\\n'}")
}
mapfile -t -C on_chunk -c 2 items <<'IN_EOF'
alpha
beta
gamma
delta
IN_EOF
printf 'items=%s cb=%s\\n' "\${items[*]}" "\${cb_log[*]}"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "items=alpha beta gamma delta cb=1:beta 3:delta\n");
    });
  });

  it("11. printf supports numeric, hex, octal, float, char, %b escape, %q shell-quoting, padding flags, and format reuse", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
printf '|%-8s|%05d|%+d|%#x|%#o|%.2f|\\n' "tag" 42 7 255 64 3.14159
printf '%b\\n' 'line1\\tcol2\\x41'
printf 'item=%s\\n' one two three
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "|tag     |00042|+7|0xff|0100|3.14|",
          "line1\tcol2A",
          "item=one",
          "item=two",
          "item=three",
          "",
        ].join("\n"),
      );
    });
  });

  it("12. printf -v writes formatted strings directly into scalar variables and indexed/associative array elements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
printf -v greeting "Hello, %s (#%03d)!" "Ada" 7
declare -a slots
printf -v 'slots[2]' "slot-%02d" 2
declare -A meta
printf -v 'meta[version]' "v%d.%d.%d" 1 4 2
printf '%s | %s | %s\\n' "$greeting" "\${slots[2]}" "\${meta[version]}"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Hello, Ada (#007)! | slot-02 | v1.4.2\n");
    });
  });

  it("13. declare / typeset enforces -i integer arithmetic, -l lowercase, -u uppercase, -r readonly, and -x export attributes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
declare -i counter=10
counter+=5*3
declare -l lower_var="HeLLo_WoRLd"
declare -u upper_var="ruSt_sAfE_bAsH"
declare -r fixed_val="immutable"
printf 'counter=%d lower=%s upper=%s fixed=%s\\n' "$counter" "$lower_var" "$upper_var" "$fixed_val"
declare -p counter lower_var upper_var fixed_val
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /counter=25 lower=hello_world upper=RUST_SAFE_BASH fixed=immutable/);
      assert.match(res.stdout, /declare -i counter="25"/);
      assert.match(res.stdout, /declare -l lower_var="hello_world"/);
      assert.match(res.stdout, /declare -u upper_var="RUST_SAFE_BASH"/);
      assert.match(res.stdout, /declare -r fixed_val="immutable"/);
    });
  });

  it("14. declare -n nameref transparently reads and mutates target variables and unsets reference via unset -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
target_a="initial"
target_b="second"
declare -n ref=target_a
ref="mutated-via-ref"
printf 'target_a=%s ref=%s\\n' "$target_a" "$ref"

unset -n ref
ref="standalone"
printf 'after-unset-n: target_a=%s ref=%s\\n' "$target_a" "$ref"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "target_a=mutated-via-ref ref=mutated-via-ref\nafter-unset-n: target_a=mutated-via-ref ref=standalone\n",
      );
    });
  });

  it("15. declare -a and declare -A support compound assignments, += append, slices, keys, and pattern substitutions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
declare -a nums=(10 20 30)
nums+=(40 50)
printf 'slice=%s len=%d\\n' "\${nums[*]:1:3}" "\${#nums[@]}"

declare -A ports=([http]=80 [https]=443)
ports+=([ssh]=22)
printf 'http=%s https=%s ssh=%s count=%d\\n' "\${ports[http]}" "\${ports[https]}" "\${ports[ssh]}" "\${#ports[@]}"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "slice=20 30 40 len=5\nhttp=80 https=443 ssh=22 count=3\n",
      );
    });
  });

  it("16. local variables support recursive scoping and dynamic visibility in child functions without leaking to global state", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
n=999
fact() {
  local n=$1
  if (( n <= 1 )); then
    printf '1'
  else
    local sub
    sub=$(fact $((n - 1)))
    printf '%d' $((n * sub))
  fi
}
res_val=$(fact 5)
printf 'fact5=%s global_n=%d\\n' "$res_val" "$n"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "fact5=120 global_n=999\n");
    });
  });

  it("17. pushd, popd, and dirs manipulate the directory stack and synchronize DIRSTACK and PWD", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/dir_a", { recursive: true });
      await h.fs.mkdir("/workspace/dir_b", { recursive: true });
      await h.fs.mkdir("/workspace/dir_c", { recursive: true });

      const res = await h.exec(
        `
cd /workspace/dir_a
pushd /workspace/dir_b >/dev/null
pushd /workspace/dir_c >/dev/null
printf 'pwd1=%s stack_count=%d top=%s\\n' "$PWD" "\${#DIRSTACK[@]}" "\${DIRSTACK[0]}"
pushd +1 >/dev/null
printf 'after-rotate=%s\\n' "$PWD"
popd >/dev/null
printf 'after-pop=%s\\n' "$PWD"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "pwd1=/workspace/dir_c stack_count=3 top=/workspace/dir_c",
          "after-rotate=/workspace/dir_b",
          "after-pop=/workspace/dir_a",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. set, shift, and shopt toggle shell options (extglob, nullglob, dotglob, nocasematch) and positional parameters", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/.hidden", "dot");
      await h.writeText("/workspace/visible.txt", "vis");

      const res = await h.exec(
        `
set -- first second third fourth
shift 2
printf 'pos=%s|%s count=%d\\n' "$1" "$2" "$#"

shopt -s nullglob
empty_matches=(/workspace/*.nonexistent)
printf 'nullglob_count=%d\\n' "\${#empty_matches[@]}"

shopt -s nocasematch
if [[ "RuStLaNg" == rust* ]]; then
  printf 'nocasematch=matched\\n'
fi
shopt -u nocasematch
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "pos=third|fourth count=2\nnullglob_count=0\nnocasematch=matched\n",
      );
    });
  });

  it("19. command, builtin, type, and hash inspect and bypass function shadowing of builtins and external commands", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `
printf() {
  builtin printf '[wrapped] %s\\n' "$*"
}
printf "hello"
command printf 'direct:%s\\n' "world"
builtin printf 'type-printf=%s type-jq=%s\\n' "$(type -t printf)" "$(type -t jq)"
unset -f printf
printf 'after-unset=%s\\n' "$(type -t printf)"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "[wrapped] hello",
          "direct:world",
          "type-printf=function type-jq=file",
          "after-unset=builtin",
          "",
        ].join("\n"),
      );
    });
  });

  it("20. eval, source (.) with positional overrides, let arithmetic, and umask (-S / octal) interoperate cleanly", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/compute.sh",
        'let "result = $1 * $2 + 10"\nprintf "computed=%d\\n" "$result"\nreturn 0\n',
      );

      const res = await h.exec(
        `
set -- outer1 outer2
source /workspace/compute.sh 6 7
printf 'restored_pos=%s|%s\\n' "$1" "$2"

dyn_var="result"
eval "printf 'eval_deref=%d\\n' \\"\\$$dyn_var\\""

umask 0027
printf 'umask_octal=%s umask_sym=%s\\n' "$(umask)" "$(umask -S)"
`,
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "computed=52",
          "restored_pos=outer1|outer2",
          "eval_deref=52",
          "umask_octal=0027 umask_sym=u=rwx,g=rx,o=",
          "",
        ].join("\n"),
      );
    });
  });
});
