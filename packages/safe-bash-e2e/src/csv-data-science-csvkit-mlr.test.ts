import assert from "node:assert/strict";
import test from "node:test";
import { createRelationalCsvFixture } from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

test("csvcut -n lists column indices and names, and -c / -C selects or excludes columns by name and index", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvcut -n /workspace/data/customers.csv",
      "csvcut -c name,tier /workspace/data/customers.csv | head -n 4",
      "csvcut -C 1,4 /workspace/data/customers.csv | head -n 3",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "  1: customer_id",
        "  2: name",
        "  3: tier",
        "  4: country",
        "name,tier",
        "Alice Vance,enterprise",
        "Bob Tanaka,pro",
        "Clara Oswald,enterprise",
        "name,tier",
        "Alice Vance,enterprise",
        "Bob Tanaka,pro",
        "",
      ].join("\n"),
    );
  });
});

test("csvgrep filters rows by exact match (-m), regex (-r), and inverse match (-i) on named columns", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvgrep -c tier -m enterprise /workspace/data/customers.csv | csvcut -c customer_id,name",
      "csvgrep -c status -r '^completed$' -i /workspace/data/orders.csv | csvcut -c order_id,status",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "customer_id,name",
        "c1,Alice Vance",
        "c3,Clara Oswald",
        "order_id,status",
        "o1004,refunded",
        "o1007,cancelled",
        "",
      ].join("\n"),
    );
  });
});

test("csvsort sorts rows by numeric and string columns in ascending and reverse (-r) order", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvsort -c quantity -r /workspace/data/orders.csv | csvcut -c order_id,quantity | head -n 4",
      "csvsort -c unit_price /workspace/data/products.csv | csvcut -c product_id,unit_price",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "order_id,quantity",
        "o1003,10",
        "o1006,5",
        "o1005,4",
        "product_id,unit_price",
        "p2,45.50",
        "p3,80.00",
        "p1,120.00",
        "p4,450.00",
        "",
      ].join("\n"),
    );
  });
});

test("csvjoin performs inner, left (--left), and outer (--outer) relational joins across CSV files", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvjoin -c customer_id /workspace/data/customers.csv /workspace/data/orders.csv | csvcut -c name,order_id,quantity | head -n 5",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "name,order_id,quantity",
        "Alice Vance,o1001,2",
        "Alice Vance,o1003,10",
        "Bob Tanaka,o1002,3",
        "Bob Tanaka,o1008,1",
        "",
      ].join("\n"),
    );
  });
});

test("csvjson converts CSV rows into keyed JSON object maps (-k) and JSON arrays", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvjson -I -k customer_id /workspace/data/customers.csv | jq -r '.[\"c1\"].name + \":\" + .[\"c5\"].country'",
      "csvjson /workspace/data/customers.csv | jq 'length'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Alice Vance:DE",
        "5",
        "",
      ].join("\n"),
    );
  });
});

test("in2csv converts JSON array and NDJSON streams into normalized CSV tables", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "cat <<'JSON' > /workspace/items.json",
      '[{"sku":"A1","price":10,"in_stock":true},{"sku":"B2","price":25,"in_stock":false}]',
      "JSON",
      "in2csv /workspace/items.json",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "sku,price,in_stock",
        "A1,10,True",
        "B2,25,False",
        "",
      ].join("\n"),
    );
  });
});

test("in2csv -f ndjson parses newline-delimited JSON logs into CSV", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf '{\"id\":1,\"service\":\"auth\",\"ok\":true}\\n{\"id\":2,\"service\":\"api\",\"ok\":false}\\n' | in2csv -f ndjson",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "id,service,ok",
        "1,auth,True",
        "2,api,False",
        "",
      ].join("\n"),
    );
  });
});

test("csvstack stacks multiple CSV files with grouping column (-g / -n)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/q1.csv": "region,rev\nNA,100\nEU,80\n",
        "/workspace/q2.csv": "region,rev\nNA,130\nEU,95\n",
      },
    },
    async (h) => {
      const script =
        "csvstack -g Q1,Q2 -n quarter /workspace/q1.csv /workspace/q2.csv";

      await h.expectOk(
        script,
        [
          "quarter,region,rev",
          "Q1,NA,100",
          "Q1,EU,80",
          "Q2,NA,130",
          "Q2,EU,95",
          "",
        ].join("\n"),
      );
    },
  );
});

test("csvformat customizes output delimiters (-D), tabs (-T), and line terminators (-M)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/simple.csv": "a,b,c\n1,hello world,3\n",
      },
    },
    async (h) => {
      const script = [
        "csvformat -D '|' /workspace/simple.csv",
        "csvformat -T /workspace/simple.csv | tr '\\t' ':'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "a|b|c",
          "1|hello world|3",
          "a:b:c",
          "1:hello world:3",
          "",
        ].join("\n"),
      );
    },
  );
});

test("csvstat computes column summary statistics (--count, --sum, --mean, --min, --max)", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const resCount = await h.exec("csvstat --count /workspace/data/orders.csv");
    assert.equal(resCount.exitCode, 0, resCount.stderr);
    assert.match(resCount.stdout, /8/);

    const resSum = await h.exec("csvstat -c quantity --sum /workspace/data/orders.csv");
    assert.equal(resSum.exitCode, 0, resSum.stderr);
    assert.match(resSum.stdout, /27/);
  });
});

