import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("jq, yq, xan, and structured query transformation matrix E2E suite", () => {
  it("1. jq recursive descent (.. and recurse), paths, getpath, setpath, delpaths, and del on nested trees", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/tree.json",
        JSON.stringify({
          service: "api",
          meta: { retries: 3, debug: false, secret: "s3cr3t" },
          nodes: [
            { id: "n1", port: 8080, tags: ["edge", "tls"] },
            { id: "n2", port: 8081, tags: ["internal"] },
          ],
        }) + "\n",
      );

      const res = await h.exec(`
jq -c '[.. | numbers]' /workspace/tree.json
jq -c '[paths(scalars)]' /workspace/tree.json
jq -c 'getpath(["nodes", 1, "tags", 0])' /workspace/tree.json
jq -c 'setpath(["meta", "timeout"]; 30) | del(.meta.secret) | delpaths([["nodes", 0, "tags", 1]])' /workspace/tree.json
jq -c '[recurse(.next?; . != null) | .v]' <<< '{"v":1,"next":{"v":2,"next":{"v":3,"next":null}}}'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "[3,8080,8081]",
          '[["service"],["meta","retries"],["meta","secret"],["nodes",0,"id"],["nodes",0,"port"],["nodes",0,"tags",0],["nodes",0,"tags",1],["nodes",1,"id"],["nodes",1,"port"],["nodes",1,"tags",0]]',
          '"internal"',
          '{"service":"api","meta":{"retries":3,"debug":false,"timeout":30},"nodes":[{"id":"n1","port":8080,"tags":["edge"]},{"id":"n2","port":8081,"tags":["internal"]}]}',
          "[1,2,3]",
          "",
        ].join("\n"),
      );
    });
  });

  it("2. jq reduce and foreach with 2-arg and 3-arg forms, running totals, and state extraction", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c 'reduce .[] as $x (0; . + $x)' <<< '[10, 20, 30, 40]'
jq -c 'reduce .[] as $item ({sum: 0, count: 0}; .sum += $item.v | .count += 1)' <<< '[{"v":4},{"v":6},{"v":10}]'
jq -c '[foreach .[] as $x (0; . + $x)]' <<< '[1, 2, 3, 4]'
jq -c '[foreach .[] as $x ({n: 0, sum: 0}; {n: (.n + 1), sum: (.sum + $x)}; {step: .n, avg: (.sum / .n)})]' <<< '[10, 20, 30]'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "100",
          '{"sum":20,"count":3}',
          "[1,3,6,10]",
          '[{"step":1,"avg":10},{"step":2,"avg":15},{"step":3,"avg":20}]',
          "",
        ].join("\n"),
      );
    });
  });

  it("3. jq label/break early termination, try/catch with custom error values, and optional operator (?)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c '[label $out | foreach .[] as $x (0; . + $x; if . > 15 then ., break $out else . end)]' <<< '[5, 6, 7, 8, 9]'
jq -c '[.[] | try (if . < 0 then error({code: "NEG", val: .}) else 100 / . end) catch .]' <<< '[10, -5, 25]'
jq -c '[.[] | .a.b? // "missing"]' <<< '[{"a":{"b":42}},{"a":123},null,{"a":{"b":null}}]'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "[5,11,18]",
          '[10,{"code":"NEG","val":-5},4]',
          '[42,"missing","missing","missing"]',
          "",
        ].join("\n"),
      );
    });
  });

  it("4. jq user-defined functions (def), filter vs value parameters, closures, and -L module imports", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/lib/math_helpers.jq",
        [
          "def square: . * .;",
          "def scale($factor): . * $factor;",
          "def apply_twice(f): f | f;",
          "",
        ].join("\n"),
      );
      await h.writeText(
        "/workspace/lib/stats.jq",
        [
          'import "math_helpers" as mh;',
          "def sum_squares: map(mh::square) | add;",
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
jq -L /workspace/lib -c 'import "math_helpers" as mh; include "stats"; {ss: sum_squares, scaled: map(mh::scale(3)), quad: (2 | mh::apply_twice(mh::square))}' <<< '[1, 2, 3, 4]'
jq -c 'def walk_inc(f): . + 1 | f; 5 | walk_inc(. * 10)' <<< 'null'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"ss":30,"scaled":[3,6,9,12],"quad":16}',
          "60",
          "",
        ].join("\n"),
      );
    });
  });

  it("5. jq destructuring bind (as [$a, $b, {k: $k}]) and alternative destructuring (?//) across heterogeneous records", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c '. as [$first, $second, {meta: {tag: $t}}] | {first: $first, second: $second, tag: $t}' <<< '[10, 20, {"meta":{"tag":"v1"}}]'
jq -c '[.[] | . as {$id, val: [$x, $y]} ?// {$id, val: $x} ?// [$id, $x] | {id: $id, x: $x, y: $y}]' <<< '[{"id":"a","val":[1,2]},{"id":"b","val":99},["c",77]]'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"first":10,"second":20,"tag":"v1"}',
          '[{"id":"a","x":1,"y":2},{"id":"b","x":99,"y":null},{"id":"c","x":77,"y":null}]',
          "",
        ].join("\n"),
      );
    });
  });

  it("6. jq assignment and update operators (=, |=, +=, -=, *=, /=, %=, //=) and array slice assignment", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c '.a += 5 | .b -= 2 | .c *= 3 | .d /= 4 | .e %= 5 | .f //= "fallback" | .g //= "ignored"' <<< '{"a":10,"b":8,"c":7,"d":20,"e":17,"f":null,"g":"kept"}'
jq -c '(.items[] | select(.active) | .score) |= (. * 10)' <<< '{"items":[{"id":1,"active":true,"score":3},{"id":2,"active":false,"score":4},{"id":3,"active":true,"score":5}]}'
jq -c '.[1:4] = ["X", "Y"]' <<< '[0, 1, 2, 3, 4, 5]'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"a":15,"b":6,"c":21,"d":5,"e":2,"f":"fallback","g":"kept"}',
          '{"items":[{"id":1,"active":true,"score":30},{"id":2,"active":false,"score":4},{"id":3,"active":true,"score":50}]}',
          '[0,"X","Y",4,5]',
          "",
        ].join("\n"),
      );
    });
  });

  it("7. jq sort, sort_by, group_by, unique, unique_by, bsearch, min_by, max_by, transpose, and combinations", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c 'group_by(.dept) | map({dept: .[0].dept, total: (map(.pay) | add), top: (max_by(.pay).name), low: (min_by(.pay).name)})' <<< '[{"dept":"eng","name":"ada","pay":120},{"dept":"sales","name":"bob","pay":90},{"dept":"eng","name":"carl","pay":150},{"dept":"sales","name":"dana","pay":110}]'
jq -c '{u: ([3,1,2,1,3,2] | unique), ub: ([{"k":"a","v":1},{"k":"b","v":2},{"k":"a","v":9}] | unique_by(.k))}' <<< 'null'
jq -c '[10, 20, 30, 40, 50] as $arr | [10, 25, 30, 99] | map(. as $x | $arr | bsearch($x))' <<< 'null'
jq -c '{tr: ([[1,2,3],[4,5,6]] | transpose), comb: ([["a","b"],[1,2]] | [combinations])}' <<< 'null'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '[{"dept":"eng","total":270,"top":"carl","low":"ada"},{"dept":"sales","total":200,"top":"dana","low":"bob"}]',
          '{"u":[1,2,3],"ub":[{"k":"a","v":1},{"k":"b","v":2}]}',
          "[0,-3,2,-6]",
          '{"tr":[[1,4],[2,5],[3,6]],"comb":[["a",1],["a",2],["b",1],["b",2]]}',
          "",
        ].join("\n"),
      );
    });
  });

  it("8. jq regex functions (scan, capture, splits, gsub) and string manipulation builtins", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c '[scan("[0-9]+")]' <<< '"order-42-item-99-rev-7"'
jq -c 'capture("^(?<service>[a-z]+)-(?<env>prod|staging)-(?<port>[0-9]+)$")' <<< '"billing-prod-8443"'
jq -c '{sp: [splits("[,; ]+")], gs: gsub("(?<w>[a-z]+)"; "<\\(.w)>")}' <<< '"alpha, beta;gamma"'
jq -c '{sw: startswith("pre_"), ew: endswith("_suf"), trimmed: (ltrimstr("pre_") | rtrimstr("_suf")), up: ascii_upcase, down: ascii_downcase, ulen: ("café" | utf8bytelength), exp: ("Hi!" | explode)}' <<< '"pre_MidVal_suf"'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '["42","99","7"]',
          '{"service":"billing","env":"prod","port":"8443"}',
          '{"sp":["alpha","beta","gamma"],"gs":"<alpha>, <beta>;<gamma>"}',
          '{"sw":true,"ew":true,"trimmed":"MidVal","up":"PRE_MIDVAL_SUF","down":"pre_midval_suf","ulen":5,"exp":[72,105,33]}',
          "",
        ].join("\n"),
      );
    });
  });

  it("9. jq format strings (@base64, @base64d, @uri, @csv, @tsv, @json, @text, @sh, @html) and string interpolation", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(
        [
          String.raw`jq -r '@base64 | . + ":" + (@base64d)' <<< '"safe-bash:2026"'`,
          String.raw`jq -r '@uri' <<< '"a b+c/d?e=1&f=2"'`,
          String.raw`jq -r '@csv' <<< '["alpha,beta", "quote\"here", 42, true, null]'`,
          String.raw`jq -r '@tsv' <<< '["col\t1", "line\n2", 99, false, null]'`,
          String.raw`jq -n -r --arg s '<script>alert("x" & "y")</script>' '$s | @html'`,
          String.raw`jq -r '@sh' <<< '["echo", "it'\''s a test", "a b"]'`,
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "c2FmZS1iYXNoOjIwMjY=:safe-bash:2026",
          "a%20b%2Bc%2Fd%3Fe%3D1%26f%3D2",
          '"alpha,beta","quote""here",42,true,',
          "col\\t1\tline\\n2\t99\tfalse\t",
          "&lt;script&gt;alert(&quot;x&quot; &amp; &quot;y&quot;)&lt;/script&gt;",
          "'echo' 'it'\\''s a test' 'a b'",
          "",
        ].join("\n"),
      );
    });
  });

  it("10. jq ISO-8601 date builtins (fromdateiso8601, todateiso8601) and big decimal preservation", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c '{epoch: ("2026-10-04T12:30:45Z" | fromdateiso8601), iso: (1791117045 | todateiso8601)}' <<< 'null'
jq -c '{id: .big_id, same: (.big_id == 9007199254740993123456789)}' <<< '{"big_id":9007199254740993123456789}'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"epoch":1791117045,"iso":"2026-10-04T12:30:45Z"}',
          '{"id":9007199254740993123456789,"same":true}',
          "",
        ].join("\n"),
      );
    });
  });

  it("11. jq CLI flags (--arg, --argjson, --slurpfile, --rawfile, --args, --jsonargs, $ARGS, -f, -S, -e, -R, -s)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText("/workspace/items.jsonl", '{"k":"b","v":2}\n{"k":"a","v":1}\n');
      await h.writeText("/workspace/banner.txt", "HEADER-LINE\nSECOND-LINE");
      await h.writeText(
        "/workspace/prog.jq",
        "{env: $env, cfg: $cfg, items: $items, raw: $raw, pos: $ARGS.positional, named_env: $ARGS.named.env}",
      );

      const res = await h.exec(`
jq -n -c -S --arg env prod --argjson cfg '{"port":8080}' --slurpfile items /workspace/items.jsonl --rawfile raw /workspace/banner.txt -f /workspace/prog.jq --args first_pos second_pos
jq -n -c --jsonargs '$ARGS.positional' 123 '{"ok":true}' '[1,2]'
jq -e '.ok' <<< '{"ok":false}'
echo "exit_false:$?"
jq -e '.ok' <<< '{"ok":true}' >/dev/null
echo "exit_true:$?"
printf 'line1\nline2\nline3\n' | jq -R -s -c 'split("\n") | map(select(length > 0))'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"cfg":{"port":8080},"env":"prod","items":[{"k":"b","v":2},{"k":"a","v":1}],"named_env":"prod","pos":["first_pos","second_pos"],"raw":"HEADER-LINE\\nSECOND-LINE"}',
          '[123,{"ok":true},[1,2]]',
          "false",
          "exit_false:1",
          "exit_true:0",
          '["line1","line2","line3"]',
          "",
        ].join("\n"),
      );
    });
  });

  it("12. jq --stream, --stream-errors, and --seq (RFC 7464 RS-delimited sequences)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -c --stream '.' <<< '{"a":[10,20],"b":{"c":true}}'
printf '\\x1e{"id":1,"ok":true}\\n\\x1e{"id":2,"ok":false}\\n' | jq -c --seq 'select(.ok) | .id' | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //; s/ $//'
echo ""
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '[["a",0],10]',
          '[["a",1],20]',
          '[["a",1]]',
          '[["b","c"],true]',
          '[["b","c"]]',
          '[["b"]]',
          "1e 31 0a",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. jq numeric and __proto__ key ordering across keys_unsorted, keys, to_entries, from_entries, and with_entries", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
jq -n -c '{"z":1,"10":2,"2":3,"__proto__":4,"a":5} | {ku: keys_unsorted, ks: keys, entries: to_entries}'
jq -n -c '{"10":1,"2":2,"a":3} | with_entries(.key = "p_" + .key | .value += 10)'
jq -c '[{"key":"10","value":1},{"key":"2","value":2},{"key":"__proto__","value":3},{"key":"b","value":4}] | from_entries' <<< 'null'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"ku":["z","10","2","__proto__","a"],"ks":["10","2","__proto__","a","z"],"entries":[{"key":"z","value":1},{"key":"10","value":2},{"key":"2","value":3},{"key":"__proto__","value":4},{"key":"a","value":5}]}',
          '{"p_10":11,"p_2":12,"p_a":13}',
          '{"10":1,"2":2,"__proto__":3,"b":4}',
          "",
        ].join("\n"),
      );
    });
  });

  it("14. yq multi-document YAML framing (--- / ...), anchors/aliases, block scalars, and JSON/raw output modes", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/multi.yaml",
        [
          "---",
          "service:",
          "  name: auth",
          "  db:",
          "    adapter: postgres",
          "    pool: 5",
          "  notes: |",
          "    line one",
          "    line two",
          "...",
          "---",
          "service:",
          "  name: billing",
          "  db:",
          "    adapter: sqlite",
          "    pool: 2",
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
yq -o json -c '{svc: .service.name, adapter: .service.db.adapter, pool: .service.db.pool}' /workspace/multi.yaml
yq -o json -r 'select(.service.name == "auth") | .service.notes' /workspace/multi.yaml
yq '.service.db.pool |= (. * 2) | {name: .service.name, pool: .service.db.pool}' /workspace/multi.yaml
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"svc":"auth","adapter":"postgres","pool":5}',
          '{"svc":"billing","adapter":"sqlite","pool":2}',
          "line one",
          "line two",
          "",
          '"name": "auth"',
          '"pool": 10',
          "---",
          '"name": "billing"',
          '"pool": 4',
          "",
        ].join("\n"),
      );
    });
  });

  it("15. yq TOML input (-p toml) with tables, dotted keys, arrays of tables, inline tables, and YAML/JSON conversion", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
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
          'tokio.version = "1.38"',
          'tokio.optional = true',
          '',
          '[[bin]]',
          'name = "sbash"',
          'path = "src/main.rs"',
          '',
          '[[bin]]',
          'name = "sbash-bench"',
          'path = "src/bench.rs"',
          '',
        ].join("\n"),
      );

      const res = await h.exec(`
yq -p toml -o json -c '{pkg: .package.name, ver: .package.version, bins: [.bin[].name], serde_feat: .dependencies.serde.features, tokio_opt: .dependencies.tokio.optional}' /workspace/Cargo.toml
yq -p toml '.package' /workspace/Cargo.toml
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '{"pkg":"safe-bash-rs","ver":"0.2.0","bins":["sbash","sbash-bench"],"serde_feat":["derive"],"tokio_opt":true}',
          '"name": "safe-bash-rs"',
          '"version": "0.2.0"',
          '"edition": "2024"',
          "",
        ].join("\n"),
      );
    });
  });

  it("16. yq complex filter pipelines transforming structured YAML configuration manifests", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/deploy.yaml",
        [
          "environment: staging",
          "containers:",
          "  - name: gateway",
          "    replicas: 2",
          "    cpu: 500",
          "    enabled: true",
          "  - name: debug-sidecar",
          "    replicas: 1",
          "    cpu: 100",
          "    enabled: false",
          "  - name: worker",
          "    replicas: 4",
          "    cpu: 250",
          "    enabled: true",
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
yq '.containers |= map(select(.enabled) | .replicas += 1) | .environment = "production" | .total_cpu = (reduce .containers[] as $c (0; . + ($c.replicas * $c.cpu)))' /workspace/deploy.yaml
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '"environment": "production"',
          '"containers":',
          '  - "name": "gateway"',
          '    "replicas": 3',
          '    "cpu": 500',
          '    "enabled": true',
          '  - "name": "worker"',
          '    "replicas": 5',
          '    "cpu": 250',
          '    "enabled": true',
          '"total_cpu": 2750',
          "",
        ].join("\n"),
      );
    });
  });

  it("17. xan headers, count, select, and slice with start/end conditions and index/range selectors", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/metrics.csv",
        [
          "id,service,region,latency_ms,status",
          "1,auth,us-east,12,200",
          "2,billing,eu-west,45,200",
          "3,search,us-east,120,503",
          "4,gateway,ap-south,18,200",
          "5,worker,eu-west,85,500",
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
xan headers -j /workspace/metrics.csv
xan count -c /workspace/metrics.csv
xan select 'service,latency_ms,status' /workspace/metrics.csv | xan slice -s 1 -l 3
xan slice -S 'service == "billing"' -E 'status == 503' /workspace/metrics.csv | xan select 'id,service,status'
xan slice -I 3,4 /workspace/metrics.csv | xan select 'id,service'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "id",
          "service",
          "region",
          "latency_ms",
          "status",
          "5",
          "service,latency_ms,status",
          "billing,45,200",
          "search,120,503",
          "gateway,18,200",
          "id,service,status",
          "2,billing,200",
          "id,service",
          "4,gateway",
          "5,worker",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. xan custom delimiters (-d), quoted multiline CSV cells, escaped quotes, and -o output file routing", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/pipes.psv",
        [
          "sku|title|price|notes",
          'A1|"Widget ""Pro"""|19.99|"line 1',
          'line 2"',
          'B2|"Plain|Item"|5.50|"ok"',
          'C3|"Gadget"|42.00|"done"',
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
xan count -d '|' -c /workspace/pipes.psv
xan select -d '|' 'sku,title,price' -o /workspace/selected.csv /workspace/pipes.psv
cat /workspace/selected.csv
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "3",
          "sku,title,price",
          'A1,"Widget ""Pro""",19.99',
          'B2,Plain|Item,5.50',
          "C3,Gadget,42.00",
          "",
        ].join("\n"),
      );
    });
  });

  it("19. csvcut, csvgrep, and csvkit (csvjson, csvsort, csvstat) interoperability with jq", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/orders.csv",
        [
          "order_id,customer,region,amount",
          "103,alice,west,250",
          "101,bob,east,100",
          "104,carol,west,400",
          "102,dave,east,175",
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
csvgrep -c region -m west /workspace/orders.csv | csvcut -c order_id,customer,amount
csvsort -c order_id /workspace/orders.csv | csvjson | jq -c 'map({id: (.order_id + 0), customer: .customer, amt: (.amount + 0)})'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "order_id,customer,amount",
          "103,alice,250",
          "104,carol,400",
          '[{"id":101,"customer":"bob","amt":100},{"id":102,"customer":"dave","amt":175},{"id":103,"customer":"alice","amt":250},{"id":104,"customer":"carol","amt":400}]',
          "",
        ].join("\n"),
      );
    });
  });

  it("20. end-to-end multi-format ETL pipeline joining TOML, YAML, and CSV via yq, xan, csvjson, and jq", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      await h.writeText(
        "/workspace/rates.toml",
        [
          "[tiers]",
          "gold = 0.80",
          "silver = 0.90",
          "standard = 1.00",
          "",
        ].join("\n"),
      );
      await h.writeText(
        "/workspace/customers.yaml",
        [
          "customers:",
          "  - id: c1",
          "    name: Alice",
          "    tier: gold",
          "  - id: c2",
          "    name: Bob",
          "    tier: silver",
          "  - id: c3",
          "    name: Carol",
          "    tier: standard",
          "",
        ].join("\n"),
      );
      await h.writeText(
        "/workspace/invoices.csv",
        [
          "inv_id,cust_id,subtotal,voided",
          "I-1,c1,200,false",
          "I-2,c2,100,false",
          "I-3,c1,50,true",
          "I-4,c3,150,false",
          "I-5,c1,300,false",
          "",
        ].join("\n"),
      );

      const res = await h.exec(`
set -euo pipefail
yq -p toml -o json -c '.tiers' /workspace/rates.toml > /workspace/tiers.json
yq -o json -c '.customers' /workspace/customers.yaml > /workspace/customers.json
xan select 'inv_id,cust_id,subtotal,voided' /workspace/invoices.csv | csvjson > /workspace/invoices.json

jq -n -r \
  --slurpfile tiers /workspace/tiers.json \
  --slurpfile custs /workspace/customers.json \
  --slurpfile invs /workspace/invoices.json '
  ($tiers[0]) as $t |
  ($custs[0] | map({(.id): .}) | add) as $cmap |
  ["customer", "tier", "invoices", "gross", "net"],
  (
    $invs[0]
    | map(select(.voided == false))
    | group_by(.cust_id)
    | map(
        (.[0].cust_id) as $cid |
        ($cmap[$cid]) as $c |
        (map(.subtotal) | add) as $gross |
        [$c.name, $c.tier, length, ($gross + 0), ($gross * $t[$c.tier])]
      )
    | sort_by(.[0])
    | .[]
  )
  | @csv
'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '"customer","tier","invoices","gross","net"',
          '"Alice","gold",2,500,400',
          '"Bob","silver",1,100,90',
          '"Carol","standard",1,150,150',
          "",
        ].join("\n"),
      );
    });
  });
});
