import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure jq, yq, xq, xmllint, and htmlq structured transforms, reducers, and xpath matrix", () => {
  it("01_jq_recursive_def_flatten_tree_with_depth", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/tree.json\n{\n  \"name\": \"root\",\n  \"children\": [\n    {\"name\": \"a\", \"children\": [{\"name\": \"a1\", \"children\": []}]},\n    {\"name\": \"b\", \"children\": []}\n  ]\n}\nEOF\njq -r '\n  def walk_tree($d):\n    \"\\($d):\\(.name)\",\n    (.children[]? | walk_tree($d + 1));\n  walk_tree(0)\n' /workspace/tree.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "0:root\n1:a\n2:a1\n1:b\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_jq_reduce_and_foreach_running_balance", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -c '\n  {\n    total: (reduce .[] as $x (0; . + $x)),\n    running: [foreach .[] as $x (0; . + $x; .)]\n  }\n' <<< '[10, -3, 15, -7, 5]'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"total\":20,\"running\":[10,7,22,15,20]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_jq_paths_getpath_setpath_delpaths_surgical_edit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/cfg.json\n{\"db\":{\"host\":\"localhost\",\"port\":5432,\"secret\":\"s3cr3t\"},\"cache\":{\"ttl\":60}}\nEOF\njq -c '\n  setpath([\"db\",\"port\"]; 6432)\n  | delpaths([[\"db\",\"secret\"]])\n  | {port: getpath([\"db\",\"port\"]), keys: [paths(scalars) | join(\".\")]}\n' /workspace/cfg.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"port\":6432,\"keys\":[\"db.host\",\"db.port\",\"cache.ttl\"]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_jq_group_by_unique_by_min_by_max_by_analytics", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/trades.json\n[\n  {\"sym\": \"AAPL\", \"px\": 180, \"qty\": 10},\n  {\"sym\": \"MSFT\", \"px\": 410, \"qty\": 5},\n  {\"sym\": \"AAPL\", \"px\": 185, \"qty\": 20},\n  {\"sym\": \"MSFT\", \"px\": 405, \"qty\": 8}\n]\nEOF\njq -c '\n  group_by(.sym)\n  | map({\n      sym: .[0].sym,\n      vwap_num: (map(.px * .qty) | add),\n      total_qty: (map(.qty) | add),\n      low: (min_by(.px).px),\n      high: (max_by(.px).px)\n    })\n' /workspace/trades.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"sym\":\"AAPL\",\"vwap_num\":5500,\"total_qty\":30,\"low\":180,\"high\":185},{\"sym\":\"MSFT\",\"vwap_num\":5290,\"total_qty\":13,\"low\":405,\"high\":410}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_jq_format_strings_csv_tsv_uri_base64_base64d", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -r '\n  {\n    csv_row: ([.user, .role, .score] | @csv),\n    uri: (\"https://example.com/q?name=\" + (.user | @uri)),\n    b64_rt: (.token | @base64 | @base64d)\n  } | \"\\(.csv_row)\\n\\(.uri)\\n\\(.b64_rt)\"\n' <<< '{\"user\":\"Alice Smith\",\"role\":\"admin\",\"score\":99,\"token\":\"tok_xyz_123\"}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "\"Alice Smith\",\"admin\",99\nhttps://example.com/q?name=Alice%20Smith\ntok_xyz_123\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_jq_regex_capture_scan_gsub_splits", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -c '\n  {\n    parsed: (\"2026-10-06T14:22:09Z\" | capture(\"(?<y>[0-9]{4})-(?<m>[0-9]{2})-(?<d>[0-9]{2})\")),\n    nums: (\"id=12, cost=45, qty=3\" | [scan(\"[0-9]+\") | tonumber]),\n    clean: (\"foo   bar\\tbaz\" | gsub(\"[[:space:]]+\"; \"_\"))\n  }\n' -n");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"parsed\":{\"y\":\"2026\",\"m\":\"10\",\"d\":\"06\"},\"nums\":[12,45,3],\"clean\":\"foo_bar_baz\"}\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_jq_transpose_bsearch_and_argjson_slurp", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -c --arg env \"prod\" --argjson mult 10 '\n  {\n    env: $env,\n    matrix_t: ([[1,2,3],[4,5,6]] | transpose),\n    idx_30: ([10,20,30,40,50] | bsearch(30)),\n    scaled: ([1,2,3] | map(. * $mult))\n  }\n' -n");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"env\":\"prod\",\"matrix_t\":[[1,4],[2,5],[3,6]],\"idx_30\":2,\"scaled\":[10,20,30]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_yq_in_place_mutation_and_multi_field_update", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/compose.yaml\nservices:\n  web:\n    restart: always\n    cpu: 2\n    port: 8080\n  worker:\n    restart: always\n    cpu: 4\nEOF\nyq -i '.services.web.port = 9090 | .services.worker.cpu = 8' /workspace/compose.yaml\nyq -o=json '.services' /workspace/compose.yaml | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"web\":{\"restart\":\"always\",\"cpu\":2,\"port\":9090},\"worker\":{\"restart\":\"always\",\"cpu\":8}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_yq_eval_all_multi_doc_ireduce_map_merge", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/f1.yaml\napp:\n  name: gateway\n  replicas: 2\nEOF\ncat << 'EOF' > /workspace/f2.yaml\napp:\n  replicas: 5\n  tls: true\nEOF\nyq ea -o=json 'select(fileIndex == 0) * select(fileIndex == 1)' /workspace/f1.yaml /workspace/f2.yaml | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"app\":{\"name\":\"gateway\",\"replicas\":5,\"tls\":true}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_yq_json_to_yaml_and_yaml_to_json_roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/input.json\n{\"cluster\":{\"name\":\"prod-us\",\"nodes\":[\"n1\",\"n2\"],\"ha\":true}}\nEOF\nyq -P '.' /workspace/input.json > /workspace/output.yaml\nyq -o=json '.' /workspace/output.yaml | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"cluster\":{\"name\":\"prod-us\",\"nodes\":[\"n1\",\"n2\"],\"ha\":true}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_xq_xml_attributes_elements_and_json_to_xml_roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/catalog.xml\n<catalog region=\"us\">\n  <book id=\"b1\"><title>Rust Systems</title><price>45</price></book>\n  <book id=\"b2\"><title>Wasm Runtime</title><price>55</price></book>\n</catalog>\nEOF\nxq -c '.catalog.book | map({id: .\"@id\", title: .title, price: (.price | tonumber)})' /workspace/catalog.xml");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"id\":\"b1\",\"title\":\"Rust Systems\",\"price\":45},{\"id\":\"b2\",\"title\":\"Wasm Runtime\",\"price\":55}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_xmllint_xpath_predicates_counts_and_string_functions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/servers.xml\n<fleet>\n  <server id=\"s1\" env=\"prod\" cores=\"16\"><status>ready</status></server>\n  <server id=\"s2\" env=\"staging\" cores=\"8\"><status>ready</status></server>\n  <server id=\"s3\" env=\"prod\" cores=\"32\"><status>maintenance</status></server>\n</fleet>\nEOF\ncnt=$(xmllint --xpath 'count(//server[@env=\"prod\"])' /workspace/servers.xml)\ns3_status=$(xmllint --xpath 'string(//server[@id=\"s3\"]/status)' /workspace/servers.xml)\ns1_cores=$(xmllint --xpath 'string(//server[@id=\"s1\"]/@cores)' /workspace/servers.xml)\nprintf \"prod_cnt=%s s3=%s s1_cores=%s\\n\" \"$cnt\" \"$s3_status\" \"$s1_cores\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "prod_cnt=2 s3=maintenance s1_cores=16\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_htmlq_css_selectors_attributes_text_and_remove_nodes", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/dashboard.html\n<main>\n  <nav class=\"sidebar\"><a href=\"/ignore\">Skip</a></nav>\n  <section id=\"cards\">\n    <div class=\"card\" data-tier=\"pro\"><h3>Pro Plan</h3><span class=\"noise\">ad</span><p class=\"price\">$49</p></div>\n    <div class=\"card\" data-tier=\"team\"><h3>Team Plan</h3><span class=\"noise\">ad</span><p class=\"price\">$99</p></div>\n  </section>\n</main>\nEOF\ntiers=$(htmlq -a data-tier '#cards .card' -f /workspace/dashboard.html | paste -sd',' -)\nprices=$(htmlq -t --remove-nodes '.noise' '#cards .card .price' -f /workspace/dashboard.html | paste -sd',' -)\nprintf \"tiers=%s prices=%s\\n\" \"$tiers\" \"$prices\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "tiers=pro,team prices=$49,$99\n");
    } finally {
      await h.dispose();
    }
  });

  it("14_jq_try_catch_optional_operator_and_error_recovery", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -c '\n  map(try (tonumber * 2) catch \"invalid:\\(.)\")\n' <<< '[10, \"25\", \"not_a_num\", 4]'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[20,50,\"invalid:Invalid numeric literal at EOF at line 1, column 9 (while parsing 'not_a_num')\",8]\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_jq_to_entries_from_entries_with_entries_key_remap", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -c '\n  with_entries(.key |= (\"env_\" + ascii_upcase) | .value |= tostring)\n' <<< '{\"port\": 8080, \"debug\": false, \"host\": \"0.0.0.0\"}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"env_PORT\":\"8080\",\"env_DEBUG\":\"false\",\"env_HOST\":\"0.0.0.0\"}\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_yq_toml_array_of_tables_and_nested_sections_to_jq", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/config.toml\ntitle = \"edge-router\"\n\n[[routes]]\npath = \"/v1\"\nupstream = \"svc-a:8000\"\n\n[[routes]]\npath = \"/v2\"\nupstream = \"svc-b:9000\"\nEOF\nyq -p=toml -o=json '.' /workspace/config.toml | jq -c '{title: .title, routes: [.routes[] | \"\\(.path)->\\(.upstream)\"]}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"title\":\"edge-router\",\"routes\":[\"/v1->svc-a:8000\",\"/v2->svc-b:9000\"]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_jq_combinations_and_cartesian_matrix_generation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -c '[combinations]' <<< '[[\"r\",\"g\"],[\"1\",\"2\"]]'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[[\"r\",\"1\"],[\"r\",\"2\"],[\"g\",\"1\"],[\"g\",\"2\"]]\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_jq_slurp_multiline_ndjson_log_aggregation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/events.ndjson\n{\"svc\":\"auth\",\"ok\":true,\"ms\":12}\n{\"svc\":\"auth\",\"ok\":false,\"ms\":48}\n{\"svc\":\"pay\",\"ok\":true,\"ms\":30}\n{\"svc\":\"auth\",\"ok\":true,\"ms\":15}\nEOF\njq -s -c '\n  group_by(.svc)\n  | map({\n      svc: .[0].svc,\n      count: length,\n      errors: (map(select(.ok | not)) | length),\n      total_ms: (map(.ms) | add)\n    })\n' /workspace/events.ndjson");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"svc\":\"auth\",\"count\":3,\"errors\":1,\"total_ms\":75},{\"svc\":\"pay\",\"count\":1,\"errors\":0,\"total_ms\":30}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_xmllint_format_and_yq_xml_generation_roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -n -c '{response:{status:{code:\"200\",msg:\"OK\"},items:{item:[\"alpha\",\"beta\"]}}}' \\\n  | yq -p=json -o=xml '.' > /workspace/gen.xml\nc=$(xmllint --xpath 'string(/response/status/code)' /workspace/gen.xml)\nm=$(xmllint --xpath 'string(/response/status/msg)' /workspace/gen.xml)\nn=$(xmllint --xpath 'count(/response/items/item)' /workspace/gen.xml)\nprintf \"code=%s msg=%s items=%s\\n\" \"$c\" \"$m\" \"$n\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "code=200 msg=OK items=2\n");
    } finally {
      await h.dispose();
    }
  });

  it("20_jq_inside_contains_indices_index_rindex_array_ops", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -c '\n  {\n    has_sub: ([1,2,3,4,5] | contains([2,4])),\n    inside_check: ({\"a\":1} | inside({\"a\":1,\"b\":2})),\n    first_idx: (\"abracadabra\" | index(\"bra\")),\n    last_idx: (\"abracadabra\" | rindex(\"bra\")),\n    all_idx: (\"abracadabra\" | [indices(\"a\")[]])\n  }\n' -n");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"has_sub\":true,\"inside_check\":true,\"first_idx\":1,\"last_idx\":8,\"all_idx\":[0,3,5,7,10]}\n");
    } finally {
      await h.dispose();
    }
  });

});
