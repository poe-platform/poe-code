import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jq, yq, xq, xmllint, and htmlq deep filter matrix", () => {
  test("1. jq flatten(depth) vs unbounded flatten on deeply nested jagged arrays", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '[1,[2,[3,[4]]],5]' | jq -c '[flatten(1), flatten(2), flatten]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[[1,2,[3,[4]],5],[1,2,3,[4],5],[1,2,3,4,5]]\n");
    });
  });

  test("2. jq 1-arg and 2-arg any(...) and all(...) generator predicates", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '[1,3,5,7]' | jq -c '[any(.[]; . > 4), any(.[]; . > 10), all(.[]; . % 2 == 1), all(.[]; . < 7), ([false, true] | any), ([true, true] | all)]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[true,false,true,false,true,true]\n");
    });
  });

  test("3. jq 1-arg, 2-arg, and 3-arg range(from; upto; by) with positive and negative steps", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `jq -nc '[[range(4)], [range(2; 6)], [range(0; 10; 3)], [range(10; 2; -3)]]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[[0,1,2,3],[2,3,4,5],[0,3,6,9],[10,7,4]]\n");
    });
  });

  test("4. jq while(cond; update) and until(cond; next) iterative generators", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `jq -nc '[[1 | while(. < 16; . * 2)], (1 | until(. >= 16; . * 2))]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[[1,2,4,8],16]\n");
    });
  });

  test("5. jq limit(n; expr), first(expr), last(expr), and nth(n; expr) stream slicing", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `jq -nc '[[limit(3; range(10; 20))], first(range(5; 9)), last(range(5; 9)), nth(2; range(10; 15))]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[[10,11,12],5,8,12]\n");
    });
  });

  test("6. jq bsearch(target) hit and insertion-point miss indices", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '[10,20,30,40]' | jq -c '[bsearch(10), bsearch(30), bsearch(25), bsearch(5)]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[0,2,-3,-1]\n");
    });
  });

  test("7. jq explode and implode codepoint Caesar shift pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '"ABC-xyz"' | jq -c 'explode | map(if . >= 65 and . <= 90 then . + 32 else . end) | implode'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '"abc-xyz"\n');
    });
  });

  test("8. jq tojson and fromjson round-trip with nested objects and arrays", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"a":[1,2,3],"b":{"k":"v"}}' | jq -c 'tojson | fromjson | [(.a | add), .b.k]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '[6,"v"]\n');
    });
  });

  test("9. jq alternative operator // distinguishing false and null from truthy values", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"a":false,"b":null,"c":0,"d":""}' | jq -c '[.a // "fallback", .b // "fallback", .c // "fallback", .d // "fallback", .missing // "fallback"]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["fallback","fallback",0,"","fallback"]\n');
    });
  });

  test("10. jq del(...) with multiple nested path expressions", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"a":1,"b":{"x":2,"y":3},"c":4}' | jq -c 'del(.a, .b.x)'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"b":{"y":3},"c":4}\n');
    });
  });

  test("11. jq contains(...) and inside(...) recursive structural inclusion", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"a":[1,2,3],"b":[2,3]}' | jq -c '[(.a | contains([2,3])), (.b | inside([1,2,3])), (.b | contains([1,2]))]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[true,true,false]\n");
    });
  });

  test("12. jq INDEX(stream; idx_expr) and IN(stream) lookup table construction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '[{"id":"a","v":10},{"id":"b","v":20}]' | jq -c 'INDEX(.[]; .id) | [."a".v, ."b".v, ("b" | IN("a","b","c")), ("z" | IN("a","b","c"))]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[10,20,true,false]\n");
    });
  });

  test("13. jq with_entries key/value compound update assignments", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"a":1,"b":2}' | jq -c 'with_entries(.key |= "k_" + . | .value *= 10)'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"k_a":10,"k_b":20}\n');
    });
  });

  test("14. jq walk(f) bottom-up recursive tree transformation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"a":[1,{"b":2}]}' | jq -c 'walk(if type == "number" then . * 10 else . end)'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '{"a":[10,{"b":20}]}\n');
    });
  });

  test("15. jq transpose and combinations matrix Cartesian product", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `jq -nc '[([[1,2,3],[4,5,6]] | transpose), [([[1,2],["a","b"]] | combinations)]]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[[[1,4],[2,5],[3,6]],[[1,"a"],[1,"b"],[2,"a"],[2,"b"]]]\n'
      );
    });
  });

  test("16. jq string filters ascii_upcase, ascii_downcase, ltrimstr, rtrimstr, gsub, and capture", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `jq -nc '[("AbC-123" | ascii_upcase, ascii_downcase), ("pre_body_suf" | ltrimstr("pre_") | rtrimstr("_suf")), ("2026-10-06" | gsub("-"; "/")), ("2026-10-06" | capture("(?<y>[0-9]{4})-(?<m>[0-9]{2})-(?<d>[0-9]{2})"))]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '["ABC-123","abc-123","body","2026/10/06",{"y":"2026","m":"10","d":"06"}]\n'
      );
    });
  });

  test("17. jq reduce and foreach accumulators with extract expression", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `jq -nc '[(reduce range(1; 5) as $x (1; . * $x)), [foreach range(1; 5) as $x (0; . + $x; . * 10)]]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[24,[10,30,60,100]]\n");
    });
  });

  test("18. jq paths(scalars), getpath, setpath, and format strings (@uri, @base64, @base64d, @csv, @tsv)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf '{"a":{"b":[10,20]}}' | jq -c '[paths(scalars), getpath(["a","b",1]), (setpath(["a","b",0]; 99) | .a.b), ("a b+c" | @uri), ("hello" | @base64 | @base64d), (["x,y", 2] | @csv), (["a","b"] | @tsv)]'`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '[["a","b",0],["a","b",1],20,[99,20],"a%20b%2Bc","hello","\\"x,y\\",2","a\\tb"]\n'
      );
    });
  });

  test("19. yq in-place YAML mutation and TOML-to-JSON conversion piped to jq", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'YAML' > /tmp/cfg.yaml",
          "app:",
          "  name: poe",
          "  retries: 2",
          "YAML",
          "yq -i '.app.retries = 5 | .app.enabled = true' /tmp/cfg.yaml",
          "cat <<'TOML' > /tmp/Cargo.toml",
          "[package]",
          'name = "safe-bash"',
          'version = "1.2.0"',
          "TOML",
          "printf '%s|%s\\n' \"$(yq -o=json '.' /tmp/cfg.yaml | jq -c '.')\" \"$(yq -p=toml -o=json '.' /tmp/Cargo.toml | jq -r '.package.name + \"@\" + .package.version')\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        '{"app":{"name":"poe","retries":5,"enabled":true}}|safe-bash@1.2.0\n'
      );
    });
  });

  test("20. xq XML-to-JSON, xmllint --xpath string extraction, and htmlq --remove-nodes + --attribute pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<'XML' > /tmp/doc.xml",
          '<catalog><book id="b1"><title>Rust</title></book><book id="b2"><title>TS</title></book></catalog>',
          "XML",
          "cat <<'HTML' > /tmp/page.html",
          '<div class="card"><span class="noise">ignore</span><a href="/docs/api" data-tier="pro">API Docs</a></div>',
          "HTML",
          "XQ_OUT=$(xq -c '.catalog.book | map(.\"@id\" + \"=\" + .title)' /tmp/doc.xml)",
          "XPATH_OUT=$(xmllint --xpath 'string(//book[@id=\"b2\"]/title)' /tmp/doc.xml)",
          "HREF_OUT=$(htmlq --attribute href 'a[data-tier]' --filename /tmp/page.html)",
          "TEXT_OUT=$(htmlq --text --remove-nodes '.noise' '.card' --filename /tmp/page.html | tr -d '\\n')",
          'printf "%s|%s|%s|%s\\n" "$XQ_OUT" "$XPATH_OUT" "$HREF_OUT" "$TEXT_OUT"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["b1=Rust","b2=TS"]|TS|/docs/api|API Docs\n');
    });
  });
});
