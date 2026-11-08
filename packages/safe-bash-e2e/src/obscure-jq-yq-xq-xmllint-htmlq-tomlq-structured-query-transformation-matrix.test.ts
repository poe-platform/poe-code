import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jq, yq, xq, xmllint & htmlq structured query and cross-format transformation matrix", () => {
  it("01: aggregates categorized records using jq reduce with default fallback (//)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'JSON' | jq -c 'reduce .[] as $r ({}; .[$r.cat] = ((.[$r.cat] // 0) + $r.amt))'",
          '[{"cat":"compute","amt":120},{"cat":"storage","amt":45},{"cat":"compute","amt":80},{"cat":"net","amt":30}]',
          "JSON",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"compute":200,"storage":45,"net":30}\n');
    });
  });

  it("02: recursively prunes null and empty-string object entries using jq walk and with_entries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'cat << \'JSON\' | jq -c \'walk(if type == "object" then with_entries(select(.value != null and .value != "")) else . end)\'',
          '{"a":1,"b":null,"c":{"d":"","e":"keep","f":null},"g":[{"x":null,"y":2}]}',
          "JSON",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"a":1,"c":{"e":"keep"},"g":[{"y":2}]}\n');
    });
  });

  it("03: flattens nested JSON via paths(scalars)/getpath and mutates deep keys via setpath/delpaths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'cat << \'JSON\' | jq -c \'[paths(scalars) as $p | {k: ($p | map(tostring) | join(".")), v: getpath($p)}]\'',
          '{"db":{"host":"localhost","port":5432},"debug":true}',
          "JSON",
          'echo \'{"a":{"b":1,"c":2}}\' | jq -c \'setpath(["a","b"]; 99) | delpaths([["a","c"]])\'',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"k":"db.host","v":"localhost"},{"k":"db.port","v":5432},{"k":"debug","v":true}]\n{"a":{"b":99}}\n',
      );
    });
  });

  it("04: round-trips strings and arrays through jq @base64/@base64d, @uri/@urid, @csv, and @tsv", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'echo \'{"msg":"hello world","q":"a b&c","row":["x","y,z",10]}\' | jq -r \'[(.msg | @base64 | @base64d), (.q | @uri | @urid), (.row | @csv), (.row | @tsv)] | join("|")\'',
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, 'hello world|a b&c|"x","y,z",10|x\ty,z\t10\n');
    });
  });

  it("05: groups records by region with group_by/unique_by and transposes nested matrices", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'JSON' | jq -c 'group_by(.reg) | map({reg: .[0].reg, max_ms: (map(.ms) | max), hosts: (unique_by(.host) | length)})'",
          '[{"reg":"eu","host":"h1","ms":40},{"reg":"us","host":"u1","ms":90},{"reg":"eu","host":"h1","ms":75},{"reg":"eu","host":"h2","ms":60}]',
          "JSON",
          'echo \'[[1,2,3],["a","b","c"]]\' | jq -c \'transpose\'',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"reg":"eu","max_ms":75,"hosts":2},{"reg":"us","max_ms":90,"hosts":1}]\n[[1,"a"],[2,"b"],[3,"c"]]\n',
      );
    });
  });

  it("06: joins two JSON files using jq -s (slurp), INDEX, --arg, and --argjson", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'JSON' > users.json",
          '[{"id":1,"name":"Ada"},{"id":2,"name":"Bob"}]',
          "JSON",
          "cat << 'JSON' > roles.json",
          '[{"uid":1,"role":"admin"},{"uid":2,"role":"reader"}]',
          "JSON",
          'jq -c -s --arg env "prod" --argjson rev 4 \'INDEX(.[1][]; .uid) as $idx | .[0] | map({name, env: $env, rev: $rev, role: $idx[(.id|tostring)].role})\' users.json roles.json',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"name":"Ada","env":"prod","rev":4,"role":"admin"},{"name":"Bob","env":"prod","rev":4,"role":"reader"}]\n',
      );
    });
  });

  it("07: extracts all nested numbers across arbitrary tree depth using jq recursive descent (..)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'JSON' | jq -c '[.. | numbers] | add'",
          '{"a":10,"b":[20,{"c":30,"d":[40,"skip",{"e":50}]}]}',
          "JSON",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "150\n");
    });
  });

  it("08: defines reusable jq functions (def clamp) and extracts named regex groups via capture", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "echo '[5, 25, 60]' | jq -c 'def clamp($lo; $hi): if . < $lo then $lo elif . > $hi then $hi else . end; map(clamp(10; 50))'",
          'echo \'"svc-auth-409"\' | jq -c \'capture("^(?<prefix>[a-z]+)-(?<name>[a-z]+)-(?<code>[0-9]+)$")\'',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[10,25,50]\n{"prefix":"svc","name":"auth","code":"409"}\n',
      );
    });
  });

  it("09: resolves YAML anchors (&def) and aliases (*def) when converting YAML to compact JSON via yq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'YAML' | yq -o json -I 0 '.'",
          "defaults: &def",
          "  timeout: 30",
          "  retries: 3",
          "service:",
          "  base: *def",
          "  region: us-east",
          "YAML",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"defaults":{"timeout":30,"retries":3},"service":{"base":{"timeout":30,"retries":3},"region":"us-east"}}\n',
      );
    });
  });

  it("10: mutates a YAML configuration file in-place with yq -i and reads back as compact JSON", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'YAML' > cfg.yaml",
          "service: api",
          "replicas: 2",
          "YAML",
          'yq -i \'.replicas = 5 | .env = "prod"\' cfg.yaml',
          "yq -o json -I 0 '.' cfg.yaml",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"service":"api","replicas":5,"env":"prod"}\n');
    });
  });

  it("11: converts TOML to JSON and JSON array of objects to CSV using yq -p / -o", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'TOML' | yq -p toml -o json -I 0 '.'",
          'title = "Gateway"',
          "[server]",
          'host = "10.0.0.1"',
          "port = 8080",
          "TOML",
          'echo \'[{"id":1,"name":"alpha"},{"id":2,"name":"beta"}]\' | yq -p json -o csv',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"title":"Gateway","server":{"host":"10.0.0.1","port":8080}}\nid,name\n1,alpha\n2,beta\n',
      );
    });
  });

  it("12: queries XML elements and @id attributes using xq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'cat << \'XML\' | xq -c \'.catalog.book | map({id: ."@id", title: .title})\'',
          '<catalog><book id="b1"><title>Rust</title></book><book id="b2"><title>TypeScript</title></book></catalog>',
          "XML",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[{"id":"b1","title":"Rust"},{"id":"b2","title":"TypeScript"}]\n',
      );
    });
  });

  it("13: evaluates XPath string(), count(), and attribute-filtered text() queries via xmllint --xpath", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'XML' > cluster.xml",
          '<cluster region="eu-central">',
          '  <service enabled="true"><name>auth</name><port>8001</port></service>',
          '  <service enabled="false"><name>legacy</name><port>8002</port></service>',
          '  <service enabled="true"><name>billing</name><port>8003</port></service>',
          "</cluster>",
          "XML",
          "xmllint --xpath 'string(/cluster/@region)' cluster.xml",
          'echo ""',
          'xmllint --xpath \'count(//service[@enabled="true"])\' cluster.xml',
          'echo ""',
          'xmllint --xpath \'//service[@enabled="true"]/name/text()\' cluster.xml',
          'echo ""',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "eu-central\n\n2\n\nauth\nbilling\n\n");
    });
  });

  it("14: canonicalizes XML attributes and empty tags with xmllint --c14n and rejects malformed XML via --noout", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "echo '<root z=\"2\" a=\"1\"><empty/></root>' | xmllint --c14n -",
          'echo ""',
          'if echo \'<broken><unclosed></broken>\' | xmllint --noout - 2>/dev/null; then echo "valid"; else echo "invalid_caught"; fi',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '<root a="1" z="2"><empty></empty></root>\ninvalid_caught\n');
    });
  });

  it("15: extracts text and href attributes from nested CSS selectors using htmlq -t and -a", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'HTML' > page.html",
          '<div class="card"><h2 class="title">Item One</h2><a href="/one">Link 1</a></div>',
          '<div class="card"><h2 class="title">Item Two</h2><a href="/two">Link 2</a></div>',
          "HTML",
          'htmlq -t ".card .title" -f page.html',
          'htmlq -a href ".card a" -f page.html',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Item One\nItem Two\n/one\n/two\n");
    });
  });

  it("16: strips unwanted DOM nodes with htmlq -r and resolves relative URLs against <base> via htmlq -B", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'cat << \'HTML\' | htmlq -t -r script -r .ad "main"',
          '<main><script>evil()</script><div class="ad">Ad</div><p>Clean Content</p></main>',
          "HTML",
          'cat << \'HTML\' | htmlq -B -a href "a"',
          '<html><head><base href="https://docs.example.com/v2/"/></head><body><a href="guide.html">Guide</a></body></html>',
          "HTML",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Clean Content\nhttps://docs.example.com/v2/guide.html\n");
    });
  });

  it("17: detects configuration drift between YAML and TOML manifests using yq and jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'YAML' > k8s.yaml",
          "app: payments",
          'version: "2.4.0"',
          "port: 9090",
          "YAML",
          "cat << 'TOML' > app.toml",
          'app = "payments"',
          'version = "2.4.0"',
          "port = 9091",
          "TOML",
          'jq -n -c --argjson k "$(yq -o json -I 0 . k8s.yaml)" --argjson t "$(yq -p toml -o json -I 0 . app.toml)" \'{same_app: ($k.app == $t.app), same_ver: ($k.version == $t.version), port_diff: ($t.port - $k.port)}\'',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"same_app":true,"same_ver":true,"port_diff":1}\n');
    });
  });

  it("18: scrapes HTML table columns with htmlq and ranks rows by numeric latency via paste and sort", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'HTML' > tbl.html",
          "<table>",
          '  <tr><td class="svc">api</td><td class="lat">12</td></tr>',
          '  <tr><td class="svc">db</td><td class="lat">48</td></tr>',
          '  <tr><td class="svc">cache</td><td class="lat">4</td></tr>',
          "</table>",
          "HTML",
          'paste -d: <(htmlq -t "td.svc" -f tbl.html) <(htmlq -t "td.lat" -f tbl.html) | sort -t: -k2,2nr',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "db:48\napi:12\ncache:4\n");
    });
  });

  it("19: aggregates NDJSON service logs into per-service total and 5xx error counts via jq -s and @tsv", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "cat << 'NDJSON' | jq -s -r 'group_by(.svc) | map([.[0].svc, (length|tostring), (map(select(.status >= 500)) | length | tostring)] | @tsv) | .[]'",
          '{"svc":"auth","status":200}',
          '{"svc":"auth","status":503}',
          '{"svc":"pay","status":200}',
          '{"svc":"auth","status":500}',
          '{"svc":"pay","status":201}',
          "NDJSON",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "auth\t3\t2\npay\t2\t0\n");
    });
  });

  it("20: transforms an XML invoice through xq and jq into pretty YAML via yq -p json -P", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'cat << \'XML\' | xq -c \'.envelope.items.item\' | jq -c \'map({sku: ."@sku", total: ((.qty|tonumber) * (.price|tonumber))})\' | yq -p json -P',
          '<envelope><items><item sku="A1"><qty>3</qty><price>15</price></item><item sku="B2"><qty>2</qty><price>40</price></item></items></envelope>',
          "XML",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "- sku: A1\n  total: 45\n- sku: B2\n  total: 80\n");
    });
  });
});
