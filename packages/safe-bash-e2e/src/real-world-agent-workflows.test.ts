import assert from "node:assert/strict";
import test from "node:test";
import { SafeBashE2EHarness, sb, withE2EHarness } from "./harness.js";

test("workflow 1: monorepo dependency graph extraction (find + jq) -> topological sort (tsort) -> formatted build plan (nl + column)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/packages/core/package.json": JSON.stringify({
          name: "@acme/core",
          dependencies: {},
        }),
        "/workspace/packages/lexer/package.json": JSON.stringify({
          name: "@acme/lexer",
          dependencies: { "@acme/core": "1.0.0" },
        }),
        "/workspace/packages/parser/package.json": JSON.stringify({
          name: "@acme/parser",
          dependencies: { "@acme/core": "1.0.0", "@acme/lexer": "1.0.0" },
        }),
        "/workspace/packages/cli/package.json": JSON.stringify({
          name: "@acme/cli",
          dependencies: { "@acme/parser": "1.0.0" },
        }),
      },
    },
    async (h) => {
      const script = [
        "find /workspace/packages -name 'package.json' | sort | xargs jq -r '. as $pkg | (($pkg.dependencies // {}) | keys[]) as $dep | \"\\($dep) \\($pkg.name)\"' | tsort > /workspace/order.txt",
        "nl -ba -w 1 -s ':' /workspace/order.txt | column -t -s ':' -o ' | '",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "1 | @acme/core",
          "2 | @acme/lexer",
          "3 | @acme/parser",
          "4 | @acme/cli",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 2: codebase symbol refactoring (rg -l -> sed -i.bak -> diff -u -> patch -R verification)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/src/a.ts": "import { legacyExec } from './core.js';\nexport const runA = () => legacyExec('ls');\n",
        "/workspace/src/b.ts": "import { helper } from './util.js';\nexport const runB = () => helper();\n",
        "/workspace/src/c.ts": "export const runC = () => legacyExec('pwd');\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace",
        "rg -l 'legacyExec' src/ | sort | xargs sed -i.bak 's/legacyExec/safeExec/g'",
        "rg -c 'legacyExec' src/*.ts || echo 'legacy_remaining:0'",
        "rg -c 'safeExec' src/a.ts src/c.ts | sort",
        "diff -u src/a.ts.bak src/a.ts > /workspace/a.patch || true",
        "cp src/a.ts /workspace/a_revert_test.ts",
        "patch -R -s /workspace/a_revert_test.ts /workspace/a.patch",
        "cmp -s src/a.ts.bak /workspace/a_revert_test.ts && echo 'rollback_verified:yes'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "legacy_remaining:0",
          "src/a.ts:2",
          "src/c.ts:1",
          "rollback_verified:yes",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 3: rotated log triage (gzip + xz -> zcat/xzcat -> jq -> sqlite3 aggregation -> wkhtmltopdf executive PDF)", async () => {
  const logBatch1 = [
    JSON.stringify({ svc: "auth", status: 502, latency_ms: 420 }),
    JSON.stringify({ svc: "auth", status: 200, latency_ms: 15 }),
    JSON.stringify({ svc: "gateway", status: 504, latency_ms: 980 }),
  ].join("\n") + "\n";

  const logBatch2 = [
    JSON.stringify({ svc: "gateway", status: 500, latency_ms: 620 }),
    JSON.stringify({ svc: "auth", status: 503, latency_ms: 580 }),
  ].join("\n") + "\n";

  await withE2EHarness(
    {
      files: {
        "/workspace/logs/batch1.jsonl": logBatch1,
        "/workspace/logs/batch2.jsonl": logBatch2,
      },
    },
    async (h) => {
      const script = [
        "gzip /workspace/logs/batch1.jsonl",
        "xz /workspace/logs/batch2.jsonl",
        "{ zcat /workspace/logs/batch1.jsonl.gz; xzcat /workspace/logs/batch2.jsonl.xz; } | jq -r 'select(.status >= 500) | [.svc, .status, .latency_ms] | @csv' | tr -d '\"' > /workspace/errors.csv",
        "sqlite3 /workspace/incident.db 'CREATE TABLE errs (svc TEXT, status INT, latency INT);'",
        "printf '.mode csv\\n.import /workspace/errors.csv errs\\n' | sqlite3 /workspace/incident.db",
        "rows=$(sqlite3 /workspace/incident.db 'SELECT svc, COUNT(*), CAST(AVG(latency) AS INT) FROM errs GROUP BY svc ORDER BY svc;' | tr '|' ':')",
        "printf '<html><body><h1>Incident Summary</h1><p>%s</p></body></html>\\n' \"$(echo \"$rows\" | paste -sd ' ' -)\" > /workspace/incident.html",
        "wkhtmltopdf -q /workspace/incident.html /workspace/incident.pdf",
        "pdftotext /workspace/incident.pdf - | grep -E '(auth|gateway):'",
      ].join("\n");

      const res = await h.exec(script);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /auth:2:500/);
      assert.match(res.stdout, /gateway:2:800/);
    },
  );
});

