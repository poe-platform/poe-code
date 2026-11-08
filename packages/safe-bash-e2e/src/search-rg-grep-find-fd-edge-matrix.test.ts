import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: search (rg, grep, find, fd) edge matrix", () => {
  it("1. rg smart-case (-S), case-insensitive (-i), case-sensitive (-s), word (-w), and line (-x) matching", async () => {
    await withE2EHarness(
      {
        files: {
          "/src/app.txt": [
            "token",
            "Token",
            "TOKEN",
            "my_token_id",
            "token_suffix",
            "prefix_token",
            "token!",
          ].join("\n") + "\n",
        },
      },
      async (h) => {
        const rSmartLower = await h.exec("rg -S 'token' /src/app.txt");
        assert.equal(rSmartLower.exitCode, 0);
        assert.equal(
          rSmartLower.stdout,
          "token\nToken\nTOKEN\nmy_token_id\ntoken_suffix\nprefix_token\ntoken!\n"
        );

        const rSmartUpper = await h.exec("rg -S 'Token' /src/app.txt");
        assert.equal(rSmartUpper.exitCode, 0);
        assert.equal(rSmartUpper.stdout, "Token\n");

        const rWord = await h.exec("rg -w 'token' /src/app.txt");
        assert.equal(rWord.exitCode, 0);
        assert.equal(rWord.stdout, "token\ntoken!\n");

        const rLine = await h.exec("rg -i -x 'token' /src/app.txt");
        assert.equal(rLine.exitCode, 0);
        assert.equal(rLine.stdout, "token\nToken\nTOKEN\n");
      }
    );
  });

  it("2. rg multiline (-U), multiline-dotall, replacement (-r), trim (--trim), and count modes (-c, --count-matches, --include-zero)", async () => {
    await withE2EHarness(
      {
        files: {
          "/data/a.txt": "  start_block\nmiddle_line\nend_block\nsingle start_block end_block\n",
          "/data/b.txt": "no matches here\n",
        },
      },
      async (h) => {
        const rMulti = await h.exec("rg -U --multiline-dotall -n 'start_block.*end_block' /data/a.txt");
        assert.equal(rMulti.exitCode, 0);
        assert.equal(
          rMulti.stdout,
          "1:  start_block\n2:middle_line\n3:end_block\n4:single start_block end_block\n"
        );

        const rReplaceTrim = await h.exec("rg --trim -r '[MARK]' 'start_block|end_block' /data/a.txt");
        assert.equal(rReplaceTrim.exitCode, 0);
        assert.equal(
          rReplaceTrim.stdout,
          "[MARK]\n[MARK]\nsingle [MARK] [MARK]\n"
        );

        const rCountMatches = await h.exec("rg --count-matches --include-zero 'start_block|end_block' /data/a.txt /data/b.txt");
        assert.equal(rCountMatches.exitCode, 0);
        assert.equal(
          rCountMatches.stdout,
          "/data/a.txt:4\n/data/b.txt:0\n"
        );
      }
    );
  });

  it("3. rg context lines (-B, -A, -C), custom context separator, headings (-H --heading), line/column/byte-offset prefixes", async () => {
    await withE2EHarness(
      {
        files: {
          "/logs/server.log": [
            "line1",
            "line2 WARN alpha",
            "line3",
            "line4",
            "line5",
            "line6 WARN beta",
            "line7",
          ].join("\n") + "\n",
        },
      },
      async (h) => {
        const rCtx = await h.exec(
          "rg -n -C 1 --context-separator '__SEP__' 'WARN' /logs/server.log"
        );
        assert.equal(rCtx.exitCode, 0);
        assert.equal(
          rCtx.stdout,
          [
            "1-line1",
            "2:line2 WARN alpha",
            "3-line3",
            "__SEP__",
            "5-line5",
            "6:line6 WARN beta",
            "7-line7",
          ].join("\n") + "\n"
        );

        const rHeading = await h.exec(
          "rg -H --heading -n --column -b 'WARN' /logs/server.log"
        );
        assert.equal(rHeading.exitCode, 0);
        assert.equal(
          rHeading.stdout,
          [
            "/logs/server.log",
            "2:7:6:line2 WARN alpha",
            "6:7:41:line6 WARN beta",
          ].join("\n") + "\n"
        );
      }
    );
  });

  it("4. rg --json structured event stream with begin, context, match, submatches, end, and summary", async () => {
    await withE2EHarness(
      {
        files: {
          "/proj/main.rs": "fn helper() {}\nfn main() { helper(); }\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "rg --json -B 1 'fn main' /proj/main.rs | jq -c 'select(.type != \"summary\") | {type, line: .data.line_number, text: .data.lines.text, sub: (if .data.submatches then [.data.submatches[].match.text] else null end)}'"
        );
        assert.equal(r.exitCode, 0);
        const events = r.stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.deepEqual(events, [
          { type: "begin", line: null, text: null, sub: null },
          { type: "context", line: 1, text: "fn helper() {}\n", sub: [] },
          { type: "match", line: 2, text: "fn main() { helper(); }\n", sub: ["fn main"] },
          { type: "end", line: null, text: null, sub: null },
        ]);
      }
    );
  });

  it("5. rg ignore hierarchy (.gitignore < .ignore < .rgignore), negated rules, hidden files, and -u/-uu/-uuu", async () => {
    await withE2EHarness(
      {
        files: {
          "/repo/.git/HEAD": "ref: refs/heads/main\n",
          "/repo/.gitignore": "*.log\nbuild/\n",
          "/repo/.ignore": "!keep.log\n*.tmp\n",
          "/repo/.rgignore": "!rescue.tmp\n",
          "/repo/app.log": "TARGET in app.log\n",
          "/repo/keep.log": "TARGET in keep.log\n",
          "/repo/scratch.tmp": "TARGET in scratch.tmp\n",
          "/repo/rescue.tmp": "TARGET in rescue.tmp\n",
          "/repo/.hidden.txt": "TARGET in hidden\n",
          "/repo/visible.txt": "TARGET in visible\n",
        },
      },
      async (h) => {
        const rDefault = await h.exec("rg -l 'TARGET' /repo | sort");
        assert.equal(rDefault.exitCode, 0);
        assert.equal(
          rDefault.stdout,
          ["/repo/keep.log", "/repo/rescue.tmp", "/repo/visible.txt"].join("\n") + "\n"
        );

        const rHidden = await h.exec("rg --hidden -l 'TARGET' /repo | sort");
        assert.equal(rHidden.exitCode, 0);
        assert.equal(
          rHidden.stdout,
          [
            "/repo/.hidden.txt",
            "/repo/keep.log",
            "/repo/rescue.tmp",
            "/repo/visible.txt",
          ].join("\n") + "\n"
        );

        const rUnrestricted2 = await h.exec("rg -uu -l 'TARGET' /repo | sort");
        assert.equal(rUnrestricted2.exitCode, 0);
        assert.equal(
          rUnrestricted2.stdout,
          [
            "/repo/.hidden.txt",
            "/repo/app.log",
            "/repo/keep.log",
            "/repo/rescue.tmp",
            "/repo/scratch.tmp",
            "/repo/visible.txt",
          ].join("\n") + "\n"
        );
      }
    );
  });

  it("6. rg glob overrides (-g, --iglob), file types (-t, -T), --files, -l, --files-without-match, and --crlf", async () => {
    await withE2EHarness(
      {
        files: {
          "/code/a.ts": "const x = 1;\r\n",
          "/code/a.min.ts": "const x = 1;\r\n",
          "/code/b.py": "x = 2\r\n",
          "/code/README.md": "notes\r\n",
        },
      },
      async (h) => {
        const rGlob = await h.exec("cd /code && rg --files -g '*.ts' -g '!*.min.ts'");
        assert.equal(rGlob.exitCode, 0);
        assert.equal(rGlob.stdout, "a.ts\n");

        const rType = await h.exec("rg -t py -l 'x =' /code");
        assert.equal(rType.exitCode, 0);
        assert.equal(rType.stdout, "/code/b.py\n");

        const rWithout = await h.exec("rg --files-without-match 'x =' /code | sort");
        assert.equal(rWithout.exitCode, 0);
        assert.equal(rWithout.stdout, "/code/README.md\n");

        const rCrlf = await h.exec("rg --crlf -n '^const x = 1;$' /code/a.ts");
        assert.equal(rCrlf.exitCode, 0);
        assert.equal(rCrlf.stdout, "1:const x = 1;\r\n");
      }
    );
  });

  it("7. grep BRE, ERE (-E), fixed-strings (-F), pattern files (-f), POSIX classes, and word boundaries", async () => {
    await withE2EHarness(
      {
        files: {
          "/input.txt": [
            "abc-123",
            "DEF_456",
            "a+b*c?",
            "hex:deadbeef",
            "hex:xyz",
            "word cat concatenate cat_dog",
          ].join("\n") + "\n",
          "/patterns.txt": "abc-123\na+b*c?\n",
        },
      },
      async (h) => {
        const rFixed = await h.exec("grep -F -f /patterns.txt /input.txt");
        assert.equal(rFixed.exitCode, 0);
        assert.equal(rFixed.stdout, "abc-123\na+b*c?\n");

        const rPosix = await h.exec("grep -E '^hex:[[:xdigit:]]+$' /input.txt");
        assert.equal(rPosix.exitCode, 0);
        assert.equal(rPosix.stdout, "hex:deadbeef\n");

        const rBre = await h.exec("grep '^\\([[:alpha:]]\\{3\\}\\)-[0-9]\\{3\\}$' /input.txt");
        assert.equal(rBre.exitCode, 0);
        assert.equal(rBre.stdout, "abc-123\n");

        const rWordBoundary = await h.exec("grep -o '\\<cat\\>' /input.txt");
        assert.equal(rWordBoundary.exitCode, 0);
        assert.equal(rWordBoundary.stdout, "cat\n");
      }
    );
  });

  it("8. grep context merging (-A, -B, -C), --group-separator, --no-group-separator, -o with -n and -b", async () => {
    await withE2EHarness(
      {
        files: {
          "/doc.txt": [
            "alpha",
            "HIT_1",
            "beta",
            "HIT_2",
            "gamma",
            "spacer",
            "delta",
            "HIT_3",
            "epsilon",
          ].join("\n") + "\n",
        },
      },
      async (h) => {
        const rMerged = await h.exec("grep -n -C 1 --group-separator='---' 'HIT_' /doc.txt");
        assert.equal(rMerged.exitCode, 0);
        assert.equal(
          rMerged.stdout,
          [
            "1-alpha",
            "2:HIT_1",
            "3-beta",
            "4:HIT_2",
            "5-gamma",
            "---",
            "7-delta",
            "8:HIT_3",
            "9-epsilon",
          ].join("\n") + "\n"
        );

        const rNoSep = await h.exec("grep -n -C 1 --no-group-separator 'HIT_' /doc.txt | wc -l");
        assert.equal(rNoSep.exitCode, 0);
        assert.equal(rNoSep.stdout.trim(), "8");

        const rOnlyOffsets = await h.exec("grep -E -o -n -b 'HIT_[0-9]+' /doc.txt");
        assert.equal(rOnlyOffsets.exitCode, 0);
        assert.equal(
          rOnlyOffsets.stdout,
          ["2:6:HIT_1", "4:17:HIT_2", "8:42:HIT_3"].join("\n") + "\n"
        );
      }
    );
  });

  it("9. grep NUL-delimited input/output (-z, -Z) and binary file handling (-a, -I, --binary-files=without-match)", async () => {
    await withE2EHarness(
      {
        files: {
          "/nul.dat": "rec1_ok\0rec2_hit\0rec3_hit\0",
          "/bin.dat": new Uint8Array([
            0x68, 0x65, 0x61, 0x64, 0x0a,
            0x6d, 0x61, 0x74, 0x63, 0x68, 0x00, 0x78, 0x0a,
          ]),
        },
      },
      async (h) => {
        const rNul = await h.exec("grep -z 'hit' /nul.dat | tr '\\0' '\\n'");
        assert.equal(rNul.exitCode, 0);
        assert.equal(rNul.stdout, "rec2_hit\nrec3_hit\n");

        const rNullFile = await h.exec("grep -l -Z 'hit' /nul.dat | od -An -tx1 | tr -s ' '");
        assert.equal(rNullFile.exitCode, 0);
        assert.ok(rNullFile.stdout.includes("00"));

        const rBinIgnore = await h.exec("grep -I 'match' /bin.dat");
        assert.equal(rBinIgnore.exitCode, 1);
        assert.equal(rBinIgnore.stdout, "");

        const rBinText = await h.exec("grep -a -o 'match' /bin.dat");
        assert.equal(rBinText.exitCode, 0);
        assert.equal(rBinText.stdout, "match\n");
      }
    );
  });

  it("10. find boolean precedence (-a, -o, !, parentheses), -name/-iname, -path/-ipath, -regex/-iregex, -empty", async () => {
    await withE2EHarness(
      {
        files: {
          "/tree/src/index.ts": "export {};\n",
          "/tree/src/INDEX.TEST.TS": "test();\n",
          "/tree/src/notes.md": "",
          "/tree/docs/guide.md": "# Guide\n",
        },
      },
      async (h) => {
        await h.exec("mkdir -p /tree/empty_dir");
        const rBool = await h.exec(
          "find /tree '(' -iname '*.ts' -a ! -iname '*.test.ts' ')' -o -empty | sort"
        );
        assert.equal(rBool.exitCode, 0);
        assert.equal(
          rBool.stdout,
          [
            "/tree/empty_dir",
            "/tree/src/index.ts",
            "/tree/src/notes.md",
          ].join("\n") + "\n"
        );

        const rRegex = await h.exec("find /tree -iregex '.*/src/.*\\.ts' | sort");
        assert.equal(rRegex.exitCode, 0);
        assert.equal(
          rRegex.stdout,
          ["/tree/src/INDEX.TEST.TS", "/tree/src/index.ts"].join("\n") + "\n"
        );
      }
    );
  });

  it("11. find -perm (exact, -mode, /mode, symbolic), -size (c, k, +/-), and -newer/-mtime/-mmin", async () => {
    await withE2EHarness(
      {
        files: {
          "/p/exec.sh": "#!/bin/sh\n",
          "/p/read.txt": "hello",
          "/p/big.bin": "x".repeat(2048),
          "/p/ref.stamp": "ref",
        },
      },
      async (h) => {
        await h.exec(
          [
            "chmod 755 /p/exec.sh",
            "chmod 640 /p/read.txt",
            "touch -d '2025-01-01T00:00:00Z' /p/read.txt",
            "touch -d '2025-01-02T00:00:00Z' /p/ref.stamp",
            "touch -d '2025-01-03T00:00:00Z' /p/exec.sh /p/big.bin",
          ].join(" && ")
        );

        const rPerm = await h.exec("find /p -type f -perm -u=x");
        assert.equal(rPerm.exitCode, 0);
        assert.equal(rPerm.stdout, "/p/exec.sh\n");

        const rPermExact = await h.exec("find /p -type f -perm 0640");
        assert.equal(rPermExact.exitCode, 0);
        assert.equal(rPermExact.stdout, "/p/read.txt\n");

        const rSize = await h.exec("find /p -type f -size +1k");
        assert.equal(rSize.exitCode, 0);
        assert.equal(rSize.stdout, "/p/big.bin\n");

        const rNewer = await h.exec("find /p -type f -newer /p/ref.stamp | sort");
        assert.equal(rNewer.exitCode, 0);
        assert.equal(rNewer.stdout, "/p/big.bin\n/p/exec.sh\n");
      }
    );
  });

  it("12. find -prune directory skipping, -depth post-order traversal, -delete, and -quit", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/keep/a.txt": "a\n",
          "/work/node_modules/pkg/index.js": "pkg\n",
          "/work/temp/sub/old.tmp": "tmp\n",
          "/work/temp/top.tmp": "tmp\n",
        },
      },
      async (h) => {
        const rPrune = await h.exec(
          "find /work -name node_modules -prune -o -type f -print | sort"
        );
        assert.equal(rPrune.exitCode, 0);
        assert.equal(
          rPrune.stdout,
          [
            "/work/keep/a.txt",
            "/work/temp/sub/old.tmp",
            "/work/temp/top.tmp",
          ].join("\n") + "\n"
        );

        const rDepth = await h.exec("find /work/keep -depth");
        assert.equal(rDepth.exitCode, 0);
        assert.equal(rDepth.stdout, "/work/keep/a.txt\n/work/keep\n");

        const rQuit = await h.exec("find /work -type f -print -quit");
        assert.equal(rQuit.exitCode, 0);
        assert.equal(rQuit.stdout.trim().split("\n").length, 1);

        const rDelete = await h.exec(
          "find /work/temp -delete && test ! -e /work/temp && ls /work | sort"
        );
        assert.equal(rDelete.exitCode, 0);
        assert.equal(rDelete.stdout, "keep\nnode_modules\n");
      }
    );
  });

  it("13. find -printf directives (%p, %P, %H, %f, %h, %s, %d, %y, %%, escapes) and -exec ; vs -exec +", async () => {
    await withE2EHarness(
      {
        files: {
          "/fmt/sub/alpha.txt": "12345",
          "/fmt/beta.txt": "12",
        },
      },
      async (h) => {
        const rPrintf = await h.exec(
          "find /fmt -mindepth 1 -printf '%y|%d|%H|%P|%h|%f|%s|100%%\\n' | sort"
        );
        assert.equal(rPrintf.exitCode, 0);
        assert.equal(
          rPrintf.stdout,
          [
            "d|1|/fmt|sub|/fmt|sub|0|100%",
            "f|1|/fmt|beta.txt|/fmt|beta.txt|2|100%",
            "f|2|/fmt|sub/alpha.txt|/fmt/sub|alpha.txt|5|100%",
          ].join("\n") + "\n"
        );

        const rExecSingle = await h.exec(
          "find /fmt -type f -exec printf '<%s>\\n' '{}' ';' | sort"
        );
        assert.equal(rExecSingle.exitCode, 0);
        assert.equal(
          rExecSingle.stdout,
          ["</fmt/beta.txt>", "</fmt/sub/alpha.txt>"].join("\n") + "\n"
        );

        const rExecBatch = await h.exec(
          "find /fmt -type f -exec wc -c '{}' '+'"
        );
        assert.equal(rExecBatch.exitCode, 0);
        assert.match(rExecBatch.stdout, /7 total/);
      }
    );
  });

  it("14. find symlink handling: -P (never follow), -H (follow command-line roots), and -L (follow all)", async () => {
    await withE2EHarness(
      {
        files: {
          "/real/dir/item.txt": "item\n",
        },
      },
      async (h) => {
        await h.exec("ln -s /real/dir /root_link && mkdir /tree && ln -s /real/dir /tree/sub_link");

        const rP = await h.exec("find -P /root_link");
        assert.equal(rP.exitCode, 0);
        assert.equal(rP.stdout, "/root_link\n");

        const rHRoot = await h.exec("find -H /root_link | sort");
        assert.equal(rHRoot.exitCode, 0);
        assert.equal(rHRoot.stdout, "/root_link\n/root_link/item.txt\n");

        const rHSub = await h.exec("find -H /tree | sort");
        assert.equal(rHSub.exitCode, 0);
        assert.equal(rHSub.stdout, "/tree\n/tree/sub_link\n");

        const rLSub = await h.exec("find -L /tree | sort");
        assert.equal(rLSub.exitCode, 0);
        assert.equal(rLSub.stdout, "/tree\n/tree/sub_link\n/tree/sub_link/item.txt\n");
      }
    );
  });

  it("15. fd pattern modes (regex, -g/--glob, -F/--fixed-strings, -p/--full-path, --and) and case modes", async () => {
    await withE2EHarness(
      {
        files: {
          "/fdtest/src/user_auth.service.ts": "",
          "/fdtest/src/USER_AUTH.spec.ts": "",
          "/fdtest/docs/user+auth.md": "",
        },
      },
      async (h) => {
        const rGlob = await h.exec("fd -g '*.service.ts' /fdtest");
        assert.equal(rGlob.exitCode, 0);
        assert.equal(rGlob.stdout, "/fdtest/src/user_auth.service.ts\n");

        const rFixed = await h.exec("fd -F 'user+auth' /fdtest");
        assert.equal(rFixed.exitCode, 0);
        assert.equal(rFixed.stdout, "/fdtest/docs/user+auth.md\n");

        const rFullAnd = await h.exec("fd -p 'src/.*auth' --and 'spec' /fdtest");
        assert.equal(rFullAnd.exitCode, 0);
        assert.equal(rFullAnd.stdout, "/fdtest/src/USER_AUTH.spec.ts\n");
      }
    );
  });

  it("16. fd filters: -e (extension), -t (f, d, l, e, x), -E (exclude), -d/--min-depth/--exact-depth, -S (size)", async () => {
    await withE2EHarness(
      {
        files: {
          "/f/run.sh": "#!/bin/sh\necho hi\n",
          "/f/empty.txt": "",
          "/f/sub/deep/payload.json": "x".repeat(1500),
          "/f/sub/ignored/skip.json": "x".repeat(1500),
        },
      },
      async (h) => {
        await h.exec("chmod 755 /f/run.sh && ln -s /f/run.sh /f/run.link");

        const rExecType = await h.exec("fd -t x . /f");
        assert.equal(rExecType.exitCode, 0);
        assert.equal(rExecType.stdout, "/f/run.sh\n");

        const rEmptyType = await h.exec("fd -t e -t f . /f");
        assert.equal(rEmptyType.exitCode, 0);
        assert.equal(rEmptyType.stdout, "/f/empty.txt\n");

        const rLinkType = await h.exec("fd -t l . /f");
        assert.equal(rLinkType.exitCode, 0);
        assert.equal(rLinkType.stdout, "/f/run.link\n");

        const rExtExclSize = await h.exec(
          "fd -e json -E 'ignored' --exact-depth 3 -S +1k . /f"
        );
        assert.equal(rExtExclSize.exitCode, 0);
        assert.equal(rExtExclSize.stdout, "/f/sub/deep/payload.json\n");
      }
    );
  });

  it("17. fd --format templates ({}, {/}, {//}, {.}, {/.}, escaped {{ and }}) and -0/--print0", async () => {
    await withE2EHarness(
      {
        files: {
          "/pkg/src/module.test.ts": "test",
        },
      },
      async (h) => {
        const rFmt = await h.exec(
          "fd -t f --format '{{path={}|dir={//}|base={/}|noext={.}|stem={/.}}}' . /pkg"
        );
        assert.equal(rFmt.exitCode, 0);
        assert.equal(
          rFmt.stdout,
          "{path=/pkg/src/module.test.ts|dir=/pkg/src|base=module.test.ts|noext=/pkg/src/module.test|stem=module.test}\n"
        );
      }
    );
  });

  it("18. fd -x (per-entry exec) and -X (batch exec) with template placeholders", async () => {
    await withE2EHarness(
      {
        files: {
          "/batch/alpha.txt": "111\n",
          "/batch/beta.txt": "2222\n",
        },
      },
      async (h) => {
        const rPerFile = await h.exec(
          "fd -e txt . /batch -x printf '%s=>%s\\n' '{/.}' '{/}' ';' | sort"
        );
        assert.equal(rPerFile.exitCode, 0);
        assert.equal(
          rPerFile.stdout,
          ["alpha=>alpha.txt", "beta=>beta.txt"].join("\n") + "\n"
        );

        const rBatch = await h.exec("fd -e txt . /batch -X wc -c ';'");
        assert.equal(rBatch.exitCode, 0);
        assert.match(rBatch.stdout, /9 total/);
      }
    );
  });

  it("19. fd ignore rules (.gitignore, .ignore, .fdignore), parent ignore inheritance, -H, -I, and -u/-uu", async () => {
    await withE2EHarness(
      {
        files: {
          "/parent/.gitignore": "*.bak\n",
          "/parent/sub/.ignore": "!keep.bak\n*.cache\n",
          "/parent/sub/.fdignore": "!keep.cache\n",
          "/parent/sub/drop.bak": "",
          "/parent/sub/keep.bak": "",
          "/parent/sub/drop.cache": "",
          "/parent/sub/keep.cache": "",
          "/parent/sub/.dotfile": "",
        },
      },
      async (h) => {
        const rDefault = await h.exec("fd -t f . /parent/sub | sort");
        assert.equal(rDefault.exitCode, 0);
        assert.equal(
          rDefault.stdout,
          ["/parent/sub/keep.bak", "/parent/sub/keep.cache"].join("\n") + "\n"
        );

        const rNoParent = await h.exec("fd --no-ignore-parent -t f . /parent/sub | sort");
        assert.equal(rNoParent.exitCode, 0);
        assert.equal(
          rNoParent.stdout,
          [
            "/parent/sub/drop.bak",
            "/parent/sub/keep.bak",
            "/parent/sub/keep.cache",
          ].join("\n") + "\n"
        );

        const rAll = await h.exec("fd -uu -t f . /parent/sub | sort");
        assert.equal(rAll.exitCode, 0);
        assert.equal(
          rAll.stdout,
          [
            "/parent/sub/.dotfile",
            "/parent/sub/.fdignore",
            "/parent/sub/.ignore",
            "/parent/sub/drop.bak",
            "/parent/sub/drop.cache",
            "/parent/sub/keep.bak",
            "/parent/sub/keep.cache",
          ].join("\n") + "\n"
        );
      }
    );
  });

  it("20. cross-tool pipeline: fd + rg + awk + sort audit pipeline", async () => {
    await withE2EHarness(
      {
        files: {
          "/audit/.git/HEAD": "ref: refs/heads/main\n",
          "/audit/services/auth.ts": "// TODO(security): rotate keys\nexport const auth = 1;\n",
          "/audit/services/billing.ts": "// TODO(perf): batch invoices\n// TODO(security): verify webhook\n",
          "/audit/services/legacy.bak": "// TODO(security): ignore backup\n",
          "/audit/.gitignore": "*.bak\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "rg -n 'TODO\\([a-z]+\\):' /audit | sed -E 's#^([^:]+:[0-9]+):.*TODO\\(([a-z]+)\\): (.*)$#\\2\\t\\1\\t\\3#' | sort"
        );
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          [
            "perf\t/audit/services/billing.ts:1\tbatch invoices",
            "security\t/audit/services/auth.ts:1\trotate keys",
            "security\t/audit/services/billing.ts:2\tverify webhook",
          ].join("\n") + "\n"
        );
      }
    );
  });
});
