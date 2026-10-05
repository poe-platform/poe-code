import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: shell parser, expansion, quoting, heredoc & redirection torture matrix", () => {
  it("1. parameter expansion defaults and conditionals (:-, -, :=, =, :+, +)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        unset u
        e=""
        s="val"
        printf "u_colon_minus=%s u_minus=%s\\n" "\${u:-def}" "\${u-def}"
        printf "e_colon_minus=%s e_minus=%s\\n" "\${e:-def}" "\${e-def}"
        printf "u_colon_plus=%s e_colon_plus=%s e_plus=%s s_colon_plus=%s\\n" "\${u:+alt}" "\${e:+alt}" "\${e+alt}" "\${s:+alt}"
        printf "assign=%s after=%s\\n" "\${e:=assigned}" "$e"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "u_colon_minus=def u_minus=def",
        "e_colon_minus=def e_minus=",
        "u_colon_plus= e_colon_plus= e_plus=alt s_colon_plus=alt",
        "assign=assigned after=assigned",
      ]);
    });
  });

  it("2. parameter expansion prefix/suffix stripping (#, ##, %, %%) with globs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        p="/usr/local/share/archive.tar.gz"
        printf "short_pre=%s\\n" "\${p#*/}"
        printf "long_pre=%s\\n" "\${p##*/}"
        printf "short_suf=%s\\n" "\${p%.*}"
        printf "long_suf=%s\\n" "\${p%%.*}"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "short_pre=usr/local/share/archive.tar.gz",
        "long_pre=archive.tar.gz",
        "short_suf=/usr/local/share/archive.tar",
        "long_suf=/usr/local/share/archive",
      ]);
    });
  });

  it("3. parameter expansion pattern replacement (/pat/rep, //pat/rep, /#pat/rep, /%pat/rep)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        v="foo-bar-foo-baz-foo"
        printf "first=%s\\n" "\${v/foo/X}"
        printf "all=%s\\n" "\${v//foo/X}"
        printf "anchor_start=%s\\n" "\${v/#foo/START}"
        printf "anchor_end=%s\\n" "\${v/%foo/END}"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "first=X-bar-foo-baz-foo",
        "all=X-bar-X-baz-X",
        "anchor_start=START-bar-foo-baz-foo",
        "anchor_end=foo-bar-foo-baz-END",
      ]);
    });
  });

  it("4. parameter expansion substring slicing (:off, :off:len, negative offsets) and length (#)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        s="abcdefghij"
        printf "len=%d sub1=%s sub2=%s neg1=%s neg2=%s\\n" "\${#s}" "\${s:3}" "\${s:2:4}" "\${s: -4}" "\${s: -6:3}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "len=10 sub1=defghij sub2=cdef neg1=ghij neg2=efg");
    });
  });

  it("5. parameter expansion case conversion (^, ^^, ,, ,,) and indirect expansion (!ref)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        w="hElLo WoRlD"
        target_var="SECRET_VALUE"
        ptr="target_var"
        printf "up1=%s upAll=%s low1=%s lowAll=%s indirect=%s\\n" "\${w^}" "\${w^^}" "\${w,}" "\${w,,}" "\${!ptr}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "up1=HElLo WoRlD upAll=HELLO WORLD low1=hElLo WoRlD lowAll=hello world indirect=SECRET_VALUE",
      );
    });
  });

  it("6. brace expansion combinations, nested braces, numeric steps, zero-padding, and char ranges", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "nested=%s\\n" "{a,{b,c}d,e}"
        echo "seq:" {01..05}
        echo "step:" {1..9..2}
        echo "rev:" {d..a}
        echo "nested:" pre-{x,{y,z}}-post
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "nested={a,{b,c}d,e}",
        "seq: 01 02 03 04 05",
        "step: 1 3 5 7 9",
        "rev: d c b a",
        "nested: pre-x-post pre-y-post pre-z-post",
      ]);
    });
  });

  it("7. arithmetic expansion $((...)) with bitwise, ternary, comma, ++/--, and radix literals", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        a=5
        b=3
        c=$(( (a << 2) | (b & 1) ))
        d=$(( a > b ? a * 10 : b * 10 ))
        e=$(( ++a, b += 4, a + b ))
        rad=$(( 16#ff + 8#10 + 2#101 ))
        printf "c=%d d=%d e=%d a=%d b=%d rad=%d\\n" "$c" "$d" "$e" "$a" "$b" "$rad"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "c=21 d=50 e=13 a=6 b=7 rad=268");
    });
  });

  it("8. nested command substitutions $( ... $( ... ) ) with inner quoting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        out="$(printf 'outer(%s)' "$(printf 'inner(%s)' "$(echo "deep space" | tr ' ' '_')")")"
        echo "$out"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "outer(inner(deep_space))");
    });
  });

  it("9. heredocs (<<EOF, <<'EOF', <<-EOF tab stripping, and multiple heredocs)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "X=expanded",
          "cat <<EOF",
          "val=$X",
          "EOF",
          "cat <<'EOF'",
          "raw=$X",
          "EOF",
          "cat <<-EOF",
          "\tindented=$X",
          "\tEOF",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "val=expanded",
        "raw=$X",
        "indented=expanded",
      ]);
    });
  });

  it("10. here-strings (<<<) into read, tr, and jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        IFS=: read -r u p <<< "alice:secret"
        upper="$(tr 'a-z' 'A-Z' <<< "$u")"
        json="$(jq -c '.x + 1' <<< '{"x":41}')"
        printf "u=%s p=%s upper=%s json=%s\\n" "$u" "$p" "$upper" "$json"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "u=alice p=secret upper=ALICE json=42");
    });
  });

  it("11. file descriptor redirections and stdout/stderr swap (3>&1 1>&2 2>&3)", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(`mkdir -p /work`);
      const emitBoth = `sh_both() { echo "OUT_MSG"; echo "ERR_MSG" >&2; }`;
      const swapped = await h.exec(`
        ${emitBoth}
        sh_both 3>&1 1>&2 2>&3
      `);
      assert.equal(swapped.exitCode, 0);
      assert.equal(swapped.stdout.trim(), "ERR_MSG");
      assert.equal(swapped.stderr.trim(), "OUT_MSG");

      const combined = await h.exec(`
        ${emitBoth}
        sh_both &> /work/both.log
        cat /work/both.log
      `);
      assert.equal(combined.exitCode, 0);
      assert.deepEqual(combined.stdout.trim().split("\n"), ["OUT_MSG", "ERR_MSG"]);
    });
  });

  it("12. compound group custom file descriptors ({ ...; } 3>file 4>file, >&3, >&4, 3>&-)", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(`mkdir -p /work`);
      const res = await h.exec(`
        {
          echo "fd3-one" >&3
          echo "fd4-one" >&4
          echo "fd3-two" >&3
        } 3> /work/fd3.log 4> /work/fd4.log
        cat /work/fd3.log /work/fd4.log
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), ["fd3-one", "fd3-two", "fd4-one"]);
    });
  });

  it("13. indexed arrays (creation, +=, slicing, indices !arr[@], unset element)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        arr=(alpha beta gamma)
        arr+=(delta epsilon)
        unset 'arr[1]'
        printf "count=%d\\n" "\${#arr[@]}"
        printf "keys=%s\\n" "\${!arr[*]}"
        printf "slice=%s\\n" "\${arr[*]:1:2}"
        printf "all=%s\\n" "\${arr[*]}"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "count=4",
        "keys=0 2 3 4",
        "slice=gamma delta",
        "all=alpha gamma delta epsilon",
      ]);
    });
  });

  it("14. associative arrays (declare -A, key assignment, lookup, and count)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -A meta
        meta[host]="db.internal"
        meta[port]="5432"
        meta[role]="primary"
        unset 'meta[role]'
        printf "count=%d host=%s port=%s role=%s\\n" "\${#meta[@]}" "\${meta[host]}" "\${meta[port]}" "\${meta[role]:-none}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "count=2 host=db.internal port=5432 role=none");
    });
  });

  it("15. IFS word splitting, read -r -a, and $* vs $@ in double quotes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -- "one two" "three" "four five"
        IFS='|'
        star="$*"
        IFS=$'\\n'
        printf "star=%s\\n" "$star"
        for item in "$@"; do
          printf "arg=<%s>\\n" "$item"
        done
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "star=one two|three|four five",
        "arg=<one two>",
        "arg=<three>",
        "arg=<four five>",
      ]);
    });
  });

  it("16. functions, local variable dynamic scoping, shift, and return codes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        x="global"
        inner() {
          printf "inner_sees=%s\\n" "$x"
          x="mutated_by_inner"
        }
        outer() {
          local x="local_outer"
          inner
          printf "outer_after_inner=%s\\n" "$x"
          shift
          printf "shifted_arg1=%s count=%d\\n" "$1" "$#"
          return 7
        }
        outer first second third
        rc=$?
        printf "global_after=%s rc=%d\\n" "$x" "$rc"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "inner_sees=local_outer",
        "outer_after_inner=mutated_by_inner",
        "shifted_arg1=second count=2",
        "global_after=global rc=7",
      ]);
    });
  });

  it("17. subshell (...) vs brace group { ...; } state and working-directory isolation", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(`mkdir -p /work/sub`);
      const res = await h.exec(`
        cd /work
        v="init"
        ( cd /work/sub && v="subshell" && printf "in_sub=%s:%s\\n" "$(pwd)" "$v" )
        printf "after_sub=%s:%s\\n" "$(pwd)" "$v"
        { cd /work/sub; v="brace"; }
        printf "after_brace=%s:%s\\n" "$(pwd)" "$v"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "in_sub=/work/sub:subshell",
        "after_sub=/work:init",
        "after_brace=/work/sub:brace",
      ]);
    });
  });

  it("18. case statement with alternation, glob classes, and fallthrough (;& and ;;&)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        classify() {
          local out=""
          case "$1" in
            [0-9][0-9])
              out="\${out}two_digit," ;;&
            *5)
              out="\${out}ends_five," ;&
            alpha|beta)
              out="\${out}after_fallthrough" ;;
            *)
              out="other" ;;
          esac
          echo "$out"
        }
        classify 25
        classify alpha
        classify zzz
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "two_digit,ends_five,after_fallthrough",
        "after_fallthrough",
        "other",
      ]);
    });
  });

  it("19. trap EXIT handler cleanup ordering and exit status preservation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        (
          trap 'echo "CLEANUP_RAN:$?"' EXIT
          echo "BODY_START"
          exit 42
        )
        echo "SUBSHELL_RC:$?"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "BODY_START",
        "CLEANUP_RAN:42",
        "SUBSHELL_RC:42",
      ]);
    });
  });

  it("20. ANSI-C quoting $'...', mixed quote concatenation, and shopt nullglob/dotglob", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(`mkdir -p /work/glob && touch /work/glob/.hidden /work/glob/visible.txt`);
      const res = await h.exec(`
        cd /work/glob
        s='single_'"double_"$'\\x41\\x42'
        printf "quoted=%s\\n" "$s"
        shopt -s nullglob
        none=(*.nomatch)
        printf "nullglob_count=%d\\n" "\${#none[@]}"
        shopt -s dotglob
        all=(*)
        printf "dotglob=%s\\n" "$(printf '%s\\n' "\${all[@]}" | sort | paste -sd, -)"
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "quoted=single_double_AB",
        "nullglob_count=0",
        "dotglob=.hidden,visible.txt",
      ]);
    });
  });
});
