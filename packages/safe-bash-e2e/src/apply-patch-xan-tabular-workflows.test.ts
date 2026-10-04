import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryFileSystem, createMountFileSystem, createOverlayFileSystem, createReadOnlyFileSystem } from "@poe-code/safe-fs";
import { seedFilesOnFs, withE2EHarness } from "./harness.js";

describe("safe-bash E2E: apply_patch and xan high-speed tabular workflows", () => {
  it("1. apply_patch adds new files in nested directories and updates existing files in a single atomic envelope", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/src/index.ts": [
            "export function greet(name: string): string {",
            '  return "Hello, " + name;',
            "}",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          apply_patch <<'PATCH' > /dev/null
*** Begin Patch
*** Update File: src/index.ts
@@
 export function greet(name: string): string {
-  return "Hello, " + name;
+  return "Welcome, " + name + "!";
 }
*** Add File: src/utils/math.ts
+export function add(a: number, b: number): number {
+  return a + b;
+}
*** End Patch
PATCH
          cat /workspace/src/index.ts
          printf -- '---\n'
          cat /workspace/src/utils/math.ts
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "export function greet(name: string): string {",
            '  return "Welcome, " + name + "!";',
            "}",
            "---",
            "export function add(a: number, b: number): number {",
            "  return a + b;",
            "}",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("2. apply_patch applies multi-hunk updates disambiguated by @@ context anchors", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/service.ts": [
            "class AlphaService {",
            "  run() {",
            "    return 1;",
            "  }",
            "}",
            "",
            "class BetaService {",
            "  run() {",
            "    return 1;",
            "  }",
            "}",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          apply_patch <<'PATCH' > /dev/null
*** Begin Patch
*** Update File: service.ts
@@ class BetaService {
   run() {
-    return 1;
+    return 42;
   }
*** End Patch
PATCH
          cat /workspace/service.ts
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "class AlphaService {",
            "  run() {",
            "    return 1;",
            "  }",
            "}",
            "",
            "class BetaService {",
            "  run() {",
            "    return 42;",
            "  }",
            "}",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("3. apply_patch moves/renames files with *** Move to: while simultaneously updating their contents", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/legacy/old_name.ts": "export const VERSION = 1;\n",
          "/workspace/obsolete.txt": "remove me\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          apply_patch <<'PATCH' > /dev/null
*** Begin Patch
*** Update File: legacy/old_name.ts
*** Move to: modern/new_name.ts
@@
-export const VERSION = 1;
+export const VERSION = 2;
*** Delete File: obsolete.txt
*** End Patch
PATCH
          test ! -e /workspace/legacy/old_name.ts && echo "old_gone=1"
          test ! -e /workspace/obsolete.txt && echo "deleted_gone=1"
          cat /workspace/modern/new_name.ts
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "old_gone=1",
            "deleted_gone=1",
            "export const VERSION = 2;",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("4. apply_patch accepts a single literal patch argument and supports *** End of File anchor", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/lines.txt": "line 1\nline 2\nline 3\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          patch_str='*** Begin Patch
*** Update File: lines.txt
@@
 line 2
-line 3
+line 3 updated
+line 4 appended
*** End of File
*** End Patch'
          apply_patch "$patch_str" > /dev/null
          cat /workspace/lines.txt
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "line 1\nline 2\nline 3 updated\nline 4 appended\n");
      }
    );
  });

  it("5. apply_patch atomically rejects a batch patch without partial writes when a later file hunk fails to match", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/first.txt": "original first\n",
          "/workspace/second.txt": "original second\n"
        }
      },
      async (h) => {
        const rFail = await h.exec(String.raw`
          apply_patch <<'PATCH'
*** Begin Patch
*** Update File: first.txt
@@
-original first
+mutated first
*** Update File: second.txt
@@
-non_existent_line
+mutated second
*** End Patch
PATCH
        `);
        assert.notEqual(rFail.exitCode, 0);

        const rCheck = await h.exec(`
          cat /workspace/first.txt /workspace/second.txt
        `);
        assert.equal(rCheck.stdout, "original first\noriginal second\n");
      }
    );
  });

  it("6. apply_patch rejects path traversal (..) and symlink targets with security diagnostics", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/real.txt": "hello\n"
        }
      },
      async (h) => {
        const rTraversal = await h.exec(String.raw`
          apply_patch <<'PATCH'
*** Begin Patch
*** Add File: ../escaped.txt
+pwned
*** End Patch
PATCH
        `);
        assert.notEqual(rTraversal.exitCode, 0);

        const rSymlink = await h.exec(String.raw`
          ln -s /workspace/real.txt /workspace/link.txt
          apply_patch <<'PATCH'
*** Begin Patch
*** Update File: link.txt
@@
-hello
+world
*** End Patch
PATCH
        `);
        assert.notEqual(rSymlink.exitCode, 0);
        assert.equal(await h.readText("/workspace/real.txt"), "hello\n");
      }
    );
  });

  it("7. xan headers inspects CSV/TSV column names with --just-names, --start offset, and multi-file --csv comparison", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/a.csv": "id,user,score,region\n1,alice,95,us\n",
          "/workspace/b.csv": "id,user,tier\n2,bob,gold\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan headers -j /workspace/a.csv
          printf -- '---\n'
          xan h -s 10 /workspace/b.csv
          printf -- '---\n'
          xan headers --csv /workspace/a.csv /workspace/b.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "id",
            "user",
            "score",
            "region",
            "---",
            "10 id",
            "11 user",
            "12 tier",
            "---",
            "/workspace/a.csv,/workspace/b.csv",
            "id,id",
            "user,user",
            "score,tier",
            "region,",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("8. xan count counts CSV rows with --no-headers, --human-readable, and --check-alignment validation", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/valid.csv": "a,b,c\n1,2,3\n4,5,6\n7,8,9\n",
          "/workspace/ragged.csv": "a,b,c\n1,2,3\n4,5\n"
        }
      },
      async (h) => {
        const r = await h.exec(`
          xan count /workspace/valid.csv
          xan count -n /workspace/valid.csv
          xan count -c /workspace/valid.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "3\n4\n3\n");

        const rRagged = await h.exec(`
          xan count -c /workspace/ragged.csv
        `);
        assert.notEqual(rRagged.exitCode, 0);
      }
    );
  });

  it("9. xan select projects columns by name, index range, negative index, wildcard prefix/suffix, and complement (!)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/metrics.csv": "id,meta_env,meta_region,cpu_pct,mem_pct,secret\n1,prod,us,42,68,x\n2,dev,eu,15,30,y\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan select 'id,meta_*,*_pct' /workspace/metrics.csv
          printf -- '---\n'
          xan select '!secret,meta_*' /workspace/metrics.csv
          printf -- '---\n'
          xan select '0,-3:-2' /workspace/metrics.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "id,meta_env,meta_region,cpu_pct,mem_pct",
            "1,prod,us,42,68",
            "2,dev,eu,15,30",
            "---",
            "id,cpu_pct,mem_pct",
            "1,42,68",
            "2,15,30",
            "---",
            "id,cpu_pct,mem_pct",
            "1,42,68",
            "2,15,30",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("10. xan select -e (--evaluate) and -f (--evaluate-file) evaluate bounded column expressions", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/items.csv": "sku,qty,price\nA1,3,10\nB2,5,20\n",
          "/workspace/col.expr": "price\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan select -e 'sku' /workspace/items.csv
          printf -- '---\n'
          xan select -f /workspace/col.expr /workspace/items.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "sku",
            "A1",
            "B2",
            "---",
            "price",
            "10",
            "20",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("11. xan slice extracts row windows by --start, --len, --end, --index, and --indices", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/rows.csv": "idx,val\n0,a\n1,b\n2,c\n3,d\n4,e\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan slice -s 1 -l 2 /workspace/rows.csv
          printf -- '---\n'
          xan slice -I 0,3,4 /workspace/rows.csv
          printf -- '---\n'
          xan slice -i 2 /workspace/rows.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "idx,val",
            "1,b",
            "2,c",
            "---",
            "idx,val",
            "0,a",
            "3,d",
            "4,e",
            "---",
            "idx,val",
            "2,c",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("12. xan slice filters row streams using --start-condition (-S) and --end-condition (-E)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/log.csv": [
            "seq,phase,val",
            "1,warmup,10",
            "2,active,25",
            "3,active,40",
            "4,cooldown,15",
            "5,done,0",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan slice -S 'phase == "active"' -E 'phase == "cooldown"' /workspace/log.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "seq,phase,val",
            "2,active,25",
            "3,active,40",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("13. xan automatically infers TSV (.tsv), semicolon (.ssv), and pipe (.psv) delimiters for input and -o output", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/data.psv": "id|name|score\n1|alice|90\n2|bob|85\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan select 'name,score' -o /workspace/out.tsv /workspace/data.psv
          cat /workspace/out.tsv
          printf -- '---\n'
          xan count /workspace/out.tsv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "name\tscore",
            "alice\t90",
            "bob\t85",
            "---",
            "2",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("14. xan handles RFC 4180 quoted fields containing embedded commas, quotes, and newlines", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/quoted.csv": 'id,note,tag\n1,"hello, ""world""",ok\n2,"line1\nline2",multiline\n'
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan count /workspace/quoted.csv
          xan select 'id,tag' /workspace/quoted.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "2",
            "id,tag",
            "1,ok",
            "2,multiline",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("15. xan slice --byte-offset (-B) and --end-byte seek directly into large CSV files", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/offsets.csv": "k,v\nr0,100\nr1,200\nr2,300\n"
        }
      },
      async (h) => {
        // Header "k,v\n" is 4 bytes, "r0,100\n" is 7 bytes -> offset 11 starts at "r1,200\n"
        const r = await h.exec(String.raw`
          xan slice -B 11 /workspace/offsets.csv
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "k,v",
            "r1,200",
            "r2,300",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("16. combines xan select/slice with csvsql and sqlite3 for relational tabular analytics", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/trades.csv": [
            "id,symbol,side,qty,price,venue",
            "1,AAPL,BUY,10,180,NASDAQ",
            "2,MSFT,BUY,5,400,NASDAQ",
            "3,AAPL,SELL,4,185,NYSE",
            "4,MSFT,BUY,10,410,NYSE",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan select 'symbol,qty,price' /workspace/trades.csv > /workspace/projected.csv
          sqlite3 -csv -header /workspace/trades.db <<'SQL'
CREATE TABLE trades (symbol TEXT, qty INT, price INT);
.mode csv
.import --skip 1 /workspace/projected.csv trades
SELECT symbol, SUM(CAST(qty AS INT)) AS total_qty, SUM(CAST(qty AS INT) * CAST(price AS INT)) AS notional
FROM trades
GROUP BY symbol
ORDER BY symbol;
SQL
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "symbol,total_qty,notional",
            "AAPL,14,2540",
            "MSFT,15,6100",
            ""
          ].join("\r\n")
        );
      }
    );
  });

  it("17. combines xan, csvkit (csvgrep, csvstat, csvjson), and jq for schema-aware ETL", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/employees.csv": [
            "emp_id,name,dept,salary,secret_ssn",
            "101,Alice,Eng,160000,000-01",
            "102,Bob,Sales,120000,000-02",
            "103,Carol,Eng,180000,000-03",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan select '!secret_ssn' /workspace/employees.csv \
            | csvgrep -c dept -m Eng \
            | csvjson --no-inference \
            | jq -c 'map({name, salary: (.salary | tonumber)})'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          '[{"name":"Alice","salary":160000},{"name":"Carol","salary":180000}]\n'
        );
      }
    );
  });

  it("18. apply_patch rejects non-atomic or read-only filesystems (MountFileSystem, OverlayFileSystem, ReadOnlyFileSystem) without partial mutations", async () => {
    const rootFs = createMemoryFileSystem();
    const pkgFs = createMemoryFileSystem();
    await seedFilesOnFs(pkgFs, {
      "/pkg/config.ts": 'export const BASE = "v1";\n'
    });
    const mounted = createMountFileSystem({
      root: rootFs,
      mounts: { "/mnt": pkgFs }
    });

    await withE2EHarness({ fs: mounted, cwd: "/mnt/pkg" }, async (h) => {
      const rMounted = await h.exec(String.raw`
        apply_patch <<'PATCH'
*** Begin Patch
*** Update File: config.ts
@@
-export const BASE = "v1";
+export const BASE = "v2-mounted";
*** End Patch
PATCH
      `);
      assert.notEqual(rMounted.exitCode, 0);
      assert.match(rMounted.stderr, /operation not supported/);
      const content = Buffer.from(await pkgFs.readFile("/pkg/config.ts")).toString("utf8");
      assert.equal(content, 'export const BASE = "v1";\n');
    });

    const overlay = createOverlayFileSystem({
      lower: createMemoryFileSystem(),
      upper: createMemoryFileSystem()
    });
    await withE2EHarness({ fs: overlay, cwd: "/" }, async (h) => {
      const rOverlay = await h.exec(String.raw`
        apply_patch <<'PATCH'
*** Begin Patch
*** Add File: feature.ts
+export const ENABLED = true;
*** End Patch
PATCH
      `);
      assert.notEqual(rOverlay.exitCode, 0);
      assert.match(rOverlay.stderr, /atomic conditional patch mutations/);
    });

    const roInner = createMemoryFileSystem();
    await seedFilesOnFs(roInner, { "/app.ts": "const x = 1;\n" });
    const roFs = createReadOnlyFileSystem(roInner);
    await withE2EHarness({ fs: roFs, cwd: "/" }, async (h) => {
      const rRo = await h.exec(String.raw`
        apply_patch <<'PATCH'
*** Begin Patch
*** Update File: app.ts
@@
-const x = 1;
+const x = 2;
*** End Patch
PATCH
      `);
      assert.notEqual(rRo.exitCode, 0);
      assert.equal(Buffer.from(await roInner.readFile("/app.ts")).toString("utf8"), "const x = 1;\n");
    });
  });

  it("19. apply_patch + diff -u + patch -R roundtrip verifies reversible codebase edits", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/app.py": "def compute(x):\n    return x + 1\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          cp /workspace/app.py /workspace/app.py.orig
          apply_patch <<'PATCH' > /dev/null
*** Begin Patch
*** Update File: app.py
@@ def compute(x):
-    return x + 1
+    return x * 10
*** End Patch
PATCH
          diff -u /workspace/app.py.orig /workspace/app.py > /workspace/change.diff || true
          cat /workspace/app.py
          patch -R /workspace/app.py < /workspace/change.diff > /dev/null
          cmp -s /workspace/app.py /workspace/app.py.orig && echo "reverted_cleanly=1"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          "def compute(x):\n    return x * 10\nreverted_cleanly=1\n"
        );
      }
    );
  });

  it("20. end-to-end agent refactoring workflow: xan extracts migration table, awk generates apply_patch envelope, and apply_patch updates source tree", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/renames.csv": [
            "file,old_sym,new_sym,active",
            "src/a.ts,legacyFetch,modernFetch,yes",
            "src/b.ts,oldParse,safeParse,yes",
            "src/c.ts,keepMe,dontTouch,no",
            ""
          ].join("\n"),
          "/workspace/src/a.ts": "export function runA() {\n  return legacyFetch();\n}\n",
          "/workspace/src/b.ts": "export function runB() {\n  return oldParse();\n}\n",
          "/workspace/src/c.ts": "export function runC() {\n  return keepMe();\n}\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xan slice -S 'active == "yes"' -E 'active == "no"' /workspace/renames.csv \
            | xan select 'file,old_sym,new_sym' \
            | awk -F',' '
              BEGIN { print "*** Begin Patch" }
              NR > 1 {
                print "*** Update File: " $1
                print "@@"
                print "-  return " $2 "();"
                print "+  return " $3 "();"
              }
              END { print "*** End Patch" }
            ' > /workspace/migration.patch

          apply_patch < /workspace/migration.patch > /dev/null
          cat /workspace/src/a.ts /workspace/src/b.ts /workspace/src/c.ts
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "export function runA() {",
            "  return modernFetch();",
            "}",
            "export function runB() {",
            "  return safeParse();",
            "}",
            "export function runC() {",
            "  return keepMe();",
            "}",
            ""
          ].join("\n")
        );
      }
    );
  });
});
