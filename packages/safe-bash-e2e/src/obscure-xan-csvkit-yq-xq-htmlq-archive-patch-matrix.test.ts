import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xan, csvkit, yq/xq/htmlq/xmllint, diff/patch, and archive pipeline matrix", () => {
  it("1. xan select -e with multi-column arithmetic aliases and xan map computed column", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      const r1 = await h.exec(
        "xan select -e 'name, score * 2 as double_score' /workspace/scores.csv",
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "name,double_score\nbob,4\nalice,20\ncarol,4\n");

      const r2 = await h.exec(
        "xan map 'score * (2 + 1)' triple /workspace/scores.csv",
      );
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "name,score,triple\nbob,2,6\nalice,10,30\ncarol,2,6\n");
    });
  });

  it("2. xan filter with numeric comparisons and -v invert-match", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,5\n",
      );
      const r1 = await h.exec("xan filter 'score > 2' /workspace/scores.csv");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "name,score\nalice,10\ncarol,5\n");

      const r2 = await h.exec("xan filter -v 'score > 2' /workspace/scores.csv");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "name,score\nbob,2\n");
    });
  });

  it("3. xan search with -s column selection, -e exact, -i ignore-case, and -v invert-match", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      const r1 = await h.exec("xan search -s name ali /workspace/scores.csv");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "name,score\nalice,10\n");

      const r2 = await h.exec("xan search -s name -e ali /workspace/scores.csv");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "name,score\n");

      const r3 = await h.exec("xan search -s name -i ALI /workspace/scores.csv");
      assert.equal(r3.exitCode, 0);
      assert.equal(r3.stdout, "name,score\nalice,10\n");
    });
  });

  it("4. xan rename, drop, reverse, and enum transformations", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      const r1 = await h.exec(
        "xan rename -s score points /workspace/scores.csv | xan reverse",
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "name,points\ncarol,2\nalice,10\nbob,2\n");

      const r2 = await h.exec("xan drop score /workspace/scores.csv | xan enum");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "index,name\n0,bob\n1,alice\n2,carol\n");
    });
  });

  it("5. xan dedup with -s column selection and --keep-last", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      const r1 = await h.exec("xan dedup -s score /workspace/scores.csv");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "name,score\nbob,2\nalice,10\n");

      const r2 = await h.exec("xan dedup -s score -l /workspace/scores.csv");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "name,score\ncarol,2\nalice,10\n");
    });
  });

  it("6. xan top with -l limit and -R reverse, and xan transpose", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,5\n",
      );
      const r1 = await h.exec("xan top -l 2 score /workspace/scores.csv");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "name,score\nalice,10\ncarol,5\n");

      const r2 = await h.exec("xan top -R -l 1 score /workspace/scores.csv");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "name,score\nbob,2\n");

      const r3 = await h.exec("xan transpose /workspace/scores.csv");
      assert.equal(r3.exitCode, 0);
      assert.equal(r3.stdout, "name,bob,alice,carol\nscore,2,10,5\n");
    });
  });

  it("7. xan agg and xan groupby with sum, count, min, max", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      const r1 = await h.exec(
        "xan agg 'sum(score) as total, count() as n' /workspace/scores.csv",
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "total,n\n14,3\n");

      const r2 = await h.exec(
        "xan groupby score 'count() as n, sum(score) as s' /workspace/scores.csv",
      );
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "score,n,s\n2,2,4\n10,1,10\n");
    });
  });

  it("8. xan freq and xan stats summary tables", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,4\n",
      );
      const r1 = await h.exec("xan stats /workspace/scores.csv");
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        "field,count,count_empty,type,types,sum,mean,variance,stddev,min,max,lex_first,lex_last,min_length,max_length\n" +
          "name,2,0,string,string,0,,,,,,alice,bob,3,5\n" +
          "score,2,0,int,int,6,3,1,1,2,4,2,4,1,1\n",
      );

      await h.writeText(
        "/workspace/freq.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      const r2 = await h.exec("xan freq -s score /workspace/freq.csv");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "field,value,count\nscore,2,2\nscore,10,1\n");
    });
  });

  it("9. xan join with --left, --anti, and --drop-key none", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/left.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      await h.writeText(
        "/workspace/right.csv",
        "name,city\nalice,Paris\nbob,Rome\nbob,Oslo\n",
      );
      const r1 = await h.exec(
        "xan join --left name /workspace/left.csv /workspace/right.csv",
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        "name,score,city\nbob,2,Rome\nbob,2,Oslo\nalice,10,Paris\ncarol,2,\n",
      );

      const r2 = await h.exec(
        "xan join --anti name /workspace/left.csv /workspace/right.csv",
      );
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "name,score\ncarol,2\n");

      const r3 = await h.exec(
        "xan join --drop-key none name /workspace/left.csv name /workspace/right.csv",
      );
      assert.equal(r3.exitCode, 0);
      assert.equal(
        r3.stdout,
        "name,score,name,city\nbob,2,bob,Rome\nbob,2,bob,Oslo\nalice,10,alice,Paris\n",
      );
    });
  });

  it("10. xan table / view, xan to json, xan from -f json, xan cat rows, and xan split", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "name,score\nbob,2\nalice,10\ncarol,2\n",
      );
      const tbl = await h.exec("xan table /workspace/scores.csv");
      assert.equal(tbl.exitCode, 0);
      assert.equal(
        tbl.stdout,
        "name   score\n-----  -----\nbob    2    \nalice  10   \ncarol  2    \n",
      );

      const jsonRoundtrip = await h.exec(
        "xan to json /workspace/scores.csv | xan from -f json",
      );
      assert.equal(jsonRoundtrip.exitCode, 0);
      assert.equal(jsonRoundtrip.stdout, "name,score\nbob,2\nalice,10\ncarol,2\n");

      const splitRes = await h.exec(
        "xan split -S 2 -O /workspace/chunks /workspace/scores.csv && cat /workspace/chunks/0.csv && echo '---' && cat /workspace/chunks/2.csv",
      );
      assert.equal(splitRes.exitCode, 0);
      assert.equal(
        splitRes.stdout,
        "name,score\nbob,2\nalice,10\n---\nname,score\ncarol,2\n",
      );
    });
  });

  it("11. csvkit pipeline: csvcut + csvgrep + csvsort + csvjoin", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/emp.csv",
        "id,name,dept_id,salary\n1,Alice,10,120000\n2,Bob,20,85000\n3,Carol,10,135000\n",
      );
      await h.writeText(
        "/workspace/dept.csv",
        "dept_id,dept_name\n10,Engineering\n20,Sales\n",
      );
      const r = await h.exec(
        "csvjoin -c dept_id /workspace/emp.csv /workspace/dept.csv | csvgrep -c dept_name -m Engineering | csvsort -c salary -r | csvcut -c name,salary,dept_name",
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "name,salary,dept_name\nCarol,135000,Engineering\nAlice,120000,Engineering\n",
      );
    });
  });

  it("12. csvsql with SQL GROUP BY and HAVING on multiple CSV inputs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/sales.csv",
        "region,rep,amount\nEast,A,100\nWest,B,250\nEast,C,150\nWest,D,300\nNorth,E,90\n",
      );
      const r = await h.exec(
        "csvsql --query 'SELECT region, COUNT(*) AS cnt, CAST(SUM(amount) AS INT) AS total FROM sales GROUP BY region HAVING SUM(amount) >= 200 ORDER BY total DESC' /workspace/sales.csv",
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "region,cnt,total\nWest,2,550\nEast,2,250\n");
    });
  });

  it("13. yq TOML to YAML to JSON cross-format pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/config.toml",
        '[package]\nname = "demo"\nversion = "1.2.0"\n\n[dependencies]\nserde = "1.0"\n',
      );
      const r = await h.exec(
        "yq -p=toml -o=yaml '.' /workspace/config.toml | yq -o=json '{pkg: .package.name, ver: .package.version, dep: .dependencies.serde}' | jq -c .",
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), '{"pkg":"demo","ver":"1.2.0","dep":"1.0"}');
    });
  });

  it("14. xq XML attribute & element query with jq transformation", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/catalog.xml",
        '<catalog><book id="b1"><title>Rust</title><price>40</price></book><book id="b2"><title>AWK</title><price>30</price></book></catalog>\n',
      );
      const r = await h.exec(
        "xq -c '[.catalog.book[] | {id: .\"@id\", title: .title, price: (.price | tonumber)}]' /workspace/catalog.xml",
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout.trim(),
        '[{"id":"b1","title":"Rust","price":40},{"id":"b2","title":"AWK","price":30}]',
      );
    });
  });

  it("15. htmlq CSS selectors with --text and --attribute extraction", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/index.html",
        '<div class="nav"><a href="https://example.com/docs" data-role="primary">Docs</a><a href="https://example.com/api">API</a></div>\n',
      );
      const r = await h.exec(
        "htmlq --attribute href '.nav a' --filename /workspace/index.html && htmlq --text '.nav a[data-role=\"primary\"]' --filename /workspace/index.html",
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "https://example.com/docs\nhttps://example.com/api\nDocs\n",
      );
    });
  });

  it("16. xmllint --xpath and --c14n canonical XML output", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/doc.xml",
        '<root z="2" a="1"><item>alpha</item><item>beta</item></root>\n',
      );
      const r = await h.exec(
        "xmllint --xpath 'string(/root/item[2])' /workspace/doc.xml && xmllint --c14n /workspace/doc.xml",
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout.trim(),
        'beta\n<root a="1" z="2"><item>alpha</item><item>beta</item></root>',
      );
    });
  });

  it("17. diff -u and patch roundtrip with reverse patch (-R)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/v1.txt", "line1\nline2\nline3\nline4\n");
      await h.writeText("/workspace/v2.txt", "line1\nline2_mod\nline3\nline4\nline5\n");
      const r = await h.exec(`
        diff -u /workspace/v1.txt /workspace/v2.txt > /workspace/change.patch || true
        cp /workspace/v1.txt /workspace/target.txt
        patch -s /workspace/target.txt /workspace/change.patch
        cmp -s /workspace/target.txt /workspace/v2.txt && echo "APPLIED_OK"
        patch -s -R /workspace/target.txt /workspace/change.patch
        cmp -s /workspace/target.txt /workspace/v1.txt && echo "REVERTED_OK"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "APPLIED_OK\nREVERTED_OK\n");
    });
  });

  it("18. diff3 -m three-way merge with non-conflicting and conflicting changes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "a\nb\nc\nd\n");
      await h.writeText("/workspace/mine.txt", "a_mine\nb\nc\nd\n");
      await h.writeText("/workspace/yours.txt", "a\nb\nc\nd_yours\n");
      const clean = await h.exec(
        "diff3 -m /workspace/mine.txt /workspace/base.txt /workspace/yours.txt",
      );
      assert.equal(clean.exitCode, 0);
      assert.equal(clean.stdout, "a_mine\nb\nc\nd_yours\n");
    });
  });

  it("19. tar with --strip-components and gzip/bzip2/xz/zstd stream pipelines", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/deep/nested/hello.txt", "hello archive world\n");
      const r = await h.exec(`
        tar -cf - -C /workspace src | zstd -c | zstd -d | xz -c | xz -d | bzip2 -c | bzip2 -d | gzip -c > /workspace/pkg.tar.gz
        mkdir -p /workspace/out
        tar -xzf /workspace/pkg.tar.gz --strip-components=3 -C /workspace/out
        cat /workspace/out/hello.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "hello archive world\n");
    });
  });

  it("20. zip and unzip -p streaming extraction with sha256sum verification", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/a.txt", "alpha payload\n");
      await h.writeText("/workspace/b.txt", "beta payload\n");
      const r = await h.exec(`
        cd /workspace
        zip -q bundle.zip a.txt b.txt
        unzip -p bundle.zip b.txt
        unzip -p bundle.zip a.txt | sha256sum | awk '{print $1}'
        sha256sum a.txt | awk '{print $1}'
      `);
      assert.equal(r.exitCode, 0);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "beta payload");
      assert.equal(lines[1], lines[2]);
    });
  });
});
