import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jq yq xq xmllint htmlq xan csvkit structured etl matrix", () => {
  it("01 jq recursive descent and del secret", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSON' > doc.json\n{\"a\":{\"secret\":\"s1\",\"keep\":1},\"b\":[{\"secret\":\"s2\",\"ok\":true}]}\nJSON\n    jq -c '[.. | objects | select(has(\"secret\")) | .secret]' doc.json\n    jq -c 'del(.. | .secret?)' doc.json");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[\"s1\",\"s2\"]\n{\"a\":{\"keep\":1},\"b\":[{\"ok\":true}]}");
    });
  });

  it("02 jq reduce and foreach", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[{\"dept\":\"eng\",\"v\":10},{\"dept\":\"ops\",\"v\":5},{\"dept\":\"eng\",\"v\":15}]\\n' | jq -c '\n      {\n        by_dept: (reduce .[] as $i ({}; .[$i.dept] += $i.v)),\n        running: [foreach .[].v as $x (0; . + $x; .)]\n      }\n    '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"by_dept\":{\"eng\":25,\"ops\":5},\"running\":[10,15,30]}");
    });
  });

  it("03 jq paths getpath setpath delpaths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"user\":{\"name\":\"alice\",\"role\":\"admin\"},\"meta\":{\"v\":1}}\\n' | jq -c '\n      . as $root |\n      ($root | setpath([\"user\",\"role\"]; \"super\") | delpaths([[\"meta\",\"v\"]])) as $mod |\n      {paths: [$root | paths(scalars)], role: ($mod | getpath([\"user\",\"role\"])), mod: $mod}\n    '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"paths\":[[\"user\",\"name\"],[\"user\",\"role\"],[\"meta\",\"v\"]],\"role\":\"super\",\"mod\":{\"user\":{\"name\":\"alice\",\"role\":\"super\"},\"meta\":{}}}");
    });
  });

  it("04 jq group_by map add length", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[{\"r\":\"us\",\"s\":100},{\"r\":\"eu\",\"s\":200},{\"r\":\"us\",\"s\":300}]\\n' | jq -c '\n      group_by(.r) | map({region: .[0].r, total: (map(.s) | add), avg: ((map(.s) | add) / length)})\n    '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"region\":\"eu\",\"total\":200,\"avg\":200},{\"region\":\"us\",\"total\":400,\"avg\":200}]");
    });
  });

  it("05 jq capture scan sub gsub", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '\"ID-404: a=1 b=22\"\\n' | jq -c '\n      {\n        cap: capture(\"(?<prefix>[A-Z]+)-(?<code>[0-9]+)\"),\n        kv: [scan(\"([a-z]+)=([0-9]+)\")],\n        clean: gsub(\"[0-9]+\"; \"#\")\n      }\n    '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"cap\":{\"prefix\":\"ID\",\"code\":\"404\"},\"kv\":[[\"a\",\"1\"],[\"b\",\"22\"]],\"clean\":\"ID-#: a=# b=#\"}");
    });
  });

  it("06 jq format strings base64 uri html csv tsv", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"msg\":\"a&b\",\"q\":\"hello world\",\"arr\":[\"x\",1]}\\n' | jq -r '\n      [\n        (.msg | @base64 | @base64d),\n        (@html \"\\(.msg)\"),\n        (@uri \"\\(.q)\"),\n        (.arr | @csv),\n        (.arr | @tsv)\n      ] | join(\"|\")\n    '");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a&b|a&amp;b|hello%20world|\"x\",1|x\t1");
    });
  });

  it("07 yq yaml anchors explode and props round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'YAML' > cfg.yaml\ndefaults: &def\n  timeout: 30\n  retries: 3\nservice:\n  <<: *def\n  retries: 5\nYAML\n    yq -o=json 'explode(.) | .service' cfg.yaml | jq -c .\n    yq -o=props '.service | explode(.)' cfg.yaml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"timeout\":30,\"retries\":5}\ntimeout = 30\nretries = 5");
    });
  });

  it("08 yq eval-all deep merge", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'app:\\n  host: localhost\\n  port: 8080\\n' > base.yaml\n    printf 'app:\\n  port: 9090\\n  tls: true\\n' > prod.yaml\n    yq ea -o=json 'select(fileIndex == 0) * select(fileIndex == 1)' base.yaml prod.yaml | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"app\":{\"host\":\"localhost\",\"port\":9090,\"tls\":true}}");
    });
  });

  it("09 yq toml to json and json to toml", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'TOML' > app.toml\ntitle = \"demo\"\n[server]\nport = 8080\nenabled = true\nTOML\n    yq -p=toml -o=json '.' app.toml | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"title\":\"demo\",\"server\":{\"port\":8080,\"enabled\":true}}");
    });
  });

  it("10 yq xml and xq extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'XML' > catalog.xml\n<catalog><item id=\"p1\"><name>Widget</name><price>25</price></item><item id=\"p2\"><name>Gadget</name><price>40</price></item></catalog>\nXML\n    xq -r '.catalog.item[] | \"\\(.[\"@id\"] // .[\"+@id\"]):\\(.name)\"' catalog.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "p1:Widget\np2:Gadget");
    });
  });

  it("11 xmllint xpath queries and count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'XML' > nodes.xml\n<cluster><node id=\"n1\" active=\"true\"><cpu>4</cpu></node><node id=\"n2\" active=\"false\"><cpu>8</cpu></node><node id=\"n3\" active=\"true\"><cpu>16</cpu></node></cluster>\nXML\n    xmllint --xpath 'count(//node[@active=\"true\"])' nodes.xml\n    printf '\\n'\n    xmllint --xpath 'string(//node[@id=\"n3\"]/cpu)' nodes.xml\n    printf '\\n'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2\n\n16");
    });
  });

  it("12 htmlq selectors attribute text remove-nodes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > page.html\n<div class=\"card\"><script>evil()</script><h2 class=\"title\">Hello</h2><a class=\"link\" href=\"https://example.com/docs\">Docs</a></div>\nHTML\n    htmlq --remove-nodes script --text '.card .title' < page.html\n    htmlq --attribute href 'a.link' < page.html");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Hello\nhttps://example.com/docs");
    });
  });

  it("13 html-to-markdown conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > doc.html\n<h1>Title</h1><p>This is <strong>bold</strong> and <em>italic</em>.</p><ul><li>One</li><li>Two</li></ul>\nHTML\n    html-to-markdown doc.html | grep -v '^$'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "# Title\nThis is **bold** and *italic*.\n- One\n- Two");
    });
  });

  it("14 xan filter map groupby sort", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'CSV' > sales.csv\nrep,region,base,bonus\n alice ,us,100,20\n bob ,eu,200,50\n carol ,us,150,30\n dave ,eu,120,10\nCSV\n    xan map 'trim(rep) as rep_clean, upper(region) as reg, base + bonus as total' sales.csv \\\n      | xan filter 'total >= 120' - \\\n      | xan groupby reg 'count() as n, sum(total) as sum_t, median(total) as med_t' - \\\n      | xan sort -s reg -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "reg,n,sum_t,med_t\nEU,2,380,190\nUS,2,300,150");
    });
  });

  it("15 xan join left and select rename", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,name\\n1,alice\\n2,bob\\n3,carol\\n' > users.csv\n    printf 'uid,role\\n1,admin\\n3,editor\\n' > roles.csv\n    xan join --left id users.csv uid roles.csv | xan select id,name,role - | xan rename user_id,user_name,user_role -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "user_id,user_name,user_role\n1,alice,admin\n2,bob,\n3,carol,editor");
    });
  });

  it("16 xan dedup enum and freq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'dept,role\\neng,dev\\neng,dev\\neng,sre\\nops,sre\\n' > roles_dup.csv\n    xan dedup -s dept,role roles_dup.csv | xan freq -s role -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "field,value,count\nrole,sre,2\nrole,dev,1");
    });
  });

  it("17 xan top and slice", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'name,score\\na,10\\nb,50\\nc,30\\nd,40\\n' > scores.csv\n    xan top -l 2 score scores.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "name,score\nb,50\nd,40");
    });
  });

  it("18 csvkit csvcut csvgrep csvsort csvstack", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,dept,sal\\n1,eng,100\\n2,sales,80\\n' > p1.csv\n    printf 'id,dept,sal\\n3,eng,120\\n4,ops,90\\n' > p2.csv\n    csvstack p1.csv p2.csv | csvgrep -c dept -m eng | csvsort -c sal -r | csvcut -c id,sal");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,sal\n3,120\n1,100");
    });
  });

  it("19 csvsql multi-table join to csvjson", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,name\\n1,alice\\n2,bob\\n' > u.csv\n    printf 'uid,amt\\n1,50\\n1,70\\n2,30\\n' > o.csv\n    csvsql --query 'SELECT u.name, SUM(o.amt) AS total FROM u JOIN o ON u.id = o.uid GROUP BY u.name ORDER BY total DESC' u.csv o.csv | csvjson | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"name\":\"alice\",\"total\":120.0},{\"name\":\"bob\",\"total\":30.0}]");
    });
  });

  it("20 in2csv json to csv and csvstat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[{\"item\":\"a\",\"qty\":10},{\"item\":\"b\",\"qty\":20},{\"item\":\"c\",\"qty\":30}]\\n' > items.json\n    in2csv items.json | csvstat --sum -c qty");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "60");
    });
  });

});
