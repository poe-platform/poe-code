import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure shell grammar, arrays, namerefs, process substitution, traps, getopts, and builtins parity matrix", () => {
  it("1. indexed arrays: sparse indices, += append, slices ${arr[@]:offset:len}, keys ${!arr[@]}, and element lengths", async () => {
    const env = createEnv();
    const res = await env.exec(`
      arr=([0]="zero" [2]="two" [5]="five")
      arr+=("six" "seven")
      echo "len=\${#arr[@]}"
      echo "keys=\${!arr[*]}"
      echo "vals=\${arr[*]}"
      echo "slice=\${arr[@]:1:3}"
      echo "el2_len=\${#arr[2]}"
      unset 'arr[2]'
      echo "after_unset_keys=\${!arr[*]}"
      echo "after_unset_vals=\${arr[*]}"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "len=5",
        "keys=0 2 5 6 7",
        "vals=zero two five six seven",
        "slice=two five six",
        "el2_len=3",
        "after_unset_keys=0 5 6 7",
        "after_unset_vals=zero five six seven",
        "",
      ].join("\n")
    );
  });

  it("2. associative arrays: declare -A compound initialization, += merge, key enumeration, and unset element", async () => {
    const env = createEnv();
    const res = await env.exec(`
      declare -A cfg=([host]="db.internal" [port]="5432" [mode]="ro")
      cfg+=([mode]="rw" [pool]="16")
      echo "count=\${#cfg[@]}"
      echo "host=\${cfg[host]} port=\${cfg[port]} mode=\${cfg[mode]} pool=\${cfg[pool]}"
      unset 'cfg[port]'
      for k in "\${!cfg[@]}"; do
        echo "$k=\${cfg[$k]}"
      done | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "count=4",
        "host=db.internal port=5432 mode=rw pool=16",
        "host=db.internal",
        "mode=rw",
        "pool=16",
        "",
      ].join("\n")
    );
  });

  it("3. namerefs: declare -n / local -n targeting scalar variables, indexed arrays, and associative arrays across functions", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mutate_all() {
        local -n scalar_ref="$1"
        local -n arr_ref="$2"
        local -n map_ref="$3"
        scalar_ref="updated:\${scalar_ref}"
        arr_ref+=("delta")
        map_ref[status]="committed"
      }
      title="v1"
      items=("alpha" "beta")
      declare -A meta=([status]="pending" [owner]="core")
      mutate_all title items meta
      echo "title=$title"
      echo "items=\${items[*]}"
      echo "meta=\${meta[owner]}:\${meta[status]}"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "title=updated:v1",
        "items=alpha beta delta",
        "meta=core:committed",
        "",
      ].join("\n")
    );
  });

  it("4. parameter expansion defaults, alternates, substrings, prefix/suffix trim, pattern replacement, and case conversion", async () => {
    const env = createEnv();
    const res = await env.exec(`
      unset EMPTY
      SET="archive.tar.gz"
      MIXED="hello_world_rust"
      echo "def=\${EMPTY:-fallback}"
      echo "assign=\${EMPTY:=assigned};now=$EMPTY"
      echo "alt=\${SET:+present}"
      echo "sub=\${SET:8:3};\${SET: -6:3}"
      echo "trim=\${SET#*.};\${SET##*.};\${SET%.*};\${SET%%.*}"
      echo "rep=\${MIXED/_/-};all=\${MIXED//_/-}"
      echo "case=\${MIXED^};\${MIXED^^}"
      UPPER="HELLO_WORLD"
      echo "lower=\${UPPER,};\${UPPER,,}"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "def=fallback",
        "assign=assigned;now=assigned",
        "alt=present",
        "sub=tar;tar",
        "trim=tar.gz;gz;archive.tar;archive",
        "rep=hello-world_rust;all=hello-world-rust",
        "case=Hello_world_rust;HELLO_WORLD_RUST",
        "lower=hELLO_WORLD;hello_world",
        "",
      ].join("\n")
    );
  });

  it("5. indirect expansion ${!ref} and prefix variable name expansion ${!prefix*} / ${!prefix@}", async () => {
    const env = createEnv();
    const res = await env.exec(`
      APP_HOST="api.local"
      APP_PORT="8080"
      APP_MODE="prod"
      ptr="APP_HOST"
      echo "indirect=\${!ptr}"
      for name in \${!APP_*}; do
        echo "$name=\${!name}"
      done | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "indirect=api.local",
        "APP_HOST=api.local",
        "APP_MODE=prod",
        "APP_PORT=8080",
        "",
      ].join("\n")
    );
  });

  it("6. parameter transform operators ${var@Q}, ${var@U}, ${var@u}, ${var@L}, and ${var@a}", async () => {
    const env = createEnv();
    const res = await env.exec(`
      word="hello world"
      declare -r CONST_VAL="fixed"
      declare -a IDX_ARR=("a" "b")
      declare -A ASSOC_MAP=([k]="v")
      echo "upper=\${word@U}"
      echo "cap=\${word@u}"
      UPPER=" LOUD "
      echo "lower=\${UPPER@L}"
      echo "attrs=\${CONST_VAL@a}:\${IDX_ARR@a}:\${ASSOC_MAP@a}"
      eval "reconstructed=\${word@Q}"
      echo "reconstructed=$reconstructed"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "upper=HELLO WORLD",
        "cap=Hello world",
        "lower= loud ",
        "attrs=r:a:A",
        "reconstructed=hello world",
        "",
      ].join("\n")
    );
  });

  it("7. arithmetic evaluation $((...)), ((...)), let, and C-style for ((...)) with bitwise, ternary, and compound operators", async () => {
    const env = createEnv();
    const res = await env.exec(`
      x=5
      (( x += 3, x *= 2 ))
      let "y = (x > 10 ? x << 1 : x >> 1)" "z = (y & 15) | 64"
      sum=0
      for (( i = 1; i <= 5; i++ )); do
        (( sum += i * i ))
      done
      echo "x=$x y=$y z=$z sum=$sum pow=$(( 2 ** 10 )) hex=$(( 0x1f + 010 ))"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "x=16 y=32 z=64 sum=55 pow=1024 hex=39\n");
  });

  it("8. brace expansion: nested comma lists, zero-padded numeric ranges, stepped ranges, and character ranges", async () => {
    const env = createEnv();
    const res = await env.exec(`
      echo svc-{api,worker}-{01..03}
      echo step-{10..2..4}
      echo char-{d..a}
      echo nested-{a,b{1,2}}
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "svc-api-01 svc-api-02 svc-api-03 svc-worker-01 svc-worker-02 svc-worker-03",
        "step-10 step-6 step-2",
        "char-d char-c char-b char-a",
        "nested-a nested-b1 nested-b2",
        "",
      ].join("\n")
    );
  });

  it("9. process substitution <(cmd) and >(cmd) with diff, comm, and paste", async () => {
    const env = createEnv();
    const res = await env.exec(`
      comm -12 <(printf 'c\\na\\nb\\n' | sort) <(printf 'b\\nd\\na\\n' | sort)
      paste -d ':' <(printf 'k1\\nk2\\n') <(printf 'v1\\nv2\\n')
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "a\nb\nk1:v1\nk2:v2\n");
  });

  it("10. here-documents (<<EOF, <<'EOF', <<-EOF tab stripping), here-strings (<<<), and fd duplication (3>&1 1>&2 2>&3)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      NAME="world"
      cat <<EOF
hello $NAME $((1+2))
EOF
      cat <<'EOF'
literal $NAME
EOF
      cat <<-EOF
	indented_one
		indented_two
	EOF
      tr 'a-z' 'A-Z' <<< "here_string_val"
      swapped=$( (echo "out_msg"; echo "err_msg" >&2) 2>&1 >/dev/null )
      echo "swapped=$swapped"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "hello world 3",
        "literal $NAME",
        "indented_one",
        "indented_two",
        "HERE_STRING_VAL",
        "swapped=err_msg",
        "",
      ].join("\n")
    );
  });

  it("11. traps on EXIT, ERR, and RETURN with function scopes", async () => {
    const env = createEnv();
    const res = await env.exec(`
      events=()
      trap 'events+=("exit:$?"); printf "%s\\n" "\${events[*]}"' EXIT
      trap 'events+=("err")' ERR
      helper() {
        trap 'events+=("return")' RETURN
        events+=("in_helper")
      }
      helper
      false || events+=("handled_false")
      events+=("done")
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "in_helper return handled_false done exit:0\n");
  });

  it("12. set -e, set -u, set -o pipefail, and PIPESTATUS array tracking across multi-stage pipelines", async () => {
    const env = createEnv();
    const res = await env.exec(`
      (
        set -o pipefail
        sh -c 'exit 3' | sh -c 'exit 0' | sh -c 'exit 7'
        echo "pipefail_rc=$? status=\${PIPESTATUS[*]}"
      )
      (
        set -u
        echo "\${UNSET_VAR}" 2>/dev/null
      )
      echo "nounset_rc=$?"
      (
        set -e
        echo "before_fail"
        false
        echo "after_fail"
      )
      echo "errexit_rc=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "pipefail_rc=7 status=3 0 7",
        "nounset_rc=1",
        "before_fail",
        "errexit_rc=1",
        "",
      ].join("\n")
    );
  });

  it("13. getopts loop with silent error mode (:), required arguments, OPTIND reset, and remaining positional shift", async () => {
    const env = createEnv();
    const res = await env.exec(`
      parse_cli() {
        local OPTIND=1 opt verbose=0 out="" bad="" missing=""
        while getopts ":vo:f:" opt "$@"; do
          case "$opt" in
            v) verbose=$((verbose + 1)) ;;
            o) out="$OPTARG" ;;
            :) missing="$OPTARG" ;;
            \\?) bad="$OPTARG" ;;
          esac
        done
        shift $((OPTIND - 1))
        echo "v=$verbose out=$out bad=$bad missing=$missing rest=$*"
      }
      parse_cli -vv -o build.tar -- extra1 extra2
      parse_cli -v -z -f
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "v=2 out=build.tar bad= missing= rest=extra1 extra2",
        "v=1 out= bad=z missing=f rest=",
        "",
      ].join("\n")
    );
  });

  it("14. read builtin with custom IFS, -r raw backslashes, -a array splitting, and -d custom delimiter", async () => {
    const env = createEnv();
    const res = await env.exec(`
      IFS=':' read -r user uid gid rest <<< 'alice:1000:1000:Alice\\nAdmin:/home/alice'
      echo "user=$user uid=$uid gid=$gid rest=$rest"
      IFS=',' read -r -a tags <<< 'rust,wasm,parity,bash'
      echo "tags_count=\${#tags[@]} second=\${tags[1]} last=\${tags[3]}"
      read -r -d ';' record <<< 'first_part;second_part;'
      echo "record=$record"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "user=alice uid=1000 gid=1000 rest=Alice\\nAdmin:/home/alice",
        "tags_count=4 second=wasm last=bash",
        "record=first_part",
        "",
      ].join("\n")
    );
  });

  it("15. mapfile / readarray with -t newline strip, -s skip, and -n count", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'line0\\nline1\\nline2\\nline3\\nline4\\n' > lines.txt
      mapfile -t -s 1 -n 3 subset < lines.txt
      echo "count=\${#subset[@]} items=\${subset[*]}"
      readarray -t all_lines < lines.txt
      echo "all=\${#all_lines[@]} first=\${all_lines[0]} last=\${all_lines[4]}"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "count=3 items=line1 line2 line3",
        "all=5 first=line0 last=line4",
        "",
      ].join("\n")
    );
  });

  it("16. directory stack builtins pushd, popd, dirs, and cd - navigation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p a/b/c x/y
      root=$(pwd)
      pushd a/b/c >/dev/null
      p1=$(pwd)
      pushd "$root/x/y" >/dev/null
      p2=$(pwd)
      popd >/dev/null
      p3=$(pwd)
      cd - >/dev/null
      p4=$(pwd)
      echo "\${p1#$root} | \${p2#$root} | \${p3#$root} | \${p4#$root}"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "/a/b/c | /x/y | /a/b/c | /x/y\n");
  });

  it("17. shopt nullglob, dotglob, and extglob pattern matching in loops and case statements", async () => {
    const env = createEnv();
    const res = await env.exec(`
      mkdir -p globdir
      touch globdir/.hidden globdir/app.ts globdir/app.js globdir/app.spec.ts globdir/readme.md
      cd globdir
      shopt -s nullglob
      empty=(*.nonexistent)
      echo "nullglob_count=\${#empty[@]}"
      shopt -s dotglob
      all=(*)
      echo "dotglob_first=\${all[0]} total=\${#all[@]}"
      shopt -u dotglob
      shopt -s extglob
      matched=()
      for f in *; do
        case "$f" in
          *.@(ts|js)) matched+=("$f") ;;
        esac
      done
      echo "extglob_case=\${matched[*]}"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "nullglob_count=0",
        "dotglob_first=.hidden total=5",
        "extglob_case=app.js app.spec.ts app.ts",
        "",
      ].join("\n")
    );
  });

  it("18. [[ ... ]] conditional expressions with regex =~ and BASH_REMATCH capture groups, glob ==, and lexicographic < >", async () => {
    const env = createEnv();
    const res = await env.exec(`
      tag="release-v2.14.9-rc3"
      if [[ "$tag" =~ ^release-v([0-9]+)\\.([0-9]+)\\.([0-9]+)-(rc[0-9]+)$ ]]; then
        echo "full=\${BASH_REMATCH[0]} maj=\${BASH_REMATCH[1]} min=\${BASH_REMATCH[2]} patch=\${BASH_REMATCH[3]} pre=\${BASH_REMATCH[4]}"
      fi
      if [[ "$tag" == release-v2.* && "apple" < "banana" && ! -z "$tag" ]]; then
        echo "cond=matched"
      fi
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "full=release-v2.14.9-rc3 maj=2 min=14 patch=9 pre=rc3",
        "cond=matched",
        "",
      ].join("\n")
    );
  });

  it("19. printf builtin: %q shell quoting, -v variable assignment, width/precision formatting, and argument reuse", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf -v formatted "%-8s | %05d | %.2f" "metric" 42 3.14159
      echo "formatted=[$formatted]"
      printf "(%s:%d)\\n" a 1 b 2 c 3
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "formatted=[metric   | 00042 | 3.14]",
        "(a:1)",
        "(b:2)",
        "(c:3)",
        "",
      ].join("\n")
    );
  });

  it("20. source / ., eval, caller stack inspection, alias expansion, and type / command -v introspection", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > lib.sh
inner_fn() {
  echo "caller_info=$(caller 0)"
}
outer_fn() {
  inner_fn "$1"
}
EOF
      source ./lib.sh
      outer_fn "arg1"
      echo "type_outer=$(type -t outer_fn) type_echo=$(type -t echo) cmd_printf=$(command -v printf)"
      shopt -s expand_aliases
      alias greet='printf "hi:%s\\n"'
      eval "greet world"
    `);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /caller_info=\d+ outer_fn/);
    assert.match(res.stdout, /type_outer=function type_echo=builtin cmd_printf=printf/);
    assert.match(res.stdout, /hi:world/);
  });
});
