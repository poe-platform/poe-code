import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const BARE_OPTS = { includeExtendedCommands: false, bareShell: true } as const;

describe("safe-bash e2e: bare-shell fast-path & cache invalidation stress matrix", () => {
  it("1. bareShell pure pipeline sort | uniq -c | sort -rn invalidates when source file is overwritten", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.writeText("/work/words.txt", "apple\nbanana\napple\ncherry\nbanana\napple\n");
      const r1 = await h.exec(`sort /work/words.txt | uniq -c | sort -rn`);
      assert.equal(r1.exitCode, 0);
      assert.match(r1.stdout.trim().split("\n")[0]!, /3 apple$/);

      await h.writeText("/work/words.txt", "cherry\ncherry\ncherry\ncherry\napple\n");
      const r2 = await h.exec(`sort /work/words.txt | uniq -c | sort -rn`);
      assert.equal(r2.exitCode, 0);
      assert.match(r2.stdout.trim().split("\n")[0]!, /4 cherry$/);
    });
  });

  it("2. bareShell cut | sort | uniq pipeline across CSV updates", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.writeText("/work/users.csv", "1,alice,eng\n2,bob,sales\n3,carol,eng\n4,dan,ops\n");
      const r1 = await h.exec(`cut -d, -f3 /work/users.csv | sort | uniq`);
      assert.equal(r1.exitCode, 0);
      assert.deepEqual(r1.stdout.trim().split("\n"), ["eng", "ops", "sales"]);

      await h.exec(`printf '5,erin,security\\n' >> /work/users.csv`);
      const r2 = await h.exec(`cut -d, -f3 /work/users.csv | sort | uniq`);
      assert.equal(r2.exitCode, 0);
      assert.deepEqual(r2.stdout.trim().split("\n"), ["eng", "ops", "sales", "security"]);
    });
  });

  it("3. bareShell grep -E | wc -l and grep -c consistency across file edits", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const lines = Array.from({ length: 40 }, (_, i) =>
        i % 2 === 0 ? `INFO_line_${i}` : `ERROR_line_${i}`,
      ).join("\n") + "\n";
      await h.writeText("/work/app.log", lines);

      const r1 = await h.exec(`grep -E '^ERROR_' /work/app.log | wc -l`);
      const r2 = await h.exec(`grep -c '^ERROR_' /work/app.log`);
      assert.equal(r1.stdout.trim(), "20");
      assert.equal(r2.stdout.trim(), "20");

      await h.exec(`printf 'ERROR_line_extra1\\nERROR_line_extra2\\n' >> /work/app.log`);
      const r3 = await h.exec(`grep -E '^ERROR_' /work/app.log | wc -l`);
      assert.equal(r3.stdout.trim(), "22");
    });
  });

  it("4. bareShell rg fast search across multiple files in flat directory with additions and removals", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.exec(`mkdir -p /work/src`);
      await h.writeText("/work/src/a.ts", "export const TOKEN_A = 'needle_xyz';\n");
      await h.writeText("/work/src/b.ts", "export const TOKEN_B = 'other';\n");
      await h.writeText("/work/src/c.ts", "export const TOKEN_C = 'needle_xyz';\n");

      const r1 = await h.exec(`rg -l 'needle_xyz' /work/src | sort`);
      assert.equal(r1.exitCode, 0);
      assert.deepEqual(r1.stdout.trim().split("\n"), ["/work/src/a.ts", "/work/src/c.ts"]);

      await h.exec(`rm /work/src/a.ts && printf "export const TOKEN_D = 'needle_xyz';\\n" > /work/src/d.ts`);
      const r2 = await h.exec(`rg -l 'needle_xyz' /work/src | sort`);
      assert.equal(r2.exitCode, 0);
      assert.deepEqual(r2.stdout.trim().split("\n"), ["/work/src/c.ts", "/work/src/d.ts"]);
    });
  });

  it("5. bareShell head and tail fast slicing on multi-hundred-line files", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const content = Array.from({ length: 200 }, (_, i) => `row-${String(i + 1).padStart(3, "0")}`).join("\n") + "\n";
      await h.writeText("/work/rows.txt", content);

      const res = await h.exec(`head -n 50 /work/rows.txt | tail -n 3`);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), ["row-048", "row-049", "row-050"]);
    });
  });

  it("6. bareShell tr character transliteration and squeeze-repeats (-s) in pipelines", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.writeText("/work/messy.txt", "hello     world   from    safe   bash\nfoo    bar\n");
      const res = await h.exec(`cat /work/messy.txt | tr -s ' ' '_' | tr 'a-z' 'A-Z'`);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "HELLO_WORLD_FROM_SAFE_BASH",
        "FOO_BAR",
      ]);
    });
  });

  it("7. bareShell tight arithmetic for-loop (( i=0; i<N; i++ )) and while-loop accumulation", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const res = await h.exec(`
        sum=0
        for (( i = 1; i <= 250; i++ )); do
          (( sum += i ))
        done
        j=10
        while (( j > 0 )); do
          (( sum += j ))
          (( j-- ))
        done
        echo "$sum"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), String((250 * 251) / 2 + (10 * 11) / 2));
    });
  });

  it("8. bareShell mkdir -p and rm -rf fast stock-memory operations", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const res = await h.exec(`
        mkdir -p /work/tree/a/b/c /work/tree/d/e
        printf 'payload-c\\n' > /work/tree/a/b/c/file.txt
        printf 'payload-e\\n' > /work/tree/d/e/file.txt
        rm -rf /work/tree/a
        ls /work/tree
        cat /work/tree/d/e/file.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), ["d", "payload-e"]);
    });
  });

  it("9. bareShell jq -c flat JSONL select-and-project fast path and file mutation", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const rows = Array.from({ length: 30 }, (_, i) =>
        JSON.stringify({ id: i + 1, name: `item_${i + 1}`, active: i % 3 === 0 }),
      ).join("\n") + "\n";
      await h.writeText("/work/items.jsonl", rows);

      const r1 = await h.exec(`jq -c 'select(.active) | {id, name}' /work/items.jsonl | wc -l`);
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout.trim(), "10");

      const updated = Array.from({ length: 30 }, (_, i) =>
        JSON.stringify({ id: i + 1, name: `item_${i + 1}`, active: i % 2 === 0 }),
      ).join("\n") + "\n";
      await h.writeText("/work/items.jsonl", updated);

      const r2 = await h.exec(`jq -c 'select(.active) | {id, name}' /work/items.jsonl | wc -l`);
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout.trim(), "15");
    });
  });

  it("10. bareShell sed single and multi-substitution on >=1KB files with subsequent mutation", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const lines = Array.from({ length: 60 }, (_, i) => `prefix_${i}_middle_suffix`).join("\n") + "\n";
      await h.writeText("/work/large.txt", lines);

      const r1 = await h.exec(`sed 's/^prefix_/PRE_/;s/_suffix$/_SUF/' /work/large.txt | head -n 2`);
      assert.equal(r1.exitCode, 0);
      assert.deepEqual(r1.stdout.trim().split("\n"), [
        "PRE_0_middle_SUF",
        "PRE_1_middle_SUF",
      ]);

      const mutated = Array.from({ length: 60 }, (_, i) => `prefix_${i + 100}_middle_suffix`).join("\n") + "\n";
      await h.writeText("/work/large.txt", mutated);

      const r2 = await h.exec(`sed 's/^prefix_/PRE_/;s/_suffix$/_SUF/' /work/large.txt | head -n 2`);
      assert.equal(r2.exitCode, 0);
      assert.deepEqual(r2.stdout.trim().split("\n"), [
        "PRE_100_middle_SUF",
        "PRE_101_middle_SUF",
      ]);
    });
  });

  it("11. bareShell awk field aggregation with printf on >=256B CSV and file update", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const csv1 = Array.from({ length: 40 }, (_, i) => `item_${i},cat_${i % 4},10`).join("\n") + "\n";
      await h.writeText("/work/metrics.csv", csv1);

      const r1 = await h.exec(`awk -F, '{ sum += $3; cnt++ } END { printf "%d:%d\\n", sum, cnt }' /work/metrics.csv`);
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout.trim(), "400:40");

      const csv2 = Array.from({ length: 40 }, (_, i) => `item_${i},cat_${i % 4},25`).join("\n") + "\n";
      await h.writeText("/work/metrics.csv", csv2);

      const r2 = await h.exec(`awk -F, '{ sum += $3; cnt++ } END { printf "%d:%d\\n", sum, cnt }' /work/metrics.csv`);
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout.trim(), "1000:40");
    });
  });

  it("12. bareShell redirect overwrite (>), append (>>), and noclobber (set -C, >|)", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.exec(`mkdir -p /work`);
      const res = await h.exec(`
        echo "first" > /work/out.txt
        echo "second" >> /work/out.txt
        set -C
        if echo "blocked" > /work/out.txt 2>/dev/null; then
          echo "UNEXPECTED_OVERWRITE"
        else
          echo "CLOBBER_BLOCKED"
        fi
        echo "forced" >| /work/out.txt
        cat /work/out.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "CLOBBER_BLOCKED",
        "forced",
      ]);
    });
  });

  it("13. bareShell PIPESTATUS array across multi-stage failing and succeeding pipelines", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const res = await h.exec(`
        false | true | false | true
        echo "\${PIPESTATUS[*]}"
        set -o pipefail
        if true | false | true; then
          echo "SHOULD_NOT_SUCCEED"
        else
          echo "PIPEFAIL_RC=$?"
        fi
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "1 0 1 0",
        "PIPEFAIL_RC=1",
      ]);
    });
  });

  it("14. bareShell find -name on flat directory with file additions and deletions", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.exec(`mkdir -p /work/flat`);
      for (let i = 1; i <= 10; i++) {
        await h.writeText(`/work/flat/f${i}.ts`, `export const x = ${i};\n`);
      }
      const r1 = await h.exec(`find /work/flat -name "*.ts" | wc -l`);
      assert.equal(r1.stdout.trim(), "10");

      await h.exec(`rm /work/flat/f1.ts /work/flat/f10.ts`);
      const r2 = await h.exec(`find /work/flat -name "*.ts" | wc -l`);
      assert.equal(r2.stdout.trim(), "8");
    });
  });

  it("15. bareShell wc -l -w -c across multiple files and stdin", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.writeText("/work/w1.txt", "one two\nthree four five\n");
      await h.writeText("/work/w2.txt", "six\n");
      const r1 = await h.exec(`wc -l -w -c < /work/w1.txt`);
      assert.equal(r1.exitCode, 0);
      assert.deepEqual(r1.stdout.trim().split(/\s+/), ["2", "5", "24"]);

      const r2 = await h.exec(`cat /work/w1.txt /work/w2.txt | wc -w`);
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout.trim(), "6");
    });
  });

  it("16. bareShell sort -t -k numeric and reverse multi-key sorting", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.writeText(
        "/work/scores.txt",
        "teamB:10\nteamA:30\nteamB:30\nteamA:20\n",
      );
      const res = await h.exec(`sort -t: -k2,2nr -k1,1 /work/scores.txt`);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "teamA:30",
        "teamB:30",
        "teamA:20",
        "teamB:10",
      ]);
    });
  });

  it("17. bareShell cp, mv, ln -s, and readlink across directory renames", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const res = await h.exec(`
        mkdir -p /work/orig /work/dest
        printf 'hello-vfs\\n' > /work/orig/source.txt
        cp /work/orig/source.txt /work/orig/copy.txt
        mv /work/orig/copy.txt /work/dest/moved.txt
        ln -s /work/dest/moved.txt /work/link.txt
        printf "target=%s content=%s\\n" "$(readlink /work/link.txt)" "$(cat /work/link.txt)"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "target=/work/dest/moved.txt content=hello-vfs");
    });
  });

  it("18. bareShell while read -r loop with input redirection and output redirection", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      await h.writeText("/work/pairs.txt", "k1 v1\nk2 v2\nk3 v3\n");
      const res = await h.exec(`
        while read -r k v; do
          printf "%s=%s\\n" "$k" "$v"
        done < /work/pairs.txt > /work/formatted.txt
        cat /work/formatted.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "k1=v1",
        "k2=v2",
        "k3=v3",
      ]);
    });
  });

  it("19. bareShell test / [[ ... ]] regex (=~), glob (==), and file predicates (-f, -d, -s, -L)", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const res = await h.exec(`
        mkdir -p /work/check
        printf 'nonempty' > /work/check/file.txt
        ln -s /work/check/file.txt /work/check/sym.txt
        v="release-2026-10"
        if [[ -d /work/check && -f /work/check/file.txt && -s /work/check/file.txt && -L /work/check/sym.txt && "$v" =~ ^release-([0-9]{4})-([0-9]{2})$ ]]; then
          printf "matched:%s:%s\\n" "\${BASH_REMATCH[1]}" "\${BASH_REMATCH[2]}"
        fi
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "matched:2026:10");
    });
  });

  it("20. bareShell multi-stage shell function, subshell, pipeline, and redirect workflow", async () => {
    await withE2EHarness(BARE_OPTS, async (h) => {
      const res = await h.exec(`
        mkdir -p /work/stage && cd /work/stage
        emit_records() {
          printf "beta:20\\nalpha:10\\ngamma:30\\nalpha:10\\n"
        }
        emit_records | sort | uniq > /work/stage/clean.txt
        wc -l < /work/stage/clean.txt
        cut -d: -f1 /work/stage/clean.txt | paste -sd, -
      `);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(res.stdout.trim().split("\n"), ["3", "alpha,beta,gamma"]);
    });
  });
});
