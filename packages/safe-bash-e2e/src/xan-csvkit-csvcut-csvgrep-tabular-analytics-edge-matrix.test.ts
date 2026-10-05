import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { xanCommands } from "@poe-platform/safe-bash/commands/xan";
import { withE2EHarness } from "./harness.js";

describe("xan and csvkit tabular analytics, column expressions, slicing, joins, and SQL query matrix", () => {
  it("1. xan headers (and alias h) inspects column names with --just-names, --csv, and --start", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/users.csv",
        "id,username,department,salary\n1,alice,eng,140000\n2,bob,sales,95000\n",
      );

      const justNames = await h.exec("xan headers -j /workspace/users.csv");
      assert.equal(justNames.exitCode, 0);
      assert.equal(justNames.stdout, "id\nusername\ndepartment\nsalary\n");

      const started = await h.exec("xan h -s 10 /workspace/users.csv");
      assert.equal(started.exitCode, 0);
      assert.match(started.stdout, /10\s+id/);
      assert.match(started.stdout, /13\s+salary/);
    });
  });

  it("2. xan count counts rows with --no-headers, --human-readable, --check-alignment, and auto delimiter inference", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/metrics.tsv",
        "ts\tmetric\tval\n1\tcpu\t40\n2\tmem\t65\n3\tdisk\t80\n",
      );

      const countWithHeaders = await h.exec("xan count /workspace/metrics.tsv");
      assert.equal(countWithHeaders.exitCode, 0);
      assert.equal(countWithHeaders.stdout, "3\n");

      const countNoHeaders = await h.exec("xan count -n /workspace/metrics.tsv");
      assert.equal(countNoHeaders.exitCode, 0);
      assert.equal(countNoHeaders.stdout, "4\n");

      await h.writeText("/workspace/bad.csv", "a,b,c\n1,2,3\n4,5\n");
      const aligned = await h.exec("xan count -c /workspace/bad.csv");
      assert.notEqual(aligned.exitCode, 0);
    });
  });

  it("3. xan select projects column names, numeric ranges, and negated (!) column selections", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/items.csv",
        "sku,name,category,price,stock\nA1,Keyboard,hw,80,15\nB2,Mouse,hw,40,30\n",
      );

      const selected = await h.exec("xan select 'sku,price,stock' /workspace/items.csv");
      assert.equal(selected.exitCode, 0);
      assert.equal(selected.stdout, "sku,price,stock\nA1,80,15\nB2,40,30\n");

      const rangeAndGlob = await h.exec("xan select '0:1,p*' /workspace/items.csv");
      assert.equal(rangeAndGlob.exitCode, 0);
      assert.equal(rangeAndGlob.stdout, "sku,name,price\nA1,Keyboard,80\nB2,Mouse,40\n");

      const negated = await h.exec("xan select '!category,stock' /workspace/items.csv");
      assert.equal(negated.exitCode, 0);
      assert.equal(negated.stdout, "sku,name,price\nA1,Keyboard,80\nB2,Mouse,40\n");
    });
  });

  it("4. xan select -e and -f evaluate bounded single-column identifiers and reject complex expressions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/orders.csv",
        "item,qty,unit_price\nbolt,10,3\nnut,25,2\n",
      );
      await h.writeText("/workspace/expr.txt", "unit_price\n");

      const evalRes = await h.exec("xan select -e 'qty' /workspace/orders.csv");
      assert.equal(evalRes.exitCode, 0);
      assert.equal(evalRes.stdout, "qty\n10\n25\n");

      const fileRes = await h.exec("xan select -f /workspace/expr.txt /workspace/orders.csv");
      assert.equal(fileRes.exitCode, 0);
      assert.equal(fileRes.stdout, "unit_price\n3\n2\n");

      const rejected = await h.exec(
        "xan select -e 'qty * unit_price' /workspace/orders.csv",
      );
      assert.equal(rejected.exitCode, 1);
      assert.match(rejected.stderr, /unsupported in bounded CSV profile: expression syntax/);
    });
  });

  it("5. xan slice extracts rows by --start, --len, --index, --indices, and --last", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/seq.csv",
        "idx,label\n0,zero\n1,one\n2,two\n3,three\n4,four\n",
      );

      const rangeSlice = await h.exec("xan slice -s 1 -l 2 /workspace/seq.csv");
      assert.equal(rangeSlice.exitCode, 0);
      assert.equal(rangeSlice.stdout, "idx,label\n1,one\n2,two\n");

      const indicesSlice = await h.exec("xan slice -I '0,3,4' /workspace/seq.csv");
      assert.equal(indicesSlice.exitCode, 0);
      assert.equal(indicesSlice.stdout, "idx,label\n0,zero\n3,three\n4,four\n");

      const condSlice = await h.exec("xan slice -S 'idx >= 2' -E 'idx == 4' /workspace/seq.csv");
      assert.equal(condSlice.exitCode, 0);
      assert.equal(condSlice.stdout, "idx,label\n2,two\n3,three\n");
    });

    await withE2EHarness(
      { plugins: [xanCommands({ replace: true, limits: { maxLastRows: 100 } })] },
      async (h) => {
        await h.writeText(
          "/workspace/seq.csv",
          "idx,label\n0,zero\n1,one\n2,two\n3,three\n4,four\n",
        );
        const lastSlice = await h.exec("xan slice -L 2 /workspace/seq.csv");
        assert.equal(lastSlice.exitCode, 0);
        assert.equal(lastSlice.stdout, "idx,label\n3,three\n4,four\n");
      },
    );
  });

  it("6. xan writes to .tsv/.psv output files with automatic delimiter conversion", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/in.csv", "a,b\n1,2\n3,4\n");
      const res = await h.exec("xan select 'b,a' -o /workspace/out.tsv /workspace/in.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(await h.readText("/workspace/out.tsv"), "b\ta\n2\t1\n4\t3\n");
    });
  });

  it("7. csvcut selects and excludes columns by name, 1-based index, and range", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/emp.csv",
        "id,name,role,team,loc\n1,Ada,Staff,Core,NY\n2,Linus,Principal,Kernel,SF\n",
      );

      const cutNames = await h.exec("csvcut -c name,team /workspace/emp.csv");
      assert.equal(cutNames.exitCode, 0);
      assert.equal(cutNames.stdout, "name,team\nAda,Core\nLinus,Kernel\n");

      const cutExclude = await h.exec("csvcut -C 1,3,5 /workspace/emp.csv");
      assert.equal(cutExclude.exitCode, 0);
      assert.equal(cutExclude.stdout, "name,team\nAda,Core\nLinus,Kernel\n");
    });
  });

  it("8. csvgrep filters rows by literal substring (-m), regex (-r), and inverse match (-i)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/hosts.csv",
        "host,env,region\nweb-01,prod,us-east\ndb-01,staging,us-west\ncache-02,prod,eu-central\n",
      );

      const prodOnly = await h.exec("csvgrep -c env -m prod /workspace/hosts.csv");
      assert.equal(prodOnly.exitCode, 0);
      assert.equal(
        prodOnly.stdout,
        "host,env,region\nweb-01,prod,us-east\ncache-02,prod,eu-central\n",
      );

      const nonProdRegex = await h.exec(
        "csvgrep -c host -r '^(web|db)-01$' -i /workspace/hosts.csv",
      );
      assert.equal(nonProdRegex.exitCode, 0);
      assert.equal(nonProdRegex.stdout, "host,env,region\ncache-02,prod,eu-central\n");
    });
  });

  it("9. csvsort sorts tabular data by numeric and text columns in ascending and reverse order", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "player,score\ncharlie,85\nalice,120\nbob,95\n",
      );

      const byScoreDesc = await h.exec("csvsort -c score -r /workspace/scores.csv");
      assert.equal(byScoreDesc.exitCode, 0);
      assert.equal(
        byScoreDesc.stdout,
        "player,score\nalice,120\nbob,95\ncharlie,85\n",
      );
    });
  });

  it("10. csvjoin performs inner, left, and outer joins across CSV tables", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/depts.csv", "dept_id,dept_name\n10,Engineering\n20,Design\n30,Finance\n");
      await h.writeText("/workspace/staff.csv", "emp,dept_id\nAlice,10\nBob,20\nCharlie,99\n");

      const inner = await h.exec("csvjoin -c dept_id /workspace/staff.csv /workspace/depts.csv");
      assert.equal(inner.exitCode, 0);
      assert.equal(
        inner.stdout,
        "emp,dept_id,dept_name\nAlice,10,Engineering\nBob,20,Design\n",
      );

      const left = await h.exec("csvjoin --left -c dept_id /workspace/staff.csv /workspace/depts.csv");
      assert.equal(left.exitCode, 0);
      assert.equal(
        left.stdout,
        "emp,dept_id,dept_name\nAlice,10,Engineering\nBob,20,Design\nCharlie,99,\n",
      );
    });
  });

  it("11. csvstat computes summary statistics (--count, --sum, --min, --max, --csv)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/nums.csv", "metric,val\na,10\nb,20\nc,30\nd,40\n");

      const countRes = await h.exec("csvstat --count /workspace/nums.csv");
      assert.equal(countRes.exitCode, 0);
      assert.match(countRes.stdout, /4/);

      const sumRes = await h.exec("csvstat -c val --sum /workspace/nums.csv");
      assert.equal(sumRes.exitCode, 0);
      assert.match(sumRes.stdout, /100/);
    });
  });

  it("12. csvjson and in2csv round-trip between CSV, JSON arrays, keyed objects, and NDJSON streams", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/kv.csv", "code,label\nUS,United States\nCA,Canada\n");

      const keyedJson = await h.exec("csvjson -k code /workspace/kv.csv");
      assert.equal(keyedJson.exitCode, 0);
      const parsedKeyed = JSON.parse(keyedJson.stdout);
      assert.equal(parsedKeyed.US.label, "United States");
      assert.equal(parsedKeyed.CA.label, "Canada");

      const ndjson = await h.exec("csvjson --stream /workspace/kv.csv");
      assert.equal(ndjson.exitCode, 0);
      const backToCsv = await h.exec(`in2csv -f ndjson <<'EOF'\n${ndjson.stdout}EOF`);
      assert.equal(backToCsv.exitCode, 0);
      assert.equal(backToCsv.stdout, "code,label\nUS,United States\nCA,Canada\n");
    });
  });

  it("13. csvstack concatenates multiple CSV files with group labels (-g, -n)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/q1.csv", "item,rev\npro,100\n");
      await h.writeText("/workspace/q2.csv", "item,rev\npro,150\n");

      const stacked = await h.exec(
        "csvstack -g Q1,Q2 -n quarter /workspace/q1.csv /workspace/q2.csv",
      );
      assert.equal(stacked.exitCode, 0);
      assert.equal(stacked.stdout, "quarter,item,rev\nQ1,pro,100\nQ2,pro,150\n");
    });
  });

  it("14. csvformat re-delivers CSV with custom output delimiters (-D) and tab separation (-T)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/raw.csv", 'a,b,c\n"hello, world",2,3\n');

      const pipeDelim = await h.exec("csvformat -D '|' /workspace/raw.csv");
      assert.equal(pipeDelim.exitCode, 0);
      assert.equal(pipeDelim.stdout, "a|b|c\nhello, world|2|3\n");

      const tabDelim = await h.exec("csvformat -T /workspace/raw.csv");
      assert.equal(tabDelim.exitCode, 0);
      assert.equal(tabDelim.stdout, "a\tb\tc\nhello, world\t2\t3\n");
    });
  });

  it("15. csvlook renders aligned Markdown tables from CSV input", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/look.csv", "name,score\nalice,98\nbob,87\n");
      const res = await h.exec("csvlook /workspace/look.csv");
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /\|\s*name\s*\|\s*score\s*\|/);
      assert.match(res.stdout, /\|\s*alice\s*\|\s*98\s*\|/);
    });
  });

  it("16. csvclean detects and reports structural row-length errors with -n", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/dirty.csv", "a,b,c\n1,2,3\n4,5\n6,7,8\n");
      const check = await h.exec("csvclean -n /workspace/dirty.csv");
      assert.notEqual(check.exitCode, 0);
      assert.match(check.stdout + check.stderr, /expected 3|Line 2|Row 2|column/i);
    });
  });

  it("17. csvsql infers SQL CREATE TABLE schemas across dialects, custom table names, and unique constraints", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/customers.csv",
        "cid,name,active,spend\n1,Acme,true,500.25\n2,Beta,false,150.00\n",
      );

      const ddl = await h.exec(
        "csvsql --dialect postgresql --tables accounts --unique-constraint cid /workspace/customers.csv",
      );
      assert.equal(ddl.exitCode, 0);
      assert.match(ddl.stdout, /CREATE TABLE accounts/i);
      assert.match(ddl.stdout, /cid DECIMAL NOT NULL/);
      assert.match(ddl.stdout, /active BOOLEAN NOT NULL/);
      assert.match(ddl.stdout, /UNIQUE \(cid\)/);
    });
  });

  it("18. csvsql --query and sql2csv report exit status 78 when no database capability is bound", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/events.csv", "id,kind\n1,login\n");

      const csvsqlQuery = await h.exec(
        "csvsql --query 'SELECT * FROM events' /workspace/events.csv",
      );
      assert.equal(csvsqlQuery.exitCode, 78);
      assert.match(csvsqlQuery.stderr, /database capability sqlite/);

      const sql2csvRes = await h.exec(
        "sql2csv --db 'sqlite:///:memory:' --query 'SELECT 1'",
      );
      assert.equal(sql2csvRes.exitCode, 78);
      assert.match(sql2csvRes.stderr, /database capability sqlite/);
    });
  });

  it("19. handles RFC 4180 quoted fields containing embedded commas, double quotes, and newlines across xan and csvcut", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/RFC4180.csv",
        'id,note,tag\n1,"hello, ""world""",alpha\n2,"multi\nline",beta\n',
      );

      const xanOut = await h.exec("xan select 'tag,note' /workspace/RFC4180.csv");
      assert.equal(xanOut.exitCode, 0);
      assert.equal(
        xanOut.stdout,
        'tag,note\nalpha,"hello, ""world"""\nbeta,"multi\nline"\n',
      );

      const cutOut = await h.exec("csvcut -c tag,id /workspace/RFC4180.csv");
      assert.equal(cutOut.exitCode, 0);
      assert.equal(cutOut.stdout, "tag,id\nalpha,1\nbeta,2\n");
    });
  });

  it("20. chains xan select -> csvgrep -> csvsort -> csvjson -> jq in an end-to-end ETL pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/telemetry.csv",
        "service,requests,errors,p95_ms\nauth,1000,5,40\npayments,500,25,120\nsearch,2000,10,30\ncatalog,800,40,95\n",
      );

      const res = await h.exec(
        "xan select 'service,requests,errors,p95_ms' /workspace/telemetry.csv | csvgrep -c service -r '^(auth|payments|catalog)$' | csvsort -c p95_ms -r | csvjson | jq -c 'map({service, p95_ms: (.p95_ms + 0), err_per_k: ((.errors * 1000) / .requests)})'",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"service":"payments","p95_ms":120,"err_per_k":50},{"service":"catalog","p95_ms":95,"err_per_k":50},{"service":"auth","p95_ms":40,"err_per_k":5}]\n',
      );
    });
  });
});
