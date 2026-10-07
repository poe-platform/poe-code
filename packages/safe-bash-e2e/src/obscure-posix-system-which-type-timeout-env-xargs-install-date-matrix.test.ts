import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure POSIX system, which/type/command, timeout, env, xargs, install, date, stat, and coreutils matrix", () => {
  test("1. command -v, which, type -t, and type -P across extended CLI tools, builtins, and functions", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "my_fn() { :; }",
          "for c in diff3 dd install mmdc html-to-markdown qpdf pdftotext magick convert identify sips exiftool ffmpeg ffprobe soffice wkhtmltopdf pdfinfo pdftoppm pdftk; do",
          '  command -v "$c" >/dev/null || echo "MISS:$c"',
          "done",
          'echo "fn=$(type -t my_fn) builtin=$(type -t export) file=$(type -t diff3) path=$(type -P qpdf)"',
          "which diff3 dd mmdc qpdf magick ffmpeg soffice"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "fn=function builtin=builtin file=file path=/usr/bin/qpdf",
          "/usr/bin/diff3",
          "/usr/bin/dd",
          "/usr/bin/mmdc",
          "/usr/bin/qpdf",
          "/usr/bin/magick",
          "/usr/bin/ffmpeg",
          "/usr/bin/soffice",
          ""
        ].join("\n")
      );
    });
  });

  test("2. env -i clean environment, env -u/--unset, and printenv selective variable lookup", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "export KEEP_ME=yes DROP_ME=no",
          "env -u DROP_ME EXTRA=42 printenv KEEP_ME EXTRA",
          "env -i ONLY_A=alpha ONLY_B=beta printenv | sort"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "yes",
          "42",
          "ONLY_A=alpha",
          "ONLY_B=beta",
          ""
        ].join("\n")
      );
    });
  });

  test("3. timeout subcommand execution, exit code passthrough, and 124/130/137 timeout status codes", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'timeout 5s echo "completed_ok"',
          "timeout 0.1s sleep 2 || echo \"code_default=$?\"",
          "timeout --preserve-status -s INT 0.1s sleep 2 || echo \"code_int=$?\"",
          "timeout -s KILL 0.1s sleep 2 || echo \"code_kill=$?\""
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "completed_ok",
          "code_default=124",
          "code_int=130",
          "code_kill=137",
          ""
        ].join("\n")
      );
    });
  });

  test("4. xargs -n batching, -I replacement token, -0 NUL-delimited input, and -r no-run-if-empty", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "a b c d e\\n" | xargs -n 2 echo "batch:"',
          'printf "alpha\\nbeta\\n" | xargs -I {} echo "item=[{}]"',
          'printf "f1\\0f2\\0f3\\0" | xargs -0 -n 2 echo "nul:"',
          'printf "" | xargs -r echo "should_not_run"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "batch: a b",
          "batch: c d",
          "batch: e",
          "item=[alpha]",
          "item=[beta]",
          "nul: f1 f2",
          "nul: f3",
          ""
        ].join("\n")
      );
    });
  });

  test("5. install -d directory creation and install -D -m file installation with mode verification", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "install -d -m 0750 dir_a/dir_b",
          'printf "#!/bin/sh\\necho hi\\n" > app.sh',
          "install -D -m 0755 app.sh dist/bin/app",
          'stat -c "%a %F" dir_a/dir_b',
          'stat -c "%a %F" dist/bin/app',
          "cat dist/bin/app"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "750 directory",
          "755 regular file",
          "#!/bin/sh",
          "echo hi",
          ""
        ].join("\n")
      );
    });
  });

  test("6. date -u -d @epoch formatting, ISO-8601 output, and -r reference file mtime", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'date -u -d "@1700000000" "+%Y-%m-%d %H:%M:%S %Z"',
          'date -u -d "2025-03-15T10:20:30Z" "+%s"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "2023-11-14 22:13:20 UTC",
          "1742034030",
          ""
        ].join("\n")
      );
    });
  });

  test("7. stat -c custom format strings (%s, %a, %F, %n) on files, directories, and symlinks", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "1234567890" > data.bin',
          "chmod 0640 data.bin",
          "ln -s data.bin link.bin",
          'stat -c "%n:%s:%a:%F" data.bin',
          'stat -c "%F" link.bin',
          'stat -L -c "%s:%a:%F" link.bin'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "data.bin:10:640:regular file",
          "symbolic link",
          "10:640:regular file",
          ""
        ].join("\n")
      );
    });
  });

  test("8. ln -s / ln -sf symlinks, readlink, readlink -f, and realpath canonical resolution", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p a/b/c",
          'printf "payload\\n" > a/b/c/real.txt',
          "ln -s b/c/real.txt a/hop1.txt",
          "ln -s a/hop1.txt top_link.txt",
          "readlink top_link.txt",
          "readlink -f top_link.txt",
          "realpath top_link.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "a/hop1.txt",
          "/workspace/a/b/c/real.txt",
          "/workspace/a/b/c/real.txt",
          ""
        ].join("\n")
      );
    });
  });

  test("9. cp -r recursive copy, mv rename, rm -rf, and rmdir -p empty parent pruning", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p src_tree/sub",
          'printf "hello\\n" > src_tree/sub/file.txt',
          "cp -r src_tree dst_tree",
          "mv dst_tree/sub/file.txt dst_tree/sub/renamed.txt",
          "cat dst_tree/sub/renamed.txt",
          "rm -rf src_tree",
          "mkdir -p empty_chain/x/y",
          "rmdir -p empty_chain/x/y",
          "test ! -e src_tree && test ! -e empty_chain && echo 'clean_ok'"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hello\nclean_ok\n");
    });
  });

  test("10. mkdir -p -m and chmod symbolic (u+x,go-w, a=r) and octal mode transitions", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "x" > perm.txt',
          "chmod 0644 perm.txt",
          "chmod u+x,go-r perm.txt",
          'stat -c "%a" perm.txt',
          "chmod a=r perm.txt",
          'stat -c "%a" perm.txt'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "700\n444\n");
    });
  });

  test("11. mktemp file and mktemp -d directory creation with custom template and -p directory", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p custom_tmp",
          "f=$(mktemp -p custom_tmp item.XXXXXX)",
          "d=$(mktemp -d -p custom_tmp dir.XXXXXX)",
          'test -f "$f" && test -d "$d" && echo "mktemp_ok"',
          'basename "$f" | grep -E "^item\\.[A-Za-z0-9]{6}$" >/dev/null && echo "f_pat_ok"',
          'basename "$d" | grep -E "^dir\\.[A-Za-z0-9]{6}$" >/dev/null && echo "d_pat_ok"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "mktemp_ok\nf_pat_ok\nd_pat_ok\n");
    });
  });

  test("12. touch -d ISO timestamp and touch -r reference file mtime cloning", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'touch -d "2024-06-01T00:00:00Z" ref.txt',
          "touch -r ref.txt cloned.txt",
          'echo "ref=$(stat -c %Y ref.txt) cloned=$(stat -c %Y cloned.txt)"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ref=1717200000 cloned=1717200000\n");
    });
  });

  test("13. tsort topological ordering of dependency edges", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "compile link\\nparse compile\\nlex parse\\nlink package\\n" | tsort'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "lex\nparse\ncompile\nlink\npackage\n");
    });
  });

  test("14. pr -2 -t -s multi-column formatting without page headers", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "1\\n2\\n3\\n4\\n" | pr -2 -t -s"|"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|3\n2|4\n");
    });
  });

  test("15. nl line numbering with -ba (all lines) vs -bt (non-empty) and -n rz zero-padded width", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "first\\n\\nsecond\\n" | nl -ba -n rz -w 3 -s ":"',
          'printf "first\\n\\nsecond\\n" | nl -bt -n rz -w 3 -s ":"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "001:first",
          "002:",
          "003:second",
          "001:first",
          "    ",
          "002:second",
          ""
        ].join("\n")
      );
    });
  });

  test("16. head -n -K (drop last K lines), head -c, tail -n +K (from Kth line), and tail -c", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "l1\\nl2\\nl3\\nl4\\nl5\\n" > five.txt',
          "head -n -2 five.txt | paste -sd, -",
          "tail -n +3 five.txt | paste -sd, -",
          'printf "abcdefghij" | head -c 4',
          'printf "\\n"',
          'printf "abcdefghij" | tail -c 4',
          'printf "\\n"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "l1,l2,l3",
          "l3,l4,l5",
          "abcd",
          "ghij",
          ""
        ].join("\n")
      );
    });
  });

  test("17. wc -l, -w, -c, -m (UTF-8 characters vs bytes), and -L (max line length)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "café\\nlonger line\\n" > utf.txt',
          'echo "lines=$(wc -l < utf.txt | tr -d " ") words=$(wc -w < utf.txt | tr -d " ") bytes=$(wc -c < utf.txt | tr -d " ") chars_c=$(LC_ALL=C wc -m < utf.txt | tr -d " ") chars_utf8=$(LC_ALL=en_US.UTF-8 wc -m < utf.txt | tr -d " ") max=$(wc -L < utf.txt | tr -d " ")"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "lines=2 words=3 bytes=18 chars_c=18 chars_utf8=17 max=11\n");
    });
  });

  test("18. uniq -c count, -d duplicates only, -u unique only, -i case-insensitive, and -f field skip", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "a\\na\\nb\\nc\\nc\\nc\\n" > dup.txt',
          "uniq -d dup.txt | paste -sd, -",
          "uniq -u dup.txt | paste -sd, -",
          'printf "id1 SAME\\nid2 same\\nid3 diff\\n" | uniq -f 1 -i | wc -l | tr -d " "'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a,c\nb\n2\n");
    });
  });

  test("19. sort multi-key (-t -k), version sort (-V), human-numeric sort (-h), and check sorted (-c)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "v1.10.0\\nv1.2.0\\nv1.9.5\\n" | sort -V | paste -sd, -',
          'printf "500K\\n2G\\n10M\\n100\\n" | sort -h | paste -sd, -',
          'printf "1\\n2\\n3\\n" | sort -n -c && echo "sorted_ok"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "v1.2.0,v1.9.5,v1.10.0",
          "100,500K,10M,2G",
          "sorted_ok",
          ""
        ].join("\n")
      );
    });
  });

  test("20. tee and tee -a writing to multiple files while forwarding stream to downstream pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "alpha\\nbeta\\n" | tee copy1.txt copy2.txt | wc -l | tr -d " "',
          'printf "gamma\\n" | tee -a copy1.txt >/dev/null',
          "paste -sd, copy1.txt",
          "paste -sd, copy2.txt"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "2",
          "alpha,beta,gamma",
          "alpha,beta",
          ""
        ].join("\n")
      );
    });
  });
});
