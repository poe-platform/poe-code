import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("diff, diff3, patch, apply_patch, sed, awk, grep, rg, fd, and xargs end-to-end repo refactoring", () => {
  it("1. cp -r + sha256sum + diff -ru establishes and verifies a clean baseline repository snapshot", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/repo/src
        cd /workspace/repo
        printf 'export const VERSION = "1.0.0";\n' > src/version.ts
        printf 'import { VERSION } from "./version.js";\nexport function banner() { return "v" + VERSION; }\n' > src/index.ts
        cp -r src .baseline-src
        diff -ru .baseline-src src
        sha256sum src/version.ts src/index.ts | wc -l | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "2\n");
    });
  });

  it("2. fd + xargs + sed -i renames an identifier across multiple files and diff -u verifies the delta", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/repo/src
        cd /workspace/repo
        printf 'export function legacyCompute(x: number) { return x * 2; }\n' > src/math.ts
        printf 'import { legacyCompute } from "./math.js";\nexport const res = legacyCompute(21);\n' > src/app.ts
        cp -r src src.orig

        fd -e ts . src | xargs sed -i 's/legacyCompute/fastCompute/g'
        rg -n 'fastCompute' src | sort
        { diff -u src.orig/math.ts src/math.ts || true; } | grep -E '^[+-]export'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "src/app.ts:1:import { fastCompute } from \"./math.js\";",
          "src/app.ts:2:export const res = fastCompute(21);",
          "src/math.ts:1:export function fastCompute(x: number) { return x * 2; }",
          "-export function legacyCompute(x: number) { return x * 2; }",
          "+export function fastCompute(x: number) { return x * 2; }",
          "",
        ].join("\n"),
      );
    });
  });

  it("3. diff -u + patch -R cleanly reverses working tree edits back to baseline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/repo
        cd /workspace/repo
        printf 'alpha\nbeta\ngamma\n' > notes.txt
        cp notes.txt notes.orig

        sed -i 's/beta/BETA_UPDATED/' notes.txt
        diff -u notes.orig notes.txt > change.patch || true
        patch -R notes.txt < change.patch >/dev/null
        cmp -s notes.orig notes.txt && echo "RESTORED"
        cat notes.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "RESTORED\nalpha\nbeta\ngamma\n");
    });
  });

  it("4. diff -u generates unified patch between two files and patch applies it cleanly", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/v1.conf", "host=127.0.0.1\nport=8080\ntls=false\n");
      await h.writeText("/workspace/v2.conf", "host=0.0.0.0\nport=8443\ntls=true\n");

      const r = await h.exec(`
        cp v1.conf target.conf
        diff -u v1.conf v2.conf > upgrade.diff || true
        patch target.conf < upgrade.diff >/dev/null
        cmp -s target.conf v2.conf && echo "MATCH"
        cat target.conf
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "MATCH\nhost=0.0.0.0\nport=8443\ntls=true\n");
    });
  });

  it("5. diff3 -m merges non-overlapping concurrent changes from two branches cleanly", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/base.txt",
        "line 1\nline 2\nline 3\nline 4\nline 5\n",
      );
      await h.writeText(
        "/workspace/mine.txt",
        "line 1 (mine)\nline 2\nline 3\nline 4\nline 5\n",
      );
      await h.writeText(
        "/workspace/theirs.txt",
        "line 1\nline 2\nline 3\nline 4\nline 5 (theirs)\n",
      );

      const r = await h.exec(`
        diff3 -m mine.txt base.txt theirs.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "line 1 (mine)\nline 2\nline 3\nline 4\nline 5 (theirs)\n",
      );
    });
  });

  it("6. diff3 -m detects overlapping 3-way conflict, exits 1, and emits conflict markers", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "header\nvalue=10\nfooter\n");
      await h.writeText("/workspace/mine.txt", "header\nvalue=20\nfooter\n");
      await h.writeText("/workspace/theirs.txt", "header\nvalue=30\nfooter\n");

      const r = await h.exec(`
        diff3 -m mine.txt base.txt theirs.txt
      `);
      assert.equal(r.exitCode, 1);
      assert.match(r.stdout, /<{7}/);
      assert.match(r.stdout, /value=20/);
      assert.match(r.stdout, /={7}/);
      assert.match(r.stdout, /value=30/);
      assert.match(r.stdout, />{7}/);
    });
  });

  it("7. apply_patch adds, updates, moves, and deletes files atomically in a repository", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/old-util.ts", "export const x = 1;\nexport const y = 2;\n");
      await h.writeText("/workspace/src/obsolete.ts", "export const dead = true;\n");

      const patch = [
        "*** Begin Patch",
        "*** Add File: src/new-feature.ts",
        "+export const feature = 'enabled';",
        "*** Update File: src/old-util.ts",
        "*** Move to: src/util.ts",
        "@@",
        " export const x = 1;",
        "-export const y = 2;",
        "+export const y = 20;",
        "*** Delete File: src/obsolete.ts",
        "*** End Patch",
        "",
      ].join("\n");
      await h.writeText("/workspace/refactor.patch", patch);

      const r = await h.exec(`
        apply_patch < refactor.patch >/dev/null
        fd . src | sort
        cat src/new-feature.ts
        cat src/util.ts
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "src/new-feature.ts",
          "src/util.ts",
          "export const feature = 'enabled';",
          "export const x = 1;",
          "export const y = 20;",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. rg -l + xargs + awk + sponge rewrites legacy module paths across nested files", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/pkg/a.ts",
        'import { run } from "@legacy/core";\nexport const a = run();\n',
      );
      await h.writeText(
        "/workspace/pkg/sub/b.ts",
        'import { cfg } from "@legacy/core";\nexport const b = cfg;\n',
      );
      await h.writeText(
        "/workspace/pkg/sub/keep.ts",
        'import { other } from "@modern/other";\n',
      );

      const r = await h.exec(`
        for f in $(rg -l '@legacy/core' pkg | sort); do
          awk '{gsub(/@legacy\\/core/, "@modern/core"); print}' "$f" | sponge "$f"
        done
        rg -n '@modern/core' pkg | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          'pkg/a.ts:1:import { run } from "@modern/core";',
          'pkg/sub/b.ts:1:import { cfg } from "@modern/core";',
          "",
        ].join("\n"),
      );
    });
  });

  it("9. diff3 -m + sponge integrates concurrent feature branch edits into main branch file", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/branches/{base,main,feature}
        printf 'alpha=1\nbeta=2\ngamma=3\n' > /workspace/branches/base/config.env
        cp /workspace/branches/base/config.env /workspace/branches/main/config.env
        cp /workspace/branches/base/config.env /workspace/branches/feature/config.env

        sed -i 's/alpha=1/alpha=10/' /workspace/branches/main/config.env
        sed -i 's/gamma=3/gamma=30/' /workspace/branches/feature/config.env

        diff3 -m \
          /workspace/branches/main/config.env \
          /workspace/branches/base/config.env \
          /workspace/branches/feature/config.env \
          | sponge /workspace/branches/main/config.env
        cat /workspace/branches/main/config.env
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "alpha=10\nbeta=2\ngamma=30\n");
    });
  });

  it("10. sha256sum --check detects corrupted tracked file and restores it from backup archive", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/repo
        cd /workspace/repo
        printf 'stable=true\n' > app.ini
        sha256sum app.ini > MANIFEST.sha256
        tar -cf backup.tar app.ini

        printf 'stable=corrupted\n' > app.ini
        if sha256sum -c MANIFEST.sha256 >/dev/null 2>&1; then
          echo "UNEXPECTED_OK"
        else
          tar -xf backup.tar
          sha256sum -c MANIFEST.sha256
        fi
        cat app.ini
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "app.ini: OK\nstable=true\n");
    });
  });

  it("11. comm -12, -23, and -13 audit added, removed, and retained exports between API versions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/v1-exports.txt", "createClient\nlegacyHelper\nparseConfig\nrunTask\n");
      await h.writeText("/workspace/v2-exports.txt", "createClient\nparseConfig\nrunTask\nstreamEvents\n");

      const r = await h.exec(`
        sort v1-exports.txt > v1.sorted
        sort v2-exports.txt > v2.sorted
        echo "=== retained ==="
        comm -12 v1.sorted v2.sorted
        echo "=== removed ==="
        comm -23 v1.sorted v2.sorted
        echo "=== added ==="
        comm -13 v1.sorted v2.sorted
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== retained ===",
          "createClient",
          "parseConfig",
          "runTask",
          "=== removed ===",
          "legacyHelper",
          "=== added ===",
          "streamEvents",
          "",
        ].join("\n"),
      );
    });
  });

  it("12. join -t, + awk enriches module metrics with team ownership records", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/owners.csv", "auth,security\nbilling,fintech\ncore,platform\n");
      await h.writeText("/workspace/loc.csv", "auth,420\nbilling,850\ncore,1230\n");

      const r = await h.exec(`
        join -t, -1 1 -2 1 owners.csv loc.csv | awk -F, '{printf "%s (%s): %d LOC\\n", $1, $2, $3}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "auth (security): 420 LOC",
          "billing (fintech): 850 LOC",
          "core (platform): 1230 LOC",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. paste + tr + awk combines parallel benchmark columns and computes speedup ratios", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/suites.txt", "lexer\nparser\nruntime\n");
      await h.writeText("/workspace/before.txt", "120\n240\n500\n");
      await h.writeText("/workspace/after.txt", "30\n60\n100\n");

      const r = await h.exec(`
        paste suites.txt before.txt after.txt | awk -F'\t' '{printf "%s: %.1fx\\n", $1, $2 / $3}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "lexer: 4.0x\nparser: 4.0x\nruntime: 5.0x\n");
    });
  });

  it("14. grep -rn + cut + sort + uniq -c ranks source files by TODO/FIXME marker density", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/a.ts", "// TODO: one\nconst a = 1;\n// FIXME: two\n// TODO: three\n");
      await h.writeText("/workspace/src/b.ts", "// TODO: only one\n");
      await h.writeText("/workspace/src/c.ts", "const clean = true;\n");

      const r = await h.exec(`
        grep -rn -E 'TODO|FIXME' src | cut -d: -f1 | sort | uniq -c | awk '{print $1, $2}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "3 src/a.ts\n1 src/b.ts\n");
    });
  });

  it("15. find with -path -prune skips ignored build directories while collecting source files", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/project/src/main.ts", "export {};\n");
      await h.writeText("/workspace/project/src/util.ts", "export {};\n");
      await h.writeText("/workspace/project/dist/main.js", "export {};\n");
      await h.writeText("/workspace/project/node_modules/pkg/index.ts", "export {};\n");

      const r = await h.exec(`
        find project \\( -path '*/dist' -o -path '*/node_modules' \\) -prune -o -type f -name '*.ts' -print | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "project/src/main.ts\nproject/src/util.ts\n");
    });
  });

  it("16. fd with -e, -E, and --format '{/.}' extracts sorted module stems excluding test files", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/lib/client.ts", "export {};\n");
      await h.writeText("/workspace/lib/client.test.ts", "export {};\n");
      await h.writeText("/workspace/lib/router.ts", "export {};\n");
      await h.writeText("/workspace/lib/README.md", "# Lib\n");

      const r = await h.exec(`
        fd -e ts -E '*.test.ts' --format '{/.}' . lib | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "client\nrouter\n");
    });
  });

  it("17. grep -oE + sed + sort -u extracts unique semantic version tags from changelog prose", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/CHANGELOG.md",
        [
          "# Changelog",
          "Released v1.2.0 and hotfix v1.2.1.",
          "Upgraded compatibility from v1.0.0 to v1.2.1 and v2.0.0.",
        ].join("\n"),
      );

      const r = await h.exec(`
        grep -oE 'v[0-9]+\\.[0-9]+\\.[0-9]+' CHANGELOG.md | sed 's/^v//' | sort -u
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "1.0.0\n1.2.0\n1.2.1\n2.0.0\n");
    });
  });

  it("18. awk multi-file FNR==1 summary counts lines and exported functions per module", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/m1.ts",
        "export function a() {}\nexport function b() {}\nconst internal = 1;\n",
      );
      await h.writeText(
        "/workspace/m2.ts",
        "export function c() {}\n",
      );

      const r = await h.exec(`
        awk '
          FNR == 1 {
            if (NR > 1) print prev ":" lines ":" exports
            prev = FILENAME
            lines = 0
            exports = 0
          }
          { lines++ }
          /^export function / { exports++ }
          END {
            if (prev != "") print prev ":" lines ":" exports
          }
        ' m1.ts m2.ts
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "m1.ts:3:2\nm2.ts:1:1\n");
    });
  });

  it("19. sed range addressing and substitution rewrites only a targeted configuration block", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/service.ini",
        [
          "[staging]",
          "replicas = 2",
          "[production]",
          "replicas = 2",
          "[dr]",
          "replicas = 2",
          "",
        ].join("\n"),
      );

      const r = await h.exec(`
        sed '/^\\[production\\]/,/^\\[dr\\]/ s/replicas = 2/replicas = 8/' service.ini
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "[staging]",
          "replicas = 2",
          "[production]",
          "replicas = 8",
          "[dr]",
          "replicas = 2",
          "",
        ].join("\n"),
      );
    });
  });

  it("20. tr + fold + nl -ba normalizes, wraps, and numbers a plain-text specification", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'alpha   beta   gamma   delta   epsilon\n' \
          | tr -s ' ' \
          | fold -s -w 15 \
          | nl -ba -w 2 -s ': '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        " 1: alpha beta \n 2: gamma delta \n 3: epsilon\n",
      );
    });
  });

  it("21. split -l + cat + sha256sum splits a dataset into chunks and verifies lossless reassembly", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/dataset.txt",
        "row-1\nrow-2\nrow-3\nrow-4\nrow-5\n",
      );

      const r = await h.exec(`
        split -l 2 dataset.txt chunk_
        ls chunk_* | sort | xargs cat > rebuilt.txt
        orig=$(sha256sum dataset.txt | awk '{print $1}')
        copy=$(sha256sum rebuilt.txt | awk '{print $1}')
        test "$orig" = "$copy" && echo "VERIFIED:$orig"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /^VERIFIED:[0-9a-f]{64}\n$/);
    });
  });

  it("22. tar -czf + tar -xzf + diff -r archives and restores a source tree identically", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/index.ts", "export const v = 1;\n");
      await h.writeText("/workspace/src/nested/helper.ts", "export const h = 2;\n");

      const r = await h.exec(`
        tar -czf release.tar.gz src
        mkdir -p unpacked
        tar -xzf release.tar.gz -C unpacked
        diff -r src unpacked/src
        echo "DIFF_OK"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "DIFF_OK\n");
    });
  });

  it("23. jq + yq + sponge synchronizes release version across package.json and chart.yaml", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/package.json",
        '{"name":"demo-service","version":"2.4.0"}\n',
      );
      await h.writeText(
        "/workspace/chart.yaml",
        "apiVersion: v2\nname: demo-service\nappVersion: 1.0.0\n",
      );

      const r = await h.exec(`
        ver=$(jq -r '.version' package.json)
        yq -o json '.' chart.yaml | jq --arg v "$ver" '.appVersion = $v' | yq -o yaml '.' | sponge chart.yaml
        yq -o json -r '.appVersion' chart.yaml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "2.4.0\n");
    });
  });

  it("24. xmllint --xpath + sed + diff -u updates XML artifact version and audits the unified diff", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/pom.xml",
        "<project>\n  <name>core</name>\n  <version>1.0.0</version>\n</project>\n",
      );

      const r = await h.exec(`
        cp pom.xml pom.xml.bak
        sed -i 's/<version>1.0.0<\\/version>/<version>1.1.0<\\/version>/' pom.xml
        xmllint --xpath 'string(/project/version)' pom.xml
        diff -u pom.xml.bak pom.xml | grep -E '^[+-]  <version>'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "1.1.0\n-  <version>1.0.0</version>\n+  <version>1.1.0</version>\n",
      );
    });
  });

  it("25. sqlite3 + csvcut + csvsort queries refactoring audit log and formats sorted CSV output", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sqlite3 audit.db "
          CREATE TABLE migrations (step INT, module TEXT, status TEXT);
          INSERT INTO migrations VALUES (2, 'router', 'done'), (1, 'auth', 'done'), (3, 'billing', 'pending');
        "
        sqlite3 -header -csv audit.db "SELECT step, module, status FROM migrations;" \
          | csvsort -c step \
          | csvcut -c module,status
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "module,status\nauth,done\nrouter,done\nbilling,pending\n",
      );
    });
  });

  it("26. bc + awk evaluates floating-point test coverage gate in a CI check script", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/coverage.txt",
        "auth 95 100\nrouter 88 100\nbilling 92 100\n",
      );

      const r = await h.exec(`
        read covered total <<< $(awk '{c += $2; t += $3} END {print c, t}' coverage.txt)
        pct=$(echo "scale=2; ($covered * 100) / $total" | bc)
        pass=$(echo "$pct >= 90.00" | bc)
        echo "coverage=$pct% pass=$pass"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "coverage=91.66% pass=1\n");
    });
  });

  it("27. base64 + xxd + sha256sum generates and verifies an encoded binary payload", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'SAFE-BASH-BINARY-PAYLOAD' | base64 > payload.b64
        base64 -d payload.b64 | xxd -p | tr -d '\\n' > payload.hex
        xxd -r -p payload.hex > decoded.bin
        cat decoded.bin
        printf '\\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "SAFE-BASH-BINARY-PAYLOAD\n");
    });
  });

  it("28. env -i + printenv runs a hermetic build command with only explicitly whitelisted variables", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        export SECRET_TOKEN="do-not-leak"
        env -i BUILD_ENV=production TARGET_ARCH=wasm32 printenv | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "BUILD_ENV=production\nTARGET_ARCH=wasm32\n");
    });
  });

  it("29. pathchk -p + dirname + basename + realpath validates and normalizes artifact paths", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/releases/v2/bin
        touch /workspace/releases/v2/bin/safe-bash
        pathchk -p releases/v2/bin/safe-bash
        abs=$(realpath releases/v2/bin/../bin/safe-bash)
        echo "dir=$(dirname "$abs") base=$(basename "$abs")"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "dir=/workspace/releases/v2/bin base=safe-bash\n");
    });
  });

  it("30. date -u + touch -d + stat -c '%Y %n' stamps deterministic build timestamps on release files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        touch a.out b.out
        touch -d '2026-01-15T00:00:00Z' a.out b.out
        stat -c '%Y %n' a.out b.out
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "1768435200 a.out\n1768435200 b.out\n");
    });
  });

  it("31. tee + grep + wc fans out test runner output into filtered failure log and total line count", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'PASS suite-1\nFAIL suite-2\nPASS suite-3\nFAIL suite-4\n' \
          | tee full.log \
          | grep '^FAIL' > failures.log
        echo "total=$(wc -l < full.log | tr -d ' ') failed=$(wc -l < failures.log | tr -d ' ')"
        cat failures.log
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "total=4 failed=2\nFAIL suite-2\nFAIL suite-4\n",
      );
    });
  });

  it("32. xargs -I {} migrates configuration templates across multiple environment directories", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p envs/dev envs/staging envs/prod
        printf 'dev\nstaging\nprod\n' | xargs -I {} sh -c 'printf "env={}\\n" > "envs/{}/app.env"'
        head -n 1 envs/dev/app.env envs/staging/app.env envs/prod/app.env
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /env=dev/);
      assert.match(r.stdout, /env=staging/);
      assert.match(r.stdout, /env=prod/);
    });
  });

  it("33. shopt -s globstar nullglob rewrites deeply nested *.spec.ts imports in pure bash", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/a.spec.ts", "import './old.js';\n");
      await h.writeText("/workspace/src/deep/nested/b.spec.ts", "import './old.js';\n");

      const r = await h.exec(`
        shopt -s globstar nullglob
        for f in src/**/*.spec.ts; do
          sed -i "s|./old.js|./new.js|g" "$f"
        done
        rg -n './new.js' src | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "src/a.spec.ts:1:import './new.js';\nsrc/deep/nested/b.spec.ts:1:import './new.js';\n",
      );
    });
  });

  it("34. bash associative arrays and parameter expansion aggregate per-package dependency counts", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        declare -A deps
        records=("core:fs" "core:path" "cli:core" "cli:fs" "cli:ui" "ui:core")
        for rec in "\${records[@]}"; do
          pkg="\${rec%%:*}"
          deps["$pkg"]=$(( \${deps["$pkg"]:-0} + 1 ))
        done
        for pkg in $(printf '%s\\n' "\${!deps[@]}" | sort); do
          echo "$pkg=\${deps[$pkg]}"
        done
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "cli=3\ncore=2\nui=1\n");
    });
  });

  it("35. trap EXIT cleanup rolls back temporary staging directory when validation fails", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        (
          set -euo pipefail
          mkdir -p /workspace/.staging-tx
          trap 'rm -rf /workspace/.staging-tx' EXIT
          printf 'draft' > /workspace/.staging-tx/data.txt
          false
        ) || echo "ROLLED_BACK"
        test ! -d /workspace/.staging-tx && echo "CLEAN"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "ROLLED_BACK\nCLEAN\n");
    });
  });

  it("36. full end-to-end release workflow: apply_patch + jq + sponge + rg + tar + sha512sum --check", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/release-repo/src
        cd /workspace/release-repo

        printf '{"name":"@poe/demo","version":"1.0.0"}\n' > package.json
        printf 'export const VERSION = "1.0.0";\n' > src/index.ts

        jq -c '.version = "1.1.0"' package.json | sponge package.json
        apply_patch << 'PATCH' >/dev/null
*** Begin Patch
*** Update File: src/index.ts
@@
-export const VERSION = "1.0.0";
+export const VERSION = "1.1.0";
*** End Patch
PATCH

        tar -czf demo-1.1.0.tar.gz package.json src/index.ts
        sha512sum demo-1.1.0.tar.gz > SHA512SUMS
        sha512sum -c SHA512SUMS
        jq -r '.version' package.json
        rg -o '[0-9]+\\.[0-9]+\\.[0-9]+' src/index.ts
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "demo-1.1.0.tar.gz: OK",
          "1.1.0",
          "1.1.0",
          "",
        ].join("\n"),
      );
    });
  });
});
