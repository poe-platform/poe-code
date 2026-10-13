import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure numfmt/factor/truncate/csplit/split/expr/date/cal/getconf/locale/id/uname parity matrix", () => {
  it("1. numfmt --to, --from, --round, and --invalid validate choices and emit exact GNU diagnostics", async () => {
    const h = await SafeBashE2EHarness.create();

    const badTo = await h.exec("numfmt --to=auto 1000");
    assert.equal(badTo.exitCode, 1);
    assert.equal(
      badTo.stderr,
      "numfmt: invalid argument 'auto' for '--to'\nValid arguments are:\n  - 'none'\n  - 'si'\n  - 'iec'\n  - 'iec-i'\nTry 'numfmt --help' for more information.\n",
    );

    const badFrom = await h.exec("numfmt --from=bogus 1000");
    assert.equal(badFrom.exitCode, 1);
    assert.equal(
      badFrom.stderr,
      "numfmt: invalid argument 'bogus' for '--from'\nValid arguments are:\n  - 'none'\n  - 'auto'\n  - 'si'\n  - 'iec'\n  - 'iec-i'\nTry 'numfmt --help' for more information.\n",
    );

    const badRound = await h.exec("numfmt --round=middle 1000");
    assert.equal(badRound.exitCode, 1);
    assert.equal(
      badRound.stderr,
      "numfmt: invalid argument 'middle' for '--round'\nValid arguments are:\n  - 'up'\n  - 'down'\n  - 'from-zero'\n  - 'towards-zero'\n  - 'nearest'\nTry 'numfmt --help' for more information.\n",
    );

    const badInvalid = await h.exec("numfmt --invalid=skip 1000");
    assert.equal(badInvalid.exitCode, 1);
    assert.equal(
      badInvalid.stderr,
      "numfmt: invalid argument 'skip' for '--invalid'\nValid arguments are:\n  - 'abort'\n  - 'fail'\n  - 'warn'\n  - 'ignore'\nTry 'numfmt --help' for more information.\n",
    );
  });

  it("2. numfmt --field range validation and option error diagnostics match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const fZero = await h.exec("numfmt --field=0 1000");
    assert.equal(fZero.exitCode, 1);
    assert.equal(
      fZero.stderr,
      "numfmt: fields are numbered from 1\nTry 'numfmt --help' for more information.\n",
    );

    const fDec = await h.exec("numfmt --field=3-1 1000");
    assert.equal(fDec.exitCode, 1);
    assert.equal(
      fDec.stderr,
      "numfmt: invalid decreasing range\nTry 'numfmt --help' for more information.\n",
    );

    const fRange = await h.exec("numfmt --field=1--2 1000");
    assert.equal(fRange.exitCode, 1);
    assert.equal(
      fRange.stderr,
      "numfmt: invalid field range\nTry 'numfmt --help' for more information.\n",
    );

    const fVal = await h.exec("numfmt --field=abc 1000");
    assert.equal(fVal.exitCode, 1);
    assert.equal(
      fVal.stderr,
      "numfmt: invalid field value 'abc'\nTry 'numfmt --help' for more information.\n",
    );

    const badShort = await h.exec("numfmt -x 1000");
    assert.equal(badShort.exitCode, 1);
    assert.equal(
      badShort.stderr,
      "numfmt: invalid option -- 'x'\nTry 'numfmt --help' for more information.\n",
    );
  });

  it("3. numfmt --help, --version, --header, --field, --padding, and --to=iec-i formatting match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const ver = await h.exec("numfmt --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "numfmt (virtual-bash)\n");

    const help = await h.exec("numfmt --help");
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /^Usage: numfmt \[OPTION\]\.\.\. \[NUMBER\]\.\.\.\nReformat NUMBER\(s\)/);

    const fmt = await h.exec(
      "printf 'NAME:SIZE\\nalpha:1048576\\nbeta:2048\\n' | numfmt -d : --header=1 --field=2 --to=iec-i",
    );
    assert.equal(fmt.exitCode, 0);
    assert.equal(fmt.stdout, "NAME:SIZE\nalpha:1.0Mi\nbeta:2.0Ki\n");
  });

  it("4. factor --help, --version, --exponents/-h, and negative option vs operand after -- match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const help = await h.exec("factor --help");
    assert.equal(help.exitCode, 0);
    assert.equal(
      help.stdout,
      "Usage: factor [NUMBER]...\nPrint prime factors; with no numbers, read standard input.\nOptions: --exponents (print repeated factors as powers) --help --version\nMaximum supported value: Infinity\n",
    );

    const ver = await h.exec("factor --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "factor (virtual-bash)\n");

    const negOpt = await h.exec("factor -1");
    assert.equal(negOpt.exitCode, 1);
    assert.equal(
      negOpt.stderr,
      "factor: invalid option -- '1'\nTry 'factor --help' for more information.\n",
    );

    const negOperand = await h.exec("factor -- -1 360");
    assert.equal(negOperand.exitCode, 1);
    assert.equal(negOperand.stdout, "360: 2 2 2 3 3 5\n");
    assert.equal(negOperand.stderr, "factor: '-1' is not a valid positive integer\n");

    const exp = await h.exec("factor -h 360");
    assert.equal(exp.exitCode, 0);
    assert.equal(exp.stdout, "360: 2^3 3^2 5\n");
  });

  it("5. truncate --help, --version, and option/usage error diagnostics match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const ver = await h.exec("truncate --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "truncate (virtual-bash)\n");

    const help = await h.exec("truncate --help");
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /^Usage: truncate OPTION\.\.\. FILE\.\.\.\nShrink or extend the size/);

    const noSpec = await h.exec("truncate /work/a");
    assert.equal(noSpec.exitCode, 1);
    assert.equal(
      noSpec.stderr,
      "truncate: you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information.\n",
    );

    const absWithRef = await h.exec("truncate -r /work/ref -s 10 /work/a");
    assert.equal(absWithRef.exitCode, 1);
    assert.equal(
      absWithRef.stderr,
      "truncate: you must specify a relative '--size' with '--reference'\nTry 'truncate --help' for more information.\n",
    );

    const ioNoSize = await h.exec("truncate -o -r /work/ref /work/a");
    assert.equal(ioNoSize.exitCode, 1);
    assert.equal(
      ioNoSize.stderr,
      "truncate: '--io-blocks' was specified but '--size' was not\nTry 'truncate --help' for more information.\n",
    );

    const noFile = await h.exec("truncate -s 10");
    assert.equal(noFile.exitCode, 1);
    assert.equal(
      noFile.stderr,
      "truncate: missing file operand\nTry 'truncate --help' for more information.\n",
    );
  });

  it("6. truncate -r missing reference file and relative size modifiers (+, -, %, /) match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/ref.bin": "0123456789",
      },
    });

    const missingRef = await h.exec("truncate -r /work/nope.bin /work/out.bin");
    assert.equal(missingRef.exitCode, 1);
    assert.equal(
      missingRef.stderr,
      "truncate: cannot stat '/work/nope.bin': No such file or directory\n",
    );

    const rel = await h.exec(
      "truncate -r /work/ref.bin -s +5 /work/out.bin && wc -c < /work/out.bin && truncate -s /4 /work/out.bin && wc -c < /work/out.bin",
    );
    assert.equal(rel.exitCode, 0);
    assert.equal(rel.stdout.replace(/\s+/g, " ").trim(), "15 12");
  });

  it("7. csplit --help, --version, and option/operand error diagnostics match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create({
      directories: ["/work/dir"],
    });

    const help = await h.exec("csplit --help");
    assert.equal(help.exitCode, 0);
    assert.equal(
      help.stdout,
      "Usage: csplit [OPTION]... FILE PATTERN...\nOptions: -f PREFIX, -b SUFFIX, -k, -z, -n DIGITS, -s, --suppress-matched\nPatterns: INTEGER, /REGEXP/[OFFSET], %REGEXP%[OFFSET], {INTEGER}, {*}\n",
    );

    const ver = await h.exec("csplit --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "csplit (virtual-bash)\n");

    const zeroOp = await h.exec("csplit");
    assert.equal(zeroOp.exitCode, 1);
    assert.equal(
      zeroOp.stderr,
      "csplit: missing operand\nTry 'csplit --help' for more information.\n",
    );

    const oneOp = await h.exec("csplit /work/in.txt");
    assert.equal(oneOp.exitCode, 1);
    assert.equal(
      oneOp.stderr,
      "csplit: missing operand after '/work/in.txt'\nTry 'csplit --help' for more information.\n",
    );

    const missingFile = await h.exec("csplit /work/missing.txt 2");
    assert.equal(missingFile.exitCode, 1);
    assert.equal(
      missingFile.stderr,
      "csplit: cannot open '/work/missing.txt' for reading: No such file or directory\n",
    );

    const isDir = await h.exec("csplit /work/dir 2");
    assert.equal(isDir.exitCode, 1);
    assert.equal(isDir.stderr, "csplit: read error: Is a directory\n");
  });

  it("8. csplit regex patterns, offsets, repeat counts, and --suppress-matched match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/doc.txt": "hdr\n---\nsec1\n---\nsec2\n",
      },
      cwd: "/work",
    });

    const res = await h.exec(
      "csplit -s -z -f part_ -b '%02d.txt' --suppress-matched /work/doc.txt '/^---$/' '{*}' && head -n 10 part_00.txt part_01.txt part_02.txt",
    );
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "==> part_00.txt <==\nhdr\n\n==> part_01.txt <==\nsec1\n\n==> part_02.txt <==\nsec2\n",
    );
  });

  it("9. split --help, --version, missing file, and directory diagnostics match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create({
      directories: ["/work/dir"],
    });

    const ver = await h.exec("split --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "split (safe-bash virtual implementation)\n");

    const missing = await h.exec("split /work/missing.txt");
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "split: no such file or directory, stat '/work/missing.txt'\n");

    const dir = await h.exec("split /work/dir");
    assert.equal(dir.exitCode, 1);
    assert.equal(dir.stderr, "split: illegal operation on a directory '/work/dir'\n");
  });

  it("10. split -n r/K/N round-robin chunk extraction and --additional-suffix match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lines.txt": "r1\nr2\nr3\nr4\nr5\nr6\n",
      },
      cwd: "/work",
    });

    const rr = await h.exec("split -n r/2/3 /work/lines.txt");
    assert.equal(rr.exitCode, 0);
    assert.equal(rr.stdout, "r2\nr5\n");

    const files = await h.exec(
      "split -l 2 -d -a 2 --additional-suffix=.part /work/lines.txt chunk_ && cat chunk_00.part chunk_02.part",
    );
    assert.equal(files.exitCode, 0);
    assert.equal(files.stdout, "r1\nr2\nr5\nr6\n");
  });

  it("11. expr --help, --version, and missing right-hand operand syntax errors match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const help = await h.exec("expr --help");
    assert.equal(help.exitCode, 0);
    assert.equal(
      help.stdout,
      "Usage: expr EXPRESSION\nTokens: | & < <= = == != >= > + - * / % :\nPrefixes: + TOKEN, length STRING, index STRING CHARS, substr STRING POS LENGTH, match STRING REGEXP\nGroup with ( EXPRESSION ). Each token is a separate argument.\nMatching uses bounded provider-driven BRE.\nProfiles depend on the provider: built-in portable non-NUL ASCII; Node C/POSIX byte or C.UTF-8 scalar.\n",
    );

    for (const op of ["|", "&", "=", "+", "*", ":"]) {
      const r = await h.exec(`expr 1 '${op}'`);
      assert.equal(r.exitCode, 2);
      assert.equal(r.stderr, `expr: syntax error: missing argument after '${op}'\n`);
    }
  });

  it("12. expr BRE colon matching, + token escape, substr, index, and length match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const m = await h.exec("expr 'release-2026-rc3' : 'release-\\([0-9]*\\)-rc\\([0-9]*\\)'");
    assert.equal(m.exitCode, 0);
    assert.equal(m.stdout, "2026\n");

    const plus = await h.exec("expr length + match");
    assert.equal(plus.exitCode, 0);
    assert.equal(plus.stdout, "5\n");

    const sub = await h.exec("expr substr 'abcdef' 2 3");
    assert.equal(sub.exitCode, 0);
    assert.equal(sub.stdout, "bcd\n");
  });

  it("13. date --help, --version, -d invalid date, -f missing/stream continuation, and -r missing stat match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const help = await h.exec("date --help");
    assert.equal(help.exitCode, 0);
    assert.equal(
      help.stdout,
      "Usage: date [-uj] [-d DATE | -r FILE_OR_SECONDS | -f FILE] [-v[+|-]VALUE[ymwdHMS]] [+FORMAT]\n-f, --file=FILE reads one date per line; FILE - reads stdin.\nAlso: -I[date|hours|minutes|seconds|ns], -R, --rfc-3339=PRECISION\nDATE accepts @seconds, ISO calendar/time, RFC dates, now/today/yesterday/tomorrow, and integer seconds/minutes/hours relative to now.\nVirtual TZ defaults to UTC; no clock setting or host-locale parsing.\n",
    );

    const ver = await h.exec("date --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "date (safe-bash virtual command)\n");

    const badDate = await h.exec("date -d not-a-date");
    assert.equal(badDate.exitCode, 1);
    assert.equal(badDate.stderr, "date: unsupported or invalid date: not-a-date\n");

    const badFile = await h.exec("date -f /nope");
    assert.equal(badFile.exitCode, 1);
    assert.equal(badFile.stderr, "date: ENOENT: no such file or directory, readStream '/nope'\n");

    const badRef = await h.exec("date -r /nope");
    assert.equal(badRef.exitCode, 1);
    assert.equal(badRef.stderr, "date: ENOENT: no such file or directory, stat '/nope'\n");

    const batch = await h.exec("printf '@0\\nnot-valid\\n@86400\\n' | date -u -f - +%F");
    assert.equal(batch.exitCode, 1);
    assert.equal(batch.stdout, "1970-01-01\n1970-01-02\n");
    assert.equal(batch.stderr, "date: unsupported or invalid date: not-valid\n");
  });

  it("14. cal and ncal --help, --version, Julian (-j), Monday (-M), and 1752 reformation match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const help = await h.exec("cal --help");
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /^Usage:\n cal \[options\] \[\[\[day\] month\] year\]\n/);

    const ver = await h.exec("cal --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "cal (Sandbox VFS-ish/GNU util-linux) 2.40\n");

    const sep1752 = await h.exec("cal 9 1752");
    assert.equal(sep1752.exitCode, 0);
    assert.match(sep1752.stdout, /1 {2}2 14 15 16/);
  });

  it("15. getconf --help, --version, -a, and missing operand usage match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const help = await h.exec("getconf --help");
    assert.equal(help.exitCode, 0);
    assert.equal(
      help.stdout,
      "Usage: getconf [-v specification] variable_name [pathname]\n       getconf -a [pathname]\n\nQuery system configuration variables in the Sandbox VFS-ish/GNU environment.\n",
    );

    const missing = await h.exec("getconf");
    assert.equal(missing.exitCode, 1);
    assert.equal(
      missing.stderr,
      "Usage: getconf [-v specification] variable_name [pathname]\n       getconf -a [pathname]\n\nQuery system configuration variables in the Sandbox VFS-ish/GNU environment.\n",
    );

    const val = await h.exec("getconf PAGE_SIZE && getconf _SC_NPROCESSORS_ONLN");
    assert.equal(val.exitCode, 0);
    assert.equal(val.stdout, "4096\n4\n");
  });

  it("16. locale --help, --version, -a, -m, and category/keyword queries match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const help = await h.exec("locale --help");
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /^Usage: locale \[OPTION\.\.\.\] \[NAME\.\.\.\]\nGet locale-specific information/);

    const ver = await h.exec("locale --version");
    assert.equal(ver.exitCode, 0);
    assert.equal(ver.stdout, "locale (Sandbox VFS-ish/GNU libc) 2.39\n");

    const kw = await h.exec("LC_ALL=C.UTF-8 locale -c -k charmap decimal_point");
    assert.equal(kw.exitCode, 0);
    assert.equal(kw.stdout, "LC_CTYPE\ncharmap=\"UTF-8\"\nLC_NUMERIC\ndecimal_point=\".\"\n");
  });

  it("17. pathchk --help, --version, -p, -P, and --portability diagnostics match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    const help = await h.exec("pathchk --help");
    assert.equal(help.exitCode, 0);
    assert.equal(
      help.stdout,
      "Usage: pathchk [OPTION]... NAME...\nDiagnose invalid or unportable file names.\n\n  -p                  check for most POSIX systems\n  -P                  check for empty names and leading \"-\"\n      --portability   check for all POSIX systems (equivalent to -p -P)\n      --help          display this help and exit\n      --version       output version information and exit\n",
    );

    const leadDash = await h.exec("pathchk -P -- -badname");
    assert.equal(leadDash.exitCode, 1);
    assert.equal(leadDash.stderr, "pathchk: leading '-' in a component of file name '-badname'\n");

    const emptyName = await h.exec("pathchk -P ''");
    assert.equal(emptyName.exitCode, 1);
    assert.equal(emptyName.stderr, "pathchk: empty file name\n");
  });

  it("18. uname, whoami, hostname, nproc, and id --help and --version strings match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create();

    for (const cmd of ["uname", "whoami", "hostname", "nproc", "id"]) {
      const help = await h.exec(`${cmd} --help`);
      assert.equal(help.exitCode, 0);
      assert.match(help.stdout, /^Usage: /);
      assert.match(help.stdout, /--version/);

      const ver = await h.exec(`${cmd} --version`);
      assert.equal(ver.exitCode, 0);
      assert.match(ver.stdout, /Packaged by Safe-Bash \(Sandbox VFS-ish\/GNU runtime\)\n$/);
    }
  });

  it("19. uname -a, id -G/-u/-n, whoami, hostname -s/-d/-i, and nproc --ignore match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/etc/hostname": "node01.cluster.local\n",
      },
    });

    const sys = await h.exec(
      "uname -s -m && whoami && hostname -s && hostname -d && nproc --ignore=1 && id -u -n",
    );
    assert.equal(sys.exitCode, 0);
    assert.equal(sys.stdout, "Linux x86_64\ne2e\nnode01\ncluster.local\n3\ne2e\n");
  });

  it("20. less and more missing file diagnostics, line numbering (-N), and pattern start (+/pat) match TypeScript", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/log.txt": "alpha\n\n\nbeta\ngamma\n",
      },
    });

    const missing = await h.exec("less /work/nope.txt");
    assert.equal(missing.exitCode, 1);
    assert.equal(
      missing.stderr,
      "less: /work/nope.txt: ENOENT: no such file or directory, readFile '/work/nope.txt'\n",
    );

    const paged = await h.exec("less -N -s +/beta /work/log.txt");
    assert.equal(paged.exitCode, 0);
    assert.equal(paged.stdout, "     4  beta\n     5  gamma\n");
  });
});
