import assert from "node:assert/strict";
import { test } from "node:test";
import { withE2EHarness } from "./harness.js";

test("obscure search/fs matrix 01: rg --json output parsed with jq for path, line_number, and submatches", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p src
      cat <<'EOF' > src/app.ts
const alpha = 10;
export function computeBeta(x: number) {
  return x + alpha;
}
EOF
      rg --json "computeBeta|alpha" src/app.ts | jq -r 'select(.type == "match") | "\(.data.path.text):\(.data.line_number):\(.data.submatches[0].match.text)"'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "src/app.ts:1:alpha\nsrc/app.ts:2:computeBeta\nsrc/app.ts:3:alpha\n");
  });
});

test("obscure search/fs matrix 02: rg multiline -U --multiline-dotall with -r capture group replacement", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'EOF' > block.txt
 header
BEGIN_BLOCK
name=widget
value=42
END_BLOCK
footer
EOF
      rg -U --multiline-dotall "BEGIN_BLOCK\nname=(\w+)\nvalue=(\d+)\nEND_BLOCK" -r 'ITEM[$1=$2]' block.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "ITEM[widget=42]\n");
  });
});

test("obscure search/fs matrix 03: rg positive and negative globs (-g), hidden files (--hidden), and --max-depth", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p proj/sub/deep
      printf "MATCH_ME\n" > proj/a.ts
      printf "MATCH_ME\n" > proj/a.bak
      printf "MATCH_ME\n" > proj/.secret.ts
      printf "MATCH_ME\n" > proj/sub/b.ts
      printf "MATCH_ME\n" > proj/sub/deep/c.ts
      rg -l --hidden --max-depth 2 -g "*.ts" -g "!*.bak" "MATCH_ME" proj | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "proj/.secret.ts\nproj/a.ts\nproj/sub/b.ts\n");
  });
});

test("obscure search/fs matrix 04: rg context lines (-B/-A) with custom --context-separator and --count-matches vs -c", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'EOF' > log.txt
line1
hit one hit two
line3
line4
line5
hit three
line7
EOF
      rg -n -B 1 -A 1 --context-separator="===" "hit" log.txt
      rg -c "hit" log.txt
      rg --count-matches "hit" log.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "1-line1\n2:hit one hit two\n3-line3\n===\n5-line5\n6:hit three\n7-line7\n2\n3\n"
    );
  });
});

test("obscure search/fs matrix 05: rg -F fixed-strings, -f pattern file, --files-without-match, and -m max-count", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p d
      printf "a+b*c\nsecond a+b*c\nthird a+b*c\n" > d/one.txt
      printf "nothing here\n" > d/two.txt
      printf "a+b*c\n" > pats.txt
      rg -F -f pats.txt -m 2 d/one.txt
      rg -F -f pats.txt --files-without-match d | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "a+b*c\nsecond a+b*c\nd/two.txt\n");
  });
});

test("obscure search/fs matrix 06: grep -E -o -n, -b byte-offset, -w word, -x line, and context separators", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'EOF' > sample.txt
foo bar_foo foo
exact_line
middle
foo again
EOF
      grep -E -o -n "\bfoo\b" sample.txt
      grep -x -n "exact_line" sample.txt
      grep -b -o "exact_line" sample.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1:foo\n1:foo\n4:foo\n2:exact_line\n16:exact_line\n");
  });
});

test("obscure search/fs matrix 07: grep -r recursive with --include, --exclude, and --exclude-dir", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p tree/src tree/vendor tree/dist
      printf "TARGET\n" > tree/src/main.ts
      printf "TARGET\n" > tree/src/main.test.ts
      printf "TARGET\n" > tree/src/readme.md
      printf "TARGET\n" > tree/vendor/lib.ts
      printf "TARGET\n" > tree/dist/out.ts
      grep -r -l --include="*.ts" --exclude="*.test.ts" --exclude-dir="vendor" --exclude-dir="dist" "TARGET" tree | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "tree/src/main.ts\n");
  });
});

test("obscure search/fs matrix 08: find boolean precedence with parentheses, -not/!, -o, -path, -maxdepth, and -mindepth", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p repo/src repo/dist repo/test
      touch repo/root.ts repo/src/a.ts repo/src/b.js repo/src/c.md repo/dist/bundle.js repo/test/t.ts
      find repo -mindepth 2 -maxdepth 2 -type f \( -name "*.ts" -o -name "*.js" \) ! -path "*/dist/*" | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "repo/src/a.ts\nrepo/src/b.js\nrepo/test/t.ts\n");
  });
});

test("obscure search/fs matrix 09: find -prune skipping ignored directories paired with -o -type f -print", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p app/node_modules/pkg app/.git/objects app/src
      touch app/node_modules/pkg/index.js app/.git/objects/abc app/src/index.ts app/README.md
      find app \( -name "node_modules" -o -name ".git" \) -prune -o -type f -print | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "app/README.md\napp/src/index.ts\n");
  });
});

test("obscure search/fs matrix 10: find -size (+N/-N/0c), -empty, and -perm (exact, -mask, /mask)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p pdir/empty_sub
      : > pdir/empty.txt
      printf "12345" > pdir/small.txt
      printf "0123456789abcdef0123456789abcdef" > pdir/large.txt
      chmod 755 pdir/small.txt
      chmod 640 pdir/large.txt
      chmod 600 pdir/empty.txt
      echo "---empty---"
      find pdir -empty | sort
      echo "---size>10c---"
      find pdir -type f -size +10c | sort
      echo "---perm755---"
      find pdir -type f -perm 0755 | sort
      echo "---perm-u+x---"
      find pdir -type f -perm -0100 | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "---empty---\npdir/empty.txt\npdir/empty_sub\n---size>10c---\npdir/large.txt\n---perm755---\npdir/small.txt\n---perm-u+x---\npdir/small.txt\n"
    );
  });
});

