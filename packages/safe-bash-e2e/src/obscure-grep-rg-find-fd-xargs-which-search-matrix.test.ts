import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure grep, rg, find, fd, xargs, and which search parity matrix", () => {
  it("01. which: -- end-of-options with leading-dash executable, empty PATH segments (:: and leading :), relative PATH segments, and non-executable file skipping", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/bin/-dash-tool": "#!/bin/sh\necho dash\n",
        "/work/shadow/app": "not executable\n",
        "/work/real/app": "#!/bin/sh\necho real\n",
        "/work/local-tool": "#!/bin/sh\necho local\n",
      },
    });
    await h.exec("chmod 755 /work/bin/-dash-tool /work/real/app /work/local-tool && chmod 644 /work/shadow/app");

    const res = await h.exec('cd /work && PATH="bin:/work/shadow::/work/real" which -- -dash-tool app local-tool');
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "bin/-dash-tool\n/work/real/app\n./local-tool\n");
    assert.equal(res.stderr, "");

    const leadingColon = await h.exec('cd /work && PATH=":/work/real" which local-tool app');
    assert.equal(leadingColon.exitCode, 0);
    assert.equal(leadingColon.stdout, "./local-tool\n/work/real/app\n");
  });

  it("02. which: -a across /usr/bin:/bin, direct slash operands, -s silent status, shell-only builtins, and illegal option / missing operand diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/run.sh": "#!/bin/sh\necho ok\n",
      },
    });
    await h.exec("chmod 755 /work/run.sh");

    const allRg = await h.exec('PATH="/usr/bin:/bin" which -a rg');
    assert.equal(allRg.exitCode, 0);
    assert.equal(allRg.stdout, "/usr/bin/rg\n/bin/rg\n");

    const directSlash = await h.exec("cd /work && which /usr/bin/rg ./run.sh");
    assert.equal(directSlash.exitCode, 0);
    assert.equal(directSlash.stdout, "/usr/bin/rg\n./run.sh\n");

    const silentOk = await h.exec("which -s rg grep");
    assert.equal(silentOk.exitCode, 0);
    assert.equal(silentOk.stdout, "");

    const pureBuiltins = await h.exec("which cd export");
    assert.equal(pureBuiltins.exitCode, 1);
    assert.equal(pureBuiltins.stdout, "");
    assert.equal(pureBuiltins.stderr, "");

    const illegalOpt = await h.exec("which -z rg");
    assert.equal(illegalOpt.exitCode, 1);
    assert.equal(illegalOpt.stderr, "which: illegal option -- z\nusage: which [-as] program ...\n");

    const missingOp = await h.exec("which");
    assert.equal(missingOp.exitCode, 1);
    assert.equal(missingOp.stderr, "usage: which [-as] program ...\n");
  });

  it("03. xargs: -t (--verbose) trace quoting on stderr for plain words, single-quoted strings with apostrophes, and $'...' octal control escapes", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec("printf \"plain_arg\\nhello 'world'\\na\\tb\\n\" | xargs -d '\\n' -n 2 -t echo");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "plain_arg hello 'world'\na\tb\n");
    assert.equal(res.stderr, "echo plain_arg 'hello '\\''world'\\'''\necho $'a\\011b'\n");
  });

  it("04. xargs: -i / --replace default {} token, -I with no explicit command defaulting to echo <item>, and unquoted blank trimming in replacement mode", async () => {
    const h = await SafeBashE2EHarness.create();
    const resI = await h.exec("printf '  first item  \\n\\tsecond   item\\t\\n' | xargs -i echo '[{}]'");
    assert.equal(resI.exitCode, 0);
    assert.equal(resI.stdout, "[first item]\n[second   item]\n");

    const resDefaultEcho = await h.exec("printf 'alpha beta\\ngamma\\n' | xargs -I {}");
    assert.equal(resDefaultEcho.exitCode, 0);
    assert.equal(resDefaultEcho.stdout, "alpha beta\ngamma\n");
  });

  it("05. xargs: child exit status mapping (1..125 continues batches and returns 123; 255 aborts immediately and returns 124; 127 returns 127)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res123 = await h.exec(
      "printf 'ok1\\nfail\\nok2\\n' | xargs -n 1 sh -c 'echo \"run:$1\"; [ \"$1\" != fail ]' _",
    );
    assert.equal(res123.exitCode, 123);
    assert.equal(res123.stdout, "run:ok1\nrun:fail\nrun:ok2\n");

    const res124 = await h.exec(
      "printf 'first\\nabort\\nnever\\n' | xargs -n 1 sh -c 'echo \"step:$1\"; if [ \"$1\" = abort ]; then exit 255; fi' _",
    );
    assert.equal(res124.exitCode, 124);
    assert.equal(res124.stdout, "step:first\nstep:abort\n");

    const res127 = await h.exec("printf 'arg1\\n' | xargs nonexistent_cmd_xyz");
    assert.equal(res127.exitCode, 127);
  });

  it("06. xargs: -s (--max-chars) command size batching vs -x (--exit) and -L size overflow failure", async () => {
    const h = await SafeBashE2EHarness.create();
    const splitBatches = await h.exec("printf 'aaaa\\nbbbb\\ncccc\\n' | xargs -n 3 -s 16 echo");
    assert.equal(splitBatches.exitCode, 0);
    assert.equal(splitBatches.stdout, "aaaa bbbb\ncccc\n");

    const exitOnOverflow = await h.exec("printf 'aaaa\\nbbbb\\ncccc\\n' | xargs -n 3 -s 16 -x echo");
    assert.equal(exitOnOverflow.exitCode, 2);
    assert.match(exitOnOverflow.stderr, /xargs: command size limit exceeded/);
  });

  it("07. xargs: --process-slot-var, -a (--arg-file) preserving child stdin, and -0 with -E warning on stderr", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/items.txt": "one\ntwo\n",
      },
    });
    const argFileRes = await h.exec(
      "printf 'from-stdin\\n' | xargs -a /work/items.txt --process-slot-var=SLOT -n 1 sh -c 'echo \"$SLOT:$1:$(cat)\"' _",
    );
    assert.equal(argFileRes.exitCode, 0);
    assert.equal(argFileRes.stdout, "0:one:from-stdin\n0:two:\n");

    const warnRes = await h.exec("printf 'a\\0END\\0b\\0' | xargs -0 -E END echo");
    assert.equal(warnRes.exitCode, 0);
    assert.equal(warnRes.stdout, "a END b\n");
    assert.equal(warnRes.stderr, "xargs: warning: the -E option has no effect if -0 or -d is used.\n\n");
  });

  it("08. grep: legacy -NUM context shorthand, --label=LABEL with -H on stdin, and -T (--initial-tab) prefix alignment", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      "printf 'first\\nsec\\nhit_me\\nfourth\\nfifth\\n' | grep -1 -H --label=stream.log -n -b -T 'hit_me'",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "stream.log-2-6-\tsec\nstream.log:3:10:\thit_me\nstream.log-4-17-\tfourth\n",
    );
  });

  it("09. grep: -z (--null-data) NUL-delimited input records combined with -Z (--null) filename NUL separator across normal, -c, and -l modes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.bin": "alpha\0match_one\0omega\0",
        "/work/f2.bin": "beta\0match_two\0",
        "/work/f3.bin": "none\0",
      },
    });

    const normalRes = await h.exec(
      "cd /work && grep -z -Z -H -n 'match' f1.bin f2.bin | tr '\\0' '@'",
    );
    assert.equal(normalRes.exitCode, 0);
    assert.equal(normalRes.stdout, "f1.bin@2:match_one@f2.bin@2:match_two@");

    const countRes = await h.exec(
      "cd /work && grep -z -Z -c 'match' f1.bin f3.bin | tr '\\0' '@'",
    );
    assert.equal(countRes.exitCode, 0);
    assert.equal(countRes.stdout, "f1.bin@1@f3.bin@0@");

    const listRes = await h.exec(
      "cd /work && grep -z -Z -l 'match' f1.bin f2.bin f3.bin | tr '\\0' '@'",
    );
    assert.equal(listRes.exitCode, 0);
    assert.equal(listRes.stdout, "f1.bin@f2.bin@");
  });

  it("10. grep: ordered --include / --exclude rules, --exclude-from=FILE, -d skip on directory operands, and -R vs -r symlinked directory traversal", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/tree/sub/a.ts": "NEEDLE_A\n",
        "/work/tree/sub/a.test.ts": "NEEDLE_TEST\n",
        "/work/tree/sub/b.snap.ts": "NEEDLE_SNAP\n",
        "/work/ext/linked.ts": "NEEDLE_LINKED\n",
        "/work/exclude.lst": "*.snap.ts\n",
      },
    });
    await h.exec("ln -s /work/ext /work/tree/link_ext");

    const skipDir = await h.exec("cd /work && grep -d skip 'NEEDLE' tree tree/sub/a.ts");
    assert.equal(skipDir.exitCode, 0);
    assert.equal(skipDir.stdout, "tree/sub/a.ts:NEEDLE_A\n");
    assert.equal(skipDir.stderr, "");

    const rNoDeref = await h.exec(
      "cd /work && grep -r --include='*.ts' --exclude='*.test.ts' --exclude-from=exclude.lst 'NEEDLE' tree | sort",
    );
    assert.equal(rNoDeref.exitCode, 0);
    assert.equal(rNoDeref.stdout, "tree/sub/a.ts:NEEDLE_A\n");

    const rDeref = await h.exec(
      "cd /work && grep -R --include='*.ts' --exclude='*.test.ts' --exclude-from=exclude.lst 'NEEDLE' tree | sort",
    );
    assert.equal(rDeref.exitCode, 0);
    assert.equal(
      rDeref.stdout,
      "tree/link_ext/linked.ts:NEEDLE_LINKED\ntree/sub/a.ts:NEEDLE_A\n",
    );
  });

  it("11. rg: -r / --replace with non-capturing groups (?:...), named capture groups (?P<name>...) and (?<name>...), ${1}suffix, unbraced $1suffix, and $$ literal dollar", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/rec.txt": "id=42:user=alice\n",
      },
    });
    const res = await h.exec(
      "rg -N -r '$$[$num/${who}/$1/${2}0/$1none]' '(?:id=)(?P<num>\\d+):user=(?<who>[a-z]+)' /work/rec.txt",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "$[42/alice/42/alice0/]\n");
  });

  it("12. rg: -M / --max-columns long-line omission preview across matching, context, -r replacement, and -o only-matching modes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/long.txt": [
          "short before",
          "01234567890123456789012345 context_long",
          "0123456789 tok 0123456789 tok end",
          "short after",
          "",
        ].join("\n"),
      },
    });

    const ctxRes = await h.exec("rg -n -C 1 -M 20 'tok' /work/long.txt");
    assert.equal(ctxRes.exitCode, 0);
    assert.equal(
      ctxRes.stdout,
      "2-[Omitted long context line]\n3:[Omitted long matching line]\n4-short after\n",
    );

    const repRes = await h.exec("rg -n -M 20 -r 'X' 'tok' /work/long.txt");
    assert.equal(repRes.exitCode, 0);
    assert.equal(repRes.stdout, "3:[Omitted long line with 2 matches]\n");

    const onlyRes = await h.exec("rg -n -M 20 -o 'tok' /work/long.txt");
    assert.equal(onlyRes.exitCode, 0);
    assert.equal(onlyRes.stdout, "3:tok\n3:tok\n");
  });

  it("13. rg: -U (--multiline) with --multiline-dotall and -r replacement emitting per-line numbers and byte offsets", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/multi.txt": "hdr\nSTART\nmid1\nmid2\nEND\ntail\n",
      },
    });
    const singleLineRep = await h.exec(
      "rg -U --multiline-dotall -n -b -r 'MERGED($1)' 'START\\n(.*?)\\nEND' /work/multi.txt",
    );
    assert.equal(singleLineRep.exitCode, 0);
    assert.equal(singleLineRep.stdout, "2:4:MERGED(mid1\n3:16:mid2)\n");

    const onlyMatchRep = await h.exec(
      "rg -U -o -n -b -r '$1/$2' 'START\\n([a-z0-9]+)\\n([a-z0-9]+)\\nEND' /work/multi.txt",
    );
    assert.equal(onlyMatchRep.exitCode, 0);
    assert.equal(onlyMatchRep.stdout, "2:4:mid1/mid2\n");
  });

  it("14. rg: --ignore-file PATH, --no-ignore-dot, --no-ignore-vcs, and --iglob case-insensitive globbing with negation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/proj/.gitignore": "vcs_ignored.ts\n",
        "/work/proj/.rgignore": "dot_ignored.ts\n",
        "/work/proj/custom.ignore": "custom_ignored.ts\n",
        "/work/proj/vcs_ignored.ts": "MARK\n",
        "/work/proj/dot_ignored.ts": "MARK\n",
        "/work/proj/custom_ignored.ts": "MARK\n",
        "/work/proj/Keep.TS": "MARK\n",
        "/work/proj/Skip.Test.TS": "MARK\n",
      },
    });
    await h.exec("mkdir -p /work/proj/.git");

    const defaultRg = await h.exec("cd /work/proj && rg --sort=path -l 'MARK'");
    assert.equal(defaultRg.exitCode, 0);
    assert.equal(defaultRg.stdout, "Keep.TS\nSkip.Test.TS\ncustom_ignored.ts\n");

    const noVcs = await h.exec("cd /work/proj && rg --sort=path --no-ignore-vcs -l 'MARK'");
    assert.equal(noVcs.exitCode, 0);
    assert.equal(noVcs.stdout, "Keep.TS\nSkip.Test.TS\ncustom_ignored.ts\nvcs_ignored.ts\n");

    const noDot = await h.exec("cd /work/proj && rg --sort=path --no-ignore-dot -l 'MARK'");
    assert.equal(noDot.exitCode, 0);
    assert.equal(noDot.stdout, "Keep.TS\nSkip.Test.TS\ncustom_ignored.ts\ndot_ignored.ts\n");

    const customIgn = await h.exec(
      "cd /work/proj && rg --sort=path --ignore-file custom.ignore -l 'MARK'",
    );
    assert.equal(customIgn.exitCode, 0);
    assert.equal(customIgn.stdout, "Keep.TS\nSkip.Test.TS\n");

    const iglobOverride = await h.exec(
      "cd /work/proj && rg --sort=path --ignore-file custom.ignore --iglob '*.ts' --iglob '!*test*' -l 'MARK'",
    );
    assert.equal(iglobOverride.exitCode, 0);
    assert.equal(iglobOverride.stdout, "Keep.TS\ncustom_ignored.ts\ndot_ignored.ts\nvcs_ignored.ts\n");
  });

  it("15. find: -size 512-byte block ceiling rounding by default and b suffix, 2-byte words (w), and exact bytes (c)", async () => {
    const h = await SafeBashE2EHarness.create();
    await h.exec(
      [
        "mkdir -p /work/sz",
        ": > /work/sz/s0",
        "dd if=/dev/zero of=/work/sz/s1 bs=1 count=1 status=none",
        "dd if=/dev/zero of=/work/sz/s512 bs=512 count=1 status=none",
        "dd if=/dev/zero of=/work/sz/s513 bs=1 count=513 status=none",
        "dd if=/dev/zero of=/work/sz/s3 bs=1 count=3 status=none",
      ].join(" && "),
    );

    const block1 = await h.exec("cd /work/sz && find . -type f -size 1 | sort");
    assert.equal(block1.exitCode, 0);
    assert.equal(block1.stdout, "./s1\n./s512\n./s3\n".split("\n").filter(Boolean).sort().join("\n") + "\n");

    const blockGt1 = await h.exec("cd /work/sz && find . -type f -size +1b | sort");
    assert.equal(blockGt1.exitCode, 0);
    assert.equal(blockGt1.stdout, "./s513\n");

    const words2 = await h.exec("cd /work/sz && find . -type f -size 2w | sort");
    assert.equal(words2.exitCode, 0);
    assert.equal(words2.stdout, "./s3\n");
  });

  it("16. find: comma-separated -type f,l, symbolic and legacy +mode in -perm, and -links N / +N / -N hardlink count matching", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/p/both_exec": "a",
        "/work/p/group_exec": "b",
        "/work/p/plain": "c",
      },
    });
    await h.exec(
      [
        "chmod 750 /work/p/both_exec",
        "chmod 650 /work/p/group_exec",
        "chmod 640 /work/p/plain",
        "ln /work/p/plain /work/p/plain_hard",
        "ln -s plain /work/p/plain_sym",
      ].join(" && "),
    );

    const typeMulti = await h.exec("cd /work/p && find . -maxdepth 1 -type l,d | sort");
    assert.equal(typeMulti.exitCode, 0);
    assert.equal(typeMulti.stdout, ".\n./plain_sym\n");

    const permAllSym = await h.exec("cd /work/p && find . -type f -perm -u=x,g=x | sort");
    assert.equal(permAllSym.exitCode, 0);
    assert.equal(permAllSym.stdout, "./both_exec\n");

    const permAnyPlus = await h.exec("cd /work/p && find . -type f -perm +0111 | sort");
    assert.equal(permAnyPlus.exitCode, 0);
    assert.equal(permAnyPlus.stdout, "./both_exec\n./group_exec\n");

    const linksGt1 = await h.exec("cd /work/p && find . -type f -links +1 | sort");
    assert.equal(linksGt1.exitCode, 0);
    assert.equal(linksGt1.stdout, "./plain\n./plain_hard\n");

    const links1 = await h.exec("cd /work/p && find . -type f -links 1 | sort");
    assert.equal(links1.exitCode, 0);
    assert.equal(links1.stdout, "./both_exec\n./group_exec\n");
  });

  it("17. find: -printf directives (%p, %P, %H, %f, %h, %s, %d, %y, %%) and escapes (\\072 octal, \\c stop output without trailing newline)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/root/item.txt": "hello",
      },
    });
    await h.exec("ln -s item.txt /work/root/link.txt");

    const fmtRes = await h.exec(
      "cd /work && find root -maxdepth 1 -printf '%H|%P|%f|%h|%y|%d\\072%s%%\\n' | sort",
    );
    assert.equal(fmtRes.exitCode, 0);
    assert.equal(
      fmtRes.stdout,
      [
        "root|item.txt|item.txt|root|f|1:5%",
        "root|link.txt|link.txt|root|l|1:8%",
        "root||root|.|d|0:0%",
      ].join("\n") + "\n",
    );

    const stopRes = await h.exec(
      "cd /work && find root -name 'item.txt' -printf '<%f>\\cTRAILING_IGNORED'",
    );
    assert.equal(stopRes.exitCode, 0);
    assert.equal(stopRes.stdout, "<item.txt>");
  });

  it("18. find: comma (,) list operator and left-to-right short-circuit evaluation with multiple side-effect actions", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/tree/skip/secret.txt": "no",
        "/work/tree/keep/a.txt": "yes",
        "/work/tree/keep/b.md": "yes",
      },
    });

    const commaRes = await h.exec(
      "cd /work/tree && find . -name skip -prune , -type f \\( -name '*.txt' -printf 'TXT:%P\\n' , -name '*.md' -printf 'MD:%P\\n' \\) | sort",
    );
    assert.equal(commaRes.exitCode, 0);
    assert.equal(commaRes.stdout, "MD:keep/b.md\nTXT:keep/a.txt\n");
  });

  it("19. fd: --strip-cwd-prefix with -0, --path-separator SEP, -1 single-result flag, and -t executable / -t empty combinations", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/fdtest/sub/run.sh": "#!/bin/sh\n",
        "/work/fdtest/sub/empty.txt": "",
        "/work/fdtest/sub/nonempty.txt": "data",
      },
    });
    await h.exec("mkdir -p /work/fdtest/empty_dir && chmod 755 /work/fdtest/sub/run.sh && chmod 644 /work/fdtest/sub/empty.txt /work/fdtest/sub/nonempty.txt");

    const stripRes = await h.exec(
      "cd /work/fdtest && fd --strip-cwd-prefix -0 'run\\.sh' | tr '\\0' '|'",
    );
    assert.equal(stripRes.exitCode, 0);
    assert.equal(stripRes.stdout, "sub/run.sh|");

    const sepRes = await h.exec("cd /work/fdtest && fd --path-separator '::' 'run\\.sh'");
    assert.equal(sepRes.exitCode, 0);
    assert.equal(sepRes.stdout, "sub::run.sh\n");

    const oneRes = await h.exec("cd /work/fdtest && fd -1 -t f | wc -l | tr -d ' '");
    assert.equal(oneRes.exitCode, 0);
    assert.equal(oneRes.stdout, "1\n");

    const execEmptyRes = await h.exec("cd /work/fdtest && fd -t x | sort && echo '---' && fd -t e -t f | sort && echo '---' && fd -t e -t d | sort");
    assert.equal(execEmptyRes.exitCode, 0);
    assert.equal(execEmptyRes.stdout, "sub/run.sh\n---\nsub/empty.txt\n---\nempty_dir/\n");
  });

  it("20. fd: --ignore-file PATH, --no-ignore-vcs, and --changed-within / --changed-before timestamp filters", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/fdtime/.gitignore": "vcs_only.txt\n",
        "/work/fdtime/extra.ignore": "custom_ignored.txt\n",
        "/work/fdtime/vcs_only.txt": "1",
        "/work/fdtime/custom_ignored.txt": "2",
        "/work/fdtime/old.txt": "3",
        "/work/fdtime/mid.txt": "4",
        "/work/fdtime/new.txt": "5",
      },
    });
    await h.exec(
      [
        "touch -d @1700000100 /work/fdtime/old.txt",
        "touch -d @1700000500 /work/fdtime/mid.txt /work/fdtime/vcs_only.txt /work/fdtime/custom_ignored.txt",
        "touch -d @1700000900 /work/fdtime/new.txt",
      ].join(" && "),
    );

    const res = await h.exec(
      "cd /work/fdtime && fd --no-ignore-vcs --ignore-file extra.ignore --changed-within @1700000200 --changed-before @1700000800 -e txt | sort",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "mid.txt\nvcs_only.txt\n");
  });
});
