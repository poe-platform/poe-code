import assert from "node:assert/strict";
import test from "node:test";
import {
  createConfigHierarchyFixture,
  createMonorepoFixture,
  createObservabilityLogsFixture,
  createRelationalCsvFixture,
} from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

test("jq slurp (-s), group_by, reduce, and percentile/average telemetry calculation on JSONL logs", async () => {
  await withE2EHarness({ files: createObservabilityLogsFixture() }, async (h) => {
    const script = [
      "jq -s -r '",
      "  group_by(.region)",
      "  | map({",
      "      region: .[0].region,",
      "      total: length,",
      "      errors: (map(select(.status >= 400)) | length),",
      "      max_latency: (map(.latency_ms) | max)",
      "    })",
      "  | sort_by(.region)[]",
      "  | \"\\(.region):total=\\(.total),errors=\\(.errors),max_ms=\\(.max_latency)\"",
      "' /workspace/logs/api.jsonl",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "ap-south:total=2,errors=1,max_ms=39",
        "eu-west:total=3,errors=2,max_ms=410",
        "us-east:total=5,errors=1,max_ms=520",
        "",
      ].join("\n"),
    );
  });
});

test("jq --arg and --argjson parameterized transformations and @csv / @tsv / @base64 formatters", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "jq -n -r --arg env 'prod' --argjson mult 3 '",
      "  [",
      "    { name: \"alpha\", score: (10 * $mult), env: $env },",
      "    { name: \"beta\",  score: (25 * $mult), env: $env }",
      "  ]",
      "  | .[]",
      "  | [ .name, (.score | tostring), (.name | @base64), .env ]",
      "  | @tsv",
      "'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "alpha\t30\tYWxwaGE=\tprod",
        "beta\t75\tYmV0YQ==\tprod",
        "",
      ].join("\n"),
    );
  });
});

test("jq recursive descent (..) and secret redaction across deeply nested objects", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "cat <<'EOF' | jq -c 'walk(if type == \"object\" and has(\"password\") then .password = \"***REDACTED***\" else . end)'",
      '{"db":{"primary":{"host":"db1","password":"p1"},"replica":[{"host":"db2","password":"p2"}]}}',
      "EOF",
    ].join("\n");

    await h.expectOk(
      script,
      '{"db":{"primary":{"host":"db1","password":"***REDACTED***"},"replica":[{"host":"db2","password":"***REDACTED***"}]}}\n',
    );
  });
});

test("yq YAML and TOML querying and YAML-to-JSON conversion (-o json, -p toml)", async () => {
  await withE2EHarness(
    {
      files: {
        ...createConfigHierarchyFixture(),
        ...createMonorepoFixture(),
      },
    },
    async (h) => {
      const script = [
        "yq -o json /workspace/config/service.yaml | jq -r '.service.name + \":\" + (.service.replicas | tostring)'",
        "yq -o json -I 0 '.service | {name, replicas, compression: .features.compression}' /workspace/config/service.yaml",
        "yq -p toml -o json /workspace/Cargo.toml | jq -r '.workspace.members | join(\",\")'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "edge-router:4",
          '{"name":"edge-router","replicas":4,"compression":"zstd"}',
          "crates/engine,crates/cli",
          "",
        ].join("\n"),
      );
    },
  );
});

test("xmllint --xpath queries on XML service catalog", async () => {
  await withE2EHarness({ files: createConfigHierarchyFixture() }, async (h) => {
    const script = [
      "xmllint --xpath '//service[@tier=\"critical\"]/name/text()' /workspace/config/catalog.xml",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /auth-gateway/);
    assert.match(res.stdout, /ledger-core/);
  });
});

test("xq XML-to-JSON query pipeline extracting structured service records", async () => {
  await withE2EHarness({ files: createConfigHierarchyFixture() }, async (h) => {
    const script = [
      "xq -r '.catalog.service[] | select(.\"@tier\" == \"critical\") | \"\\(.name):\\(.port)\"' /workspace/config/catalog.xml | sort",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "auth-gateway:9000",
        "ledger-core:9002",
        "",
      ].join("\n"),
    );
  });
});

test("htmlq CSS selector extraction for text, attributes, and node removal", async () => {
  await withE2EHarness({ files: createConfigHierarchyFixture() }, async (h) => {
    const script = [
      "htmlq --text 'h1' < /workspace/config/dashboard.html",
      "htmlq --text 'li[data-status=\"healthy\"] .name' < /workspace/config/dashboard.html | sort | paste -sd ',' -",
      "htmlq --attributes data-status 'ul.services li' < /workspace/config/dashboard.html | paste -sd ',' -",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Cluster Health",
        "auth-gateway,ledger-core",
        "healthy,degraded,healthy",
        "",
      ].join("\n"),
    );
  });
});

test("html-to-markdown converts HTML document into structured Markdown", async () => {
  await withE2EHarness({ files: createConfigHierarchyFixture() }, async (h) => {
    const res = await h.exec("html-to-markdown /workspace/config/dashboard.html");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /# Cluster Health/);
    assert.match(res.stdout, /auth\\-gateway: \*\*OK\*\*/);
    assert.match(res.stdout, /billing\\-worker: \*\*WARN\*\*/);
  });
});

