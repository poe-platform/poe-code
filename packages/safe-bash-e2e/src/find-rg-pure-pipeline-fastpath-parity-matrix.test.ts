import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

function build64FileSrcTree(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let d = 0; d < 8; d++) {
    const dirName = `pkg_${String(d).padStart(2, "0")}`;
    for (let f = 0; f < 8; f++) {
      const fileName = `mod_${String(f).padStart(2, "0")}.ts`;
      const slot = d * 8 + f;
      files[`/src/${dirName}/${fileName}`] = [
        `export const SLOT_${slot} = ${slot};`,
        slot % 2 === 0 ? `export const TOKEN_EVEN = "MARKER_ALPHA_${slot}";` : `export const TOKEN_ODD = "MARKER_BETA_${slot}";`,
        slot % 5 === 0 ? `// TODO(audit): review module ${dirName}/${fileName}` : `// status: clean`,
        "",
      ].join("\n");
    }
  }
  return files;
}

describe("safe-bash e2e: find, rg, grep, fd, and pure pipeline fast-path parity matrix", () => {
  it("1. executes bareShell rg -c across a 64-file 8x8 /src tree and re-verifies after file content mutation", async () => {
    await withE2EHarness(
      {
        bareShell: true,
        files: build64FileSrcTree(),
      },
      async (h) => {
        const r1 = await h.expectOk("rg -c MARKER_ALPHA_ /src");
        const r2 = await h.expectOk("rg -c MARKER_ALPHA_ /src");
        const lines1 = r1.stdout.trim().split("\n").sort();
        const lines2 = r2.stdout.trim().split("\n").sort();
        assert.equal(lines1.length, 32);
        assert.deepEqual(lines2, lines1);
        assert.ok(lines1.every((line) => line.endsWith(":1")));

        // Mutate one file so revision increments and verify rg -c updates accurately
        await h.expectOk('echo "MARKER_ALPHA_EXTRA" >> /src/pkg_00/mod_00.ts');
        const r3 = await h.expectOk("rg -c MARKER_ALPHA_ /src");
        const map3 = new Map(
          r3.stdout
            .trim()
            .split("\n")
            .map((line) => {
              const idx = line.lastIndexOf(":");
              return [line.slice(0, idx), Number(line.slice(idx + 1))] as const;
            }),
        );
        assert.equal(map3.get("/src/pkg_00/mod_00.ts"), 2);
        assert.equal(map3.get("/src/pkg_00/mod_02.ts"), 1);
      },
    );
  });

  it("2. executes bareShell 3-stage and 4-stage pure grep | cut | tr | sort | head | wc -c pipelines on root files", async () => {
    const rows: string[] = [];
    for (let i = 0; i < 180; i++) {
      const group = i % 3 === 0 ? "alpha" : i % 3 === 1 ? "beta" : "gamma";
      const code = `k${String((i * 13) % 50).padStart(2, "0")}`;
      rows.push(`${group}:${code}:val_${String(i).padStart(3, "0")}`);
    }
    await withE2EHarness(
      {
        bareShell: true,
        files: {
          "/dataset.txt": rows.join("\n") + "\n",
        },
      },
      async (h) => {
        const r1 = await h.expectOk("grep alpha /dataset.txt | cut -d: -f2 | tr a-z A-Z | sort -r | head -n 5");
        const r2 = await h.expectOk("grep alpha /dataset.txt | cut -d: -f2 | tr a-z A-Z | sort -r | head -n 5");
        assert.equal(r1.stdout, "K49\nK48\nK47\nK46\nK45\n");
        assert.equal(r2.stdout, r1.stdout);

        const rBytes = await h.expectOk("grep gamma /dataset.txt | cut -d: -f1 | sort | wc -c");
        assert.equal(rBytes.stdout.trim(), "360");
      },
    );
  });

  it("3. executes bareShell 2-stage find -name | head and find -name | wc -l on 32-file flat directories", async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 36; i++) {
      const ext = i % 2 === 0 ? "txt" : "log";
      files[`/flat/item_${String(i).padStart(2, "0")}.${ext}`] = `payload ${i}\n`;
    }
    await withE2EHarness(
      {
        bareShell: true,
        files,
      },
      async (h) => {
        const rCount1 = await h.expectOk('find /flat -name "*.txt" | wc -l');
        const rCount2 = await h.expectOk('find /flat -name "*.txt" | wc -l');
        assert.equal(rCount1.stdout.trim(), "18");
        assert.equal(rCount2.stdout.trim(), "18");

        const rHead = await h.expectOk('find /flat -name "*.log" | sort | head -n 4');
        assert.equal(
          rHead.stdout,
          [
            "/flat/item_01.log",
            "/flat/item_03.log",
            "/flat/item_05.log",
            "/flat/item_07.log",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("4. evaluates complex find boolean expressions with parentheses, !, -not, -a, -o, -name, -iname, -path, and -ipath", async () => {
    await withE2EHarness(
      {
        files: {
          "/repo/src/core/engine.ts": "export const engine = 1;\n",
          "/repo/src/core/engine.test.ts": "export const test = 1;\n",
          "/repo/src/ui/Button.TSX": "export const btn = 1;\n",
          "/repo/src/ui/Button.spec.tsx": "export const spec = 1;\n",
          "/repo/vendor/lib/helper.ts": "export const vendor = 1;\n",
          "/repo/docs/guide.md": "# Guide\n",
        },
      },
      async (h) => {
        const r = await h.expectOk(
          'find /repo -type f \\( -iname "*.ts" -o -iname "*.tsx" \\) ! -name "*.test.*" -not -name "*.spec.*" ! -path "*/vendor/*" | sort',
        );
        assert.equal(
          r.stdout,
          [
            "/repo/src/core/engine.ts",
            "/repo/src/ui/Button.TSX",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("5. evaluates find -prune with multiple excluded subtrees and -print / -print0 actions", async () => {
    await withE2EHarness(
      {
        files: {
          "/project/node_modules/pkg/index.js": "module.exports = 1;\n",
          "/project/.git/config": "[core]\n",
          "/project/dist/bundle.js": "console.log(1);\n",
          "/project/src/index.js": "export default 1;\n",
          "/project/src/utils/math.js": "export const add = (a, b) => a + b;\n",
          "/project/scripts/build.sh": "#!/bin/sh\n",
        },
      },
      async (h) => {
        const r = await h.expectOk(
          'find /project \\( -name node_modules -o -name .git -o -name dist \\) -prune -o -type f -print | sort',
        );
        assert.equal(
          r.stdout,
          [
            "/project/scripts/build.sh",
            "/project/src/index.js",
            "/project/src/utils/math.js",
            "",
          ].join("\n"),
        );

        const rNull = await h.expectOk(
          'find /project \\( -name node_modules -o -name .git -o -name dist \\) -prune -o -type f -name "*.js" -print0 | tr "\\0" "\\n" | sort',
        );
        assert.equal(
          rNull.stdout,
          [
            "/project/src/index.js",
            "/project/src/utils/math.js",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("6. evaluates find -mindepth and -maxdepth boundaries across nested directory hierarchies", async () => {
    await withE2EHarness(
      {
        files: {
          "/tree/root.txt": "0\n",
          "/tree/a/l1.txt": "1\n",
          "/tree/a/b/l2.txt": "2\n",
          "/tree/a/b/c/l3.txt": "3\n",
          "/tree/a/b/c/d/l4.txt": "4\n",
        },
      },
      async (h) => {
        const r = await h.expectOk('find /tree -mindepth 2 -maxdepth 3 -type f | sort');
        assert.equal(
          r.stdout,
          [
            "/tree/a/b/l2.txt",
            "/tree/a/l1.txt",
            "",
          ].join("\n"),
        );

        const rDepth0 = await h.expectOk("find /tree -maxdepth 0");
        assert.equal(rDepth0.stdout, "/tree\n");
      },
    );
  });

  it("7. evaluates find -size with c (bytes), k (KiB), +, -, and exact unit specifiers and -empty", async () => {
    await withE2EHarness(
      {
        files: {
          "/sizes/empty.txt": "",
          "/sizes/tiny.txt": "12345",
          "/sizes/medium.txt": "x".repeat(600),
          "/sizes/large.txt": "y".repeat(3000),
          "/sizes/nonempty_dir/item.txt": "hi",
        },
        directories: ["/sizes/empty_dir"],
      },
      async (h) => {
        const rEmpty = await h.expectOk("find /sizes -empty | sort");
        assert.equal(
          rEmpty.stdout,
          [
            "/sizes/empty.txt",
            "/sizes/empty_dir",
            "",
          ].join("\n"),
        );

        const rExact = await h.expectOk("find /sizes -type f -size 5c");
        assert.equal(rExact.stdout, "/sizes/tiny.txt\n");

        const rBetween = await h.expectOk("find /sizes -type f -size +100c -size -2000c");
        assert.equal(rBetween.stdout, "/sizes/medium.txt\n");

        const rLarge = await h.expectOk("find /sizes -type f -size +2k");
        assert.equal(rLarge.stdout, "/sizes/large.txt\n");
      },
    );
  });

  it("8. evaluates find -perm exact, -perm -mode (all bits), and -perm /mode (any bit)", async () => {
    await withE2EHarness(
      {
        files: {
          "/perms/ro.txt": { content: "ro\n", mode: 0o444 },
          "/perms/rw.txt": { content: "rw\n", mode: 0o644 },
          "/perms/exec.sh": { content: "#!/bin/sh\n", mode: 0o755 },
          "/perms/priv.sh": { content: "#!/bin/sh\n", mode: 0o700 },
        },
      },
      async (h) => {
        const rExact = await h.expectOk("find /perms -type f -perm 0755");
        assert.equal(rExact.stdout, "/perms/exec.sh\n");

        const rAllExec = await h.expectOk("find /perms -type f -perm -0100 | sort");
        assert.equal(
          rAllExec.stdout,
          [
            "/perms/exec.sh",
            "/perms/priv.sh",
            "",
          ].join("\n"),
        );

        const rAnyGroupWriteOrExec = await h.expectOk("find /perms -type f -perm /0030 | sort");
        assert.equal(rAnyGroupWriteOrExec.stdout, "/perms/exec.sh\n");
      },
    );
  });

  it("9. evaluates find -newer and ! -newer against reference file modification timestamps", async () => {
    const tOld = new Date("2025-01-01T00:00:00Z");
    const tRef = new Date("2025-06-01T00:00:00Z");
    const tNew1 = new Date("2025-09-01T00:00:00Z");
    const tNew2 = new Date("2025-12-01T00:00:00Z");

    await withE2EHarness(
      {
        files: {
          "/times/old.log": { content: "old\n", mtime: tOld },
          "/times/ref.marker": { content: "ref\n", mtime: tRef },
          "/times/new1.log": { content: "new1\n", mtime: tNew1 },
          "/times/new2.log": { content: "new2\n", mtime: tNew2 },
        },
      },
      async (h) => {
        const rNewer = await h.expectOk("find /times -type f -newer /times/ref.marker | sort");
        assert.equal(
          rNewer.stdout,
          [
            "/times/new1.log",
            "/times/new2.log",
            "",
          ].join("\n"),
        );

        const rNotNewer = await h.expectOk("find /times -type f ! -newer /times/ref.marker | sort");
        assert.equal(
          rNotNewer.stdout,
          [
            "/times/old.log",
            "/times/ref.marker",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("10. executes find -exec ... \\; and batched -exec ... {} + with exit status propagation", async () => {
    await withE2EHarness(
      {
        files: {
          "/batch/f1.txt": "line1\nline2\n",
          "/batch/f2.txt": "line3\n",
          "/batch/f3.txt": "line4\nline5\nline6\n",
          "/batch/skip.md": "ignored\n",
        },
      },
      async (h) => {
        const rPlus = await h.expectOk('find /batch -name "*.txt" -exec wc -l {} + | tail -n 1');
        assert.match(rPlus.stdout.trim(), /^6\s+total$/);

        const rSemi = await h.expectOk('find /batch -name "*.txt" -exec basename {} .txt \\; | sort');
        assert.equal(rSemi.stdout, "f1\nf2\nf3\n");
      },
    );
  });

  it("11. executes find -delete and -depth post-order traversal without leaving orphan directories", async () => {
    await withE2EHarness(
      {
        files: {
          "/cleanup/keep/a.keep": "keep\n",
          "/cleanup/purge/sub/c.tmp": "remove\n",
          "/cleanup/purge/d.tmp": "remove\n",
        },
      },
      async (h) => {
        const rDepth = await h.expectOk("find /cleanup/purge -depth");
        const lines = rDepth.stdout.trim().split("\n");
        // Post-order: children appear before their parent directory
        assert.equal(lines[lines.length - 1], "/cleanup/purge");
        assert.ok(lines.indexOf("/cleanup/purge/sub/c.tmp") < lines.indexOf("/cleanup/purge/sub"));

        await h.expectOk("find /cleanup/purge -delete");
        const rRemaining = await h.expectOk("find /cleanup/keep -type f");
        assert.equal(rRemaining.stdout, "/cleanup/keep/a.keep\n");
        const rFd = await h.expectOk("fd -t f . /cleanup");
        assert.equal(rFd.stdout, "/cleanup/keep/a.keep\n");
      },
    );
  });

  it("12. evaluates rg .gitignore, nested .gitignore override (!pattern), .ignore, .rgignore, and -u/-uu/-uuu flags", async () => {
    await withE2EHarness(
      {
        directories: ["/ig/.git"],
        files: {
          "/ig/.gitignore": "*.log\nbuild/\n",
          "/ig/.ignore": "secret.txt\n",
          "/ig/.rgignore": "local_skip.txt\n",
          "/ig/app.ts": "TARGET_HIT\n",
          "/ig/debug.log": "TARGET_HIT\n",
          "/ig/secret.txt": "TARGET_HIT\n",
          "/ig/local_skip.txt": "TARGET_HIT\n",
          "/ig/.hidden.ts": "TARGET_HIT\n",
          "/ig/build/out.js": "TARGET_HIT\n",
          "/ig/sub/.gitignore": "!important.log\n",
          "/ig/sub/important.log": "TARGET_HIT\n",
          "/ig/sub/other.log": "TARGET_HIT\n",
        },
      },
      async (h) => {
        const rDefault = await h.expectOk("rg -l TARGET_HIT /ig | sort");
        assert.equal(
          rDefault.stdout,
          [
            "/ig/app.ts",
            "/ig/sub/important.log",
            "",
          ].join("\n"),
        );

        const rHidden = await h.expectOk("rg --hidden -l TARGET_HIT /ig | sort");
        assert.equal(
          rHidden.stdout,
          [
            "/ig/.hidden.ts",
            "/ig/app.ts",
            "/ig/sub/important.log",
            "",
          ].join("\n"),
        );

        const rUnrestricted2 = await h.expectOk("rg -uu -l TARGET_HIT /ig | sort");
        assert.equal(
          rUnrestricted2.stdout,
          [
            "/ig/.hidden.ts",
            "/ig/app.ts",
            "/ig/build/out.js",
            "/ig/debug.log",
            "/ig/local_skip.txt",
            "/ig/secret.txt",
            "/ig/sub/important.log",
            "/ig/sub/other.log",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("13. evaluates rg -g/--glob inclusion and negation rules and -t/--type / -T/--type-not filters", async () => {
    await withE2EHarness(
      {
        files: {
          "/src/main.ts": " needle \n",
          "/src/main.test.ts": " needle \n",
          "/src/util.js": " needle \n",
          "/src/style.css": " needle \n",
          "/src/README.md": " needle \n",
        },
      },
      async (h) => {
        const rGlob = await h.expectOk('rg -l -g "*.ts" -g "!*.test.ts" needle /src');
        assert.equal(rGlob.stdout, "/src/main.ts\n");

        const rType = await h.expectOk("rg -l -t ts -t js -g '!*.test.ts' needle /src | sort");
        assert.equal(rType.stdout, "/src/main.ts\n/src/util.js\n");

        const rTypeNot = await h.expectOk("rg -l -T ts -T js -T css needle /src");
        assert.equal(rTypeNot.stdout, "/src/README.md\n");
      },
    );
  });

  it("14. evaluates rg -F (fixed strings), -w (word), -x (line), -v (invert), -i/-S (smart case), and -o/-r replacements", async () => {
    await withE2EHarness(
      {
        files: {
          "/text/sample.txt": [
            "foo(1) bar_foo foo",
            "FOO",
            "foo",
            "user=alice&role=admin",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rFixed = await h.expectOk('rg -F "foo(1)" /text/sample.txt');
        assert.equal(rFixed.stdout, "foo(1) bar_foo foo\n");

        const rWord = await h.expectOk("rg -o -w foo /text/sample.txt");
        assert.equal(rWord.stdout, "foo\nfoo\nfoo\n");

        const rLine = await h.expectOk("rg -n -x foo /text/sample.txt");
        assert.equal(rLine.stdout, "3:foo\n");

        // Smart case: lowercase pattern matches both foo and FOO; uppercase pattern matches only FOO
        const rSmartLower = await h.expectOk("rg -S -x foo /text/sample.txt");
        assert.equal(rSmartLower.stdout, "FOO\nfoo\n");
        const rSmartUpper = await h.expectOk("rg -S -x FOO /text/sample.txt");
        assert.equal(rSmartUpper.stdout, "FOO\n");

        const rReplace = await h.expectOk("rg -o 'user=[a-z]+&role=[a-z]+' -r 'REDACTED_AUTH' /text/sample.txt");
        assert.equal(rReplace.stdout, "REDACTED_AUTH\n");

        const rCaptureRejected = await h.exec("rg -o 'user=([a-z]+)' -r '$1' /text/sample.txt");
        assert.equal(rCaptureRejected.exitCode, 2);
      },
    );
  });

  it("15. evaluates rg context lines (-B, -A, -C) with overlapping windows and group separators", async () => {
    await withE2EHarness(
      {
        files: {
          "/ctx/log.txt": [
            "line 1",
            "MATCH_A",
            "line 3",
            "MATCH_B",
            "line 5",
            "line 6",
            "line 7",
            "MATCH_C",
            "line 9",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.expectOk("rg -n -C 1 'MATCH_[ABC]' /ctx/log.txt");
        assert.equal(
          r.stdout,
          [
            "1-line 1",
            "2:MATCH_A",
            "3-line 3",
            "4:MATCH_B",
            "5-line 5",
            "--",
            "7-line 7",
            "8:MATCH_C",
            "9-line 9",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("16. evaluates rg --json structured event stream (begin, match, context, end, summary)", async () => {
    await withE2EHarness(
      {
        files: {
          "/json/data.txt": "before\nhello_world\nafter\n",
        },
      },
      async (h) => {
        const r = await h.expectOk("rg --json -C 1 'hello_[a-z]+' /json/data.txt");
        const events = r.stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { type: string; data?: Record<string, unknown> });
        const types = events.map((e) => e.type);
        assert.deepEqual(types, ["begin", "context", "match", "context", "end", "summary"]);
        const matchEvent = events.find((e) => e.type === "match")!;
        assert.equal((matchEvent.data as { line_number: number }).line_number, 2);
      },
    );
  });

  it("17. evaluates rg --files, -l (--files-with-matches), and --files-without-match with -0 NUL delimiters", async () => {
    await withE2EHarness(
      {
        files: {
          "/scan/a.txt": "has_token\n",
          "/scan/b.txt": "no_match\n",
          "/scan/c.txt": "has_token again\n",
        },
      },
      async (h) => {
        const rFiles = await h.expectOk("rg --files /scan | sort");
        assert.equal(rFiles.stdout, "/scan/a.txt\n/scan/b.txt\n/scan/c.txt\n");

        const rWith = await h.expectOk("rg -l -0 has_token /scan | tr '\\0' '\\n' | sort");
        assert.equal(rWith.stdout, "/scan/a.txt\n/scan/c.txt\n");

        const rWithout = await h.expectOk("rg --files-without-match has_token /scan");
        assert.equal(rWithout.stdout, "/scan/b.txt\n");
      },
    );
  });

  it("18. evaluates grep / egrep / fgrep with -f pattern files, -e multiple patterns, -m max-count, -b byte-offset, and -H/-h", async () => {
    await withE2EHarness(
      {
        files: {
          "/grep/patterns.txt": "WARN\nERROR\n",
          "/grep/service.log": [
            "INFO boot",
            "WARN low disk",
            "INFO request",
            "ERROR timeout",
            "ERROR retry failed",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const rPatFile = await h.expectOk("grep -n -f /grep/patterns.txt /grep/service.log");
        assert.equal(
          rPatFile.stdout,
          [
            "2:WARN low disk",
            "4:ERROR timeout",
            "5:ERROR retry failed",
            "",
          ].join("\n"),
        );

        const rMax2 = await h.expectOk("grep -H -m 2 -f /grep/patterns.txt /grep/service.log");
        assert.equal(
          rMax2.stdout,
          [
            "/grep/service.log:WARN low disk",
            "/grep/service.log:ERROR timeout",
            "",
          ].join("\n"),
        );

        const rByteOffset = await h.expectOk("grep -b -o ERROR /grep/service.log");
        assert.equal(rByteOffset.stdout, "37:ERROR\n51:ERROR\n");
      },
    );
  });

  it("19. evaluates fd file discovery with -e extension, -t type, -d max-depth, -E exclude, -H hidden, and -0 xargs pipeline", async () => {
    await withE2EHarness(
      {
        files: {
          "/fdroot/src/app.ts": "const a = 1;\n",
          "/fdroot/src/lib.ts": "const b = 2;\n",
          "/fdroot/src/.secret.ts": "const s = 3;\n",
          "/fdroot/vendor/skip.ts": "const v = 4;\n",
          "/fdroot/README.md": "# doc\n",
        },
      },
      async (h) => {
        const rBasic = await h.expectOk("fd -e ts -E vendor . /fdroot | sort");
        assert.equal(
          rBasic.stdout,
          [
            "/fdroot/src/app.ts",
            "/fdroot/src/lib.ts",
            "",
          ].join("\n"),
        );

        const rHidden = await h.expectOk("fd -H -e ts -E vendor -0 . /fdroot | xargs -0 wc -l | tail -n 1");
        assert.match(rHidden.stdout.trim(), /^3\s+total$/);
      },
    );
  });

  it("20. executes multi-stage find + rg + awk + sort + uniq pipeline auditing markers across a repository tree", async () => {
    await withE2EHarness(
      {
        files: {
          "/audit/services/auth/login.ts": "// @owner:security\nexport function login() {}\n// @owner:security\n",
          "/audit/services/auth/token.ts": "// @owner:security\n// @owner:platform\n",
          "/audit/services/billing/invoice.ts": "// @owner:finance\n",
          "/audit/services/billing/tax.ts": "// @owner:finance\n// @owner:platform\n",
          "/audit/services/legacy/old.bak": "// @owner:deprecated\n",
        },
      },
      async (h) => {
        const r = await h.expectOk(
          'find /audit/services -type f -name "*.ts" -print0 | xargs -0 rg --no-filename -o "@owner:[a-z]+" | sort | uniq -c | awk \'{print $2 ":" $1}\' | sort',
        );
        assert.equal(
          r.stdout,
          [
            "@owner:finance:2",
            "@owner:platform:2",
            "@owner:security:3",
            "",
          ].join("\n"),
        );
      },
    );
  });
});