test("workflow 4: idempotent SQLite schema migration runner with SHA-256 tamper detection", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/migrations/001_init.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);\n",
        "/workspace/migrations/002_seed.sql": "INSERT INTO users (id, email) VALUES (1, 'admin@acme.dev');\n",
        "/workspace/migrate.sh": [
          "set -euo pipefail",
          "DB='/workspace/prod.db'",
          "sqlite3 \"$DB\" 'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, sha256 TEXT);'",
          "applied=0",
          "for f in /workspace/migrations/*.sql; do",
          "  name=$(basename \"$f\")",
          "  sum=$(sha256sum \"$f\" | awk '{ print $1 }')",
          "  existing=$(sqlite3 \"$DB\" \"SELECT sha256 FROM _migrations WHERE name = '$name';\")",
          "  if [ -n \"$existing\" ]; then",
          "    if [ \"$existing\" != \"$sum\" ]; then",
          "      echo \"TAMPER_DETECTED:$name\" >&2",
          "      exit 99",
          "    fi",
          "    continue",
          "  fi",
          "  sqlite3 \"$DB\" < \"$f\"",
          "  sqlite3 \"$DB\" \"INSERT INTO _migrations VALUES ('$name', '$sum');\"",
          "  applied=$((applied + 1))",
          "done",
          "printf 'applied=%d users=%s\\n' \"$applied\" \"$(sqlite3 \"$DB\" 'SELECT COUNT(*) FROM users;')\"",
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      await h.expectOk("bash /workspace/migrate.sh", "applied=2 users=1\n");
      await h.expectOk("bash /workspace/migrate.sh", "applied=0 users=1\n");

      // Tamper with an already-applied migration and verify exit code 99
      await h.writeText("/workspace/migrations/001_init.sql", "-- tampered\nCREATE TABLE users (id INT);\n");
      await h.expectFail("bash /workspace/migrate.sh", 99, /TAMPER_DETECTED:001_init\.sql/);
    },
  );
});

