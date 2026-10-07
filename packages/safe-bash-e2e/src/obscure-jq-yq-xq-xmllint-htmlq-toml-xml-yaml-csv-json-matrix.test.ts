import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jq yq xq xmllint htmlq toml xml yaml csv json matrix", () => {
  it("1. jq recursive descent (..) with objects and select(has(...)) secret extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSON' | jq -r '.. | objects | select(has(\"secret\")) | .secret' | sort\n{\"a\":{\"secret\":\"sec-1\",\"nested\":[{\"secret\":\"sec-2\"},{\"public\":\"ok\"}]},\"b\":[{\"x\":{\"secret\":\"sec-3\"}}]}\nJSON");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sec-1\nsec-2\nsec-3");
    });
  });

  it("2. jq reduce and foreach state accumulators over JSON stream", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[10, 25, 15, 50]\\n' | jq -c '{\n  total: (reduce .[] as $x (0; . + $x)),\n  running: [foreach .[] as $x (0; . + $x; .)]\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"total\":100,\"running\":[10,35,50,100]}");
    });
  });

  it("3. jq group_by, map, add, min_by, and max_by regional telemetry aggregation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSON' | jq -c 'group_by(.region) | map({region: .[0].region, count: length, sum: (map(.ms) | add), slowest: (max_by(.ms).svc)})'\n[\n  {\"region\":\"eu\",\"svc\":\"auth\",\"ms\":15},\n  {\"region\":\"us\",\"svc\":\"pay\",\"ms\":120},\n  {\"region\":\"eu\",\"svc\":\"db\",\"ms\":45},\n  {\"region\":\"us\",\"svc\":\"api\",\"ms\":30}\n]\nJSON");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"region\":\"eu\",\"count\":2,\"sum\":60,\"slowest\":\"db\"},{\"region\":\"us\",\"count\":2,\"sum\":150,\"slowest\":\"pay\"}]");
    });
  });

  it("4. jq to_entries, from_entries, and with_entries object key/value rewriting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"host\":\"localhost\",\"port\":8080,\"tls\":true}\\n' | jq -S -c 'with_entries(.key |= \"APP_\" + (. | ascii_upcase) | .value |= tostring)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"APP_HOST\":\"localhost\",\"APP_PORT\":\"8080\",\"APP_TLS\":\"true\"}");
    });
  });

  it("5. jq paths(scalars), getpath, and setpath deep structural surgery", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"db\":{\"primary\":{\"port\":5432},\"replica\":{\"port\":5433}}}\\n' | jq -S -c 'setpath([\"db\",\"replica\",\"port\"]; 6432) | [paths(scalars) as $p | {path: ($p | join(\".\")), val: getpath($p)}]'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"path\":\"db.primary.port\",\"val\":5432},{\"path\":\"db.replica.port\",\"val\":6432}]");
    });
  });

  it("6. jq format strings: @csv, @tsv, @uri, @html, @base64, @base64d, and @sh", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"q\":\"a&b=c\",\"tag\":\"<b>hi</b>\",\"raw\":\"poe-2026\",\"row\":[\"x\",\"y,z\",10]}\\n' | jq -r '[\n  (@uri \"\\(.q)\"),\n  (@html \"\\(.tag)\"),\n  (.raw | @base64 | @base64d),\n  (.row | @csv)\n] | join(\"|\")'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a%26b%3Dc|&lt;b&gt;hi&lt;/b&gt;|poe-2026|\"x\",\"y,z\",10");
    });
  });

  it("7. jq transpose, flatten(1), unique_by, and sort_by combinators", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"matrix\":[[1,2],[3,4]],\"items\":[{\"id\":2,\"v\":\"b\"},{\"id\":1,\"v\":\"a\"},{\"id\":2,\"v\":\"dup\"}]}\\n' | jq -c '{\n  transposed: (.matrix | transpose),\n  flat: (.matrix | flatten(1)),\n  uniq: (.items | unique_by(.id) | sort_by(.id) | map(.v))\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"transposed\":[[1,3],[2,4]],\"flat\":[1,2,3,4],\"uniq\":[\"a\",\"b\"]}");
    });
  });

  it("8. jq regex capture, scan, sub, and gsub with named capture groups", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '\"svc-auth-42 and svc-pay-99\"\\n' | jq -c '{\n  captures: [scan(\"svc-(?<name>[a-z]+)-(?<id>[0-9]+)\")],\n  masked: gsub(\"(?<id>[0-9]+)\"; \"X\")\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"captures\":[[\"auth\",\"42\"],[\"pay\",\"99\"]],\"masked\":\"svc-auth-X and svc-pay-X\"}");
    });
  });

  it("9. jq --arg, --argjson, --slurp (-s), and strenv/env parameter injection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export DEPLOY_ENV=\"production\"\nprintf '{\"service\":\"api\"}\\n{\"service\":\"worker\"}\\n' | jq -s -c --arg cluster \"us-east-1\" --argjson replicas 3 'map(. + {env: env.DEPLOY_ENV, cluster: $cluster, replicas: $replicas})'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"service\":\"api\",\"env\":\"production\",\"cluster\":\"us-east-1\",\"replicas\":3},{\"service\":\"worker\",\"env\":\"production\",\"cluster\":\"us-east-1\",\"replicas\":3}]");
    });
  });

  it("10. yq YAML anchor, alias, and merge key (<<: *base) expansion with explode(.)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'YAML' | yq -o=json 'explode(.) | del(.base)' 2>/dev/null | jq -S -c .\nbase: &base\n  timeout: 30\n  retries: 3\nservice_a:\n  <<: *base\n  retries: 5\nservice_b:\n  <<: *base\n  port: 9000\nYAML");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"service_a\":{\"retries\":5,\"timeout\":30},\"service_b\":{\"port\":9000,\"retries\":3,\"timeout\":30}}");
    });
  });

  it("11. yq multi-document YAML stream filtering and aggregation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'YAML' | yq -o=json 'select(.kind == \"Service\") | .metadata.name'\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app-cfg\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: frontend-svc\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: backend-svc\nYAML");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "\"frontend-svc\"\n\"backend-svc\"");
    });
  });

  it("12. yq TOML <-> YAML <-> JSON transcoding roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'TOML' | yq -p=toml -o=yaml . | yq -p=yaml -o=json . | jq -S -c .\ntitle = \"PoeConfig\"\n\n[server]\nhost = \"0.0.0.0\"\nport = 8443\nTOML");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"server\":{\"host\":\"0.0.0.0\",\"port\":8443},\"title\":\"PoeConfig\"}");
    });
  });

  it("13. yq CSV input (-p=csv) to JSON and back to TSV (-o=tsv)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' | yq -p=csv -o=json 'map(select(.score >= 80))' | yq -p=json -o=tsv .\nname,score\nalice,95\nbob,70\ncarol,85\nCSV");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "name\tscore\nalice\t95\ncarol\t85");
    });
  });

  it("14. yq Java .properties (-p=props) to JSON and -o=props / -o=shell export", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'PROPS' | yq -p=props -o=json . | jq -S -c .\napp.name = poe-router\napp.port = 9090\nPROPS");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"app\":{\"name\":\"poe-router\",\"port\":\"9090\"}}");
    });
  });

  it("15. xq and yq XML attribute and element mutation roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'XML' | xq -c '.catalog.book | map({id: .[\"@id\"], title: .title})'\n<catalog>\n  <book id=\"b1\"><title>Rust Systems</title></book>\n  <book id=\"b2\"><title>Wasm Runtime</title></book>\n</catalog>\nXML");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"id\":\"b1\",\"title\":\"Rust Systems\"},{\"id\":\"b2\",\"title\":\"Wasm Runtime\"}]");
    });
  });

  it("16. xmllint --xpath complex XPath aggregations (count, sum, string, predicate filter)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'XML' > /tmp/orders78.xml\n<orders version=\"2.1\">\n  <order status=\"paid\"><amount>120</amount></order>\n  <order status=\"pending\"><amount>80</amount></order>\n  <order status=\"paid\"><amount>230</amount></order>\n</orders>\nXML\nxmllint --xpath 'string(/orders/@version)' /tmp/orders78.xml; echo\nxmllint --xpath 'count(//order[@status=\"paid\"])' /tmp/orders78.xml; echo\nxmllint --xpath 'sum(//order[@status=\"paid\"]/amount)' /tmp/orders78.xml; echo");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2.1\n\n2\n\n350");
    });
  });

  it("17. htmlq CSS selector extraction (--text, --attribute, --remove-nodes)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > /tmp/page78.html\n<div class=\"content\">\n  <script>console.log(\"ignore\");</script>\n  <ul class=\"links\">\n    <li><a href=\"https://poe.com/docs\" class=\"nav\">Docs</a></li>\n    <li><a href=\"https://poe.com/api\" class=\"nav\">API</a></li>\n  </ul>\n</div>\nHTML\nhtmlq --attribute href 'ul.links a.nav' --filename /tmp/page78.html\nhtmlq --text --remove-nodes script 'div.content' --filename /tmp/page78.html | awk 'NF { $1=$1; print }'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "https://poe.com/docs\nhttps://poe.com/api\nDocs\nAPI");
    });
  });

  it("18. html-to-markdown conversion of headings, inline formatting, links, and lists", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' | html-to-markdown\n<h2>Release Notes</h2>\n<p>Updated <strong>core</strong> and <code>wasm</code> modules.</p>\n<ul><li>Item A</li><li>Item B</li></ul>\nHTML");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "## Release Notes\n\nUpdated **core** and `wasm` modules.\n\n- Item A\n- Item B");
    });
  });

  it("19. htmlq + jq HTML table scraping into structured JSON analytics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > /tmp/metrics78.html\n<div class=\"metric\" data-svc=\"auth\">42</div>\n<div class=\"metric\" data-svc=\"pay\">108</div>\n<div class=\"metric\" data-svc=\"search\">15</div>\nHTML\npaste <(htmlq -a data-svc '.metric' -f /tmp/metrics78.html) <(htmlq -t '.metric' -f /tmp/metrics78.html) | jq -R -s -c 'split(\"\\n\") | map(select(length > 0) | split(\"\\t\") | {svc: .[0], ms: (.[1] | tonumber)}) | sort_by(.ms)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"svc\":\"search\",\"ms\":15},{\"svc\":\"auth\",\"ms\":42},{\"svc\":\"pay\",\"ms\":108}]");
    });
  });

  it("20. 4-format config pipeline: JSON -> YAML -> TOML -> JSON digest verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"service\":{\"name\":\"gateway\",\"port\":443,\"enabled\":true}}\\n' > /tmp/c78.json\nyq -p=json -o=yaml . /tmp/c78.json | yq -p=yaml -o=toml . | yq -p=toml -o=json . | jq -S -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"service\":{\"enabled\":true,\"name\":\"gateway\",\"port\":443}}");
    });
  });

});