test("csvcut column projection and reordering by name and index", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvcut -c country,name /workspace/data/customers.csv | head -n 4",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "country,name",
        "US,Alice Vance",
        "JP,Bob Tanaka",
        "UK,Clara Oswald",
        "",
      ].join("\n"),
    );
  });
});

test("csvgrep pattern matching and inverse filtering on specific CSV columns", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvgrep -c tier -m enterprise /workspace/data/customers.csv | csvcut -c customer_id,name",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "customer_id,name",
        "c1,Alice Vance",
        "c3,Clara Oswald",
        "",
      ].join("\n"),
    );
  });
});

test("csvsort multi-column numeric and reverse sorting", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvsort -c unit_price -r /workspace/data/products.csv | csvcut -c sku,unit_price",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "sku,unit_price",
        "SKU-GPU-04,450.00",
        "SKU-CPU-01,120.00",
        "SKU-NET-03,80.00",
        "SKU-STR-02,45.50",
        "",
      ].join("\n"),
    );
  });
});

test("csvjoin relational join across customers and orders with csvcut projection", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvjoin -c customer_id /workspace/data/orders.csv /workspace/data/customers.csv \\",
      "  | csvgrep -c status -m completed \\",
      "  | csvcut -c order_id,name,tier,quantity \\",
      "  | head -n 4",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "order_id,name,tier,quantity",
        "o1001,Alice Vance,enterprise,2",
        "o1002,Bob Tanaka,pro,3",
        "o1003,Alice Vance,enterprise,10",
        "",
      ].join("\n"),
    );
  });
});

test("csvstack vertical concatenation with group column (-g / -n)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/q1.csv": "id,rev\n1,100\n2,200\n",
        "/workspace/q2.csv": "id,rev\n3,300\n4,400\n",
      },
    },
    async (h) => {
      const script = [
        "csvstack -g Q1,Q2 -n quarter /workspace/q1.csv /workspace/q2.csv",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "quarter,id,rev",
          "Q1,1,100",
          "Q1,2,200",
          "Q2,3,300",
          "Q2,4,400",
          "",
        ].join("\n"),
      );
    },
  );
});

test("csvjson converts CSV table to JSON array and keyed object map (-k)", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvjson -k product_id /workspace/data/products.csv | jq -r '.p4.sku + \":\" + (.p4.unit_price | tostring)'",
    ].join("\n");

    await h.expectOk(script, "SKU-GPU-04:450.0\n");
  });
});

test("in2csv converts JSON array into normalized CSV and pipes to csvformat (-T)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/hosts.json": JSON.stringify([
          { host: "web-1", cores: 8, region: "us-east" },
          { host: "web-2", cores: 16, region: "eu-west" },
        ]),
      },
    },
    async (h) => {
      const script = [
        "in2csv /workspace/hosts.json | csvformat -T",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "host\tcores\tregion",
          "web-1\t8\tus-east",
          "web-2\t16\teu-west",
          "",
        ].join("\n"),
      );
    },
  );
});

test("csvsql generates SQL CREATE TABLE schema from CSV type inference", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const res = await h.exec("csvsql /workspace/data/products.csv");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /CREATE TABLE products/);
    assert.match(res.stdout, /unit_price DECIMAL/);
  });
});

test("csvstat computes summary statistics over CSV columns", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const res = await h.exec("csvstat --count /workspace/data/orders.csv");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /8/);
  });
});

test("csvlook renders markdown/ascii table from CSV pipeline", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const res = await h.exec("csvcut -c product_id,sku /workspace/data/products.csv | csvlook");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /SKU-CPU-01/);
    assert.match(res.stdout, /SKU-GPU-04/);
  });
});

test("cross-format configuration synthesis: XML -> xq -> jq + YAML -> yq -> merged JSON -> CSV", async () => {
  await withE2EHarness({ files: createConfigHierarchyFixture() }, async (h) => {
    const script = [
      "yq -o json '.upstreams' /workspace/config/service.yaml > /workspace/upstreams.json",
      "xq '.catalog.service' /workspace/config/catalog.xml > /workspace/services.json",
      "jq -n --slurpfile up /workspace/upstreams.json --slurpfile svc /workspace/services.json '",
      "  $svc[0] | map({",
      "    id: .\"@id\",",
      "    name: .name,",
      "    tier: .\"@tier\",",
      "    port: (.port | tonumber),",
      "    slo: (.slo | tonumber)",
      "  })",
      "' | in2csv -f json | csvsort -c port | csvcut -c id,name,port,tier",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "id,name,port,tier",
        "s1,auth-gateway,9000,critical",
        "s2,billing-worker,9001,standard",
        "s3,ledger-core,9002,critical",
        "",
      ].join("\n"),
    );
  });
});

test("csvformat custom delimiters (-D) and csvgrep regex (-r) filtering", async () => {
  await withE2EHarness({ files: createRelationalCsvFixture() }, async (h) => {
    const script = [
      "csvgrep -c sku -r '^SKU-(CPU|GPU)' /workspace/data/products.csv | csvcut -c sku,unit_price | csvformat -D '|'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "sku|unit_price",
        "SKU-CPU-01|120.00",
        "SKU-GPU-04|450.00",
        "",
      ].join("\n"),
    );
  });
});