test("workflow 5: secret scanner (rg --json -> jq SARIF-like report) respecting .gitignore", async () => {
  await withE2EHarness(
    {
      directories: ["/workspace/repo/.git"],
      files: {
        "/workspace/repo/.gitignore": "node_modules/\n*.fixture.txt\n",
        "/workspace/repo/node_modules/pkg/key.js": "const k = 'AKIA_IGNORED_12345678';\n",
        "/workspace/repo/test.fixture.txt": "AKIA_FIXTURE_87654321\n",
        "/workspace/repo/src/client.ts": "const token = 'AKIA_LIVE_99887766';\n",
        "/workspace/repo/src/clean.ts": "export const ok = true;\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace/repo",
        "rg --json 'AKIA_[A-Z0-9_]+' | jq -s '[.[] | select(.type == \"match\") | { file: .data.path.text, line: .data.line_number, rule: \"AWS_KEY\" }]' > /workspace/findings.json",
        "jq -r 'length' /workspace/findings.json",
        "jq -r '.[0] | \"\\(.file):\\(.line):\\(.rule)\"' /workspace/findings.json",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "1",
          "src/client.ts:1:AWS_KEY",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 6: multi-format configuration drift detector across YAML, TOML, and JSON", async () => {
  const yamlCfg = [
    "database:",
    "  host: db.prod.internal",
    "  port: 5432",
    "  pool: 32",
    "",
  ].join("\n");

  const tomlCfg = [
    "[database]",
    'host = "db.prod.internal"',
    "port = 5432",
    "pool = 64",
    "",
  ].join("\n");

  const jsonCfg = JSON.stringify({
    database: {
      host: "db.prod.internal",
      port: 5432,
      pool: 32,
    },
  });

  await withE2EHarness(
    {
      files: {
        "/workspace/k8s.yaml": yamlCfg,
        "/workspace/Cargo.toml": tomlCfg,
        "/workspace/app.json": jsonCfg,
      },
    },
    async (h) => {
      const script = [
        "yq -o json '.database' /workspace/k8s.yaml | jq -r 'to_entries[] | \"\\(.key)=\\(.value)\"' | sort > /workspace/yaml.kv",
        "yq -p toml -o json '.database' /workspace/Cargo.toml | jq -r 'to_entries[] | \"\\(.key)=\\(.value)\"' | sort > /workspace/toml.kv",
        "jq -r '.database | to_entries[] | \"\\(.key)=\\(.value)\"' /workspace/app.json | sort > /workspace/json.kv",
        "cmp -s /workspace/yaml.kv /workspace/json.kv && echo 'yaml_json:match'",
        "comm -3 /workspace/yaml.kv /workspace/toml.kv | tr -d '\\t'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "yaml_json:match",
          "pool=32",
          "pool=64",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 7: deterministic release bundle creation and ReadOnlyFileSystem verification", async () => {
  const buildFs = new sb.MemoryFileSystem();
  const h = await SafeBashE2EHarness.create({
    fs: buildFs,
    files: {
      "/workspace/src/app.sh": "#!/bin/sh\n# debug comment\necho 'release-v1'\n",
      "/workspace/src/README.md": "# App v1.0\n",
    },
  });

  try {
    const buildScript = [
      "mkdir -p /workspace/dist",
      "grep -v '^# debug' /workspace/src/app.sh > /workspace/dist/app.sh",
      "chmod 755 /workspace/dist/app.sh",
      "cp /workspace/src/README.md /workspace/dist/README.md",
      "cd /workspace/dist && sha256sum app.sh README.md > SHA256SUMS",
      "tar -czf /workspace/release.tar.gz -C /workspace/dist .",
      "mkdir -p /workspace/verify",
      "tar -xzf /workspace/release.tar.gz -C /workspace/verify",
    ].join("\n");
    await h.expectOk(buildScript);

    const roFs = sb.createReadOnlyFileSystem(buildFs);
    const roHarness = await SafeBashE2EHarness.create({ fs: roFs, cwd: "/workspace/verify" });
    try {
      await roHarness.expectOk(
        "sha256sum -c SHA256SUMS && sh ./app.sh",
        ["app.sh: OK", "README.md: OK", "release-v1", ""].join("\n"),
      );
    } finally {
      await roHarness.dispose();
    }
  } finally {
    await h.dispose();
  }
});

test("workflow 8: CI quality gate combining JUnit XML (xmllint/xq) + coverage CSV (csvsql) + bc threshold check", async () => {
  const junit = [
    '<?xml version="1.0"?>',
    '<testsuite name="e2e" tests="120" failures="0" time="1.42"/>',
    "",
  ].join("\n");

  const coverageCsv = [
    "crate,covered,total",
    "safe-fs,950,1000",
    "safe-bash,1820,2000",
    "jq-engine,930,1000",
    "",
  ].join("\n");

  await withE2EHarness(
    {
      files: {
        "/workspace/junit.xml": junit,
        "/workspace/coverage.csv": coverageCsv,
      },
    },
    async (h) => {
      const script = [
        "failures=$(xmllint --xpath 'string(/testsuite/@failures)' /workspace/junit.xml)",
        "printf '.mode csv\\n.import /workspace/coverage.csv cov_tbl\\n' | sqlite3 /workspace/cov.db",
        "totals=$(sqlite3 /workspace/cov.db 'SELECT SUM(CAST(covered AS INT)), SUM(CAST(total AS INT)) FROM cov_tbl;')",
        "cov=$(echo \"$totals\" | cut -d'|' -f1)",
        "tot=$(echo \"$totals\" | cut -d'|' -f2)",
        "pct=$(echo \"scale=2; ($cov * 100) / $tot\" | bc)",
        "pass=$(echo \"if ($pct >= 90.00) { if ($failures == 0) 1 else 0 } else 0\" | bc)",
        "printf 'failures=%s coverage=%s%% gate_pass=%s\\n' \"$failures\" \"$pct\" \"$pass\"",
      ].join("\n");

      await h.expectOk(script, "failures=0 coverage=92.50% gate_pass=1\n");
    },
  );
});

test("workflow 9: speculative coding agent loop with apply_patch, test failure detection, VFS + Session rollback, and fix", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/math.sh": "add() {\n  echo $(( $1 + $2 ))\n}\n",
        "/workspace/test.sh": ". /workspace/math.sh\n[ \"$(add 3 4)\" = '7' ] && [ \"$(mul 3 4)\" = '12' ]\n",
      },
    },
    async (h) => {
    const session = h.shell.createSession();
    await session.exec("ATTEMPT=0");
    const checkpointState = JSON.parse(JSON.stringify(session.state));
    const checkpointMathBytes = await h.readBytes("/workspace/math.sh");

    // Attempt 1: Agent applies a buggy patch (uses + instead of * in mul)
    const badPatch = [
      "*** Begin Patch",
      "*** Update File: /workspace/math.sh",
      "@@",
      " add() {",
      "   echo $(( $1 + $2 ))",
      " }",
      "+mul() {",
      "+  echo $(( $1 + $2 ))",
      "+}",
      "*** End Patch",
    ].join("\n");
    await session.exec(`ATTEMPT=1; apply_patch >/dev/null <<'EOF'\n${badPatch}\nEOF`);
    const testAttempt1 = await session.exec("sh /workspace/test.sh");
    assert.notEqual(testAttempt1.exitCode, 0);

    // Rollback file bytes and session state
    await h.writeBytes("/workspace/math.sh", checkpointMathBytes);
    session.state = checkpointState;

    // Attempt 2: Agent applies the correct patch
    const goodPatch = [
      "*** Begin Patch",
      "*** Update File: /workspace/math.sh",
      "@@",
      " add() {",
      "   echo $(( $1 + $2 ))",
      " }",
      "+mul() {",
      "+  echo $(( $1 * $2 ))",
      "+}",
      "*** End Patch",
    ].join("\n");
    await session.exec(`ATTEMPT=$((ATTEMPT + 1)); apply_patch >/dev/null <<'EOF'\n${goodPatch}\nEOF`);
    const testAttempt2 = await session.exec("sh /workspace/test.sh && printf 'attempt=%s status=green\\n' \"$ATTEMPT\"");
    assert.equal(testAttempt2.exitCode, 0, testAttempt2.stderr);
    assert.equal(testAttempt2.stdout, "attempt=1 status=green\n");
    },
  );
});

test("workflow 10: documentation site link integrity crawler and Markdown search indexer", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/site/index.html": [
          "<html><body>",
          "  <h1>Docs Home</h1>",
          '  <a href="/guide.html">Guide</a>',
          '  <a href="/api.html">API</a>',
          '  <a href="/missing.html">Broken Link</a>',
          "</body></html>",
        ].join("\n"),
        "/workspace/site/guide.html": "<html><body><h1>User Guide</h1></body></html>\n",
        "/workspace/site/api.html": "<html><body><h1>API Reference</h1></body></html>\n",
      },
    },
    async (h) => {
      const script = [
        "for href in $(htmlq -a href 'a' -f /workspace/site/index.html); do",
        "  if [ -f \"/workspace/site${href}\" ]; then",
        "    echo \"OK:${href}\"",
        "  else",
        "    echo \"BROKEN:${href}\"",
        "  fi",
        "done",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "OK:/guide.html",
          "OK:/api.html",
          "BROKEN:/missing.html",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 11: YAML architecture spec -> Mermaid diagram generation -> mmdc PNG -> sips thumbnail -> exiftool stamp", async () => {
  const archYaml = [
    "edges:",
    "  - from: Client",
    "    to: Gateway",
    "  - from: Gateway",
    "    to: Worker",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/arch.yaml": archYaml } }, async (h) => {
    const script = [
      "{ echo 'graph LR'; yq -o json '.edges' /workspace/arch.yaml | jq -r '.[] | \"  \\(.from) --> \\(.to)\"'; } > /workspace/arch.mmd",
      "mmdc -i /workspace/arch.mmd -o /workspace/arch.png",
      "sips -z 60 120 /workspace/arch.png --out /workspace/arch_thumb.png >/dev/null",
      "exiftool -overwrite_original -Artist='ArchBot' /workspace/arch_thumb.png >/dev/null",
      "identify /workspace/arch_thumb.png | awk '{ print $2, $3 }'",
      "exiftool -j /workspace/arch_thumb.png | jq -r '.[0].Artist'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "PNG 120x60",
        "ArchBot",
        "",
      ].join("\n"),
    );
  });
});

