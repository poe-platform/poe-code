import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash E2E: jq, yq, and xq complex queries and polyglot pipelines", () => {
  it("1. jq executes custom parameterized def functions and higher-order filter arguments", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -c '
          def fact($n): reduce range(1; $n + 1) as $i (1; . * $i);
          def apply_twice(f): f | f;
          def clamp($lo; $hi): if . < $lo then $lo elif . > $hi then $hi else . end;
          {
            fact6: fact(6),
            bumped: ([1, 2, 3] | map(apply_twice(. + 10))),
            clamped: ([-5, 4, 15] | map(clamp(0; 10)))
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, '{"fact6":720,"bumped":[21,22,23],"clamped":[0,4,10]}\n');
    });
  });

  it("2. jq evaluates stateful reduce and streaming foreach generators", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -c '
          {
            sum_sq: (reduce (1, 2, 3, 4) as $x (0; . + ($x * $x))),
            running_sums: [foreach (10, 20, 30, 40) as $x (0; . + $x; {item: $x, cumulative: .})]
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"sum_sq":30,"running_sums":[{"item":10,"cumulative":10},{"item":20,"cumulative":30},{"item":30,"cumulative":60},{"item":40,"cumulative":100}]}\n'
      );
    });
  });

  it("3. jq traverses and transforms arbitrary tree depths with .., recurse, and walk()", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf '{"auth":{"password":"s3cr3t","user":"alice"},"nested":[{"token":"tok_123","id":1}]}\n' \
          | jq -c '
            walk(
              if type == "object" then
                with_entries(if (.key == "password" or .key == "token") then .value = "[REDACTED]" else . end)
              else . end
            )
          '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"auth":{"password":"[REDACTED]","user":"alice"},"nested":[{"token":"[REDACTED]","id":1}]}\n'
      );
    });
  });

  it("4. jq computes and mutates paths with paths, getpath(), setpath(), delpaths(), and |= updates", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf '{"a":{"b":[10,20,30],"keep":true}}\n' | jq -c '
          setpath(["a","b",1]; 99)
          | .a.b |= map(. + 1)
          | delpaths([["a","b",0]])
          | {doc: ., second: getpath(["a","b",1]), leaf_p: [paths(scalars)]}
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"doc":{"a":{"b":[100,31],"keep":true}},"second":31,"leaf_p":[["a","b",0],["a","b",1],["a","keep"]]}\n'
      );
    });
  });

  it("5. jq handles control flow: try/catch, ? suppression, label/break, limit, first, until, and while", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -c '
          {
            caught: (try (error("boom")) catch ("recovered:" + .)),
            optional: ([{}, {"x": 5}, 123] | map(.x? // "none")),
            halved: (16 | [while(. > 1; . / 2)] | length),
            collatz_steps: (27 | [while(. != 1; if . % 2 == 0 then . / 2 else 3 * . + 1 end)] | length),
            broken: [label $out | foreach range(1; 10) as $i (0; . + $i; if . > 10 then break $out else . end)]
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"caught":"recovered:boom","optional":["none",5,"none"],"halved":4,"collatz_steps":111,"broken":[1,3,6,10]}\n'
      );
    });
  });

  it("6. jq encodes and decodes strings with @base64, @base64d, @uri, @csv, @tsv, @sh, @json, and @html", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -r '
          ("hello rust & bash" | @base64 | @base64d),
          ("a b&c=1" | @uri),
          (["col,1", "col\"2", 42] | @csv),
          (["a", "b", "c"] | @tsv),
          ("<b>\"tag\" & \u0027quote\u0027</b>" | @html)
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "hello rust & bash",
          "a%20b%26c%3D1",
          '"col,1","col""2",42',
          "a\tb\tc",
          "&lt;b&gt;&quot;tag&quot; &amp; &apos;quote&apos;&lt;/b&gt;",
          ""
        ].join("\n")
      );
    });
  });

  it("7. jq executes regular expression builtins: capture, scan, gsub, splits, and indices", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -c '
          "release-v2.14.9-rc1" | {
            cap: capture("^release-v(?<major>[0-9]+)\\.(?<minor>[0-9]+)\\.(?<patch>[0-9]+)-(?<pre>.+)$"),
            nums: [scan("[0-9]+") | tonumber],
            parts: [splits("[-.]")],
            cleaned: gsub("[0-9]+"; "#"),
            dash_pos: indices("-")
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"cap":{"major":"2","minor":"14","patch":"9","pre":"rc1"},"nums":[2,14,9,1],"parts":["release","v2","14","9","rc1"],"cleaned":"release-v#.#.#-rc#","dash_pos":[7,15]}\n'
      );
    });
  });

  it("8. jq performs relational grouping and array analytics with group_by, unique_by, min_by, max_by, transpose, combinations, and bsearch", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -c '
          def events: [{"uid":2,"ev":"login","ms":25},{"uid":1,"ev":"push","ms":90},{"uid":2,"ev":"logout","ms":10}];
          {
            by_uid: (events | group_by(.uid) | map({uid: .[0].uid, count: length, total_ms: (map(.ms) | add)})),
            slowest: (events | max_by(.ms).ev),
            fastest: (events | min_by(.ms).ev),
            transposed: ([[1,2,3],[4,5,6]] | transpose),
            bsearch_hit: ([10,20,30,40,50] | bsearch(30)),
            combos: ([["a","b"],[1,2]] | [combinations])
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"by_uid":[{"uid":1,"count":1,"total_ms":90},{"uid":2,"count":2,"total_ms":35}],"slowest":"push","fastest":"logout","transposed":[[1,4],[2,5],[3,6]],"bsearch_hit":2,"combos":[["a",1],["a",2],["b",1],["b",2]]}\n'
      );
    });
  });

  it("9. jq binds external CLI variables via --arg, --argjson, --rawfile, --slurpfile, and -S sorted keys", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/items.json": '{"id":1}\n{"id":2}\n',
          "/workspace/banner.txt": "raw-header"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          jq -n -c -S \
            --arg env "prod" \
            --argjson replicas 3 \
            --slurpfile items /workspace/items.json \
            --rawfile banner /workspace/banner.txt \
            '{z_env: $env, a_replicas: $replicas, m_ids: ($items | map(.id)), b_banner: $banner}'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          '{"a_replicas":3,"b_banner":"raw-header","m_ids":[1,2],"z_env":"prod"}\n'
        );
      }
    );
  });

  it("10. jq formats and parses ISO-8601 UTC timestamps with todateiso8601 and fromdateiso8601", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -c '
          1704067200 | {
            iso: todateiso8601,
            roundtrip: (todateiso8601 | fromdateiso8601),
            plus_day: ((. + 86400) | todateiso8601)
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"iso":"2024-01-01T00:00:00Z","roundtrip":1704067200,"plus_day":"2024-01-02T00:00:00Z"}\n'
      );
    });
  });

  it("11. yq processes multi-document YAML streams and filters documents selectively", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/manifests.yaml": [
            "kind: Namespace",
            "metadata:",
            "  name: prod",
            "---",
            "kind: Deployment",
            "metadata:",
            "  name: api",
            "---",
            "kind: Service",
            "metadata:",
            "  name: api-svc",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          yq -o json -r 'select(.kind != "Namespace") | .kind + ":" + .metadata.name' /workspace/manifests.yaml
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "Deployment:api",
            "Service:api-svc",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("12. yq transforms YAML configurations using |=, +=, //=, and del() and outputs YAML", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/deploy.yaml": "service:\n  name: gateway\n  replicas: 1\n  deprecated: true\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          yq '
            .service.env = "production" |
            .service.replicas += 3 |
            del(.service.deprecated)
          ' /workspace/deploy.yaml > /workspace/deploy.updated.yaml
          yq -o json -I 0 '.' /workspace/deploy.updated.yaml
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          '{"service":{"name":"gateway","replicas":4,"env":"production"}}\n'
        );
      }
    );
  });

  it("13. yq parses TOML documents with -p toml and converts between TOML, YAML, and JSON", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/Cargo.toml": [
            "[package]",
            'name = "safe-bash-rs"',
            'version = "0.1.0"',
            'edition = "2024"',
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          yq -p toml -o yaml '.package' /workspace/Cargo.toml > /workspace/package.yaml
          yq -o json -I 0 '.' /workspace/package.yaml
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          '{"name":"safe-bash-rs","version":"0.1.0","edition":"2024"}\n'
        );
      }
    );
  });

  it("14. yq inspects and updates TOML workspace dependencies and feature tables", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/Cargo.toml": [
            "[package]",
            'name = "poe-agent"',
            'version = "1.2.0"',
            "",
            "[dependencies]",
            'serde = "1.0"',
            'tokio = "1.35"',
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          yq -p toml -o json -I 0 '.package.version = "1.3.0" | .dependencies.anyhow = "1.0" | {ver: .package.version, deps: .dependencies}' /workspace/Cargo.toml
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          '{"ver":"1.3.0","deps":{"serde":"1.0","tokio":"1.35","anyhow":"1.0"}}\n'
        );
      }
    );
  });

  it("15. xq extracts XML attributes and nested elements and converts XML documents to JSON", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/Pom.xml": [
            "<project>",
            "  <modelVersion>4.0.0</modelVersion>",
            "  <groupId>com.poe</groupId>",
            "  <artifactId>safe-bash</artifactId>",
            "  <dependencies>",
            '    <dependency scope="compile"><artifactId>core</artifactId><version>2.1</version></dependency>',
            '    <dependency scope="test"><artifactId>junit</artifactId><version>5.10</version></dependency>',
            "  </dependencies>",
            "</project>"
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xq -c '{
            group: .project.groupId,
            artifact: .project.artifactId,
            deps: [.project.dependencies.dependency[] | {id: .artifactId, ver: .version, scope: ."@scope"}]
          }' /workspace/Pom.xml
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          '{"group":"com.poe","artifact":"safe-bash","deps":[{"id":"core","ver":"2.1","scope":"compile"},{"id":"junit","ver":"5.10","scope":"test"}]}\n'
        );
      }
    );
  });

  it("16. validates version parity across package.json, Cargo.toml, Chart.yaml, and pom.xml", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/package.json": '{"name":"app","version":"3.4.0"}\n',
          "/workspace/Cargo.toml": '[package]\nname = "app"\nversion = "3.4.0"\n',
          "/workspace/Chart.yaml": "apiVersion: v2\nname: app\nversion: 3.4.0\n",
          "/workspace/pom.xml": "<project><name>app</name><version>3.4.0</version></project>\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          v_json=$(jq -r '.version' /workspace/package.json)
          v_toml=$(yq -p toml -o json -r '.package.version' /workspace/Cargo.toml)
          v_yaml=$(yq -o json -r '.version' /workspace/Chart.yaml)
          v_xml=$(xq -r '.project.version' /workspace/pom.xml)
          jq -n -c --arg j "$v_json" --arg t "$v_toml" --arg y "$v_yaml" --arg x "$v_xml" '
            [ $j, $t, $y, $x ] | { versions: unique, synced: (unique | length == 1) }
          '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, '{"versions":["3.4.0"],"synced":true}\n');
      }
    );
  });

  it("17. jq aggregates NDJSON logs using -s (--slurp) with reduce and histogram bucketing", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/events.ndjson": [
            '{"svc":"auth","ms":12,"ok":true}',
            '{"svc":"auth","ms":48,"ok":false}',
            '{"svc":"pay","ms":30,"ok":true}',
            '{"svc":"auth","ms":15,"ok":true}',
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          jq -s -c '
            reduce .[] as $ev (
              {total: 0, errors: 0, auth_ms: 0};
              .total += 1
              | if ($ev.ok | not) then .errors += 1 else . end
              | if $ev.svc == "auth" then .auth_ms += $ev.ms else . end
            )
          ' /workspace/events.ndjson
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, '{"total":4,"errors":1,"auth_ms":75}\n');
      }
    );
  });

  it("18. jq evaluates complex variable destructuring and alternative destructuring (?//)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        jq -n -c '
          [
            {"user": "alice", "scores": [10, 20]},
            ["bob", 99]
          ]
          | map(
              . as {"user": $u, "scores": [$first, $second]} ?// [$u, $first]
              | {u: $u, first: $first, second: ($second // 0)}
            )
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '[{"u":"alice","first":10,"second":20},{"u":"bob","first":99,"second":0}]\n'
      );
    });
  });

  it("19. yq patches multi-manifest Kubernetes YAML documents selectively by kind", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/k8s.yaml": [
            "apiVersion: apps/v1",
            "kind: Deployment",
            "metadata:",
            "  name: worker",
            "spec:",
            "  replicas: 2",
            "---",
            "apiVersion: v1",
            "kind: Service",
            "metadata:",
            "  name: worker-svc",
            "spec:",
            "  port: 80",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          yq '
            .metadata.labels.managedBy = "safe-bash" |
            (select(.kind == "Deployment") | .spec.replicas) = 5
          ' /workspace/k8s.yaml | yq -o json -I 0 '[.kind, .metadata.labels.managedBy, (.spec.replicas // .spec.port)]'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          '["Deployment","safe-bash",5]\n["Service","safe-bash",80]\n'
        );
      }
    );
  });

  it("20. executes an end-to-end xq -> jq -> sqlite3 -> yq YAML route compilation pipeline", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/routes.xml": [
            "<gateway>",
            "  <route><id>r1</id><path>/v1/chat</path><rpm>600</rpm><enabled>true</enabled></route>",
            "  <route><id>r2</id><path>/v1/models</path><rpm>1200</rpm><enabled>true</enabled></route>",
            "  <route><id>r3</id><path>/v1/legacy</path><rpm>10</rpm><enabled>false</enabled></route>",
            "</gateway>"
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          xq -r '.gateway.route[] | select(.enabled == "true") | [.id, .path, (.rpm | tonumber)] | @csv' /workspace/routes.xml > /workspace/active_routes.csv

          sqlite3 /workspace/gateway.db <<'SQL'
CREATE TABLE routes (id TEXT PRIMARY KEY, path TEXT, rpm INT);
.mode csv
.import /workspace/active_routes.csv routes
SQL

          sqlite3 -json /workspace/gateway.db "SELECT id, path, CAST(rpm AS INT) AS rpm FROM routes ORDER BY CAST(rpm AS INT) DESC;" \
            | jq '{routes: ., total_rpm: (map(.rpm) | add)}' \
            | yq -o yaml '.' > /workspace/gateway.yaml

          yq -o json -I 0 '{total_rpm: .total_rpm, top_route: .routes[0].id}' /workspace/gateway.yaml
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, '{"total_rpm":1800,"top_route":"r2"}\n');
      }
    );
  });
});
