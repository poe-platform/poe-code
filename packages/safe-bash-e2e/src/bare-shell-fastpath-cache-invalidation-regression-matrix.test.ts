import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const BARE = { includeExtendedCommands: false, bareShell: true } as const;

describe("bare-shell fast-path execution and cache invalidation regression matrix", () => {
  it("1. bare-shell repeated file overwrites invalidate cat/wc/head/tail fast-path buffers across exec calls", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r1 = await h.exec(`
        printf 'line-1\nline-2\n' > /workspace/f.txt
        cat /workspace/f.txt
        wc -l < /workspace/f.txt
      `);
      assert.equal(r1.exitCode, 0, r1.stderr);
      assert.equal(r1.stdout.trim(), ["line-1", "line-2", "2"].join("\n"));

      const r2 = await h.exec(`
        printf 'alpha\nbeta\ngamma\ndelta\n' > /workspace/f.txt
        head -n 2 /workspace/f.txt
        tail -n 2 /workspace/f.txt
        wc -l < /workspace/f.txt
      `);
      assert.equal(r2.exitCode, 0, r2.stderr);
      assert.equal(r2.stdout.trim(), ["alpha", "beta", "gamma", "delta", "4"].join("\n"));
    });
  });

  it("2. bare-shell append redirection (>>) inside tight for-loop updates file size and content on every iteration", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        : > /workspace/log.txt
        for i in 1 2 3 4 5; do
          echo "entry-$i" >> /workspace/log.txt
          wc -l < /workspace/log.txt | tr -d ' '
        done
        cat /workspace/log.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "1",
          "2",
          "3",
          "4",
          "5",
          "entry-1",
          "entry-2",
          "entry-3",
          "entry-4",
          "entry-5",
        ].join("\n")
      );
    });
  });

  it("3. bare-shell fast arithmetic (( ... )) and $(( ... )) loop accumulation with bitshifts and ternary operators", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        acc=0
        for ((i = 1; i <= 20; i++)); do
          (( acc += (i & 1) ? (i << 1) : (i >> 1) ))
        done
        echo "acc=$acc"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "acc=255");
    });
  });

  it("4. bare-shell tryFastPredicate ([ and [[) across file existence mutations (mkdir, touch, rm, mv)", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        [ -e /workspace/item ] && echo "exists-0" || echo "missing-0"
        mkdir -p /workspace/dir
        [ -d /workspace/dir ] && echo "is-dir"
        printf 'non-empty' > /workspace/item
        [ -f /workspace/item ] && [ -s /workspace/item ] && echo "file-nonempty"
        : > /workspace/item
        [ -s /workspace/item ] && echo "still-nonempty" || echo "now-empty"
        rm /workspace/item
        [ ! -e /workspace/item ] && echo "removed-ok"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["missing-0", "is-dir", "file-nonempty", "now-empty", "removed-ok"].join("\n")
      );
    });
  });

  it("5. bare-shell tryFastPrintf formatting (%s, %d, %05d, %x, %X, %.2f, %b) in direct and captured contexts", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        printf '%s:%05d:%x:%X\n' "id" 42 255 255
        out=$(printf 'hex=%04x,dec=%d' 4095 -17)
        echo "$out"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["id:00042:ff:FF", "hex=0fff,dec=-17"].join("\n")
      );
    });
  });

  it("6. bare-shell parameter expansion fast-paths (${#v}, ${v#p}, ${v##p}, ${v%s}, ${v%%s}, ${v/p/r}, ${v//p/r})", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        path="/workspace/src/module/index.test.ts"
        echo "len=\${#path}"
        echo "base=\${path##*/}"
        echo "dir=\${path%/*}"
        echo "stem=\${path%%.*}"
        echo "first=\${path/module/core}"
        echo "all=\${path//\\//_}"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "len=35",
          "base=index.test.ts",
          "dir=/workspace/src/module",
          "stem=/workspace/src/module/index",
          "first=/workspace/src/core/index.test.ts",
          "all=_workspace_src_module_index.test.ts",
        ].join("\n")
      );
    });
  });

  it("7. bare-shell function redefinition inside loop invalidates any cached function body dispatch", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        compute() { echo "v1:$1"; }
        compute alpha
        compute() { echo "v2:$(($1 * 10))"; }
        compute 7
        compute() { echo "v3:\${1^^}"; }
        compute hello
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["v1:alpha", "v2:70", "v3:HELLO"].join("\n"));
    });
  });

  it("8. bare-shell local variable shadowing and dynamic scoping across recursive shell functions", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        x="global"
        outer() {
          local x="outer"
          inner
          echo "after-inner:$x"
        }
        inner() {
          echo "in-inner-before:$x"
          local x="inner"
          echo "in-inner-after:$x"
        }
        outer
        echo "after-outer:$x"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "in-inner-before:outer",
          "in-inner-after:inner",
          "after-inner:outer",
          "after-outer:global",
        ].join("\n")
      );
    });
  });

  it("9. bare-shell pure pipeline stages: cat | tr | sort | uniq -c | sort -nr | head", async () => {
    await withE2EHarness(BARE, async (h) => {
      await h.writeText(
        "/workspace/words.txt",
        "rust\nbash\nrust\nawk\nbash\nrust\nsed\n"
      );
      const r = await h.exec(`
        cat /workspace/words.txt | tr 'a-z' 'A-Z' | sort | uniq -c | sort -nr | awk '{print $1 ":" $2}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["3:RUST", "2:BASH", "1:SED", "1:AWK"].join("\n")
      );
    });
  });

  it("10. bare-shell sed and awk in-pipeline transformations after VFS file modification", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        printf 'k1=10\nk2=20\n' > /workspace/cfg.ini
        sed 's/=/:/' /workspace/cfg.ini | awk -F: '{sum += $2} END {print "sum1=" sum}'

        printf 'k1=100\nk2=250\nk3=50\n' > /workspace/cfg.ini
        sed 's/=/:/' /workspace/cfg.ini | awk -F: '{sum += $2} END {print "sum2=" sum}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["sum1=30", "sum2=400"].join("\n"));
    });
  });

  it("11. bare-shell glob expansion (*, ?, [...]) reflects newly created and deleted files between commands", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/globdir
        cd /workspace/globdir
        touch a.log b.log c.txt
        echo *.log
        touch d.log
        rm a.log
        echo *.log
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["a.log b.log", "b.log d.log"].join("\n"));
    });
  });

  it("12. bare-shell case statement pattern matching with character classes and alternation inside loops", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        for tok in 42 hello _priv 99bottles "--flag"; do
          case "$tok" in
            [0-9]*)
              case "$tok" in
                *[a-zA-Z]*) echo "$tok:alnum" ;;
                *) echo "$tok:num" ;;
              esac
              ;;
            --*) echo "$tok:opt" ;;
            _*) echo "$tok:internal" ;;
            *) echo "$tok:ident" ;;
          esac
        done
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "42:num",
          "hello:ident",
          "_priv:internal",
          "99bottles:alnum",
          "--flag:opt",
        ].join("\n")
      );
    });
  });

  it("13. bare-shell subshell (...) vs brace group { ...; } variable, cwd, and umask isolation", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/sub1 /workspace/sub2
        v="root"
        (
          cd /workspace/sub1
          v="subshell"
          echo "in-sub:$(pwd):$v"
        )
        echo "after-sub:$(pwd):$v"
        {
          cd /workspace/sub2
          v="group"
        }
        echo "after-grp:$(pwd):$v"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "in-sub:/workspace/sub1:subshell",
          "after-sub:/workspace:root",
          "after-grp:/workspace/sub2:group",
        ].join("\n")
      );
    });
  });

  it("14. bare-shell while read loop with custom IFS splitting fields and preserving trailing rest column", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        cat <<'DATA' > /workspace/records.txt
alice:admin:read:write:delete
bob:viewer:read:only
carol:editor:read:write
DATA
        while IFS=: read -r user role perms; do
          echo "user=$user role=$role perms=[$perms]"
        done < /workspace/records.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "user=alice role=admin perms=[read:write:delete]",
          "user=bob role=viewer perms=[read:only]",
          "user=carol role=editor perms=[read:write]",
        ].join("\n")
      );
    });
  });

  it("15. bare-shell getopts option parsing across multiple function invocations resetting OPTIND", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        parse_args() {
          local OPTIND=1 opt mode="default" count="0"
          while getopts "m:c:v" opt; do
            case "$opt" in
              m) mode="$OPTARG" ;;
              c) count="$OPTARG" ;;
              v) mode="$mode+verbose" ;;
            esac
          done
          shift $((OPTIND - 1))
          echo "mode=$mode count=$count rest=$*"
        }
        parse_args -m fast -v -c 5 file1 file2
        parse_args -c 12 -m safe target.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "mode=fast+verbose count=5 rest=file1 file2",
          "mode=safe count=12 rest=target.txt",
        ].join("\n")
      );
    });
  });

  it("16. bare-shell xargs batching (-n) and replacement (-I) over find results after directory tree updates", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/items
        printf '10\n' > /workspace/items/a.num
        printf '20\n' > /workspace/items/b.num
        find /workspace/items -name '*.num' | sort | xargs cat | awk '{s+=$1} END {print "s1=" s}'

        printf '30\n' > /workspace/items/c.num
        rm /workspace/items/a.num
        find /workspace/items -name '*.num' | sort | xargs cat | awk '{s+=$1} END {print "s2=" s}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["s1=30", "s2=50"].join("\n"));
    });
  });

  it("17. bare-shell cut, paste, join, and comm pipeline in bare mode", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        printf '1:alice\n2:bob\n3:carol\n' > /workspace/names.txt
        printf '1:95\n2:88\n3:91\n' > /workspace/scores.txt
        join -t : /workspace/names.txt /workspace/scores.txt | cut -d: -f2,3
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["alice:95", "bob:88", "carol:91"].join("\n")
      );
    });
  });

  it("18. bare-shell jq JSON transformation and filtering across multi-command shell script", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        printf '{"items":[{"k":"a","v":1},{"k":"b","v":2},{"k":"c","v":3}]}\n' > /workspace/data.json
        jq -c '.items | map(select(.v >= 2)) | map({(.k): (.v * 10)}) | add' /workspace/data.json
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), '{"b":20,"c":30}');
    });
  });

  it("19. bare-shell fdSwap and file descriptor duplication (3>&1 1>&2 2>&3) capturing stderr while passing stdout", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        emit_both() {
          echo "on-stdout"
          echo "on-stderr" >&2
        }
        captured_err=$(emit_both 3>&1 1>&2 2>&3 1>/workspace/out.txt)
        echo "err=[$captured_err]"
        echo "out=[$(cat /workspace/out.txt)]"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["err=[on-stderr]", "out=[on-stdout]"].join("\n")
      );
    });
  });

  it("20. bare-shell hot-loop command substitution and variable mutation across 50 iterations", async () => {
    await withE2EHarness(BARE, async (h) => {
      const r = await h.exec(`
        total=0
        for ((i = 1; i <= 50; i++)); do
          val=$(printf '%d' "$i")
          total=$((total + val))
        done
        echo "total=$total"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "total=1275");
    });
  });
});
