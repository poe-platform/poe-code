import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure rg, grep, fd, find, tree, du, stat, file, and glob/ignore traversal matrix", () => {
  it("1. rg -U (--multiline) and --multiline-dotall match patterns spanning multiple lines", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'TXT' > sample.rs
fn alpha() {
    let x = 10;
    return x;
}
fn beta() {
    let y = 20;
}
TXT
        rg -U -n 'fn alpha\(\) \{\n\s+let x = \d+;' sample.rs
        rg -U --multiline-dotall -o 'fn beta\(\).*?\}' sample.rs
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "1:fn alpha() {\n2:    let x = 10;\nfn beta() {\n    let y = 20;\n}\n"
      );
    });
  });

  it("2. rg -r (--replace) substitutes numbered and named capture groups in matched lines and -o mode", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'TXT' > users.txt
user=alice id=101
user=bob id=202
TXT
        rg 'user=(\w+) id=(\d+)' -r '$2:$1' users.txt
        rg -o 'user=(?P<name>\w+) id=(?P<uid>\d+)' -r '$name#$uid' users.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "101:alice\n202:bob\nalice#101\nbob#202\n");
    });
  });

  it("3. rg --json emits structured begin, match, end, and summary events consumable by jq", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'alpha=1\nbeta=2\nalpha=3\n' > config.ini
        rg --json 'alpha=(\d+)' config.ini | jq -c 'select(.type == "match") | {line: .data.line_number, text: .data.lines.text, sub: .data.submatches[0].match.text}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"line":1,"text":"alpha=1\\n","sub":"alpha=1"}\n{"line":3,"text":"alpha=3\\n","sub":"alpha=3"}\n'
      );
    });
  });

  it("4. rg --files respects .gitignore, -g inclusion/negation globs, -t/-T file types, and -u/-uu unrestricted flags", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p proj/.git proj/src proj/dist
        printf 'dist/\n*.log\n' > proj/.gitignore
        printf 'export const a = 1;\n' > proj/src/app.ts
        printf 'export const b = 2;\n' > proj/src/app.test.ts
        printf 'console.log(1);\n' > proj/dist/bundle.js
        printf 'debug\n' > proj/debug.log
        printf 'secret\n' > proj/.env

        cd proj
        echo "--- default --files ---"
        rg --files | sort
        echo "--- glob exclude test ---"
        rg --files -g '!*.test.ts' | sort
        echo "--- unrestricted -uu ---"
        rg --files -uu -g '!/.git/**' | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "--- default --files ---",
          "src/app.test.ts",
          "src/app.ts",
          "--- glob exclude test ---",
          "src/app.ts",
          "--- unrestricted -uu ---",
          ".env",
          ".gitignore",
          "debug.log",
          "dist/bundle.js",
          "src/app.test.ts",
          "src/app.ts",
          "",
        ].join("\n")
      );
    });
  });

  it("5. rg context flags (-A, -B, -C) with custom --context-separator, -S smart-case, -w, and -F", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'TXT' > log.txt
line1
WARN: disk full
line3
line_gap
line4
WARN: cpu high
line6
TXT
        rg -n -C 1 --context-separator='===' 'WARN' log.txt
        printf 'foo bar foobar\nFoo bar\n' | rg -S -w 'foo'
        printf 'Foo bar\nfoo bar\n' | rg -S 'Foo'
        printf 'a+b=c\na1b=c\n' | rg -F 'a+b'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1-line1",
          "2:WARN: disk full",
          "3-line3",
          "===",
          "5-line4",
          "6:WARN: cpu high",
          "7-line6",
          "foo bar foobar",
          "Foo bar",
          "Foo bar",
          "a+b=c",
          "",
        ].join("\n")
      );
    });
  });

  it("6. rg --count vs --count-matches and -m (--max-count) limit per-file matches", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'aa aa\naa\nbb\naa aa aa\n' > items.txt
        rg -c 'aa' items.txt
        rg --count-matches 'aa' items.txt
        rg -m 2 'aa' items.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3\n6\naa aa\naa\n");
    });
  });

  it("7. grep -E, -F, -o, -n, -b, -w, and -x extract and anchor matches accurately", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        cat <<'TXT' > data.txt
item=120usd
item=45eur
item=300usd
TXT
        grep -E -o '[0-9]+usd' data.txt
        grep -E -n '^item=[0-9]{2}eur$' data.txt
        printf 'cat\ncaterpillar\nbobcat\n' | grep -w 'cat'
        printf 'exact\nnot exact\n' | grep -x 'exact'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "120usd\n300usd\n2:item=45eur\ncat\nexact\n");
    });
  });

  it("8. grep -r recursive search supports --include, --exclude, --exclude-dir, -l, and -L", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p tree/src tree/vendor tree/notes
        printf 'TARGET_TOKEN\n' > tree/src/a.ts
        printf 'NOTHING_HERE\n' > tree/src/b.ts
        printf 'TARGET_TOKEN\n' > tree/src/ignore.bak
        printf 'TARGET_TOKEN\n' > tree/vendor/lib.ts
        printf 'TARGET_TOKEN\n' > tree/notes/readme.md

        grep -r -l --include='*.ts' --exclude-dir=vendor 'TARGET_TOKEN' tree | sort
        grep -r -L --include='*.ts' --exclude-dir=vendor 'TARGET_TOKEN' tree | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "tree/src/a.ts\ntree/src/b.ts\n");
    });
  });

  it("9. fd filters by extension (-e), type (-t), exclude (-E), hidden (-H), no-ignore (-I), and exact depth", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p repo/.git repo/pkg/sub repo/build
        printf 'build/\n' > repo/.gitignore
        touch repo/pkg/index.ts repo/pkg/sub/util.ts repo/pkg/sub/util.js repo/pkg/.hidden.ts repo/build/out.ts

        cd repo
        echo "--- ts files ---"
        fd -e ts | sort
        echo "--- hidden + ignored ts ---"
        fd -H -I -e ts -E .git | sort
        echo "--- exact depth 2 dirs ---"
        fd -t d --exact-depth 2 | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "--- ts files ---",
          "pkg/index.ts",
          "pkg/sub/util.ts",
          "--- hidden + ignored ts ---",
          "build/out.ts",
          "pkg/.hidden.ts",
          "pkg/index.ts",
          "pkg/sub/util.ts",
          "--- exact depth 2 dirs ---",
          "pkg/sub/",
          "",
        ].join("\n")
      );
    });
  });

  it("10. fd -x (--exec) expands {}, {/}, {//}, {.}, {/.} placeholders and -X (--exec-batch) batches results", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p work/mod
        touch work/mod/alpha.tar.gz work/mod/beta.txt
        fd -e gz . work -x echo "full={} base={/} dir={//} noext={.} stem={/.}" \;
        fd -t f . work -X echo "batch:" \;
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "full=work/mod/alpha.tar.gz base=alpha.tar.gz dir=work/mod noext=work/mod/alpha.tar stem=alpha.tar",
          "batch: work/mod/alpha.tar.gz work/mod/beta.txt",
          "",
        ].join("\n")
      );
    });
  });

  it("11. find evaluates grouped boolean predicates ( -o / ! ), -path, -iname, -regex, and -prune", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p app/src app/node_modules/pkg app/test
        touch app/src/Main.TS app/src/helper.js app/src/notes.md app/node_modules/pkg/index.ts app/test/spec.ts

        find app -name node_modules -prune -o -type f \( -iname '*.ts' -o -name '*.js' \) -print | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "app/src/Main.TS",
          "app/src/helper.js",
          "app/test/spec.ts",
          "",
        ].join("\n")
      );
    });
  });

  it("12. find filters by -type, -size, -perm, -empty, and -mindepth/-maxdepth", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p bin empty_dir
        touch empty_file.txt
        printf '12345678901234567890' > medium.txt
        seq 1 600 > large.bin
        printf '#!/bin/sh\necho hi\n' > bin/run.sh
        chmod 755 bin/run.sh

        echo "--- empty ---"
        find . -maxdepth 2 -empty | sort
        echo "--- size > 1k ---"
        find . -type f -size +1k | sort
        echo "--- perm 755 ---"
        find . -type f -perm 0755 | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "--- empty ---",
          "./empty_dir",
          "./empty_file.txt",
          "--- size > 1k ---",
          "./large.bin",
          "--- perm 755 ---",
          "./bin/run.sh",
          "",
        ].join("\n")
      );
    });
  });

  it("13. find -printf formats metadata directives (%p, %f, %h, %s, %y) and -exec batches with +", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p data/sub
        printf 'hello' > data/sub/a.txt
        printf 'world!!' > data/sub/b.txt
        find data -type f -printf '%y %f %h %s\n' | sort
        find data -type f -name '*.txt' -exec echo "files:" {} +
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      const lines = res.stdout.trim().split("\n");
      assert.equal(lines[0], "f a.txt data/sub 5");
      assert.equal(lines[1], "f b.txt data/sub 7");
      assert.ok(
        lines[2] === "files: data/sub/a.txt data/sub/b.txt" ||
          lines[2] === "files: data/sub/b.txt data/sub/a.txt"
      );
    });
  });

  it("14. tree renders directory hierarchies with -L depth, -d dirs-only, -I ignore, -P pattern, and -a hidden", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p myproj/src myproj/docs myproj/node_modules/lib
        touch myproj/.gitignore myproj/src/index.ts myproj/src/notes.txt myproj/docs/guide.md

        tree -I 'node_modules' -P '*.ts' myproj
        tree -d -L 1 -I 'node_modules' myproj
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(res.stdout.includes("index.ts"));
      assert.ok(!res.stdout.includes("notes.txt"));
      assert.ok(!res.stdout.includes("node_modules"));
      assert.ok(res.stdout.includes("docs"));
    });
  });

  it("15. tree -J outputs valid JSON structure with directory and file report counts", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p pkg/src pkg/test
        touch pkg/src/a.ts pkg/src/b.ts pkg/test/a.test.ts
        tree -J pkg | jq -c '{root: .[0].name, child_dirs: [.[0].contents[].name], report: .[1]}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      const parsed = JSON.parse(res.stdout.trim());
      assert.equal(parsed.root, "pkg");
      assert.deepEqual(parsed.child_dirs, ["src", "test"]);
      assert.equal(parsed.report.files, 3);
    });
  });

  it("16. stat -c (--format) and -L inspect regular files, empty files, directories, and symlinks", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p dir
        touch empty.txt
        printf 'abcdef' > dir/six.txt
        chmod 750 dir/six.txt
        ln -s dir/six.txt link_six

        stat -c '%n|%F|%s' empty.txt
        stat -c '%n|%F|%s|%a|%A' dir/six.txt
        stat -c '%F' link_six
        stat -L -c '%F|%s|%a' link_six
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "empty.txt|regular empty file|0",
          "dir/six.txt|regular file|6|750|-rwxr-x---",
          "symbolic link",
          "regular file|6|750",
          "",
        ].join("\n")
      );
    });
  });

  it("17. du -b, -s, -d (--max-depth), and --exclude compute byte totals across directory trees", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p store/a store/b
        printf '1234567890' > store/a/ten.txt
        printf '12345678901234567890' > store/b/twenty.txt
        printf '12345' > store/b/ignore.bak

        du -b -d 1 store
        du -b -s --exclude='*.bak' store
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "10\tstore/a",
          "25\tstore/b",
          "35\tstore",
          "30\tstore",
          "",
        ].join("\n")
      );
    });
  });

  it("18. file detects magic headers, MIME types (--mime-type), brief mode (-b), and symlink dereference (-L)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        sqlite3 app.db "CREATE TABLE t(id INT);"
        printf '%%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%%%EOF\n' > doc.pdf
        printf '#!/bin/sh\necho ok\n' > run.sh
        printf '{"ok":true}\n' > data.json
        touch blank.txt
        ln -s doc.pdf link.pdf

        file -b app.db doc.pdf run.sh data.json blank.txt
        file -b --mime-type app.db doc.pdf data.json link.pdf
        file -b -L --mime-type link.pdf
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "SQLite 3.x database",
          "PDF document",
          "shell script, ASCII text",
          "JSON text data",
          "empty",
          "application/vnd.sqlite3",
          "application/pdf",
          "application/json",
          "inode/symlink",
          "application/pdf",
          "",
        ].join("\n")
      );
    });
  });

  it("19. realpath, readlink -f, dirname, and basename -s resolve chained symlinks and relative segments", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p /tmp/rp_test/a/b /tmp/rp_test/c
        printf 'ok\n' > /tmp/rp_test/a/b/target.tar.gz
        ln -s ../a/b/target.tar.gz /tmp/rp_test/c/hop1
        ln -s c/hop1 /tmp/rp_test/hop2

        realpath /tmp/rp_test/hop2
        readlink -f /tmp/rp_test/hop2
        dirname /tmp/rp_test/a/b/target.tar.gz
        basename -s .tar.gz /tmp/rp_test/a/b/target.tar.gz
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "/tmp/rp_test/a/b/target.tar.gz",
          "/tmp/rp_test/a/b/target.tar.gz",
          "/tmp/rp_test/a/b",
          "target",
          "",
        ].join("\n")
      );
    });
  });

  it("20. end-to-end codebase audit pipeline: fd -> rg --json -> jq -> stat", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p src/core src/ui
        cat <<'SRC1' > src/core/engine.ts
export function run() {
  // TODO(auth): validate token expiry
  // TODO(perf): cache compiled query
  return true;
}
SRC1
        cat <<'SRC2' > src/ui/view.ts
export function render() {
  // TODO(ui): add dark mode toggle
  return "<div/>";
}
SRC2
        rg --json 'TODO\(([a-z]+)\): (.+)' src \
          | jq -c 'select(.type == "match") | {file: .data.path.text, line: .data.line_number, text: (.data.lines.text | sub("\\n$"; "") | sub("^\\s+// "; ""))}' \
          | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"file":"src/core/engine.ts","line":2,"text":"TODO(auth): validate token expiry"}',
          '{"file":"src/core/engine.ts","line":3,"text":"TODO(perf): cache compiled query"}',
          '{"file":"src/ui/view.ts","line":2,"text":"TODO(ui): add dark mode toggle"}',
          "",
        ].join("\n")
      );
    });
  });
});
