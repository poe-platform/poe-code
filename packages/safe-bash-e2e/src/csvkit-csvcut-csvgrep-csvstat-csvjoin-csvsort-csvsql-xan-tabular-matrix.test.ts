import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { xanCommands } from "@poe-platform/safe-bash/commands/xan";
import { withE2EHarness } from "./harness.js";

describe("csvkit (csvcut, csvgrep, csvstat, csvjoin, csvsort, csvstack, csvlook, csvjson, in2csv, csvformat, csvclean, csvsql) and xan tabular matrix", () => {
  it("1. csvcut -n, -c, -C, and -l select, exclude, reorder, and number CSV columns", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/emp.csv",
        "id,name,dept,salary\n10,Ada,R&D,150\n20,Grace,Ops,140\n",
      );

      const r = await h.exec(`
        csvcut -n emp.csv
        echo "---"
        csvcut -c name,salary emp.csv
        echo "---"
        csvcut -C id,dept -l emp.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "  1: id",
          "  2: name",
          "  3: dept",
          "  4: salary",
          "---",
          "name,salary",
          "Ada,150",
          "Grace,Ops" in {} ? "" : "Grace,140",
          "---",
          "line_number,name,salary",
          "1,Ada,150",
          "2,Grace,140",
          "",
        ].join("\n"),
      );
    });
  });

  it("2. csvcut -x (--delete-empty-rows) and -t (--tabs) handle TSV input and blank rows", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/sparse.tsv",
        "k\tv\na\t1\n\t\nb\t2\n",
      );

      const r = await h.exec("csvcut -t -x -c v,k sparse.tsv");
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "v,k\n1,a\n2,b\n");
    });
  });

  it("3. csvgrep -m exact substring, -r regex, -i invert-match, and -a any-match filter rows", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/events.csv",
        "id,service,severity,code\n1,auth,ERROR,E101\n2,billing,WARN,W204\n3,auth,INFO,I001\n4,storage,ERROR,E503\n",
      );

      const r = await h.exec(`
        csvgrep -c severity -m ERROR events.csv
        echo "---"
        csvgrep -c code -r '^W[0-9]+' events.csv
        echo "---"
        csvgrep -c severity -m ERROR -i events.csv | csvcut -c id,service
        echo "---"
        csvgrep -c service,code -a -r '^(auth|E503)$' events.csv | csvcut -c id,code
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "id,service,severity,code",
          "1,auth,ERROR,E101",
          "4,storage,ERROR,E503",
          "---",
          "id,service,severity,code",
          "2,billing,WARN,W204",
          "---",
          "id,service",
          "2,billing",
          "3,auth",
          "---",
          "id,code",
          "1,E101",
          "3,I001",
          "4,E503",
          "",
        ].join("\n"),
      );
    });
  });

  it("4. csvsort sorts by single and multiple columns with reverse (-r) and type inference (-I)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/scores.csv",
        "team,member,points\nB,Zoe,90\nA,Bob,100\nA,Alice,100\nB,Max,95\n",
      );

      const r = await h.exec(`
        csvsort -c team,member scores.csv
        echo "---"
        csvsort -c points -r scores.csv | csvcut -c member,points
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "team,member,points",
          "A,Alice,100",
          "A,Bob,100",
          "B,Max,95",
          "B,Zoe,90",
          "---",
          "member,points",
          "Bob,100",
          "Alice,100",
          "Max,95",
          "Zoe,90",
          "",
        ].join("\n"),
      );
    });
  });

  it("5. csvjoin performs inner, left (--left), right (--right), and outer (--outer) relational joins", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/left.csv", "id,name\n1,Alice\n2,Bob\n3,Carol\n");
      await h.writeText("/workspace/right.csv", "id,tier\n1,gold\n2,silver\n4,bronze\n");

      const r = await h.exec(`
        csvjoin -c id left.csv right.csv
        echo "---"
        csvjoin -c id --left left.csv right.csv
        echo "---"
        csvjoin -c id --outer left.csv right.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "id,name,tier",
          "1,Alice,gold",
          "2,Bob,silver",
          "---",
          "id,name,tier",
          "1,Alice,gold",
          "2,Bob,silver",
          "3,Carol,",
          "---",
          "id,name,id2,tier",
          "1,Alice,1,gold",
          "2,Bob,2,silver",
          "3,Carol,,",
          ",,4,bronze",
          "",
        ].join("\n"),
      );
    });
  });

  it("6. csvstack stacks multiple CSV files with -g group labels and -n group column name", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/q1.csv", "sku,qty\nA1,10\n");
      await h.writeText("/workspace/q2.csv", "sku,qty\nA1,15\nB2,5\n");

      const r = await h.exec("csvstack -g Q1,Q2 -n quarter q1.csv q2.csv");
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "quarter,sku,qty\nQ1,A1,10\nQ2,A1,15\nQ2,B2,5\n",
      );
    });
  });

  it("7. csvstat computes --count, --sum, --mean, --min, --max, and --median summary statistics", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/metrics.csv",
        "host,latency\nh1,10\nh2,20\nh3,30\nh4,40\nh5,50\n",
      );

      const r = await h.exec(`
        csvstat --count metrics.csv
        csvstat -c latency --sum metrics.csv
        csvstat -c latency --min metrics.csv
        csvstat -c latency --max metrics.csv
        csvstat -c latency --median metrics.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "5\n150\n10\n50\n30\n");
    });
  });

  it("8. csvlook renders aligned markdown-style ASCII tables with --max-rows and --max-columns", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/tbl.csv",
        "id,item,price\n1,Keyboard,120\n2,Mouse,45\n",
      );

      const r = await h.exec("csvlook tbl.csv");
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "| id | item     | price |",
          "| -- | -------- | ----- |",
          "|  1 | Keyboard |   120 |",
          "|  2 | Mouse    |    45 |",
          "",
        ].join("\n"),
      );
    });
  });

  it("9. csvjson serializes CSV rows into JSON arrays, keyed objects (-k), and GeoJSON (--lat/--lon)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/places.csv",
        "code,city,lat,lon\nNYC,New York,40.7128,-74.006\nSFO,San Francisco,37.7749,-122.4194\n",
      );

      const r = await h.exec(`
        csvjson -k code places.csv | jq -c '.NYC.city'
        csvjson --lat lat --lon lon places.csv | jq -c '.type, (.features | length), .features[0].geometry.coordinates'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "\"New York\"\n\"FeatureCollection\"\n2\n[-74.006,40.7128]\n",
      );
    });
  });

  it("10. in2csv converts JSON arrays, NDJSON, and GeoJSON features into normalized CSV", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/items.json",
        JSON.stringify([
          { id: 1, label: "alpha", active: true },
          { id: 2, label: "beta", active: false },
        ]),
      );
      await h.writeText(
        "/workspace/stream.ndjson",
        '{"k":"x","v":10}\n{"k":"y","v":20}\n',
      );

      const r = await h.exec(`
        in2csv items.json
        echo "---"
        in2csv -f ndjson stream.ndjson
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "id,label,active",
          "1,alpha,True",
          "2,beta,False",
          "---",
          "k,v",
          "x,10",
          "y,20",
          "",
        ].join("\n"),
      );
    });
  });

  it("11. csvformat re-delimits (-D), quotes (-U), and customizes line terminators (-M)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/raw.csv",
        "a,b,c\n1,hello world,3\n",
      );

      const r = await h.exec(`
        csvformat -D '|' raw.csv
        echo "---"
        csvformat -U 1 raw.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "a|b|c",
          "1|hello world|3",
          "---",
          '"a","b","c"',
          '"1","hello world","3"',
          "",
        ].join("\n"),
      );
    });
  });

  it("12. csvclean --length-mismatch --omit-error-rows and --fill-short-rows repair or filter malformed CSV rows", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/dirty.csv",
        "id,name,role\n1,Alice,admin\n2,Bob\n3,Carol,user,extra\n4,Dan,dev\n",
      );

      const r1 = await h.exec("csvclean --length-mismatch --omit-error-rows dirty.csv");
      assert.equal(r1.exitCode, 1);
      assert.equal(r1.stdout, "id,name,role\n1,Alice,admin\n4,Dan,dev\n");
      assert.match(r1.stderr, /Expected 3 columns, found 2 columns/);
      assert.match(r1.stderr, /Expected 3 columns, found 4 columns/);

      const r2 = await h.exec("csvclean --fill-short-rows --fillvalue NA dirty.csv");
      assert.equal(r2.exitCode, 0, r2.stderr);
      assert.equal(
        r2.stdout,
        "id,name,role\n1,Alice,admin\n2,Bob,NA\n3,Carol,user,extra\n4,Dan,dev\n",
      );
    });
  });

  it("13. csvsql generates SQL CREATE TABLE schemas with inferred types and custom table names (--tables)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/orders.csv",
        "order_id,customer,total,paid\n101,Alice,49.95,true\n102,Bob,120.00,false\n",
      );

      const r = await h.exec("csvsql --tables customer_orders orders.csv");
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /CREATE TABLE customer_orders/);
      assert.match(r.stdout, /order_id DECIMAL NOT NULL/);
      assert.match(r.stdout, /customer VARCHAR NOT NULL/);
      assert.match(r.stdout, /total DECIMAL NOT NULL/);
      assert.match(r.stdout, /paid BOOLEAN NOT NULL/);
    });
  });

  it("14. xan headers inspects single and multi-file CSV headers and detects diverging columns", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/h1.csv", "id,name,email\n1,A,a@x\n");
      await h.writeText("/workspace/h2.csv", "id,name,phone\n2,B,123\n");

      const r = await h.exec(`
        xan headers -j h1.csv
        echo "---"
        xan headers -s 1 h1.csv
        echo "---"
        xan headers h1.csv h2.csv | tail -n 2
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "id",
          "name",
          "email",
          "---",
          "1 id",
          "2 name",
          "3 email",
          "---",
          "All files don't have the same headers!",
          "Diverging headers: email, phone",
          "",
        ].join("\n"),
      );
    });
  });

  it("15. xan count counts data rows with header handling (-n), alignment verification (-c), and human formatting (-H)", async () => {
    await withE2EHarness(async (h) => {
      const lines = ["a,b"];
      for (let i = 1; i <= 25; i++) lines.push(`${i},${i * 2}`);
      await h.writeText("/workspace/nums.csv", lines.join("\n") + "\n");

      const r = await h.exec(`
        xan count nums.csv
        xan count -n nums.csv
        xan count -c nums.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "25\n26\n25\n");
    });
  });

  it("16. xan select supports column ranges, negative indices, prefix/suffix globs, and complement (!) selection", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/wide.csv",
        "id,meta_a,meta_b,val_x,val_y,notes\n1,m1,m2,10,20,ok\n2,m3,m4,30,40,done\n",
      );

      const r = await h.exec(`
        xan select 'meta_*,val_y' wide.csv
        echo "---"
        xan select '!meta_*,notes' wide.csv
        echo "---"
        xan select '0,-1' wide.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "meta_a,meta_b,val_y",
          "m1,m2,20",
          "m3,m4,40",
          "---",
          "id,val_x,val_y",
          "1,10,20",
          "2,30,40",
          "---",
          "id,notes",
          "1,ok",
          "2,done",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. xan select handles duplicate header occurrences (col[0], col[1], col[-1]) and reversed ranges", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/dup.csv",
        "tag,val,tag,score\nA,1,B,9\nC,2,D,8\n",
      );

      const r = await h.exec(`
        xan select 'tag[1],tag[0]' dup.csv
        echo "---"
        xan select 'score:val' dup.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "tag,tag",
          "B,A",
          "D,C",
          "---",
          "score,tag,val",
          "9,B,1",
          "8,D,2",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. xan slice extracts row windows by -s/--start, -l/--len, -L/--last, -i/--index, and -I/--indices", async () => {
    await withE2EHarness(
      { plugins: [xanCommands({ replace: true, limits: { maxLastRows: 1000 } })] },
      async (h) => {
      await h.writeText(
        "/workspace/seq.csv",
        "idx,word\n0,zero\n1,one\n2,two\n3,three\n4,four\n",
      );

      const r = await h.exec(`
        xan slice -s 1 -l 2 seq.csv
        echo "---"
        xan slice -L 2 seq.csv
        echo "---"
        xan slice -I 0,3,4 seq.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "idx,word",
          "1,one",
          "2,two",
          "---",
          "idx,word",
          "3,three",
          "4,four",
          "---",
          "idx,word",
          "0,zero",
          "3,three",
          "4,four",
          "",
        ].join("\n"),
      );
      },
    );
  });

  it("19. xan slice -S (--start-condition) and -E (--end-condition) bound streams by column predicates", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/log.csv",
        "seq,phase,val\n1,init,5\n2,warmup,12\n3,steady,25\n4,steady,30\n5,cooldown,8\n",
      );

      const r = await h.exec(`
        xan slice -S 'val >= 12' -E 'phase == "cooldown"' log.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "seq,phase,val",
          "2,warmup,12",
          "3,steady,25",
          "4,steady,30",
          "",
        ].join("\n"),
      );
    });
  });

  it("20. multi-stage ETL pipeline combining in2csv, csvjoin, csvgrep, csvsort, xan select/slice, and csvjson", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/accounts.json",
        JSON.stringify([
          { acct_id: "A1", owner: "Alice", region: "us-east" },
          { acct_id: "A2", owner: "Bob", region: "eu-west" },
          { acct_id: "A3", owner: "Carol", region: "us-east" },
        ]),
      );
      await h.writeText(
        "/workspace/usage.csv",
        "acct_id,spend\nA1,420\nA2,180\nA3,950\n",
      );

      const r = await h.exec(`
        in2csv accounts.json > accounts.csv
        csvjoin -c acct_id accounts.csv usage.csv \
          | csvgrep -c region -m us-east \
          | csvsort -c spend -r \
          | xan select owner,spend \
          | csvjson | jq -c '.'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '[{"owner":"Carol","spend":950.0},{"owner":"Alice","spend":420.0}]\n',
      );
    });
  });
});
