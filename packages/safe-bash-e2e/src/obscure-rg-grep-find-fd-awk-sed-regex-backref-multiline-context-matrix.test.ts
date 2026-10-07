import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure rg, grep, find, fd, awk & sed regex, backreference, context & multi-line state-machine matrix", () => {
  it("1. rg -n -B 1 -A 1 context lines with non-contiguous group separator (--)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/ctx.log
line1
line2
MATCH_ONE
line4
line5
line6
MATCH_TWO
line8
EOF
        rg -n -B 1 -A 1 "MATCH_" /workspace/ctx.log
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "2-line2",
          "3:MATCH_ONE",
          "4-line4",
          "--",
          "6-line6",
          "7:MATCH_TWO",
          "8-line8",
        ].join("\n"),
      );
    });
  });

  it("2. rg -r replacement mixing named capture groups (?P<name>...) and numbered captures ($3)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "user=ada_lovelace role=admin\\nuser=grace_hopper role=lead\\n" > /workspace/users.txt
        rg "user=(?P<first>[a-z]+)_(?P<last>[a-z]+) role=([a-z]+)" -r '\${last}, \${first} [$3]' /workspace/users.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["lovelace, ada [admin]", "hopper, grace [lead]"].join("\n"),
      );
    });
  });

  it("3. rg -F fixed strings combined with -w word-boundary and -x full-line matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/pat.txt
a+b*c
prefix a+b*c suffix
a+b*c_extra
EOF
        c_f=$(rg -F -c "a+b*c" /workspace/pat.txt)
        c_fw=$(rg -F -w -c "a+b*c" /workspace/pat.txt)
        c_fx=$(rg -F -x -c "a+b*c" /workspace/pat.txt)
        echo "$c_f:$c_fw:$c_fx"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "3:2:1");
    });
  });

  it("4. rg -l with positive and negative -g glob filters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/rgt/src /workspace/rgt/test
        echo "const K = 1;" > /workspace/rgt/src/app.ts
        echo "const K = 2;" > /workspace/rgt/test/app.test.ts
        echo "const K = 3;" > /workspace/rgt/src/readme.md
        rg -l -g "*.ts" -g "!*.test.ts" "const K" /workspace/rgt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "/workspace/rgt/src/app.ts");
    });
  });

  it("5. grep -Eo only-matching, -v invert-match, -c count, and -in case-insensitive line numbering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/g.txt
err:404 not found
ok:200 success
err:503 unavailable
warn:429 rate limit
EOF
        o1=$(grep -Eo "[0-9]{3}" /workspace/g.txt | paste -sd "," -)
        o2=$(grep -v "^ok:" /workspace/g.txt | grep -c ":")
        o3=$(grep -in "^WARN:" /workspace/g.txt)
        echo "$o1|$o2|$o3"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "404,200,503,429|3|4:warn:429 rate limit");
    });
  });

  it("6. grep -F -f pattern file, multiple -e patterns, and -l / -L file matching modes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/gl
        printf "alpha\\nbeta\\ngamma\\ndelta\\nepsilon\\n" > /workspace/gl/items.txt
        printf "beta\\ndelta\\n" > /workspace/gl/pats.txt
        grep -F -f /workspace/gl/pats.txt /workspace/gl/items.txt | paste -sd "," -
        grep -e "^a" -e "^e" /workspace/gl/items.txt | paste -sd "," -
        grep -L "beta" /workspace/gl/items.txt /workspace/gl/pats.txt
        grep -l "epsilon" /workspace/gl/items.txt /workspace/gl/pats.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["beta,delta", "alpha,epsilon", "/workspace/gl/items.txt"].join("\n"),
      );
    });
  });

  it("7. find with -empty, -size +1k, and -perm -u+x predicates", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/fsz/empty_dir /workspace/fsz/sub
        touch /workspace/fsz/empty.txt
        printf "%02048d" 0 > /workspace/fsz/sub/big.bin
        chmod 0755 /workspace/fsz/sub/big.bin
        chmod 0644 /workspace/fsz/empty.txt
        e=$(find /workspace/fsz -empty | sort | paste -sd "," -)
        b=$(find /workspace/fsz -type f -size +1k -perm -u+x)
        echo "$e|$b"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "/workspace/fsz/empty.txt,/workspace/fsz/empty_dir|/workspace/fsz/sub/big.bin",
      );
    });
  });

  it("8. find compound parenthesized ( -name ... -o -name ... ) ! -name negation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/fc
        touch /workspace/fc/a.ts /workspace/fc/b.js /workspace/fc/c.spec.ts /workspace/fc/d.md
        find /workspace/fc -type f \\( -name "*.ts" -o -name "*.js" \\) ! -name "*.spec.ts" | sort | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "/workspace/fc/a.ts,/workspace/fc/b.js");
    });
  });

  it("9. fd -t f -e extension filtering, -E directory exclusion, and -d max-depth control", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/fdw/src/deep /workspace/fdw/vendor
        touch /workspace/fdw/src/index.ts /workspace/fdw/src/deep/helper.ts /workspace/fdw/vendor/lib.ts /workspace/fdw/src/style.css
        fd -t f -e ts -E vendor . /workspace/fdw | sort | paste -sd "," -
        fd -t f -d 2 -e ts . /workspace/fdw | sort | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "/workspace/fdw/src/deep/helper.ts,/workspace/fdw/src/index.ts",
          "/workspace/fdw/src/index.ts,/workspace/fdw/vendor/lib.ts",
        ].join("\n"),
      );
    });
  });

  it("10. awk paragraph mode (RS=\"\") with newline field splitting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/para.txt
host: web-1
region: us-east
status: healthy

host: web-2
region: eu-west
status: degraded
EOF
        awk -v RS="" -F "\\n" '
          {
            for (i = 1; i <= NF; i++) {
              split($i, kv, ": ")
              rec[kv[1]] = kv[2]
            }
            printf "%s|%s|%s\\n", rec["host"], rec["region"], rec["status"]
          }
        ' /workspace/para.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["web-1|us-east|healthy", "web-2|eu-west|degraded"].join("\n"),
      );
    });
  });

  it("11. awk match() with RSTART and RLENGTH substring extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "order id=ORD-90812 amt=450.20\\norder id=ORD-10045 amt=99.00\\n" | awk '
          match($0, /ORD-[0-9]+/) {
            id = substr($0, RSTART, RLENGTH)
            rest = substr($0, RSTART + RLENGTH)
            if (match(rest, /[0-9]+\\.[0-9]+/)) {
              amt = substr(rest, RSTART, RLENGTH)
              printf "%s:%.2f\\n", id, amt * 1.1
            }
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["ORD-90812:495.22", "ORD-10045:108.90"].join("\n"),
      );
    });
  });

  it("12. awk 2D associative array (SUBSEP) pivot table accumulation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/sales.txt
us pro 100
us free 25
eu pro 80
us pro 50
eu free 15
EOF
        awk '
          { cell[$1, $2] += $3; regions[$1] = 1 }
          END {
            for (r in regions) {
              printf "%s:pro=%d,free=%d\\n", r, cell[r, "pro"], cell[r, "free"]
            }
          }
        ' /workspace/sales.txt | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["eu:pro=80,free=15", "us:pro=150,free=25"].join("\n"),
      );
    });
  });

  it("13. awk BEGIN getline < file configuration loading and close()", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "override_key=999\\n" > /workspace/conf.kv
        printf "a=10\\nb=20\\n" | awk '
          BEGIN {
            if ((getline line < "/workspace/conf.kv") > 0) {
              split(line, p, "=")
              cfg[p[1]] = p[2]
            }
            close("/workspace/conf.kv")
          }
          {
            split($0, kv, "=")
            printf "%s=%d\\n", kv[1], kv[2] + cfg["override_key"]
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "a=1009\nb=1019");
    });
  });

  it("14. awk toupper, tolower, index, and substr string manipulation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "foo=123;bar=456\\n" | awk '
          {
            s = toupper($0)
            pos = index(s, "BAR=")
            print s "|" pos "|" substr(s, pos + 4)
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "FOO=123;BAR=456|9|456");
    });
  });

  it("15. sed N two-line pattern space join and conditional s///p extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "HEADER\\n  item1\\nHEADER\\n  keep2\\nOTHER\\n  item3\\n" | sed -n '
          /^HEADER$/ {
            N
            s/^HEADER\\n  //p
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "item1\nkeep2");
    });
  });

  it("16. sed y/// character transliteration", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "abc-123\\nxyz-789\\n" | sed 'y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "ABC-123\nXYZ-789");
    });
  });

  it("17. sed range address deletion (/start/,/end/d) combined with i\\ insert and a\\ append", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' > /workspace/block.txt
keep_top
BEGIN_DROP
drop_1
drop_2
END_DROP
keep_mid
keep_bot
EOF
        sed -e '/BEGIN_DROP/,/END_DROP/d' -e '/keep_mid/i\\inserted_before' -e '/keep_mid/a\\appended_after' /workspace/block.txt | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "keep_top,inserted_before,keep_mid,appended_after,keep_bot",
      );
    });
  });

  it("18. sed capture group reordering with GNU case conversion escapes (\\U, \\E, \\u)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "first_second\\nhello_world\\n" | sed -E 's/^([a-z]+)_([a-z]+)$/\\U\\2\\E:\\u\\1/'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "SECOND:First\nWORLD:Hello");
    });
  });

  it("19. tree -J JSON structure, du -b apparent byte size, and file -b magic classification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/td/sub
        printf "12345" > /workspace/td/a.txt
        printf "1234567890" > /workspace/td/sub/b.txt
        printf "{\\"a\\":1}\\n" > /workspace/td/t.json
        printf "#!/bin/sh\\necho hi\\n" > /workspace/td/t.sh
        tree -J /workspace/td | jq -r ".[0].type"
        du -b /workspace/td/a.txt /workspace/td/sub/b.txt | awk '{print $1}' | paste -sd "," -
        file -b /workspace/td/t.json
        file -b /workspace/td/t.sh
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "directory",
          "5,10",
          "JSON text data",
          "shell script, ASCII text",
        ].join("\n"),
      );
    });
  });

  it("20. end-to-end codebase annotation audit: rg -n -r capture rewrite piped to awk aggregation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/audit/pkg
        cat <<'EOF' > /workspace/audit/pkg/service.ts
// TODO(ada): refactor auth token cache
export function auth() {}
// FIXME(bob): handle retry backoff
// TODO(ada): add metrics counter
EOF
        rg -n "(TODO|FIXME)\\(([a-z]+)\\): (.*)" -r '$1|$2|$3' /workspace/audit/pkg/service.ts | awk -F ":" '
          {
            split($2, p, "|")
            cnt[p[2]]++
            items[p[2]] = items[p[2]] ? items[p[2]] ";" p[1] "@L" $1 : p[1] "@L" $1
          }
          END {
            for (owner in cnt) printf "%s:%d:%s\\n", owner, cnt[owner], items[owner]
          }
        ' | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["ada:2:// TODO@L1;// TODO@L4", "bob:1:// FIXME@L3"].join("\n"),
      );
    });
  });
});
