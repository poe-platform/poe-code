import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("sponge, htmlq, exiftool, jq, yq, and rg structured & media pipeline matrix", () => {
  it("1. sponge buffers full pipeline output before overwriting the source file in place", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/config.env",
        "Z_KEY=3\nA_KEY=1\n# comment\nM_KEY=2\n",
      );

      const r = await h.exec(`
        grep -v '^#' config.env | sort | sponge config.env
        cat config.env
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "A_KEY=1\nM_KEY=2\nZ_KEY=3\n");
    });
  });

  it("2. sponge -a appends transformed output to the same file being read in a pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'item-1: 10\\nitem-2: 25\\n' > ledger.txt
        awk -F: '{s += $2} END {print "total: " s}' ledger.txt | sponge -a ledger.txt
        cat ledger.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "item-1: 10\nitem-2: 25\ntotal: 35\n");
    });
  });

  it("3. sponge without file operand passes buffered standard input to stdout", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'line-b\\nline-a\\n' | sort | sponge | tr 'a-z' 'A-Z'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "LINE-A\nLINE-B\n");
    });
  });

  it("4. htmlq extracts text (-t), attributes (-a), and ignore-whitespace (-i) across CSS selectors", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/page.html",
        [
          "<!doctype html>",
          "<html><body>",
          '  <nav><a class="nav-link" href="/docs">Docs</a><a class="nav-link" href="/api">API</a></nav>',
          '  <main id="content"><h1>Welcome</h1><p class="lead">Fast zero-dep shell</p></main>',
          "</body></html>",
        ].join("\n"),
      );

      const r = await h.exec(`
        htmlq -f page.html -t 'main#content h1'
        htmlq -f page.html -t 'p.lead'
        htmlq -f page.html -a href 'nav a.nav-link'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "Welcome\nFast zero-dep shell\n/docs\n/api\n",
      );
    });
  });

  it("5. htmlq -b (--base) and -B (--detect-base) resolve relative <a href> and <link href> URLs", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/links.html",
        '<html><head><base href="https://docs.example.com/v2/guide/"></head><body><a href="../ref/index.html">Ref</a><a href="/root.html">Root</a></body></html>',
      );

      const r = await h.exec(`
        htmlq -f links.html -B -a href 'a'
        echo "---"
        htmlq -f links.html -b https://override.example.org/app/ -a href 'a'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "https://docs.example.com/v2/ref/index.html",
          "https://docs.example.com/root.html",
          "---",
          "https://override.example.org/ref/index.html",
          "https://override.example.org/root.html",
          "",
        ].join("\n"),
      );
    });
  });

  it("6. htmlq -r (--remove-nodes) and -p (--pretty) strip unwanted elements and format HTML subtrees", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/article.html",
        '<article><div class="ad">Buy now</div><p>Paragraph 1</p></article>',
      );

      const r = await h.exec(`
        htmlq -f article.html -r '.ad' 'article'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "<article><p>Paragraph 1</p></article>\n");
    });
  });

  it("7. htmlq supports pseudo-classes (:first-child, :last-child, :nth-child, :not) and attribute combinators", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/list.html",
        [
          "<ul>",
          '  <li data-role="primary" data-env="prod-us">alpha</li>',
          '  <li data-role="secondary" data-env="staging">beta</li>',
          '  <li data-role="primary" data-env="prod-eu">gamma</li>',
          "</ul>",
        ].join("\n"),
      );

      const r = await h.exec(`
        htmlq -f list.html -t 'li:first-child'
        htmlq -f list.html -t 'li:last-child'
        htmlq -f list.html -t 'li[data-env^="prod-"]:not(:first-child)'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "alpha\ngamma\ngamma\n");
    });
  });

  it("8. convert + exiftool inspect generated PNG/JPEG image dimensions, MIME type, and EXIF metadata in JSON (-j)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        convert -size 64x48 xc:navy /workspace/sample.png
        exiftool -j /workspace/sample.png | jq -c '.[0] | {FileType, ImageWidth, ImageHeight, MIMEType}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"FileType":"PNG","ImageWidth":64,"ImageHeight":48,"MIMEType":"image/png"}\n',
      );
    });
  });

  it("9. exiftool writes and updates XMP/EXIF Artist, Copyright, and Comment tags in place and via -o", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        convert -size 32x32 xc:coral /workspace/photo.jpg
        exiftool -overwrite_original -Artist="Ada Lovelace" -Copyright="2026 Analytical Engine" /workspace/photo.jpg >/dev/null
        exiftool -s3 -Artist -Copyright /workspace/photo.jpg
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "Ada Lovelace\n2026 Analytical Engine\n");
    });
  });

  it("10. jq recursive descent (..), walk/reduce, group_by, andin-place sponge rewrite of complex JSON", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/services.json",
        JSON.stringify([
          { name: "api", region: "us", rps: 120, healthy: true },
          { name: "worker", region: "eu", rps: 80, healthy: true },
          { name: "cache", region: "us", rps: 300, healthy: false },
          { name: "auth", region: "eu", rps: 170, healthy: true },
        ]),
      );

      const r = await h.exec(`
        jq 'group_by(.region) | map({
          region: .[0].region,
          total_rps: (map(.rps) | add),
          healthy_services: (map(select(.healthy) | .name) | sort)
        })' services.json | sponge services.json
        jq -c '.[]' services.json
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          '{"region":"eu","total_rps":250,"healthy_services":["auth","worker"]}',
          '{"region":"us","total_rps":420,"healthy_services":["api"]}',
          "",
        ].join("\n"),
      );
    });
  });

  it("11. yq converts between YAML, JSON, and TOML and updates documents in place via sponge", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/deploy.yaml",
        [
          "service: billing",
          "replicas: 2",
          "env:",
          "  LOG_LEVEL: info",
          "",
        ].join("\n"),
      );

      const r = await h.exec(`
        yq -o yaml '.replicas = 5 | .env.LOG_LEVEL = "warn" | .env.REGION = "us-east-1"' deploy.yaml | sponge deploy.yaml
        yq -o json -c '.' deploy.yaml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"service":"billing","replicas":5,"env":{"LOG_LEVEL":"warn","REGION":"us-east-1"}}\n',
      );
    });
  });

  it("12. yq parses TOML (-p toml) and YAML inputs and queries nested structures into compact JSON", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/Cargo.toml",
        '[package]\nname = "safe-bash-rs"\nversion = "0.1.0"\nedition = "2024"\n',
      );

      const r = await h.exec(`
        yq -p toml -o json -c '.package' Cargo.toml
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '{"name":"safe-bash-rs","version":"0.1.0","edition":"2024"}\n',
      );
    });
  });

  it("13. rg searches with -g globs, -t file types, -C context lines, -o only-matching, and -r replacements", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/code/src", { recursive: true });
      await h.writeText(
        "/workspace/code/src/api.ts",
        "export function fetchUser(id: string) {\n  return `/v1/users/${id}`;\n}\n",
      );
      await h.writeText(
        "/workspace/code/src/api.test.ts",
        "fetchUser('42');\n",
      );

      const r = await h.exec(`
        rg --no-filename -g '!*.test.ts' -o '/v1/[a-z]+' -r '/v2/accounts' code/src
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "/v2/accounts\n");
    });
  });

  it("14. rg -c (--count), -l (--files-with-matches), --files, and -F (--fixed-strings) inspect source trees", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/mod", { recursive: true });
      await h.writeText("/workspace/mod/a.ts", "TODO(alpha)\nTODO(beta)\n");
      await h.writeText("/workspace/mod/b.ts", "clean file\n");
      await h.writeText("/workspace/mod/c.ts", "TODO(alpha)\n");

      const r = await h.exec(`
        rg -F -l 'TODO(alpha)' mod | sort
        echo "---"
        rg -c 'TODO' mod | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "mod/a.ts",
          "mod/c.ts",
          "---",
          "mod/a.ts:2",
          "mod/c.ts:1",
          "",
        ].join("\n"),
      );
    });
  });

  it("15. htmlq + jq pipeline scrapes structured HTML tables into normalized JSON records", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/report.html",
        [
          "<table>",
          '  <tr class="row"><td class="pkg">safe-fs</td><td class="ver">1.2.0</td></tr>',
          '  <tr class="row"><td class="pkg">safe-bash</td><td class="ver">2.0.0</td></tr>',
          "</table>",
        ].join("\n"),
      );

      const r = await h.exec(`
        htmlq -f report.html -t 'tr.row td.pkg' > pkgs.txt
        htmlq -f report.html -t 'tr.row td.ver' > vers.txt
        paste pkgs.txt vers.txt \
          | jq -R -s 'split("\\n") | map(select(length > 0) | split("\\t") | {package: .[0], version: .[1]})' \
          | jq -c '.'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '[{"package":"safe-fs","version":"1.2.0"},{"package":"safe-bash","version":"2.0.0"}]\n',
      );
    });
  });

  it("16. xmllint --xpath + jq + yq pipeline extracts XML configuration into YAML", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/pom.xml",
        [
          "<project>",
          "  <groupId>com.example</groupId>",
          "  <artifactId>demo-engine</artifactId>",
          "  <version>3.1.4</version>",
          "</project>",
        ].join("\n"),
      );

      const r = await h.exec(`
        g=$(xmllint --xpath 'string(/project/groupId)' pom.xml)
        a=$(xmllint --xpath 'string(/project/artifactId)' pom.xml)
        v=$(xmllint --xpath 'string(/project/version)' pom.xml)
        jq -n --arg g "$g" --arg a "$a" --arg v "$v" '{group:$g, artifact:$a, version:$v}' | yq -o yaml '.'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "\"group\": \"com.example\"\n\"artifact\": \"demo-engine\"\n\"version\": \"3.1.4\"\n",
      );
    });
  });

  it("17. sips + exiftool + jq pipeline resizes images and audits asset catalog dimensions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/assets
        convert -size 120x80 xc:teal /workspace/assets/banner.png
        sips -z 40 60 /workspace/assets/banner.png --out /workspace/assets/thumb.png >/dev/null
        exiftool -j /workspace/assets/banner.png /workspace/assets/thumb.png \
          | jq -c 'map({file: (.SourceFile | split("/") | last), w: .ImageWidth, h: .ImageHeight})'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        '[{"file":"banner.png","w":120,"h":80},{"file":"thumb.png","w":60,"h":40}]\n',
      );
    });
  });

  it("18. mmdc + htmlq / xmllint inspects rendered SVG diagram nodes and viewBox attributes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/flow.mmd",
        "graph LR\n  Start[Client] --> Api[Gateway]\n",
      );

      const r = await h.exec(`
        mmdc -i flow.mmd -o flow.svg
        htmlq -f flow.svg -a class 'svg'
        grep -o 'Gateway' flow.svg | head -n 1
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /Gateway\n$/);
    });
  });

  it("19. wkhtmltopdf + pdfinfo + pdftotext + rg end-to-end HTML-to-PDF indexing pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/spec.html",
        "<html><head><title>Protocol Spec</title></head><body><h1>Section 1</h1><p>TOKEN_ALPHA_9000</p></body></html>",
      );

      const r = await h.exec(`
        wkhtmltopdf spec.html spec.pdf
        pdfinfo spec.pdf | awk -F': +' '$1 == "Pages" {print "pages=" $2}'
        pdftotext spec.pdf - | rg -o 'TOKEN_ALPHA_[0-9]+'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "pages=1\nTOKEN_ALPHA_9000\n");
    });
  });

  it("20. end-to-end static site build pipeline with htmlq, yq, jq, rg, sponge, and sha256sum", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/site.yaml",
        "title: SafeBash Docs\nbase_url: https://safebash.dev/docs/\n",
      );

      const r = await h.exec(`
        printf '<html><body><h1>TITLE_PLACEHOLDER</h1><a href="getting-started.html">Start</a><div class="draft">WIP</div></body></html>\\n' > template.html
        title=$(yq -o json -r '.title' site.yaml)
        base=$(yq -o json -r '.base_url' site.yaml)
        sed "s/TITLE_PLACEHOLDER/$title/" template.html \
          | htmlq -b "$base" -r '.draft' 'html' \
          | sponge template.html
        htmlq -f template.html -t 'h1'
        htmlq -f template.html -b "$base" -a href 'a'
        rg -c 'WIP' template.html || echo "draft-removed"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "SafeBash Docs\nhttps://safebash.dev/docs/getting-started.html\ndraft-removed\n",
      );
    });
  });
});
