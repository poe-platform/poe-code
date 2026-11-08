import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure coreutils sort join comm cut paste tr nl column bc dc matrix", () => {
  it("1. sort multi-key (-t ':' -k2,2n -k1,1r) and version sort (-V)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'TXT' | sort -t ':' -k2,2n -k1,1r\nbeta:10\nalpha:20\ngamma:10\ndelta:5\nTXT\nprintf \"v1.10.0\\nv1.2.0\\nv1.2.5\\nv1.1.9\\n\" | sort -V");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "delta:5\ngamma:10\nbeta:10\nalpha:20\nv1.1.9\nv1.2.0\nv1.2.5\nv1.10.0");
    });
  });

  it("2. sort -h human-numeric sorting combined with numfmt --to=iec and --from=iec", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"1024\\n1048576\\n512\\n2048\\n\" | numfmt --to=iec | sort -h | tee /tmp/iec82.txt\nnumfmt --from=iec < /tmp/iec82.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "512\n1.0K\n2.0K\n1.0M\n512\n1024\n2048\n1048576");
    });
  });

  it("3. join with -a1 -a2 -e NULL -o output field projection across custom delimiter (-t ',')", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"1,Alice\\n2,Bob\\n3,Carol\\n\" > /tmp/j82_left.csv\nprintf \"1,95\\n3,88\\n4,72\\n\" > /tmp/j82_right.csv\njoin -t ',' -a 1 -a 2 -e 'MISSING' -o '0,1.2,2.2' /tmp/j82_left.csv /tmp/j82_right.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1,Alice,95\n2,Bob,MISSING\n3,Carol,88\n4,MISSING,72");
    });
  });

  it("4. comm set difference (-23, -13) and intersection (-12) over sorted streams", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"a\\nb\\nc\\nd\\n\" > /tmp/s82_1.txt\nprintf \"b\\nd\\ne\\n\" > /tmp/s82_2.txt\necho \"only1=$(comm -23 /tmp/s82_1.txt /tmp/s82_2.txt | paste -sd ',' -)\"\necho \"only2=$(comm -13 /tmp/s82_1.txt /tmp/s82_2.txt | paste -sd ',' -)\"\necho \"both=$(comm -12 /tmp/s82_1.txt /tmp/s82_2.txt | paste -sd ',' -)\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "only1=a,c\nonly2=e\nboth=b,d");
    });
  });

  it("5. cut field ranges (-d ':' -f 1,3-) and character ranges (-c 1-4) with --output-delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"u1:x:1000:1000:Alice:/home/alice:/bin/bash\\n\" | cut -d ':' --output-delimiter='|' -f 1,3,6-\nprintf \"abcdefghij\\n\" | cut -c 2-5,8-10");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "u1|1000|/home/alice|/bin/bash\nbcdehij");
    });
  });

  it("6. paste multi-file parallel merge and serial (-s) custom delimiter (-d ':|') cycling", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"1\\n2\\n3\\n4\\n\" | paste -s -d ':|'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:2|3:4");
    });
  });

  it("7. tr character class translation ([:lower:] [:upper:]), squeeze (-s), and complement delete (-cd)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"id:  abc-123_xyz!!\\n\" | tr -s ' ' | tr '[:lower:]' '[:upper:]'\nprintf \"phone: (555) 867-5309\\n\" | tr -cd '0-9\\n'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ID: ABC-123_XYZ!!\n5558675309");
    });
  });

  it("8. nl numbered lines with -ba, -w 3, -n rz (right-zero), and -s ': '", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"first\\n\\nthird\\n\" | nl -ba -w 3 -n rz -s ': '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "001: first\n002: \n003: third");
    });
  });

  it("9. tac reverse lines and rev reverse characters per line roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"alpha:1\\nbeta:2\\ngamma:3\\n\" | tac | rev");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3:ammag\n2:ateb\n1:ahpla");
    });
  });

  it("10. column -t -s ',' table alignment on ragged CSV input", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"svc,status,latency\\nauth,ok,12ms\\ncheckout-api,degraded,240ms\\n\" | column -t -s ','");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "svc           status    latency\nauth          ok        12ms\ncheckout-api  degraded  240ms");
    });
  });

  it("11. fold -w -s word-boundary wrapping and fmt paragraph reflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"The quick brown fox jumps over the lazy dog\\n\" | fold -w 15 -s");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "The quick \nbrown fox \njumps over the \nlazy dog");
    });
  });

  it("12. expand and unexpand tab <-> space conversion with custom tabstop (-t 4)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"a\\tb\\tc\\n\" | expand -t 4 | wc -c | awk '{print $1}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "10");
    });
  });

  it("13. bc scale precision, ibase/obase radix conversion, and user-defined function", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("bc << 'BC'\nscale=4\ndefine hyp(a, b) {\n  return sqrt(a*a + b*b)\n}\nhyp(3, 4)\nibase=16\nFF + 1\nBC");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "5.0000\n256");
    });
  });

  it("14. bc -l math library and iterative loop computation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("bc << 'BC'\nf = 1\nfor (i = 1; i <= 6; i++) f = f * i\nf\n2 ^ 10\nBC");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "720\n1024");
    });
  });

  it("15. expr regex match (:), substr, index, length, and integer arithmetic", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("expr \"release-v2.4.9\" : 'release-v\\([0-9.]*\\)'\nexpr substr \"safe-bash-wasm\" 6 4\nexpr 14 * 3 + 8");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2.4.9\nbash\n50");
    });
  });

  it("16. seq -f format string and -w zero-padded numeric sequence generation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("seq -w 8 10 | paste -sd ',' -\nseq -f 'node-%02g' 1 3 | paste -sd ',' -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "08,09,10\nnode-01,node-02,node-03");
    });
  });

  it("17. tsort topological dependency ordering of DAG edges", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'DAG' | tsort | paste -sd ',' -\ncompile link\nparse compile\nlink package\nfetch parse\nDAG");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "fetch,parse,compile,link,package");
    });
  });

  it("18. factor prime factorization of composite integers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("factor 360 1024");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "360: 2 2 2 3 3 5\n1024: 2 2 2 2 2 2 2 2 2 2");
    });
  });

  it("19. date UTC epoch (@timestamp) formatting and ISO-8601 output", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("date -u -d '@1700000000' '+%Y-%m-%d %H:%M:%S %Z'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2023-11-14 22:13:20 UTC");
    });
  });

  it("20. envsubst selective variable substitution preserving unreferenced $VARS", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export HOST=\"db.internal\" PORT=\"5432\"\nprintf 'url=postgres://${HOST}:${PORT}/app?user=${KEEP_LITERAL}\\n' | envsubst '$HOST $PORT'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "url=postgres://db.internal:5432/app?user=${KEEP_LITERAL}");
    });
  });

});
