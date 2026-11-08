import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: search (rg, grep, fd, find), tree, du, stat, file, glob, and ignore matrix", () => {
  it("1. rg core search modes (-F, -i, -S smart-case, -w word, -x line, -v invert, -c count, -l, --files-without-match)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/src",
          'printf "foo\\nfoobar\\nFOO\\nbar(1)\\n" > /work/src/a.txt',
          'printf "only_bar\\nbar(1)\\n" > /work/src/b.txt',
          'echo "fixed=$(rg -F "bar(1)" /work/src | wc -l | tr -d " ")"',
          'echo "word=$(rg -w "foo" /work/src/a.txt)"',
          'echo "smart_lower=$(rg -S "foo" /work/src/a.txt | wc -l | tr -d " ")"',
          'echo "smart_upper=$(rg -S "FOO" /work/src/a.txt | wc -l | tr -d " ")"',
          'echo "line_exact=$(rg -x "foobar" /work/src/a.txt)"',
          'echo "files_with=$(rg -l "FOO" /work/src)"',
          'echo "files_without=$(rg --files-without-match "FOO" /work/src)"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "fixed=2",
          "word=foo",
          "smart_lower=3",
          "smart_upper=1",
          "line_exact=foobar",
          "files_with=/work/src/a.txt",
          "files_without=/work/src/b.txt",
        ].join("\n")
      );
    });
  });

  it("2. rg context lines (-A, -B, -C), -o only-matching, -r literal replacement, and -m max-count", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work",
          'printf "line1\\nline2_TARGET\\nline3\\nline4\\nline5_TARGET\\n" > /work/log.txt',
          "rg -n -C 1 'TARGET' /work/log.txt | head -n 3",
          'echo "---"',
          "rg -o 'v[0-9]+\\.[0-9]+' -r 'REDACTED_VER' <<< 'release v2.14 and v3.8'",
          'echo "---"',
          "rg -m 1 'TARGET' /work/log.txt",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "1-line1",
          "2:line2_TARGET",
          "3-line3",
          "---",
          "REDACTED_VER",
          "REDACTED_VER",
          "---",
          "line2_TARGET",
        ].join("\n")
      );
    });
  });

  it("3. rg --json emits structured begin/match/end/summary JSONL events consumable by jq", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work",
          'printf "alpha = 10\\nbeta = 20\\nalpha = 30\\n" > /work/cfg.toml',
          "rg --json 'alpha = ([0-9]+)' /work/cfg.toml > /work/events.jsonl",
          "jq -r 'select(.type == \"match\") | \"\\(.data.line_number):\\(.data.lines.text | rtrimstr(\"\\n\"))\"' /work/events.jsonl",
          "jq -r 'select(.type == \"summary\") | \"matches=\\(.data.stats.matches)\"' /work/events.jsonl",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "1:alpha = 10",
          "3:alpha = 30",
          "matches=2",
        ].join("\n")
      );
    });
  });

  it("4. rg globs (-g / !exclude), file types (-t / -T), --files mode, and -0 xargs pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/pkg",
          'echo "export const x = 1;" > /work/pkg/index.ts',
          'echo "export const x = 2;" > /work/pkg/index.test.ts',
          'echo "const x = 3;" > /work/pkg/legacy.js',
          "rg -t ts -g '!*.test.ts' --no-filename 'export' /work/pkg",
          "rg --files -g '*.ts' /work/pkg | sort",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "export const x = 1;",
          "/work/pkg/index.test.ts",
          "/work/pkg/index.ts",
        ].join("\n")
      );
    });
  });

  it("5. rg respects .gitignore, .rgignore, --hidden, and -u / -uu unrestricted flags", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/repo/.git /work/repo/dist",
          'printf "dist/\\n*.ignored\\n" > /work/repo/.gitignore',
          'echo "FINDME" > /work/repo/dist/bundle.js',
          'echo "FINDME" > /work/repo/notes.ignored',
          'echo "FINDME" > /work/repo/.hidden.txt',
          'echo "FINDME" > /work/repo/visible.txt',
          'echo "default=$(rg -l FINDME /work/repo | sort | paste -sd "," -)"',
          'echo "hidden=$(rg --hidden -l FINDME /work/repo | sort | paste -sd "," -)"',
          'echo "unrestricted2=$(rg -uu -l FINDME /work/repo | sort | paste -sd "," -)"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "default=/work/repo/visible.txt",
          "hidden=/work/repo/.hidden.txt,/work/repo/visible.txt",
          "unrestricted2=/work/repo/.hidden.txt,/work/repo/dist/bundle.js,/work/repo/notes.ignored,/work/repo/visible.txt",
        ].join("\n")
      );
    });
  });

  it("6. rg -U multiline matching across newline boundaries with line count (-c) and match count (--count-matches)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work",
          'printf "fn start() {\\n  step_one();\\n  step_two();\\n}\\n" > /work/code.rs',
          "rg -U -c 'fn start\\(\\) \\{\\n  step_one\\(\\);\\n  step_two\\(\\);' /work/code.rs",
          "rg -U --count-matches 'fn start\\(\\) \\{\\n  step_one\\(\\);\\n  step_two\\(\\);' /work/code.rs",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "1\n1");
    });
  });

  it("7. grep, egrep, and fgrep with -E, -F, -v, -w, -x, -c, -l, -L, -o, -r, --include, --exclude, and -f", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/g",
          'printf "err_code=404\\nok_code=200\\nerr_code=500\\n" > /work/g/app.log',
          'printf "ok_code=200\\n" > /work/g/health.log',
          'printf "err_code=404\\nerr_code=500\\n" > /work/g/patterns.txt',
          "fgrep -f /work/g/patterns.txt /work/g/app.log",
          "egrep -o '[0-9]{3}' /work/g/app.log | paste -sd ',' -",
          "grep -r -L 'err_code' /work/g --include='*.log'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "err_code=404",
          "err_code=500",
          "404,200,500",
          "/work/g/health.log",
        ].join("\n")
      );
    });
  });

  it("8. fd searches by regex, glob (-g), fixed-strings (-F), extension (-e), type (-t), depth (-d), and size (-S)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/fd_tree/sub/deep",
          "touch /work/fd_tree/empty.txt",
          'printf "small" > /work/fd_tree/sub/code.rs',
          "truncate -s 2048 /work/fd_tree/sub/deep/big.rs",
          "ln -s /work/fd_tree/sub/code.rs /work/fd_tree/link.rs",
          "fd -L -e rs . /work/fd_tree | sort",
          'echo "---"',
          "fd -t e . /work/fd_tree",
          'echo "---"',
          "fd -t l . /work/fd_tree",
          'echo "---"',
          "fd -S +1k . /work/fd_tree",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "/work/fd_tree/link.rs",
          "/work/fd_tree/sub/code.rs",
          "/work/fd_tree/sub/deep/big.rs",
          "---",
          "/work/fd_tree/empty.txt",
          "---",
          "/work/fd_tree/link.rs",
          "---",
          "/work/fd_tree/sub/deep/big.rs",
        ].join("\n")
      );
    });
  });

  it("9. fd ignore rules, --format templates ({/}, {.}, {//}, {/.}), and -x / -X command execution", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/fexec/pkg",
          'printf "one\\ntwo\\n" > /work/fexec/pkg/alpha.txt',
          'printf "three\\n" > /work/fexec/pkg/beta.txt',
          "fd -e txt --format '{//}|{/}|{/.}' . /work/fexec | sort",
          "fd -e txt . /work/fexec -X wc -l | tail -n 1 | awk '{print $1}'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "/work/fexec/pkg|alpha.txt|alpha",
          "/work/fexec/pkg|beta.txt|beta",
          "3",
        ].join("\n")
      );
    });
  });

  it("10. find predicates (-name, -iname, -path, -type, -maxdepth, -mindepth, -empty, -size, -prune)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/find_root/node_modules/pkg /work/find_root/src/core",
          'echo "skip" > /work/find_root/node_modules/pkg/index.js',
          'echo "keep1" > /work/find_root/src/index.ts',
          'echo "keep2" > /work/find_root/src/core/engine.ts',
          "touch /work/find_root/src/empty.log",
          "find /work/find_root -name node_modules -prune -o -type f -name '*.ts' -print | sort",
          "find /work/find_root -type f -empty",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "/work/find_root/src/core/engine.ts",
          "/work/find_root/src/index.ts",
          "/work/find_root/src/empty.log",
        ].join("\n")
      );
    });
  });

  it("11. find actions (-printf, -print0 + xargs -0, -exec {} +, and -delete)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/fa /work/fa/tmp_only",
          'printf "12345" > /work/fa/a.dat',
          'printf "123456789" > /work/fa/b.dat',
          'printf "temp" > /work/fa/tmp_only/remove.tmp',
          "find /work/fa -type f -name '*.dat' -printf '%f:%s\\n' | sort",
          "find /work/fa/tmp_only -name '*.tmp' -delete",
          "find /work/fa -type f | wc -l | tr -d ' '",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "a.dat:5",
          "b.dat:9",
          "2",
        ].join("\n")
      );
    });
  });

  it("12. tree renders hierarchy in text and JSON (-J, -L, -a, -d, -I, -P)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/t/src /work/t/dist",
          'echo "a" > /work/t/src/main.rs',
          'echo "b" > /work/t/src/lib.rs',
          'echo "c" > /work/t/dist/bundle.js',
          "tree -J -I 'dist' /work/t | jq -r '.[0].contents[] | .name'",
          "tree -J /work/t | jq -r '.[1] | \"\\(.directories) dirs, \\(.files) files\"'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "src",
          "3 dirs, 3 files",
        ].join("\n")
      );
    });
  });

  it("13. du disk usage aggregation (-b, -s, -c, --exclude) and df filesystem reporting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/du_test/sub",
          'printf "0123456789" > /work/du_test/ten.txt',
          'printf "01234567890123456789" > /work/du_test/sub/twenty.txt',
          'printf "99999" > /work/du_test/sub/skip.bak',
          "du -b --exclude='*.bak' /work/du_test/sub | awk '{print $1}'",
          "df -h | head -n 1 | awk '{print $1}'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.ok(Number(lines[0]) >= 20, `expected >= 20 bytes, got ${lines[0]}`);
      assert.equal(lines[1], "Filesystem");
    });
  });

  it("14. stat format strings (-c), chmod symbolic/octal modes, ln -s, readlink -f, and realpath", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/meta/dir/sub",
          'printf "hello-stat" > /work/meta/dir/target.sh',
          "chmod 0750 /work/meta/dir/target.sh",
          "chmod g-w,o+r /work/meta/dir/target.sh",
          "stat -c '%F|%a|%s' /work/meta/dir/target.sh",
          "ln -s ../target.sh /work/meta/dir/sub/link.sh",
          "readlink /work/meta/dir/sub/link.sh",
          "readlink -f /work/meta/dir/sub/link.sh",
          "realpath --relative-to=/work/meta /work/meta/dir/sub/link.sh",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "regular file|754|10",
          "../target.sh",
          "/work/meta/dir/target.sh",
          "dir/target.sh",
        ].join("\n")
      );
    });
  });

  it("15. file command classifies PNG, PDF, GZIP, JSON, XML, and shell scripts in brief and MIME modes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/magic",
          "convert -size 16x16 xc:red /work/magic/pic.png",
          'echo "<html><body>hi</body></html>" > /work/magic/in.html',
          "wkhtmltopdf -q /work/magic/in.html /work/magic/doc.pdf",
          'printf "hello" | gzip -c > /work/magic/archive.gz',
          'printf "#!/bin/bash\\necho hi\\n" > /work/magic/script.sh',
          "file -b --mime-type /work/magic/pic.png /work/magic/doc.pdf /work/magic/archive.gz /work/magic/script.sh",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "image/png");
      assert.equal(lines[1], "application/pdf");
      assert.match(lines[2]!, /application\/(x-)?gzip/);
      assert.match(lines[3]!, /text\/x-shellscript/);
    });
  });

  it("16. shopt globbing options: nullglob, dotglob, nocaseglob, extglob, and globstar (**)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/globs/a/b",
          "touch /work/globs/.hidden /work/globs/foo.ts /work/globs/bar.js /work/globs/baz.md /work/globs/a/b/deep.ts",
          "cd /work/globs",
          "shopt -s nullglob",
          "none=(*.nonexistent)",
          'echo "nullglob_count=${#none[@]}"',
          "shopt -s extglob",
          "ext=(@(foo|bar).*)",
          'echo "extglob=${ext[*]}"',
          "shopt -s globstar",
          "all_ts=(**/*.ts)",
          'echo "globstar=${all_ts[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "nullglob_count=0",
          "extglob=bar.js foo.ts",
          "globstar=a/b/deep.ts foo.ts",
        ].join("\n")
      );
    });
  });

  it("17. brace expansion with nested Cartesian products, zero-padded sequences, stepped ranges, and character ranges", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "echo {svc-{api,worker},db.{primary,replica}}",
          "echo {001..004}",
          "echo {10..2..-2}",
          "echo {a..e}",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "svc-api svc-worker db.primary db.replica",
          "001 002 003 004",
          "10 8 6 4 2",
          "a b c d e",
        ].join("\n")
      );
    });
  });

  it("18. which (-a), basename (-a, -s), dirname, and mktemp (-d, -p, template)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /usr/local/bin /usr/bin /work",
          "printf '#!/bin/sh\\n' > /usr/local/bin/mytool",
          "printf '#!/bin/sh\\n' > /usr/bin/mytool",
          "chmod 0755 /usr/local/bin/mytool /usr/bin/mytool",
          "which mytool",
          "which -a mytool | paste -sd ',' -",
          "basename -s .tar.gz /archive/release-v1.tar.gz",
          "dirname /archive/sub/release-v1.tar.gz",
          "tmpd=$(mktemp -d -p /work run.XXXXXX)",
          "[[ -d \"$tmpd\" ]] && echo \"mktemp_dir_ok\"",
          "tmpf=$(mktemp -p \"$tmpd\" item.XXXXXX)",
          "[[ -f \"$tmpf\" ]] && echo \"mktemp_file_ok\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "/usr/local/bin/mytool",
          "/usr/local/bin/mytool,/usr/bin/mytool",
          "release-v1",
          "/archive/sub",
          "mktemp_dir_ok",
          "mktemp_file_ok",
        ].join("\n")
      );
    });
  });

  it("19. cmp compares binary and text files with -s silent, -n byte limit, and skip offsets", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work",
          'printf "abcdef123" > /work/f1.bin',
          'printf "abcdef999" > /work/f2.bin',
          "cmp -s -n 6 /work/f1.bin /work/f2.bin && echo 'prefix_6_equal'",
          "cmp -s /work/f1.bin /work/f2.bin || echo \"full_diff_exit=$?\"",
          "cmp -s /work/f1.bin /work/f2.bin 6 6 || echo 'suffix_diff'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "prefix_6_equal",
          "full_diff_exit=1",
          "suffix_diff",
        ].join("\n")
      );
    });
  });

  it("20. end-to-end monorepo source audit combining fd, rg --json, jq, find, and stat", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/monorepo/.git /work/monorepo/packages/core/src /work/monorepo/packages/cli/src /work/monorepo/node_modules/dep",
          'printf "node_modules/\\n" > /work/monorepo/.gitignore',
          'printf "export function runCore() {\\n  // TODO: optimize\\n  return 1;\\n}\\n" > /work/monorepo/packages/core/src/index.ts',
          'printf "export function runCli() {\\n  // TODO: add flag\\n  return runCore();\\n}\\n" > /work/monorepo/packages/cli/src/cli.ts',
          'printf "// TODO: ignored\\n" > /work/monorepo/node_modules/dep/index.ts',
          "ts_count=$(fd -e ts . /work/monorepo | wc -l | tr -d ' ')",
          "todo_count=$(rg --json 'TODO:' /work/monorepo | jq -r 'select(.type==\"summary\") | .data.stats.matches')",
          'echo "ts_files=$ts_count todos=$todo_count"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "ts_files=2 todos=2");
    });
  });
});
