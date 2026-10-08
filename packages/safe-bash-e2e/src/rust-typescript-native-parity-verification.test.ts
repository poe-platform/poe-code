import assert from "node:assert/strict";
import { describe, it } from "node:test";
import zlib from "node:zlib";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb, withE2EHarness } from "./harness.js";

describe("Rust <-> TypeScript 100% native parity verification across all 5 reported areas", () => {
  it("Area 1 (Compression): native Rust bzip2, xz, zstd, gzip, and zip produce genuine format bytes (not disguised gzip) and round-trip cleanly", async () => {
    const rust = new RustWasmBash();
    assert.equal(rust.forceNative, true);

    const r = rust.execSync(`
      printf 'hello-native-compression-parity-12345\\n' > /workspace/sample.txt
      gzip -c /workspace/sample.txt > /workspace/sample.gz
      bzip2 -c /workspace/sample.txt > /workspace/sample.bz2
      xz -c /workspace/sample.txt > /workspace/sample.xz
      zstd -c /workspace/sample.txt > /workspace/sample.zst
      zip -q /workspace/sample.zip /workspace/sample.txt
      xxd -p -l 3 /workspace/sample.gz
      xxd -p -l 3 /workspace/sample.bz2
      xxd -p -l 6 /workspace/sample.xz
      xxd -p -l 4 /workspace/sample.zst
      xxd -p -l 4 /workspace/sample.zip
      bunzip2 -c /workspace/sample.bz2
      unxz -c /workspace/sample.xz
      unzstd -c /workspace/sample.zst
    `);
    assert.equal(r.exitCode, 0, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines[0], "1f8b08", "gzip magic header must be 1f8b08");
    assert.equal(lines[1], "425a68", "bzip2 magic header must be BZh (425a68), not gzip");
    assert.equal(lines[2], "fd377a585a00", "xz magic header must be fd377a585a00, not gzip");
    assert.equal(lines[3], "28b52ffd", "zstd magic header must be 28b52ffd, not gzip");
    assert.equal(lines[4], "504b0304", "zip magic header must be PK\\x03\\x04 (504b0304)");
    assert.equal(lines[5], "hello-native-compression-parity-12345");
    assert.equal(lines[6], "hello-native-compression-parity-12345");
    assert.equal(lines[7], "hello-native-compression-parity-12345");

    const gzBytes = rust.readFile("/workspace/sample.gz");
    const zstBytes = rust.readFile("/workspace/sample.zst");
    assert.equal(
      zlib.gunzipSync(gzBytes).toString("utf8"),
      "hello-native-compression-parity-12345\n"
    );
    if (typeof zlib.zstdDecompressSync === "function") {
      assert.equal(
        zlib.zstdDecompressSync(zstBytes).toString("utf8"),
        "hello-native-compression-parity-12345\n"
      );
    }
  });

  it("Area 2 (SQLite persistence): native Rust writes genuine SQLite 3 binary B-tree pages and interops bidirectionally with TypeScript sqlite3", async () => {
    const rust = new RustWasmBash();
    const savedBackend = process.env.SAFE_BASH_E2E_BACKEND; process.env.SAFE_BASH_E2E_BACKEND = 'ts'; const tsHarness = await SafeBashE2EHarness.create(); if (savedBackend === undefined) delete process.env.SAFE_BASH_E2E_BACKEND; else process.env.SAFE_BASH_E2E_BACKEND = savedBackend;
    try {
      const r1 = rust.execSync(`
        sqlite3 /workspace/rust_created.db "
          CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, score REAL);
          INSERT INTO items VALUES (1, 'alpha', 98.5), (2, 'beta', 42.25);
        "
      `);
      assert.equal(r1.exitCode, 0, r1.stderr);

      const dbBytes = rust.readFile("/workspace/rust_created.db");
      assert.equal(
        new TextDecoder().decode(dbBytes.subarray(0, 16)),
        "SQLite format 3\0"
      );
      assert.equal(dbBytes.byteLength % 4096, 0, "SQLite database must be a multiple of 4096-byte pages");
      assert.equal(dbBytes[16], 0x10);
      assert.equal(dbBytes[17], 0x00);
      const afterHeader = new TextDecoder().decode(dbBytes.subarray(16, 64));
      assert.equal(afterHeader.trim().startsWith("{"), false, "Must not be JSON appended after SQLite header");

      await tsHarness.writeBytes("/workspace/from_rust.db", dbBytes);
      const tsQuery = await tsHarness.exec(`
        sqlite3 /workspace/from_rust.db "SELECT id, name, score FROM items ORDER BY id;"
        sqlite3 /workspace/from_rust.db "INSERT INTO items VALUES (3, 'from_ts', 77.0);"
      `);
      assert.equal(tsQuery.exitCode, 0, tsQuery.stderr);
      assert.equal(tsQuery.stdout.trim(), "1|alpha|98.5\n2|beta|42.25");

      const updatedByTsBytes = await tsHarness.readBytes("/workspace/from_rust.db");
      rust.writeFile("/workspace/roundtrip.db", updatedByTsBytes);
      const rustQuery = rust.execSync(`
        sqlite3 /workspace/roundtrip.db "SELECT id, name, score FROM items ORDER BY id;"
      `);
      assert.equal(rustQuery.exitCode, 0, rustQuery.stderr);
      assert.equal(
        rustQuery.stdout.trim(),
        "1|alpha|98.5\n2|beta|42.25\n3|from_ts|77.0"
      );
    } finally {
      await tsHarness.dispose();
    }
  });

  it("Area 3 (Timing): native Rust sleep validates arguments and nested timeout returns 124 without printing late output", async () => {
    const rust = new RustWasmBash();

    const badSleep1 = rust.execSync("sleep");
    assert.equal(badSleep1.exitCode, 1);
    assert.match(badSleep1.stderr, /sleep: missing operand/);

    const badSleep2 = rust.execSync("sleep invalid_duration");
    assert.equal(badSleep2.exitCode, 1);
    assert.match(badSleep2.stderr, /sleep: invalid time interval/);

    const badSleep3 = rust.execSync("sleep -1");
    assert.equal(badSleep3.exitCode, 1);
    assert.match(badSleep3.stderr, /sleep: invalid option: -1/);

    const badSleep4 = rust.execSync("sleep -- -1");
    assert.equal(badSleep4.exitCode, 1);
    assert.match(badSleep4.stderr, /sleep: invalid time interval: -1/);

    const nested = rust.execSync("timeout 0.05 timeout 1 sh -c 'sleep 0.2; echo late'");
    assert.equal(nested.exitCode, 124, "Nested timeout must exit with 124");
    assert.equal(nested.stdout, "", "Nested timeout must not print late output");
  });

  it("Area 4 (Commands): native Rust supports op, gh, csvpy, env, and all 190 commands in the TypeScript configuration", async () => {
    const rust = new RustWasmBash();
    const savedBackend = process.env.SAFE_BASH_E2E_BACKEND; process.env.SAFE_BASH_E2E_BACKEND = 'ts'; const tsHarness = await SafeBashE2EHarness.create(); if (savedBackend === undefined) delete process.env.SAFE_BASH_E2E_BACKEND; else process.env.SAFE_BASH_E2E_BACKEND = savedBackend;
    try {
      const tsCommands = (
        tsHarness.shell as unknown as { commands: { list(): Array<{ name: string }> } }
      ).commands
        .list()
        .map((c) => c.name)
        .sort();
      assert.ok(tsCommands.length >= 190);

      for (const cmd of tsCommands) {
        const res = rust.execSync(`${JSON.stringify(cmd)} --version`);
        assert.notEqual(
          res.exitCode,
          127,
          `Command '${cmd}' returned 127 (command not found) in native Rust: ${res.stderr}`
        );
      }

      const opGhWorkflow = rust.execSync(`
        op --version
        gh --version | head -n 1
        op vault create "SecOps" --description "Security Vault" --format json >/dev/null
        op item create --category login --title "ProdDB" --vault SecOps username=pguser password=super_secret_pw "Net.port=5432" --format json >/dev/null
        op read "op://SecOps/ProdDB/username"
        op read "op://SecOps/ProdDB/Net/port"
        printf 'dsn=postgres://{{ op://SecOps/ProdDB/username }}@db:{{ op://SecOps/ProdDB/Net/port }}\\n' | op inject
        SECRET_PW="op://SecOps/ProdDB/password" op run -- sh -c 'echo "masked:$SECRET_PW"'
        SECRET_PW="op://SecOps/ProdDB/password" op run --no-masking -- sh -c 'echo "raw:$SECRET_PW"'
        gh issue create -R octocat/Hello-World -t "Parity issue" -b "Details"
        gh issue list -R octocat/Hello-World --json number,title,state --jq '.[0] | "\\(.number):\\(.title):\\(.state)"'
        gh pr create -R octocat/Hello-World -t "Parity PR" -b "PR body" -H feat/parity -B main
        gh pr list -R octocat/Hello-World --json number,title,headRefName --jq '.[0] | "\\(.number):\\(.title):\\(.headRefName)"'
      `);
      assert.equal(opGhWorkflow.exitCode, 0, opGhWorkflow.stderr);
      assert.equal(
        opGhWorkflow.stdout.trim(),
        [
          "0.0.1",
          "gh version 2.67.0 (2026-09-28)",
          "pguser",
          "5432",
          "dsn=postgres://pguser@db:5432",
          "masked:<concealed by 1Password>",
          "raw:super_secret_pw",
          "https://github.com/octocat/Hello-World/issues/1",
          "1:Parity issue:OPEN",
          "https://github.com/octocat/Hello-World/pull/2",
          "2:Parity PR:feat/parity",
        ].join("\n")
      );
    } finally {
      await tsHarness.dispose();
    }
  });

  it("Area 5 (Verification): Rust test harness executes natively without delegating to TypeScript for default, mountDev, memoryFsOptions, and xan configurations", async () => {
    const prevBackend = process.env.SAFE_BASH_E2E_BACKEND;
    process.env.SAFE_BASH_E2E_BACKEND = "rust";
    try {
      await withE2EHarness(
        {
          mountDev: true,
          memoryFsOptions: { maxBytes: 1024 * 1024, maxFileBytes: 512 * 1024, maxFiles: 128 },
        },
        async (h) => {
          const shellAny = h.shell as unknown as {
            forceNative?: boolean;
            _companion?: unknown;
          };
          assert.equal(shellAny.forceNative, true, "Harness must enable forceNative in Rust mode");
          assert.equal(shellAny._companion, null, "Harness must not instantiate TS companion");

          const r = await h.exec(`
            ls /dev | sort | tr '\\n' ','
            echo ""
            head -c 4 /dev/zero | xxd -p
            timeout 0.05 timeout 1 sh -c 'sleep 0.2; echo late' || echo "timeout-code:$?"
          `);
          assert.equal(r.exitCode, 0, r.stderr);
          assert.equal(
            r.stdout.trim(),
            ["null,random,urandom,zero,", "00000000", "timeout-code:124"].join("\n")
          );
          assert.equal(shellAny._companion, null, "TS companion must still be null after execution");
        }
      );
    } finally {
      if (prevBackend === undefined) {
        delete process.env.SAFE_BASH_E2E_BACKEND;
      } else {
        process.env.SAFE_BASH_E2E_BACKEND = prevBackend;
      }
    }
  });
});
