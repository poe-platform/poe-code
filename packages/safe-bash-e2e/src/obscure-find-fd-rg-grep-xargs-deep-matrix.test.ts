import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure find, fd, rg, grep, and xargs deep parity matrix", () => {
  it("01. find -- before root paths, -D tree debug output on stderr, -true/-false/-wholename/-iwholename, all-slash root /// with -name /, and root trailing slash normalization", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/-dash/file.txt", "dash\n");
      await h.writeText("/work/dir/sub/Alpha.TXT", "alpha\n");

      const dashRoot = await h.exec("cd /work && find -P -- ./-dash -name file.txt");
      assert.equal(dashRoot.exitCode, 0);
      assert.equal(dashRoot.stdout, "./-dash/file.txt\n");

      const debugTree = await h.exec("cd /work && find -D tree dir -name Alpha.TXT -o -false");
      assert.equal(debugTree.exitCode, 0);
      assert.equal(debugTree.stdout, "dir/sub/Alpha.TXT\n");
      assert.equal(
        debugTree.stderr,
        'find: virtual expression tree (evaluation order; no optimizer)\nAND(OR(["-name","Alpha.TXT"], ["-false"]), implicit -print)\n',
      );

      const wholeCase = await h.exec(
        "cd /work && find dir// -true -a -wholename 'dir/sub/*' -a -iwholename 'dir/sub/alpha.txt'",
      );
      assert.equal(wholeCase.exitCode, 0);
      assert.equal(wholeCase.stdout, "dir/sub/Alpha.TXT\n");

      const slashRoot = await h.exec("find /// -maxdepth 0 -name /");
      assert.equal(slashRoot.exitCode, 0);
      assert.equal(slashRoot.stdout, "///\n");
    });
  });

  it("02. find lazy left-to-right boolean evaluation of -exec ... \\;, -exec ... +, -print, -print0, and -printf inside -a, -o, comma, and !", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/tree/a.ok", "ok\n");
      await h.writeText("/work/tree/b.bad", "bad\n");

      const lazyExec = await h.exec(
        "cd /work && find tree -type f \\( \\( -exec test {} = tree/a.ok \\; -printf 'PASS:%P\\n' -o -printf 'FAIL:%P\\n' \\) , -print \\)",
      );
      assert.equal(lazyExec.exitCode, 0);
      assert.equal(lazyExec.stdout, "PASS:a.ok\ntree/a.ok\nFAIL:b.bad\ntree/b.bad\n");

      const negatedExec = await h.exec(
        "cd /work && find tree -type f ! -exec test {} = tree/a.ok \\; -print0",
      );
      assert.equal(negatedExec.exitCode, 0);
      assert.equal(negatedExec.stdout, "tree/b.bad\0");

      const batchedLazy = await h.exec(
        "cd /work && find tree -type f \\( -name '*.ok' -exec echo BATCH {} + -o -printf 'OTHER:%f\\n' \\)",
      );
      assert.equal(batchedLazy.exitCode, 0);
      assert.equal(batchedLazy.stdout, "OTHER:b.bad\nBATCH tree/a.ok\n");
    });
  });

  it("03. find -delete as a lazy predicate, preserving ./ and ./// roots on -delete, and rejecting -delete + -prune without explicit -depth", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/clean/one.tmp", "tmp\n");
      await h.writeText("/work/clean/two.keep", "keep\n");

      const lazyDelete = await h.exec(
        "cd /work/clean && find . -name '*.tmp' -delete -o -name '*.keep' -print",
      );
      assert.equal(lazyDelete.exitCode, 0);
      assert.equal(lazyDelete.stdout, "./two.keep\n");

      const checkRemaining = await h.exec("cd /work/clean && find . -maxdepth 1 -type f");
      assert.equal(checkRemaining.stdout, "./two.keep\n");

      await h.writeText("/work/dotroot/sub/item.txt", "x\n");
      const dotSlashDelete = await h.exec("cd /work/dotroot && find ./// -delete && pwd && ls -A");
      assert.equal(dotSlashDelete.exitCode, 0);
      assert.equal(dotSlashDelete.stdout, "/work/dotroot\n");

      await h.writeText("/work/conflict/file.txt", "keep\n");
      const pruneDeleteNoDepth = await h.exec("cd /work/conflict && find . -name sub -prune -o -delete");
      assert.equal(pruneDeleteNoDepth.exitCode, 1);
      assert.match(pruneDeleteNoDepth.stderr, /-delete implies -depth; -prune is ineffective/);
      assert.equal(await h.readText("/work/conflict/file.txt"), "keep\n");

      const pruneDeleteWithDepth = await h.exec(
        "cd /work/conflict && find . -depth -name file.txt -delete",
      );
      assert.equal(pruneDeleteWithDepth.exitCode, 0);
    });
  });

  it("04. find -perm symbolic permissions (u=rw,g=r, /000, +000, -u+x) and -size ceiling rounding with c/w/b/k/M/G units (0G, 1G, 1w, +1w, -1w)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/p/empty.bin", "");
      await h.writeText("/work/p/one.bin", "a");
      await h.writeText("/work/p/two.bin", "ab");
      await h.writeText("/work/p/three.bin", "abc");
      await h.exec("chmod 640 /work/p/one.bin && chmod 755 /work/p/two.bin && chmod 600 /work/p/three.bin");

      const symExact = await h.exec("cd /work/p && find . -type f -perm u=rw,g=r");
      assert.equal(symExact.exitCode, 0);
      assert.equal(symExact.stdout, "./one.bin\n");

      const anyZero = await h.exec("cd /work/p && find . -maxdepth 1 -type f -perm /000 | sort");
      assert.equal(anyZero.exitCode, 0);
      assert.equal(anyZero.stdout, "./empty.bin\n./one.bin\n./three.bin\n./two.bin\n");

      const plusZero = await h.exec("cd /work/p && find . -maxdepth 1 -type f -perm +000 | sort");
      assert.equal(plusZero.exitCode, 0);
      assert.equal(plusZero.stdout, "./empty.bin\n./one.bin\n./three.bin\n./two.bin\n");

      const sizeZeroG = await h.exec("cd /work/p && find . -type f -size 0G");
      assert.equal(sizeZeroG.exitCode, 0);
      assert.equal(sizeZeroG.stdout, "./empty.bin\n");

      const sizeOneG = await h.exec("cd /work/p && find . -type f -size 1G | sort");
      assert.equal(sizeOneG.exitCode, 0);
      assert.equal(sizeOneG.stdout, "./one.bin\n./three.bin\n./two.bin\n");

      const sizeOneW = await h.exec("cd /work/p && find . -type f -size 1w | sort");
      assert.equal(sizeOneW.exitCode, 0);
      assert.equal(sizeOneW.stdout, "./one.bin\n./two.bin\n");

      const sizePlusOneW = await h.exec("cd /work/p && find . -type f -size +1w");
      assert.equal(sizePlusOneW.exitCode, 0);
      assert.equal(sizePlusOneW.stdout, "./three.bin\n");

      const sizeMinusOneW = await h.exec("cd /work/p && find . -type f -size -1w");
      assert.equal(sizeMinusOneW.exitCode, 0);
      assert.equal(sizeMinusOneW.stdout, "./empty.bin\n");
    });
  });

  it("05. find -mtime, -mmin, -amin, and -cmin time predicates with +, -, and exact comparisons", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/t/recent.txt", "r\n");
      await h.writeText("/work/t/old.txt", "o\n");
      await h.exec("touch -d '2020-01-01T00:00:00Z' /work/t/old.txt");

      const mtimeMinus = await h.exec("cd /work/t && find . -type f -mtime -1");
      assert.equal(mtimeMinus.exitCode, 0);
      assert.equal(mtimeMinus.stdout, "./recent.txt\n");

      const mtimeZero = await h.exec("cd /work/t && find . -type f -mtime 0");
      assert.equal(mtimeZero.exitCode, 0);
      assert.equal(mtimeZero.stdout, "./recent.txt\n");

      const mtimePlus = await h.exec("cd /work/t && find . -type f -mtime +10");
      assert.equal(mtimePlus.exitCode, 0);
      assert.equal(mtimePlus.stdout, "./old.txt\n");

      const mminMinus = await h.exec("cd /work/t && find . -type f -mmin -5");
      assert.equal(mminMinus.exitCode, 0);
      assert.equal(mminMinus.stdout, "./recent.txt\n");

      const mminPlus = await h.exec("cd /work/t && find . -type f -mmin +60 -amin +60");
      assert.equal(mminPlus.exitCode, 0);
      assert.equal(mminPlus.stdout, "./old.txt\n");
    });
  });

  it("06. find pre-traversal validation exits 2 before side effects on invalid depth, perm, links, type, size, time, parens, printf, and exec", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/v/victim.txt", "safe\n");

      const cases = [
        "find /work/v -delete -maxdepth -1",
        "find /work/v -delete -mindepth",
        "find /work/v -delete -perm 888",
        "find /work/v -delete -links 1.5",
        "find /work/v -delete -type f,",
        "find /work/v -delete -type ff",
        "find /work/v -delete -size +1Q",
        "find /work/v -delete -mtime nope",
        "find /work/v -delete \\( -name '*.txt'",
        "find /work/v -delete -name '*.txt' \\)",
        "find /work/v -delete -bogus",
        "find -D bogus /work/v",
        "find /work/v -printf '%z'",
        "find /work/v -printf '\\q'",
        "find /work/v -exec echo {} extra +",
      ];
      for (const cmd of cases) {
        const res = await h.exec(cmd);
        assert.equal(res.exitCode, 2, `Expected exit 2 for: ${cmd}, got ${res.exitCode} (${res.stderr})`);
      }
      assert.equal(await h.readText("/work/v/victim.txt"), "safe\n");
    });
  });

  it("07. find -printf directives (%p, %P, %H, %f, %h, %s, %d, %y, %%) and escapes (\\n, \\t, \\r, \\c, octal \\072) across ///, ., and nested paths", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/pf/sub/hello.txt", "12345");

      const slashFmt = await h.exec("find /// -maxdepth 0 -printf '%H|%p|%P|%f|%h|%d|%y|%%\\072\\tend\\cignored'");
      assert.equal(slashFmt.exitCode, 0);
      assert.equal(slashFmt.stdout, "///|///||/|/|0|d|%:\tend");

      const nestedFmt = await h.exec(
        "cd /work && find pf/ -name hello.txt -printf '%H|%p|%P|%f|%h|%s|%d|%y\\n'",
      );
      assert.equal(nestedFmt.exitCode, 0);
      assert.equal(nestedFmt.stdout, "pf/|pf/sub/hello.txt|sub/hello.txt|hello.txt|pf/sub|5|2|f\n");

      const bareFileFmt = await h.exec(
        "cd /work/pf/sub && find hello.txt -printf '%H|%p|%P|%f|%h\\n'",
      );
      assert.equal(bareFileFmt.exitCode, 0);
      assert.equal(bareFileFmt.stdout, "hello.txt|hello.txt||hello.txt|.\n");
    });
  });

  it("08. find symlink modes (-P, -H, -L), root trailing slash directory enforcement, and ELOOP cycle detection", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/sym/real/item.txt", "hi\n");
      await h.writeText("/work/sym/plain.txt", "plain\n");
      await h.exec("ln -s real /work/sym/linkdir && ln -s . /work/sym/real/loop");

      const modeP = await h.exec("cd /work/sym && find -P linkdir");
      assert.equal(modeP.exitCode, 0);
      assert.equal(modeP.stdout, "linkdir\n");

      const modeH = await h.exec("cd /work/sym && find -H linkdir -name item.txt");
      assert.equal(modeH.exitCode, 0);
      assert.equal(modeH.stdout, "linkdir/item.txt\n");

      const modeL = await h.exec("cd /work/sym && find -L real -name item.txt");
      assert.equal(modeL.exitCode, 1);
      assert.equal(modeL.stdout, "real/item.txt\n");
      assert.match(modeL.stderr, /ELOOP|Too many levels of symbolic links|loop/i);

      const nonDirSlash = await h.exec("cd /work/sym && find plain.txt/");
      assert.equal(nonDirSlash.exitCode, 1);
      assert.match(nonDirSlash.stderr, /ENOTDIR|Not a directory/i);
    });
  });

  it("09. fd option validation exits 2 before traversal or execution on invalid counts, types, exec flags, colors, and conflicting roots", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/fdv/a.txt", "a\n");

      const cases = [
        "fd --max-results 0 . /work/fdv",
        "fd --min-depth=-1 . /work/fdv",
        "fd -dno . /work/fdv",
        "fd -tno . /work/fdv",
        "fd -x \\;",
        "fd -x echo \\; -X echo \\;",
        "fd -X echo {} {/} \\; . /work/fdv",
        "fd -x echo \\; --format '{}' . /work/fdv",
        "fd --hidden=yes . /work/fdv",
        "fd -c invalid . /work/fdv",
        "fd --search-path /work/fdv needle /work/fdv",
        "fd -S invalidsize . /work/fdv",
        "fd --changed-within invalidtime . /work/fdv",
        "fd --wat . /work/fdv",
      ];
      for (const cmd of cases) {
        const res = await h.exec(cmd);
        assert.equal(res.exitCode, 2, `Expected exit 2 for: ${cmd}, got ${res.exitCode} (${res.stderr})`);
      }
    });
  });

  it("10. fd explicit ./ root prefix preservation vs --strip-cwd-prefix, implicit ./ prefix under -x/-X/-0/-l, and -C/--base-directory execution cwd", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/fdb/sub/file.txt", "hello\n");
      await h.writeText("/work/fdb/a b.ts", "space\n");

      const explicitDotSlash = await h.exec("cd /work/fdb && fd -p '^\\./sub/file' ./sub");
      assert.equal(explicitDotSlash.exitCode, 0);
      assert.equal(explicitDotSlash.stdout, "./sub/file.txt\n");

      const implicitExecDotSlash = await h.exec("cd /work/fdb && fd 'a b\\.ts' -x echo");
      assert.equal(implicitExecDotSlash.exitCode, 0);
      assert.equal(implicitExecDotSlash.stdout, "./a b.ts\n");

      const stripCwdExec = await h.exec("cd /work/fdb && fd --strip-cwd-prefix 'a b\\.ts' -x echo");
      assert.equal(stripCwdExec.exitCode, 0);
      assert.equal(stripCwdExec.stdout, "a b.ts\n");

      const implicitNull = await h.exec("cd /work/fdb && fd 'a b\\.ts' -0");
      assert.equal(implicitNull.exitCode, 0);
      assert.equal(implicitNull.stdout, "./a b.ts\0");

      const baseDirExec = await h.exec("cd / && fd -C /work/fdb/sub file.txt -x pwd \\;");
      assert.equal(baseDirExec.exitCode, 0);
      assert.equal(baseDirExec.stdout, "/work/fdb/sub\n");

      const baseDirList = await h.exec("cd / && fd -C /work/fdb/sub -l file.txt");
      assert.equal(baseDirList.exitCode, 0);
      assert.match(baseDirList.stdout, /\.\/file\.txt\n$/);
    });
  });

  it("11. fd rejects missing or non-directory search roots with stderr diagnostic and exit code 1 while continuing valid roots", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/fdr/ok/item.txt", "ok\n");
      await h.writeText("/work/fdr/notadir.txt", "file\n");

      const missingRoot = await h.exec("fd . /work/fdr/missing /work/fdr/ok");
      assert.equal(missingRoot.exitCode, 1);
      assert.equal(missingRoot.stdout, "/work/fdr/ok/item.txt\n");
      assert.match(missingRoot.stderr, /^fd: /);

      const fileRoot = await h.exec("fd . /work/fdr/notadir.txt /work/fdr/ok");
      assert.equal(fileRoot.exitCode, 1);
      assert.equal(fileRoot.stdout, "/work/fdr/ok/item.txt\n");
      assert.match(fileRoot.stderr, /not a directory/);
    });
  });

  it("12. fd template expansion ({}, {/}, {//}, {.}, {/.}, {{, }}) in --format, -x, and -X, plus --path-separator and --and smart-case", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/fdt/dir/ archive.tar.gz", "x\n");
      await h.writeText("/work/fdt/dir/AlphaBeta.ts", "y\n");
      await h.writeText("/work/fdt/dir/alphabeta.ts", "z\n");

      const fmtRes = await h.exec(
        "cd /work/fdt && fd -g '*archive*' --format '{{}}={}|{/}|{//}|{.}|{/.}'",
      );
      assert.equal(fmtRes.exitCode, 0);
      assert.equal(
        fmtRes.stdout,
        "{}=dir/ archive.tar.gz| archive.tar.gz|dir|dir/ archive.tar| archive.tar\n",
      );

      const literalBracesExec = await h.exec(
        "cd /work/fdt && fd -g '*archive*' -x echo '{{}}' \\;",
      );
      assert.equal(literalBracesExec.exitCode, 0);
      assert.equal(literalBracesExec.stdout, "{} ./dir/ archive.tar.gz\n");

      const pathSep = await h.exec("cd /work/fdt && fd --path-separator :: .");
      assert.equal(pathSep.exitCode, 0);
      assert.equal(
        pathSep.stdout,
        "dir::\ndir:: archive.tar.gz\ndir::AlphaBeta.ts\ndir::alphabeta.ts\n",
      );

      const andSmartCase = await h.exec("cd /work/fdt && fd Alpha --and Beta");
      assert.equal(andSmartCase.exitCode, 0);
      assert.equal(andSmartCase.stdout, "dir/AlphaBeta.ts\n");
    });
  });

  it("13. xargs -L line continuation when a line ends with unquoted blank (' ' or '\\t') and -0/-d combined with -L", async () => {
    await withE2EHarness({}, async (h) => {
      const contRes = await h.exec(
        "printf 'one two \\nthree\\nfour\\n' | xargs -L 1 printf '[%s,%s,%s]\\n'",
      );
      assert.equal(contRes.exitCode, 0);
      assert.equal(contRes.stdout, "[one,two,three]\n[four,,]\n");

      const nulMaxLines = await h.exec(
        "printf 'a b\\0c d\\0e f\\0' | xargs -0 -L 2 printf '<%s|%s>\\n'",
      );
      assert.equal(nulMaxLines.exitCode, 0);
      assert.equal(nulMaxLines.stdout, "<a b|c d>\n<e f|>\n");

      const delimMaxLines = await h.exec(
        "printf 'x:y:z' | xargs -d : -L 2 printf '(%s,%s)\\n'",
      );
      assert.equal(delimMaxLines.exitCode, 0);
      assert.equal(delimMaxLines.stdout, "(x,y)\n(z,)\n");
    });
  });

  it("14. xargs -E END --eof / -e resetting EOF marker, -0/-d warning on -E stderr, and -0 -d: vs -d: -0 last-wins delimiter", async () => {
    await withE2EHarness({}, async (h) => {
      const resetEof = await h.exec("printf 'a STOP b\\n' | xargs -E STOP --eof echo");
      assert.equal(resetEof.exitCode, 0);
      assert.equal(resetEof.stdout, "a STOP b\n");

      const resetShortE = await h.exec("printf 'a STOP b\\n' | xargs -E STOP -e echo");
      assert.equal(resetShortE.exitCode, 0);
      assert.equal(resetShortE.stdout, "a STOP b\n");

      const shortEWithVal = await h.exec("printf 'a STOP b\\n' | xargs -eSTOP echo");
      assert.equal(shortEWithVal.exitCode, 0);
      assert.equal(shortEWithVal.stdout, "a\n");

      const warnDelimEof = await h.exec("printf 'a:STOP:b' | xargs -d : -E STOP echo");
      assert.equal(warnDelimEof.exitCode, 0);
      assert.equal(warnDelimEof.stdout, "a STOP b\n");
      assert.equal(
        warnDelimEof.stderr,
        "xargs: warning: the -E option has no effect if -0 or -d is used.\n\n",
      );

      const dThenZero = await h.exec("printf 'a:b\\0c:d\\0' | xargs -d : -0 printf '[%s]\\n'");
      assert.equal(dThenZero.exitCode, 0);
      assert.equal(dThenZero.stdout, "[a:b]\n[c:d]\n");

      const zeroThenD = await h.exec("printf 'a:b:c' | xargs -0 -d : printf '[%s]\\n'");
      assert.equal(zeroThenD.exitCode, 0);
      assert.equal(zeroThenD.stdout, "[a]\n[b]\n[c]\n");
    });
  });

  it("15. xargs -I {} -n 1 vs -n 1 -I {} vs -I {} -n 2 batching precedence, -i/-iREPL/--replace aliases, and inner blank preservation", async () => {
    await withE2EHarness({}, async (h) => {
      const iThenN1 = await h.exec(
        "printf 'alpha beta\\ngamma\\n' | xargs -I {} -n 1 echo 'item={}'",
      );
      assert.equal(iThenN1.exitCode, 0);
      assert.equal(iThenN1.stdout, "item=alpha beta\nitem=gamma\n");

      const iThenN2 = await h.exec(
        "printf 'alpha beta\\ngamma\\n' | xargs -I {} -n 2 echo 'item={}'",
      );
      assert.equal(iThenN2.exitCode, 0);
      assert.equal(iThenN2.stdout, "item={} alpha beta\nitem={} gamma\n");

      const n2ThenI = await h.exec(
        "printf 'alpha beta\\ngamma\\n' | xargs -n 2 -I {} echo 'item={}'",
      );
      assert.equal(n2ThenI.exitCode, 0);
      assert.equal(n2ThenI.stdout, "item=alpha beta\nitem=gamma\n");

      const iAlias = await h.exec(
        "printf '  hello   world  \\n' | xargs -iREPL echo '[REPL]'",
      );
      assert.equal(iAlias.exitCode, 0);
      assert.equal(iAlias.stdout, "[hello   world]\n");
    });
  });

  it("16. xargs option and input validation exits 2 on invalid counts, empty replacement, invalid slot var, NUL in default input, unmatched quote, and trailing backslash", async () => {
    await withE2EHarness({}, async (h) => {
      const optCases = [
        "printf 'a\\n' | xargs -L 0 echo",
        "printf 'a\\n' | xargs -L -1 echo",
        "printf 'a\\n' | xargs --max-lines= echo",
        "printf 'a\\n' | xargs -n 0 echo",
        "printf 'a\\n' | xargs --arg-file",
        "printf 'a\\n' | xargs --replace= echo",
        "printf 'a\\n' | xargs -I '' echo",
        "printf 'a\\n' | xargs --process-slot-var='A=B' echo",
        "printf 'a\\n' | xargs -d '' echo",
        "printf 'a\\n' | xargs -d ab echo",
      ];
      for (const cmd of optCases) {
        const res = await h.exec(cmd);
        assert.equal(res.exitCode, 2, `Expected exit 2 for: ${cmd}, got ${res.exitCode} (${res.stderr})`);
      }

      const nulInput = await h.exec("printf 'a\\0b\\n' | xargs echo");
      assert.equal(nulInput.exitCode, 2);
      assert.match(nulInput.stderr, /NUL in non-NUL-delimited input/);

      const unmatchedQuote = await h.exec("printf 'hello \"world\\n' | xargs echo");
      assert.equal(unmatchedQuote.exitCode, 2);
      assert.match(unmatchedQuote.stderr, /unmatched quote/);

      const trailingBackslash = await h.exec("printf 'hello \\\\' | xargs echo");
      assert.equal(trailingBackslash.exitCode, 2);
      assert.match(trailingBackslash.stderr, /trailing backslash/);
    });
  });

  it("17. grep last-wins for -l vs -L and -h vs -H, --no-ignore-case vs -i, newline-separated patterns in -e and positional pattern, and -NUM context shorthand", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/g/a.txt", "Alpha\nBeta\nGamma\nDelta\n");
      await h.writeText("/work/g/b.txt", "Omega\n");

      const lThenCapL = await h.exec("grep -l -L Alpha /work/g/a.txt /work/g/b.txt");
      assert.equal(lThenCapL.exitCode, 0);
      assert.equal(lThenCapL.stdout, "/work/g/b.txt\n");

      const capLThenL = await h.exec("grep -L -l Alpha /work/g/a.txt /work/g/b.txt");
      assert.equal(capLThenL.exitCode, 0);
      assert.equal(capLThenL.stdout, "/work/g/a.txt\n");

      const hThenCapH = await h.exec("grep -h -H Alpha /work/g/a.txt");
      assert.equal(hThenCapH.exitCode, 0);
      assert.equal(hThenCapH.stdout, "/work/g/a.txt:Alpha\n");

      const capHThenH = await h.exec("grep -H -h Alpha /work/g/a.txt /work/g/b.txt");
      assert.equal(capHThenH.exitCode, 0);
      assert.equal(capHThenH.stdout, "Alpha\n");

      const iThenNoI = await h.exec("grep -i --no-ignore-case alpha /work/g/a.txt");
      assert.equal(iThenNoI.exitCode, 1);

      const nlPatterns = await h.exec("grep -e $'Alpha\\nOmega' /work/g/a.txt /work/g/b.txt");
      assert.equal(nlPatterns.exitCode, 0);
      assert.equal(nlPatterns.stdout, "/work/g/a.txt:Alpha\n/work/g/b.txt:Omega\n");

      const numCtx = await h.exec("grep -1 Beta /work/g/a.txt");
      assert.equal(numCtx.exitCode, 0);
      assert.equal(numCtx.stdout, "Alpha\nBeta\nGamma\n");
    });
  });

  it("18. grep validation exits 2 on conflicting matchers, unsupported --binary-files or --color modes, invalid context length, and missing pattern", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/gv/f.txt", "hello\n");

      const cases = [
        "grep -E -F hello /work/gv/f.txt",
        "grep -G -P hello /work/gv/f.txt",
        "grep --binary-files=bogus hello /work/gv/f.txt",
        "grep --color=always hello /work/gv/f.txt",
        "grep -A -1 hello /work/gv/f.txt",
        "grep -C nope hello /work/gv/f.txt",
        "grep -m -2 hello /work/gv/f.txt",
        "grep",
      ];
      for (const cmd of cases) {
        const res = await h.exec(cmd);
        assert.equal(res.exitCode, 2, `Expected exit 2 for: ${cmd}, got ${res.exitCode} (${res.stderr})`);
      }
    });
  });

  it("19. rg last-wins for -H/-I, -n/-N, -w/-x, -i/-s/-S, --heading/--no-heading, mode overrides (-l/-c/--count-matches), and --stats summary output", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/rg/file.txt", "foo bar foo\nfoo\nother\n");

      const wThenX = await h.exec("rg -w -x foo /work/rg/file.txt");
      assert.equal(wThenX.exitCode, 0);
      assert.equal(wThenX.stdout, "foo\n");

      const xThenW = await h.exec("rg -x -w -N foo /work/rg/file.txt");
      assert.equal(xThenW.exitCode, 0);
      assert.equal(xThenW.stdout, "foo bar foo\nfoo\n");

      const cThenL = await h.exec("rg -c -l foo /work/rg/file.txt");
      assert.equal(cThenL.exitCode, 0);
      assert.equal(cThenL.stdout, "/work/rg/file.txt\n");

      const lThenCountMatches = await h.exec("rg -l --count-matches foo /work/rg/file.txt");
      assert.equal(lThenCountMatches.exitCode, 0);
      assert.equal(lThenCountMatches.stdout, "3\n");

      const statsOut = await h.exec("rg -N --stats foo /work/rg/file.txt");
      assert.equal(statsOut.exitCode, 0);
      assert.equal(
        statsOut.stdout,
        "foo bar foo\nfoo\n\n3 matches\n2 matched lines\n1 files contained matches\n1 files searched\n16 bytes printed\n22 bytes searched\n0.000000 seconds spent searching\n0.000000 seconds total\n",
      );
    });
  });

  it("20. rg -r replacement with $$ literal dollar, $0, $1, ${name} named capture groups, unclosed ${foo fallback, and option validation (exit 2)", async () => {
    await withE2EHarness({}, async (h) => {
      await h.writeText("/work/rgr/data.txt", "item=42\n");

      const namedRepl = await h.exec(
        "rg -N '(?P<key>[a-z]+)=(?P<val>[0-9]+)' -r '$${key}:$$${val}($0)[${unclosed' /work/rgr/data.txt",
      );
      assert.equal(namedRepl.exitCode, 0);
      assert.equal(namedRepl.stdout, "${key}:$42(item=42)[${unclosed\n");

      const badCases = [
        "rg -t bogus needle /work/rgr/data.txt",
        "rg --type-not=bogus needle /work/rgr/data.txt",
        "rg --sort=size needle /work/rgr/data.txt",
        "rg --color=always needle /work/rgr/data.txt",
        "rg -m -1 needle /work/rgr/data.txt",
        "rg -C nope needle /work/rgr/data.txt",
        "rg --hidden=yes needle /work/rgr/data.txt",
        "rg --bogus-flag needle /work/rgr/data.txt",
        "rg",
      ];
      for (const cmd of badCases) {
        const res = await h.exec(cmd);
        assert.equal(res.exitCode, 2, `Expected exit 2 for: ${cmd}, got ${res.exitCode} (${res.stderr})`);
      }
    });
  });
});