test("csvsql generates CREATE TABLE DDL with inferred SQL column types", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const res = await h.exec("csvsql /workspace/data/products.csv");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /CREATE TABLE products/i);
    assert.match(res.stdout, /product_id/);
    assert.match(res.stdout, /unit_price/);
  });
});

test("csvlook renders Markdown-compatible ASCII tables from CSV pipelines", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const res = await h.exec(
      "csvcut -c customer_id,name,tier /workspace/data/customers.csv | head -n 3 | csvlook",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /Alice Vance/);
    assert.match(res.stdout, /enterprise/);
    assert.match(res.stdout, /\|/);
  });
});

test("csvclean detects and separates malformed row lengths into _out and _err files", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/dirty.csv": [
          "id,name,score",
          "1,Alice,95",
          "2,BrokenRowWithExtraColumn,88,unexpected",
          "3,Charlie,91",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "csvclean --length-mismatch --omit-error-rows /workspace/dirty.csv 2>/workspace/dirty.err",
        "grep -c 'Expected 3 columns, found 4' /workspace/dirty.err",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "id,name,score",
          "1,Alice,95",
          "3,Charlie,91",
          "1",
          "",
        ].join("\n"),
      );
    },
  );
});

test("RFC 4180 edge cases: embedded commas, escaped quotes, and embedded newlines inside CSV cells", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/tricky.csv": [
          "id,note,tag",
          '1,"Hello, ""World""",alpha',
          '2,"Multi\nLine\nNote",beta',
          "3,Plain,gamma",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "csvjson -I /workspace/tricky.csv | jq -r '.[] | \"\\(.id)|\\(.tag)|\\(.note | gsub(\"\\n\"; \"/\"))\"'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          '1|alpha|Hello, "World"',
          "2|beta|Multi/Line/Note",
          "3|gamma|Plain",
          "",
        ].join("\n"),
      );
    },
  );
});

test("TSV input (-t) with csvcut, csvgrep, and csvjson", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/metrics.tsv": [
          "host\tcpu\tmem",
          "web-01\t42\t68",
          "web-02\t89\t91",
          "db-01\t19\t74",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        "csvgrep -t -c host -r '^web-' /workspace/metrics.tsv | csvcut -c host,cpu",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "host,cpu",
          "web-01,42",
          "web-02,89",
          "",
        ].join("\n"),
      );
    },
  );
});

test("csvjoin --left preserves unmatched left rows while filling NULLs for missing right columns", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/left.csv": "id,name\n1,Alice\n2,Bob\n3,Unmatched\n",
        "/workspace/right.csv": "id,role\n1,admin\n2,user\n",
      },
    },
    async (h) => {
      const script = "csvjoin --left -c id /workspace/left.csv /workspace/right.csv | csvcut -c id,name,role";

      await h.expectOk(
        script,
        [
          "id,name,role",
          "1,Alice,admin",
          "2,Bob,user",
          "3,Unmatched,",
          "",
        ].join("\n"),
      );
    },
  );
});

test("csvcut -x deletes empty rows from sparse CSV streams", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/sparse.csv": "a,b\n1,2\n,\n3,4\n",
      },
    },
    async (h) => {
      await h.expectOk(
        "csvcut -x /workspace/sparse.csv",
        ["a,b", "1,2", "3,4", ""].join("\n"),
      );
    },
  );
});

test("three-table relational pipeline: csvjoin customers + orders + products -> csvgrep -> csvsort", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvjoin -c customer_id /workspace/data/orders.csv /workspace/data/customers.csv > /workspace/orders_cust.csv",
      "csvjoin -c product_id /workspace/orders_cust.csv /workspace/data/products.csv > /workspace/full_orders.csv",
      "csvgrep -c status -m completed /workspace/full_orders.csv | csvsort -c order_id | csvcut -c order_id,name,sku,quantity",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "order_id,name,sku,quantity",
        "o1001,Alice Vance,SKU-GPU-04,2",
        "o1002,Bob Tanaka,SKU-CPU-01,3",
        "o1003,Alice Vance,SKU-STR-02,10",
        "o1005,Elena Rostova,SKU-NET-03,4",
        "o1006,Clara Oswald,SKU-CPU-01,5",
        "o1008,Bob Tanaka,SKU-GPU-04,1",
        "",
      ].join("\n"),
    );
  });
});

test("csvjson --stream emits NDJSON and pipes into jq for revenue calculation", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvjoin -c product_id /workspace/data/orders.csv /workspace/data/products.csv | csvgrep -c status -m completed | csvjson --stream | jq -s 'map(.quantity * .unit_price) | add'",
    ].join("\n");

    await h.expectOk(script, "3085\n");
  });
});

test("end-to-end data warehouse pipeline: csvjoin -> csvjson -> sqlite3 -> csvlook report", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvjoin -c customer_id /workspace/data/customers.csv /workspace/data/orders.csv | csvgrep -c status -m completed | csvcut -c country,quantity > /workspace/country_qty.csv",
      "csvjson -I /workspace/country_qty.csv | jq -r 'group_by(.country) | map({country: .[0].country, total_qty: (map(.quantity | tonumber) | add)}) | sort_by(.country) | .[] | \"\\(.country),\\(.total_qty)\"'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "DE,4",
        "JP,4",
        "UK,5",
        "US,12",
        "",
      ].join("\n"),
    );
  });
});