test("workflow 12: multi-region CSV ETL pipeline (csvstack -> csvjoin -> sqlite3 window analytics)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/us.csv": "order_id,cust_id,amount\n1,10,300\n2,20,150\n",
        "/workspace/eu.csv": "order_id,cust_id,amount\n3,10,500\n4,30,200\n",
        "/workspace/customers.csv": "cust_id,tier\n10,enterprise\n20,pro\n30,enterprise\n",
      },
    },
    async (h) => {
      const script = [
        "csvstack /workspace/us.csv /workspace/eu.csv > /workspace/orders.csv",
        "csvjoin -c cust_id /workspace/orders.csv /workspace/customers.csv > /workspace/enriched.csv",
        "printf '.mode csv\\n.import /workspace/enriched.csv enriched\\n' | sqlite3 /workspace/etl.db",
        "sqlite3 -header -csv /workspace/etl.db 'SELECT tier, COUNT(*) AS orders, SUM(CAST(amount AS INT)) AS revenue FROM enriched GROUP BY tier ORDER BY revenue DESC;'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "tier,orders,revenue",
          "enterprise,3,1000",
          "pro,1,150",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 13: three-way merge conflict detection (diff3 -m) and automated resolution", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/base.conf": "timeout=30\nretries=3\nmode=standard\n",
        "/workspace/ours.conf": "timeout=60\nretries=3\nmode=standard\n",
        "/workspace/theirs.conf": "timeout=90\nretries=3\nmode=turbo\n",
      },
    },
    async (h) => {
      const script = [
        "diff3 -m /workspace/ours.conf /workspace/base.conf /workspace/theirs.conf > /workspace/merged.conf || rc=$?",
        "printf 'conflict_rc=%d\\n' \"$rc\"",
        // Resolve conflict by preferring theirs (between ======= and >>>>>>>)
        "awk '/^<<<<<<</ { skip=1; next } /^=======/ { skip=0; next } /^>>>>>>>/ { next } !skip { print }' /workspace/merged.conf > /workspace/resolved.conf",
        "cat /workspace/resolved.conf",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "conflict_rc=1",
          "timeout=90",
          "retries=3",
          "mode=turbo",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 14: binary packet header inspection and in-place flag patching (xxd + dd + od)", async () => {
  // Packet: Magic 'POE1' (4B), Version 0x01 (1B), Flags 0x00 (1B), Len 0x0004 (2B), Payload 'PING' (4B)
  const packet = new Uint8Array([0x50, 0x4f, 0x45, 0x31, 0x01, 0x00, 0x00, 0x04, 0x50, 0x49, 0x4e, 0x47]);

  await withE2EHarness({ files: { "/workspace/pkt.bin": packet } }, async (h) => {
    const script = [
      "magic=$(dd if=/workspace/pkt.bin bs=1 count=4 2>/dev/null)",
      "payload=$(dd if=/workspace/pkt.bin bs=1 skip=8 count=4 2>/dev/null)",
      "printf 'magic=%s payload=%s\\n' \"$magic\" \"$payload\"",
      // Patch Flags byte at offset 5 from 0x00 to 0x7f
      "printf '\\x7f' | dd of=/workspace/pkt.bin bs=1 seek=5 count=1 conv=notrunc 2>/dev/null",
      "xxd -p /workspace/pkt.bin | tr -d '\\n'",
      "echo ''",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "magic=POE1 payload=PING",
        "504f4531017f000450494e47",
        "",
      ].join("\n"),
    );
  });
});

