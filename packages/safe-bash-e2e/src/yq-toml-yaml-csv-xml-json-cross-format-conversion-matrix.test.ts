import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("yq, TOML, YAML, XML, csvkit, and xan cross-format conversion matrix", () => {
  it("1. parses YAML mappings, sequences, and literal/folded block scalars with yq into JSON and YAML", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/service.yaml",
        [
          "service:",
          "  name: payment-api",
          "  ports:",
          "    - 8080",
          "    - 8443",
          "  script: |",
          "    echo start",
          "    echo ready",
          "  summary: >",
          "    folded",
          "    description",
          ""
        ].join("\n")
      );

      const jsonRes = await h.exec("yq -o json -c '.service' /workspace/service.yaml");
      assert.equal(jsonRes.exitCode, 0);
      const parsed = JSON.parse(jsonRes.stdout);
      assert.equal(parsed.name, "payment-api");
      assert.deepEqual(parsed.ports, [8080, 8443]);
      assert.equal(parsed.script, "echo start\necho ready\n");
      assert.equal(parsed.summary, "folded description\n");
    });
  });

  it("2. parses TOML tables, nested tables, inline tables, and arrays of tables with yq -p toml", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/Cargo.toml",
        [
          '[package]',
          'name = "safe-bash-rs"',
          'version = "0.2.0"',
          'edition = "2024"',
          '',
          '[dependencies]',
          'serde = { version = "1.0", features = ["derive"] }',
          '',
          '[[bin]]',
          'name = "sb-cli"',
          'path = "src/main.rs"',
          '',
          '[[bin]]',
          'name = "sb-worker"',
          'path = "src/worker.rs"',
          ''
        ].join("\n")
      );

      const res = await h.exec(
        "yq -p toml -o json -c '{pkg: .package.name, serde_features: .dependencies.serde.features, bins: [.bin[].name]}' /workspace/Cargo.toml"
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(JSON.parse(res.stdout), {
        pkg: "safe-bash-rs",
        serde_features: ["derive"],
        bins: ["sb-cli", "sb-worker"]
      });
    });
  });

  it("3. processes multi-document YAML streams (--- and ...) with yq filter expressions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/k8s.yaml",
        [
          "---",
          "kind: ConfigMap",
          "metadata:",
          "  name: app-config",
          "---",
          "kind: Deployment",
          "metadata:",
          "  name: app-deploy",
          "spec:",
          "  replicas: 3",
          "...",
          ""
        ].join("\n")
      );

      const res = await h.exec("yq -o json -c 'select(.kind == \"Deployment\") | {name: .metadata.name, replicas: .spec.replicas}' /workspace/k8s.yaml");
      assert.equal(res.exitCode, 0);
      assert.deepEqual(JSON.parse(res.stdout), {
        name: "app-deploy",
        replicas: 3
      });
    });
  });

  it("4. parses YAML flow mappings/sequences and enforces restricted profile anchor rejection", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/flow.yaml",
        [
          "matrix: [{id: 1, tags: [a, b]}, {id: 2, tags: [c]}]",
          "nested: {env: prod, flags: [true, false, null]}",
          ""
        ].join("\n")
      );

      const res = await h.exec("yq -o json -c '{tags: [.matrix[].tags[]], env: .nested.env, flags: .nested.flags}' /workspace/flow.yaml");
      assert.equal(res.exitCode, 0);
      assert.deepEqual(JSON.parse(res.stdout), {
        tags: ["a", "b", "c"],
        env: "prod",
        flags: [true, false, null]
      });

      await h.writeText("/workspace/anchors.yaml", "a: &ref {timeout: 30, retries: 3}\nb: *ref\n");
      const resolved = await h.exec("yq -o json -c '.' /workspace/anchors.yaml");
      assert.equal(resolved.exitCode, 0);
      assert.deepEqual(JSON.parse(resolved.stdout), {
        a: { timeout: 30, retries: 3 },
        b: { timeout: 30, retries: 3 }
      });
    });
  });

  it("5. evaluates complex yq transformations (map, select, sort_by, group_by, to_entries, del, |=)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/team.yaml",
        [
          "members:",
          "  - name: Ada",
          "    role: eng",
          "    score: 95",
          "    temp: true",
          "  - name: Grace",
          "    role: eng",
          "    score: 99",
          "    temp: false",
          "  - name: Bob",
          "    role: ops",
          "    score: 88",
          "    temp: true",
          ""
        ].join("\n")
      );

      const res = await h.exec(
        "yq -o json -c '.members | map(del(.temp) | .score |= (. + 1)) | sort_by(.score) | reverse' /workspace/team.yaml"
      );
      assert.equal(res.exitCode, 0);
      assert.deepEqual(JSON.parse(res.stdout), [
        { name: "Grace", role: "eng", score: 100 },
        { name: "Ada", role: "eng", score: 96 },
        { name: "Bob", role: "ops", score: 89 }
      ]);
    });
  });

  it("6. extracts unwrapped scalar values with yq -o json -r for shell scripting", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/settings.toml", 'host = "db.internal"\nport = 5432\n');
      const res = await h.exec(`
HOST=$(yq -p toml -o json -r '.host' /workspace/settings.toml)
PORT=$(yq -p toml -o json -r '.port' /workspace/settings.toml)
printf '%s:%s\\n' "$HOST" "$PORT"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "db.internal:5432\n");
    });
  });

  it("7. converts XML payloads via xq into JSON and formats them as YAML via yq", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/catalog.xml",
        '<catalog><book id="b1"><title>Rust in Action</title><price>45</price></book><book id="b2"><title>Systems Design</title><price>55</price></book></catalog>\n'
      );

      const res = await h.exec(`
xq '.catalog.book | map({id: ."@id", title: .title, price: (.price | tonumber)})' /workspace/catalog.xml | yq -o yaml '.'
`);
      assert.equal(res.exitCode, 0);
      const backToJson = await h.exec(`
xq '.catalog.book | map({id: ."@id", title: .title, price: (.price | tonumber)})' /workspace/catalog.xml | yq -o yaml '.' | yq -o json -c '.'
`);
      assert.equal(backToJson.exitCode, 0);
      assert.deepEqual(JSON.parse(backToJson.stdout), [
        { id: "b1", title: "Rust in Action", price: 45 },
        { id: "b2", title: "Systems Design", price: 55 }
      ]);
    });
  });

  it("8. selects, reorders, and complements CSV columns with csvcut -c, -C, and -n", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/emp.csv",
        "id,name,secret,dept\n1,Ada,s1,Core\n2,Grace,s2,Compiler\n"
      );

      const namesRes = await h.exec("csvcut -n /workspace/emp.csv");
      assert.equal(namesRes.exitCode, 0);
      assert.match(namesRes.stdout, /1: id\n\s*2: name\n\s*3: secret\n\s*4: dept/);

      const cutRes = await h.exec("csvcut -c dept,name /workspace/emp.csv");
      assert.equal(cutRes.exitCode, 0);
      assert.equal(cutRes.stdout.replace(/\r\n/g, "\n"), "dept,name\nCore,Ada\nCompiler,Grace\n");

      const compRes = await h.exec("csvcut -C secret /workspace/emp.csv");
      assert.equal(compRes.exitCode, 0);
      assert.equal(compRes.stdout.replace(/\r\n/g, "\n"), "id,name,dept\n1,Ada,Core\n2,Grace,Compiler\n");
    });
  });

  it("9. filters CSV rows with csvgrep by substring (-m), regex (-r), and inverted match (-i)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/logs.csv",
        "ts,service,status,msg\n1,auth,200,ok\n2,pay,503,timeout\n3,auth,500,crash\n4,web,200,ok\n"
      );

      const errRows = await h.exec("csvgrep -c status -r '^50[0-9]$' /workspace/logs.csv | csvcut -c service,status,msg");
      assert.equal(errRows.exitCode, 0);
      assert.equal(errRows.stdout.replace(/\r\n/g, "\n"), "service,status,msg\npay,503,timeout\nauth,500,crash\n");

      const nonAuth = await h.exec("csvgrep -c service -m auth -i /workspace/logs.csv | csvcut -c ts,service");
      assert.equal(nonAuth.exitCode, 0);
      assert.equal(nonAuth.stdout.replace(/\r\n/g, "\n"), "ts,service\n2,pay\n4,web\n");
    });
  });

  it("10. sorts CSV tables numerically and lexicographically with csvsort -c and -r", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/items.csv",
        "sku,tier,price\nB,gold,20\nA,silver,100\nC,gold,5\n"
      );

      const sorted = await h.exec("csvsort -c price -r /workspace/items.csv");
      assert.equal(sorted.exitCode, 0);
      assert.equal(
        sorted.stdout.replace(/\r\n/g, "\n"),
        "sku,tier,price\nA,silver,100\nB,gold,20\nC,gold,5\n"
      );
    });
  });

  it("11. joins multiple CSV tables with csvjoin inner and --left outer joins", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/users.csv", "uid,name\n1,Ada\n2,Grace\n3,Linus\n");
      await h.writeText("/workspace/roles.csv", "uid,role\n1,admin\n3,maintainer\n");

      const inner = await h.exec("csvjoin -c uid /workspace/users.csv /workspace/roles.csv");
      assert.equal(inner.exitCode, 0);
      assert.equal(
        inner.stdout.replace(/\r\n/g, "\n"),
        "uid,name,role\n1,Ada,admin\n3,Linus,maintainer\n"
      );

      const left = await h.exec("csvjoin --left -c uid /workspace/users.csv /workspace/roles.csv");
      assert.equal(left.exitCode, 0);
      assert.equal(
        left.stdout.replace(/\r\n/g, "\n"),
        "uid,name,role\n1,Ada,admin\n2,Grace,\n3,Linus,maintainer\n"
      );
    });
  });

  it("12. computes column summary statistics with csvstat (--count, --sum, --min, --max)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/metrics.csv", "host,latency\nh1,10\nh2,20\nh3,30\nh4,40\n");

      const countRes = await h.exec("csvstat --count /workspace/metrics.csv");
      assert.equal(countRes.exitCode, 0);
      assert.match(countRes.stdout, /4/);

      const sumRes = await h.exec("csvstat -c latency --sum /workspace/metrics.csv");
      assert.equal(sumRes.exitCode, 0);
      assert.match(sumRes.stdout, /100/);
    });
  });

  it("13. converts CSV to JSON/keyed-JSON with csvjson and JSON/NDJSON back to CSV with in2csv", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/hosts.csv", "id,ip,active\nweb1,10.0.0.1,true\nweb2,10.0.0.2,false\n");

      const keyedJson = await h.exec("csvjson -k id /workspace/hosts.csv");
      assert.equal(keyedJson.exitCode, 0);
      const parsed = JSON.parse(keyedJson.stdout);
      assert.equal(parsed.web1.ip, "10.0.0.1");
      assert.equal(parsed.web2.active, false);

      await h.writeText(
        "/workspace/events.ndjson",
        '{"id":1,"kind":"click"}\n{"id":2,"kind":"submit"}\n'
      );
      const backToCsv = await h.exec("in2csv -f ndjson /workspace/events.ndjson");
      assert.equal(backToCsv.exitCode, 0);
      assert.equal(backToCsv.stdout.replace(/\r\n/g, "\n"), "id,kind\n1,click\n2,submit\n");
    });
  });

  it("14. reformats CSV delimiters and quoting with csvformat (-D, -T) and stacks files with csvstack", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/us.csv", "id,amount\n1,100\n");
      await h.writeText("/workspace/eu.csv", "id,amount\n2,200\n");

      const stacked = await h.exec(
        "csvstack -g US,EU -n region /workspace/us.csv /workspace/eu.csv | csvformat -D '|'"
      );
      assert.equal(stacked.exitCode, 0);
      assert.equal(
        stacked.stdout.replace(/\r\n/g, "\n"),
        "region|id|amount\nUS|1|100\nEU|2|200\n"
      );
    });
  });

  it("15. renders ASCII tables with csvlook and generates CREATE TABLE DDL with csvsql", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/products.csv", "id,title,in_stock\n1,Keyboard,true\n2,Monitor,false\n");

      const lookRes = await h.exec("csvlook /workspace/products.csv");
      assert.equal(lookRes.exitCode, 0);
      assert.match(lookRes.stdout, /Keyboard/);
      assert.match(lookRes.stdout, /Monitor/);

      const sqlRes = await h.exec("csvsql -i sqlite --tables items /workspace/products.csv");
      assert.equal(sqlRes.exitCode, 0);
      assert.match(sqlRes.stdout, /CREATE TABLE items/i);
    });
  });

  it("16. inspects CSV/TSV/PSV headers and row counts with xan headers and xan count", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/data.psv", "id|user|score\n1|ada|95\n2|grace|98\n3|linus|91\n");

      const hdrs = await h.exec("xan headers -j /workspace/data.psv");
      assert.equal(hdrs.exitCode, 0);
      assert.equal(hdrs.stdout, "id\nuser\nscore\n");

      const cnt = await h.exec("xan count -c /workspace/data.psv");
      assert.equal(cnt.exitCode, 0);
      assert.equal(cnt.stdout, "3\n");
    });
  });

  it("17. projects column ranges, globs, reversed ranges, and complements with xan select", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/wide.csv",
        "id,meta_env,meta_region,secret_token,score\n1,prod,us,tok1,90\n2,stage,eu,tok2,85\n"
      );

      const globSelect = await h.exec("xan select 'id,meta_*,score' /workspace/wide.csv");
      assert.equal(globSelect.exitCode, 0);
      assert.equal(
        globSelect.stdout,
        "id,meta_env,meta_region,score\n1,prod,us,90\n2,stage,eu,85\n"
      );

      const compSelect = await h.exec("xan select '!secret_*' /workspace/wide.csv");
      assert.equal(compSelect.exitCode, 0);
      assert.equal(
        compSelect.stdout,
        "id,meta_env,meta_region,score\n1,prod,us,90\n2,stage,eu,85\n"
      );

      const revRange = await h.exec("xan select 'meta_region:id' /workspace/wide.csv");
      assert.equal(revRange.exitCode, 0);
      assert.equal(revRange.stdout, "meta_region,meta_env,id\nus,prod,1\neu,stage,2\n");
    });
  });

  it("18. slices CSV rows with xan slice using --start, --len, --last, --indices, and Moonblade conditions", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/seq.csv",
        "step,phase,val\n1,init,10\n2,warmup,20\n3,steady,30\n4,steady,40\n5,cooldown,50\n"
      );

      const condSlice = await h.exec(
        `xan slice -S 'phase == "warmup"' -E 'phase == "cooldown"' /workspace/seq.csv`
      );
      assert.equal(condSlice.exitCode, 0);
      assert.equal(
        condSlice.stdout,
        "step,phase,val\n2,warmup,20\n3,steady,30\n4,steady,40\n"
      );

      const rangeSlice = await h.exec("xan slice -s 1 -l 2 /workspace/seq.csv");
      assert.equal(rangeSlice.exitCode, 0);
      assert.equal(rangeSlice.stdout, "step,phase,val\n2,warmup,20\n3,steady,30\n");

      const idxSlice = await h.exec("xan slice -I 0,4 /workspace/seq.csv");
      assert.equal(idxSlice.exitCode, 0);
      assert.equal(idxSlice.stdout, "step,phase,val\n1,init,10\n5,cooldown,50\n");
    });
  });

  it("19. converts TOML + YAML configs into merged YAML and JSON artifacts using yq and jq", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/base.toml",
        '[server]\nhost = "0.0.0.0"\nport = 8080\n[limits]\nmax_conns = 100\n'
      );
      await h.writeText(
        "/workspace/override.yaml",
        "server:\n  port: 9090\n  tls: true\nlimits:\n  max_conns: 500\n"
      );

      const res = await h.exec(`
yq -p toml -o json '.' /workspace/base.toml > /workspace/base.json
yq -o json '.' /workspace/override.yaml > /workspace/override.json
jq -s '.[0] * .[1]' /workspace/base.json /workspace/override.json | yq -o yaml '.' > /workspace/merged.yaml
yq -o json -c '.' /workspace/merged.yaml
`);
      assert.equal(res.exitCode, 0);
      assert.deepEqual(JSON.parse(res.stdout), {
        server: { host: "0.0.0.0", port: 9090, tls: true },
        limits: { max_conns: 500 }
      });
    });
  });

  it("20. executes an end-to-end polyglot pipeline combining TOML, YAML, XML, CSV (xan/csvkit), jq, and sqlite3", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/thresholds.toml",
        '[sla]\nmax_latency_ms = 100\n'
      );
      await h.writeText(
        "/workspace/services.yaml",
        [
          "services:",
          "  - id: svc-auth",
          "    owner: core",
          "  - id: svc-pay",
          "    owner: fintech",
          ""
        ].join("\n")
      );
      await h.writeText(
        "/workspace/telemetry.csv",
        "id,p95_ms,secret_key\nsvc-auth,45,k1\nsvc-pay,180,k2\n"
      );

      const pipeline = await h.exec(`
MAX_LAT=$(yq -p toml -o json -r '.sla.max_latency_ms' /workspace/thresholds.toml)
xan select '!secret_*' /workspace/telemetry.csv > /workspace/clean_telemetry.csv
yq -o json '.services' /workspace/services.yaml | in2csv -f json > /workspace/services.csv
csvjoin -c id /workspace/services.csv /workspace/clean_telemetry.csv > /workspace/joined.csv

sqlite3 /workspace/report.db <<SQL
.mode csv
.import /workspace/joined.csv service_health
SELECT id, owner, p95_ms
FROM service_health
WHERE CAST(p95_ms AS INTEGER) > $MAX_LAT;
SQL
`);
      assert.equal(pipeline.exitCode, 0);
      assert.equal(pipeline.stdout.trim(), "svc-pay,fintech,180");
    });
  });
});
