import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jq yq recursive reduce foreach regex paths env matrix", () => {
  it("1. jq reduce over nested transactions with dynamic key accumulation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | jq -c 'reduce .[] as $item ({}; .[$item.dept] = ((.[$item.dept] // 0) + $item.cost))'\n[{\"dept\":\"eng\",\"cost\":120},{\"dept\":\"ops\",\"cost\":80},{\"dept\":\"eng\",\"cost\":55},{\"dept\":\"sec\",\"cost\":95},{\"dept\":\"ops\",\"cost\":20}]\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"eng\":175,\"ops\":100,\"sec\":95}");
    });
  });

  it("2. jq foreach with running cumulative sum and state extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[10, 25, 15, 50]' | jq -c '[foreach .[] as $x (0; . + $x; {item: $x, running: .})]'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"item\":10,\"running\":10},{\"item\":25,\"running\":35},{\"item\":15,\"running\":50},{\"item\":50,\"running\":100}]");
    });
  });

  it("3. jq walk() recursive sanitization of secret keys across arbitrary tree depth", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | jq -c 'walk(if type == \"object\" and has(\"token\") then .token = \"***\" else . end)'\n{\"service\":{\"name\":\"api\",\"token\":\"sec-1\",\"nested\":[{\"token\":\"sec-2\",\"ok\":true}]}}\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"service\":{\"name\":\"api\",\"token\":\"***\",\"nested\":[{\"token\":\"***\",\"ok\":true}]}}");
    });
  });

  it("4. jq paths, leaf_paths, getpath, setpath, and delpaths structural surgery", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/tree.json\n{\"a\":{\"b\":[10,20],\"c\":true}}\nEOF\njq -c '[leaf_paths]' /tmp/tree.json\njq -c 'setpath([\"a\",\"b\",1]; 99) | delpaths([[\"a\",\"c\"]])' /tmp/tree.json");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[[\"a\",\"b\",0],[\"a\",\"b\",1],[\"a\",\"c\"]]\n{\"a\":{\"b\":[10,99]}}");
    });
  });

  it("5. jq bsearch() binary search on sorted array for present and missing elements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[10, 20, 30, 40, 50]' | jq -c '[bsearch(30), bsearch(35)]'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[2,-4]");
    });
  });

  it("6. jq transpose and combinations on 2D matrices", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '[[1,2,3],[4,5,6]]' | jq -c 'transpose'\nprintf '[[\"a\",\"b\"],[1,2]]' | jq -c '[combinations]'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[[1,4],[2,5],[3,6]]\n[[\"a\",1],[\"a\",2],[\"b\",1],[\"b\",2]]");
    });
  });

  it("7. jq group_by, unique_by, min_by, and max_by on telemetry records", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/tel.json\n[{\"region\":\"us\",\"lat\":40},{\"region\":\"eu\",\"lat\":15},{\"region\":\"us\",\"lat\":25},{\"region\":\"ap\",\"lat\":60}]\nEOF\njq -c '{min: min_by(.lat).region, max: max_by(.lat).region, uniq: (unique_by(.region) | map(.region))}' /tmp/tel.json");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"min\":\"eu\",\"max\":\"ap\",\"uniq\":[\"ap\",\"eu\",\"us\"]}");
    });
  });

  it("8. jq regex capture with named groups, scan, sub, and gsub", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '\"2026-10-06T12:30:00Z [ERROR] code=503 retry=3\"' | jq -c 'capture(\"(?<date>[0-9-]+)T.*\\\\[(?<level>[A-Z]+)\\\\] code=(?<code>[0-9]+)\")'\nprintf '\"foo_123_bar_456\"' | jq -c '[scan(\"[0-9]+\")]'\nprintf '\"a  b   c\"' | jq -r 'gsub(\" + numeric?\"; \"-\")' >/dev/null 2>&1 || true\nprintf '\"a  b   c\"' | jq -r 'gsub(\" +\"; \"-\")'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"date\":\"2026-10-06\",\"level\":\"ERROR\",\"code\":\"503\"}\n[\"123\",\"456\"]\na-b-c");
    });
  });

  it("9. jq @base64, @base64d, @uri, @csv, @tsv, and @sh format strings", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"msg\":\"hello world\",\"arr\":[\"a,b\",\"c\"]}' | jq -r '(.msg | @base64), (.msg | @base64 | @base64d), (.msg | @uri), (.arr | @csv)'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "aGVsbG8gd29ybGQ=\nhello world\nhello%20world\n\"a,b\",\"c\"");
    });
  });

  it("10. jq todate and fromdate ISO-8601 epoch roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '1704067200' | jq -c '[todate, (todate | fromdate)]'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[\"2024-01-01T00:00:00Z\",1704067200]");
    });
  });

  it("11. jq recursive descent (..) with objects, arrays, scalars, numbers, strings, booleans, and nulls", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"a\":[1,\"x\",true,null,{\"b\":2}]}' | jq -c '{nums:[.. | numbers], strs:[.. | strings], bools:[.. | booleans], nulls:[.. | nulls | \"N\"]}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"nums\":[1,2],\"strs\":[\"x\"],\"bools\":[true],\"nulls\":[\"N\"]}");
    });
  });

  it("12. jq --slurp (-s), --null-input (-n), --arg, and --argjson composition", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"v\":10}\\n{\"v\":20}\\n{\"v\":30}\\n' | jq -s -c --arg env prod --argjson mult 2 '{env: $env, total: (map(.v * $mult) | add)}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"env\":\"prod\",\"total\":120}");
    });
  });

  it("13. jq with_entries, to_entries, and from_entries key prefixing and value filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '{\"host\":\"db\",\"port\":5432,\"debug\":null}' | jq -c 'with_entries(select(.value != null) | .key = \"APP_\" + (.key | ascii_upcase))'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"APP_HOST\":\"db\",\"APP_PORT\":5432}");
    });
  });

  it("14. yq YAML anchor (&) and merge key (<<: *) expansion via explode(.)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/anchors.yaml\ndefaults: &def\n  timeout: 30\n  retries: 3\nservice:\n  <<: *def\n  retries: 5\n  name: worker\nEOF\nyq -o=json 'explode(.) | .service' /tmp/anchors.yaml | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"timeout\":30,\"retries\":5,\"name\":\"worker\"}");
    });
  });

  it("15. yq env() and strenv() environment variable injection into YAML document", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/deploy.yaml\napp:\n  tag: v1\n  replicas: 1\nEOF\nTAG_VAL=v2.4.0 REP_NUM=4 yq -o=json '.app.tag = strenv(TAG_VAL) | .app.replicas = env(REP_NUM)' /tmp/deploy.yaml | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"app\":{\"tag\":\"v2.4.0\",\"replicas\":4}}");
    });
  });

  it("16. yq in-place (-i) file modification and multi-key deletion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/inplace.yaml\nserver:\n  host: 127.0.0.1\n  port: 8000\n  legacy: true\nEOF\nyq -i '.server.port = 9000 | del(.server.legacy)' /tmp/inplace.yaml\nyq -o=json '.' /tmp/inplace.yaml | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"server\":{\"host\":\"127.0.0.1\",\"port\":9000}}");
    });
  });

  it("17. yq properties (-o=props / -p=props) roundtrip conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/cfg.yaml\ndb:\n  host: pg.internal\n  port: 5432\nEOF\nyq -o=props '.' /tmp/cfg.yaml > /tmp/cfg.properties\ngrep -E '^db\\.(host|port)' /tmp/cfg.properties\nyq -p=props -o=json '.' /tmp/cfg.properties | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "db.host = pg.internal\ndb.port = 5432\n{\"db\":{\"host\":\"pg.internal\",\"port\":\"5432\"}}");
    });
  });

  it("18. yq TOML (-p=toml / -o=toml) parsing and filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/Cargo.toml\n[package]\nname = \"safe-bash\"\nversion = \"0.1.0\"\nEOF\nyq -p=toml -o=json '.package' /tmp/Cargo.toml | jq -c .");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "{\"name\":\"safe-bash\",\"version\":\"0.1.0\"}");
    });
  });

  it("19. yq CSV/TSV output (-o=csv and -o=tsv) from YAML array of objects", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' > /tmp/users.yaml\n- id: 1\n  name: alice\n- id: 2\n  name: bob\nEOF\nyq -o=csv '.' /tmp/users.yaml\nyq -o=tsv '.' /tmp/users.yaml");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "id,name\n1,alice\n2,bob\nid\tname\n1\talice\n2\tbob");
    });
  });

  it("20. jq INDEX() lookup table join with streaming log enrichment", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'EOF' | jq -c 'INDEX(.users[]; .id) as $idx | [.events[] | {id: .uid, user: $idx[.uid].name, action: .act}]'\n{\"users\":[{\"id\":\"u1\",\"name\":\"Alice\"},{\"id\":\"u2\",\"name\":\"Bob\"}],\"events\":[{\"uid\":\"u2\",\"act\":\"login\"},{\"uid\":\"u1\",\"act\":\"deploy\"}]}\nEOF");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[{\"id\":\"u2\",\"user\":\"Bob\",\"action\":\"login\"},{\"id\":\"u1\",\"user\":\"Alice\",\"action\":\"deploy\"}]");
    });
  });

});