test("workflow 15: legacy encoding and line-ending normalization pipeline (iconv + dos2unix + sponge)", async () => {
  // ISO-8859-1 bytes for "resumé=1\r\ncafé=2\r\n"
  const latin1Crlf = new Uint8Array([
    0x72, 0x65, 0x73, 0x75, 0x6d, 0xe9, 0x3d, 0x31, 0x0d, 0x0a,
    0x63, 0x61, 0x66, 0xe9, 0x3d, 0x32, 0x0d, 0x0a,
  ]);

  await withE2EHarness({ files: { "/workspace/legacy.env": latin1Crlf } }, async (h) => {
    const script = [
      "iconv -f ISO-8859-1 -t UTF-8 /workspace/legacy.env | sponge /workspace/legacy.env",
      "dos2unix /workspace/legacy.env >/dev/null 2>&1",
      "cat /workspace/legacy.env",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "resumé=1",
        "café=2",
        "",
      ].join("\n"),
    );
  });
});

test("workflow 16: parallel map-reduce across background subshell workers (split + & + wait + awk)", async () => {
  const numbers = Array.from({ length: 40 }, (_, i) => String(i + 1)).join("\n") + "\n";

  await withE2EHarness(
    {
      backgroundJobs: true,
      files: { "/workspace/nums.txt": numbers },
    },
    async (h) => {
      const script = [
        "cd /workspace",
        "split -l 10 -d -a 2 nums.txt part_",
        "pids=()",
        "for p in part_*; do",
        "  (awk '{ s += $1 } END { print s }' \"$p\" > \"${p}.sum\") &",
        "  pids+=(\"$!\")",
        "done",
        "for pid in \"${pids[@]}\"; do wait \"$pid\"; done",
        "awk '{ total += $1 } END { print total }' part_*.sum",
      ].join("\n");

      // Sum of 1..40 = 40 * 41 / 2 = 820
      await h.expectOk(script, "820\n");
    },
  );
});

