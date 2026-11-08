import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure awk sed perl regex backrefs ranges getline arrays matrix", () => {
  it("01 awk split delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("awk 'BEGIN {\n      n = split(\"alpha:beta:gamma:delta\", parts, \":\");\n      delete parts[2];\n      out = \"\";\n      for (i = 1; i <= n; i++) {\n        if (i in parts) out = out (out ? \",\" : \"\") i \"=\" parts[i];\n      }\n      print n \"|\" out;\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "4|1=alpha,3=gamma,4=delta");
    });
  });

  it("02 awk sub gsub ampersand", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'foo=10 bar=20 baz=30\\n' | awk '{\n      sub(/[0-9]+/, \"[&]\", $0);\n      gsub(/=[0-9]+/, \"=(&)\", $0);\n      print $0;\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "foo=[10] bar=(=20) baz=(=30)");
    });
  });

  it("03 awk match RSTART RLENGTH", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id:AB-9042-XY;status:ok\\n' | awk '{\n      if (match($0, /[A-Z]{2}-[0-9]{4}-[A-Z]{2}/)) {\n        print RSTART, RLENGTH, substr($0, RSTART, RLENGTH);\n      }\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "4 10 AB-9042-XY");
    });
  });

  it("04 awk length array and string", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("awk 'BEGIN {\n      a[\"x\"] = 10; a[\"y\"] = 20; a[\"z\"] = 30;\n      delete a[\"y\"];\n      s = \"Hello, World!\";\n      print length(a), length(s), index(s, \"World\"), tolower(\"AbC\"), toupper(\"xYz\");\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2 13 8 abc XYZ");
    });
  });

  it("05 awk getline from file and redirect print", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'k1=alpha\\nk2=beta\\n' > map.txt\n    awk 'BEGIN {\n      while ((getline line < \"map.txt\") > 0) {\n        split(line, kv, \"=\");\n        m[kv[1]] = kv[2];\n      }\n      print m[\"k1\"] \"-\" m[\"k2\"] > \"out.txt\";\n    }'\n    cat out.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha-beta");
    });
  });

  it("06 awk FNR NR FILENAME nextfile", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a1\\na2\\na3\\n' > f1.txt\n    printf 'b1\\nb2\\nb3\\n' > f2.txt\n    awk 'FNR == 2 { print FILENAME \":\" FNR \":\" NR \":\" $0; nextfile } { print \"row:\" $0 }' f1.txt f2.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "row:a1\nf1.txt:2:2:a2\nrow:b1\nf2.txt:2:4:b2");
    });
  });

  it("07 awk SUBSEP multidimensional array", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("awk 'BEGIN {\n      grid[1, \"a\"] = 100;\n      grid[2, \"b\"] = 250;\n      if ((1, \"a\") in grid && !((1, \"b\") in grid)) {\n        print grid[1, \"a\"] + grid[2, \"b\"];\n      }\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "350");
    });
  });

  it("08 awk sprintf hex octal float formats", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("awk 'BEGIN {\n      printf \"%04x|%04X|%04o|%-6s|%+06d|%.2f\\n\", 255, 255, 63, \"hi\", 42, 3.14159;\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "00ff|00FF|0077|hi    |+00042|3.14");
    });
  });

  it("09 awk math functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("awk 'BEGIN {\n      print int(9.87), sqrt(144), int(exp(0)), int(log(1)), int(sin(0)), int(cos(0)), int(atan2(0, 1));\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "9 12 1 0 0 1 0");
    });
  });

  it("10 awk nested ternary and in operator", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alice 95\\nbob 75\\ncarol 55\\n' | awk '{\n      grade = ($2 >= 90) ? \"A\" : (($2 >= 70) ? \"B\" : \"C\");\n      seen[grade]++;\n      print $1 \":\" grade;\n    } END {\n      print (\"A\" in seen ? seen[\"A\"] : 0) \"/\" (\"D\" in seen ? seen[\"D\"] : 0);\n    }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alice:A\nbob:B\ncarol:C\n1/0");
    });
  });

  it("11 sed range addresses and negation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '1:one\\n2:two\\n3:three\\n4:four\\n5:five\\n' | sed -e '2,4s/:/=/' -e '$s/:/!/' -e '3!s/^/[keep]/'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[keep]1:one\n[keep]2=two\n3=three\n[keep]4=four\n[keep]5!five");
    });
  });

  it("12 sed hold space h H g G x", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'first\\nsecond\\nthird\\n' | sed -n '1h; 2H; 3{H;g;s/\\n/|/g;p}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "first|second|third");
    });
  });

  it("13 sed branch b and t labels", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a--b---c\\nx-y\\n' | sed ':loop; s/--/-/g; t loop'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a-b-c\nx-y");
    });
  });

  it("14 sed insert append change line number", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'alpha\\nbeta\\ngamma\\n' | sed -e '1i\\HEADER' -e '2c\\BETA_REPLACED' -e '3a\\FOOTER' -e '2='");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HEADER\nalpha\nBETA_REPLACED\ngamma\nFOOTER");
    });
  });

  it("15 sed y transliteration", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'hello-123\\n' | sed 'y/elo123/ELO456/'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "hELLO-456");
    });
  });

  it("16 sed Nth occurrence replacement and case-insensitive", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'cat Cat CAT cat\\n' | sed -e 's/cat/dog/2i' -e 's/cat/FOX/3i'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "cat dog CAT FOX");
    });
  });

  it("17 sed r and w file commands", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'inserted-from-file\\n' > extra.txt\n    printf 'line1\\nmatch_me\\nline3\\n' | sed -e '/match_me/w matched.txt' -e '/match_me/r extra.txt'\n    printf -- '---\\n'\n    cat matched.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "line1\nmatch_me\ninserted-from-file\nline3\n---\nmatch_me");
    });
  });

  it("18 sed multiple -e and -f script file", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 's/foo/BAR/g\\n/skip/d\\n' > rules.sed\n    printf 'foo one\\nskip foo\\nfoo two\\n' | sed -f rules.sed -e 's/two/2/'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "BAR one\nBAR 2");
    });
  });

  it("19 sed -i in-place multi-file edit", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'v=1\\n' > a.conf\n    printf 'v=1\\n' > b.conf\n    sed -i 's/v=1/v=2/' a.conf b.conf\n    cat a.conf b.conf");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "v=2\nv=2");
    });
  });

  it("20 sed + awk multiline log join and summary", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > app.log\n2026-03-01 INFO auth login ok\n2026-03-01 ERROR db connection timeout\n  at pool.acquire (db.ts:42)\n2026-03-01 ERROR auth invalid token\n  at verify (auth.ts:19)\n2026-03-01 ERROR db deadlock detected\nEOF\n    sed -n '1h; 1!{ /^  at /{H; $!b}; /^  at /!{x; s/\\n/ :: /g; p; $!b}; }; $ {x; s/\\n/ :: /g; p}' app.log | awk '\n      $2 == \"ERROR\" { err[$3]++; detail[$3] = detail[$3] (detail[$3] ? \";\" : \"\") $4 }\n      END {\n        for (k in err) print k \"|\" err[k] \"|\" detail[k]\n      }\n    ' | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "auth|1|invalid\ndb|2|connection;deadlock");
    });
  });

});
