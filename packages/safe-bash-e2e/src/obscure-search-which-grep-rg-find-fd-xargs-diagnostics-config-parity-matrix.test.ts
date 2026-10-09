import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure search which grep rg find fd xargs diagnostics and config parity matrix", () => {
  it("1. which with empty PATH=\"\" probes ./<name>, preserves trailing slashes in PATH components, and rejects /, /., and /.. suffixes", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work/bin /a",
          "printf '#!/bin/sh\\necho hi\\n' > /work/p",
          "printf '#!/bin/sh\\necho a\\n' > /a/p",
          "chmod 755 /work/p /a/p",
          "cd /work",
          'PATH="" which p',
          'PATH=":/a/:/a" which -a p',
          'which /a/p /a/p/ /a/p/. /a/p/.. || echo "slash_rc=$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "./p\n./p\n/a//p\n/a/p\n/a/p\nslash_rc=1\n");
      assert.equal(res.stderr, "");
    });
  });

  it("2. grep --help outputs full option summary and exit status guidance", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec("grep --help | sed -n '1,5p'");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "Usage: grep [OPTION]... PATTERN [FILE]...",
          "Print lines matching PATTERN. With no FILE, or FILE -, read standard input.",
          "",
          "  -G, --basic-regexp       Use basic regular expressions (default)",
          "  -E, --extended-regexp    Use extended regular expressions",
          "",
        ].join("\n"),
      );
    });
  });

  it("3. grep -s (--no-messages) suppresses missing-file stderr while emitting matches, whereas -q suppresses stdout", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work",
          "printf 'alpha\\nbeta\\n' > /work/ok.txt",
          'grep -s alpha /work/ok.txt /work/no_such.txt || echo "s_rc=$?"',
          'grep -q alpha /work/no_such.txt /work/ok.txt && echo "q_rc=0"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/work/ok.txt:alpha\ns_rc=2\nq_rc=0\n");
      assert.match(res.stderr, /^grep: ENOENT: no such file or directory, (readFile|readStream) '\/work\/no_such\.txt'\n$/);
    });
  });

  it("4. grep -f - and --file=- read newline-separated patterns from stdin while searching target files", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work",
          "printf 'apple\\nbanana\\ncherry\\n' > /work/fruits.txt",
          "printf 'banana\\ncherry\\n' | grep -f - /work/fruits.txt",
          "printf 'apple\\n' | grep --file=- /work/fruits.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "banana\ncherry\napple\n");
      assert.equal(res.stderr, "");
    });
  });

  it("5. grep missing -f pattern file, missing --exclude-from file, and directory operand EISDIR diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work/sub",
          'grep -f /work/missing_pats.txt /work/sub || echo "f_rc=$?"',
          'grep --exclude-from=/work/missing_excl.txt -r foo /work/sub || echo "ex_rc=$?"',
          'grep foo /work/sub || echo "dir_rc=$?"',
          'grep -d skip foo /work/sub || echo "skip_rc=$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "f_rc=2\nex_rc=2\ndir_rc=2\nskip_rc=1\n");
      assert.equal(
        res.stderr,
        [
          "grep: ENOENT: no such file or directory, readStream '/work/missing_pats.txt'",
          "grep: ENOENT: no such file or directory, readStream '/work/missing_excl.txt'",
          "grep: EISDIR: illegal operation on a directory, readFile '/work/sub'",
          "",
        ].join("\n"),
      );
    });
  });

  it("6. grep option validation diagnostics for -m, --max-count, --color, -d, -D, and conflicting matchers", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'grep -m abc foo || echo "m:$?"',
          'grep --max-count=abc foo || echo "mc:$?"',
          'grep --color=always foo || echo "clr:$?"',
          'grep -d weird foo || echo "d:$?"',
          'grep -D weird foo || echo "D:$?"',
          'egrep -F foo || echo "eg:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "m:2\nmc:2\nclr:2\nd:2\nD:2\neg:2\n");
      assert.equal(
        res.stderr,
        [
          "grep: invalid number 'abc'",
          "grep: invalid number 'abc'",
          "grep: unsupported color mode 'always'; use never or auto (non-terminal output)",
          "grep: invalid argument 'weird' for 'directories'",
          "grep: invalid argument 'weird' for 'devices'",
          "egrep: conflicting matchers specified",
          "",
        ].join("\n"),
      );
    });
  });

  it("7. rg -V, rg --version, and rg --help output exact bounded implementation strings", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "rg -V",
          "rg --version",
          "rg --help | sed -n '1,3p'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "rg (safe-bash bounded implementation)",
          "rg (safe-bash bounded implementation)",
          "Regex engine: bounded ASCII regular expressions and UTF-8 literals",
          "Native ripgrep revision, PCRE2 and SIMD capabilities are not reported by this implementation.",
          "Usage: rg [OPTIONS] PATTERN [PATH ...]",
          "Search files for PATTERN. PATH - reads standard input.",
          "Default input depends on shell configuration.",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. rg RIPGREP_CONFIG_PATH loading, comment/blank skipping, --no-config override, and missing config ENOENT", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work",
          "printf '# comment\\n\\n--ignore-case\\n--line-number\\n' > /work/rg.conf",
          "printf 'HELLO\\nworld\\n' > /work/sample.txt",
          "RIPGREP_CONFIG_PATH=/work/rg.conf rg hello /work/sample.txt",
          'RIPGREP_CONFIG_PATH=/work/rg.conf rg --no-config hello /work/sample.txt || echo "nocfg:$?"',
          'RIPGREP_CONFIG_PATH=/work/missing.conf rg hello /work/sample.txt || echo "miss:$?"',
          'RIPGREP_CONFIG_PATH=/work/missing.conf rg --no-config hello /work/sample.txt || echo "miss_nocfg:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:HELLO\nnocfg:1\nmiss:2\nmiss_nocfg:1\n");
      assert.equal(res.stderr, "rg: ENOENT: no such file or directory, readStream '/work/missing.conf'\n");
    });
  });

  it("9. rg -f - stdin pattern file, rg -f - - conflict diagnostic, missing -f file, and --ignore-file with --no-ignore-files", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work",
          "printf 'alpha\\nbeta\\ngamma\\n' > /work/items.txt",
          "printf 'beta\\n' | rg -N -f - /work/items.txt",
          'rg -f - - || echo "conflict:$?"',
          'rg -f /work/no_pats.txt /work/items.txt || echo "nopats:$?"',
          'rg --ignore-file=/work/no_ig.txt alpha /work/items.txt || echo "noig:$?"',
          "rg -N --ignore-file=/work/no_ig.txt --no-ignore-files alpha /work/items.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "beta\nconflict:2\nnopats:2\nnoig:2\nalpha\n");
      assert.equal(
        res.stderr,
        [
          "rg: cannot search stdin while also reading patterns from stdin",
          "rg: ENOENT: no such file or directory, readFile '/work/no_pats.txt'",
          "rg: ENOENT: no such file or directory, readFile '/work/no_ig.txt'",
          "",
        ].join("\n"),
      );
    });
  });

  it("10. rg --no-messages suppresses missing file and missing --ignore-file diagnostics while preserving exit code 2", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work",
          "printf 'needle\\n' > /work/present.txt",
          'rg -N --no-messages needle /work/present.txt /work/absent.txt || echo "rc1=$?"',
          'rg -N --no-messages --ignore-file=/work/absent.ignore needle /work/present.txt || echo "rc2=$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/work/present.txt:needle\nrc1=2\nrc2=2\n");
      assert.equal(res.stderr, "");
    });
  });

  it("11. fd -h / --help and -V / --version output exact help and version text", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "fd -V",
          "fd --version",
          "fd -h | sed -n '1,3p'",
          "fd --help | tail -n 2",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "fd (safe-bash)",
          "fd (safe-bash)",
          "Usage: fd [OPTIONS] [PATTERN] [PATH ...]",
          "Patterns: -g --glob, -F --fixed-strings, -s --case-sensitive, -i --ignore-case, -p --full-path, --and PATTERN",
          "Filters: -e EXT, -t TYPE, -E GLOB, -d DEPTH, --min-depth N, --exact-depth N, -S SIZE",
          "Output: -c/--color WHEN, -0, -a, -l, --format FORMAT",
          "        -x COMMAND ... ;, -X COMMAND ... ;",
          "",
        ].join("\n"),
      );
    });
  });

  it("12. fd option and argument validation diagnostics match TypeScript verbatim", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'fd --bad-opt || echo "bad:$?"',
          'fd -z || echo "z:$?"',
          'fd -t bad || echo "t:$?"',
          'fd -d abc || echo "d:$?"',
          'fd --max-results=0 || echo "mr:$?"',
          'fd --color=weird || echo "c:$?"',
          'fd --hidden=1 || echo "h:$?"',
          'fd --extension || echo "ext:$?"',
          'fd -S badsize || echo "sz:$?"',
          'fd --changed-within=badtime || echo "tm:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "bad:2\nz:2\nt:2\nd:2\nmr:2\nc:2\nh:2\next:2\nsz:2\ntm:2\n");
      assert.equal(
        res.stderr,
        [
          "fd: unrecognized option '--bad-opt'",
          "fd: unrecognized option '--z'",
          "fd: invalid file type 'bad'",
          "fd: invalid count 'abc'",
          "fd: --max-results must be greater than zero",
          "fd: invalid color mode",
          "fd: option --hidden does not take a value",
          "fd: option --extension requires a value",
          "fd: invalid size 'badsize'",
          "fd: invalid time 'badtime'",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. fd execution and root combination diagnostics match TypeScript verbatim", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'fd --search-path /work pat /work || echo "sp:$?"',
          'fd -x echo \\; -X echo \\; || echo "comb:$?"',
          'fd -x \\; || echo "req:$?"',
          'fd --format={} -x echo \\; || echo "fmt:$?"',
          'fd -X echo {} {} \\; || echo "batch:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "sp:2\ncomb:2\nreq:2\nfmt:2\nbatch:2\n");
      assert.equal(
        res.stderr,
        [
          "fd: search-path cannot be combined with positional roots",
          "fd: execution modes cannot be combined",
          "fd: execution command is required",
          "fd: execution cannot be combined with formatting",
          "fd: batch execution accepts only one placeholder",
          "",
        ].join("\n"),
      );
    });
  });

  it("14. find -D debug option validation and expression syntax diagnostics match TypeScript verbatim", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work/f",
          'find -D || echo "d1:$?"',
          'find -D bad /work/f || echo "d2:$?"',
          'find /work/f ! || echo "bang:$?"',
          'find /work/f \\( -true || echo "paren:$?"',
          'find /work/f -true \\) || echo "extra:$?"',
          'find /work/f -unknown-pred || echo "unk:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "d1:2\nd2:2\nbang:2\nparen:2\nextra:2\nunk:2\n");
      assert.equal(
        res.stderr,
        [
          "find: -D requires a debug option",
          "find: unsupported debug option 'bad' (supported: tree)",
          "find: missing expression",
          "find: missing ')'",
          "find: unexpected expression ')'",
          "find: unsupported expression '-unknown-pred'",
          "",
        ].join("\n"),
      );
    });
  });

  it("15. find predicate argument validation diagnostics (-maxdepth, -type, -perm, -links, -size, -mtime, -printf, -exec) match TypeScript verbatim", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work/f",
          'find /work/f -maxdepth || echo "md1:$?"',
          'find /work/f -maxdepth abc || echo "md2:$?"',
          'find /work/f -name || echo "nm:$?"',
          'find /work/f -type z || echo "tp:$?"',
          'find /work/f -perm 999 || echo "pm:$?"',
          'find /work/f -links bad || echo "lk:$?"',
          'find /work/f -size bad || echo "sz:$?"',
          'find /work/f -mtime bad || echo "mt:$?"',
          'find /work/f -printf || echo "pf1:$?"',
          'find /work/f -printf "%z" || echo "pf2:$?"',
          'find /work/f -exec \\; || echo "ex:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "md1:2\nmd2:2\nnm:2\ntp:2\npm:2\nlk:2\nsz:2\nmt:2\npf1:2\npf2:2\nex:2\n");
      assert.equal(
        res.stderr,
        [
          "find: -maxdepth requires a number",
          "find: invalid number 'abc'",
          "find: -name requires an argument",
          "find: unsupported file type 'z'",
          "find: invalid mode: '999'",
          "find: invalid link count 'bad'",
          "find: invalid size 'bad'",
          "find: invalid time 'bad'",
          "find: -printf requires a format",
          "find: unsupported printf format directive or modifier",
          "find: -exec requires a command terminated by ';' or '+'",
          "",
        ].join("\n"),
      );
    });
  });

  it("16. find -newer missing reference file diagnostic and -delete + -prune without explicit -depth diagnostic", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work/f",
          'find /work/f -newer /work/no_ref.txt || echo "newer:$?"',
          'find /work/f -prune -o -delete || echo "pd:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "newer:1\npd:1\n");
      assert.equal(
        res.stderr,
        [
          "find: ENOENT: no such file or directory, lstat '/work/no_ref.txt'",
          "find: -delete implies -depth; -prune is ineffective unless -depth is explicitly supplied",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. xargs option validation diagnostics (-n, -L, -s, -d, -I, --process-slot-var, unknown short/long options, missing -a file)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'xargs -n 0 echo < /dev/null || echo "n0:$?"',
          'xargs -L 0 echo < /dev/null || echo "L0:$?"',
          'xargs -s 0 echo < /dev/null || echo "s0:$?"',
          'xargs -d "ab" echo < /dev/null || echo "d:$?"',
          'xargs -I "" echo < /dev/null || echo "I:$?"',
          'xargs --process-slot-var="BAD=1" echo < /dev/null || echo "slot:$?"',
          'xargs -z echo < /dev/null || echo "z:$?"',
          'xargs --bad-opt echo < /dev/null || echo "bad:$?"',
          'xargs -a /work/missing_args.txt echo || echo "a:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "n0:2\nL0:2\ns0:2\nd:2\nI:2\nslot:2\nz:2\nbad:2\na:1\n");
      assert.equal(
        res.stderr,
        [
          "xargs: invalid number '0'",
          "xargs: invalid number '0'",
          "xargs: invalid number '0'",
          "xargs: delimiter must be one ASCII byte",
          "xargs: replacement string cannot be empty",
          "xargs: invalid environment variable name",
          "xargs: invalid option -- 'z'",
          "xargs: unrecognized option '--bad-opt'",
          "xargs: ENOENT: no such file or directory, readStream '/work/missing_args.txt'",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. rg --files with --ignore-file and --no-ignore-files, plus --sort=path", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work/proj",
          "printf 'skip.txt\\n' > /work/custom.ignore",
          "printf 'a\\n' > /work/proj/keep.txt",
          "printf 'b\\n' > /work/proj/skip.txt",
          "cd /work/proj",
          "rg --files --sort=path --ignore-file=/work/custom.ignore",
          "echo '---'",
          "rg --files --sort=path --ignore-file=/work/custom.ignore --no-ignore-files",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "keep.txt\n---\nkeep.txt\nskip.txt\n");
      assert.equal(res.stderr, "");
    });
  });

  it("19. grep -f pattern file containing empty line matches all lines, and empty pattern file matches none (or all with -v)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work",
          "printf 'line1\\nline2\\n' > /work/data.txt",
          "printf '\\n' > /work/blank_pat.txt",
          ": > /work/empty_pat.txt",
          "grep -f /work/blank_pat.txt /work/data.txt",
          'grep -f /work/empty_pat.txt /work/data.txt || echo "empty_rc=$?"',
          "grep -v -f /work/empty_pat.txt /work/data.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "line1\nline2\nempty_rc=1\nline1\nline2\n");
      assert.equal(res.stderr, "");
    });
  });

  it("20. end-to-end pipeline combining RIPGREP_CONFIG_PATH rg, fd -0, xargs -0, grep -f -, and find -printf", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /work/app/src",
          "printf -- '--ignore-case\\n' > /work/app/.rgrc",
          "printf 'TODO: refactor auth\\nOK: done\\n' > /work/app/src/auth.ts",
          "printf 'todo: add tests\\n' > /work/app/src/test.ts",
          "cd /work/app",
          "export RIPGREP_CONFIG_PATH=/work/app/.rgrc",
          "fd -e ts -0 . src | xargs -0 rg -I 'todo:' | grep -e auth -e tests | sort",
          "find src -type f -name '*.ts' -printf '%f:%s\\n' | sort",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "TODO: refactor auth",
          "todo: add tests",
          "auth.ts:29",
          "test.ts:16",
          "",
        ].join("\n"),
      );
    });
  });
});
