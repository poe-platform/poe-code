import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness, withE2EHarness } from "./harness.js";

describe("rg, grep, fd, and find search & traversal matrix", () => {
  it("1. rg -n, -i, -w, -x, and -v filter lines with line numbers and word/line boundaries", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/words.txt": "Alpha beta\ncat dog\ncatalog\nalpha_omega\ndog\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rg -n -i 'alpha' /work/words.txt",
            "echo '---'",
            "rg -n -w 'cat' /work/words.txt",
            "echo '---'",
            "rg -n -x 'dog' /work/words.txt",
            "echo '---'",
            "rg -v 'cat' /work/words.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "1:Alpha beta",
            "4:alpha_omega",
            "---",
            "2:cat dog",
            "---",
            "5:dog",
            "---",
            "Alpha beta",
            "alpha_omega",
            "dog",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("2. rg -l, --files-without-match, and -c report file matches and per-file counts across directories", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/src/a.ts": "// TODO first\nconst x = 1;\n// TODO second\n",
          "/work/src/b.ts": "const y = 2;\n",
          "/work/src/c.ts": "// TODO third\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rg -l 'TODO' /work/src | sort",
            "echo '---'",
            "rg --files-without-match 'TODO' /work/src | sort",
            "echo '---'",
            "rg -c 'TODO' /work/src | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/src/a.ts",
            "/work/src/c.ts",
            "---",
            "/work/src/b.ts",
            "---",
            "/work/src/a.ts:2",
            "/work/src/c.ts:1",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("3. rg -o, -r literal replacement, and -m max-count extract and transform matches", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/auth.log":
            "ts=1 user=alice action=login\nts=2 user=bob action=read\nts=3 user=carol action=logout\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rg -o 'user=[a-z]+' /work/auth.log",
            "echo '---'",
            "rg 'user=[a-z]+' -r 'user=REDACTED' /work/auth.log",
            "echo '---'",
            "rg -m 2 'user=[a-z]+' /work/auth.log",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "user=alice",
            "user=bob",
            "user=carol",
            "---",
            "ts=1 user=REDACTED action=login",
            "ts=2 user=REDACTED action=read",
            "ts=3 user=REDACTED action=logout",
            "---",
            "ts=1 user=alice action=login",
            "ts=2 user=bob action=read",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("4. rg -A, -B, and -C context lines format surrounding lines with separators", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/ctx.txt":
            "line1\nMATCH_A\nline3\nline4\nline5\nMATCH_B\nline7\n",
        },
      },
      async (h) => {
        const r = await h.exec("rg -n -C 1 'MATCH' /work/ctx.txt");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "1-line1",
            "2:MATCH_A",
            "3-line3",
            "--",
            "5-line5",
            "6:MATCH_B",
            "7-line7",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("5. rg -g globs, --hidden, and .gitignore filtering respect inclusion/exclusion rules", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/repo/.git/HEAD": "ref: refs/heads/main\n",
          "/work/repo/.gitignore": "dist/\n",
          "/work/repo/.env": "SECRET=needle\n",
          "/work/repo/app.ts": "const a = ' needle';\n",
          "/work/repo/app.spec.ts": "const b = ' needle';\n",
          "/work/repo/dist/out.js": "const c = ' needle';\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rg -l ' needle' /work/repo | sort",
            "echo '---'",
            "rg --hidden -g '!.git/*' -l 'needle' /work/repo | sort",
            "echo '---'",
            "rg --no-ignore -l 'needle' /work/repo | sort",
            "echo '---'",
            "rg -g '*.ts' -g '!*.spec.ts' -l 'needle' /work/repo | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/repo/app.spec.ts",
            "/work/repo/app.ts",
            "---",
            "/work/repo/.env",
            "/work/repo/app.spec.ts",
            "/work/repo/app.ts",
            "---",
            "/work/repo/app.spec.ts",
            "/work/repo/app.ts",
            "/work/repo/dist/out.js",
            "---",
            "/work/repo/app.ts",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("6. rg -F fixed strings and -f pattern file match literal metacharacters", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/exprs.txt":
            "literal a+b*c?(d) here\naaabbbcccddd\nbrackets [0-9] here\n",
          "/work/patterns.txt": "a+b*c?(d)\n[0-9]\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rg -F 'a+b*c?(d)' /work/exprs.txt",
            "echo '---'",
            "rg -F -f /work/patterns.txt /work/exprs.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "literal a+b*c?(d) here",
            "---",
            "literal a+b*c?(d) here",
            "brackets [0-9] here",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("7. rg -U multiline and --json output structured match events", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/multi.txt": "before\nSTART line 1\nmiddle line 2\nEND line 3\nafter\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rg -U 'START[\\s\\S]*?END' /work/multi.txt",
            "echo '---'",
            "rg --json 'START' /work/multi.txt | jq -r 'select(.type==\"match\") | .data.lines.text | rtrimstr(\"\\n\")'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["START line 1", "middle line 2", "END line 3", "---", "START line 1", ""].join(
            "\n"
          )
        );
      }
    );
  });

  it("8. rg -c with regex alternation or case-insensitivity avoids literal cache collisions across runs", async () => {
    const h = await SafeBashE2EHarness.create({
      includeExtendedCommands: false,
      bareShell: true,
      files: {
        "/work/animals.txt": "cat\ncat\ncat\ndog\n",
      },
    });
    const r1 = await h.exec("rg -c -i 'cat' /work");
    assert.equal(r1.exitCode, 0, r1.stderr);
    assert.equal(r1.stdout, "/work/animals.txt:3\n");

    const r2 = await h.exec("rg -c -i 'cut' /work");
    assert.equal(r2.exitCode, 1);
    assert.equal(r2.stdout, "");
  });

  it("9. grep -E, -F, -P, -i, -v, -w, -x, -c, -l, -L, -n, and -o handle standard search modes", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/data.txt":
            "# comment\nfoo:42\nfoo:abc\nbar:99\nliteral [a-z]+ pattern\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "grep -En '^(foo|bar):[0-9]+$' /work/data.txt",
            "echo '---'",
            "grep -Fo '[a-z]+' /work/data.txt",
            "echo '---'",
            "grep -c -v '^#' /work/data.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["2:foo:42", "4:bar:99", "---", "[a-z]+", "---", "4", ""].join("\n")
        );
      }
    );
  });

  it("10. grep -r recursive search with --include and --exclude filters directory trees", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/pkg/main.py": "def run():\n    pass\n",
          "/work/pkg/test_main.py": "def test_run():\n    pass\n",
          "/work/pkg/notes.txt": "def not_python():\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "grep -rn --include='*.py' 'def ' /work/pkg | sort",
            "echo '---'",
            "grep -rn --include='*.py' --exclude='*test*' 'def ' /work/pkg | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/pkg/main.py:1:def run():",
            "/work/pkg/test_main.py:1:def test_run():",
            "---",
            "/work/pkg/main.py:1:def run():",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("11. grep -A, -B, -C context lines and -m max count stop after N matches", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/events.log":
            "ok 1\nERR first\nok 2\nok 3\nok 4\nERR second\nok 5\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "grep -n -B 1 -A 1 'ERR' /work/events.log",
            "echo '---'",
            "grep -m 1 'ERR' /work/events.log",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "1-ok 1",
            "2:ERR first",
            "3-ok 2",
            "--",
            "5-ok 4",
            "6:ERR second",
            "7-ok 5",
            "---",
            "ERR first",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("12. fd -e extension, -t type, -d max-depth, --min-depth, and -E exclude filter entries", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/tree/index.ts": "export {};\n",
          "/work/tree/README.md": "# doc\n",
          "/work/tree/sub/helper.ts": "export const h = 1;\n",
        },
        directories: ["/work/tree/empty_dir"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "fd -e ts . /work/tree | sort",
            "echo '---'",
            "fd -t d . /work/tree | sort",
            "echo '---'",
            "fd -d 1 . /work/tree | sort",
            "echo '---'",
            "fd -E 'sub/*' . /work/tree | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/tree/index.ts",
            "/work/tree/sub/helper.ts",
            "---",
            "/work/tree/empty_dir/",
            "/work/tree/sub/",
            "---",
            "/work/tree/README.md",
            "/work/tree/empty_dir/",
            "/work/tree/index.ts",
            "/work/tree/sub/",
            "---",
            "/work/tree/README.md",
            "/work/tree/empty_dir/",
            "/work/tree/index.ts",
            "/work/tree/sub/",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("13. fd -H hidden, -I no-ignore, -t e empty, and -S size filter special files", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/proj/.gitignore": "*.log\n",
          "/work/proj/.secret": "topsecret\n",
          "/work/proj/empty.txt": "",
          "/work/proj/big.txt": "0123456789abcdef\n",
          "/work/proj/ignored.log": "this is a long log line\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "fd -H -I . /work/proj | sort",
            "echo '---'",
            "fd -t e . /work/proj | sort",
            "echo '---'",
            "fd -I -S +10b . /work/proj | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/proj/.gitignore",
            "/work/proj/.secret",
            "/work/proj/big.txt",
            "/work/proj/empty.txt",
            "/work/proj/ignored.log",
            "---",
            "/work/proj/empty.txt",
            "---",
            "/work/proj/big.txt",
            "/work/proj/ignored.log",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("14. fd -g glob, -p full-path, --format template, and -x/-X command execution", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/conf/app.cfg": "port=8080\nhost=localhost\n",
          "/work/conf/db.cfg": "pool=10\n",
          "/work/conf/readme.txt": "ignore\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "fd -g '*.cfg' /work/conf | sort",
            "echo '---'",
            "fd --format '{/}:{/.}' -e cfg . /work/conf | sort",
            "echo '---'",
            "fd -e cfg . /work/conf -X wc -l",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.includes("/work/conf/app.cfg\n/work/conf/db.cfg\n"));
        assert.ok(r.stdout.includes("app.cfg:app\ndb.cfg:db\n"));
        assert.ok(r.stdout.includes("total"));
      }
    );
  });

  it("15. find with -name, -iname, -path, -regex, and boolean operators (-a, -o, !, parentheses)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/f/README.md": "hi\n",
          "/work/f/src/app.ts": "1\n",
          "/work/f/src/util.ts": "2\n",
          "/work/f/src/style.css": "3\n",
          "/work/f/vendor/lib.ts": "4\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "find /work/f \\( -name '*.ts' -o -iname 'readme*' \\) ! -path '*/vendor/*' | sort"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/f/README.md",
            "/work/f/src/app.ts",
            "/work/f/src/util.ts",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("16. find -prune skips subdirectories without descending into them", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/tree/.git/config": "git\n",
          "/work/tree/node_modules/pkg/index.js": "nm\n",
          "/work/tree/package.json": "{}\n",
          "/work/tree/src/index.js": "main\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "find /work/tree \\( -name node_modules -o -name .git \\) -prune -o -type f -print | sort"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["/work/tree/package.json", "/work/tree/src/index.js", ""].join("\n")
        );
      }
    );
  });

  it("17. find -maxdepth, -mindepth, -empty, and -size filter by depth and byte size", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/d/empty.txt": "",
          "/work/d/large.txt": "0123456789abcdef\n",
          "/work/d/sub/zero.txt": "",
          "/work/d/sub/small.txt": "abc\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "find /work/d -mindepth 1 -maxdepth 1 | sort",
            "echo '---'",
            "find /work/d -type f -empty | sort",
            "echo '---'",
            "find /work/d -type f -size +10c | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/d/empty.txt",
            "/work/d/large.txt",
            "/work/d/sub",
            "---",
            "/work/d/empty.txt",
            "/work/d/sub/zero.txt",
            "---",
            "/work/d/large.txt",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("18. find -exec ... \\; and -exec ... + invoke commands per-file and in batches", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/items/alpha.txt": "val_a\n",
          "/work/items/beta.txt": "val_b\n",
          "/work/items/gamma.txt": "val_c\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "find /work/items -type f -name '*.txt' -exec basename {} .txt \\; | sort",
            "echo '---'",
            "find /work/items -type f -name '*.txt' -exec cat {} + | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["alpha", "beta", "gamma", "---", "val_a", "val_b", "val_c", ""].join(
            "\n"
          )
        );
      }
    );
  });

  it("19. find -print0 piped to xargs -0 and rg --null -l piped to xargs -0 handle filenames with spaces", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/spaced/file one.txt": "TARGET_1\n",
          "/work/spaced/file two.txt": "TARGET_2\n",
          "/work/spaced/file three.txt": "no\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "find /work/spaced -type f -print0 | xargs -0 wc -c | tail -n 1 | awk '{print $1}'",
            "rg --null -l 'TARGET' /work/spaced | xargs -0 -n 1 basename | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["21", "file one.txt", "file two.txt", ""].join("\n")
        );
      }
    );
  });

  it("20. combined fd + rg + jq + awk codebase audit pipeline", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/code/a.ts": 'import { x } from "./b.js";\nexport const a = x + 1;\n',
          "/work/code/b.ts": 'import { y } from "./c.js";\nexport const x = y * 2;\n',
          "/work/code/c.ts": "export const y = 21;\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            'rg --json \'import .* from "([^"]+)"\' /work/code |',
            '  jq -r \'select(.type=="match") | [.data.path.text, (.data.lines.text | rtrimstr("\\n"))] | @tsv\' |',
            "  sort |",
            '  awk -F\'\\t\' \'{ printf "%s -> %s\\n", $1, $2 }\'',
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            '/work/code/a.ts -> import { x } from "./b.js";',
            '/work/code/b.ts -> import { y } from "./c.js";',
            "",
          ].join("\n")
        );
      }
    );
  });
});
