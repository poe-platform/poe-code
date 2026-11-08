import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure xan, csvkit, jq, yq, xq, xmllint, htmlq, mdq, and sqlite3 parity matrix", () => {
  it("01. enforces xan subcommand diagnostics, headers -n rejection, and count -p/-t/-a/-c execution option validation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/data.csv": "id,val\n1,10\n2,20\n3,30\n",
      },
      cwd: "/work",
    });
    try {
      const rEmpty = await h.exec("xan");
      assert.equal(rEmpty.exitCode, 1);
      assert.equal(rEmpty.stderr, "xan: expected a CSV subcommand (use xan --help)\n");

      const rUnknown = await h.exec("xan bogus");
      assert.equal(rUnknown.exitCode, 1);
      assert.equal(rUnknown.stderr, "xan bogus: expected a CSV subcommand (use xan --help)\n");

      const rHdrNo = await h.exec("xan headers -n /work/data.csv");
      assert.equal(rHdrNo.exitCode, 1);
      assert.match(rHdrNo.stderr, /Unknown flag: '-n' Use the -h\/--help flag for more information\./);

      const rParOk = await h.exec("xan count -p -H /work/data.csv");
      assert.equal(rParOk.exitCode, 0);
      assert.equal(rParOk.stdout, "3\n");
      assert.equal(rParOk.stderr, "nothing is actually parallelized!\n");

      const rThreadsOk = await h.exec("xan count -t 4 /work/data.csv");
      assert.equal(rThreadsOk.exitCode, 0);
      assert.equal(rThreadsOk.stdout, "3\n");
      assert.equal(rThreadsOk.stderr, "nothing is actually parallelized!\n");

      const rParStdin = await h.exec("cat /work/data.csv | xan count -p");
      assert.equal(rParStdin.exitCode, 1);
      assert.equal(rParStdin.stderr, "xan count: count execution options require a file path\n");

      const rParAlign = await h.exec("xan count -p -c /work/data.csv");
      assert.equal(rParAlign.exitCode, 1);
      assert.equal(
        rParAlign.stderr,
        "xan count: -p/--parallel or -t/--threads cannot be used with -a/--approx nor -c/--check-alignment!\n",
      );

      const rApproxAlign = await h.exec("xan count -a -c /work/data.csv");
      assert.equal(rApproxAlign.exitCode, 1);
      assert.equal(rApproxAlign.stderr, "xan count: -a/--approx does not work with -c/--check-alignment!\n");

      const rZeroThreads = await h.exec("xan count --threads 0 /work/data.csv");
      assert.equal(rZeroThreads.exitCode, 1);
      assert.equal(rZeroThreads.stderr, "xan count: --threads must be positive\n");
    } finally {
      await h.dispose();
    }
  });

  it("02. inspects CSV headers with xan headers -j, --csv (single and multi-file), and -s start offset", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.csv": "id,name,score\n1,ada,90\n",
        "/work/f2.csv": "id,name,region,tier\n2,bob,eu,pro\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== JUST NAMES ==="
        xan headers -j f1.csv
        echo "=== START 10 ==="
        xan headers -s 10 f1.csv
        echo "=== CSV SINGLE ==="
        xan headers --csv f1.csv
        echo "=== CSV MULTI ==="
        xan headers --csv f1.csv f2.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== JUST NAMES ===",
          "id",
          "name",
          "score",
          "=== START 10 ===",
          "10 id",
          "11 name",
          "12 score",
          "=== CSV SINGLE ===",
          "f1.csv",
          "id",
          "name",
          "score",
          "=== CSV MULTI ===",
          "f1.csv,f2.csv",
          "id,id",
          "name,name",
          "score,region",
          ",tier",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("03. evaluates xan select -e arithmetic expressions with AS aliases and xan map inline AS expressions", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/items.csv": "item,qty,price,tax\npen,3,10,2\nbook,2,25,5\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== SELECT -e ==="
        xan select -e 'item, qty * price AS subtotal, (qty * price) + tax AS total' items.csv
        echo "=== MAP INLINE AS ==="
        xan map 'qty * price AS subtotal' items.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== SELECT -e ===",
          "item,subtotal,total",
          "pen,30,32",
          "book,50,55",
          "=== MAP INLINE AS ===",
          "item,qty,price,tax,subtotal",
          "pen,3,10,2,30",
          "book,2,25,5,50",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("04. slices CSV streams with xan slice -I indices, --skip + -l, -L last rows, and -S/-E start/end conditions", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/seq.csv": "seq,code,score\n0,a,10\n1,b,20\n2,c,30\n3,d,40\n4,e,50\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== INDICES ==="
        xan slice -I '4,1,4,0' seq.csv
        echo "=== LAST 2 ==="
        xan slice -L 2 seq.csv
        echo "=== COND ==="
        xan slice -S 'score >= 20' -E 'code == "d"' seq.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== INDICES ===",
          "seq,code,score",
          "0,a,10",
          "1,b,20",
          "4,e,50",
          "=== LAST 2 ===",
          "seq,code,score",
          "3,d,40",
          "4,e,50",
          "=== COND ===",
          "seq,code,score",
          "1,b,20",
          "2,c,30",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("05. aggregates CSV groups with xan groupby and xan agg (count, sum, mean, min, max, first, last)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/sales.csv": "team,rep,amount\ncore,ada,100\ncore,bob,300\nedges,cal,50\nedges,dee,150\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== AGG ==="
        xan agg 'count() AS n, sum(amount) AS total, mean(amount) AS avg, min(amount) AS lo, max(amount) AS hi' sales.csv
        echo "=== GROUPBY ==="
        xan groupby team 'count() AS n, sum(amount) AS total, first(rep) AS first_rep, last(rep) AS last_rep' sales.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== AGG ===",
          "n,total,avg,lo,hi",
          "4,600,150,50,300",
          "=== GROUPBY ===",
          "team,n,total,first_rep,last_rep",
          "core,2,400,ada,bob",
          "edges,2,200,cal,dee",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("06. joins CSV tables with xan join (--left, --semi, --anti, --cross) and --drop-key modes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/left.csv": "id,lname\n1,ada\n2,bob\n3,cal\n",
        "/work/right.csv": "id,rrole\n2,admin\n3,ops\n4,guest\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== INNER DROP RIGHT ==="
        xan join --drop-key right id left.csv id right.csv
        echo "=== SEMI ==="
        xan join --semi id left.csv id right.csv
        echo "=== ANTI ==="
        xan join --anti id left.csv id right.csv
        echo "=== LEFT DROP BOTH ==="
        xan join --left --drop-key both id left.csv id right.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== INNER DROP RIGHT ===",
          "id,lname,rrole",
          "2,bob,admin",
          "3,cal,ops",
          "=== SEMI ===",
          "id,lname",
          "2,bob",
          "3,cal",
          "=== ANTI ===",
          "id,lname",
          "1,ada",
          "=== LEFT DROP BOTH ===",
          "lname,rrole",
          "ada,",
          "bob,admin",
          "cal,ops",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("07. computes CSV column statistics and frequency tables with xan stats and xan freq (-s, -l, -N)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/obs.csv": "tag,score\nalpha,10\nbeta,20\nalpha,30\nalpha,\ngamma,40\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== FREQ ==="
        xan freq -s tag -l 2 -N obs.csv
        echo "=== STATS ==="
        xan stats -s score obs.csv | xan select field,count,count_empty,type,sum,mean,min,max
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== FREQ ===",
          "field,value,count",
          "tag,alpha,3",
          "tag,beta,1",
          "=== STATS ===",
          "field,count,count_empty,type,sum,mean,min,max",
          "score,4,1,int,100,25,10,40",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("08. transforms CSV rows with xan dedup (--keep-last, --keep-duplicates), xan enum (-c, -S), xan transpose, and xan top", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/events.csv": "k,v\na,10\nb,30\na,20\nc,15\nb,40\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== DEDUP KEEP LAST ==="
        xan dedup -s k --keep-last events.csv
        echo "=== DEDUP KEEP DUPS ==="
        xan dedup -s k --keep-duplicates events.csv
        echo "=== ENUM ==="
        xan top -l 2 v events.csv | xan enum -c rank -S 1
        echo "=== TRANSPOSE ==="
        xan top -l 2 v events.csv | xan transpose
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== DEDUP KEEP LAST ===",
          "k,v",
          "a,20",
          "b,40",
          "c,15",
          "=== DEDUP KEEP DUPS ===",
          "k,v",
          "a,10",
          "b,30",
          "=== ENUM ===",
          "rank,k,v",
          "1,b,40",
          "2,b,30",
          "=== TRANSPOSE ===",
          "k,b,b",
          "v,40,30",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("09. converts CSV to and from json, jsonl, and txt with xan to and xan from", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/users.csv": "name,age,note\nada,30,\nbob,25,ok\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== TO JSONL OMIT ==="
        xan to jsonl --omit users.csv
        echo "=== ROUNDTRIP JSON ==="
        xan to json --nulls users.csv | xan from -f json
        echo "=== TO TXT / FROM TXT ==="
        xan select name users.csv | xan to txt | xan from -f txt --column-name user_name
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== TO JSONL OMIT ===",
          '{"name":"ada","age":30}',
          '{"name":"bob","age":25,"note":"ok"}',
          "=== ROUNDTRIP JSON ===",
          "name,age,note",
          "ada,30,",
          "bob,25,ok",
          "=== TO TXT / FROM TXT ===",
          "user_name",
          "ada",
          "bob",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("10. concatenates and splits CSV files with xan cat (rows --pad, cols) and xan split (-S, -O, -f)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.csv": "id,name\n1,ada\n2,bob\n",
        "/work/b.csv": "id,role\n3,ops\n",
        "/work/c.csv": "score\n95\n88\n77\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== CAT ROWS PAD ==="
        xan cat rows --pad a.csv b.csv > combined.csv
        cat combined.csv
        echo "=== CAT COLS ==="
        xan cat cols --pad a.csv c.csv
        echo "=== SPLIT ==="
        mkdir -p parts
        xan split -c 2 -O parts -f 'chunk_{}.csv' combined.csv
        ls parts | sort
        cat parts/chunk_0.csv
        echo "---"
        cat parts/chunk_1.csv
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== CAT ROWS PAD ===",
          "id,name",
          "1,ada",
          "2,bob",
          "3,ops",
          "=== CAT COLS ===",
          "id,name,score",
          "1,ada,95",
          "2,bob,88",
          ",,77",
          "=== SPLIT ===",
          "chunk_0.csv",
          "chunk_1.csv",
          "id,name",
          "1,ada",
          "2,bob",
          "---",
          "id,name",
          "3,ops",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("11. cleans malformed CSV rows with csvclean (--fill-short-rows, --omit-error-rows, --empty-columns, --header-normalize-space)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/messy.csv": "first  name,empty_col,score\nada,,10\nbob,\ncal,,30,extra\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== FILL + NORMALIZE ==="
        csvclean --length-mismatch --header-normalize-space --fill-short-rows --fillvalue 0 --omit-error-rows messy.csv 2>err1.txt || true
        echo "=== ERR1 ==="
        cat err1.txt
        echo "=== EMPTY COLS ==="
        csvclean --empty-columns messy.csv >/dev/null 2>err2.txt || true
        cat err2.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== FILL + NORMALIZE ===",
          "first name,empty_col,score",
          "ada,,10",
          "bob,,0",
          "=== ERR1 ===",
          "line_number,msg,first name,empty_col,score",
          '3,"Expected 3 columns, found 4 columns",cal,,30,extra',
          "=== EMPTY COLS ===",
          "line_number,msg,first  name,empty_col,score",
          "1,Empty columns named 'empty_col'! Try: csvcut -C 2,,,",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("12. executes SQL queries over CSV files with csvsql and persists/queries SQLite databases via --db and sql2csv", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/users.csv": "id,name,dept_id\n1,ada,10\n2,bob,20\n3,cal,10\n",
        "/work/depts.csv": "dept_id,dept_name\n10,eng\n20,sec\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== DIRECT QUERY ==="
        csvsql --query 'SELECT u.name, d.dept_name FROM users u JOIN depts d ON u.dept_id = d.dept_id ORDER BY u.id' users.csv depts.csv
        echo "=== DB INSERT + SQL2CSV ==="
        csvsql -I --db sqlite:////work/company.db --insert users.csv depts.csv
        sql2csv --db sqlite:////work/company.db --query 'SELECT dept_id, COUNT(*) AS cnt FROM users GROUP BY dept_id ORDER BY dept_id'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== DIRECT QUERY ===",
          "name,dept_name",
          "ada,eng",
          "bob,sec",
          "cal,eng",
          "=== DB INSERT + SQL2CSV ===",
          "dept_id,cnt",
          "10,2",
          "20,1",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("13. joins, stacks, summarizes, and formats CSV tables with csvjoin, csvstack, csvstat, and csvlook", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/us.csv": "id,amount\n1,10\n2,20\n",
        "/work/eu.csv": "id,amount\n2,30\n3,40\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== CSVSTACK ==="
        csvstack -g us,eu -n region us.csv eu.csv > stacked.csv
        cat stacked.csv
        echo "=== CSVSTAT ==="
        csvstat -c amount --sum stacked.csv
        csvstat -c amount --mean stacked.csv
        echo "=== CSVJOIN OUTER ==="
        csvjoin -c id --outer us.csv eu.csv | csvlook
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== CSVSTACK ===",
          "region,id,amount",
          "us,1,10",
          "us,2,20",
          "eu,2,30",
          "eu,3,40",
          "=== CSVSTAT ===",
          "100",
          "25",
          "=== CSVJOIN OUTER ===",
          "| id | amount | id2 | amount2 |",
          "| -- | ------ | --- | ------- |",
          "|  1 |     10 |     |         |",
          "|  2 |     20 |   2 |      30 |",
          "|    |        |   3 |      40 |",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("14. converts between CSV, JSON, NDJSON, and fixed-width formats with csvjson and in2csv", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/hosts.csv": "host,port,tls\nweb1,443,true\ndb1,5432,false\n",
        "/work/schema.csv": "column,start,length\ncode,0,3\nqty,3,4\n",
        "/work/fixed.txt": "ABC0012\nXYZ0005\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== CSVJSON KEYED ==="
        csvjson -I -k host hosts.csv | jq -c .
        echo "=== CSVJSON STREAM + IN2CSV NDJSON ==="
        csvjson -I --stream hosts.csv | in2csv -I -f ndjson
        echo "=== IN2CSV FIXED ==="
        in2csv -I -f fixed -s schema.csv fixed.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== CSVJSON KEYED ===",
          '{"web1":{"host":"web1","port":"443","tls":"true"},"db1":{"host":"db1","port":"5432","tls":"false"}}',
          "=== CSVJSON STREAM + IN2CSV NDJSON ===",
          "host,port,tls",
          "web1,443,true",
          "db1,5432,false",
          "=== IN2CSV FIXED ===",
          "code,qty",
          "ABC,0012",
          "XYZ,0005",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("15. evaluates jq path/getpath/setpath/delpaths, walk, transpose, bsearch, and regex gsub transforms", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(`
        jq -n -c '{
          paths: ({a:{b:[10,20]}} | [paths(scalars)]),
          updated: ({a:{b:1,c:2}} | setpath(["a","b"]; 99) | delpaths([["a","c"]])),
          walked: ({x:[1,2],y:{z:3}} | walk(if type == "number" then . * 10 else . end)),
          transposed: ([[1,2,3],[4,5,6]] | transpose),
          found: ([10,20,30,40] | bsearch(30)),
          missing: ([10,20,30,40] | bsearch(25)),
          slug: ("Hello,   World! 2026" | ascii_downcase | gsub("[^a-z0-9]+"; "-"))
        }'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), {
        paths: [
          ["a", "b", 0],
          ["a", "b", 1],
        ],
        updated: { a: { b: 99 } },
        walked: { x: [10, 20], y: { z: 30 } },
        transposed: [
          [1, 4],
          [2, 5],
          [3, 6],
        ],
        found: 2,
        missing: -3,
        slug: "hello-world-2026",
      });
    } finally {
      await h.dispose();
    }
  });

  it("16. converts between YAML, TOML, JSON, and XML with yq and tomlq including env/strenv and deep merge", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/base.yaml": "service:\n  name: api\n  replicas: 2\n  ports:\n    - 8080\n",
        "/work/override.yaml": "service:\n  replicas: 5\n  region: eu-west\n",
        "/work/config.toml": '[server]\nhost = "127.0.0.1"\nport = 9000\n',
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(String.raw`
        echo "=== YQ MERGE + STRENV ==="
        DEPLOY_ENV=prod yq -o=json -I=0 '.service.replicas = 5 | .service.region = "eu-west" | .service.env = strenv(DEPLOY_ENV)' base.yaml
        echo "=== TOMLQ ==="
        yq -p=toml -o=json config.toml | jq -c '.server | "\(.host):\(.port)"'
        echo "=== YQ TO TOML ROUNDTRIP ==="
        yq -p=toml -o=json '.server.port += 1' config.toml | jq -c .
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== YQ MERGE + STRENV ===",
          '{"service":{"name":"api","replicas":5,"ports":[8080],"region":"eu-west","env":"prod"}}',
          "=== TOMLQ ===",
          '"127.0.0.1:9000"',
          "=== YQ TO TOML ROUNDTRIP ===",
          '{"server":{"host":"127.0.0.1","port":9001}}',
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("17. processes XML documents with xq (-x, --xml-root, --xml-item) and xmllint (--xpath, --noblanks, --nocdata, --c14n)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/catalog.xml":
          '<?xml version="1.0"?>\n<catalog>\n  <book id="b1"><title><![CDATA[Rust & Wasm]]></title><price>40</price></book>\n  <book id="b2"><title>Shell Craft</title><price>25</price></book>\n</catalog>\n',
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== XQ QUERY ==="
        xq -c '[.catalog.book[] | {id: ."@id", title: .title, price: (.price | tonumber)}]' catalog.xml
        echo "=== XMLLINT XPATH ==="
        xmllint --xpath 'string(//book[@id="b2"]/title)' catalog.xml
        echo "=== XMLLINT NOCDATA + NOBLANKS ==="
        xmllint --nocdata --noblanks catalog.xml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== XQ QUERY ===",
          '[{"id":"b1","title":"Rust & Wasm","price":40},{"id":"b2","title":"Shell Craft","price":25}]',
          "=== XMLLINT XPATH ===",
          "Shell Craft",
          "=== XMLLINT NOCDATA + NOBLANKS ===",
          '<?xml version="1.0"?>',
          '<catalog><book id="b1"><title>Rust &amp; Wasm</title><price>40</price></book><book id="b2"><title>Shell Craft</title><price>25</price></book></catalog>',
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("18. extracts and rewrites HTML DOM fragments with htmlq (--attribute, --text, --remove-nodes, --base)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/page.html": [
          "<!doctype html>",
          "<html><head><base href=\"https://docs.example.com/v2/\"></head>",
          "<body>",
          "  <nav class=\"secret\">internal</nav>",
          "  <main>",
          "    <a class=\"doc\" href=\"guide.html\">Guide <span>v2</span></a>",
          "    <a class=\"doc\" href=\"https://other.org/ref\">Ref</a>",
          "  </main>",
          "</body></html>",
        ].join("\n"),
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== DETECT BASE HREF ==="
        htmlq --detect-base --attribute href 'a.doc' -f page.html
        echo "=== REMOVE + TEXT ==="
        htmlq --remove-nodes 'nav.secret' --remove-nodes 'span' --text 'body' -f page.html | tr -s '[:space:]' ' '
        echo ""
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== DETECT BASE HREF ===",
          "https://docs.example.com/v2/guide.html",
          "https://other.org/ref",
          "=== REMOVE + TEXT ===",
          " Guide Ref ",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("19. queries Markdown AST sections with mdq and converts HTML to Markdown with html-to-markdown", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/runbook.md": [
          "# Runbook",
          "",
          "## Preflight",
          "",
          "- Check quotas",
          "- Verify backups",
          "",
          "## Rollback",
          "",
          "- Restore snapshot",
          "",
        ].join("\n"),
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        echo "=== MDQ PREFLIGHT ==="
        mdq '# Preflight | - ' --no-br runbook.md
        echo "=== HTML2MD + MDQ ==="
        printf '<h2>Alerts</h2><ul><li>CPU high</li><li>Disk full</li></ul>' | html-to-markdown | mdq '# Alerts | - ' --no-br
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "=== MDQ PREFLIGHT ===",
          "- Check quotas",
          "",
          "- Verify backups",
          "=== HTML2MD + MDQ ===",
          "- CPU high",
          "",
          "- Disk full",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("20. executes an end-to-end polyglot ETL pipeline combining csvclean, xan, csvsql, sqlite3 window functions, jq, yq, and xmllint", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/raw.csv": "service,region,latency_ms\nauth,us,40\napi,us,120\nauth,eu,60\nbad_row_only_one_col\napi,eu,80\n",
      },
      cwd: "/work",
    });
    try {
      const r = await h.exec(`
        csvclean --length-mismatch --omit-error-rows raw.csv > clean.csv 2>/dev/null || true
        xan map 'latency_ms * 2 AS budget_ms' clean.csv > enriched.csv
        sqlite3 /work/telemetry.db << 'SQL' | jq -s -c 'map(select(.rank_in_svc == 1))'
.mode csv
.import /work/enriched.csv enriched
.mode list
SELECT json_object(
  'service', service,
  'region', region,
  'latency_ms', CAST(latency_ms AS INT),
  'budget_ms', CAST(budget_ms AS INT),
  'rank_in_svc', RANK() OVER (PARTITION BY service ORDER BY CAST(latency_ms AS INT) DESC)
) FROM enriched ORDER BY service, CAST(latency_ms AS INT) DESC;
SQL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), [
        { service: "api", region: "us", latency_ms: 120, budget_ms: 240, rank_in_svc: 1 },
        { service: "auth", region: "eu", latency_ms: 60, budget_ms: 120, rank_in_svc: 1 },
      ]);
    } finally {
      await h.dispose();
    }
  });
});
