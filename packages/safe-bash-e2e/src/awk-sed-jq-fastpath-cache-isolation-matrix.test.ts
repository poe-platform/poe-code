import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("safe-bash e2e: awk, sed, and jq complex program & fast-path matrix", () => {
  it("01. awk user-defined recursive and iterative functions with local shadow parameters", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/nums.txt": ["5", "7", "10", "12"].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "awk '",
        "function gcd(a, b,    t) {",
        "  while (b != 0) { t = b; b = a % b; a = t }",
        "  return a",
        "}",
        "function fact(n) {",
        "  return (n <= 1) ? 1 : n * fact(n - 1)",
        "}",
        "{",
        "  n = $1 + 0",
        "  f = fact(n)",
        "  g = gcd(n, 12)",
        "  printf \"%d:fact=%d,gcd12=%d\\n\", n, f, g",
        "}' /work/nums.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "5:fact=120,gcd12=1",
        "7:fact=5040,gcd12=1",
        "10:fact=3628800,gcd12=2",
        "12:fact=479001600,gcd12=12",
        "",
      ].join("\n"),
    );
  });

  it("02. awk multi-file FNR/NR tracking, FILENAME transitions, and multidimensional SUBSEP aggregation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/q1.csv": ["east,hw,100", "west,sw,250", "east,sw,150"].join("\n") + "\n",
        "/work/q2.csv": ["east,hw,200", "west,hw,125", "west,sw,75"].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "awk -F, '",
        "FNR == 1 { file_count++ }",
        "{",
        "  grid[$1, $2] += $3",
        "  regions[$1] = 1",
        "  cats[$2] = 1",
        "}",
        "END {",
        "  printf \"files=%d,rows=%d\\n\", file_count, NR",
        "  for (r in regions) {",
        "    for (c in cats) {",
        "      printf \"%s:%s=%d\\n\", r, c, grid[r, c] + 0",
        "    }",
        "  }",
        "}' /work/q1.csv /work/q2.csv | sort",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "east:hw=300",
        "east:sw=150",
        "files=2,rows=6",
        "west:hw=125",
        "west:sw=325",
        "",
      ].join("\n"),
    );
  });

  it("03. awk split(), sub(), gsub(), match() with RSTART/RLENGTH, and sprintf formatting", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/logs.txt": [
          "req_id=ab-1042 status=200 latency=14ms tags=api|auth|v2",
          "req_id=cd-2099 status=503 latency=128ms tags=api|billing",
          "req_id=ef-3100 status=200 latency=7ms tags=web|static|cdn|edge",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "awk '{",
        "  id = \"\"; ms = 0; tcount = 0",
        "  if (match($0, /req_id=[a-z]+-[0-9]+/)) {",
        "    id = substr($0, RSTART + 7, RLENGTH - 7)",
        "  }",
        "  line = $0",
        "  sub(/^.*latency=/, \"\", line)",
        "  sub(/ms.*$/, \"\", line)",
        "  ms = line + 0",
        "  tags = $4",
        "  sub(/^tags=/, \"\", tags)",
        "  tcount = split(tags, arr, \"|\")",
        "  printf \"%s|%04d|%d|%s\\n\", id, ms, tcount, arr[tcount]",
        "}' /work/logs.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "ab-1042|0014|3|v2",
        "cd-2099|0128|2|billing",
        "ef-3100|0007|4|edge",
        "",
      ].join("\n"),
    );
  });

  it("04. awk range patterns (/start/,/end/), next statement, and delete array elements", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/blocks.txt": [
          "HEADER ignore",
          "BEGIN_BLOCK",
          "keep alpha 10",
          "skip beta 99",
          "keep gamma 25",
          "END_BLOCK",
          "outside delta 50",
          "BEGIN_BLOCK",
          "keep alpha 15",
          "keep epsilon 40",
          "END_BLOCK",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "awk '",
        "/^BEGIN_BLOCK$/,/^END_BLOCK$/ {",
        "  if ($1 == \"BEGIN_BLOCK\" || $1 == \"END_BLOCK\") next",
        "  if ($1 == \"skip\") { seen[$2] = -1; next }",
        "  seen[$2] += $3",
        "}",
        "END {",
        "  delete seen[\"beta\"]",
        "  for (k in seen) print k \"=\" seen[k]",
        "}' /work/blocks.txt | sort",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, ["alpha=25", "epsilon=40", "gamma=25", ""].join("\n"));
  });

  it("05. awk getline from file and pipe into variable with field re-splitting ($1..$NF mutation)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lookup.txt": ["u100 Alice", "u200 Bob", "u300 Carol"].join("\n") + "\n",
        "/work/events.txt": ["u200 login", "u100 upload", "u300 logout", "u200 purchase"].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "awk '",
        "BEGIN {",
        "  while ((getline line < \"/work/lookup.txt\") > 0) {",
        "    split(line, parts, \" \")",
        "    names[parts[1]] = parts[2]",
        "  }",
        "  close(\"/work/lookup.txt\")",
        "  OFS = \"::\"",
        "}",
        "{",
        "  $1 = names[$1]",
        "  $3 = NR",
        "  print $0",
        "}' /work/events.txt",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "Bob::login::1",
        "Alice::upload::2",
        "Carol::logout::3",
        "Bob::purchase::4",
        "",
      ].join("\n"),
    );
  });

  it("06. awk -v variable bindings across consecutive invocations with distinct values", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/items.txt": ["apple:10", "banana:20", "cherry:30"].join("\n") + "\n",
      },
    });
    const r1 = await h.exec("awk -F: -v mult=2 -v prefix=A '{ printf \"%s:%s=%d\\n\", prefix, $1, $2 * mult }' /work/items.txt");
    const r2 = await h.exec("awk -F: -v mult=5 -v prefix=B '{ printf \"%s:%s=%d\\n\", prefix, $1, $2 * mult }' /work/items.txt");
    assert.equal(r1.exitCode, 0, r1.stderr);
    assert.equal(r2.exitCode, 0, r2.stderr);
    assert.equal(r1.stdout, ["A:apple=20", "A:banana=40", "A:cherry=60", ""].join("\n"));
    assert.equal(r2.stdout, ["B:apple=50", "B:banana=100", "B:cherry=150", ""].join("\n"));
  });

  it("07. sed hold space state machine (h, H, g, G, x) reversing paragraph lines and joining blocks", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lines.txt": ["first", "second", "third", "fourth"].join("\n") + "\n",
      },
    });
    const res = await h.exec("sed -n '1!G; h; $p' /work/lines.txt");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, ["fourth", "third", "second", "first", ""].join("\n"));
  });

  it("08. sed branch labels (:loop, b, t) iteratively collapsing nested parentheses and normalizing whitespace", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/nested.txt": [
          "alpha (remove (deeply (nested) comment) here) omega",
          "keep [brackets] (strip (inner) parens) end",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      "sed -E ':loop; s/\\([^()]*\\)//g; t loop; s/  +/ /g' /work/nested.txt",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "alpha omega",
        "keep [brackets] end",
        "",
      ].join("\n"),
    );
  });

  it("09. sed two-line window processing (N, P, D) joining continuation lines ending with backslash", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/Makefile.frag": [
          "CFLAGS = -Wall \\",
          "  -Wextra \\",
          "  -O2",
          " LDFLAGS = -lm",
          "SRCS = main.c \\",
          "  util.c",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      "sed -E ':join; /\\\\$/ { N; s/[[:space:]]*\\\\\\n[[:space:]]*/ /; b join }' /work/Makefile.frag",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "CFLAGS = -Wall -Wextra -O2",
        " LDFLAGS = -lm",
        "SRCS = main.c util.c",
        "",
      ].join("\n"),
    );
  });

  it("10. sed address ranges, negated addresses (!), y/// transliteration, and = line numbering", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/code.txt": [
          "BEGIN",
          "abc-123",
          "def-456",
          "END",
          "xyz-789",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      "sed -e '/^BEGIN$/,/^END$/ { /^BEGIN$/d; /^END$/d; y/abcdef/ABCDEF/; }' -e '/^xyz/ s/789/000/' /work/code.txt",
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "ABC-123",
        "DEF-456",
        "xyz-000",
        "",
      ].join("\n"),
    );
  });

  it("11. sed -i in-place editing across multiple files with insert (i), append (a), and change (c)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.conf": ["port=8080", "mode=dev", "debug=true"].join("\n") + "\n",
        "/work/b.conf": ["port=9090", "mode=dev", "debug=false"].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "sed -i -e '1i\\# Managed config' -e '/^mode=dev$/c\\mode=production' -e '$a\\# EOF' /work/a.conf /work/b.conf",
        "cat /work/a.conf",
        "echo '---'",
        "cat /work/b.conf",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "# Managed config",
        "port=8080",
        "mode=production",
        "debug=true",
        "# EOF",
        "---",
        "# Managed config",
        "port=9090",
        "mode=production",
        "debug=false",
        "# EOF",
        "",
      ].join("\n"),
    );
  });

  it("12. jq reduce, foreach, and custom recursive functions over hierarchical trees", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/tree.json": JSON.stringify({
          name: "root",
          size: 10,
          children: [
            {
              name: "src",
              size: 5,
              children: [
                { name: "main.rs", size: 120, children: [] },
                { name: "lib.rs", size: 80, children: [] },
              ],
            },
            {
              name: "tests",
              size: 5,
              children: [{ name: "e2e.rs", size: 200, children: [] }],
            },
          ],
        }),
      },
    });
    const res = await h.exec(
      `jq -c '{
        total_size: ([.. | objects | .size // 0] | add),
        leaf_names: [.. | objects | select((.children | length) == 0) | .name] | sort,
        running_totals: [foreach (.. | objects | select((.children | length) == 0) | .size) as $s (0; . + $s; .)]
      }' /work/tree.json`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {
      total_size: 420,
      leaf_names: ["e2e.rs", "lib.rs", "main.rs"],
      running_totals: [120, 200, 400],
    });
  });

  it("13. jq group_by, INDEX, JOIN, transpose, and to_entries/from_entries reshaping", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/users.json": JSON.stringify([
          { id: "u1", dept: "eng", name: "Ada" },
          { id: "u2", dept: "eng", name: "Linus" },
          { id: "u3", dept: "ops", name: "Grace" },
        ]),
        "/work/scores.json": JSON.stringify([
          { uid: "u1", score: 95 },
          { uid: "u2", score: 88 },
          { uid: "u3", score: 92 },
        ]),
      },
    });
    const res = await h.exec(
      `jq -s -c '
        (reduce .[0][] as $u ({}; .[$u.id] = $u)) as $users
        | .[1]
        | map(. + { dept: $users[.uid].dept, name: $users[.uid].name })
        | group_by(.dept)
        | map({
            dept: .[0].dept,
            members: map(.name) | sort,
            avg: ((map(.score) | add) / length)
          })
      ' /work/users.json /work/scores.json`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), [
      { dept: "eng", members: ["Ada", "Linus"], avg: 91.5 },
      { dept: "ops", members: ["Grace"], avg: 92 },
    ]);
  });

  it("14. jq path expressions, getpath, setpath, delpaths, and |= structural updates", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/config.json": JSON.stringify({
          services: {
            api: { port: 8080, secret: "s1", retries: 2 },
            worker: { port: 9090, secret: "s2", retries: 5 },
          },
          meta: { env: "staging", debug: true },
        }),
      },
    });
    const res = await h.exec(
      `jq -c '
        delpaths([paths | select(.[-1] == "secret")])
        | (.services[].retries) |= (. * 2)
        | setpath(["meta", "env"]; "prod")
      ' /work/config.json`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {
      services: {
        api: { port: 8080, retries: 4 },
        worker: { port: 9090, retries: 10 },
      },
      meta: { env: "prod", debug: true },
    });
  });

  it("15. jq format strings (@base64, @base64d, @uri, @csv, @tsv, @json, @sh)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/row.json": JSON.stringify({
          user: "alice & bob",
          token: "sec:123",
          cols: ["a,b", "c\"d", 42],
        }),
      },
    });
    const res = await h.exec(
      `jq -c '{
        b64: (.token | @base64),
        b64_roundtrip: (.token | @base64 | @base64d),
        uri: (.user | @uri),
        csv: (.cols | @csv),
        tsv: (["x", "y", "z"] | @tsv)
      }' /work/row.json`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {
      b64: "c2VjOjEyMw==",
      b64_roundtrip: "sec:123",
      uri: "alice%20%26%20bob",
      csv: "\"a,b\",\"c\"\"d\",42",
      tsv: "x\ty\tz",
    });
  });

  it("16. jq --arg, --argjson, and try/catch error recovery on heterogeneous NDJSON streams", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/events.ndjson": [
          JSON.stringify({ id: 1, payload: "{\"ok\":true,\"val\":10}" }),
          JSON.stringify({ id: 2, payload: "corrupt-json{" }),
          JSON.stringify({ id: 3, payload: "{\"ok\":false,\"val\":35}" }),
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      `jq -c --arg env "prod" --argjson bonus 5 '
        {
          id,
          env: $env,
          parsed: (try (.payload | fromjson | { ok, total: (.val + $bonus) }) catch { ok: false, error: "bad_json" })
        }
      ' /work/events.ndjson`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    const rows = res.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows, [
      { id: 1, env: "prod", parsed: { ok: true, total: 15 } },
      { id: 2, env: "prod", parsed: { ok: false, error: "bad_json" } },
      { id: 3, env: "prod", parsed: { ok: false, total: 40 } },
    ]);
  });

  it("17. combined awk -> sed -> jq pipeline transforming unstructured log lines into structured summary JSON", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/access.log": [
          "2026-03-01T10:00:01Z GET /api/v1/users 200 12",
          "2026-03-01T10:00:02Z POST /api/v1/orders 201 45",
          "2026-03-01T10:00:03Z GET /api/v1/users 500 130",
          "2026-03-01T10:00:04Z DELETE /api/v1/cache 204 4",
          "2026-03-01T10:00:05Z POST /api/v1/orders 201 55",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "awk '{ printf \"%s\\t%s\\t%d\\t%d\\n\", $2, $3, $4, $5 }' /work/access.log",
        "| sed -E 's#/api/v1/##g'",
        "| jq -R -s '",
        "  split(\"\\n\") | map(select(length > 0) | split(\"\\t\") | {",
        "    method: .[0],",
        "    route: .[1],",
        "    status: (.[2] | tonumber),",
        "    ms: (.[3] | tonumber)",
        "  })",
        "  | group_by(.route)",
        "  | map({",
        "      route: .[0].route,",
        "      count: length,",
        "      max_ms: (map(.ms) | max),",
        "      errors: (map(select(.status >= 500)) | length)",
        "    })",
        "'",
      ].join(" "),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), [
      { route: "cache", count: 1, max_ms: 4, errors: 0 },
      { route: "orders", count: 2, max_ms: 55, errors: 0 },
      { route: "users", count: 2, max_ms: 130, errors: 1 },
    ]);
  });

  it("18. jq -> awk -> sed pipeline generating and formatting a Markdown report table from JSON", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/metrics.json": JSON.stringify([
          { crate: "safe-bash-lexer", loc: 1450, tests: 92 },
          { crate: "safe-bash-parser", loc: 3120, tests: 184 },
          { crate: "safe-bash-eval", loc: 4890, tests: 310 },
        ]),
      },
    });
    const res = await h.exec(
      [
        "jq -r '.[] | [.crate, .loc, .tests] | @tsv' /work/metrics.json",
        "| awk -F'\\t' 'BEGIN { print \"| Crate | LOC | Tests |\"; print \"|---|---|---|\" } { printf \"| %s | %d | %d |\\n\", $1, $2, $3; loc+=$2; t+=$3 } END { printf \"| TOTAL | %d | %d |\\n\", loc, t }'",
        "| sed 's/safe-bash-/sb-/g'",
      ].join(" "),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "| Crate | LOC | Tests |",
        "|---|---|---|",
        "| sb-lexer | 1450 | 92 |",
        "| sb-parser | 3120 | 184 |",
        "| sb-eval | 4890 | 310 |",
        "| TOTAL | 9460 | 586 |",
        "",
      ].join("\n"),
    );
  });

  it("19. sed w flag writing matched lines to a sidecar file while transforming primary stdout", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/mixed.log": [
          "INFO boot complete",
          "WARN disk 85%",
          "ERROR db timeout",
          "INFO health ok",
          "ERROR auth rejected",
        ].join("\n") + "\n",
      },
    });
    const res = await h.exec(
      [
        "sed -e '/^ERROR /w /work/errors.only' -e 's/^INFO /[OK] /' /work/mixed.log > /work/transformed.log",
        "cat /work/errors.only",
        "echo '==='",
        "grep '^\\[OK\\]' /work/transformed.log",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "ERROR db timeout",
        "ERROR auth rejected",
        "===",
        "[OK] boot complete",
        "[OK] health ok",
        "",
      ].join("\n"),
    );
  });

  it("20. awk BEGIN/END-only computation with math builtins (sin, cos, atan2, sqrt, int, log, exp) and OFMT/CONVFMT", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "awk 'BEGIN {",
        "  pi = 4 * atan2(1, 1)",
        "  s = sin(pi / 2)",
        "  c = cos(0)",
        "  r = sqrt(144)",
        "  e = int(log(exp(7)) + 0.5)",
        "  printf \"pi=%.5f,s=%.1f,c=%.1f,r=%d,e=%d\\n\", pi, s, c, r, e",
        "}'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "pi=3.14159,s=1.0,c=1.0,r=12,e=7\n");
  });
});
