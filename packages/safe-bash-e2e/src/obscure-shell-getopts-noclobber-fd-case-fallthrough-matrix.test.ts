import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell getopts, noclobber, fd redirection, case fallthrough, and coreutils matrix", () => {
  it("1. case statement fallthrough with ;& (unconditional) and ;;& (continue pattern matching)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        out=""
        case "ab" in
          a*) out="\${out}1:" ;&
          z*) out="\${out}2:" ;;
          *)  out="\${out}3:" ;;
        esac
        case "ab" in
          a*) out="\${out}A:" ;;&
          z*) out="\${out}Z:" ;;&
          *b) out="\${out}B:" ;;
        esac
        printf '%s\\n' "$out"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:2:A:B:\n");
    });
  });

  it("2. getopts silent mode (:a:bc) handling OPTARG, OPTIND, missing arguments (:), and unknown options (?)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        parse_opts() {
          local OPTIND=1 opt
          while getopts ":a:bc" opt "$@"; do
            case "$opt" in
              a) printf 'a=%s\\n' "$OPTARG" ;;
              b) printf 'b\\n' ;;
              c) printf 'c\\n' ;;
              :) printf 'missing=%s\\n' "$OPTARG" ;;
              \\?) printf 'unknown=%s\\n' "$OPTARG" ;;
            esac
          done
          shift $((OPTIND - 1))
          printf 'rest=%s\\n' "$*"
        }
        parse_opts -b -a hello -x -a -- pos1 pos2
        parse_opts -a
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "b\na=hello\nunknown=x\na=--\\nrest=pos1 pos2\n".replace("\\n", "\n") +
          "missing=a\nrest=\n",
      );
    });
  });

  it("3. set -C (noclobber) blocks > on existing file while allowing >| force clobber and >> append", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -C
        echo "first" > /workspace/nc.txt
        if (echo "second" > /workspace/nc.txt) 2>/dev/null; then
          echo "UNEXPECTED_CLOBBER"
        else
          echo "BLOCKED_OK"
        fi
        echo "appended" >> /workspace/nc.txt
        cat /workspace/nc.txt
        echo "forced" >| /workspace/nc.txt
        cat /workspace/nc.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "BLOCKED_OK\nfirst\nappended\nforced\n");
    });
  });

  it("4. exec file descriptor allocation (3>file), writing >&3, duplication 4>&3, and closing 3>&-", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        exec 3>/workspace/fd_out.txt
        echo "line-via-fd3" >&3
        exec 4>&3
        echo "line-via-fd4" >&4
        exec 3>&-
        exec 4>&-
        cat /workspace/fd_out.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "line-via-fd3\nline-via-fd4\n");
    });
  });

  it("5. dynamic scoping of local variables across nested function call chains", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        v="global"
        inner() {
          printf 'inner_before=%s\\n' "$v"
          v="mutated_by_inner"
        }
        outer() {
          local v="local_in_outer"
          inner
          printf 'outer_after=%s\\n' "$v"
        }
        outer
        printf 'global_after=%s\\n' "$v"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "inner_before=local_in_outer\nouter_after=mutated_by_inner\nglobal_after=global\n",
      );
    });
  });

  it("6. source (.) with positional arguments overrides $@ inside sourced file and restores caller $@", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/helper.sh",
        'printf "sourced:%d:%s\\n" "$#" "$*"\nreturn 7\n',
      );
      const r = await h.exec(`
        set -- caller1 caller2
        source /workspace/helper.sh subA subB subC
        rc=$?
        printf 'caller:%d:%s:rc=%d\\n' "$#" "$*" "$rc"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "sourced:3:subA subB subC\ncaller:2:caller1 caller2:rc=7\n",
      );
    });
  });

  it("7. pushd, popd, and dirs directory stack navigation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/d1 /workspace/d2
        cd /workspace
        pushd /workspace/d1 >/dev/null
        pwd
        pushd /workspace/d2 >/dev/null
        pwd
        popd >/dev/null
        pwd
        popd >/dev/null
        pwd
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "/workspace/d1\n/workspace/d2\n/workspace/d1\n/workspace\n",
      );
    });
  });

  it("8. [[ =~ ]] regex capture groups in BASH_REMATCH array", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        tag="release-2026-v34"
        if [[ $tag =~ ^([a-z]+)-([0-9]{4})-v([0-9]+)$ ]]; then
          printf 'full=%s p1=%s p2=%s p3=%s count=%d\\n' \\
            "\${BASH_REMATCH[0]}" "\${BASH_REMATCH[1]}" "\${BASH_REMATCH[2]}" "\${BASH_REMATCH[3]}" "\${#BASH_REMATCH[@]}"
        fi
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "full=release-2026-v34 p1=release p2=2026 p3=34 count=4\n",
      );
    });
  });

  it("9. C-style for ((i=1, j=10; ...)) multi-variable loop with multi-level break 2 and continue 2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        for ((i=1, j=10; i<=3; i++, j-=3)); do
          printf '%d:%d\\n' "$i" "$j"
        done
        for a in 1 2 3; do
          for b in x y z; do
            if [ "$a" = 1 ] && [ "$b" = y ]; then
              continue 2
            fi
            if [ "$a" = 3 ] && [ "$b" = y ]; then
              break 2
            fi
            printf '%s%s ' "$a" "$b"
          done
        done
        echo ""
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:10\n2:7\n3:4\n1x 2x 2y 2z 3x \n");
    });
  });

  it("10. |& pipe operator combining stdout and stderr into downstream command", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        { echo "from_stdout"; echo "from_stderr" >&2; } |& sort
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "from_stderr\nfrom_stdout\n");
    });
  });

  it("11. csplit splitting input by regex pattern with {*} repeat and custom prefix/digits", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/chapters.txt",
        "Intro\n===CH===\nChapter 1\nLine A\n===CH===\nChapter 2\nLine B\n",
      );
      const r = await h.exec(`
        csplit -s -f /workspace/sec_ -n 2 /workspace/chapters.txt '/^===CH===$/' '{*}'
        head -n 1 /workspace/sec_00 /workspace/sec_01 /workspace/sec_02
      `);
      assert.equal(r.exitCode, 0);
      assert.match(r.stdout, /Intro/);
      assert.match(r.stdout, /===CH===/);
    });
  });

  it("12. tsort topological ordering of DAG edges", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'compile link\\nparse compile\\nlex parse\\nlink package\\n' | tsort
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "lex\nparse\ncompile\nlink\npackage\n");
    });
  });

  it("13. factor prime factorization and expr regex capture and arithmetic", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        factor 360
        expr "item-4096-ok" : 'item-\\([0-9]*\\)-ok'
        expr 14 \\* 3 + 8
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "360: 2 2 2 3 3 5\n4096\n50\n");
    });
  });

  it("14. numfmt --to=iec, --to=si, and --from=iec formatting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        numfmt --to=iec 1048576
        numfmt --to=si 1000000
        numfmt --from=iec 2K
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1.0M\n1.0M\n2048\n");
    });
  });

  it("15. xxd -p hex encoding, xxd -r -p binary decoding, and base32 roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'SafeBash!' | xxd -p | tr -d '\\n'
        echo ""
        printf '536166654261736821' | xxd -r -p
        echo ""
        printf 'hello-b32' | base32 | base32 -d
        echo ""
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "536166654261736821\nSafeBash!\nhello-b32\n");
    });
  });

  it("16. fold -s -w word-boundary wrapping and fmt -w paragraph reflow", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'alpha beta gamma delta\\n' | fold -s -w 11
        echo "---"
        printf 'one\\ntwo\\nthree\\nfour\\n' | fmt -w 20
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "alpha beta \ngamma delta\n---\none two three four\n",
      );
    });
  });

  it("17. nl line numbering with -ba, -bt, -n rz, -w, and -s", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'first\\n\\nsecond\\n' | nl -bt -n rz -w 3 -s ': '
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "001: first\n     \n002: second\n");
    });
  });

  it("18. split -l 2 -d numeric chunk splitting and cat reassembly", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/lines.txt", "L1\nL2\nL3\nL4\nL5\n");
      const r = await h.exec(`
        split -l 2 -d /workspace/lines.txt /workspace/part_
        wc -l < /workspace/part_00 | tr -d ' '
        wc -l < /workspace/part_01 | tr -d ' '
        wc -l < /workspace/part_02 | tr -d ' '
        cat /workspace/part_00 /workspace/part_01 /workspace/part_02
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2\n2\n1\nL1\nL2\nL3\nL4\nL5\n");
    });
  });

  it("19. column -t -s aligned tabular formatting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'id|user|role\\n1|alice|admin\\n20|bob|viewer\\n' | column -t -s '|'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "id  user   role\n1   alice  admin\n20  bob    viewer\n",
      );
    });
  });

  it("20. bc ibase/obase/scale base conversion and user-defined function recursion", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'obase=2; ibase=16; FF\\n' | bc
        printf 'scale=4; 22 / 7\\n' | bc
        printf 'define f(n) { if (n <= 1) return 1; return n * f(n - 1); } f(6)\\n' | bc
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "11111111\n3.1428\n720\n");
    });
  });
});
