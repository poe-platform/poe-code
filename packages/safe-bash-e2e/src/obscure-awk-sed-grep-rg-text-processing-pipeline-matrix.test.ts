import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure awk, sed, grep, rg, and coreutils text processing pipeline matrix", () => {
  test("1. awk BEGIN/END blocks with custom FS, OFS, NR, NF, and field loop summation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "a:10:20\\nb:30:40:50\\n" | awk -F: 'BEGIN { OFS="|" } { sum=0; for(i=2;i<=NF;i++) sum+=$i; print NR, $1, NF-1, sum } END { print "total_rows=" NR }'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|a|2|30\n2|b|3|120\ntotal_rows=2\n");
    });
  });

  test("2. awk recursive user-defined function and sprintf width/precision formatting", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `awk 'function fact(n) { return n <= 1 ? 1 : n * fact(n - 1) } BEGIN { printf "%d,%d,%d|%s\\n", fact(0), fact(4), fact(6), sprintf("%05d:%.2f:%-4s!", 42, 3.14159, "hi") }'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1,24,720|00042:3.14:hi  !\n");
    });
  });

  test("3. awk split, gsub, index, substr, and match with RSTART/RLENGTH", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          `printf "foo-bar-baz\\n" | awk '{ n = split($0, a, "-"); gsub("-", "_", $0); printf "%s|%d|%s|%d|%s\\n", $0, n, a[2], index($0, "bar"), substr($0, 5, 3) }'`,
          `printf "item_428_ok\\n" | awk '{ if (match($0, /[0-9]+/)) printf "%d:%d:%s\\n", RSTART, RLENGTH, substr($0, RSTART, RLENGTH) }'`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "foo_bar_baz|3|bar|5|bar\n6:3:428\n");
    });
  });

  test("4. awk associative array accumulation, delete element, and key membership (in)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "x 1\\ny 2\\nx 3\\nz 4\\n" | awk '{ m[$1] += $2 } END { delete m["y"]; printf "%d|%d|%d\\n", ("x" in m), ("y" in m), m["x"] + m["z"] }'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|0|8\n");
    });
  });

  test("5. awk FILENAME, FNR, NR across multiple files and getline into variable", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "a\\nb\\n" > /tmp/f1.txt',
          'printf "c\\nd\\n" > /tmp/f2.txt',
          `awk '{ print FILENAME ":" FNR ":" NR ":" $0 }' /tmp/f1.txt /tmp/f2.txt`,
          `printf "key1\\nval1\\nkey2\\nval2\\n" | awk '{ getline v; print $0 "=" v }'`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/tmp/f1.txt:1:1:a\n/tmp/f1.txt:2:2:b\n/tmp/f2.txt:1:3:c\n/tmp/f2.txt:2:4:d\nkey1=val1\nkey2=val2\n"
      );
    });
  });

  test("6. awk regex range pattern (/^START$/,/^END$/) with conditional next skip", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "hdr\\nSTART\\na\\nskip_me\\nb\\nEND\\nftr\\n" | awk '/^START$/,/^END$/ { if ($0 == "skip_me") next; print }'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "START\na\nb\nEND\n");
    });
  });

  test("7. sed hold space line reversal idiom (1!G;h;$!d) and stepping address (1~2p)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          `printf "one\\ntwo\\nthree\\nfour\\n" | sed '1!G;h;$!d'`,
          `printf "1\\n2\\n3\\n4\\n5\\n6\\n" | sed -n '1~2p'`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "four\nthree\ntwo\none\n1\n3\n5\n");
    });
  });

  test("8. sed label (:a) and conditional branch (ta) loop for thousands comma insertion", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "12345678\\n" | sed -E ':a; s/([0-9]+)([0-9]{3})/\\1,\\2/; ta'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "12,345,678\n");
    });
  });

  test("9. sed regex backreference in search pattern (\\1) to detect repeated tokens", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "foo_foo bar_baz qux_qux\\n" | sed -E 's/([a-z]+)_\\1/DUP:\\1/g'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "DUP:foo bar_baz DUP:qux\n");
    });
  });

  test("10. sed line insert (i\\), append (a\\), change (c\\), y/// transliteration, and \\U/\\u case escapes", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          `printf "1\\n2\\n3\\n4\\n" | sed -e '2i\\BEFORE_2' -e '3a\\AFTER_3' -e '4c\\FOUR'`,
          `printf "abc:hello world\\n" | sed -E 'y/abc/XYZ/; s/:([a-z]+) ([a-z]+)/:\\U\\1\\E_\\u\\2/'`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1\nBEFORE_2\n2\n3\nAFTER_3\nFOUR\nXYZ:HELLO_World\n");
    });
  });

  test("11. rg named capture groups (?P<name>...) with $name replacement", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "2026-10-06\\n" > /tmp/dt.txt && rg -N -r '$d/$m/$y' '(?P<y>[0-9]{4})-(?P<m>[0-9]{2})-(?P<d>[0-9]{2})' /tmp/dt.txt`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "06/10/2026\n");
    });
  });

  test("12. grep -B/-A context lines and -oE only-matching token stream piped to paste", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "a1\\nb2\\nc3\\nd4\\ne5\\n" | grep -E -B 1 -A 1 'c3' && printf "v1=10 v2=25\\n" | grep -oE '[0-9]+' | paste -sd, -`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "b2\nc3\nd4\n1,10,2,25\n");
    });
  });

  test("13. sort multi-key with custom field delimiter (-t: -k1,1 -k2,2nr) and unique by key (-u -k1,1)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          `printf "b:20\\na:10\\nb:5\\na:30\\n" | sort -t: -k1,1 -k2,2nr`,
          `printf "a:2\\nb:1\\na:9\\nb:5\\n" | sort -t: -k1,1 -u`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a:30\na:10\nb:20\nb:5\na:2\nb:1\n");
    });
  });

  test("14. uniq case-insensitive count (-i -c) and unique-only (-u) filtering", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "apple\\nAPPLE\\nbanana\\ncherry\\nCHERRY\\n" | uniq -i -c | awk '{ print $1 ":" $2 }' && printf "a\\na\\nb\\nc\\nc\\n" | uniq -u`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2:apple\n1:banana\n2:cherry\nb\n");
    });
  });

  test("15. join full outer join (-a 1 -a 2) with -e MISSING default and -o format list", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "1 a\\n2 b\\n3 c\\n" > /tmp/j1.txt && printf "1 x\\n3 z\\n4 w\\n" > /tmp/j2.txt && join -a 1 -a 2 -e MISSING -o 0,1.2,2.2 /tmp/j1.txt /tmp/j2.txt`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1 a x\n2 b MISSING\n3 c z\n4 MISSING w\n");
    });
  });

  test("16. comm column suppression (-23, -13, -12) for set difference and intersection", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "a\\nb\\nc\\n" > /tmp/c1.txt && printf "b\\nc\\nd\\n" > /tmp/c2.txt && printf "only1=%s|only2=%s|both=%s\\n" "$(comm -23 /tmp/c1.txt /tmp/c2.txt)" "$(comm -13 /tmp/c1.txt /tmp/c2.txt)" "$(comm -12 /tmp/c1.txt /tmp/c2.txt | paste -sd, -)"`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "only1=a|only2=d|both=b,c\n");
    });
  });

  test("17. tr squeeze repeats (-s), delete (-d), and complement delete (-cd)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "hello   123   world!!\\n" | tr -s ' ' '_' | tr -d '!' && printf "abc-123-xyz\\n" | tr -cd '0-9\\n'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hello_123_world\n123\n");
    });
  });

  test("18. cut custom output delimiter (--output-delimiter) and field complement (--complement)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "f1:f2:f3:f4\\n" | cut -d: -f1,3 --output-delimiter='|' && printf "f1:f2:f3:f4\\n" | cut -d: --complement -f2`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "f1|f3\nf1:f3:f4\n");
    });
  });

  test("19. tac reverse lines, rev reverse characters, and nl numbered line formatting", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "abc\\ndef\\nghi\\n" | tac | rev | nl -w 2 -s ':'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, " 1:ihg\n 2:fed\n 3:cba\n");
    });
  });

  test("20. expand tabstops (-t 4) and fold fixed width (-w 4) piped to paste", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "a\\tb\\nc\\td\\n" | expand -t 4 | tr ' ' '_' && printf "1234567890\\n" | fold -w 4 | paste -sd: -`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a___b\nc___d\n1234:5678:90\n");
    });
  });
});
