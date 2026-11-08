import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure text commands (sed, awk, diff, patch, cmp, diff3) diagnostics and option parity matrix", () => {
  it("01 sed unsupported options (-h, --help, --unknown, -X) and missing option arguments (-e, --expression, -f, --file)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      sed -h 2>e1; echo "RC1=$?"
      sed --help 2>e2; echo "RC2=$?"
      sed --bogus 2>e3; echo "RC3=$?"
      sed -e 2>e4; echo "RC4=$?"
      sed --expression 2>e5; echo "RC5=$?"
      sed -f 2>e6; echo "RC6=$?"
      sed --file 2>e7; echo "RC7=$?"
      cat e1 e2 e3 e4 e5 e6 e7
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "RC7=2",
        "sed: unsupported option '-h'",
        "sed: unsupported option '--help'",
        "sed: unsupported option '--bogus'",
        "sed: -e requires an argument",
        "sed: --expression requires an argument",
        "sed: -f requires an argument",
        "sed: --file requires an argument",
        "",
      ].join("\n"),
    );
  });

  it("02 sed -l / --line-length validation, --posix flag, and trailing -e after file operand", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/in.txt": "alpha\nbeta\n",
      },
    });
    const res = await h.exec(`
      sed -l 2>e1; echo "RC1=$?"
      sed -l -5 'p' 2>e2; echo "RC2=$?"
      sed --line-length=abc 'p' 2>e3; echo "RC3=$?"
      sed --posix /workspace/in.txt -e 's/alpha/ALPHA/'
      cat e1 e2 e3
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "ALPHA",
        "beta",
        "sed: line length must be a nonnegative safe integer",
        "sed: line length must be a nonnegative safe integer",
        "sed: line length must be a nonnegative safe integer",
        "",
      ].join("\n"),
    );
  });

  it("03 sed missing -f script file (readFile), missing input file (readStream), and missing -i target (lstat) diagnostics", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      sed -f /workspace/missing.sed 2>e1; echo "RC1=$?"
      sed 'p' /workspace/missing.txt 2>e2; echo "RC2=$?"
      sed -s 'p' /workspace/missing_sep.txt 2>e3; echo "RC3=$?"
      sed -i 's/a/b/' /workspace/missing_inp.txt 2>e4; echo "RC4=$?"
      cat e1 e2 e3 e4
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=1",
        "RC2=1",
        "RC3=1",
        "RC4=1",
        "sed: ENOENT: no such file or directory, readFile '/workspace/missing.sed'",
        "sed: ENOENT: no such file or directory, readStream '/workspace/missing.txt'",
        "sed: ENOENT: no such file or directory, readStream '/workspace/missing_sep.txt'",
        "sed: ENOENT: no such file or directory, lstat '/workspace/missing_inp.txt'",
        "",
      ].join("\n"),
    );
  });

  it("04 awk --help / -h output and missing program / unsupported option diagnostics", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      awk --help
      echo "HELP_RC=$?"
      awk 2>e1; echo "RC1=$?"
      awk -Z '{ print }' 2>e2; echo "RC2=$?"
      awk --bogus '{ print }' 2>e3; echo "RC3=$?"
      cat e1 e2 e3
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Usage: awk [options] 'program' [file ...]",
        "  -F, --field-separator FS  Set the field separator",
        "  -v NAME=value            Assign a variable",
        "  -f, --file FILE           Read the program from a file",
        "  -e, --source PROGRAM      Add program text",
        "  -h, --help                Show this help",
        "HELP_RC=0",
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "awk: missing awk program",
        "awk: unsupported awk option '-Z'",
        "awk: unsupported awk option '--bogus'",
        "",
      ].join("\n"),
    );
  });

  it("05 awk option argument validation (-F, --field-separator, -v, --assign, -f, --file, -e, --source, -l, --load)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      awk -F 2>e1; echo "RC1=$?"
      awk --field-separator 2>e2; echo "RC2=$?"
      awk -v 2>e3; echo "RC3=$?"
      awk -v 1bad=x 'BEGIN{}' 2>e4; echo "RC4=$?"
      awk -v noequals 'BEGIN{}' 2>e5; echo "RC5=$?"
      awk -f 2>e6; echo "RC6=$?"
      awk -e 2>e7; echo "RC7=$?"
      awk -l 2>e8; echo "RC8=$?"
      awk -l filefuncs 'BEGIN{}' 2>e9; echo "RC9=$?"
      cat e1 e2 e3 e4 e5 e6 e7 e8 e9
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "RC7=2",
        "RC8=2",
        "RC9=2",
        "awk: -F requires an argument",
        "awk: --field-separator requires an argument",
        "awk: -v requires an argument",
        "awk: -v requires a NAME=value assignment",
        "awk: -v requires a NAME=value assignment",
        "awk: -f requires an argument",
        "awk: -e requires an argument",
        "awk: -l requires an argument",
        "awk: unsupported awk extension 'filefuncs'",
        "",
      ].join("\n"),
    );
  });

  it("06 awk batch debugger (-D / --debug), -E / --exec disabling operand assignments, and missing file ENOENT diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/prog.awk": "BEGIN { print \"from_prog\", ARGV[1], x }",
        "/workspace/dbg_run.cmd": "# comment\nrun\nquit\n",
        "/workspace/dbg_quit.cmd": "quit\n",
        "/workspace/dbg_bad.cmd": "step\n",
      },
    });
    const res = await h.exec(`
      awk -D 2>e1; echo "RC1=$?"
      awk -D/workspace/dbg_run.cmd 'BEGIN { print 1 }' 2>e2; echo "RC2=$?"
      awk -D/workspace/dbg_run.cmd -f /workspace/prog.awk x=42
      awk -D/workspace/dbg_quit.cmd -f /workspace/prog.awk
      echo "QUIT_RC=$?"
      awk -D/workspace/dbg_bad.cmd -f /workspace/prog.awk 2>e3; echo "RC3=$?"
      awk -f /workspace/missing.awk 2>e4; echo "RC4=$?"
      awk '{ print }' /workspace/missing.txt 2>e5; echo "RC5=$?"
      cat e1 e2 e3 e4 e5
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "from_prog x=42 ",
        "QUIT_RC=0",
        "RC3=2",
        "RC4=1",
        "RC5=1",
        "awk: debugging requires an explicit VFS command file; interactive debugging is unavailable",
        "awk: debugging requires a program supplied with -f",
        "awk: unsupported batch debugger command 'step'; supported commands are run and quit",
        "awk: ENOENT: no such file or directory, readFile '/workspace/missing.awk'",
        "awk: ENOENT: no such file or directory, readStream '/workspace/missing.txt'",
        "",
      ].join("\n"),
    );
  });

  it("07 awk stops option parsing at first non-option argument so trailing flags become ARGV operands", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      awk 'BEGIN { print ARGC, ARGV[1], ARGV[2] }' -n --unknown
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "3 -n --unknown\n");
  });

  it("08 diff unsupported option diagnostics (--help, --version, -v, --bogus, -z) and missing option arguments", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      diff --help 2>e1; echo "RC1=$?"
      diff --version 2>e2; echo "RC2=$?"
      diff -v 2>e3; echo "RC3=$?"
      diff -U 2>e4; echo "RC4=$?"
      diff --width 2>e5; echo "RC5=$?"
      diff --from-file 2>e6; echo "RC6=$?"
      diff -L 2>e7; echo "RC7=$?"
      cat e1 e2 e3 e4 e5 e6 e7
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "RC7=2",
        "diff: unsupported option: --help",
        "diff: unsupported option: --version",
        "diff: unsupported option: -v",
        "diff: -U requires an argument",
        "diff: --width requires an argument",
        "diff: --from-file requires an argument",
        "diff: -L requires an argument",
        "",
      ].join("\n"),
    );
  });

  it("09 diff invalid context, invalid width, width=0, invalid color, and operand count diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.txt": "a\n",
        "/workspace/b.txt": "a\n",
      },
    });
    const res = await h.exec(`
      diff -U -1 /workspace/a.txt /workspace/b.txt 2>e1; echo "RC1=$?"
      diff -W abc /workspace/a.txt /workspace/b.txt 2>e2; echo "RC2=$?"
      diff -W 0 /workspace/a.txt /workspace/b.txt 2>e3; echo "RC3=$?"
      diff --color=neon /workspace/a.txt /workspace/b.txt 2>e4; echo "RC4=$?"
      diff /workspace/a.txt 2>e5; echo "RC5=$?"
      diff --from-file=/workspace/a.txt 2>e6; echo "RC6=$?"
      cat e1 e2 e3 e4 e5 e6
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "diff: invalid context length: -1",
        "diff: invalid context length: abc",
        "diff: invalid width: 0",
        "diff: invalid color: neon",
        "diff: expected two files or directories",
        "diff: expected at least one file or directory",
        "",
      ].join("\n"),
    );
  });

  it("10 diff directory vs stdin, -D with directory, missing -X exclude file, and control chars in labels", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/dir/f.txt": "hello\n",
        "/workspace/a.txt": "hello\n",
      },
    });
    const res = await h.exec(`
      printf 'hello\\n' | diff - /workspace/dir 2>e1; echo "RC1=$?"
      diff -D MACRO /workspace/dir /workspace/dir 2>e2; echo "RC2=$?"
      diff -X /workspace/no_such_exclude /workspace/a.txt /workspace/a.txt 2>e3; echo "RC3=$?"
      TAB=$'a\\tb'
      diff -L "$TAB" /workspace/a.txt /workspace/a.txt 2>e4; echo "RC4=$?"
      cat e1 e2 e3 e4
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "diff: cannot compare stdin with a directory",
        "diff: -D option not supported with directories",
        "diff: diff input requires identity-checked retained reads",
        "diff: empty names or control characters in filenames/labels are unsupported",
        "",
      ].join("\n"),
    );
  });

  it("11 diff -N / -P top-level missing file comparison and both-missing files diagnostic", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/present.txt": "one\ntwo\n",
      },
    });
    const res = await h.exec(`
      diff /workspace/missing1.txt /workspace/missing2.txt 2>e1; echo "RC1=$?"
      diff -u -N /workspace/missing1.txt /workspace/present.txt
      echo "RC2=$?"
      diff -u -P /workspace/missing1.txt /workspace/present.txt
      echo "RC3=$?"
      diff -u -P /workspace/present.txt /workspace/missing2.txt 2>e4; echo "RC4=$?"
      cat e1 e4
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "--- /dev/null",
        "+++ /workspace/present.txt",
        "@@ -0,0 +1,2 @@",
        "+one",
        "+two",
        "RC2=1",
        "--- /dev/null",
        "+++ /workspace/present.txt",
        "@@ -0,0 +1,2 @@",
        "+one",
        "+two",
        "RC3=1",
        "RC4=2",
        "diff: /workspace/missing1.txt: No such file or directory",
        "diff: /workspace/missing2.txt: No such file or directory",
        "diff: /workspace/missing2.txt: No such file or directory",
        "",
      ].join("\n"),
    );
  });

  it("12 patch unsupported options, missing option arguments, and clustered short options (-Rsf, -up1)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/app.txt": "NEW\n",
        "/workspace/change.patch": "--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-OLD\n+NEW\n",
      },
    });
    const res = await h.exec(`
      patch --help 2>e1; echo "RC1=$?"
      patch -x 2>e2; echo "RC2=$?"
      patch -p 2>e3; echo "RC3=$?"
      patch --strip 2>e4; echo "RC4=$?"
      patch -Rsf -up1 /workspace/app.txt -i /workspace/change.patch
      echo "RC5=$?"
      cat /workspace/app.txt
      cat e1 e2 e3 e4
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=0",
        "OLD",
        "patch: unsupported option: --help",
        "patch: unsupported option: -x",
        "patch: -p requires an argument",
        "patch: --strip requires an argument",
        "",
      ].join("\n"),
    );
  });

  it("13 patch option value validation (--merge, --quoting-style, --reject-format, --read-only, -p, -F, -V, -g, --get)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      patch --merge=bogus 2>e1; echo "RC1=$?"
      patch --quoting-style=bogus 2>e2; echo "RC2=$?"
      patch --reject-format=bogus 2>e3; echo "RC3=$?"
      patch --read-only=bogus 2>e4; echo "RC4=$?"
      patch -p abc 2>e5; echo "RC5=$?"
      patch -F -1 2>e6; echo "RC6=$?"
      patch -V bogus 2>e7; echo "RC7=$?"
      patch -g 1 2>e8; echo "RC8=$?"
      patch --get=1 2>e9; echo "RC9=$?"
      cat e1 e2 e3 e4 e5 e6 e7 e8 e9
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "RC7=2",
        "RC8=2",
        "RC9=2",
        "patch: invalid merge style: bogus",
        "patch: invalid quoting style: bogus",
        "patch: invalid reject format: bogus",
        "patch: invalid read-only behavior: bogus",
        "patch: invalid strip count: abc",
        "patch: invalid fuzz: -1",
        "patch: invalid version control: bogus",
        "patch: version-control acquisition is unsupported; use -g0",
        "patch: version-control acquisition is unsupported; use --get=0",
        "",
      ].join("\n"),
    );
  });

  it("14 patch path/target validation (/dev/null restrictions, non-directory -d, missing -i input, and -D symbol)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/regular.txt": "hello\n",
      },
    });
    const res = await h.exec(`
      patch a b c 2>e1; echo "RC1=$?"
      patch -D 'bad-sym' 2>e2; echo "RC2=$?"
      patch -d /workspace/no_such_dir 2>e3; echo "RC3=$?"
      patch -o /dev/null 2>e4; echo "RC4=$?"
      patch /dev/null 2>e5; echo "RC5=$?"
      patch -r /dev/null 2>e6; echo "RC6=$?"
      patch -i /workspace/missing.patch 2>e7; echo "RC7=$?"
      cat e1 e2 e3 e4 e5 e6 e7
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "RC7=2",
        "patch: expected at most a target file and a patch input file",
        "patch: invalid ifdef symbol",
        "patch: not a directory: /workspace/no_such_dir",
        "patch: /dev/null is not an output file",
        "patch: /dev/null is not an explicit target",
        "patch: /dev/null is not a reject file; use -r -",
        "patch: patch input must be a regular file",
        "",
      ].join("\n"),
    );
  });

  it("15 cmp --help and -v / --version output match virtual-bash profile", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      cmp --version
      cmp -v
      cmp --help
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "cmp (virtual-bash)",
        "cmp (virtual-bash)",
        "Usage: cmp [OPTION]... FILE1 [FILE2 [SKIP1 [SKIP2]]]",
        "Compare bytes in the virtual filesystem; omitted FILE2 or '-' reads stdin.",
        "  -s, --silent, --quiet  report status only",
        "  -l, --verbose         list differing bytes in octal",
        "  -b, -c, --print-bytes  also display byte characters",
        "  -i, --ignore-initial=SKIP[:SKIP2]  skip initial bytes",
        "  -n, --bytes=LIMIT     compare at most LIMIT bytes",
        "  --help, -v, --version show virtual-bash command information",
        "",
      ].join("\n"),
    );
  });

  it("16 cmp UsageError diagnostics include Try 'cmp --help' suffix for missing/extra operands and invalid options", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      cmp 2>e1; echo "RC1=$?"
      cmp -s 2>e2; echo "RC2=$?"
      cmp a b 1 2 3 2>e3; echo "RC3=$?"
      cmp --bogus a b 2>e4; echo "RC4=$?"
      cmp --print a b 2>e5; echo "RC5=$?"
      cmp --silent=1 a b 2>e6; echo "RC6=$?"
      cmp -z a b 2>e7; echo "RC7=$?"
      cat e1 e2 e3 e4 e5 e6 e7
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "RC7=2",
        "cmp: missing operand after 'cmp'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: missing operand after '-s'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: extra operand '3'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: unrecognized option '--bogus'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: option '--print' is ambiguous; possibilities: '--print-bytes' '--print-chars'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: option '--silent' doesn't allow an argument",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: invalid option -- 'z'",
        "cmp: Try 'cmp --help' for more information.",
        "",
      ].join("\n"),
    );
  });

  it("17 cmp --bytes / --ignore-initial and positional SKIP1/SKIP2 validation diagnostics", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      cmp -n 2>e1; echo "RC1=$?"
      cmp --bytes 2>e2; echo "RC2=$?"
      cmp -n bad a b 2>e3; echo "RC3=$?"
      cmp -i bad:2 a b 2>e4; echo "RC4=$?"
      cmp -i 2:bad a b 2>e5; echo "RC5=$?"
      cmp -i 1:2:3 a b 2>e6; echo "RC6=$?"
      cmp a b +K 2>e7; echo "RC7=$?"
      cat e1 e2 e3 e4 e5 e6 e7
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "RC7=2",
        "cmp: option requires an argument -- 'n'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: option '--bytes' requires an argument",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: invalid --bytes value 'bad'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: invalid --ignore-initial value 'bad:2'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: invalid --ignore-initial value 'bad'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: invalid --ignore-initial value '2:3'",
        "cmp: Try 'cmp --help' for more information.",
        "cmp: invalid --ignore-initial value '+K'",
        "cmp: Try 'cmp --help' for more information.",
        "",
      ].join("\n"),
    );
  });

  it("18 diff3 --help and --version output and validation of conflicting flags alongside --help", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(`
      diff3 --help
      diff3 --version
      diff3 --help -m -i 2>e1; echo "RC1=$?"
      diff3 --help -L lbl 2>e2; echo "RC2=$?"
      cat e1 e2
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Usage: diff3 [OPTION]... OURS BASE THEIRS",
        "Reports, -m merge, -A/-e/-E/-3/-x/-X ed scripts; -a -T -L -i --strip-trailing-cr.",
        "No external diff/ed programs. One stdin operand in any position. Ed labels must be single-line.",
        "diff3 (safe-bash; GNU diffutils 3.12 qualified profile)",
        "RC1=2",
        "RC2=2",
        "diff3: Incompatible options: merge and write/quit",
        "diff3: Labels require a flagging mode",
        "",
      ].join("\n"),
    );
  });

  it("19 diff3 long option prefix matching, --diff-program rejection, and option error diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/m.txt": "mine\n",
        "/workspace/o.txt": "base\n",
        "/workspace/t.txt": "base\n",
      },
    });
    const res = await h.exec(`
      diff3 --mer /workspace/m.txt /workspace/o.txt /workspace/t.txt
      echo "MER_RC=$?"
      diff3 --sh /workspace/m.txt /workspace/o.txt /workspace/t.txt 2>e1; echo "RC1=$?"
      diff3 --bogus /workspace/m.txt /workspace/o.txt /workspace/t.txt 2>e2; echo "RC2=$?"
      diff3 --merge=1 /workspace/m.txt /workspace/o.txt /workspace/t.txt 2>e3; echo "RC3=$?"
      diff3 --diff-program=diff /workspace/m.txt /workspace/o.txt /workspace/t.txt 2>e4; echo "RC4=$?"
      diff3 -z /workspace/m.txt /workspace/o.txt /workspace/t.txt 2>e5; echo "RC5=$?"
      diff3 -m -L 2>e6; echo "RC6=$?"
      cat e1 e2 e3 e4 e5 e6
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "mine",
        "MER_RC=0",
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=2",
        "RC5=2",
        "RC6=2",
        "diff3: Unknown or ambiguous long option",
        "diff3: Unknown or ambiguous long option",
        "diff3: Option does not accept a value",
        "diff3: External diff programs are unavailable",
        "diff3: Unsupported option",
        "diff3: Label requires a value",
        "",
      ].join("\n"),
    );
  });

  it("20 diff3 multiline ed label rejection, VFS read failure diagnostic, and binary input without -a rejection", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/m.txt": "mine\n",
        "/workspace/o.txt": "base\n",
        "/workspace/t.txt": "theirs\n",
        "/workspace/bin1.dat": new Uint8Array([0x61, 0x00, 0x62, 0x0a]),
        "/workspace/bin2.dat": new Uint8Array([0x61, 0x00, 0x63, 0x0a]),
      },
    });
    const res = await h.exec(`
      NL=$'line1\\nline2'
      diff3 -E -L "$NL" /workspace/m.txt /workspace/o.txt /workspace/t.txt 2>e1; echo "RC1=$?"
      diff3 /workspace/missing.txt /workspace/o.txt /workspace/t.txt 2>e2; echo "RC2=$?"
      diff3 /workspace/bin1.dat /workspace/o.txt /workspace/bin2.dat 2>e3; echo "RC3=$?"
      diff3 -a -m /workspace/bin1.dat /workspace/bin1.dat /workspace/bin1.dat >/dev/null; echo "RC4=$?"
      cat e1 e2 e3
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "RC1=2",
        "RC2=2",
        "RC3=2",
        "RC4=0",
        "diff3: Ed labels must be single-line",
        "diff3: VFS read failed",
        "diff3: Binary input requires text comparison",
        "",
      ].join("\n"),
    );
  });
});
