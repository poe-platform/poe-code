import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("yq, fd, envsubst, sponge, numfmt, cal, pathchk, unrtf, and extended CLI matrix", () => {
  it("1. yq YAML-to-JSON and JSON-to-YAML transformation with nested mutations and array filtering", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/service.yaml",
        [
          "name: payments",
          "replicas: 2",
          "ports:",
          "  - 8080",
          "  - 8443",
          "env:",
          "  LOG_LEVEL: info",
        ].join("\n") + "\n"
      );
      const r = await h.exec(`
        yq -o json -c '.replicas = 5 | .ports += [9090] | .env.LOG_LEVEL = "debug"' /workspace/service.yaml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), {
        name: "payments",
        replicas: 5,
        ports: [8080, 8443, 9090],
        env: { LOG_LEVEL: "debug" },
      });
    });
  });

  it("2. yq multi-document YAML stream evaluation with sponge in-place update", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/manifests.yaml",
        [
          "---",
          "kind: ConfigMap",
          "metadata:",
          "  name: cfg-a",
          "---",
          "kind: Deployment",
          "metadata:",
          "  name: app-b",
        ].join("\n") + "\n"
      );
      const r = await h.exec(`
        yq -o yaml '.metadata.namespace = "prod"' /workspace/manifests.yaml | sponge /workspace/manifests.yaml
        yq -o json -c 'select(.kind == "Deployment") | {kind: .kind, name: .metadata.name, ns: .metadata.namespace}' /workspace/manifests.yaml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), {
        kind: "Deployment",
        name: "app-b",
        ns: "prod",
      });
    });
  });

  it("3. yq TOML-to-JSON and TOML-to-YAML decoding with inline tables and arrays of tables", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/Cargo.toml",
        [
          "[package]",
          'name = "safe-bash-rs"',
          'version = "0.2.0"',
          "",
          "[dependencies]",
          'serde = { version = "1.0", features = ["derive"] }',
          "",
          "[[bin]]",
          'name = "sb-cli"',
          'path = "src/main.rs"',
        ].join("\n") + "\n"
      );
      const r = await h.exec(`
        yq -p toml -o json -r '.package.name + ":" + .dependencies.serde.version + ":" + .bin[0].name' /workspace/Cargo.toml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "safe-bash-rs:1.0:sb-cli");
    });
  });

  it("4. yq YAML anchors, aliases, block scalars, and flow collections round-tripped to compact JSON", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/pipeline.yaml",
        [
          "defaults: &def {retries: 3, timeout: 60}",
          "stages:",
          "  - name: build",
          "    config: *def",
          "    script: |",
          "      cargo build",
          "      cargo test",
        ].join("\n") + "\n"
      );
      const r = await h.exec(`
        yq -o json -c '.stages[0] | {name: .name, retries: .config.retries, script: .script}' /workspace/pipeline.yaml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), {
        name: "build",
        retries: 3,
        script: "cargo build\ncargo test\n",
      });
    });
  });

  it("5. fd file discovery with --extension, --type, --max-depth, and --exclude", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/repo/src/core /workspace/repo/dist /workspace/repo/docs
        touch /workspace/repo/src/index.ts /workspace/repo/src/core/engine.ts /workspace/repo/dist/bundle.js /workspace/repo/docs/guide.md
        cd /workspace/repo
        fd -e ts --exclude dist | sort
        echo "---DIRS---"
        fd -t d --max-depth 2 | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "src/core/engine.ts",
          "src/index.ts",
          "---DIRS---",
          "dist/",
          "docs/",
          "src/",
          "src/core/",
        ].join("\n")
      );
    });
  });

  it("6. fd path format templates ({}, {/}, {//}, {.}, {/.}) and --exec / --exec-batch", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/assets/icons
        printf 'svg-a\n' > /workspace/assets/icons/logo.svg
        printf 'svg-b\n' > /workspace/assets/icons/arrow.svg
        cd /workspace
        fd . assets -e svg --format '{//} :: {/} :: {/.} :: {.}' | sort
        echo "---EXEC-BATCH---"
        fd . assets -e svg -X wc -l | tail -n 1 | awk '{print $1}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "assets/icons :: arrow.svg :: arrow :: assets/icons/arrow",
          "assets/icons :: logo.svg :: logo :: assets/icons/logo",
          "---EXEC-BATCH---",
          "2",
        ].join("\n")
      );
    });
  });

  it("7. fd respects .gitignore and .fdignore by default and includes ignored/hidden with -H -I", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/proj/.git
        printf '*.tmp\n' > /workspace/proj/.gitignore
        printf 'secret.txt\n' > /workspace/proj/.fdignore
        touch /workspace/proj/main.rs /workspace/proj/cache.tmp /workspace/proj/secret.txt /workspace/proj/.env
        cd /workspace/proj
        echo "=== DEFAULT ==="
        fd . | sort
        echo "=== ALL (-H -I) ==="
        fd -H -I -t f . | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "=== DEFAULT ===",
          "main.rs",
          "=== ALL (-H -I) ===",
          ".env",
          ".fdignore",
          ".gitignore",
          "cache.tmp",
          "main.rs",
          "secret.txt",
        ].join("\n")
      );
    });
  });

  it("8. envsubst variable substitution, SHELL-FORMAT allowlist filtering, and -v variable extraction", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        export APP_HOST="api.example.com"
        export APP_PORT="8443"
        export SECRET_TOKEN="do-not-substitute"

        printf 'url=https://$APP_HOST:\${APP_PORT}/v1 token=$SECRET_TOKEN\n' > /workspace/tmpl.txt

        echo "=== EXTRACT (-v) ==="
        envsubst -v 'https://$APP_HOST:\${APP_PORT}/v1/$SECRET_TOKEN'

        echo "=== ALLOWLIST ==="
        envsubst '$APP_HOST \${APP_PORT}' < /workspace/tmpl.txt

        echo "=== ALL ==="
        envsubst < /workspace/tmpl.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "=== EXTRACT (-v) ===",
          "APP_HOST",
          "APP_PORT",
          "SECRET_TOKEN",
          "=== ALLOWLIST ===",
          "url=https://api.example.com:8443/v1 token=$SECRET_TOKEN",
          "=== ALL ===",
          "url=https://api.example.com:8443/v1 token=do-not-substitute",
        ].join("\n")
      );
    });
  });

  it("9. sponge atomic in-place pipeline soak and append mode (-a) without truncating input file prematurely", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'gamma\nalpha\nbeta\n' > /workspace/list.txt
        sort /workspace/list.txt | tr 'a-z' 'A-Z' | sponge /workspace/list.txt
        cat /workspace/list.txt
        echo "---APPEND---"
        grep '^A' /workspace/list.txt | sponge -a /workspace/list.txt
        cat /workspace/list.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "ALPHA",
          "BETA",
          "GAMMA",
          "---APPEND---",
          "ALPHA",
          "BETA",
          "GAMMA",
          "ALPHA",
        ].join("\n")
      );
    });
  });

  it("10. numfmt SI and IEC human-readable number conversions (--to=iec, --to=si, --from=iec, --field)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        numfmt --to=iec 1048576
        numfmt --to=iec-i 1048576
        numfmt --to=si 1000000
        numfmt --from=iec 2K
        printf 'disk1 2048\ndisk2 1048576\n' | numfmt --field=2 --to=iec | tr -s ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "1.0M",
          "1.0Mi",
          "1.0M",
          "2048",
          "disk1 2.0K",
          "disk2 1.0M",
        ].join("\n")
      );
    });
  });

  it("11. cal monthly and leap-year February calendar rendering", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cal 2 2024
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /February 2024/);
      assert.match(r.stdout, /29/);
    });
  });

  it("12. pathchk POSIX portability checks (-p, -P) accept valid paths and reject invalid characters or empty paths", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        pathchk -p -P "valid_dir/file-01.txt"
        echo "valid:$?"
        if pathchk -P -- "-leading-hyphen" 2>/dev/null; then
          echo "unexpected"
        else
          echo "hyphen:$?"
        fi
        if pathchk -P "" 2>/dev/null; then
          echo "unexpected"
        else
          echo "empty:$?"
        fi
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["valid:0", "hyphen:1", "empty:1"].join("\n"));
    });
  });

  it("13. unrtf converts Rich Text Format documents to plain text (--text) and HTML (--html)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/doc.rtf",
        "{\\rtf1\\ansi{\\b Hello} {\\i RTF World}\\par Second paragraph.}\n"
      );
      const r = await h.exec(`
        unrtf --text /workspace/doc.rtf | grep -E 'Hello|Second'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /Hello RTF World/);
      assert.match(r.stdout, /Second paragraph\./);
    });
  });

  it("14. xmllint --xpath, --format, and well-formedness checking on XML documents", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/catalog.xml",
        '<catalog><book id="b1"><title>Rust in Action</title><price>45</price></book><book id="b2"><title>Zero Dep Shell</title><price>55</price></book></catalog>\n'
      );
      const r = await h.exec(`
        xmllint --xpath 'string(//book[@id="b2"]/title)' /workspace/catalog.xml
        echo ""
        xmllint --format /workspace/catalog.xml | head -n 3
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /Zero Dep Shell/);
      assert.match(r.stdout, /<\?xml version="1\.0"\?>/);
    });
  });

  it("15. htmlq CSS selector extraction (-a/--attributes, -t/--text, -r/--remove-nodes) in web scraping pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/page.html",
        [
          "<html><body>",
          '<nav><a href="/ignore">Skip</a></nav>',
          '<main><article data-id="101"><h2>First Post</h2><span class="secret">draft</span><p>Published text</p></article></main>',
          "</body></html>",
        ].join("\n")
      );
      const r = await h.exec(`
        htmlq --attributes data-id 'main > article' < /workspace/page.html
        htmlq --text --remove-nodes '.secret' 'main > article' < /workspace/page.html | tr -s ' \n' ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /^101\n/);
      assert.match(r.stdout, /First Post.*Published text/);
      assert.doesNotMatch(r.stdout, /draft/);
    });
  });

  it("16. system identity & environment introspection commands: id, whoami, uname, hostname, nproc, locale, getconf, df", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        whoami
        id -u
        id -un
        uname -s
        hostname
        nproc
        getconf PAGE_SIZE
        locale | grep '^LC_ALL='
        df -h /workspace | awk 'NR==2 {print $NF}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines.length, 9);
      assert.ok(Number(lines[1]) >= 0);
      assert.equal(lines[0], lines[2]);
      assert.ok(Number(lines[5]) >= 1);
      assert.ok(Number(lines[6]) >= 1024);
      assert.match(lines[7]!, /^LC_ALL=/);
    });
  });

  it("17. yes command piped into head -n and awk for bounded stream generation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        yes "retry-token" | head -n 5 | uniq -c | awk '{print $1 ":" $2}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), "5:retry-token");
    });
  });

  it("18. install command creates parent directories (-d / -D), sets permissions (-m), and copies files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '#!/bin/sh\necho "installed-ok"\n' > /workspace/mytool.sh
        install -D -m 0755 /workspace/mytool.sh /workspace/opt/bin/mytool
        stat -c '%a' /workspace/opt/bin/mytool
        cat /workspace/opt/bin/mytool | tail -n 1
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["755", 'echo "installed-ok"'].join("\n"));
    });
  });

  it("19. diff3 three-way merge (-m) resolves non-overlapping changes and reports exit code 1 on conflicts", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/base.txt", "line1\nline2\nline3\n");
      await h.writeText("/workspace/mine.txt", "line1-mine\nline2\nline3\n");
      await h.writeText("/workspace/yours.txt", "line1\nline2\nline3-yours\n");
      const r = await h.exec(`
        diff3 -m /workspace/mine.txt /workspace/base.txt /workspace/yours.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["line1-mine", "line2", "line3-yours"].join("\n"));
    });
  });

  it("20. end-to-end config templating pipeline: fd discovers templates -> envsubst expands -> yq validates -> jq merges -> sponge writes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/templates/db.yaml.tmpl",
        "database:\n  host: ${DB_HOST}\n  port: ${DB_PORT}\n"
      );
      await h.writeText(
        "/workspace/templates/cache.yaml.tmpl",
        "cache:\n  url: redis://${REDIS_HOST}:6379\n"
      );
      const r = await h.exec(`
        export DB_HOST="pg.internal"
        export DB_PORT="5432"
        export REDIS_HOST="cache.internal"

        mkdir -p /workspace/rendered
        for f in $(fd . /workspace/templates -e tmpl | sort); do
          base=$(basename "$f" .tmpl)
          envsubst < "$f" | yq -o json -c '.' > "/workspace/rendered/$base.json"
        done

        jq -s -c '.[0] * .[1]' /workspace/rendered/db.yaml.json /workspace/rendered/cache.yaml.json \
          | sponge /workspace/rendered/merged.json

        cat /workspace/rendered/merged.json
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), {
        database: { host: "pg.internal", port: 5432 },
        cache: { url: "redis://cache.internal:6379" },
      });
    });
  });
});
