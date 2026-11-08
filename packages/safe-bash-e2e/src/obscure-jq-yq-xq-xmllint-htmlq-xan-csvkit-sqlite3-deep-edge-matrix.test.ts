import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jq yq xq xmllint htmlq xan csvkit sqlite3 deep edge matrix", () => {
  it("01 jq with_entries key prefix and null filter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"host\":\"db\",\"port\":5432,\"debug\":null}\\n' | jq -c 'with_entries(select(.value != null) | .key |= \"cfg_\" + .)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"cfg_host\":\"db\",\"cfg_port\":5432}");
    });
  });

  it("02 jq to_entries on array and from_entries on object", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[\"x\",\"y\"]\\n' | jq -c 'to_entries'\nprintf '[{\"key\":\"a\",\"value\":1},{\"key\":\"b\",\"value\":2}]\\n' | jq -c 'from_entries'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"key\":0,\"value\":\"x\"},{\"key\":1,\"value\":\"y\"}]\n{\"a\":1,\"b\":2}");
    });
  });

  it("03 jq transpose matrix and column sums", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[[1,2,3],[10,20,30]]\\n' | jq -c 'transpose | map(add)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[11,22,33]");
    });
  });

  it("04 jq bsearch hit and miss insertion index", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[10,20,30,40,50]\\n' | jq -c '[bsearch(30), bsearch(25)]'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[2,-3]");
    });
  });

  it("05 jq INDEX dictionary and IN membership filter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'JSON' > staff.json\n[{\"id\":\"u1\",\"role\":\"admin\"},{\"id\":\"u2\",\"role\":\"guest\"},{\"id\":\"u3\",\"role\":\"sre\"}]\nJSON\njq -c '{by_id: INDEX(.[]; .id), priv: [.[] | select(IN(.role; \"admin\", \"sre\")) | .id]}' staff.json");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"by_id\":{\"u1\":{\"id\":\"u1\",\"role\":\"admin\"},\"u2\":{\"id\":\"u2\",\"role\":\"guest\"},\"u3\":{\"id\":\"u3\",\"role\":\"sre\"}},\"priv\":[\"u1\",\"u3\"]}");
    });
  });

  it("06 jq while until limit first last nth isempty", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("jq -n -c '{\n  w: [1 | while(. < 16; . * 2)],\n  u: [1 | until(. >= 16; . * 2)],\n  lim: [limit(3; range(0; 10))],\n  fst: first(range(5; 9)),\n  lst: last(range(5; 9)),\n  n2: nth(2; range(10; 20)),\n  emp: isempty(empty)\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"w\":[1,2,4,8],\"u\":[16],\"lim\":[0,1,2],\"fst\":5,\"lst\":8,\"n2\":12,\"emp\":true}");
    });
  });

  it("07 jq 2-arg any all and negative step range", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[{\"v\":10,\"ok\":true},{\"v\":95,\"ok\":true}]\\n' | jq -c '{\n  has_high: any(.[]; .v > 90),\n  all_ok: all(.[]; .ok),\n  seq: [range(10; 1; -3)]\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"has_high\":true,\"all_ok\":true,\"seq\":[10,7,4]}");
    });
  });

  it("08 jq index rindex and indices on strings and arrays", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("jq -n -c '{\n  si: (\"ab_cd_ab\" | index(\"ab\")),\n  sri: (\"ab_cd_ab\" | rindex(\"ab\")),\n  sind: (\"ababa\" | indices(\"aba\")),\n  aind: ([1,2,1,2,1] | indices([1,2]))\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"si\":0,\"sri\":6,\"sind\":[0,2],\"aind\":[0,2]}");
    });
  });

  it("09 jq flatten depth fabs and sqrt", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("jq -n -c '{\n  f1: ([[1,[2,[3]]]] | flatten(1)),\n  fall: ([[1,[2,[3]]]] | flatten),\n  math: [(-12.5 | fabs), (81 | sqrt)]\n}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"f1\":[1,[2,[3]]],\"fall\":[1,2,3],\"math\":[12.5,9]}");
    });
  });

  it("10 jq try catch with custom error", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[10, -5, 20]\\n' | jq -c 'map(try (if . < 0 then error(\"neg\") else . * 2 end) catch \"err:\\(.)\")'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[20,\"err:neg\",40]");
    });
  });

  it("11 yq strenv and env injection to json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export SVC_NAME=\"payment-gateway\" SVC_PORT=\"8443\"\nyq -n -o=json '.service.name = strenv(SVC_NAME) | .service.port = env(SVC_PORT)' | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"service\":{\"name\":\"payment-gateway\",\"port\":8443}}");
    });
  });

  it("12 yq -o=shell export and bash eval", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'YAML' > env_cfg.yaml\napp:\n  host: api.local\n  workers: 4\nYAML\neval \"$(yq -o=shell '.' env_cfg.yaml)\"\necho \"$app_host|$app_workers\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "api.local|4");
    });
  });

  it("13 yq csv and tsv input to json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'name,score\\nalice,95\\nbob,88\\n' | yq -p=csv -o=json '.' | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"name\":\"alice\",\"score\":95},{\"name\":\"bob\",\"score\":88}]");
    });
  });

  it("14 xmllint xpath attribute filter and xq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'XML' > svcs.xml\n<services><svc tier=\"critical\"><name>auth</name><port>443</port></svc><svc tier=\"batch\"><name>etl</name><port>8080</port></svc></services>\nXML\nxmllint --xpath 'string(//svc[@tier=\"critical\"]/name)' svcs.xml\nprintf '\\n'\nxq -r '.services.svc[] | select((.[\"@tier\"] // .[\"+@tier\"]) == \"critical\") | .port' svcs.xml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "auth\n\n443");
    });
  });

  it("15 htmlq nested selectors text and href paste", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'HTML' > nav.html\n<ul class=\"nav\"><li><a href=\"/home\">Home</a></li><li><a href=\"/about\">About</a></li></ul>\nHTML\npaste -d ':' <(htmlq --text 'ul.nav > li > a' < nav.html) <(htmlq --attribute href 'ul.nav > li > a' < nav.html)");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Home:/home\nAbout:/about");
    });
  });

  it("16 xan transpose and stats selection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'metric,q1,q2\\nrev,100,150\\ncost,40,60\\n' > fin.csv\nxan transpose fin.csv\nxan stats -s q1,q2 fin.csv | xan select field,sum,mean -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "metric,rev,cost\nq1,100,40\nq2,150,60\nfield,sum,mean\nq1,140,70\nq2,210,105");
    });
  });

  it("17 xan search case-insensitive invert and slice", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'host,status\\nweb-01,OK\\ndb-01,WARN\\ncache-01,ok\\n' > hosts.csv\nxan search -i -s status 'ok' hosts.csv\nxan search -v -i -s status 'ok' hosts.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "host,status\nweb-01,OK\ncache-01,ok\nhost,status\ndb-01,WARN");
    });
  });

  it("18 csvjoin and csvformat custom delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'id,name\\n1,alice\\n2,bob\\n' > left_c.csv\nprintf 'id,dept\\n1,eng\\n2,ops\\n' > right_c.csv\ncsvjoin -c id left_c.csv right_c.csv | csvformat -D '|'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id|name|dept\n1|alice|eng\n2|bob|ops");
    });
  });

  it("19 sqlite3 multi-CTE left join cast avg coalesce", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 mcte.db \"\n  CREATE TABLE teams (id INT, name TEXT);\n  CREATE TABLE tasks (team_id INT, pts REAL);\n  INSERT INTO teams VALUES (1,'core'),(2,'infra'),(3,'new_team');\n  INSERT INTO tasks VALUES (1,8.9),(1,7.8),(2,5.4);\n  WITH t_avg AS (\n    SELECT team_id, CAST(AVG(pts) AS INT) AS avg_pts FROM tasks GROUP BY team_id\n  ),\n  summary AS (\n    SELECT t.name, COALESCE(a.avg_pts, 0) AS score\n    FROM teams t LEFT JOIN t_avg a ON t.id = a.team_id\n  )\n  SELECT name, score FROM summary ORDER BY name;\n\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "core|8\ninfra|5\nnew_team|0");
    });
  });

  it("20 sqlite3 pragma user_version and application_id persistence", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("sqlite3 meta.db \"PRAGMA user_version = 42; PRAGMA application_id = 9001; CREATE TABLE t(x INT); INSERT INTO t VALUES (7);\"\nsqlite3 meta.db \"PRAGMA user_version; PRAGMA application_id; SELECT x FROM t;\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "42\n9001\n7");
    });
  });

});
