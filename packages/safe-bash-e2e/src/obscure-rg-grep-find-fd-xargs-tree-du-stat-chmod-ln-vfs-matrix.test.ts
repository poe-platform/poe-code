import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure rg, grep, find, fd, xargs, tree, du, stat, chmod, ln & VFS matrix", () => {
  it("01: filters files with rg -g positive and negated globs and reports per-file counts (-c)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/repo/src /workspace/repo/test
        printf 'TODO: fix A\\nTODO: fix B\\n' > /workspace/repo/src/app.ts
        printf 'TODO: test A\\n' > /workspace/repo/test/app.test.ts
        printf 'clean\\n' > /workspace/repo/src/clean.ts
        rg -c -g '*.ts' -g '!*.test.ts' 'TODO' /workspace/repo | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/workspace/repo/src/app.ts:2\n");
    });
  });

  it("02: rewrites regex capture groups across structured logs via rg -o -r", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'LOG' > /workspace/events.log
2026-03-01 user=alice action=login
2026-03-02 user=bob action=logout
LOG
        rg -o 'user=([a-z]+) action=([a-z]+)' -r '$1:$2' /workspace/events.log
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alice:login\nbob:logout\n");
    });
  });

  it("03: combines rg -F -w fixed-string word matching and --files-without-match", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/scan
        printf 'foo.bar\\n' > /workspace/scan/a.txt
        printf 'foo_bar\\n' > /workspace/scan/b.txt
        printf 'fooXbar\\n' > /workspace/scan/c.txt
        rg -F -w 'foo.bar' -l /workspace/scan | sort
        echo "---WITHOUT---"
        rg --files-without-match 'foo\\.bar' /workspace/scan | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/scan/a.txt\n---WITHOUT---\n/workspace/scan/b.txt\n/workspace/scan/c.txt\n",
      );
    });
  });

  it("04: searches recursively with grep -rn --include, --exclude, and -m max-count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/gdir
        printf 'err 1\\nok\\nerr 2\\nerr 3\\n' > /workspace/gdir/app.log
        printf 'err skip\\n' > /workspace/gdir/debug.tmp
        grep -rn --include='*.log' --exclude='*.tmp' -m 2 '^err' /workspace/gdir
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/gdir/app.log:1:err 1\n/workspace/gdir/app.log:3:err 2\n",
      );
    });
  });

  it("05: distinguishes matching (-l) and non-matching (-L) files with grep -x exact line match", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'alpha\\nbeta\\n' > /workspace/g1.txt
        printf 'alpha_extra\\nbeta\\n' > /workspace/g2.txt
        grep -x 'alpha' -l /workspace/g1.txt /workspace/g2.txt
        grep -x 'alpha' -L /workspace/g1.txt /workspace/g2.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/workspace/g1.txt\n/workspace/g2.txt\n");
    });
  });

  it("06: evaluates grouped boolean expressions in find with -maxdepth and -not", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/froot/sub/deep
        touch /workspace/froot/a.ts /workspace/froot/b.js /workspace/froot/sub/c.ts /workspace/froot/sub/ignore.ts /workspace/froot/sub/deep/d.ts
        find /workspace/froot -maxdepth 2 -type f \\( -name '*.ts' -o -name '*.js' \\) -not -name 'ignore*' | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/froot/a.ts\n/workspace/froot/b.js\n/workspace/froot/sub/c.ts\n",
      );
    });
  });

  it("07: discovers empty files and directories with find -empty and deletes empty files via -delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/clean/empty_dir /workspace/clean/non_empty
        touch /workspace/clean/empty.txt
        printf 'keep\\n' > /workspace/clean/non_empty/keep.txt
        find /workspace/clean -empty | sort
        find /workspace/clean -type f -empty -delete
        test ! -e /workspace/clean/empty.txt && echo "DELETED_EMPTY_FILE"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/clean/empty.txt\n/workspace/clean/empty_dir\nDELETED_EMPTY_FILE\n",
      );
    });
  });

  it("08: executes batched commands via find -exec ... {} +", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/batch
        printf '10\\n' > /workspace/batch/a.num
        printf '20\\n' > /workspace/batch/b.num
        printf '30\\n' > /workspace/batch/c.num
        find /workspace/batch -name '*.num' -exec cat {} + | sort -n | awk '{s+=$1} END {print s}'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "60\n");
    });
  });

  it("09: handles filenames with spaces safely via find -print0 | sort -z | xargs -0", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/nullspace
        printf 'A' > '/workspace/nullspace/file one.txt'
        printf 'BB' > '/workspace/nullspace/file two.txt'
        find /workspace/nullspace -type f -print0 | sort -z | xargs -0 wc -c | tail -n 1 | awk '{print $1, $2}'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "3 total\n");
    });
  });

  it("10: filters by extension (-e), type (-t f), and exclude pattern (-E) in fd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/fdtest/src /workspace/fdtest/dist
        touch /workspace/fdtest/src/index.ts /workspace/fdtest/src/util.ts /workspace/fdtest/dist/bundle.ts
        fd -t f -e ts -E 'dist' . /workspace/fdtest | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/fdtest/src/index.ts\n/workspace/fdtest/src/util.ts\n",
      );
    });
  });

  it("11: substitutes arguments into shell templates with xargs -I {}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'alpha\\nbeta\\ngamma\\n' | xargs -I {} sh -c 'printf "[%s]\\n" "{}"'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[alpha]\n[beta]\n[gamma]\n");
    });
  });

  it("12: resolves chained symbolic links across intermediate symlinked directories via ln -s, readlink -f, and cat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/real/dir /workspace/links
        printf 'target-body\\n' > /workspace/real/dir/data.txt
        ln -s /workspace/real/dir /workspace/links/dir_link
        ln -s /workspace/links/dir_link/data.txt /workspace/links/file_link
        readlink /workspace/links/file_link
        readlink -f /workspace/links/file_link
        cat /workspace/links/file_link
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/links/dir_link/data.txt\n/workspace/real/dir/data.txt\ntarget-body\n",
      );
    });
  });

  it("13: mutates octal and symbolic permissions with chmod and inspects metadata via stat -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '#!/bin/sh\\necho hi\\n' > /workspace/run.sh
        chmod 750 /workspace/run.sh
        stat -c '%a %F %s' /workspace/run.sh
        chmod +x,o+r /workspace/run.sh
        stat -c '%a' /workspace/run.sh
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "750 regular file 18\n755\n");
    });
  });

  it("14: renders bounded directory hierarchy with tree -d -L 2 --noreport", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/troot/a/b/c /workspace/troot/d
        touch /workspace/troot/a/file.txt
        tree -d -L 2 --noreport /workspace/troot
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/troot\n|-- a\n|   `-- b\n`-- d\n",
      );
    });
  });

  it("15: reports exact byte sizes across files using du -b", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/duroot/s1 /workspace/duroot/s2
        printf '0123456789' > /workspace/duroot/s1/ten.bin
        printf '01234567890123456789' > /workspace/duroot/s2/twenty.bin
        du -b /workspace/duroot/s1/ten.bin /workspace/duroot/s2/twenty.bin | awk '{print $1 ":" $2}'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "10:/workspace/duroot/s1/ten.bin\n20:/workspace/duroot/s2/twenty.bin\n",
      );
    });
  });

  it("16: detects MIME types across shell scripts, JSON, and PDF files with file -b --mime-type", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '#!/bin/bash\\necho ok\\n' > /workspace/s.sh
        printf '{"hello":"world"}\\n' > /workspace/d.json
        printf '%s\\n' '%PDF-1.5' > /workspace/doc.pdf
        file -b --mime-type /workspace/s.sh /workspace/d.json /workspace/doc.pdf
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "text/x-shellscript\napplication/json\napplication/pdf\n",
      );
    });
  });

  it("17: updates a file in-place at the end of a pipeline using sponge", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '3:gamma\\n1:alpha\\n2:beta\\n' > /workspace/items.txt
        sort -t: -k1,1n /workspace/items.txt | awk -F: '{print $2 "=" $1}' | sponge /workspace/items.txt
        cat /workspace/items.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha=1\nbeta=2\ngamma=3\n");
    });
  });

  it("18: extracts before (-B) and after (-A) context lines with line numbers via grep -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'L1\\nL2\\nMATCH\\nL4\\nL5\\n' > /workspace/ctx.txt
        grep -n -B 1 -A 1 'MATCH' /workspace/ctx.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2-L2\n3:MATCH\n4-L4\n");
    });
  });

  it("19: filters files by byte size thresholds (+10c and -10c) using find -size", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/sz
        printf 'tiny' > /workspace/sz/small.txt
        printf '0123456789abcdefghij' > /workspace/sz/large.txt
        find /workspace/sz -type f -size +10c | sort
        find /workspace/sz -type f -size -10c | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/workspace/sz/large.txt\n/workspace/sz/small.txt\n");
    });
  });

  it("20: aggregates repository FIXME counts across packages via rg -> awk -> jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/audit/pkg1 /workspace/audit/pkg2
        printf 'export const a = 1; // FIXME: p1\\n' > /workspace/audit/pkg1/a.ts
        printf 'export const b = 2; // FIXME: p2\\nexport const c = 3; // FIXME: p3\\n' > /workspace/audit/pkg2/b.ts
        rg -c 'FIXME' /workspace/audit | sort | awk -F: '{ printf "{\\"file\\":\\"%s\\",\\"count\\":%d}\\n", $1, $2 }' | jq -sc 'sort_by(.file)'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        '[{"file":"/workspace/audit/pkg1/a.ts","count":1},{"file":"/workspace/audit/pkg2/b.ts","count":2}]',
      );
    });
  });
});
