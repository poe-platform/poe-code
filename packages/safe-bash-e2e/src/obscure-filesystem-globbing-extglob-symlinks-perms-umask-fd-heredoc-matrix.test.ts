import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure filesystem, shopt globbing (extglob/globstar/dotglob/nullglob/nocaseglob/failglob), symlinks, perms, FD & heredoc matrix", () => {
  it("1. shopt -s extglob composite negation !(patternlist) with +(pat), @(pat), and ?(pat)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/eg && cd /workspace/eg
        touch app.ts app.test.ts app.spec.ts util.js README.md a.log aa.log aaa.log b.log ab.log
        shopt -s extglob
        printf "neg:%s\\n" !(*.test.ts|*.spec.ts|*.md|*.log) | sort
        printf "plus:%s\\n" +(a).log | sort
        printf "at:%s\\n" @(a|b).log | sort
        printf "q:%s\\n" ?(a)b.log | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "neg:app.ts",
          "neg:util.js",
          "plus:a.log",
          "plus:aa.log",
          "plus:aaa.log",
          "at:a.log",
          "at:b.log",
          "q:ab.log",
          "q:b.log",
        ].join("\n"),
      );
    });
  });

  it("2. shopt -s globstar and nullglob recursive directory globbing with unmatched pattern suppression", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/gs/a/b /workspace/gs/.hidden
        touch /workspace/gs/root.txt /workspace/gs/a/mid.txt /workspace/gs/a/b/deep.txt /workspace/gs/.hidden/sec.txt
        cd /workspace/gs
        shopt -s globstar nullglob
        printf "%s\\n" **/*.txt *.nonexistent | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["a/b/deep.txt", "a/mid.txt", "root.txt"].join("\n"),
      );
    });
  });

  it("3. shopt -s dotglob and nocaseglob hidden file and case-insensitive glob matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/dg && cd /workspace/dg
        touch .env .gitignore Alpha.TXT beta.txt GAMMA.Md
        c1=$(printf "%s\\n" * | wc -l | tr -d " ")
        shopt -s dotglob nocaseglob
        c2=$(printf "%s\\n" * | sort | paste -sd "," -)
        c3=$(printf "%s\\n" *.txt | sort | paste -sd "," -)
        echo "$c1 | $c2 | $c3"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "3 | .env,.gitignore,Alpha.TXT,GAMMA.Md,beta.txt | Alpha.TXT,beta.txt",
      );
    });
  });

  it("4. shopt -s failglob aborts unmatched glob expansion with status 1 without running command", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/fg && cd /workspace/fg
        touch ok.txt
        shopt -s failglob
        (echo *.nope) 2>/dev/null
        rc1=$?
        echo *.txt
        rc2=$?
        echo "rc1=$rc1 rc2=$rc2"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "ok.txt\nrc1=1 rc2=0");
    });
  });

  it("5. chained symlinks with readlink, readlink -f, and realpath --relative-to", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/sym/dir/sub /workspace/sym/other
        echo "target-payload" > /workspace/sym/dir/sub/real.txt
        ln -s sub/real.txt /workspace/sym/dir/link1.txt
        ln -s dir/link1.txt /workspace/sym/link2.txt
        echo "rl:$(readlink /workspace/sym/link2.txt)"
        echo "rlf:$(readlink -f /workspace/sym/link2.txt)"
        echo "rel:$(realpath --relative-to=/workspace/sym/other /workspace/sym/dir/sub/real.txt)"
        echo "cat:$(cat /workspace/sym/link2.txt)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "rl:dir/link1.txt",
          "rlf:/workspace/sym/dir/sub/real.txt",
          "rel:../dir/sub/real.txt",
          "cat:target-payload",
        ].join("\n"),
      );
    });
  });

  it("6. cp -P (preserve symlink) vs cp -L (dereference symlink) and ln -sf replacement", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/cps
        echo "real-content-v1" > /workspace/cps/target1.txt
        echo "real-content-v2" > /workspace/cps/target2.txt
        ln -s target1.txt /workspace/cps/sym.txt
        cp -P /workspace/cps/sym.txt /workspace/cps/copy_link.txt
        cp -L /workspace/cps/sym.txt /workspace/cps/copy_deref.txt
        test -L /workspace/cps/copy_link.txt && echo "link=yes:$(readlink /workspace/cps/copy_link.txt)"
        test ! -L /workspace/cps/copy_deref.txt && test -f /workspace/cps/copy_deref.txt && echo "deref=yes:$(cat /workspace/cps/copy_deref.txt)"
        ln -sf target2.txt /workspace/cps/sym.txt
        echo "after-relink:sym=$(cat /workspace/cps/sym.txt):deref=$(cat /workspace/cps/copy_deref.txt)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "link=yes:target1.txt",
          "deref=yes:real-content-v1",
          "after-relink:sym=real-content-v2:deref=real-content-v1",
        ].join("\n"),
      );
    });
  });

  it("7. chmod octal and symbolic clauses (u+x,g-w,o+r), install -d/-m, and stat -c formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        install -d /workspace/perm/bin
        echo "#!/bin/sh" > /workspace/perm/run.sh
        chmod 0640 /workspace/perm/run.sh
        s1=$(stat -c "%a" /workspace/perm/run.sh)
        chmod u+x,g-w,o+r /workspace/perm/run.sh
        s2=$(stat -c "%a" /workspace/perm/run.sh)
        install -m 0755 /workspace/perm/run.sh /workspace/perm/bin/app
        s3=$(stat -c "%a|%s|%F" /workspace/perm/bin/app)
        echo "$s1 -> $s2 | $s3"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "640 -> 744 | 755|10|regular file");
    });
  });

  it("8. heredoc <<-EOF tab-stripping with parameter/arithmetic expansion vs single-quoted literal heredoc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        NAME="world"
        cat <<-EOF
		hello $NAME
			indented $((2 + 3))
	EOF
        cat <<'LITERAL'
    $NAME $((2 + 3)) \`not_eval\`
LITERAL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trimEnd(),
        "hello world\nindented 5\n    $NAME $((2 + 3)) `not_eval`",
      );
    });
  });

  it("9. herestring <<< with custom IFS read -r -a array splitting and brace cartesian expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        IFS=":" read -r -a parts <<< "alpha:beta:gamma:delta"
        echo "count=\${#parts[@]} second=\${parts[1]} last=\${parts[3]}"
        printf "%s\\n" svc-{api,worker}-{01..03}.{json,yaml} | wc -l | tr -d " "
        printf "%s\\n" {a..d}{1..2} | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["count=4 second=beta last=delta", "12", "a1,a2,b1,b2,c1,c2,d1,d2"].join("\n"),
      );
    });
  });

  it("10. file descriptor 3>&1 1>&2 2>&3 stdout/stderr swap and set -C noclobber with >| override", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        swapped=$( { echo "to-out"; echo "to-err" >&2; } 3>&1 1>&2 2>&3 )
        echo "swapped:$swapped"
        set -C
        echo "first" > /workspace/nc.txt
        (echo "second" > /workspace/nc.txt) 2>/dev/null || echo "blocked"
        echo "forced" >| /workspace/nc.txt
        cat /workspace/nc.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr.trim(), "to-out");
      assert.equal(
        res.stdout.trim(),
        ["swapped:to-err", "blocked", "forced"].join("\n"),
      );
    });
  });

  it("11. pushd and popd directory stack navigation and subshell cwd/env isolation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/nav/alpha /workspace/nav/beta /workspace/nav/gamma
        cd /workspace/nav/alpha
        pushd /workspace/nav/beta >/dev/null
        pushd /workspace/nav/gamma >/dev/null
        p1=$(pwd)
        popd >/dev/null
        p2=$(pwd)
        popd >/dev/null
        p3=$(pwd)
        VAR="outer"
        (
          cd /workspace/nav/gamma
          VAR="inner"
          echo "sub:$(pwd):$VAR"
        )
        echo "$p1 | $p2 | $p3 | $(pwd):$VAR"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "sub:/workspace/nav/gamma:inner",
          "/workspace/nav/gamma | /workspace/nav/beta | /workspace/nav/alpha | /workspace/nav/alpha:outer",
        ].join("\n"),
      );
    });
  });

  it("12. find with multiple -prune branches, -exec ... +, and -newer timestamp reference", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/fp/src/lib /workspace/fp/node_modules/pkg /workspace/fp/dist
        printf "10\\n" > /workspace/fp/root.ts
        printf "20\\n" > /workspace/fp/src/index.ts
        printf "30\\n" > /workspace/fp/src/lib/util.ts
        printf "999\\n" > /workspace/fp/node_modules/pkg/index.ts
        printf "888\\n" > /workspace/fp/dist/out.ts
        find /workspace/fp -name node_modules -prune -o -name dist -prune -o -type f -name "*.ts" -print | sort
        touch -d "2022-01-01T00:00:00Z" /workspace/fp/root.ts /workspace/fp/src/index.ts
        touch -d "2025-01-01T00:00:00Z" /workspace/fp/src/lib/util.ts
        touch -r /workspace/fp/root.ts /workspace/fp/ref.stamp
        find /workspace/fp/src -type f -newer /workspace/fp/ref.stamp | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "/workspace/fp/root.ts",
          "/workspace/fp/src/index.ts",
          "/workspace/fp/src/lib/util.ts",
          "/workspace/fp/src/lib/util.ts",
        ].join("\n"),
      );
    });
  });

  it("13. find -print0 piped to sort -z and xargs -0 on paths with embedded spaces", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p "/workspace/sp/dir with spaces"
        echo "hello world" > "/workspace/sp/dir with spaces/file one.txt"
        echo "foo bar baz" > "/workspace/sp/dir with spaces/file two.txt"
        find /workspace/sp -type f -print0 | sort -z | xargs -0 wc -w | awk '{print $1}' | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "2,3,5");
    });
  });

  it("14. xargs -I {} replacement placeholder and xargs -n batching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "alpha\\nbeta\\ngamma\\n" | xargs -I {} echo "item=[{}]"
        printf "1 2 3 4 5 6\\n" | xargs -n 2 echo "pair:"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "item=[alpha]",
          "item=[beta]",
          "item=[gamma]",
          "pair: 1 2",
          "pair: 3 4",
          "pair: 5 6",
        ].join("\n"),
      );
    });
  });

  it("15. process substitution <(cmd) with diff -u and paste -d", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        diff -u <(printf "a\\nb\\nc\\n") <(printf "a\\nb2\\nc\\n") | grep "^[+-][^+-]"
        paste -d ":" <(printf "k1\\nk2\\n") <(printf "v1\\nv2\\n")
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["-b", "+b2", "k1:v1", "k2:v2"].join("\n"),
      );
    });
  });

  it("16. dd seek/skip with conv=notrunc in-place binary patching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "0123456789ABCDEF" > /workspace/dd.bin
        printf "xxxx" | dd of=/workspace/dd.bin bs=1 seek=4 conv=notrunc status=none
        cat /workspace/dd.bin
        echo ""
        dd if=/workspace/dd.bin bs=1 skip=2 count=6 status=none
        echo ""
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "0123xxxx89ABCDEF\n23xxxx");
    });
  });

  it("17. split -l -d -a numeric suffix chunking and reassembly", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/spl && cd /workspace/spl
        seq 1 10 > nums.txt
        split -l 3 -d -a 2 nums.txt part_
        ls part_* | sort | paste -sd "," -
        cat part_* | diff -q - nums.txt && echo "reassembled=ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "part_00,part_01,part_02,part_03\nreassembled=ok",
      );
    });
  });

  it("18. truncate -s shrink and +N relative extension with zero-byte padding", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "0123456789" > /workspace/tr.bin
        truncate -s 4 /workspace/tr.bin
        s1=$(wc -c < /workspace/tr.bin | tr -d " ")
        c1=$(cat /workspace/tr.bin)
        truncate -s +6 /workspace/tr.bin
        s2=$(wc -c < /workspace/tr.bin | tr -d " ")
        echo "$s1:$c1:$s2"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "4:0123:10");
    });
  });

  it("19. mktemp file/directory templates, tee -a multi-target fanout, and basename/dirname -s", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        f=$(mktemp /workspace/tmp.XXXXXX)
        d=$(mktemp -d /workspace/dir.XXXXXX)
        test -f "$f" && test -d "$d" && echo "mktemp=ok"
        echo "line1" | tee /workspace/t1.txt /workspace/t2.txt >/dev/null
        echo "line2" | tee -a /workspace/t1.txt /workspace/t2.txt >/dev/null
        diff -q /workspace/t1.txt /workspace/t2.txt && paste -sd "," /workspace/t1.txt
        basename -s .tar.gz /path/to/archive.tar.gz /other/pkg.tar.gz | paste -sd "," -
        dirname /a/b/c.txt /x/y/ relative.txt | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["mktemp=ok", "line1,line2", "archive,pkg", "/a/b,/x,."].join("\n"),
      );
    });
  });

  it("20. cp --backup=numbered, mv -n no-clobber, and rmdir nested empty directory cleanup", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/ops/empty/a/b
        echo "v1" > /workspace/ops/target.txt
        echo "v2" > /workspace/ops/src.txt
        cp --backup=numbered /workspace/ops/src.txt /workspace/ops/target.txt
        echo "cur=$(cat /workspace/ops/target.txt) bak=$(cat /workspace/ops/target.txt.~1~)"
        echo "v3" > /workspace/ops/other.txt
        mv -n /workspace/ops/other.txt /workspace/ops/target.txt
        echo "after-mv-n=$(cat /workspace/ops/target.txt)"
        rmdir /workspace/ops/empty/a/b /workspace/ops/empty/a /workspace/ops/empty
        test ! -d /workspace/ops/empty && echo "rmdir=ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["cur=v2 bak=v1", "after-mv-n=v2", "rmdir=ok"].join("\n"),
      );
    });
  });
});
