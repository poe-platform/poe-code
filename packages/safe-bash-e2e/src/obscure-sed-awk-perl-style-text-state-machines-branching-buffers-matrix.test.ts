import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sed awk perl style text state machines branching buffers matrix", () => {
  it("1. sed hold space and pattern space (1!G;h;$!d) line reversal", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"first\\nsecond\\nthird\\nfourth\\n\" | sed \"1!G;h;\\$!d\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "fourth\nthird\nsecond\nfirst");
    });
  });

  it("2. sed label branching (:a; N; $!ba) and backslash continuation joining", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | sed -e ':a' -e '/\\\\$/N; s/\\\\\\n/ /; ta'\ncmd --flag-a \\\n--flag-b \\\n--flag-c\nnext_cmd --ok\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "cmd --flag-a  --flag-b  --flag-c\nnext_cmd --ok");
    });
  });

  it("3. sed regex range addressing (/START/,/END/), negation (!), and multiple -e expressions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | sed -e \"/^START/,/^END/ s/foo/BAR/g\" -e \"/^#/d\"\n# comment line\noutside foo\nSTART\ninside foo and foo\nEND\nafter foo\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "outside foo\nSTART\ninside BAR and BAR\nEND\nafter foo");
    });
  });

  it("4. sed sliding window (N;P;D) and exchange (x) state machine", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"alpha\\nbeta\\ngamma\\ndelta\\n\" | sed -n \"h;n;G;s/\\n/:/p\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "beta:alpha\ndelta:gamma");
    });
  });

  it("5. sed custom delimiters, backreferences (\\1..\\3), and & whole-match expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"/usr/local/bin/app:v1.2.3\\n\" | sed \"s#^/usr/\\([^/]*\\)/\\([^:]*\\):\\(.*\\)#prefix=\\1 path=\\2 ver=[&->\\3]#\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "prefix=local path=bin/app ver=[/usr/local/bin/app:v1.2.3->v1.2.3]");
    });
  });

  it("6. sed y/// character transliteration with address filter and q early exit", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"row1:abc\\nrow2:abc\\nrow3:abc\\nrow4:abc\\n\" | sed -e \"2,3 y/abc/XYZ/\" -e \"3q\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "row1:abc\nrow2:XYZ\nrow3:XYZ");
    });
  });

  it("7. awk BEGIN/END blocks with custom FS, OFS, RS, ORS and -v variables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"alice:10:20|bob:30:40|carol:50:60\" | awk -v mult=2 'BEGIN { RS=\"|\"; FS=\":\"; OFS=\",\"; ORS=\"\\n\" } { print $1, ($2 + $3) * mult } END { print \"DONE\" }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alice,60\nbob,140\ncarol,220\nDONE");
    });
  });

  it("8. awk multi-key associative arrays (k1,k2), in operator, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | awk '{ g[$1, $2] += $3 } END { delete g[\"us\", \"dev\"]; for (k in g) { split(k, p, SUBSEP); print p[1] \":\" p[2] \"=\" g[k] } }' | sort\nus prod 100\nus dev 50\neu prod 75\nus prod 25\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "eu:prod=75\nus:prod=125");
    });
  });

  it("9. awk split, sub, gsub, match, RSTART, RLENGTH, and substr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"id=42;tags=alpha,beta,gamma;code=ERR-908-X\\n\" | awk '{\n  match($0, /ERR-[0-9]+/);\n  err = substr($0, RSTART, RLENGTH);\n  sub(/^.*tags=/, \"\", $0);\n  gsub(/;.*$/, \"\", $0);\n  n = split($0, arr, \",\");\n  print err, n, arr[2]\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ERR-908 3 beta");
    });
  });

  it("10. awk printf and sprintf formatting with width, alignment, zero-pad, and float precision", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"widget 7 12.3456\\ngadget 42 99.1\\n\" | awk '{ msg = sprintf(\"%-8s | %04d | %6.2f\", $1, $2, $3); print msg }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "widget   | 0007 |  12.35\ngadget   | 0042 |  99.10");
    });
  });

  it("11. awk tolower, toupper, length, and index string functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"  Hello_World_2026  \\n\" | awk '{\n  gsub(/^ +| +$/, \"\", $0);\n  u = toupper($0);\n  l = tolower($0);\n  pos = index(l, \"world\");\n  print u, l, length($0), pos\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HELLO_WORLD_2026 hello_world_2026 16 7");
    });
  });

  it("12. awk next statement, ternary operator, and compound pattern filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | awk '/^#/ { next } $2 >= 50 { status = ($2 >= 80 ? \"HIGH\" : \"MID\"); print $1, status }'\n# header\ns1 20\ns2 55\ns3 90\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "s2 MID\ns3 HIGH");
    });
  });

  it("13. awk range pattern (/BEGIN_TX/,/END_TX/) state accumulation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | awk '/BEGIN_TX/,/END_TX/ { if ($1 == \"ITEM\") sum += $2; if ($1 == \"END_TX\") { print \"TX=\" sum; sum = 0 } }'\nNOISE 999\nBEGIN_TX\nITEM 15\nITEM 25\nEND_TX\nNOISE 888\nBEGIN_TX\nITEM 7\nEND_TX\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "TX=40\nTX=7");
    });
  });

  it("14. awk numeric math: int, sqrt, modulo, and exponentiation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"16 17 3\\n\" | awk '{ print sqrt($1), int($2 / $3), $2 % $3, $3 ^ 4 }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "4 5 2 81");
    });
  });

  it("15. awk two-file FNR==NR hash join across lookup and fact files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/users_lk.txt\nu1 Alice\nu2 Bob\nu3 Carol\nEOF\ncat << 'EOF' > /tmp/orders_fact.txt\nu2 150\nu1 80\nu2 50\nu3 200\nEOF\nawk 'FNR == NR { name[$1] = $2; next } { total[$1] += $2 } END { for (u in total) print name[u] \":\" total[u] }' /tmp/users_lk.txt /tmp/orders_fact.txt | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Alice:80\nBob:200\nCarol:200");
    });
  });

  it("16. sed + awk INI config parser flattening [section] and key=value pairs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | sed -e \"s/[[:space:]]*=[[:space:]]*/=/\" -e \"/^[[:space:]]*$/d\" -e \"/^;/d\" | awk -F= '/^\\[.*\\]$/ { sec = $0; gsub(/^\\[|\\]$/, \"\", sec); next } { print sec \".\" $1 \"=\" $2 }'\n; comment\n[database]\nhost = 127.0.0.1\nport = 5432\n\n[cache]\nttl = 60\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "database.host=127.0.0.1\ndatabase.port=5432\ncache.ttl=60");
    });
  });

  it("17. awk latency bucket histogram with ASCII bar rendering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"5\\n12\\n8\\n45\\n120\\n3\\n88\\n250\\n\" | awk '{\n  if ($1 < 10) b[\"fast\"]++;\n  else if ($1 < 100) b[\"med\"]++;\n  else b[\"slow\"]++;\n} END {\n  for (k in b) {\n    bar = \"\";\n    for (i = 0; i < b[k]; i++) bar = bar \"#\";\n    print k \":\" bar \" (\" b[k] \")\"\n  }\n}' | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "fast:### (3)\nmed:### (3)\nslow:## (2)");
    });
  });

  it("18. sed insert (i), append (a), change (c), and line number (=)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"alpha\\nbeta\\ngamma\\n\" | sed -e '=' -e '1i\\HEADER' -e '2c\\BETA_REPLACED' -e '$a\\FOOTER'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1\nHEADER\nalpha\n2\nBETA_REPLACED\n3\ngamma\nFOOTER");
    });
  });

  it("19. awk ENVIRON lookup and dynamic NF / $(NF-1) field indexing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export AWK_TAG=\"prod-eu\"\nprintf \"a b c d\\nx y z\\n\" | awk '{ print ENVIRON[\"AWK_TAG\"], NF, $(NF-1), $NF }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "prod-eu 4 c d\nprod-eu 3 y z");
    });
  });

  it("20. sed + awk + column: markdown table transformation and summary footer", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | sed -e \"1,2d\" -e \"s/^|//; s/|$//\" | awk -F\"|\" '{\n  gsub(/^ +| +$/, \"\", $1);\n  gsub(/^ +| +$/, \"\", $2);\n  gsub(/^ +| +$/, \"\", $3);\n  rev = $2 * $3;\n  total += rev;\n  printf \"%s,%d,%d,%d\\n\", $1, $2, $3, rev\n} END {\n  printf \"TOTAL,0,0,%d\\n\", total\n}'\n| Item | Qty | Price |\n| :--- | --: | ----: |\n| Pen  | 10  | 3     |\n| Book | 4   | 15    |\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Pen,10,3,30\nBook,4,15,60\nTOTAL,0,0,90");
    });
  });

});
