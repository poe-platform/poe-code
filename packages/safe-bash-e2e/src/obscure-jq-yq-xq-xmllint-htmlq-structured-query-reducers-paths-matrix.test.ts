import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure jq yq xq xmllint htmlq structured query reducers paths matrix", () => {
  it("01 jq foreach cumulative running state and top-level comma summary", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > deltas.json\n[10, -3, 7, 15, -5]\nJSON\njq -c '[foreach .[] as $d (0; . + $d; {step: $d, running: .})], (reduce .[] as $d (0; . + $d))' deltas.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"step\":10,\"running\":10},{\"step\":-3,\"running\":7},{\"step\":7,\"running\":14},{\"step\":15,\"running\":29},{\"step\":-5,\"running\":24}]\n24\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 jq paths getpath setpath and delpaths deep tree surgery", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > tree.json\n{\n  \"a\": {\"x\": 1, \"keep\": 10},\n  \"b\": [{\"x\": 2}, {\"y\": 3}]\n}\nJSON\njq -c 'setpath([\"a\", \"keep\"]; 99) | delpaths([[\"a\", \"x\"], [\"b\", 0, \"x\"]])' tree.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"a\":{\"keep\":99},\"b\":[{},{\"y\":3}]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 jq @uri @html @base64 @base64d @csv @tsv @sh format strings", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > payload.json\n{\n  \"query\": \"a b&c=1\",\n  \"tag\": \"<b>ok</b>\",\n  \"token\": \"sec-42\",\n  \"row\": [\"alpha\", \"beta,gamma\", 100]\n}\nJSON\njq -r '\n  \"uri=\\(.query | @uri)\",\n  \"html=\\(.tag | @html)\",\n  \"b64=\\(.token | @base64 | @base64d)\",\n  \"csv=\\(.row | @csv)\",\n  \"tsv=\\(.row | @tsv)\"\n' payload.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "uri=a%20b%26c%3D1\nhtml=&lt;b&gt;ok&lt;/b&gt;\nb64=sec-42\ncsv=\"alpha\",\"beta,gamma\",100\ntsv=alpha\tbeta,gamma\t100\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 jq scan capture sub and gsub regex transformations", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > text.json\n{\"log\": \"user=alice_01 id=420 role=admin_99\"}\nJSON\njq -c '{\n  pairs: [.log | scan(\"([a-z]+)=([a-z0-9_]+)\")],\n  masked: (.log | gsub(\"=[a-z0-9_]+\"; \"=***\"))\n}' text.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"pairs\":[[\"user\",\"alice_01\"],[\"id\",\"420\"],[\"role\",\"admin_99\"]],\"masked\":\"user=*** id=*** role=***\"}\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 jq index rindex indices and bsearch binary search on sorted array", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > arr.json\n{\"str\": \"abracadabra\", \"nums\": [10, 20, 30, 40, 50]}\nJSON\njq -c '{\n  first_bra: (.str | index(\"bra\")),\n  last_bra: (.str | rindex(\"bra\")),\n  all_a: (.str | indices(\"a\")),\n  find_30: (.nums | bsearch(30)),\n  miss_25: (.nums | bsearch(25))\n}' arr.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"first_bra\":1,\"last_bra\":8,\"all_a\":[0,3,5,7,10],\"find_30\":2,\"miss_25\":-3}\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 jq flatten with depth argument range with negative step and any/all predicates", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("jq -n -c '{\n  flat1: ([[[1, 2]], [3, [4, 5]]] | flatten(1)),\n  countdown: [range(10; 0; -3)],\n  any_gt8: any([2, 5, 9, 1][]; . > 8),\n  all_even: all([2, 4, 6, 8][]; . % 2 == 0)\n}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"flat1\":[[1,2],3,[4,5]],\"countdown\":[10,7,4,1],\"any_gt8\":true,\"all_even\":true}\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 jq to_entries on array and object with |= selective update", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > items.json\n{\"list\": [\"zero\", \"one\", \"two\"], \"scores\": {\"a\": 5, \"b\": 12, \"c\": 8}}\nJSON\njq -c '{\n  indexed: (.list | to_entries),\n  boosted: (.scores | with_entries(if .value >= 8 then .value += 10 else . end))\n}' items.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"indexed\":[{\"key\":0,\"value\":\"zero\"},{\"key\":1,\"value\":\"one\"},{\"key\":2,\"value\":\"two\"}],\"boosted\":{\"a\":5,\"b\":22,\"c\":18}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 jq --arg and --argjson parameter injection with group_by and max_by", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'JSON' > tasks.json\n[\n  {\"team\": \"core\", \"task\": \"lexer\", \"pts\": 5},\n  {\"team\": \"core\", \"task\": \"parser\", \"pts\": 13},\n  {\"team\": \"ui\", \"task\": \"theme\", \"pts\": 3},\n  {\"team\": \"ui\", \"task\": \"grid\", \"pts\": 8}\n]\nJSON\njq -c --arg env \"prod\" --argjson bonus 2 '\n  group_by(.team)\n  | map({\n      env: $env,\n      team: .[0].team,\n      top_task: (max_by(.pts) | .task),\n      total_pts: (map(.pts + $bonus) | add)\n    })\n' tasks.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"env\":\"prod\",\"team\":\"core\",\"top_task\":\"parser\",\"total_pts\":22},{\"env\":\"prod\",\"team\":\"ui\",\"top_task\":\"grid\",\"total_pts\":15}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 yq YAML anchors merge key explode and in-place -i modification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'YAML' > svc.yaml\nbase: &base\n  timeout: 30\n  retries: 3\napi:\n  <<: *base\n  port: 8080\nworker:\n  <<: *base\n  retries: 5\nYAML\nyq -i 'explode(.) | .api.timeout = 60 | del(.base)' svc.yaml\nyq -o=json '.' svc.yaml | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"api\":{\"timeout\":60,\"retries\":3,\"port\":8080},\"worker\":{\"timeout\":30,\"retries\":5}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 yq TOML input decoding and XML output encoding", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'TOML' > Cargo.toml\n[package]\nname = \"safe-engine\"\nversion = \"1.2.0\"\nedition = \"2024\"\nTOML\nyq -p=toml -o=json '.' Cargo.toml | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"package\":{\"name\":\"safe-engine\",\"version\":\"1.2.0\",\"edition\":\"2024\"}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 yq Java properties input decoding and properties output roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'PROPS' > app.properties\nserver.host = 127.0.0.1\nserver.port = 9090\nfeature.audit = true\nPROPS\nyq -p=props -o=json '.' app.properties | jq -c '.'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"server\":{\"host\":\"127.0.0.1\",\"port\":\"9090\"},\"feature\":{\"audit\":\"true\"}}\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 yq CSV input decoding filtering and TSV output encoding", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > nodes.csv\nhost,cores,zone\nn1,16,use1\nn2,32,euw1\nn3,64,use1\nCSV\nyq -p=csv -o=tsv 'map(select(.cores >= 32))' nodes.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "host\tcores\tzone\nn2\t32\teuw1\nn3\t64\tuse1\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 xq XML to JSON with attributes and nested arrays", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'XML' > policy.xml\n<policy version=\"2.0\">\n  <rule id=\"R1\" action=\"allow\"><cidr>10.0.0.0/8</cidr></rule>\n  <rule id=\"R2\" action=\"deny\"><cidr>0.0.0.0/0</cidr></rule>\n</policy>\nXML\nxq -c '{version: .policy[\"@version\"], rules: [.policy.rule[] | {id: .[\"@id\"], action: .[\"@action\"], cidr: .cidr}]}' policy.xml");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"version\":\"2.0\",\"rules\":[{\"id\":\"R1\",\"action\":\"allow\",\"cidr\":\"10.0.0.0/8\"},{\"id\":\"R2\",\"action\":\"deny\",\"cidr\":\"0.0.0.0/0\"}]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 xmllint --xpath count sum string and attribute predicates", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'XML' > inv.xml\n<warehouse>\n  <item sku=\"A1\" active=\"true\"><qty>15</qty><price>10</price></item>\n  <item sku=\"A2\" active=\"false\"><qty>5</qty><price>20</price></item>\n  <item sku=\"A3\" active=\"true\"><qty>25</qty><price>30</price></item>\n</warehouse>\nXML\ncnt=$(xmllint --xpath 'count(//item[@active=\"true\"])' inv.xml)\ntot=$(xmllint --xpath 'sum(//item[@active=\"true\"]/qty)' inv.xml)\nsku=$(xmllint --xpath 'string(//item[qty>20]/@sku)' inv.xml)\nprintf \"active_cnt=%s active_qty=%s big_sku=%s\\n\" \"$cnt\" \"$tot\" \"$sku\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "active_cnt=2 active_qty=40 big_sku=A3\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 xmllint --format pretty-printing and --recover malformed XML handling", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf '<root><child id=\"1\">hello</child><child id=\"2\">world</child></root>\\n' > compact.xml\nxmllint --format compact.xml | grep -c '<child'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "2\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 htmlq CSS combinators child > adjacent + and general sibling ~", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > dom.html\n<div class=\"card\">\n  <h2>Title</h2>\n  <p class=\"lead\">First paragraph</p>\n  <p class=\"body\">Second paragraph</p>\n  <section><p class=\"nested\">Nested paragraph</p></section>\n</div>\nHTML\nprintf \"child_p=%s\\n\" \"$(htmlq --text 'div.card > p' < dom.html | paste -sd ',' -)\"\nprintf \"adj_p=%s\\n\" \"$(htmlq --text 'h2 + p' < dom.html)\"\nprintf \"sib_p=%s\\n\" \"$(htmlq --text 'h2 ~ p.body' < dom.html)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "child_p=First paragraph,Second paragraph\nadj_p=First paragraph\nsib_p=Second paragraph\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 htmlq attribute prefix ^= suffix $= substring *= and word ~= selectors", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > links.html\n<ul>\n  <li><a href=\"https://docs.example.com/guide.pdf\" data-tags=\"doc official\">Guide</a></li>\n  <li><a href=\"https://api.example.com/v1/spec.json\" data-tags=\"api spec\">Spec</a></li>\n  <li><a href=\"http://legacy.internal/index.html\" data-tags=\"legacy internal\">Legacy</a></li>\n</ul>\nHTML\nprintf \"https_pdf=%s\\n\" \"$(htmlq --text 'a[href^=\"https://\"][href$=\".pdf\"]' < links.html)\"\nprintf \"api_sub=%s\\n\" \"$(htmlq --text 'a[href*=\"api.example\"]' < links.html)\"\nprintf \"tag_word=%s\\n\" \"$(htmlq --text 'a[data-tags~=\"official\"]' < links.html)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "https_pdf=Guide\napi_sub=Spec\ntag_word=Guide\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 htmlq pseudo-classes :first-child :last-child :nth-child :not :empty", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > list.html\n<ul id=\"items\">\n  <li class=\"item\">One</li>\n  <li class=\"item skip\">Two</li>\n  <li class=\"item\"></li>\n  <li class=\"item\">Four</li>\n</ul>\nHTML\nprintf \"first=%s\\n\" \"$(htmlq --text '#items li:first-child' < list.html)\"\nprintf \"last=%s\\n\" \"$(htmlq --text '#items li:last-child' < list.html)\"\nprintf \"odd=%s\\n\" \"$(htmlq --text '#items li:nth-child(odd)' < list.html | paste -sd ',' -)\"\nprintf \"not_skip=%s\\n\" \"$(htmlq --text '#items li:not(.skip):not(:empty)' < list.html | paste -sd ',' -)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "first=One\nlast=Four\nodd=One,\nnot_skip=One,Four\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 htmlq --remove-nodes and --base relative URL resolution", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > page.html\n<html><body>\n  <nav class=\"sidebar\">Remove Me</nav>\n  <main>\n    <a href=\"/docs/intro\">Intro</a>\n    <a href=\"setup/install.html\">Install</a>\n  </main>\n</body></html>\nHTML\nhtmlq -r '.sidebar' -b 'https://portal.example.com/v2/index.html' -a href 'main a' < page.html");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "https://portal.example.com/docs/intro\nhttps://portal.example.com/v2/setup/install.html\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 polyglot structured pipeline: htmlq -> xq -> yq -> jq -> csvjson", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > table.html\n<div id=\"catalog\">\n  <div class=\"entry\" data-code=\"E10\" data-cost=\"45\">Alpha</div>\n  <div class=\"entry\" data-code=\"E20\" data-cost=\"95\">Beta</div>\n  <div class=\"entry\" data-code=\"E30\" data-cost=\"60\">Gamma</div>\n</div>\nHTML\n{\n  echo \"code,name,cost\"\n  for idx in 1 2 3; do\n    code=$(htmlq -a data-code \"div.entry:nth-of-type($idx)\" < table.html)\n    cost=$(htmlq -a data-cost \"div.entry:nth-of-type($idx)\" < table.html)\n    name=$(htmlq --text \"div.entry:nth-of-type($idx)\" < table.html)\n    printf \"%s,%s,%s\\n\" \"$code\" \"$name\" \"$cost\"\n  done\n} | yq -p=csv -o=json '.' | jq -c 'map(select(.cost >= 50)) | sort_by(-.cost)'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"code\":\"E20\",\"name\":\"Beta\",\"cost\":95},{\"code\":\"E30\",\"name\":\"Gamma\",\"cost\":60}]\n");
    } finally {
      await h.dispose();
    }
  });

});
