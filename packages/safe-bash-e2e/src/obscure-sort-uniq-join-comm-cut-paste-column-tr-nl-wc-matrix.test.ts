import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure sort, uniq, join, comm, cut, paste, column, tr, nl, tac, rev, head, tail, wc, expand & unexpand matrix", () => {
  it("01: sorts multi-key CSV records via sort -t, -k2,2n -k1,1r and sub-field character offsets -k1.2,1.3n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        s1=$(printf "beta,10\\nalpha,20\\ngamma,10\\ndelta,5\\n" | sort -t, -k2,2n -k1,1r | paste -sd ";" -)
        s2=$(printf "x30z\\na10b\\nm20c\\n" | sort -k1.2,1.3n | paste -sd "," -)
        echo "$s1|$s2"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "delta,5;gamma,10;beta,10;alpha,20|a10b,m20c,x30z");
    });
  });

  it("02: sorts semantic versions with sort -V and validates ordering with sort -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        ver=$(printf "v1.10.0\\nv1.2.0\\nv2.0.0\\nv1.2.10\\nv1.2.2\\n" | sort -V | paste -sd "," -)
        printf "a\\nb\\nc\\n" | sort -c && chk_ok="ok"
        if printf "b\\na\\n" | sort -c 2>/dev/null; then
          chk_bad="bad"
        else
          chk_bad="caught"
        fi
        echo "$ver|$chk_ok|$chk_bad"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "v1.2.0,v1.2.2,v1.2.10,v1.10.0,v2.0.0|ok|caught");
    });
  });

  it("03: sorts human-readable byte sizes with sort -h", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "2G\\n512K\\n128M\\n4K\\n16G\\n" | sort -h | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "4K,512K,128M,2G,16G");
    });
  });

  it("04: sorts abbreviated calendar month names chronologically with sort -M", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "DEC\\nFEB\\nAUG\\nJAN\\nMAY\\n" | sort -M | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "JAN,FEB,MAY,AUG,DEC");
    });
  });

  it("05: performs case-insensitive deduplicating sort via sort -f -u", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "banana\\nApple\\nBANANA\\ncherry\\napple\\n" | sort -f -u | tr "A-Z" "a-z" | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "apple,banana,cherry");
    });
  });

  it("06: sorts NUL-delimited records via sort -z", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "zeta\\0alpha\\0beta\\0" | sort -z | tr "\\0" ","
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha,beta,zeta,");
    });
  });

  it("07: aggregates case-insensitive run counts, duplicates, and uniques via uniq -c -i, -d, and -u", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "Err\\nerr\\nERR\\nWarn\\nInfo\\ninfo\\n" > /workspace/logs.txt
        c=$(uniq -c -i /workspace/logs.txt | awk '{print $1 ":" tolower($2)}' | paste -sd "," -)
        d=$(uniq -d -i /workspace/logs.txt | tr "A-Z" "a-z" | paste -sd "," -)
        u=$(uniq -u -i /workspace/logs.txt | tr "A-Z" "a-z" | paste -sd "," -)
        echo "counts=$c|dups=$d|uniqs=$u"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "counts=3:err,1:warn,2:info|dups=err,info|uniqs=warn");
    });
  });

  it("08: deduplicates lines skipping leading fields (-f), characters (-s), and fixed widths (-w)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        u1=$(printf "t1 ERR_01\\nt2 ERR_02\\nt3 WARN_1\\nt4 WARN_2\\n" | uniq -f 1 -w 3 | paste -sd "|" -)
        u2=$(printf "01_same\\n02_same\\n03_diff\\n" | uniq -s 3 | paste -sd "," -)
        echo "$u1||$u2"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "t1 ERR_01|t3 WARN_1||01_same,03_diff");
    });
  });

  it("09: performs full outer relational join (-a 1 -a 2 -e NULL -o) and anti-joins (-v 1 / -v 2) with join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "emp_alice,10\\nemp_bob,20\\nemp_carol,30\\n" > /workspace/emps.csv
        printf "10,Engineering\\n20,Sales\\n40,Finance\\n" > /workspace/depts.csv
        full=$(join -t, -1 2 -2 1 -a 1 -a 2 -e "NULL" -o 0,1.1,2.2 /workspace/emps.csv /workspace/depts.csv | paste -sd ";" -)
        v1=$(join -t, -1 2 -2 1 -v 1 /workspace/emps.csv /workspace/depts.csv | paste -sd ";" -)
        v2=$(join -t, -1 2 -2 1 -v 2 /workspace/emps.csv /workspace/depts.csv | paste -sd ";" -)
        echo "full=$full|v1=$v1|v2=$v2"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        "full=10,emp_alice,Engineering;20,emp_bob,Sales;30,emp_carol,NULL;40,NULL,Finance|v1=30,emp_carol|v2=40,Finance",
      );
    });
  });

  it("10: computes set intersection (-12), left difference (-23), and right difference (-13) with comm", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "a\\nb\\nc\\nd\\n" > /workspace/s1.txt
        printf "b\\nd\\ne\\nf\\n" > /workspace/s2.txt
        inter=$(comm -12 /workspace/s1.txt /workspace/s2.txt | paste -sd "," -)
        left=$(comm -23 /workspace/s1.txt /workspace/s2.txt | paste -sd "," -)
        right=$(comm -13 /workspace/s1.txt /workspace/s2.txt | paste -sd "," -)
        echo "inter=$inter|left=$left|right=$right"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "inter=b,d|left=a,c|right=e,f");
    });
  });

  it("11: extracts fields with custom --output-delimiter, suppresses non-delimited lines (-s), and slices characters (-c) with cut", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        f_out=$(printf "root:x:0:0:admin:/root\\n" | cut -d: -f1,3,5- --output-delimiter="|")
        s_out=$(printf "k1:v1\\nno_delim\\nk2:v2\\n" | cut -s -d: -f2 | paste -sd "," -)
        c_out=$(printf "abcdefghij\\n" | cut -c 2-4,7,9-)
        echo "$f_out|$s_out|$c_out"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "root|0|admin|/root|v1,v2|bcdgij");
    });
  });

  it("12: drops excluded columns via cut --complement -d, -f2,4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "c1,c2,c3,c4,c5\\na,b,c,d,e\\n" | cut --complement -d, -f2,4 | paste -sd ";" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "c1,c3,c5;a,c,e");
    });
  });

  it("13: merges parallel files with cycling delimiters via paste -d '=:'", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "k1\\nk2\\n" > /workspace/p1.txt
        printf "v1\\nv2\\n" > /workspace/p2.txt
        printf "u1\\nu2\\n" > /workspace/p3.txt
        paste -d "=:" /workspace/p1.txt /workspace/p2.txt /workspace/p3.txt | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "k1=v1:u1,k2=v2:u2");
    });
  });

  it("14: aligns delimited columns with custom output separator via column -t -s ',' -o ' | '", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "id,name,role\\n1,alice,admin\\n20,bob,dev\\n" | column -t -s "," -o " | "
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id | name  | role\n1  | alice | admin\n20 | bob   | dev");
    });
  });

  it("15: deletes, squeezes, and translates complement character classes via tr -d, -s, and -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        s1=$(printf "a1b2c3d4" | tr -d "[:digit:]")
        s2=$(printf "too    many   spaces" | tr -s " " "_")
        s3=$(printf "hello-world!123" | tr -c "a-z0-9" "_")
        echo "$s1|$s2|$s3"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "abcd|too_many_spaces|hello_world_123");
    });
  });

  it("16: numbers all lines including empty lines with zero-padded right-justified format via nl -ba -n rz -w 4 -s ': '", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "first\\n\\nthird\\n" | nl -ba -n rz -w 4 -s ": " | paste -sd "|" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "0001: first|0002: |0003: third");
    });
  });

  it("17: reverses line order with tac and character order per line with rev", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "abc\\ndef\\nghi\\n" | tac | rev | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ihg,fed,cba");
    });
  });

  it("18: slices interior lines using tail -n +2 (1-based start offset) piped into head -n -2 (exclude last N)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "L1\\nL2\\nL3\\nL4\\nL5\\nL6\\n" | tail -n +2 | head -n -2 | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "L2,L3,L4");
    });
  });

  it("19: counts lines (-l), words (-w), bytes (-c), and maximum line width (-L) with wc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "short\\nmedium line\\nthe longest line here\\n" > /workspace/wc.txt
        lines=$(wc -l < /workspace/wc.txt | tr -d " ")
        words=$(wc -w < /workspace/wc.txt | tr -d " ")
        bytes=$(wc -c < /workspace/wc.txt | tr -d " ")
        maxl=$(wc -L < /workspace/wc.txt | tr -d " ")
        echo "l=$lines|w=$words|c=$bytes|L=$maxl"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "l=3|w=7|c=40|L=21");
    });
  });

  it("20: expands tabs to tab-stop spaces with expand -t 4 and collapses spaces back to tabs with unexpand -a -t 4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "a\\tb\\tc\\n" | expand -t 4 | xxd -p
        printf "a   b   c\\n" | unexpand -a -t 4 | xxd -p
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "6120202062202020630a\n61096209630a");
    });
  });
});
