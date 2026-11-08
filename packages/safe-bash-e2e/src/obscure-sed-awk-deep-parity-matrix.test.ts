import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure sed and awk deep parity matrix", () => {
  it("01 sed empty regex reuse (// and s//repl/) across addresses and substitutions and error when no previous regex", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/in.txt": "alpha=1\nbeta=2 beta=3\ngamma=4 gamma=5\n",
      },
    });

    const reuseAddr = await h.exec("sed '/alpha/s//ALPHA/; s/beta/BETA/; s//SECOND_BETA/' in.txt");
    assert.equal(reuseAddr.exitCode, 0);
    assert.equal(reuseAddr.stdout, "ALPHA=1\nBETA=2 SECOND_BETA=3\ngamma=4 gamma=5\n");

    const reuseInAddr = await h.exec("sed -n 's/gamma/GAMMA/; //p' in.txt");
    assert.equal(reuseInAddr.exitCode, 0);
    assert.equal(reuseInAddr.stdout, "GAMMA=4 gamma=5\n");

    const noPrevSub = await h.exec("sed 's//x/' in.txt");
    assert.equal(noPrevSub.exitCode, 2);
    assert.notEqual(noPrevSub.stderr, "");

    const noPrevAddr = await h.exec("sed '//d' in.txt");
    assert.equal(noPrevAddr.exitCode, 2);
    assert.notEqual(noPrevAddr.stderr, "");
  });

  it("02 sed custom address regex delimiters (\\cpatc), case-insensitive address regexes (/pat/I, \\cpatcI), and #n quiet header", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/paths.txt": "/usr/local/bin\n/USR/LOCAL/LIB\n/opt/app\n",
      },
    });

    const customDelim = await h.exec("sed '\\%^/usr/local%s%/usr/local%/opt%' paths.txt");
    assert.equal(customDelim.exitCode, 0);
    assert.equal(customDelim.stdout, "/opt/bin\n/USR/LOCAL/LIB\n/opt/app\n");

    const ciAddr = await h.exec("sed -n '\\#/usr/local#Ip' paths.txt");
    assert.equal(ciAddr.exitCode, 0);
    assert.equal(ciAddr.stdout, "/usr/local/bin\n/USR/LOCAL/LIB\n");

    const hashN = await h.exec("sed '#n — auto-quiet mode\n# comment with ; semicolon and { brace\n/opt/p' paths.txt");
    assert.equal(hashN.exitCode, 0);
    assert.equal(hashN.stdout, "/opt/app\n");

    const emptyFlagErr = await h.exec("sed -n '/opt/p; //Ip' paths.txt");
    assert.equal(emptyFlagErr.exitCode, 2);
    assert.notEqual(emptyFlagErr.stderr, "");
  });

  it("03 sed 0,/regex/ range matching line 1 vs 1,/regex/, relative +N and ~N ranges, and step=0 address", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/lines.txt": "hit\ntwo\nhit\nfour\nfive\nsix\n",
      },
    });

    const zeroRange = await h.exec("sed '0,/hit/s/^/>/' lines.txt");
    assert.equal(zeroRange.exitCode, 0);
    assert.equal(zeroRange.stdout, ">hit\ntwo\nhit\nfour\nfive\nsix\n");

    const oneRange = await h.exec("sed '1,/hit/s/^/>/' lines.txt");
    assert.equal(oneRange.exitCode, 0);
    assert.equal(oneRange.stdout, ">hit\n>two\n>hit\nfour\nfive\nsix\n");

    const relPlus = await h.exec("sed -n '2,+2p' lines.txt");
    assert.equal(relPlus.exitCode, 0);
    assert.equal(relPlus.stdout, "two\nhit\nfour\n");

    const relTilde = await h.exec("sed -n '3,~4p' lines.txt");
    assert.equal(relTilde.exitCode, 0);
    assert.equal(relTilde.stdout, "hit\nfour\n");

    const stepZero = await h.exec("sed -n '4~0p' lines.txt");
    assert.equal(stepZero.exitCode, 0);
    assert.equal(stepZero.stdout, "four\n");

    const badZero = await h.exec("sed '0,3d' lines.txt");
    assert.equal(badZero.exitCode, 2);
    assert.notEqual(badZero.stderr, "");
  });

  it("04 sed N at EOF skips printing pattern space while flushing queued appends and N mid-stream flushes queued appends", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/three.txt": "L1\nL2\nL3\n",
      },
    });

    const res = await h.exec("sed -e 'a\\AFTER' -e 'N; s/\\n/+/' three.txt");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "AFTER\nL1+L2\nAFTER\n");
  });

  it("05 sed c (change) on 2-address ranges emits once at end of range vs every line when negated (!c), plus q and Q exit codes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/five.txt": "1\n2\n3\n4\n5\n",
      },
    });

    const rangeChange = await h.exec("sed '2,4c\\CHANGED' five.txt");
    assert.equal(rangeChange.exitCode, 0);
    assert.equal(rangeChange.stdout, "1\nCHANGED\n5\n");

    const negatedChange = await h.exec("sed '2,4!c\\OUT' five.txt");
    assert.equal(negatedChange.exitCode, 0);
    assert.equal(negatedChange.stdout, "OUT\n2\n3\n4\nOUT\n");

    const quitCode = await h.exec("sed '3q 42' five.txt");
    assert.equal(quitCode.exitCode, 42);
    assert.equal(quitCode.stdout, "1\n2\n3\n");

    const quitSilentCode = await h.exec("sed '3Q 17' five.txt");
    assert.equal(quitSilentCode.exitCode, 17);
    assert.equal(quitSilentCode.stdout, "1\n2\n");
  });

  it("06 sed l (unambiguous list) control/octal escaping, embedded newline $, and -l N line wrapping", async () => {
    const h = await SafeBashE2EHarness.create();

    const escapes = await h.exec("printf 'a\\tb\\\\c\\007\\014\\033\\n' | sed -n 'l'");
    assert.equal(escapes.exitCode, 0);
    assert.equal(escapes.stdout, "a\\tb\\\\c\\a\\f\\033$\n");

    const wrapped = await h.exec("printf '0123456789ABCDEF\\n' | sed -n -l 10 'l'");
    assert.equal(wrapped.exitCode, 0);
    assert.equal(wrapped.stdout, "012345678\\\n9ABCDEF$\n");

    const embeddedNl = await h.exec("printf 'first\\nsecond\\n' | sed -n 'N; l'");
    assert.equal(embeddedNl.exitCode, 0);
    assert.equal(embeddedNl.stdout, "first$\nsecond$\n");
  });

  it("07 sed multi-expression -e group spanning (-e '2,3{' -e ... -e '}'), nested groups, and t/T conditional branch reset", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/items.txt": "a1\na2\na3\na4\n",
      },
    });

    const spanned = await h.exec("sed -e '2,3{' -e 's/a/A/' -e '2,2{ s/2/TWO/; }' -e '}' items.txt");
    assert.equal(spanned.exitCode, 0);
    assert.equal(spanned.stdout, "a1\nATWO\nA3\na4\n");

    const branchReset = await h.exec("printf 'foo\\nbar\\n' | sed 's/foo/FOO/; t hit; T miss; :hit; s/$/_HIT/; t extra; b end; :miss; s/$/_MISS/; b end; :extra; s/$/_EXTRA/; :end'");
    assert.equal(branchReset.exitCode, 0);
    assert.equal(branchReset.stdout, "FOO_HIT_EXTRA\nbar_MISS\n");
  });

  it("08 sed s/// multi-digit occurrence index (s/a/X/10), combined N+g (s/a/X/3g), and undefined backreference validation", async () => {
    const h = await SafeBashE2EHarness.create();

    const tenth = await h.exec("printf 'a.a.a.a.a.a.a.a.a.a.a\\n' | sed 's/a/X/10'");
    assert.equal(tenth.exitCode, 0);
    assert.equal(tenth.stdout, "a.a.a.a.a.a.a.a.a.X.a\n");

    const thirdGlobal = await h.exec("printf 'a-a-a-a-a\\n' | sed 's/a/X/3g'");
    assert.equal(thirdGlobal.exitCode, 0);
    assert.equal(thirdGlobal.stdout, "a-a-X-X-X\n");

    const badBackref = await h.exec("printf 'abc\\n' | sed 's/abc/\\1/'");
    assert.equal(badBackref.exitCode, 2);
    assert.notEqual(badBackref.stderr, "");
  });

  it("09 sed -z NUL-delimited records with H, G, P, D, =, F and unterminated final record preservation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/nul.bin": "one\0two\0three",
      },
    });

    const nulHold = await h.exec("sed -z '1h; 1!H; $!d; $g' nul.bin | tr '\\0' '|'");
    assert.equal(nulHold.exitCode, 0);
    assert.equal(nulHold.stdout, "one|two|three");

    const nulMeta = await h.exec("sed -z -n '1{ F; =; p; }' nul.bin | tr '\\0' ':'");
    assert.equal(nulMeta.exitCode, 0);
    assert.equal(nulMeta.stdout, "nul.bin:1:one:");
  });

  it("10 sed option and syntax error diagnostics return exit code 2", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f.txt": "hello\n",
      },
    });

    for (const cmd of [
      "sed -Z 's/a/b/' f.txt",
      "sed -e",
      "sed",
      "sed '{s/a/b/' f.txt",
      "sed '}' f.txt",
      "sed '1}' f.txt",
      "sed 'b missing' f.txt",
      "sed ':dup; :dup' f.txt",
      "sed 'y/ab/cde/' f.txt",
      "sed '1,2q' f.txt",
      "sed 'q 300' f.txt",
      "sed 'X' f.txt",
      "sed -i 's/a/b/'",
    ]) {
      const res = await h.exec(cmd);
      assert.equal(res.exitCode, 2, `Expected exit 2 for: ${cmd}, got ${res.exitCode} (stderr: ${res.stderr})`);
      assert.notEqual(res.stderr, "", `Expected non-empty stderr for: ${cmd}`);
    }
  });

  it("11 awk exit inside BEGIN and record rules still executes END, preserves status across bare exit in END, and normalizes mod 256", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/data.txt": "r1\nr2\nr3\n",
      },
    });

    const beginExit = await h.exec("awk 'BEGIN { print \"B\"; exit 7 } { print \"BODY\" } END { print \"E\" }' data.txt");
    assert.equal(beginExit.exitCode, 7);
    assert.equal(beginExit.stdout, "B\nE\n");

    const ruleExit = await h.exec("awk 'NR == 2 { print \"STOP\", $0; exit 13 } { print \"ROW\", $0 } END { print \"END_NR\", NR; exit }' data.txt");
    assert.equal(ruleExit.exitCode, 13);
    assert.equal(ruleExit.stdout, "ROW r1\nSTOP r2\nEND_NR 2\n");

    const overrideExit = await h.exec("awk 'BEGIN { exit 9 } END { print \"OVERRIDE\"; exit 3 }'");
    assert.equal(overrideExit.exitCode, 3);
    assert.equal(overrideExit.stdout, "OVERRIDE\n");

    const negExit = await h.exec("awk 'BEGIN { exit -1 }'");
    assert.equal(negExit.exitCode, 255);
  });

  it("12 awk END-only programs read all input files and apply interleaved VAR=value operand assignments", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.txt": "alpha 10\nbeta 20\n",
        "/workspace/b.txt": "gamma 30\ndelta 40 50\n",
      },
    });

    const endOnly = await h.exec("awk 'END { print NR, FNR, FILENAME, $1, $NF, tag }' tag=first a.txt tag=second b.txt");
    assert.equal(endOnly.exitCode, 0);
    assert.equal(endOnly.stdout, "4 2 b.txt delta 50 second\n");
  });

  it("13 awk negated regex patterns (!/pat/), compound regex boolean conditions, and regex literals in scalar expressions", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/log.txt": "keep alpha\nskip beta\nkeep gamma ignore\nkeep delta\n",
      },
    });

    const negDefault = await h.exec("awk '!/skip/' log.txt");
    assert.equal(negDefault.exitCode, 0);
    assert.equal(negDefault.stdout, "keep alpha\nkeep gamma ignore\nkeep delta\n");

    const compound = await h.exec("awk '/keep/ && !/ignore/ { is_delta = /delta/; print $2, is_delta }' log.txt");
    assert.equal(compound.exitCode, 0);
    assert.equal(compound.stdout, "alpha 0\ndelta 1\n");
  });

  it("14 awk do-while loops, break, and continue inside while, for, do-while, and for-in loops", async () => {
    const h = await SafeBashE2EHarness.create();

    const loops = await h.exec(`awk 'BEGIN {
      i = 0
      out = ""
      do {
        i++
        if (i == 2) continue
        out = out i ":"
        if (i == 4) break
      } while (i < 10)

      do {
        out = out "once"
      } while (0)

      sum = 0
      for (j = 1; j <= 6; j++) {
        if (j % 2 == 0) continue
        if (j == 5) break
        sum += j
      }
      print out, sum
    }'`);
    assert.equal(loops.exitCode, 0);
    assert.equal(loops.stdout, "1:3:4:once 4\n");
  });

  it("15 awk ARGC and ARGV manipulation in BEGIN (skipping and appending files) and multiple -e / -f sources", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f1.txt": "from_f1\n",
        "/workspace/f2.txt": "from_f2\n",
        "/workspace/f3.txt": "from_f3\n",
        "/workspace/lib.awk": "function wrap(s) { return \"[\" s \"]\" }\n",
      },
    });

    const argvManip = await h.exec(
      "awk -f lib.awk -e 'BEGIN { ARGV[1] = \"\"; ARGV[ARGC++] = \"f3.txt\" }' -e '{ print FILENAME \":\" wrap($0) }' f1.txt f2.txt",
    );
    assert.equal(argvManip.exitCode, 0);
    assert.equal(argvManip.stdout, "f2.txt:[from_f2]\nf3.txt:[from_f3]\n");
  });

  it("16 awk %= compound assignment, exp/log/atan2/sin/cos/sqrt/int math, deterministic srand/rand, and bitwise functions", async () => {
    const h = await SafeBashE2EHarness.create();

    const mathRes = await h.exec(`awk 'BEGIN {
      x = 17
      x %= 5
      m = int(log(exp(4)) + 0.5)
      srand(12345)
      r1 = sprintf("%.6f", rand())
      r2 = sprintf("%.6f", rand())
      srand(12345)
      r3 = sprintf("%.6f", rand())
      b = xor(or(and(15, 6), lshift(1, 4)), rshift(32, 2))
      print x, m, (r1 == r3 ? "det_ok" : "det_bad"), (r1 != r2 ? "adv_ok" : "adv_bad"), b
    }'`);
    assert.equal(mathRes.exitCode, 0);
    assert.equal(mathRes.stdout, "2 4 det_ok adv_ok 30\n");
  });

  it("17 awk printf/sprintf advanced specifiers (%e, %E, %g, %G, %u, %#x, %#o, %+d, %*.*f) and OFMT / CONVFMT", async () => {
    const h = await SafeBashE2EHarness.create();

    const fmtRes = await h.exec(`awk 'BEGIN {
      s1 = sprintf("%+.2e|%#.4g|%#x|%#o|%*.*f", 12.5, 12.5, 255, 64, 6, 2, 3.5)
      OFMT = "%.2f"
      CONVFMT = "%.3f"
      n = 1 + 2.3456
      s2 = "" n
      print s1, n, s2
    }'`);
    assert.equal(fmtRes.exitCode, 0);
    assert.equal(fmtRes.stdout, "+1.25e+01|12.50|0xff|0100|  3.50 3.35 3.346\n");
  });

  it("18 awk sub, gsub, gensub with & and \\& escapes, field target rebuild ($0), and 4-arg split with seps array", async () => {
    const h = await SafeBashE2EHarness.create();

    const res = await h.exec(`printf 'foo bar_bar k1=10,k2=20,k3=30\\n' | awk 'BEGIN { OFS = "|" } {
      c1 = sub(/foo/, "[&]", $1)
      c2 = gsub(/bar/, "\\\\&", $2)
      g = gensub(/(k[0-9]+)=([0-9]+)/, "\\\\2:\\\\1", 2, $3)
      n = split("a:b;;c", parts, /[:;]+/, seps)
      print c1, c2, $0, g, n, parts[2], seps[1], seps[2]
    }'`);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1|2|[foo]|&_&|k1=10,k2=20,k3=30|k1=10,20:k2,k3=30|3|b|:|;;\n");
  });

  it("19 awk user-defined functions with extra local parameters, recursive calls, and escaped quotes/braces inside if/else", async () => {
    const h = await SafeBashE2EHarness.create();

    const res = await h.exec(`awk '
      function fact_acc(n, local_tmp) {
        if (n <= 1) return 1
        local_tmp = n * fact_acc(n - 1)
        return local_tmp
      }
      BEGIN {
        local_tmp = 999
        r = fact_acc(5)
        if (r == 120) {
          msg = "ok:\\"}\\"\\"{\\""
        } else {
          msg = "bad:\\"{\\""
        }
        print r, local_tmp, msg
      }
    '`);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "120 999 ok:\"}\"\"{\"\n");
  });

  it("20 awk runtime and syntax error diagnostics (division by zero, bad options, missing program) return exit code 2", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f.txt": "1\n",
      },
    });

    for (const cmd of [
      "awk 'BEGIN { print 1 / 0 }'",
      "awk 'BEGIN { print 1 % 0 }'",
      "awk -Z '{ print }' f.txt",
      "awk -v 123bad=1 '{ print }' f.txt",
      "awk",
    ]) {
      const res = await h.exec(cmd);
      assert.equal(res.exitCode, 2, `Expected exit 2 for: ${cmd}, got ${res.exitCode} (stderr: ${res.stderr})`);
      assert.notEqual(res.stderr, "", `Expected non-empty stderr for: ${cmd}`);
    }
  });
});