test("obscure search/fs matrix 11: find -exec per-file (;) and batch (+) execution, plus -delete", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p work
      printf "alpha\n" > work/a.tmp
      printf "beta\n" > work/b.tmp
      printf "keep\n" > work/keep.txt
      find work -name "*.tmp" -exec printf "ITEM:%s\n" {} \; | sort
      find work -name "*.tmp" -delete
      find work -type f | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "ITEM:work/a.tmp\nITEM:work/b.tmp\nwork/keep.txt\n");
  });
});

test("obscure search/fs matrix 12: find -print0 piped to xargs -0 -n 2 and xargs -I {} with spaces in filenames", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p "spaced dir"
      printf "one" > "spaced dir/file one.txt"
      printf "two" > "spaced dir/file two.txt"
      find "spaced dir" -type f -print0 | sort -z | xargs -0 -I {} sh -c 'printf "%s=%s\n" "$1" "$(cat "$1")"' _ {}
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "spaced dir/file one.txt=one\nspaced dir/file two.txt=two\n");
  });
});

test("obscure search/fs matrix 13: xargs -r (--no-run-if-empty), -d custom delimiter, -E EOF marker, and -n batching", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "" | xargs -r echo "SHOULD_NOT_PRINT"
      printf "a:b:c:d" | xargs -d : -n 2 printf "[%s,%s]\n"
      printf "one\ntwo\nSTOP\nthree\n" | xargs -E STOP echo "seen:"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "[a,b]\n[c,d]\nseen: one two\n");
  });
});

test("obscure search/fs matrix 14: fd with -e extension, -E exclude, -t type (f/d/e/x), -H hidden, and --max-depth", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p fdtree/sub fdtree/ignored
      : > fdtree/.hidden.sh
      printf "#!/bin/sh\necho hi\n" > fdtree/run.sh
      chmod 755 fdtree/run.sh
      printf "text\n" > fdtree/sub/note.sh
      printf "skip\n" > fdtree/ignored/skip.sh
      echo "---ext-exclude-hidden---"
      fd -H -e sh -E ignored . fdtree | sort
      echo "---exec-only---"
      fd -t x . fdtree | sort
      echo "---empty-only---"
      fd -H -t e . fdtree | sort
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "---ext-exclude-hidden---\nfdtree/.hidden.sh\nfdtree/run.sh\nfdtree/sub/note.sh\n---exec-only---\nfdtree/run.sh\n---empty-only---\nfdtree/.hidden.sh\n"
    );
  });
});

test("obscure search/fs matrix 15: fd -x (--exec) with placeholders {}, {/}, {//}, {.}, {/.}", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p assets/img
      printf "data" > assets/img/photo.png
      fd -e png . assets -x printf "full=%s base=%s dir=%s noext=%s stem=%s\n" {} {/} {//} {.} {/.}
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "full=assets/img/photo.png base=photo.png dir=assets/img noext=assets/img/photo stem=photo\n"
    );
  });
});

test("obscure search/fs matrix 16: chmod symbolic (u+rwx,g=rx,o-rwx, u+s, +t) and octal modes with stat -c", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "hello world!" > script.sh
      chmod 0644 script.sh
      chmod u+x,g=rx,o-r script.sh
      stat -c "%a %A %F %s %n" script.sh
      chmod u+s,+t script.sh
      stat -c "%a %A" script.sh
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "750 -rwxr-x--- regular file 12 script.sh\n5750 -rwsr-x--T\n");
  });
});

test("obscure search/fs matrix 17: chained relative symlinks with ln -s, readlink -f, and realpath --relative-to", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p base/real/dir base/links/sub
      printf "payload\n" > base/real/dir/target.txt
      ln -s ../../real/dir/target.txt base/links/sub/hop1
      ln -s sub/hop1 base/links/hop2
      readlink base/links/hop2
      cat base/links/hop2
      realpath --relative-to=base/links base/links/hop2
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "sub/hop1\npayload\n../real/dir/target.txt\n");
  });
});

test("obscure search/fs matrix 18: cp -r, mv, mkdir -p, and rmdir -p preserving structure and contents", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p orig/a/b orig/empty/x/y
      printf "v1\n" > orig/a/b/data.txt
      chmod 755 orig/a/b/data.txt
      cp -r orig/a copy_a
      mv copy_a/b/data.txt copy_a/b/moved.txt
      rmdir -p orig/empty/x/y
      stat -c "%a" copy_a/b/moved.txt
      cat copy_a/b/moved.txt
      test ! -d orig/empty && echo "empty_pruned"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "755\nv1\nempty_pruned\n");
  });
});

test("obscure search/fs matrix 19: tree with -L, -I, -P, -d, and -J JSON output parsed via jq", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p troot/src troot/ignore_me
      touch troot/src/a.ts troot/src/b.md troot/ignore_me/x.ts
      tree -J -I "ignore_me" -P "*.ts" troot | jq -c '.[1]'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, '{"type":"report","directories":2,"files":1}\n');
  });
});

test("obscure search/fs matrix 20: touch -d/-r timestamps with find -newer, du -s, and file --mime-type -b", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p mdir
      printf "old\n" > mdir/old.txt
      printf "ref\n" > mdir/ref.txt
      printf "{\"ok\":true}\n" > mdir/new.json
      touch -d "2020-01-01T00:00:00Z" mdir/old.txt
      touch -d "2023-06-01T00:00:00Z" mdir/ref.txt
      touch -d "2025-01-01T00:00:00Z" mdir/new.json
      find mdir -type f -newer mdir/ref.txt | sort
      file --mime-type -b mdir/new.json
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "mdir/new.json\napplication/json\n");
  });
});