test("workflow 17: workspace disk usage audit and stale artifact pruning (find + du + numfmt + rm)", async () => {
  const oldDate = new Date("2024-01-01T00:00:00Z");
  const newDate = new Date("2026-06-01T00:00:00Z");

  await withE2EHarness(
    {
      files: {
        "/workspace/cache/stale1.tmp": { content: "x".repeat(2048), mtime: oldDate },
        "/workspace/cache/stale2.tmp": { content: "y".repeat(2048), mtime: oldDate },
        "/workspace/cache/fresh.tmp": { content: "z".repeat(512), mtime: newDate },
        "/workspace/cutoff.ref": { content: "", mtime: new Date("2025-01-01T00:00:00Z") },
      },
    },
    async (h) => {
      const script = [
        "before=$(find /workspace/cache -type f | wc -l | tr -d ' ')",
        "find /workspace/cache -type f ! -newer /workspace/cutoff.ref -exec rm {} +",
        "after=$(ls /workspace/cache | wc -l | tr -d ' ')",
        "remaining=$(ls /workspace/cache)",
        "printf 'before=%s after=%s kept=/workspace/cache/%s\\n' \"$before\" \"$after\" \"$remaining\"",
      ].join("\n");

      await h.expectOk(
        script,
        "before=3 after=1 kept=/workspace/cache/fresh.tmp\n",
      );
    },
  );
});

