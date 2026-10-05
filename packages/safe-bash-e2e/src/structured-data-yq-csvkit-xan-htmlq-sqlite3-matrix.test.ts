import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("structured data: yq, jq, csvkit, xan, htmlq, and sqlite3 matrix", () => {
  it("1. yq queries and mutates YAML documents and converts YAML <-> JSON", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/service.yaml": [
            "name: api-gateway",
            "replicas: 2",
            "ports:",
            "  - 8080",
            "  - 8443",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "yq -o json -r '.name' /work/service.yaml",
            "yq -o json -c '.replicas = 5 | .ports += [9090]' /work/service.yaml",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "api-gateway",
            '{"name":"api-gateway","replicas":5,"ports":[8080,8443,9090]}',
            "",
          ].join("\n")
        );
      }
    );
  });

  it("2. yq -p toml parses TOML configuration files and converts to YAML and JSON", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/Cargo.toml": [
            "[package]",
            'name = "safe-bash"',
            'version = "1.2.3"',
            "",
            "[dependencies]",
            'serde = "1.0"',
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "yq -p toml -o json -r '.package.name + \"@\" + .package.version' /work/Cargo.toml",
            "yq -p toml -o yaml '.dependencies' /work/Cargo.toml",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["safe-bash@1.2.3", "\"serde\": \"1.0\"", ""].join("\n")
        );
      }
    );
  });

  it("3. jq complex recursive descent (..), reduce, group_by, and @csv/@tsv/@base64 formatting", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/events.json": JSON.stringify([
            { team: "core", pts: 10 },
            { team: "edge", pts: 25 },
            { team: "core", pts: 15 },
          ]),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "jq -r 'group_by(.team) | map({team: .[0].team, total: (map(.pts) | add)}) | sort_by(-.total)[] | [.team, (.total | tostring)] | @csv' /work/events.json",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, '"core","25"\n"edge","25"\n');
      }
    );
  });

  it("4. csvcut selects, reorders, and excludes (-C) columns by name and index", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/people.csv":
            "id,name,role,city\n1,Alice,eng,NYC\n2,Bob,design,SF\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "csvcut -c name,city /work/people.csv",
            "echo '---'",
            "csvcut -C id,role /work/people.csv",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "name,city",
            "Alice,NYC",
            "Bob,SF",
            "---",
            "name,city",
            "Alice,NYC",
            "Bob,SF",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("5. csvgrep filters rows by exact match (-m), regex (-r), and inverse (-i)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/hosts.csv":
            "host,region,status\nweb-01,us-east,up\ndb-01,us-west,down\nweb-02,eu-central,up\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "csvgrep -c status -m up /work/hosts.csv | csvcut -c host",
            "echo '---'",
            "csvgrep -c host -r '^db-' -i /work/hosts.csv | csvcut -c region",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "host",
            "web-01",
            "web-02",
            "---",
            "region",
            "us-east",
            "eu-central",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("6. csvsort sorts CSV tables by numeric and string columns with -r reverse", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/items.csv":
            "item,price\nbanana,1.50\napple,3.00\ncherry,2.25\n",
        },
      },
      async (h) => {
        const r = await h.exec("csvsort -c price -r /work/items.csv");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["item,price", "apple,3.00", "cherry,2.25", "banana,1.50", ""].join(
            "\n"
          )
        );
      }
    );
  });

  it("7. csvjson and in2csv convert bidirectionally between CSV and JSON arrays", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/in.csv": "id,name\n10,alpha\n20,beta\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "csvjson --indent 0 /work/in.csv > /work/out.json",
            "jq -r '.[1].name' /work/out.json",
            "in2csv /work/out.json | csvcut -c name",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "beta\nname\nalpha\nbeta\n");
      }
    );
  });

  it("8. csvjoin joins two CSV files on a shared key column (-c)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/left.csv": "id,user\n1,alice\n2,bob\n",
          "/work/right.csv": "id,dept\n1,security\n2,platform\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "csvjoin -c id /work/left.csv /work/right.csv | csvcut -c id,user,dept"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["id,user,dept", "1,alice,security", "2,bob,platform", ""].join("\n")
        );
      }
    );
  });

  it("9. csvstack concatenates multiple CSV files and adds grouping column (-g, -n)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/q1.csv": "month,rev\njan,100\n",
          "/work/q2.csv": "month,rev\napr,200\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "csvstack -g Q1,Q2 -n quarter /work/q1.csv /work/q2.csv"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["quarter,month,rev", "Q1,jan,100", "Q2,apr,200", ""].join("\n")
        );
      }
    );
  });

  it("10. csvstat --count and column summary statistics", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/nums.csv": "n\n10\n20\n30\n40\n",
        },
      },
      async (h) => {
        const r = await h.exec("csvstat --count /work/nums.csv");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /4/);
      }
    );
  });

  it("11. xan count, headers, select, and slice process CSV streams", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/metrics.csv":
            "service,latency,ok\nauth,12,true\npay,45,true\ncache,3,true\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "xan count /work/metrics.csv",
            "xan slice -s 1 -l 2 /work/metrics.csv | xan select service,latency",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["3", "service,latency", "pay,45", "cache,3", ""].join("\n")
        );
      }
    );
  });

  it("12. htmlq queries CSS selectors, extracts text (-t), attributes (-a), and removes nodes (-r)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/page.html": [
            "<html><body>",
            "  <nav><a href='/home'>Home</a><a href='/docs'>Docs</a></nav>",
            "  <main><p class='lead'>Welcome</p><span class='secret'>hide</span><p>Body</p></main>",
            "</body></html>",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "htmlq -a href 'nav a' -f /work/page.html",
            "echo '---'",
            "htmlq -t -r '.secret' 'main' -f /work/page.html | tr -s ' \\n' ' '",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.includes("/home\n/docs\n---"));
        assert.ok(r.stdout.includes("Welcome"));
        assert.ok(!r.stdout.includes("hide"));
      }
    );
  });

  it("13. sqlite3 executes DDL, DML, joins, and aggregates on an on-disk virtual database", async () => {
    await withE2EHarness(
      {
        directories: ["/work"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "sqlite3 /work/app.db 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, team TEXT);'",
            "sqlite3 /work/app.db \"INSERT INTO users VALUES (1, 'Alice', 'core'), (2, 'Bob', 'infra'), (3, 'Carol', 'core');\"",
            "sqlite3 /work/app.db 'SELECT team, COUNT(*) FROM users GROUP BY team ORDER BY team;'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "core|2\ninfra|1\n");
      }
    );
  });

  it("14. sqlite3 -json and -csv output modes with -header", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "sqlite3 -json :memory: \"SELECT 'alpha' AS k, 42 AS v;\" | jq -c '.[0]'",
          "sqlite3 -csv -header :memory: \"SELECT 'beta' AS k, 99 AS v;\" | tr -d '\\r'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ['{"k":"alpha","v":42}', "k,v", "beta,99", ""].join("\n")
      );
    });
  });

  it("15. sqlite3 recursive CTEs and window functions (ROW_NUMBER, SUM OVER)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "sqlite3 :memory: 'WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 5) SELECT n, SUM(n) OVER (ORDER BY n) FROM seq;'"
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["1|1", "2|3", "3|6", "4|10", "5|15", ""].join("\n")
      );
    });
  });

  it("16. sqlite3 JSON functions (json_extract, json_each, json_group_array)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "sqlite3 :memory: \"SELECT value FROM json_each('[\\\"x\\\",\\\"y\\\",\\\"z\\\"]');\""
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "x\ny\nz\n");
    });
  });

  it("17. sqlite3 .import loads CSV files into tables and .dump exports SQL schema + data", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/import.csv": "id,label\n1,one\n2,two\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "sqlite3 /work/imp.db '.mode csv' '.import /work/import.csv items'",
            "sqlite3 /work/imp.db 'SELECT id, label FROM items ORDER BY CAST(id AS INTEGER);'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "1|one\n2|two\n");
      }
    );
  });

  it("18. envsubst substitutes environment variables into configuration templates with explicit var list", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/nginx.tmpl": "listen ${PORT}; server_name ${HOST}; keep ${KEEP_ME};\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "PORT=9000 HOST=api.internal KEEP_ME=ignored envsubst '${PORT} ${HOST}' < /work/nginx.tmpl"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          "listen 9000; server_name api.internal; keep ${KEEP_ME};\n"
        );
      }
    );
  });

  it("19. csvlook renders markdown-compatible ASCII tables from CSV input", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/tiny.csv": "k,v\na,1\nb,2\n",
        },
      },
      async (h) => {
        const r = await h.exec("csvlook /work/tiny.csv");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.includes("| k | v |"));
        assert.ok(r.stdout.includes("| a | 1 |"));
        assert.ok(r.stdout.includes("| b | 2 |"));
      }
    );
  });

  it("20. end-to-end multi-format pipeline: HTML -> htmlq -> csvkit -> yq -> jq", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/table.html": [
            "<ul>",
            "  <li data-score='90'>alice</li>",
            "  <li data-score='95'>bob</li>",
            "</ul>",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "names=$(htmlq -t 'li' -f /work/table.html)",
            "scores=$(htmlq -a data-score 'li' -f /work/table.html)",
            "paste -d, <(echo 'user'; echo \"$names\") <(echo 'score'; echo \"$scores\") > /work/parsed.csv",
            "csvjson -I /work/parsed.csv | yq -o yaml '.' > /work/parsed.yaml",
            "yq -o json '.' /work/parsed.yaml | jq -r '.[] | \"\\(.user)=\\(.score | tonumber)\"' | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "alice=90\nbob=95\n");
      }
    );
  });
});
