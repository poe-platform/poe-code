import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure join, tsort, sponge, envsubst, tac, rev, cat, head, tail, wc, tee, sort, and uniq parity matrix", () => {
  test("1. join -1/-2/-a/-v/-e/-o auto/explicit, --header, and -t '' whole-line mode", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work");
      const r = await sh.exec(`
        printf 'id,name,role\\n1,alice,\\n2,bob,eng\\n3,carol,ops\\n' > /work/left.csv
        printf 'id,dept\\n1,core\\n2,\\n4,sec\\n' > /work/right.csv
        join -t , --header -a 1 -a 2 -e NULL -o auto /work/left.csv /work/right.csv
        echo "---"
        join -t , --header -v 1 -o 0,1.2 /work/left.csv /work/right.csv
        echo "---"
        printf 'alpha line\\nbeta line\\n' > /work/w1.txt
        printf 'alpha line\\ngamma line\\n' > /work/w2.txt
        join -t '' /work/w1.txt /work/w2.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(
        r.stdout,
        "id,name,role,dept\n1,alice,NULL,core\n2,bob,eng,NULL\n3,carol,ops,NULL\n4,NULL,NULL,sec\n---\nid,name\n3,carol\n---\nalpha line\n"
      );
    });
  });

  test("2. join order checking (--check-order, --nocheck-order, default order warning on unpaired)", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work");
      const r = await sh.exec(`
        printf 'b 1\\na 2\\n' > /work/u1.txt
        printf 'b x\\na y\\n' > /work/u2.txt
        join /work/u1.txt /work/u2.txt
        echo "rc0=$?"
        join --check-order /work/u1.txt /work/u2.txt
        echo "rc1=$?"
        printf 'a x\\nc y\\n' > /work/u3.txt
        join /work/u1.txt /work/u3.txt
        echo "rc2=$?"
        join --nocheck-order /work/u1.txt /work/u3.txt
        echo "rc3=$?"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "b 1 x\na 2 y\nrc0=0\nrc1=1\nrc2=1\nrc3=0\n");
      assert.equal(
        r.stderr,
        "join: EINVAL: file 1 is not in sorted order\njoin: file 1 is not in sorted order\njoin: input is not in sorted order\n"
      );
    });
  });

  test("3. join option, operand, and filesystem EINVAL/ENOENT/EISDIR diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work/dir && printf 'a 1\\n' > /work/f.txt");

      const r1 = await sh.exec("join /work/f.txt");
      assert.equal(r1.exitCode, 1);
      assert.equal(r1.stderr, "join: EINVAL: join requires exactly two files\n");

      const r2 = await sh.exec("join /work/f.txt /work/f.txt /work/f.txt");
      assert.equal(r2.exitCode, 1);
      assert.equal(r2.stderr, "join: EINVAL: join requires exactly two files\n");

      const r3 = await sh.exec("join - - < /work/f.txt");
      assert.equal(r3.exitCode, 1);
      assert.equal(r3.stderr, "join: EINVAL: both files cannot be standard input\n");

      const r4 = await sh.exec("join -t ab /work/f.txt /work/f.txt");
      assert.equal(r4.exitCode, 1);
      assert.equal(r4.stderr, "join: EINVAL: join delimiter must be one byte in the C locale\n");

      const r5 = await sh.exec("join -o bad /work/f.txt /work/f.txt");
      assert.equal(r5.exitCode, 1);
      assert.equal(r5.stderr, "join: EINVAL: invalid output field: bad\n");

      const r6 = await sh.exec("join -1 1 -1 2 /work/f.txt /work/f.txt");
      assert.equal(r6.exitCode, 1);
      assert.equal(r6.stderr, "join: EINVAL: incompatible join fields 0, 1\n");

      const r7 = await sh.exec("join /work/missing /work/f.txt");
      assert.equal(r7.exitCode, 1);
      assert.equal(r7.stderr, "join: ENOENT: no such file or directory, stat '/work/missing'\n");

      const r8 = await sh.exec("join /work/dir /work/f.txt");
      assert.equal(r8.exitCode, 1);
      assert.equal(r8.stderr, "join: EISDIR: illegal operation on a directory '/work/dir'\n");
    });
  });

  test("4. tsort topological sort, cycle detection, odd token count, directory no-op, and --help/--version prefixes", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf 'a b\\nb c\\nc d\\n' | tsort
        echo "---"
        tsort /work/dir
        echo "dir_rc=$?"
        tsort --hel
        tsort --ver
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(
        r.stdout,
        "a\nb\nc\nd\n---\ndir_rc=0\nUsage: tsort [OPTION] [FILE]\nWrite a topological ordering of whitespace-separated node pairs.\nWith no FILE, or FILE -, read standard input.\nOptions: --help --version\ntsort (virtual-bash)\n"
      );

      const rLoop = await sh.exec("printf 'x y\\ny x\\n' | tsort");
      assert.equal(rLoop.exitCode, 1);
      assert.equal(rLoop.stdout, "x\ny\n");
      assert.equal(rLoop.stderr, "tsort: -: input contains a loop:\ntsort: x\ntsort: y\n");

      const rOdd = await sh.exec("printf 'a b c\\n' | tsort");
      assert.equal(rOdd.exitCode, 1);
      assert.equal(rOdd.stderr, "tsort: -: input contains an odd number of tokens\n");

      const rMissing = await sh.exec("tsort /work/missing");
      assert.equal(rMissing.exitCode, 1);
      assert.equal(rMissing.stderr, "tsort: /work/missing: No such file or directory\n");
    });
  });

  test("5. sponge in-place pipeline soaking, -a/--append, and error diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf '3\\n1\\n2\\n' > /work/nums.txt
        sort /work/nums.txt | sponge /work/nums.txt
        cat /work/nums.txt
        printf '4\\n' | sponge -a /work/nums.txt
        cat /work/nums.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(r.stdout, "1\n2\n3\n1\n2\n3\n4\n");

      const r1 = await sh.exec("printf 'x' | sponge /work/dir");
      assert.equal(r1.exitCode, 1);
      assert.equal(r1.stderr, "sponge: EISDIR: illegal operation on a directory, writeFile '/work/dir'\n");

      const r2 = await sh.exec("printf 'x' | sponge /work/no_such_dir/out.txt");
      assert.equal(r2.exitCode, 1);
      assert.equal(r2.stderr, "sponge: ENOENT: no such file or directory, writeFile '/work/no_such_dir/out.txt'\n");

      const r3 = await sh.exec("printf 'x' | sponge a b");
      assert.equal(r3.exitCode, 2);
      assert.equal(r3.stderr, "sponge: too many arguments\n");
    });
  });

  test("6. envsubst variable substitution, SHELL-FORMAT whitelist, -v/--variables, and --help/--version", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        export GREET="Hello" TARGET="World" SECRET="hidden"
        printf '$GREET \${TARGET} $SECRET\\n' | envsubst '$GREET \${TARGET}'
        envsubst -v '$GREET and \${TARGET} plus $GREET'
        envsubst -V
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(
        r.stdout,
        "Hello World $SECRET\nGREET\nTARGET\nGREET\nenvsubst (Sandbox VFS-ish/GNU gettext-runtime) 0.22.5\n"
      );

      const rHelp = await sh.exec("envsubst --help");
      assert.equal(rHelp.exitCode, 0);
      assert.ok(rHelp.stdout.startsWith("Usage: envsubst [OPTION] [SHELL-FORMAT]\n\nSubstitutes the values of environment variables.\n"));

      const rErr = await sh.exec("envsubst -v");
      assert.equal(rErr.exitCode, 1);
      assert.equal(rErr.stderr, "envsubst: missing arguments\n");
    });
  });

  test("7. tac -b, -s, -r regex separator, and multi-file continuation on missing/directory operands", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf 'one:two:three:' | tac -s :
        echo ""
        printf ':one:two:three' | tac -b -s :
        echo ""
        printf 'first\\nsecond\\n' > /work/ok.txt
        tac /work/missing /work/dir /work/ok.txt
      `);
      assert.equal(r.exitCode, 1);
      assert.equal(r.stdout, "three:two:one:\n:three:two:one\nsecond\nfirst\n");
      assert.equal(
        r.stderr,
        "tac: ENOENT: no such file or directory, stat '/work/missing'\ntac: EISDIR: illegal operation on a directory '/work/dir'\n"
      );

      const rOpt1 = await sh.exec("tac -s");
      assert.equal(rOpt1.exitCode, 1);
      assert.equal(rOpt1.stderr, "tac: option requires an argument -- 's'\n");

      const rOpt2 = await sh.exec("tac --separator");
      assert.equal(rOpt2.exitCode, 1);
      assert.equal(rOpt2.stderr, "tac: option '--separator' requires an argument\n");
    });
  });

  test("8. rev UTF-8 vs C locale reversal, literal '-' operand handling, and invalid UTF-8 diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf 'abc\\n123' | rev
        echo ""
        printf 'hello\\n' > /work/ok.txt
        rev - /work/ok.txt /work/dir
      `);
      assert.equal(r.exitCode, 1);
      assert.equal(r.stdout, "cba\n321\nolleh\n");
      assert.equal(
        r.stderr,
        "rev: ENOENT: no such file or directory, stat '/workspace/-'\nrev: EISDIR: illegal operation on a directory '/work/dir'\n"
      );

      const rBad = await sh.exec("printf 'ab\\xffcd\\n' | LC_ALL=C.UTF-8 rev");
      assert.equal(rBad.exitCode, 1);
      assert.equal(rBad.stdout, "ba\n");
      assert.equal(rBad.stderr, "rev: stdin: Illegal byte sequence\n");
    });
  });

  test("9. cat -n/-b/-s/-A/-e/-t, --help, and readStream error diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf 'a\\t\\n\\n\\nb\\r\\n' > /work/in.txt
        cat -b -s -A /work/in.txt
        cat /work/missing /work/dir /work/in.txt > /work/out.txt
        echo "rc=$?"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "     1\ta^I$\n$\n     2\tb^M$\nrc=1\n");
      assert.equal(
        r.stderr,
        "cat: ENOENT: no such file or directory, readStream '/work/missing'\ncat: EISDIR: illegal operation on a directory, readStream '/work/dir'\n"
      );

      const rHelp = await sh.exec("cat --help");
      assert.equal(rHelp.exitCode, 0);
      assert.ok(rHelp.stdout.includes("Concatenate FILEs to standard output."));
    });
  });

  test("10. head and tail negative/positive counts, legacy -NUM flags, -v/-q headers, and stat/EISDIR diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf '1\\n2\\n3\\n4\\n5\\n' > /work/nums.txt
        head -n -2 /work/nums.txt
        echo "---"
        tail -n +3 /work/nums.txt
        echo "---"
        head -2v /work/nums.txt
        head /work/missing /work/dir /work/nums.txt > /dev/null
        echo "rc=$?"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "1\n2\n3\n---\n3\n4\n5\n---\n==> /work/nums.txt <==\n1\n2\nrc=1\n"
      );
      assert.equal(
        r.stderr,
        "head: ENOENT: no such file or directory, stat '/work/missing'\nhead: EISDIR: illegal operation on a directory '/work/dir'\n"
      );
    });
  });

  test("11. wc -l/-w/-m/-c/-L, --total modes, --files0-from, and directory/missing diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf 'hello world\\nabc\\n' > /work/a.txt
        printf 'x\\n' > /work/b.txt
        wc -l -w -c --total=always /work/a.txt /work/b.txt
        echo "---"
        wc -c --total=only /work/a.txt /work/b.txt
        echo "---"
        printf '/work/a.txt\\0/work/b.txt\\0' | wc -l --files0-from=-
        wc /work/dir /work/missing
      `);
      assert.equal(r.exitCode, 1);
      assert.equal(
        r.stdout,
        " 2  3 16 /work/a.txt\n 1  1  2 /work/b.txt\n 3  4 18 total\n---\n18\n---\n 2 /work/a.txt\n 1 /work/b.txt\n 3 total\n      0       0       0 /work/dir\n      0       0       0 total\n"
      );
      assert.equal(
        r.stderr,
        "wc: EISDIR: illegal operation on a directory, readStream '/work/dir'\nwc: ENOENT: no such file or directory, readStream '/work/missing'\n"
      );
    });
  });

  test("12. tee -a, --output-error=warn vs exit, and writeStream diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        mkdir -p /work/dir
        printf 'line1\\n' | tee /work/t1.txt /work/t2.txt
        printf 'line2\\n' | tee -a /work/t1.txt > /dev/null
        cat /work/t1.txt
        printf 'ok\\n' | tee /work/dir /work/no_dir/file.txt /work/t2.txt
        echo "rc=$?"
        cat /work/t2.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "line1\nline1\nline2\nok\nrc=1\nok\n");
      assert.equal(
        r.stderr,
        "tee: EISDIR: illegal operation on a directory, writeStream '/work/dir'\ntee: ENOENT: no such file or directory, writeStream '/work/no_dir/file.txt'\n"
      );
    });
  });

  test("13. sort -k key specs, -n/-h/-g/-M/-V, -c/-C disorder checking, -m merge, and -u/-s stability", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work");
      const r = await sh.exec(`
        printf 'b,2K\\na,10M\\nc,500\\n' > /work/s.csv
        sort -t , -k 2,2h /work/s.csv
        echo "---"
        printf 'v1.2\\nv1.10\\nv1.2~rc1\\n' | sort -V
        echo "---"
        printf '2\\n1\\n' | sort -c
        echo "c_rc=$?"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "c,500\nb,2K\na,10M\n---\nv1.2~rc1\nv1.2\nv1.10\n---\nc_rc=1\n");
      assert.equal(r.stderr, "sort: disorder at record 2\n");
    });
  });

  test("14. sort incompatible flags, invalid key/number, and readStream/writeStream diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work/dir && printf 'b\\na\\n' > /work/in.txt");

      const r1 = await sh.exec("sort -n -h /work/in.txt");
      assert.equal(r1.exitCode, 2);
      assert.equal(r1.stderr, "sort: options '-hn' are incompatible\n");

      const r2 = await sh.exec("sort -n -d /work/in.txt");
      assert.equal(r2.exitCode, 2);
      assert.equal(r2.stderr, "sort: options '-dn' are incompatible\n");

      const r3 = await sh.exec("sort -k 0 /work/in.txt");
      assert.equal(r3.exitCode, 2);
      assert.equal(r3.stderr, "sort: invalid number '0'\n");

      const r4 = await sh.exec("sort -k abc /work/in.txt");
      assert.equal(r4.exitCode, 2);
      assert.equal(r4.stderr, "sort: invalid key 'abc'\n");

      const r5 = await sh.exec("sort /work/missing");
      assert.equal(r5.exitCode, 2);
      assert.equal(r5.stderr, "sort: ENOENT: no such file or directory, readStream '/work/missing'\n");

      const r6 = await sh.exec("sort -o /work/dir /work/in.txt");
      assert.equal(r6.exitCode, 2);
      assert.equal(r6.stderr, "sort: EISDIR: illegal operation on a directory, writeStream '/work/dir'\n");
    });
  });

  test("15. uniq -c/-d/-u/-i, -f/-s/-w, --all-repeated=separate, and --group=both", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        printf '1 foo_a\\n2 FOO_B\\n3 bar_c\\n4 BAR_D\\n' | uniq -i -f 1 -w 3 -c
        echo "---"
        printf 'a\\na\\nb\\nc\\nc\\n' | uniq --all-repeated=separate
        echo "---"
        printf 'x\\nx\\ny\\n' | uniq --group=both
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(r.stdout, "      2 1 foo_a\n      2 3 bar_c\n---\na\na\n\nc\nc\n---\n\nx\nx\n\ny\n\n");
    });
  });

  test("16. uniq option validation, same-file check, and readStream/writeStream/stat diagnostics", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work/dir && printf 'a\\na\\n' > /work/in.txt");

      const r1 = await sh.exec("uniq -f abc /work/in.txt");
      assert.equal(r1.exitCode, 2);
      assert.equal(r1.stderr, "uniq: invalid number 'abc'\n");

      const r2 = await sh.exec("uniq -D -c /work/in.txt");
      assert.equal(r2.exitCode, 2);
      assert.equal(r2.stderr, "uniq: printing all duplicated lines and repeat counts is meaningless\n");

      const r3 = await sh.exec("uniq --group -c /work/in.txt");
      assert.equal(r3.exitCode, 2);
      assert.equal(r3.stderr, "uniq: --group is mutually exclusive with -c/-d/-D/-u\n");

      const r4 = await sh.exec("uniq /work/in.txt /work/in.txt");
      assert.equal(r4.exitCode, 2);
      assert.equal(r4.stderr, "uniq: input and output must be different files\n");

      const r5 = await sh.exec("uniq /work/missing");
      assert.equal(r5.exitCode, 1);
      assert.equal(r5.stderr, "uniq: ENOENT: no such file or directory, readStream '/work/missing'\n");

      const r6 = await sh.exec("uniq /work/missing /work/out.txt");
      assert.equal(r6.exitCode, 1);
      assert.equal(r6.stderr, "uniq: ENOENT: no such file or directory, stat '/work/missing'\n");

      const r7 = await sh.exec("uniq /work/in.txt /work/dir");
      assert.equal(r7.exitCode, 1);
      assert.equal(r7.stderr, "uniq: EISDIR: illegal operation on a directory, writeStream '/work/dir'\n");
    });
  });

  test("17. sort -m multi-file merge with -u unique and -z zero-terminated records", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work");
      const r = await sh.exec(`
        printf 'a:1\\0c:1\\0' > /work/m1.bin
        printf 'a:2\\0b:1\\0' > /work/m2.bin
        sort -m -z -t : -k 1,1 -u /work/m1.bin /work/m2.bin | tr '\\0' '\\n'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(r.stdout, "a:1\nb:1\nc:1\n");
    });
  });

  test("18. join legacy -j1 / -j2 syntax and multi-flag -o output lists", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work");
      const r = await sh.exec(`
        printf 'x k1\\ny k2\\n' > /work/l.txt
        printf 'k1 100\\nk2 200\\n' > /work/r.txt
        join -j1 2 -j2 1 -o 0 -o 1.1,2.2 /work/l.txt /work/r.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(r.stdout, "k1 x 100\nk2 y 200\n");
    });
  });

  test("19. gnuInformationSync --help and --version for head, tail, wc, tee, sort, uniq, tac, rev, and join", async () => {
    await withE2EHarness(async (sh) => {
      const r = await sh.exec(`
        for cmd in head tail wc tee sort uniq tac join; do
          $cmd --version
        done
        join --help | head -n 2
        printenv --help
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(
        r.stdout,
        "head (safe-bash virtual implementation)\ntail (safe-bash virtual implementation)\nwc (safe-bash virtual implementation)\ntee (safe-bash virtual implementation)\nsort (safe-bash virtual implementation)\nuniq (safe-bash virtual implementation)\ntac (safe-bash virtual implementation)\njoin (safe-bash virtual implementation)\nUsage: join [OPTION]... FILE1 FILE2\nJoin sorted files on a common field in the C/POSIX byte locale.\nUsage: printenv [-0|--null] [--] [NAME ...]\nPrint only the virtual command environment.\n"
      );

      const rRev = await sh.exec("rev --version");
      assert.equal(rRev.exitCode, 1);
      assert.equal(rRev.stderr, "rev: unrecognized option '--version'\n");
    });
  });

  test("20. end-to-end pipeline combining envsubst, sort, uniq, join, tsort, tac, rev, tee, wc, and sponge", async () => {
    await withE2EHarness(async (sh) => {
      await sh.exec("mkdir -p /work");
      const r = await sh.exec(`
        export ENV_TAG="prod"
        printf 'svc-b svc-c\\nsvc-a svc-b\\nsvc-a svc-b\\n' | sort | uniq | tsort > /work/order.txt
        printf 'svc-a,\${ENV_TAG}\\nsvc-b,\${ENV_TAG}\\nsvc-c,\${ENV_TAG}\\n' | envsubst > /work/tags.csv
        sort /work/order.txt > /work/order_sorted.txt
        join -t , -1 1 -2 1 /work/order_sorted.txt /work/tags.csv | tac | sponge /work/result.csv
        cat /work/result.csv | tee /work/copy.csv | wc -l
        cat /work/copy.csv
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stderr, "");
      assert.equal(r.stdout, "3\nsvc-c,prod\nsvc-b,prod\nsvc-a,prod\n");
    });
  });
});