test("workflow 18: conventional commit parser, semantic version calculator, and CHANGELOG + package.json updater", async () => {
  const commits = [
    "fix(lexer): handle trailing backslash",
    "feat(parser): add case ;;& fallthrough",
    "chore(deps): bump internal types",
    "fix(fs): preserve device numbers",
    "",
  ].join("\n");

  await withE2EHarness(
    {
      files: {
        "/workspace/commits.txt": commits,
        "/workspace/package.json": JSON.stringify({ name: "safe-bash", version: "1.4.2" }, null, 2) + "\n",
        "/workspace/CHANGELOG.md": "# Changelog\n\n## v1.4.2\n- Previous release\n",
      },
    },
    async (h) => {
      const script = [
        "cur=$(jq -r '.version' /workspace/package.json)",
        "IFS='.' read -r maj min pat <<< \"$cur\"",
        "has_feat=$(grep -c '^feat' /workspace/commits.txt || true)",
        "if [ \"$has_feat\" -gt 0 ]; then min=$((min + 1)); pat=0; else pat=$((pat + 1)); fi",
        "next=\"${maj}.${min}.${pat}\"",
        "jq --arg v \"$next\" '.version = $v' /workspace/package.json | sponge /workspace/package.json",
        "{ printf '# Changelog\\n\\n## v%s\\n' \"$next\"; grep -E '^(feat|fix)' /workspace/commits.txt | sed 's/^/- /'; tail -n +3 /workspace/CHANGELOG.md; } | sponge /workspace/CHANGELOG.md",
        "jq -r '.version' /workspace/package.json",
        "head -n 6 /workspace/CHANGELOG.md",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "1.5.0",
          "# Changelog",
          "",
          "## v1.5.0",
          "- fix(lexer): handle trailing backslash",
          "- feat(parser): add case ;;& fallthrough",
          "- fix(fs): preserve device numbers",
          "",
        ].join("\n"),
      );
    },
  );
});

test("workflow 19: batch PDF invoice generation (envsubst + wkhtmltopdf), merging (pdfunite), and total auditing (pdftotext + bc)", async () => {
  const template = [
    "<html><body>",
    "  <h1>Invoice #${INV_ID}</h1>",
    "  <p>Customer: ${CUSTOMER}</p>",
    "  <p>AmountUSD: ${AMOUNT}</p>",
    "</body></html>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/template.html": template } }, async (h) => {
    const script = [
      "for row in '101:Acme:125.50' '102:Globex:340.25' '103:Initech:84.25'; do",
      "  IFS=':' read -r id cust amt <<< \"$row\"",
      "  INV_ID=\"$id\" CUSTOMER=\"$cust\" AMOUNT=\"$amt\" envsubst < /workspace/template.html > \"/workspace/inv_${id}.html\"",
      "  wkhtmltopdf -q \"/workspace/inv_${id}.html\" \"/workspace/inv_${id}.pdf\"",
      "done",
      "pdfunite /workspace/inv_101.pdf /workspace/inv_102.pdf /workspace/inv_103.pdf /workspace/ledger.pdf",
      "pages=$(qpdf --show-npages /workspace/ledger.pdf)",
      "total=$(pdftotext /workspace/ledger.pdf - | grep -E -o 'AmountUSD: [0-9.]+' | awk '{ print $2 }' | paste -sd '+' - | bc)",
      "printf 'pages=%s total=%s\\n' \"$pages\" \"$total\"",
    ].join("\n");

    await h.expectOk(script, "pages=3 total=550.00\n");
  });
});

test("workflow 20: autonomous bug reproduction, localization (rg -n), surgical patch (apply_patch), and diff receipt", async () => {
  const buggyScript = [
    "#!/bin/sh",
    "normalize_path() {",
    "  printf '%s\\n' \"$1\" | sed 's#//\\+#/#g'",
    "}",
    " compute_hash() {",
    "  printf '%s' \"$1\" | sha256sum | awk '{ print $2 }'",
    "}",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/util.sh": buggyScript } }, async (h) => {
    const script = [
      "cp /workspace/util.sh /workspace/util.sh.orig",
      // 1. Locate buggy awk field in compute_hash
      "line=$(rg -n 'sha256sum' /workspace/util.sh | cut -d':' -f1)",
      "printf 'bug_line=%s\\n' \"$line\"",
      // 2. Apply surgical patch fixing awk '{ print $2 }' -> awk '{ print $1 }'
      "apply_patch >/dev/null <<'EOF'",
      "*** Begin Patch",
      "*** Update File: /workspace/util.sh",
      "@@",
      "  compute_hash() {",
      "-  printf '%s' \"$1\" | sha256sum | awk '{ print $2 }'",
      "+  printf '%s' \"$1\" | sha256sum | awk '{ print $1 }'",
      " }",
      "*** End Patch",
      "EOF",
      // 3. Verify fix works
      ". /workspace/util.sh",
      "hash_len=$(compute_hash 'test-input' | awk '{ print length($0) }')",
      "printf 'hash_len=%s\\n' \"$hash_len\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "bug_line=6",
        "hash_len=64",
        "",
      ].join("\n"),
    );
  });
});
